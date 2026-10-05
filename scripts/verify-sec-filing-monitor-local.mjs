// Existing local DB only; random test identities, one transaction, always rolled back.
// Real metadata reader / Monitor API parser / persistence / matcher / alert writer.
// Only the Supabase transport is adapted to this transaction; no LLM or HTTP calls.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {registerHooks} from 'node:module';
import pg from 'pg';
const config=readFileSync(new URL('../supabase/config.toml',import.meta.url),'utf8');
const port=Number(config.match(/^\[db\][\s\S]*?^port\s*=\s*(\d+)/m)?.[1]);
assert.ok(port);
const db=new pg.Client({host:'127.0.0.1',port,user:'postgres',password:'postgres',database:'postgres',connectionTimeoutMillis:5000});
globalThis.fetch=()=>{throw Error('Network/provider calls forbidden');};
const q=s=>{assert.match(s,/^[a-z_][a-z0-9_]*$/);return `"${s}"`;};
const tables=new Set(['events','raw_items','ai_runs','listing_monitors','user_alert_deliveries']);
const rows=r=>JSON.parse(JSON.stringify(r.rows));
const table=t=>{assert.ok(tables.has(t));return `public.${q(t)}`;};
globalThis.__filingTransaction={
  async supabaseSelect(t,params){
    const values=[],filters=[];
    for(const [k,v] of Object.entries(params))if(!['select','order','limit','offset'].includes(k)){
      assert.ok(v.startsWith('eq.'));values.push(v.slice(3));filters.push(`${q(k)}=$${values.length}`);
    }
    const fields=params.select==='*'?'*':params.select.split(',').map(s=>{
      const m=s.match(/^([a-z_]+):raw_payload->>([a-z_]+)$/);
      return m?`raw_payload->>'${m[2]}' as ${q(m[1])}`:q(s);
    }).join(',');
    const order=params.order?' order by '+params.order.split(',').map(s=>{const [k,dir]=s.split('.');assert.ok(['asc','desc'].includes(dir));return `${q(k)} ${dir}`;}).join(','):'';
    const limit=params.limit?` limit ${Number(params.limit)}`:'';
    return {ok:true,data:rows(await db.query(`select ${fields} from ${table(t)}${filters.length?' where '+filters.join(' and '):''}${order}${limit}`,values))};
  },
  async supabaseUpsert(t,row,options={}){
    const keys=Object.keys(row),values=keys.map(k=>Array.isArray(row[k])&&k==='conditions'?JSON.stringify(row[k]):row[k]);
    const conflict=options.onConflict?` on conflict (${options.onConflict.split(',').map(q).join(',')}) do nothing`:'';
    return {ok:true,data:rows(await db.query(`insert into ${table(t)} (${keys.map(q).join(',')}) values (${keys.map((_,i)=>'$'+(i+1)).join(',')})${conflict} returning *`,values))};
  },
};
const supabaseUrl=new URL('../lib/supabase.ts',import.meta.url).href;
registerHooks({load(url,ctx,next){return url===supabaseUrl?{format:'module',shortCircuit:true,source:
  'export const supabaseSelect=(...a)=>globalThis.__filingTransaction.supabaseSelect(...a); export const supabaseUpsert=(...a)=>globalThis.__filingTransaction.supabaseUpsert(...a);'}:next(url,ctx);}});
