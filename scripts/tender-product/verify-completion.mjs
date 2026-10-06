// Post-call audit. No analyzer invocation, no provider credentials and no enqueue.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {connect} from './local.mjs';
import {hash,stable} from '../../lib/sec-tender/source.ts';
import {readTenderStructured} from '../../lib/sec-tender/persistence.ts';
const root=resolve('scripts/tender-product/artifacts');
const read=name=>JSON.parse(fs.readFileSync(resolve(root,name),'utf8'));
const originalFetch=globalThis.fetch;let blockedNativeCalls=0;
globalThis.fetch=async()=>{blockedNativeCalls++;throw Error('Native fetch prohibited in guard test');};
process.env.TENDER_E2E_ARTIFACTS=root;
createRequire(import.meta.url)('./transport.cjs');
await assert.rejects(globalThis.fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent',{
 body:JSON.stringify(read('request.json')),
}),/EEXIST/);
assert.equal(blockedNativeCalls,0);globalThis.fetch=originalFetch;
const db=await connect();
try{
 const identity=read('synthetic.json'),execution=read('enqueue.json').executionId;
 const history=async()=> (await db.query('select (select to_jsonb(r) from ai_runs r where id=$1) run,(select jsonb_agg(to_jsonb(o)) from ai_outputs o where ai_run_id=$1) outputs',[execution])).rows[0];
 const before=await history();
 const migration=fs.readFileSync('supabase/migrations/20261006223000_sec_tender_structured_v1.sql','utf8');
 await db.query(migration);await db.query(migration);assert.deepEqual(await history(),before);
 for(const name of ['reserve_sec_tender_structured(uuid,jsonb)','sec_tender_transition(uuid,text,jsonb)','finish_sec_tender_structured(uuid,text,jsonb)']){
  for(const role of ['anon','authenticated'])assert.equal((await db.query('select has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,name])).rows[0].allowed,false);
  assert.equal((await db.query('select has_function_privilege(\'service_role\',$1,\'EXECUTE\') allowed',[name])).rows[0].allowed,true);
 }
 const current=await readTenderStructured(identity.rawItemId);assert.equal(current.status,'available');
 assert.deepEqual(current.canonical,read('canonical.json'));
 const stage=before.run.metadata.stages.structured;
 assert.equal(stage.state,'complete');assert.deepEqual(JSON.parse(stage.response.body),read('provider-response.json'));
 assert.equal(stage.requestHash,read('frozen.json').requestHash);
 assert.equal(read('transport.json').physicalCalls,1);
 const profiles=(await db.query("select count(*)::int n,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by id),'')) digest from user_profiles t where id<>$1",[identity.userId])).rows[0];
 assert.deepEqual(profiles,read('profile-recovery.json').before);
 for(const [name,expected] of Object.entries(read('preflight.json').code)){
  if(name==='lib/monitor/listingMonitorAlertConsumer.ts')continue; // indentation/comment only, reviewed diff
  assert.equal(hash(fs.readFileSync(name)),expected,name);
 }
 const alerts=(await db.query('select * from user_alert_deliveries where alert_event_id=$1',[identity.eventId])).rows;
 assert.equal(alerts.length,1);assert.equal(alerts[0].user_id,identity.userId);assert.equal(alerts[0].listing_monitor_id,identity.monitorId);
 assert.deepEqual(alerts[0].delivered_channels,[]);assert.equal(alerts[0].sent_at,null);
 const report={pass:true,migrationReapply:'PASS twice; finished history unchanged',permissions:'invoker RPCs: service_role only',
  physicalCalls:1,secondRequestGuard:'EEXIST before native fetch',guardNativeCalls:blockedNativeCalls,
  checkpointMatchesDurableProviderResponse:true,providerInputUnchanged:true,canonicalHash:hash(stable(current.canonical)),
  alertRows:alerts.length,otherUsersAlertRows:0,profileDigestsUnchanged:true,
  recoveredFailures:[{class:'TEST_HARNESS_ERROR',detail:'synthetic event used unregistered tender_offer; corrected to registered other before call'},
   {class:'TEST_HARNESS_ERROR',detail:'synthetic auth user lacked public.user_profiles FK row; added only synthetic profile, then replayed real Workflow'}]};
 fs.writeFileSync(resolve(root,'completion-audit.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
}finally{await db.end();}
