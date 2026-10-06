// DXL product execution only. Never import experimental AI outputs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {resolve} from 'node:path';
import {connect,insertRaw} from '../tender-product/local.mjs';
import {fixture,ids,namespace,accession,condition} from './fixture.mjs';
import {hash,stable,buildTenderBinding} from '../../lib/sec-tender/source.ts';
import {buildTenderStructuredRequest} from '../../lib/sec-tender/contract.ts';
import {readTenderStructured,tenderRepository} from '../../lib/sec-tender/persistence.ts';
import {enqueueTenderStructured,processTenderStructured} from '../../lib/sec-tender/runtime.ts';
import {readCurrentTenderFacts} from '../../lib/monitor/tenderStructuredFacts.ts';
import {evaluateListingMonitorEvent} from '../../lib/listingMonitorMatcher.ts';
import {consumeListingMonitorAlertsForEvent} from '../../lib/monitor/listingMonitorAlertConsumer.ts';
import {runSecRawIngest} from '../../lib/secIngest.ts';
const out=resolve('scripts/tender-price-change/artifacts'),mode=process.argv[2],raw=fixture(),db=await connect();
const read=name=>JSON.parse(fs.readFileSync(resolve(out,name+'.json'),'utf8'));
const save=(name,data)=>fs.writeFileSync(resolve(out,name+'.json'),JSON.stringify(data,null,2)+'\n',{flag:'wx'});
const descriptor=()=>JSON.parse(fs.readFileSync('app/.well-known/workflow/v1/manifest.json','utf8')).workflows['workflows/tender-structured.ts'].tenderStructuredWorkflow;
async function digests(){
 const result={};
 for(const [table,predicate,param]of [
  ['raw_items','id<>$1',ids.raw],['events','id<>$1',ids.event],['auth.users','id<>$1',ids.user],['user_profiles','id<>$1',ids.user],['listing_monitors','id<>$1',ids.monitor],
  ['ai_runs','id<>$1',read('frozen').executionId],['ai_outputs','ai_run_id<>$1',read('frozen').executionId],['user_alert_deliveries','alert_event_id is distinct from $1::uuid',ids.event],
 ])result[table]=(await db.query(`select count(*)::int n,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by id),'')) digest from ${table} t where ${predicate}`,[param])).rows[0];
 return result;
}
async function checkAlerts(){
 const rows=(await db.query('select * from user_alert_deliveries where alert_event_id=$1',[ids.event])).rows;
 assert.equal(rows.length,1);assert.equal(rows[0].user_id,ids.user);assert.equal(rows[0].listing_monitor_id,ids.monitor);assert.deepEqual(rows[0].delivered_channels,[]);assert.equal(rows[0].sent_at,null);return rows;
}
try{
 if(mode==='preflight'){
  assert.equal((await db.query("select count(*)::int n from raw_items where source_code='sec_edgar' and source_unique_id=$1",[accession])).rows[0].n,0);
  assert.equal((await db.query("select count(*)::int n from ai_runs where prompt_key='sec_tender_structured' and metadata->'binding'->>'accession'=$1",[accession])).rows[0].n,0);
  const funcs=(await db.query("select proname,prosecdef from pg_proc where proname in ('reserve_sec_tender_structured','sec_tender_transition','finish_sec_tender_structured')")).rows;assert.equal(funcs.length,3);assert.ok(funcs.every(f=>!f.prosecdef));
  assert.equal((await db.query("select count(*)::int n from pg_indexes where indexname in ('sec_tender_execution_once','sec_tender_accession_once','sec_tender_output_once')")).rows[0].n,3);
  assert.equal(hash(JSON.stringify(buildTenderStructuredRequest(buildTenderBinding(raw).providerSource))),read('frozen').requestHash);
  save('before',await digests());save('db-preflight',{pass:true,local:true,migrationNeeded:false,functions:funcs,uniqueIndexes:3,existingDxlProductExecutions:0,actualProviderCalls:0});console.log('DB/source preflight PASS');
 }else if(mode==='run'){
  assert.equal(read('preflight').pass,true);assert.equal(read('source-review').pass,true);assert.equal(read('db-preflight').pass,true);
  assert.equal(hash(JSON.stringify(buildTenderStructuredRequest(buildTenderBinding(raw).providerSource))),read('frozen').requestHash);
  assert.ok(!fs.existsSync(resolve(out,'physical-call-started.json')));
  save('permit',{maxCalls:1,purpose:'DXL unchanged four-slot product analyzer through real Workflow; deterministic price-change Monitor E2E',stop:'Semantic error => MODEL_ERROR and STOP. Downstream errors replay durable response; no second provider call.'});
  await db.query('begin');
  await db.query("insert into auth.users(id,email,role,aud,created_at,updated_at,raw_app_meta_data,raw_user_meta_data) values($1,$2,'authenticated','authenticated',now(),now(),$3,$3)",[ids.user,namespace+'@example.test',{synthetic:true,verification:namespace}]);
  await db.query('insert into user_profiles(id,email) values($1,$2)',[ids.user,namespace+'@example.test']);
  await db.query("insert into listing_monitors(id,user_id,conditions,created_at,updated_at,is_active) values($1,$2,$3,'2026-01-01T00:00:00Z',now(),true)",[ids.monitor,ids.user,JSON.stringify([condition])]);
  await db.query('commit');save('synthetic',{...ids,namespace,condition,monitorCreatedAt:'2026-01-01T00:00:00Z',filedAt:raw.published_at});
  const {start}=await import('workflow/api');save('workflow-descriptor',descriptor());
  const result=await runSecRawIngest({}, {
   fetchRawItems:async()=>({ok:true,status:200,items:[raw],diagnostics:{documentsRequested:0,documentsFetched:0,documentsFailed:0}}),ensureSource:async()=>({}),createSourceRun:async()=>'running',finishSourceRun:async()=>{},findExistingRawItem:async()=>null,
   saveRawItem:async()=>{const saved=await insertRaw(db,raw);await db.query("insert into events(id,raw_item_id,source_code,source_group,source_url,published_at,ticker,event_type,score,delivery_level,title,metadata,impact,signal,group_dedupe_key) values($1,$2,'sec_edgar','filings',$3,$4,null,'other',0,'archive','SYNTHETIC DXL Tender price change E2E',$5,'low','neutral',$6)",[ids.event,saved.id,saved.source_url,saved.published_at,{synthetic:true,verification:namespace,source_only:true},namespace]);return saved;},
   enqueueTenderStructured:id=>enqueueTenderStructured(id,{start:job=>start({workflowId:descriptor().workflowId},[job])}),
  });save('ingest',result);assert.equal(result.ok,true,JSON.stringify(result));const enqueued=result.items[0].tender_structured;save('enqueue',enqueued);assert.equal(enqueued.status,'enqueued');console.log(JSON.stringify(enqueued));
 }else if(mode==='check'){
  const {getRun,start}=await import('workflow/api'),enqueued=read('enqueue'),run=getRun(enqueued.workflowRunId),status=await run.status;
  if(status!=='completed'){console.log(JSON.stringify({status}));process.exitCode=2;}
  else{
   save('workflow',{runId:enqueued.workflowRunId,status,result:await run.returnValue});
   const stored=(await db.query('select * from ai_runs where id=$1',[enqueued.executionId])).rows[0];save('ai-run',stored);
   const outputs=(await db.query('select * from ai_outputs where ai_run_id=$1',[enqueued.executionId])).rows;save('ai-outputs',outputs);assert.equal(outputs.length,1);
   const wire=JSON.parse(outputs[0].payload.outputText);save('wire',wire);
   const semantic=wire.offer_price?.current?.amount===.84&&wire.offer_price?.current?.currency_text==='$'&&wire.offer_price?.previous?.amount===.82&&wire.offer_price?.previous?.currency_text==='$'&&wire.board_recommendation?.current==='reject'&&wire.board_recommendation?.previous===null&&wire.offer_status===null&&wire.final_results_observed===null;
   if(!semantic){save('result',{pass:false,failureClass:'MODEL_ERROR',physicalCalls:read('transport').physicalCalls,wire});console.log('MODEL_ERROR STOP');process.exitCode=3;}
   else{
    const current=await readTenderStructured(ids.raw);save('reader',current);assert.equal(current.status,'available');save('canonical',current.canonical);
    const facts=await readCurrentTenderFacts(ids.event);save('facts',facts);assert.equal(facts.status,'available');assert.equal(facts.facts.offer_price_change,'changed');
    const matcher=await evaluateListingMonitorEvent({eventId:ids.event,conditionSets:[{id:ids.monitor,conditions:[condition]}],evaluationDate:'2026-10-07'});save('matcher',matcher);assert.equal(matcher.evaluations[0].result.status,'match');save('alerts',await checkAlerts());
    const carlyle=JSON.parse(fs.readFileSync('scripts/tender-product/artifacts/synthetic.json','utf8'));
    const carlyleFacts=await readCurrentTenderFacts(carlyle.eventId);assert.equal(carlyleFacts.status,'available');assert.equal(carlyleFacts.facts.offer_price_change,null);assert.equal(carlyleFacts.facts.final_results_observed,true);
    const regression=await consumeListingMonitorAlertsForEvent({eventId:carlyle.eventId,conditionFamily:'tender'});assert.equal(regression.createdCount,0);assert.equal(regression.failedCount,0);assert.equal(regression.evaluations.find(e=>e.monitorId===ids.monitor).status,'ineligible');
    assert.equal((await db.query('select count(*)::int n from user_alert_deliveries where alert_event_id=$1 and listing_monitor_id=$2',[carlyle.eventId,ids.monitor])).rows[0].n,0);save('carlyle-regression',{facts:carlyleFacts,consumer:regression,priceChangeAlerts:0});
    const duplicate=await enqueueTenderStructured(ids.raw,{start:async()=>{throw Error('Duplicate must not start');}});assert.equal(duplicate.status,'duplicate');
    const repeated=await processTenderStructured({rawItemId:ids.raw,executionId:enqueued.executionId},{repository:await tenderRepository(),apiKey:'checkpoint-only',fetchImpl:async()=>{throw Error('No extra provider call');}});assert.equal(repeated.status,'succeeded');
    const replay=await start({workflowId:descriptor().workflowId},[{rawItemId:ids.raw,executionId:enqueued.executionId}]);save('replay',{runId:replay.runId,duplicate,repeated});console.log(JSON.stringify({semantic:'PASS',replay:replay.runId}));
   }
  }
 }else if(mode==='final'){
  const {getRun}=await import('workflow/api'),run=getRun(read('replay').runId);assert.equal(await run.status,'completed');save('replay-workflow',{runId:read('replay').runId,status:await run.status,result:await run.returnValue});
  const current=await readTenderStructured(ids.raw);assert.equal(current.status,'available');assert.deepEqual(current.canonical,read('canonical'));
  assert.equal((await readCurrentTenderFacts(ids.event)).facts.offer_price_change,'changed');await checkAlerts();
  assert.equal((await db.query('select count(*)::int n from ai_outputs where ai_run_id=$1',[read('enqueue').executionId])).rows[0].n,1);
  assert.equal((await db.query("select count(*)::int n from ai_runs where raw_item_id=$1 and prompt_key='sec_tender_structured'",[ids.raw])).rows[0].n,1);
  const after=await digests();save('after',after);assert.deepEqual(after,read('before'));assert.equal(read('transport').physicalCalls,1);
  save('result',{pass:true,failureClass:null,physicalCalls:1,additionalCalls:0,aiRuns:1,aiOutputs:1,alertRows:1,reader:'available',matcher:'match',priceChange:'changed',canonicalHash:hash(stable(current.canonical)),replay:'completed',existingDataDigestsUnchanged:true});console.log(JSON.stringify(read('result')));
 }else throw Error('Mode required');
}finally{await db.query('rollback').catch(()=>{});await db.end();}