const {readEventFilingMetadata,REGISTRATION_FILING_FORMS}=await import('../lib/monitor/eventFilingMetadata.ts');
const {parseListingMonitorCreateRequest}=await import('../lib/monitor/listingMonitorApi.ts');
const {createListingMonitor,readListingMonitorForOwner,listActiveListingMonitorsForOwner}=await import('../lib/monitor/listingMonitorPersistence.ts');
const {consumeListingMonitorAlertsForEvent,createListingMonitorAlert}=await import('../lib/monitor/listingMonitorAlertConsumer.ts');
const {buildSecFilingGroupDedupe}=await import('../lib/secIssuerEventLinkage.ts');
await db.connect();let rolledBack=false;let report;
try{
  const system=(await db.query('select system_identifier from pg_control_system()')).rows[0].system_identifier;
  await db.query('begin');
  const owner=randomUUID(),foreign=randomUUID();
  await db.query('insert into auth.users(id,email) values($1,$2),($3,$4)',[owner,`filing-${owner}@example.test`,foreign,`filing-${foreign}@example.test`]);
  await db.query('insert into public.user_profiles(id,email) values($1,$2),($3,$4)',[owner,`filing-${owner}@example.test`,foreign,`filing-${foreign}@example.test`]);
  const conditions=[{key:'event.sec_form',operator:'in',value:[...REGISTRATION_FILING_FORMS]}];
  const parsed=parseListingMonitorCreateRequest({conditions});assert.ok(parsed.ok);
  const monitor=await createListingMonitor({ownerId:owner,conditions:parsed.value.conditions});
  await db.query("update public.listing_monitors set created_at='2026-01-01T00:00:00Z' where id=$1",[monitor.id]);
  assert.equal((await readListingMonitorForOwner(owner,monitor.id)).status,'available');
  assert.equal((await readListingMonitorForOwner(foreign,monitor.id)).status,'not_found');
  const checks=[];
  for(const [i,form] of REGISTRATION_FILING_FORMS.entries()){
    const rawId=randomUUID(),eventId=randomUUID(),runId=randomUUID();
    const accession=`${String(Date.now()%10000000000).padStart(10,'0')}-26-${String(i+1).padStart(6,'0')}`;
    const payload={form_type:form,accession_number:accession,cik:'1',filing_date:'2026-06-01',primary_document_url:`https://www.sec.gov/Archives/edgar/data/1/${accession.replaceAll('-','')}/filing.htm`};
    await db.query("insert into public.raw_items(id,source_code,source_group,source_unique_id,raw_payload) values($1,'sec_edgar','filings',$2,$3)",[rawId,accession,payload]);
    const raw={id:rawId,source_unique_id:accession,raw_payload:payload};
    const key=buildSecFilingGroupDedupe(raw).groupDedupeKey;
    assert.equal(key,buildSecFilingGroupDedupe({...raw,title:'changed Primary title'}).groupDedupeKey);
    await db.query("insert into public.events(id,raw_item_id,source_code,source_group,event_type,score,delivery_level,impact,signal,title,group_dedupe_key) values($1,$2,'sec_edgar','filings','other',0,'archive','low','neutral','Isolated filing metadata verification',$3)",[eventId,rawId,key]);
    await db.query("insert into public.ai_runs(id,event_id,raw_item_id,prompt_key,prompt_version,model,status,started_at,finished_at) values($1,$2,$3,'sec_s4_f4_analysis','v1','offline-fixture','completed',now(),now())",[runId,eventId,rawId]);
    const metadata=await readEventFilingMetadata(eventId);assert.equal(metadata.status,'available');assert.equal(metadata.facts.form,form);
    const deps={readFilingMetadata:readEventFilingMetadata,listActiveMonitors:()=>listActiveListingMonitorsForOwner(owner),createAlert:createListingMonitorAlert,now:()=>new Date('2026-06-02')};
    const first=await consumeListingMonitorAlertsForEvent({eventId,conditionFamily:'filing'},deps);
    assert.equal(first.createdCount,1,JSON.stringify(first));assert.equal(first.failedCount,0);
    const replay=await consumeListingMonitorAlertsForEvent({eventId,conditionFamily:'filing'},deps);assert.equal(replay.existingCount,1);
    const alerts=(await db.query('select title,source_label,count(*) over() as n from public.user_alert_deliveries where listing_monitor_id=$1 and alert_event_id=$2',[monitor.id,eventId])).rows;
    assert.equal(alerts.length,1);assert.ok(alerts[0].title.startsWith(form+' registration'));assert.equal(alerts[0].source_label,'SEC Filing Monitor');
    // Exercise the actual uniqueness constraints without aborting the outer transaction.
    await db.query('savepoint duplicate_event');
    await assert.rejects(db.query("insert into public.events(id,raw_item_id,source_code,source_group,event_type,score,delivery_level,impact,signal,title,group_dedupe_key) values($1,$2,'sec_edgar','filings','other',0,'archive','low','neutral','duplicate',$3)",[randomUUID(),rawId,key]),e=>e.code==='23505');
    await db.query('rollback to savepoint duplicate_event');
    checks.push({form,first:first.createdCount,replay:replay.existingCount,duplicateEventRejected:true,title:alerts[0].title});
  }
  report={pass:true,systemIdentifier:system,port,checks,ownerIsolation:true,providerCalls:0,networkCalls:0,transport:'PostgreSQL transaction adapter for unchanged Supabase transport interface; not browser/HTTP E2E'};
}finally{await db.query('rollback');rolledBack=true;await db.end();}
console.log(JSON.stringify({...report,rolledBack},null,2));
