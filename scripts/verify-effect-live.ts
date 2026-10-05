// Live candidate verification: product entrypoints only, never insert facts or alerts.
import {isolated} from './effect-live-runtime.mjs';
import assert from 'node:assert/strict';
import {writeFileSync,readFileSync} from 'node:fs';
import pg from 'pg';
const db=new pg.Client({connectionString:isolated.DB_URL});
await db.connect();
const [mode,accession,cik,form]=process.argv.slice(2);
const out=process.env.EFFECT_LIVE_OUT!;
async function api(path:string,body?:unknown,cookie='',method=body===undefined?'GET':'POST'){
  const r=await fetch('http://localhost:3117'+path,{method,headers:{'content-type':'application/json',origin:'http://localhost:3117',cookie},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:r.status,body:await r.json(),cookie:r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')};
}
try{
  const identity=(await db.query('select system_identifier::text id from pg_control_system()')).rows[0];
  const users=(await db.query("select email from auth.users where email in ('effect-a@example.test','effect-b@example.test') order by email")).rows;
  assert.equal(users.length,2);
  if(mode==='inspect'){
    console.log(JSON.stringify({database:isolated.API_URL,systemId:identity.id,users,
      existingRealRows:(await db.query("select source_unique_id from raw_items where raw_payload->>'cik' in ('1830033','0001830033')")).rows}));
  }else if(mode==='controls'||mode==='check'){
    const responses=JSON.parse(readFileSync(`${out}/live-monitor-responses.json`,'utf8').replace(/^\uFEFF/,''));
    const created=responses.find((r:any)=>r.status===201).body.data.monitor;
    const draft=responses.find((r:any)=>r.url.endsWith('/compile')).body.data;
    const a=await api('/api/auth/login',{email:'effect-a@example.test',password:'Isolated-Effect-Only-59422!'});
    const b=await api('/api/auth/login',{email:'effect-b@example.test',password:'Isolated-Effect-Only-59422!'});
    assert.equal(a.status,200);assert.equal(b.status,200);
    const readback=await api(`/api/monitors/listing/${created.id}`,undefined,a.cookie);
    assert.equal(readback.status,200);
    assert.deepEqual(readback.body.data.monitor.conditions,created.conditions);
    if(mode==='controls'){
      const other=draft.effectResolution.candidates.find((c:any)=>!created.conditions.some((v:any)=>v.key==='effect.file_number'&&v.value===c.fileNumber));
      const confirmed=await api('/api/monitors/listing/confirm',{draft,registrationAccession:other.accession},a.cookie);
      assert.equal(confirmed.status,200);
      const negative=await api('/api/monitors/listing',{conditions:confirmed.body.data.conditions},a.cookie);
      const secondOwner=await api('/api/monitors/listing',{conditions:created.conditions},b.cookie);
      assert.equal(negative.status,201);assert.equal(secondOwner.status,201);
      const state={positive:created.id,negative:negative.body.data.monitor.id,secondOwner:secondOwner.body.data.monitor.id,readback:readback.body};
      writeFileSync(`${out}/live-monitor-state.json`,JSON.stringify(state,null,2));
      console.log(JSON.stringify(state));
    }else{
      const state=JSON.parse(readFileSync(`${out}/live-monitor-state.json`,'utf8'));
      const rows=(await db.query('select listing_monitor_id,user_id,alert_event_id,effect_registration_key,effect_match_evidence from user_alert_deliveries where listing_monitor_id=any($1::uuid[])',[ [state.positive,state.negative,state.secondOwner] ])).rows;
      assert.equal(rows.filter((r:any)=>r.listing_monitor_id===state.positive).length,1);
      assert.equal(rows.filter((r:any)=>r.listing_monitor_id===state.secondOwner).length,1);
      assert.equal(rows.filter((r:any)=>r.listing_monitor_id===state.negative).length,0);
      assert.equal((await api(`/api/monitors/listing/${state.secondOwner}`,undefined,a.cookie)).status,404);
      assert.equal((await api(`/api/monitors/listing/${state.positive}`,undefined,b.cookie)).status,404);
      for(const [cookie,own,foreign] of [[a.cookie,state.positive,state.secondOwner],[b.cookie,state.secondOwner,state.positive]]){
        const alerts=await api(`/api/monitors/listing/alerts?monitorId=${own}`,undefined,cookie);
        assert.equal(alerts.status,200);assert.equal(alerts.body.data.alerts.length,1);
        const hidden=await api(`/api/monitors/listing/alerts?monitorId=${foreign}`,undefined,cookie);
        assert.equal(hidden.status,200);assert.equal(hidden.body.data.alerts.length,0);
      }
      writeFileSync(`${out}/live-alert-check.json`,JSON.stringify({rows,ownerIsolation:true,readback:true},null,2));
      console.log(JSON.stringify({rows,ownerIsolation:true,readback:true}));
    }
  }else if(mode==='collect'){
    const {runSecRawIngest}=await import('../lib/secIngest.ts');
    const result=await runSecRawIngest({accessionNumber:accession,cik,formTypes:[form],includeDocuments:true,attachmentLimit:0,force:true});
    writeFileSync(`${out}/live-collect-${accession}.json`,JSON.stringify(result,null,2));
    const raw=(await db.query('select * from raw_items where source_code=$1 and source_unique_id=$2',['sec_edgar',accession])).rows[0];
    if(raw) writeFileSync(`${out}/live-raw-${accession}.json`,JSON.stringify(raw,null,2));
    const {readEffectNotice}=await import('../lib/sec-effect/source.ts');
    console.log(JSON.stringify({ok:result.ok,stage:result.stage,stats:result.stats,error:'error' in result?result.error:null,
      raw:raw?{id:raw.id,accession:raw.source_unique_id,cik:raw.raw_payload.cik,file:raw.raw_payload.file_number,form:raw.raw_payload.form_type,
        documents:raw.raw_payload.documents?.map((d:any)=>({url:d.url,type:d.type,status:d.fetchStatus,original:!!d.effectOriginalSource,chars:d.textCharCount})),notice:form==='EFFECT'?readEffectNotice(raw):undefined}:null}));
  }else if(mode==='analyze'||mode==='concurrent'){
    const {runSecFilingAnalysisIngest}=await import('../lib/secFilingAnalysisIngest.ts');
    const results=await Promise.all(Array.from({length:mode==='concurrent'?6:1},()=>runSecFilingAnalysisIngest({accessionNumber:accession,force:true})));
    writeFileSync(`${out}/live-analysis-${accession}-${Date.now()}.json`,JSON.stringify(results,null,2));
    for(const result of results){
      const effect=(result as any).effectMonitorExecution;
      assert.equal(result.ok,true);assert.equal(effect?.status,'completed');assert.equal(effect.failedCount,0);
      console.log(JSON.stringify({ok:result.ok,stage:result.stage,created:effect.createdCount,existing:effect.existingCount,failed:effect.failedCount}));
    }
  }else throw new Error('Unknown verification mode');
}finally{await db.end()}
