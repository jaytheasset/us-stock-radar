// Bounded synthetic acceptance fixture. Existing rows and timestamps are never changed.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync,mkdirSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
import {registerHooks} from 'node:module';
import pg from 'pg';
registerHooks({resolve(s,c,next){return s==='server-only'?{shortCircuit:true,url:'data:text/javascript,export{}'}:next(s,c);}});
const [mode,outDir,retainedDir]=process.argv.slice(2);assert.ok(['before','seed','run','check'].includes(mode));
const out=resolve(outDir),retained=resolve(retainedDir);mkdirSync(out,{recursive:true});
const json=name=>JSON.parse(readFileSync(resolve(out,name),'utf8'));
const save=(name,value)=>writeFileSync(resolve(out,name),JSON.stringify(value,null,2));
const cli=JSON.parse(execFileSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
assert.equal(new URL(cli.DB_URL).hostname,'127.0.0.1');assert.equal(new URL(cli.DB_URL).port,'56322');
process.env.SUPABASE_URL=cli.API_URL;process.env.SUPABASE_SECRET_KEY=cli.SECRET_KEY||cli.SERVICE_ROLE_KEY;
process.env.WORKFLOW_LOCAL_BASE_URL='http://127.0.0.1:3115';process.env.WORKFLOW_LOCAL_DATA_DIR=resolve('.next/workflow-data');
const {buildProxySource,hash,stable}=await import('../lib/sec-proxy/source.ts');
const {proxyRepository,readProxyStructured,readProxyAccession}=await import('../lib/sec-proxy/persistence.ts');
const {readCurrentProxyFacts}=await import('../lib/monitor/proxyStructuredFacts.ts');
const {runProxyProposalRouting}=await import('../lib/sources/sec/forms/proxy/proposalRouting.ts');
const {enqueueProxyStructured}=await import('../lib/sec-proxy/starter.ts');
const {evaluateListingMonitorEvent}=await import('../lib/listingMonitorMatcher.ts');
const db=new pg.Client({connectionString:cli.DB_URL});await db.connect();
async function existing(){return {
 monitors:(await db.query('select id,md5(to_jsonb(m)::text) digest from listing_monitors m order by id')).rows,
 accounts:(await db.query('select id,md5(to_jsonb(u)::text) digest from auth.users u order by id')).rows,
 historical:(await db.query("select id,md5(to_jsonb(r)::text) digest from raw_items r where id in ('d0c8967a-754d-417c-8fd0-d86c404eaf89','83ff0eba-f4ee-430a-a9c0-26bf84096658') order by id")).rows,
};}
try{
 assert.equal((await db.query('select system_identifier::text id from pg_control_system()')).rows[0].id,'7678429483712069671');
 if(mode==='before'){
  assert.ok(!existsSync(resolve(out,'before.json')),'Preserve original baseline');save('before.json',await existing());console.log('Existing monitors/accounts/historical raw digests captured');
 }else if(mode==='seed'){
  assert.ok(!existsSync(resolve(out,'synthetic.json')),'One synthetic fixture only');
  const prior=json('before.json');
  const added=(await db.query('select * from listing_monitors order by created_at')).rows.filter(m=>!prior.monitors.some(p=>p.id===m.id));
  assert.equal(added.length,1,'Exactly one browser-created monitor required');const monitor=added[0];
  assert.equal(monitor.user_id,'d2f2c6ce-64fa-40d6-a0b6-7e42e1fa0d32');assert.equal(monitor.is_active,true);
  assert.deepEqual(monitor.conditions,[{key:'proxy.has_capital_structure_proposal',operator:'eq',value:true},{key:'proxy.has_proposal',operator:'eq',value:true}]);
  const original=(await db.query("select * from raw_items where id='d0c8967a-754d-417c-8fd0-d86c404eaf89'")).rows[0];
  const accepted=(await db.query('select clock_timestamp() at')).rows[0].at.toISOString();assert.ok(Date.parse(accepted)>Date.parse(monitor.created_at));
  const accession='9999999999-26-000001',sourceUrl='https://example.invalid/synthetic-proxy-merge-gate';
  const payload={...original.raw_payload,accession_number:accession,cik:'9999999999',ticker:'PXGATE',company_name:'SYNTHETIC Proxy Merge Gate',
    accepted_at:accepted,filing_date:accepted.slice(0,10),primary_document_url:sourceUrl};
  const metadata={verification:'proxy-merge-gates-20261005',synthetic:true,derived_text_from_raw_id:original.id};
  await db.query('begin');
  const raw=(await db.query(`insert into raw_items(source_code,source_group,source_unique_id,source_url,title,published_at,body_text,analysis_text,raw_payload,metadata,dedupe_key)
    values('sec_edgar','filings',$1,$2,'SYNTHETIC Proxy merge gate',$3,$4,$4,$5,$6,$7) returning *`,[accession,sourceUrl,accepted,original.body_text,payload,metadata,'synthetic-proxy:'+accession])).rows[0];
  const input=buildProxySource(raw),old=buildProxySource(original);
  assert.deepEqual(input.source.evidenceBlocks.map(({documentId,...b})=>b),old.source.evidenceBlocks.map(({documentId,...b})=>b));
  const stages={};let index=0;
  const routed=await runProxyProposalRouting({apiKey:'saved-response-only',sourcePackage:input.source,formType:input.formType,fetchImpl:async(url,init)=>{
    const stage=++index===1?'call1':'call2',response=resolve(retained,`fresh-Alternus-${stage}-response.json`);
    stages[stage]={model:stage==='call1'?'gemini-2.5-flash-lite':'gemini-3.5-flash',requestHash:hash(String(init.body)),response};
    return new Response(readFileSync(response,'utf8'),{status:200});
  }});assert.ok(routed.ok,JSON.stringify(routed.error));assert.ok(routed.call2.run.validation.value.items.some(x=>x.is_proposal&&x.category==='capital_structure'));
  const event=(await db.query(`insert into events(raw_item_id,source_code,source_group,source_url,published_at,ticker,event_type,score,delivery_level,title,metadata,impact,signal,group_dedupe_key)
    values($1,'sec_edgar','filings',$2,$3,'PXGATE','shareholder_vote',0,'archive','SYNTHETIC Proxy merge gate',$4,'low','neutral',$5) returning id`,[raw.id,sourceUrl,accepted,{...metadata,source_only:true},'synthetic-proxy-event:'+accession])).rows[0];
  await db.query('commit');save('automatic-transport.json',{stages});save('synthetic.json',{rawItemId:raw.id,eventId:event.id,executionId:input.executionId,accession,monitorId:monitor.id,monitorCreatedAt:monitor.created_at,acceptedAt:accepted,blocks:input.source.evidenceBlocks.length,canonicalHash:hash(stable(routed.call2.run.validation.value))});
  console.log(JSON.stringify(json('synthetic.json')));
 }else{
  const fixture=json('synthetic.json'),repo=await proxyRepository();
  if(mode==='run'){
   const {start,getRun}=await import('workflow/api');const descriptor=JSON.parse(readFileSync('app/.well-known/workflow/v1/manifest.json','utf8')).workflows['workflows/proxy-structured.ts'].proxyStructuredWorkflow;
   const startJob=job=>start({workflowId:descriptor.workflowId},[job]);
   const queued=existsSync(resolve(out,'automatic-enqueue.json'))?json('automatic-enqueue.json'):await enqueueProxyStructured(fixture.rawItemId,{start:startJob});
   assert.equal(queued.status,'enqueued');save('automatic-enqueue.json',queued);
   const wait=async id=>{const run=getRun(id);for(let i=0;i<150;i++){const status=await run.status;if(['completed','failed','cancelled'].includes(status)){assert.equal(status,'completed');assert.equal((await run.returnValue).status,'succeeded');return;}await new Promise(r=>setTimeout(r,1000));}throw Error('workflow timeout');};
   await wait(queued.workflowRunId);
   const first=(await db.query('select id,listing_monitor_id,alert_event_id,listing_source_execution_id,source_label,delivered_channels,sent_at from user_alert_deliveries where alert_event_id=$1 order by id',[fixture.eventId])).rows;
   assert.equal(first.filter(a=>a.listing_monitor_id===fixture.monitorId).length,1);save('automatic-first-alerts.json',first);
   assert.equal((await enqueueProxyStructured(fixture.rawItemId,{start:startJob})).status,'duplicate');
   const repeated=await startJob({rawItemId:fixture.rawItemId,executionId:fixture.executionId});await wait(repeated.runId);save('automatic-replay-workflow.json',{runId:repeated.runId});
   const second=(await db.query('select id,listing_monitor_id,alert_event_id,listing_source_execution_id,source_label,delivered_channels,sent_at from user_alert_deliveries where alert_event_id=$1 order by id',[fixture.eventId])).rows;assert.deepEqual(second,first);
  }
  const read=await readProxyStructured(fixture.rawItemId,repo);assert.equal(read.status,'available');assert.equal(read.binding.attempt,'automatic');assert.equal(hash(stable(read.canonical)),fixture.canonicalHash);
  assert.equal((await readProxyAccession(fixture.accession,repo)).status,'available');assert.equal((await readCurrentProxyFacts(fixture.eventId,repo)).status,'available');
  const conditions=(await db.query('select conditions from listing_monitors where id=$1',[fixture.monitorId])).rows[0].conditions;
  const matched=await evaluateListingMonitorEvent({eventId:fixture.eventId,evaluationDate:new Date().toISOString().slice(0,10),conditionSets:[{id:fixture.monitorId,conditions}]});
  const match=matched.evaluations[0].result;assert.equal(match.status,'match');
  const alerts=(await db.query('select id,listing_monitor_id,listing_source_execution_id,delivered_channels,sent_at from user_alert_deliveries where alert_event_id=$1 order by id',[fixture.eventId])).rows;
  assert.equal(alerts.filter(a=>a.listing_monitor_id===fixture.monitorId).length,1);assert.ok(alerts.every(a=>a.listing_source_execution_id===fixture.executionId&&a.sent_at===null&&a.delivered_channels.length===0));
  const first=json('automatic-first-alerts.json');assert.deepEqual(alerts.map(a=>a.id),first.map(a=>a.id));
  const {getRun}=await import('workflow/api');
  const replay=json('automatic-replay-workflow.json');assert.notEqual(replay.runId,json('automatic-enqueue.json').workflowRunId);
  assert.equal(await getRun(replay.runId).status,'completed');
  assert.equal((await db.query('select count(*)::int n from ai_outputs where ai_run_id=$1',[fixture.executionId])).rows[0].n,1);
  const before=json('before.json'),after=await existing();
  for(const name of ['monitors','historical'])for(const row of before[name])assert.deepEqual(after[name].find(r=>r.id===row.id),row,`${name}:${row.id} unchanged`);
  // The existing signed-in browser may refresh its session. Preserve and report this
  // audit evidence rather than claiming that auth.users was byte-identical.
  const sessionRefresh=[];
  for(const row of before.accounts){
   const current=after.accounts.find(r=>r.id===row.id);assert.ok(current,'Existing account preserved');
   if(current.digest===row.digest)continue;
   const audit=(await db.query("select created_at,payload->>'action' action from auth.audit_log_entries where payload->>'actor_id'=$1 and created_at >= $2 order by created_at",[row.id,statSync(resolve(out,'before.json')).mtime])).rows;
   assert.ok(audit.some(a=>a.action==='token_refreshed'));assert.ok(audit.every(a=>['token_refreshed','token_revoked'].includes(a.action)));
   sessionRefresh.push({accountId:row.id,fullRowDigestChanged:true,audit});
  }
  assert.ok(['call1','call2'].every(s=>json(`automatic-${s}-claim.json`).actualProviderCalls===0));
  const report={passed:true,namespace:read.binding.attempt,worker:'real local durable Workflow',officialRawAccessionEventReaders:'available',matcher:match.status,targetMonitorAlerts:1,totalSyntheticEventAlerts:alerts.length,canonicalOutputs:1,dedupe:true,actualGeminiCalls:0,externalDeliveries:0,existingMonitorsAndHistoricalRawUnchanged:true,sessionRefresh,...fixture};
  save('automatic-alert-report.json',report);console.log(JSON.stringify(report));
 }
}finally{await db.query('rollback').catch(()=>{});await db.end();}
