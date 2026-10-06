import assert from 'node:assert/strict';
import fs from 'node:fs';
import {resolve} from 'node:path';
import {connect,insertRaw} from './local.mjs';
import {fixture,namespace,accession} from './fixture.mjs';
import {buildTenderBinding,hash,stable,TENDER_STRUCTURED_QUERIES} from '../../lib/sec-tender/source.ts';
import {buildTenderStructuredRequest} from '../../lib/sec-tender/contract.ts';
import {tenderRepository,readTenderStructured} from '../../lib/sec-tender/persistence.ts';
import {enqueueTenderStructured,processTenderStructured} from '../../lib/sec-tender/runtime.ts';
import {readCurrentTenderFacts} from '../../lib/monitor/tenderStructuredFacts.ts';
import {evaluateListingMonitorEvent} from '../../lib/listingMonitorMatcher.ts';
import {consumeListingMonitorAlertsForEvent} from '../../lib/monitor/listingMonitorAlertConsumer.ts';
import {runSecRawIngest} from '../../lib/secIngest.ts';
const mode=process.argv[2],out=resolve('scripts/tender-product/artifacts');fs.mkdirSync(out,{recursive:true});
const save=(name,v)=>fs.writeFileSync(resolve(out,name),JSON.stringify(v,null,2)+'\n',{flag:'wx'});
const read=name=>JSON.parse(fs.readFileSync(resolve(out,name),'utf8'));
const userId='b4aff412-a2c2-47e6-af2d-c58efcfdd2ae',monitorId='ed9c0bde-48fd-45e1-a969-5668e4696c3d',eventId='d635af3b-f7c6-410a-8e58-6bf762c831e7';
const condition={key:'tender.final_results_observed',operator:'eq',value:true},raw=fixture();
const db=await connect();
async function digests(){const result={};for(const [table,exclude]of [['raw_items',raw.id],['listing_monitors',monitorId],['auth.users',userId],['events',eventId]]){result[table]=(await db.query(`select count(*)::int n,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by id),'')) digest from ${table} t where id<>$1`,[exclude])).rows[0];}for(const table of ['ai_runs','ai_outputs','user_alert_deliveries']){const predicate=table==='ai_runs'?"prompt_key is distinct from 'sec_tender_structured'":table==='ai_outputs'?"output_type is distinct from 'sec_tender_structured'":"alert_event_id is distinct from '"+eventId+"'::uuid";result[table]=(await db.query(`select count(*)::int n,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by id),'')) digest from ${table} t where ${predicate}`)).rows[0];}return result;}
try{
 if(mode==='prepare'){
  assert.equal((await db.query("select count(*)::int n from raw_items where source_code='sec_edgar' and source_unique_id=$1",[accession])).rows[0].n,0);
  const built=buildTenderBinding(raw),request=buildTenderStructuredRequest(built.providerSource),body=JSON.stringify(request);
  save('before.json',await digests());save('source.json',built.source);save('evidence-map.json',built.evidenceMap);save('request.json',request);
  save('frozen.json',{accession,model:'gemini-3.5-flash',requestHash:hash(body),sourceHash:hash(stable(built.source)),queries:TENDER_STRUCTURED_QUERIES,evidenceCount:built.source.evidence.length,evidenceChars:built.source.evidence.reduce((n,e)=>n+e.text.length,0),providerChars:request.contents[0].parts[0].text.length,promptChars:request.systemInstruction.parts[0].text.length,schemaChars:JSON.stringify(request.generationConfig.responseJsonSchema).length});
  await db.query('begin');
  await db.query("insert into auth.users(id,email,role,aud,created_at,updated_at,raw_app_meta_data,raw_user_meta_data) values($1,$2,'authenticated','authenticated',now(),now(),$3,$3)",[userId,namespace+'@example.test',{synthetic:true,verification:namespace}]);
  await db.query('insert into public.user_profiles(id,email) values($1,$2)',[userId,namespace+'@example.test']);
  await db.query("insert into listing_monitors(id,user_id,conditions,created_at,updated_at,is_active) values($1,$2,$3,'2026-01-01T00:00:00Z',now(),true)",[monitorId,userId,JSON.stringify([condition])]);
  await db.query('commit');save('synthetic.json',{namespace,userId,monitorId,eventId,rawItemId:raw.id,monitorCreatedAt:'2026-01-01T00:00:00Z',filedAt:raw.published_at});console.log(JSON.stringify(read('frozen.json')));
 }else if(mode==='run'||mode==='resume-ingest'){
  assert.equal(read('preflight.json').pass,true);assert.equal(read('database-preflight.json').pass,true);
  const descriptor=JSON.parse(fs.readFileSync('app/.well-known/workflow/v1/manifest.json','utf8')).workflows['workflows/tender-structured.ts'].tenderStructuredWorkflow;assert.ok(descriptor.workflowId);
  const {start}=await import('workflow/api');const built=buildTenderBinding(raw);assert.equal(hash(JSON.stringify(buildTenderStructuredRequest(built.providerSource))),read('frozen.json').requestHash);
  if(mode==='run') save('permit.json',{maxCalls:1,purpose:'Carlyle four-slot source-only durable Workflow E2E',stop:'After this response; semantic error => STOP; downstream recovery uses checkpoint only'});
  if(mode==='resume-ingest') {
   assert.ok(!fs.existsSync(resolve(out,'physical-call-started.json')));
   const saved=(await db.query('select * from raw_items where id=$1',[raw.id])).rows[0];assert.equal(saved.metadata.verification,namespace);
   assert.equal((await db.query("select count(*)::int n from ai_runs where raw_item_id=$1 and prompt_key='sec_tender_structured'",[raw.id])).rows[0].n,0);
   await db.query("insert into events(id,raw_item_id,source_code,source_group,source_url,published_at,ticker,event_type,score,delivery_level,title,metadata,impact,signal,group_dedupe_key) values($1,$2,'sec_edgar','filings',$3,$4,null,'other',0,'archive','SYNTHETIC Carlyle Tender E2E',$5,'low','neutral',$6)",[eventId,saved.id,saved.source_url,saved.published_at,{synthetic:true,verification:namespace,source_only:true},namespace]);
  }
  const result=await runSecRawIngest({}, {
   fetchRawItems:async()=>({ok:true,status:200,items:[raw],diagnostics:{documentsRequested:0,documentsFetched:0,documentsFailed:0}}),ensureSource:async()=>({}),createSourceRun:async()=>'running',finishSourceRun:async()=>{},
   findExistingRawItem:async()=>mode==='resume-ingest'?(await db.query('select * from raw_items where id=$1',[raw.id])).rows[0]:null,
   saveRawItem:async()=>{const saved=await insertRaw(db,raw);await db.query(`insert into events(id,raw_item_id,source_code,source_group,source_url,published_at,ticker,event_type,score,delivery_level,title,metadata,impact,signal,group_dedupe_key) values($1,$2,'sec_edgar','filings',$3,$4,null,'other',0,'archive','SYNTHETIC Carlyle Tender E2E',$5,'low','neutral',$6)`,[eventId,saved.id,saved.source_url,saved.published_at,{synthetic:true,verification:namespace,source_only:true},namespace]);return saved;},
   enqueueTenderStructured:id=>enqueueTenderStructured(id,{start:job=>start({workflowId:descriptor.workflowId},[job])}),
  });save(mode==='run'?'ingest.json':'ingest-recovered.json',result);assert.equal(result.ok,true);const enqueued=result.items[0].tender_structured;save('enqueue.json',enqueued);assert.equal(enqueued.status,'enqueued',JSON.stringify(enqueued));console.log(JSON.stringify(enqueued));
 }else if(mode==='recover-profile'){
  const {getRun,start}=await import('workflow/api'),original=read('enqueue.json');
  assert.equal(await getRun(original.workflowRunId).status,'failed');
  const repo=await tenderRepository(),current=await readTenderStructured(raw.id,repo);
  assert.equal(current.status,'available');
  const wire=JSON.parse(read('provider-response.json').candidates[0].content.parts[0].text);
  assert.deepEqual(wire,{offer_price:null,board_recommendation:null,offer_status:null,final_results_observed:{evidence_refs:['E10']}});
  const failure=await consumeListingMonitorAlertsForEvent({eventId,conditionFamily:'tender'});
  assert.equal(failure.failedCount,1);assert.match(failure.writes[0].error,/user_alert_deliveries_user_id_fkey/);
  save('failed-workflow.json',{...original,status:'failed',failureClass:'TEST_HARNESS_ERROR',failure});
  const profileDigest=async()=> (await db.query("select count(*)::int n,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by id),'')) digest from user_profiles t where id<>$1",[userId])).rows[0];
  const before=await profileDigest();
  assert.equal((await db.query('select count(*)::int n from user_profiles where id=$1',[userId])).rows[0].n,0);
  await db.query('insert into public.user_profiles(id,email) values($1,$2)',[userId,namespace+'@example.test']);
  assert.deepEqual(await profileDigest(),before);save('profile-recovery.json',{before,after:await profileDigest(),syntheticUserId:userId,productChanges:0,providerCalls:0});
  const desc=JSON.parse(fs.readFileSync('app/.well-known/workflow/v1/manifest.json','utf8')).workflows['workflows/tender-structured.ts'].tenderStructuredWorkflow;
  const run=await start({workflowId:desc.workflowId},[{rawItemId:raw.id,executionId:original.executionId}]);
  save('recovery.json',{...original,workflowRunId:run.runId,originalWorkflowRunId:original.workflowRunId});console.log(JSON.stringify({recoveryWorkflow:run.runId}));
 }else if(mode==='check'){
  const {getRun,start}=await import('workflow/api'),enqueued=read(fs.existsSync(resolve(out,'recovery.json'))?'recovery.json':'enqueue.json'),workflow=getRun(enqueued.workflowRunId),status=await workflow.status;
  if(status!=='completed'){console.log(JSON.stringify({workflowStatus:status}));process.exitCode=2;}
  else{
   const result=await workflow.returnValue;save('workflow.json',{runId:enqueued.workflowRunId,status,result});
   const repo=await tenderRepository(),current=await readTenderStructured(raw.id,repo);save('reader.json',current);
   const stored=(await db.query('select * from ai_runs where id=$1',[enqueued.executionId])).rows[0];save('ai-run.json',stored);const outputs=(await db.query('select * from ai_outputs where ai_run_id=$1',[stored.id])).rows;save('ai-outputs.json',outputs);
   assert.equal(current.status,'available',JSON.stringify(current));const wire=JSON.parse(outputs[0].payload.outputText);save('wire.json',wire);save('canonical.json',current.canonical);
   const semantic=wire.offer_price===null&&wire.board_recommendation===null&&wire.offer_status===null&&wire.final_results_observed!==null&&current.canonical.facts.length===1&&current.canonical.facts[0].type==='final_results_observed';
   if(!semantic){save('result.json',{pass:false,failureClass:'MODEL_ERROR',physicalCalls:1});console.log('MODEL_ERROR: STOP, no second call');}
   else{
    const facts=await readCurrentTenderFacts(eventId,repo);save('facts.json',facts);const match=await evaluateListingMonitorEvent({eventId,conditionSets:[{id:monitorId,conditions:[condition]}],evaluationDate:'2026-10-07'});save('matcher.json',match);assert.equal(match.evaluations[0].result.status,'match');
    const initialAlerts=(await db.query('select * from user_alert_deliveries where alert_event_id=$1',[eventId])).rows;assert.equal(initialAlerts.length,1);assert.equal(initialAlerts[0].listing_monitor_id,monitorId);assert.deepEqual(initialAlerts[0].delivered_channels,[]);assert.equal(initialAlerts[0].sent_at,null);save('alerts.json',initialAlerts);
    const duplicate=await enqueueTenderStructured(raw.id,{start:async()=>{throw Error('Duplicate must not start');}});assert.equal(duplicate.status,'duplicate');
    const repeated=await processTenderStructured({rawItemId:raw.id,executionId:stored.id},{repository:repo,fetchImpl:async()=>{throw Error('No second provider call');},apiKey:'checkpoint-only'});assert.equal(repeated.status,'succeeded');
    const desc=JSON.parse(fs.readFileSync('app/.well-known/workflow/v1/manifest.json','utf8')).workflows['workflows/tender-structured.ts'].tenderStructuredWorkflow;
    const replay=await start({workflowId:desc.workflowId},[{rawItemId:raw.id,executionId:stored.id}]);save('replay.json',{runId:replay.runId,duplicate,repeated});console.log(JSON.stringify({status:'semantic PASS',replayWorkflow:replay.runId}));
   }
  }
 }else if(mode==='final'){
  const {getRun}=await import('workflow/api'),replay=read('replay.json');assert.equal(await getRun(replay.runId).status,'completed');
  const repo=await tenderRepository(),readback=await readTenderStructured(raw.id,repo);assert.equal(readback.status,'available');assert.equal(hash(stable(readback.canonical)),hash(stable(read('canonical.json'))));
  assert.equal((await db.query("select count(*)::int n from ai_runs where raw_item_id=$1 and prompt_key='sec_tender_structured'",[raw.id])).rows[0].n,1);
  assert.equal((await db.query("select count(*)::int n from ai_outputs where ai_run_id=$1",[readback.sourceExecutionId])).rows[0].n,1);
  const alerts=(await db.query('select * from user_alert_deliveries where alert_event_id=$1',[eventId])).rows;assert.equal(alerts.length,1);assert.deepEqual(alerts[0].delivered_channels,[]);assert.equal(alerts[0].sent_at,null);
  const after=await digests();save('after.json',after);assert.deepEqual(after,read('before.json'));
  const result={pass:true,failureClass:null,physicalCalls:read('transport.json').physicalCalls,additionalProviderCalls:0,aiRuns:1,aiOutputs:1,reader:'available',matcher:'match',alertRows:1,deliveredChannels:[],sentAt:null,duplicateEnqueue:'duplicate',replayWorkflow:'completed',canonicalHash:hash(stable(readback.canonical)),existingRowDigestsUnchanged:true};save('result.json',result);console.log(JSON.stringify(result));
 }else throw Error('mode');
}finally{await db.query('rollback').catch(()=>{});await db.end();}
