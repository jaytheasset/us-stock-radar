import test from 'node:test';
import assert from 'node:assert/strict';
import {historyPublicationFixture} from './fixtures/historyPublication.ts';
import {prepareOsSnapshotHistory,publishOsSnapshotHistory,osSnapshotRunSaved} from './historyPublication.ts';
import {mapShareCountHistoryDatabaseRow,toShareCountHistoryDatabaseRow} from '../sec-structured-data/shareCountHistory.ts';
import {resolveClassShareCountAt} from '../sec-structured-data/classShareCountResolver.ts';
import type {Repository} from './repository.ts';

function harness(f=historyPublicationFixture()){
 const saved:any[]=[];let fail=false;
 const repo:Repository={select:async(table)=>{assert.equal(table,'share_count_history_eligible');return {ok:true,data:[]};},rpc:async(name,args)=>{
  if(name==='read_os_snapshot_publication_context')return {ok:true,data:structuredClone(f.context)};
  assert.equal(name,'publish_os_snapshot_share_history');if(fail){fail=false;return {ok:false,error:'transient'};}
  let inserted=0;for(const row of args.p_rows as any[]){if(!saved.some(r=>r.source_fact_key===row.source_fact_key)){saved.push(structuredClone(row));inserted++;}}
  return {ok:true,data:{inserted,deduped:(args.p_rows as any[]).length-inserted}};
 }};
 return {f,repo,saved,failNext:()=>{fail=true;}};
}

test('verified exact common stock publishes unchanged quantity/date/provenance once without human approval',async()=>{
 const h=harness(),before=JSON.stringify(h.f.context);const first=await publishOsSnapshotHistory(h.f.run.id,h.repo);
 assert.equal(first.status,'published');assert.equal((first as any).inserted,1);
 const second=await publishOsSnapshotHistory(h.f.run.id,h.repo);assert.equal((second as any).deduped,1);
 assert.equal(h.saved.length,1);const row=h.saved[0];assert.equal(row.source_type,'sec_os_snapshot_verified');assert.equal(row.shares_outstanding,'1000');assert.equal(row.as_of,'2026-01-30');
 assert.equal(row.source_provenance.approval,undefined);assert.equal(row.source_provenance.snapshot.runId,h.f.run.id);assert.equal(JSON.stringify(h.f.context),before);
});

test('source/output/contract/identity changes and a superseding invocation cannot publish',async()=>{
 const mutations=[(h:ReturnType<typeof harness>)=>{h.f.context.raw.raw_payload.primary_document_html+='changed';},
  (h:ReturnType<typeof harness>)=>{h.f.run.metadata.binding.schemaHash='0'.repeat(64);},
  (h:ReturnType<typeof harness>)=>{h.f.context.output={...h.f.context.output,rawHash:'0'.repeat(64)};},
  (h:ReturnType<typeof harness>)=>{h.f.context.latestRootId='new-run';},
  (h:ReturnType<typeof harness>)=>{h.f.context.ledger.issuer_cik='0000000092';}];
 for(const mutate of mutations){const h=harness();mutate(h);const r=await publishOsSnapshotHistory(h.f.run.id,h.repo);assert.equal(r.status,'not_published');assert.equal(h.saved.length,0);}
});

test('nullable date, issuer total, ADS/ordinary/class aliases and wrong quantities or units stay unavailable',async()=>{
 const cases=[historyPublicationFixture({as_of_date:null}),historyPublicationFixture({scope:'issuer_total',share_class:null}),
  historyPublicationFixture({share_class:'ordinary shares'}),historyPublicationFixture({share_class:'ADS'}),historyPublicationFixture({share_class:'COMMON STOCK'}),
  historyPublicationFixture({quantity:'1001'}),historyPublicationFixture({},'As of January 30, 2026, 1000 units of common stock were outstanding.'),
  historyPublicationFixture({},'Following the offering, 1,000 shares of common stock will be outstanding as of January 30, 2026.')];
 for(const f of cases){const h=harness(f);assert.equal((await publishOsSnapshotHistory(f.run.id,h.repo)).status,'not_published');assert.equal(h.saved.length,0);}
});

test('missing/ambiguous common-class evidence never selects a first issuer class',async()=>{
 for(const mutate of [(h:ReturnType<typeof harness>)=>{h.f.context.universes=[];},(h:ReturnType<typeof harness>)=>{h.f.universe.status='AMBIGUOUS';h.f.universe.reason='CLASS_FACT_CONFLICT';h.f.universe.required_canonical_security_class_ids=[];h.f.universe.class_evidence=[];}]){
  const h=harness();mutate(h);assert.equal((await prepareOsSnapshotHistory(h.f.run.id,h.repo)).observations.length,0);
 }
});

test('REVIEW needs an existing exact candidate approval; hold/reject and unapproved review cannot publish',async()=>{
 const h=harness();h.f.value.status='REVIEW_REQUIRED';h.f.value.current_os=[];h.f.value.review={code:'AMBIGUOUS_CURRENT_SCOPE',candidates:[h.f.record]};h.f.freeze();
 assert.equal((await publishOsSnapshotHistory(h.f.run.id,h.repo)).status,'not_published');
 h.f.context.decision={id:'10000000-0000-4000-a000-000000000095',action:'approve',candidate_indexes:[0]};
 assert.equal((await publishOsSnapshotHistory(h.f.run.id,h.repo)).status,'published');
 for(const action of ['hold','reject']){h.f.context.decision.action=action;assert.equal((await publishOsSnapshotHistory(h.f.run.id,h.repo)).status,'not_published');}
 assert.equal(h.saved.length,1);
});

test('publication failure is retryable without altering extraction output',async()=>{
 const h=harness(),before=JSON.stringify(h.f.context);h.failNext();assert.equal((await osSnapshotRunSaved(h.f.run.id,h.repo)).status,'failed');
 assert.equal(h.saved.length,0);assert.equal((await osSnapshotRunSaved(h.f.run.id,h.repo)).status,'published');assert.equal(JSON.stringify(h.f.context),before);
});

test('resolver accepts only current database-projected automatic history and preserves latest-date conflict',async()=>{
 const h=harness(),{observations}=await prepareOsSnapshotHistory(h.f.run.id,h.repo);assert.equal(observations.length,1);
 const raw={...toShareCountHistoryDatabaseRow(observations[0]),id:'91002',created_at:'2026-02-02T00:00:00Z'};
 const stale=mapShareCountHistoryDatabaseRow(raw),current=mapShareCountHistoryDatabaseRow({...raw,snapshot_publication_valid:true});
 const resolve=(history:any[])=>resolveClassShareCountAt({repository:{insertObservation:async()=>false,readHistory:async()=>history},cik:'0000000091',securityClassId:'sc:v1:0000000091:common_stock:single',targetAt:'2026-02-03T00:00:00Z'});
 assert.equal((await resolve([stale])).status,'UNAVAILABLE');assert.equal((await resolve([current])).status,'RESOLVED');
 assert.equal((await resolve([current,{...current,sharesOutstanding:'1001'}])).status,'CONFLICT');
 assert.equal((await resolve([current,{...current,asOf:'2026-01-29',sharesOutstanding:'900'}])).sharesOutstanding,'1000');
});
