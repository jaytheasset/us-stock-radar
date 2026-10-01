// Explicit isolated DB integration check. Parent Primary records are labelled test
// fixtures, never fabricated provider results. Real retained SEC source is unchanged.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const required=k=>{if(!process.env[k])throw Error(`Missing ${k}`);return process.env[k];};
const url=required('FORM25_TEST_DB_URL');const endpoint=new URL(url);
assert.equal(endpoint.hostname,'127.0.0.1');assert.equal(endpoint.port,'57322');
assert.equal(process.env.SUPABASE_URL,'http://127.0.0.1:57321');
const out=required('FORM25_TEST_EVIDENCE_DIR');fs.mkdirSync(out,{recursive:true});
const save=(name,x)=>fs.writeFileSync(path.join(out,name),JSON.stringify(x,null,2)+'\n');
const sha=x=>createHash('sha256').update(x).digest('hex');
const uuid=s=>{const h=sha(s);return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;};
const pg=new (createRequire(import.meta.url)('pg').Client)({connectionString:url});
const {supabaseSelect,supabaseUpsert}=await import('../lib/supabase.ts');
const {buildGenericMonitorPrimaryExecutionContext,enqueueGenericMonitorChildrenAfterPrimary}=await import('../lib/monitor/genericMonitorChildWorkflowStarter.ts');
const {genericMonitorChildRepository}=await import('../lib/monitor/genericMonitorChildSupabaseRepository.ts');
const {processGenericMonitorChild}=await import('../lib/monitor/genericMonitorChildRuntime.ts');
const {readCurrentListingRiskFacts}=await import('../lib/monitor/listingRiskPersistence.ts');
const {evaluateListingMonitorConditions,evaluateListingMonitorEvent}=await import('../lib/listingMonitorMatcher.ts');
const {consumeListingMonitorAlertsForEvent}=await import('../lib/monitor/listingMonitorAlertConsumer.ts');
const {createListingMonitor}=await import('../lib/monitor/listingMonitorPersistence.ts');
const {readSecForm25EventIdentity}=await import('../lib/sec-form25-identity/consumption.ts');
const cases=[['TTOO','0001354457-25-000637','confirmed_exchange_delisting'],['FTCH','0000876661-23-001010','removal_pending'],['PLTR','0001321655-24-000231','unresolved']];
const conditions=[{key:'listing.event_kind',operator:'eq',value:'listing_removal'}];
const put=async(table,row)=>{const r=await supabaseUpsert(table,row,{onConflict:'id',prefer:'resolution=ignore-duplicates,return=representation'});assert.ok(r.ok,`${table}: ${r.error}`);};
const reports=[];
await pg.connect();
try {
  assert.equal((await pg.query('select system_identifier::text from pg_control_system()')).rows[0].system_identifier,'7689949482832261158');
  const user=(await pg.query('select id from auth.users order by created_at limit 1')).rows[0];assert.ok(user);
  const monitorId=uuid('form25-secondary-integration-monitor-v1');
  let monitor=(await supabaseSelect('listing_monitors',{select:'*',id:`eq.${monitorId}`})).data?.[0];
  if(!monitor) {
    await createListingMonitor({ownerId:user.id,conditions}, {create:async row=>{const r=await supabaseUpsert('listing_monitors',{...row,id:monitorId},{onConflict:'id'});return r;}});
  }
  for (const [name,accession,expected] of cases) {
    const read=await supabaseSelect('raw_items',{select:'*',source_unique_id:`eq.${accession}`,source_code:'eq.sec_edgar'});
    assert.ok(read.ok);assert.equal(read.data.length,1);const raw=read.data[0];const before=sha(JSON.stringify(raw));
    const eventId=uuid('form25-secondary-test-event-v1:'+accession);const parentId=uuid('form25-secondary-fixture-parent-v1:'+accession);
    const now=new Date().toISOString();
    await put('events',{id:eventId,raw_item_id:raw.id,source_code:'sec_edgar',source_group:'filings',source_url:raw.source_url,published_at:raw.published_at,event_type:'listing_risk',score:0,delivery_level:'archive',impact:'low',signal:'neutral',title:`[Isolated secondary fixture] ${name} ${raw.raw_payload.form_type}`,group_dedupe_key:'form25-secondary-test:'+accession,metadata:{form_type:raw.raw_payload.form_type,fixture_primary_not_model_analysis:true}});
    await put('ai_runs',{id:parentId,event_id:eventId,raw_item_id:raw.id,prompt_key:'sec_form25_analysis_draft',prompt_version:'isolated-parent-fixture-no-provider',model:'fixture-no-provider',status:'completed',started_at:now,finished_at:now,metadata:{test_fixture:true,purpose:'secondary-only integration; Primary not executed'}});
    await put('ai_outputs',{id:uuid('form25-parent-output:'+accession),ai_run_id:parentId,event_id:eventId,output_type:'sec_form25_analysis_draft',payload:{analysis:{},test_fixture:true}});
    const primary=buildGenericMonitorPrimaryExecutionContext({eventId,rawItemId:raw.id,sourceGroup:'filings',sourceCode:'sec_edgar',sourceIdentity:accession,parentPrimaryAiRunId:parentId,parentPromptKey:'sec_form25_analysis_draft',parentPromptVersion:'isolated-parent-fixture-no-provider',secFormType:raw.raw_payload.form_type});
    let child;let runtime;
    const enqueue=await enqueueGenericMonitorChildrenAfterPrimary({primary,primaryAnalysis:{},dependencies:{repository:genericMonitorChildRepository,startWorkflow:async(_,[identity])=>{child=identity;runtime=await processGenericMonitorChild(identity);return {runId:'isolated-direct-runtime:'+identity.executionId};}}});
    if(!child) {
      const {buildGenericMonitorChildIdentities}=await import('../lib/monitor/genericMonitorChildExecution.ts');
      [child]=buildGenericMonitorChildIdentities({primary,monitorRouting:{monitor_routes:[{monitor_analyzer_key:'listing_risk'}]}});
    }
    const current=await readCurrentListingRiskFacts(eventId);
    save(`${name}-stage.json`,{enqueue,runtime,current,child});
    assert.equal(current.status,name==='TTOO'?'available':'not_applicable');assert.equal(current.form25State.listing,expected);
    if(runtime)assert.equal(runtime.providerCalls,0);
    const factCondition=evaluateListingMonitorConditions(current,conditions,{evaluationDate:now.slice(0,10)});
    assert.equal(factCondition.status,name==='TTOO'?'match':'ineligible');
    const identity=await readSecForm25EventIdentity(eventId);
    const evaluation=await evaluateListingMonitorEvent({eventId,evaluationDate:now.slice(0,10),conditionSets:[{id:monitorId,conditions}]});
    const alert=await consumeListingMonitorAlertsForEvent({eventId});
    const replay=await processGenericMonitorChild(child);
    const alertsAgain=await consumeListingMonitorAlertsForEvent({eventId});
    assert.equal(replay.status,'duplicate');assert.equal(replay.providerCalls,0);
    const stored=(await pg.query('select id from user_alert_deliveries where listing_monitor_id=$1 and alert_event_id=$2',[monitorId,eventId])).rows;
    if(identity.status==='blocked'||name!=='TTOO')assert.equal(stored.length,0);else assert.equal(stored.length,1);
    assert.equal(alertsAgain.createdCount,0);
    const counts=(await pg.query('select (select count(*) from event_listing_risk_results where source_execution_id=$1)::int results,(select count(*) from event_listing_risk_facts where source_execution_id=$1)::int facts',[child.executionId])).rows[0];
    assert.deepEqual(counts,{results:1,facts:name==='TTOO'?1:0});
    const after=(await supabaseSelect('raw_items',{select:'*',id:`eq.${raw.id}`})).data[0];assert.equal(sha(JSON.stringify(after)),before);
    const record={name,accession,eventId,parentId,childId:child.executionId,monitorId,parentIsTestFixture:true,workflowScheduler:'same production runtime invoked synchronously by test starter',providerCalls:runtime?.providerCalls??0,enqueue,runtime,readerStatus:current.status,state:current.form25State,factCondition,identity,evaluation,alert,replay,alertsAgain,counts,storedAlertIds:stored.map(x=>x.id),rawUnchanged:true};
    reports.push(record);save(`${name}-result.json`,record);save('e2e-results.json',{target:'127.0.0.1:57322',reports});
  }
  await verifyDatabaseGuards(reports.find(r=>r.name==='TTOO'));
  console.log(JSON.stringify(reports.map(r=>({case:r.name,reader:r.readerStatus,state:r.state.listing,condition:r.factCondition.status,identity:r.identity.status,alerts:r.storedAlertIds.length,providerCalls:r.providerCalls,replay:r.replay.status}))));
}finally{await pg.end();}

