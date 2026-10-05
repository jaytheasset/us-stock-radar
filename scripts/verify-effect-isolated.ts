import './effect-isolated-runtime.mjs';
import {isolated} from './effect-isolated-runtime.mjs';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import pg from 'pg';
import {collectEffectFixture} from '../lib/sec-effect/fixtures.ts';
import {readEffectNotice,captureEffectSource} from '../lib/sec-effect/source.ts';
import {consumeListingMonitorAlertsForEvent} from '../lib/monitor/listingMonitorAlertConsumer.ts';
const db = new pg.Client({connectionString:isolated.DB_URL});
await db.connect();
const app='http://localhost:3117';
const password='Isolated-Effect-Only-59422!';
const s3=process.argv.includes('--s3');
const selectedAccession=s3?'0001538379-26-000025':'0001538379-24-000025';
const otherAccession=s3?'0001538379-26-000027':'0001538379-24-000027';
async function api(path:string, body?:unknown, cookie='', method=body===undefined?'GET':'POST') {
  const response=await fetch(app+path,{method,headers:{'Content-Type':'application/json',origin:app,cookie},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:response.status,body:await response.json(),cookie:response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')};
}
async function saveRaw(raw:Record<string,any>) {
  return (await db.query(`insert into public.raw_items(source_code,source_group,source_unique_id,source_url,published_at,raw_payload,metadata,body_text,dedupe_key)
    values('sec_edgar','filings',$1,$2,$3,$4,$5,$6,$7) on conflict(source_code,source_unique_id) where source_unique_id is not null do update set raw_payload=excluded.raw_payload returning *`,
    [raw.source_unique_id,raw.source_url,raw.published_at,raw.raw_payload,raw.metadata??{},raw.body_text??'',`effect-test:${raw.source_unique_id}`])).rows[0];
}
try {
  if(process.argv.includes('--seed')) {
    // The stack is disposable and explicitly isolated; repeatable seed never modifies shared state.
    await db.query("insert into public.sources(code,name,source_group,runtime_owner,enabled) values('sec_edgar','SEC','filings','manual',false) on conflict(code) do nothing");
    await db.query("insert into public.event_types(code,label,category,badge_tone) values('offering','Offering','capital','neutral') on conflict(code) do nothing");
    for (const who of ['a','b']) {
      const response=await fetch(isolated.API_URL+'/auth/v1/admin/users',{method:'POST',headers:{apikey:isolated.SERVICE_ROLE_KEY,authorization:`Bearer ${isolated.SERVICE_ROLE_KEY}`,'content-type':'application/json'},body:JSON.stringify({email:`effect-${who}@example.test`,password,email_confirm:true})});
      assert.ok(response.ok || response.status===422,'isolated user seed');
    }
    for(const [acc,form,file] of [['0001538379-24-000025','S-1','333-278172'],['0001538379-24-000026','S-1/A','333-278172'],['0001538379-24-000027','S-1','333-999999'],['0001538379-26-000025','S-3','333-300003'],['0001538379-26-000026','S-3/A','333-300003'],['0001538379-26-000027','S-3','333-300004']]) {
      await saveRaw({source_unique_id:acc,source_url:`https://www.sec.gov/Archives/edgar/data/1538379/${acc.replaceAll('-','')}/${acc}-index.html`,published_at:'2024-03-22',raw_payload:{accession_number:acc,cik:'0001538379',file_number:file,form_type:form,company_name:'Ibotta, Inc.',ticker:'IBTA'}});
    }
    const cases=[];
    for(const name of ['s1-effective','pos-am-effective','f4-multiple-filers','s3-synthetic']) {
      const {raw}=await collectEffectFixture(name==='s3-synthetic'?'s1-effective':name);
      if(name==='s3-synthetic') {
        const original=raw.raw_payload.documents[0].effectOriginalSource;
        raw.source_unique_id='9999999995-26-001005'; raw.raw_payload.accession_number=raw.source_unique_id;
        original.url=original.url.replace('999999999524001005','999999999526001005');
        raw.source_url=original.url;
        raw.raw_payload.documents[0].effectOriginalSource=captureEffectSource('EFFECT',{type:'EFFECT',url:original.url},original.xml.replace('<form>S-1</form>','<form>S-3</form>').replace('333-278172','333-300003'));
      }
      const saved=await saveRaw(raw);
      assert.deepEqual(readEffectNotice(saved),readEffectNotice(raw),'XML+JSON DB roundtrip');
      const event=(await db.query(`insert into public.events(raw_item_id,source_code,source_group,event_type,score,delivery_level,impact,signal,title,group_dedupe_key,metadata)
        values($1,'sec_edgar','filings','offering',50,'archive','low','neutral',$2,$3,$4) on conflict(source_group,group_dedupe_key) do update set raw_item_id=excluded.raw_item_id returning id`,[saved.id,`EFFECT ${name}`,`effect-test:${name}`,{accession_number:saved.source_unique_id}])).rows[0];
      cases.push({name,rawId:saved.id,eventId:event.id});
    }
    writeFileSync(process.env.EFFECT_ISOLATED_STATUS!.replace('status.json','cases.json'),JSON.stringify(cases));
    console.log('PASS isolated seed: 2 users, 3 real XML collection/DB roundtrips plus explicitly synthetic S-3 controls');
  } else if (process.argv.includes('--ingest')) {
    const {runSecFilingAnalysisIngest}=await import('../lib/secFilingAnalysisIngest.ts');
    const result=await runSecFilingAnalysisIngest({accessionNumber:'9999999995-24-001005',force:true});
    assert.equal(result.ok,true,JSON.stringify({stage:result.stage,error:'error' in result?result.error:undefined}));
    const execution=(result as any).effectMonitorExecution;
    assert.equal(execution?.status,'completed',JSON.stringify(execution));
    assert.equal(execution.failedCount,0,JSON.stringify(execution.writes));
    console.log('PASS real deterministic Primary persistence → EFFECT Monitor fanout',JSON.stringify({created:execution.createdCount,existing:execution.existingCount}));
  } else {
    const a=await api('/api/auth/login',{email:'effect-a@example.test',password}); assert.equal(a.status,200);
    const b=await api('/api/auth/login',{email:'effect-b@example.test',password}); assert.equal(b.status,200);
    assert.equal((await api('/api/monitors/listing')).status,401);
    const compiled=await api('/api/monitors/listing/compile',{text:`Ibotta ${s3?'S-3':'S-1'} 등록 건에 EFFECT가 나오면 알려줘`},a.cookie);
    assert.equal(compiled.status,200,JSON.stringify(compiled.body));
    const draft=compiled.body.data; assert.equal(draft.effectResolution.candidates.length,2);
    assert.equal(draft.effectResolution.candidates.find((c:any)=>c.accession===selectedAccession).filingCount,2);
    assert.equal((await api('/api/monitors/listing',{conditions:draft.conditions},a.cookie)).status,422);
    const confirmed=await api('/api/monitors/listing/confirm',{draft,registrationAccession:selectedAccession},a.cookie);
    assert.equal(confirmed.status,200,JSON.stringify(confirmed.body));
    const conditions=confirmed.body.data.conditions;
    const ma=await api('/api/monitors/listing',{conditions},a.cookie),mb=await api('/api/monitors/listing',{conditions},b.cookie);
    assert.equal(ma.status,201,JSON.stringify(ma.body)); assert.equal(mb.status,201,JSON.stringify(mb.body));
    const amid=ma.body.data.monitor.id,bmid=mb.body.data.monitor.id;
    const ar=await api('/api/monitors/listing',undefined,a.cookie);
    assert.ok(ar.body.data.monitors.some((m:any)=>m.id===amid && JSON.stringify(m.conditions)===JSON.stringify(conditions)));
    assert.ok(!ar.body.data.monitors.some((m:any)=>m.id===bmid));
    assert.equal((await api(`/api/monitors/listing/${bmid}`,undefined,a.cookie)).status,404);
    assert.equal((await api(`/api/monitors/listing/${bmid}`,{isActive:false},a.cookie,'PATCH')).status,404);
    for (const invalid of [conditions.slice(1),conditions.map((c:any)=>c.key==='effect.file_number'?{...c,value:'333-999999'}:c),[{key:'market.ticker',operator:'eq',value:'IBTA'}]]) {
      assert.equal((await api(`/api/monitors/listing/${amid}`,{conditions:invalid},a.cookie,'PATCH')).status,422);
    }
    const otherConfirmed=await api('/api/monitors/listing/confirm',{draft,registrationAccession:otherAccession},a.cookie);
    const other=await api('/api/monitors/listing',{conditions:otherConfirmed.body.data.conditions},a.cookie);
    assert.equal(other.status,201);
    const event=(await db.query('select id from public.events where group_dedupe_key=$1',[`effect-test:${s3?'s3-synthetic':'s1-effective'}`])).rows[0];
    const results=await Promise.all(Array.from({length:12},()=>consumeListingMonitorAlertsForEvent({eventId:event.id})));
    assert.equal(results.flatMap(r=>r.writes).filter(w=>w.status==='failed').length,0,JSON.stringify(results[0]));
    assert.equal(results.flatMap(r=>r.writes).filter(w=>w.status==='created' && [amid,bmid].includes(w.monitorId)).length,2);
    const alerts=await api('/api/monitors/listing/alerts',undefined,a.cookie);
    assert.equal(alerts.status,200,JSON.stringify(alerts.body));
    assert.equal(alerts.body.data.alerts.filter((x:any)=>x.monitorId===amid).length,1);
    assert.ok(!alerts.body.data.alerts.some((x:any)=>x.monitorId===bmid));
    assert.ok(!alerts.body.data.alerts.some((x:any)=>x.monitorId===other.body.data.monitor.id),'different registration excluded');
    // A different notice/accession for the same registration must still be once per Monitor.
    const original=(await db.query('select * from public.raw_items where id=(select raw_item_id from public.events where id=$1)',[event.id])).rows[0];
    const second=structuredClone(original),acc=s3?'9999999995-26-009999':'9999999995-24-009999';
    second.source_unique_id=acc; second.raw_payload.accession_number=acc;
    const source=second.raw_payload.documents[0].effectOriginalSource;
    source.url=source.url.replace(original.source_unique_id.replaceAll('-',''),acc.replaceAll('-',''));
    second.source_url=source.url;
    const r2=await saveRaw(second);
    const e2=(await db.query(`insert into public.events(raw_item_id,source_code,source_group,event_type,score,delivery_level,impact,signal,title,group_dedupe_key,metadata)
      values($1,'sec_edgar','filings','offering',50,'archive','low','neutral','Replay identity fixture','effect-test:second',$2)
      on conflict(source_group,group_dedupe_key) do update set raw_item_id=excluded.raw_item_id returning id`,[r2.id,{accession_number:acc}])).rows[0];
    const replay=await consumeListingMonitorAlertsForEvent({eventId:e2.id});
    assert.equal(replay.failedCount,0); assert.equal(replay.createdCount,0);
    const ev=(await db.query('select effect_match_evidence from public.user_alert_deliveries where listing_monitor_id=$1',[amid])).rows[0].effect_match_evidence;
    await assert.rejects(db.query('select * from public.create_effect_monitor_alert($1,$2,$3)',[amid,event.id,{...ev,kind:null}]),/EFFECT_TARGET_CONFLICT/);
    await api(`/api/monitors/listing/${amid}`,{isActive:false},a.cookie,'PATCH');
    await assert.rejects(db.query('select * from public.create_effect_monitor_alert($1,$2,$3)',[amid,event.id,ev]),/EFFECT_MONITOR_INACTIVE/);
    await api(`/api/monitors/listing/${amid}`,{isActive:true},a.cookie,'PATCH');
    await db.query('begin');
    try {
      await db.query("update public.raw_items set raw_payload=jsonb_set(raw_payload,'{file_number}','\"333-123456\"') where source_unique_id=$1",[selectedAccession]);
      await assert.rejects(db.query('select * from public.create_effect_monitor_alert($1,$2,$3)',[amid,event.id,ev]),/EFFECT_REGISTRATION_EVIDENCE_UNAVAILABLE/);
    } finally { await db.query('rollback'); }
    await db.query('begin');
    try {
      await db.query('set local role authenticated');
      await db.query("select set_config('request.jwt.claim.sub',$1,true)",[ma.body.data.monitor.userId]);
      const visible=await db.query('select user_id from public.user_alert_deliveries');
      assert.ok(visible.rows.length>0); assert.ok(visible.rows.every(x=>x.user_id===ma.body.data.monitor.userId));
      await assert.rejects(db.query('select * from public.create_effect_monitor_alert($1,$2,$3)',[amid,event.id,ev]),/permission denied/);
    } finally { await db.query('rollback'); }
    console.log('PASS second notice replay, other registration exclusion, target edit/removal rejection, pause race, evidence changes, RLS and service-only writer');
    console.log('PASS API compiler replay → review candidates → confirm → save/readback → 12 concurrent consumer runs → owner-scoped Monitor alerts');
  }
} finally {await db.end();}