// Exercise the real RPC guards; every adversarial change is rolled back.
async function verifyDatabaseGuards(sample) {
  const checks=[];
  const reader=async()=>(await pg.query('select public.read_current_event_listing_risk_facts($1,$2) result',[sample.eventId,'listing_risk_domain_analyzer_v11'])).rows[0].result;
  const writer=async(result)=>(await pg.query('select public.persist_listing_risk_analyzer_result($1,$2,$3::jsonb) result',[sample.eventId,sample.childId,JSON.stringify(result)])).rows[0].result;
  const original=(await pg.query("select payload from ai_outputs where ai_run_id=$1 and output_type='form25_listing_state'",[sample.childId])).rows[0].payload;
  const before=await reader();
  await pg.query('begin');
  try {
    const repeat=await writer(original.result);
    assert.equal(repeat.status,'idempotent');checks.push({case:'identical_persistence',result:repeat});
    for(const kind of ['changed_source','changed_trace','forged_document_url','stale_parent']) {
      await pg.query('savepoint adversarial_case');
      let submitted=original.result;
      if(kind==='changed_source') {
        await pg.query("update raw_items set raw_payload=raw_payload || '{\"test_only_changed_source\":true}'::jsonb where id=(select raw_item_id from events where id=$1)",[sample.eventId]);
      }else if(kind==='changed_trace') {
        await pg.query("update ai_outputs set payload=jsonb_set(payload,'{result}', '{\"status\":\"not_applicable\"}'::jsonb) where ai_run_id=$1 and output_type='form25_listing_state'",[sample.childId]);
      }else if(kind==='forged_document_url') {
        const forged=structuredClone(original);
        forged.result.facts.sources[0].source_url='https://www.sec.gov/Archives/edgar/data/1/not-this-accession.xml';
        submitted=forged.result;
        await pg.query("update ai_outputs set payload=$2::jsonb where ai_run_id=$1 and output_type='form25_listing_state'",[sample.childId,JSON.stringify(forged)]);
      }else {
        await pg.query(`insert into ai_runs(id,event_id,raw_item_id,prompt_key,prompt_version,model,status,started_at,finished_at,metadata)
          select $2,event_id,raw_item_id,prompt_key,prompt_version,model,status,clock_timestamp(),clock_timestamp()+interval '1 minute',metadata
          from ai_runs where id=$1`,[sample.parentId,uuid('form25-rollback-only-newer-parent')]);
      }
      const read=await reader();const write=await writer(submitted);
      assert.equal(read.status,'not_ready',kind);
      assert.ok(['rejected','stale','conflict'].includes(write.status),kind);
      checks.push({case:kind,read,write});
      await pg.query('rollback to savepoint adversarial_case');
    }
  }finally{await pg.query('rollback');}
  assert.deepEqual(await reader(),before);
  save('database-guards.json',{checks,allMutationsRolledBack:true,originalReadbackUnchanged:true});
}
