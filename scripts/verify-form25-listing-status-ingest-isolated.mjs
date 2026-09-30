// Real retained SEC sources through runSecRawIngest, with its production sidecars
// and DB writers. Only the HTTP fetch boundary is supplied preserved SEC input.
// No direct listing-observation writer invocation, Primary, Monitor, or model calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {supabaseSelect} from '../lib/supabase.ts';
import {runSecRawIngest} from '../lib/secIngest.ts';
import {readSecListingHistory,readSecListingStatusAsOf} from '../lib/sec-listing-status/persistence.ts';
import {listingSourceSnapshot,evaluateObservation,summarize} from '../lib/sec-listing-status/observation.ts';

const need=k=>{assert.ok(process.env[k],`Missing ${k}`);return process.env[k];};
const endpoint=new URL(need('LISTING_HISTORY_TEST_DB_URL'));
assert.equal(endpoint.hostname,'127.0.0.1');assert.equal(endpoint.port,'57322');
assert.equal(process.env.SUPABASE_URL,'http://127.0.0.1:57321');
const out=need('LISTING_HISTORY_EVIDENCE_DIR');fs.mkdirSync(out,{recursive:true});
const save=(n,x)=>fs.writeFileSync(path.join(out,n),JSON.stringify(x,null,2)+'\n');
const pg=new (createRequire(import.meta.url)('pg').Client)({connectionString:endpoint.href});
// Expected facts fixed from the retained SEC source before invoking ingest.
const cases=[
 {name:'PLTR',accession:'0001321655-24-000231',attachment:'attached',reportedListing:'unresolved',trading:'unresolved',removal:null,suspension:null},
 {name:'TTOO',accession:'0001354457-25-000637',attachment:'unresolved',reportedListing:'removal_pending',trading:'suspended',removal:'2025-07-21',suspension:'2025-02-12'},
 {name:'FTCH',accession:'0000876661-23-001010',attachment:'unresolved',reportedListing:'removal_pending',trading:'unresolved',removal:'2024-01-02',suspension:null},
];
const protectedTables=['events','ai_runs','ai_outputs','event_listing_risk_results','event_listing_risk_facts',
 'listing_monitors','user_alert_deliveries','sec_ticker_security_identities'];
async function protectedState(){const r={};for(const t of protectedTables)r[t]=(await pg.query(`select count(*)::int n,encode(extensions.digest(coalesce(string_agg(to_jsonb(x)::text,E'\n' order by to_jsonb(x)::text),''),'sha256'),'hex') hash from ${t} x`)).rows[0];return r;}
await pg.connect();
try {
 assert.equal((await pg.query('select system_identifier::text from pg_control_system()')).rows[0].system_identifier,'7689949482832261158');
 const before=await protectedState();save('protected-before.json',before);save('expected.json',cases);
 const existing=(await pg.query('select * from sec_listing_status_observations order by id')).rows;
 save('existing-observations-before.json',existing);
 const oldDecisions=(await pg.query('select * from sec_ticker_resolution_decisions order by id')).rows;
 save('existing-ticker-decisions-before.json',oldDecisions);
 const reports=[];
 for(const expected of cases){
   const response=await supabaseSelect('raw_items',{select:'*',source_code:'eq.sec_edgar',source_unique_id:`eq.${expected.accession}`,limit:'2'});
   assert.ok(response.ok);assert.equal(response.data.length,1);const raw=response.data[0];
   const sourceBefore=listingSourceSnapshot(raw);save(`${expected.name}-source-before.json`,sourceBefore);
   const run=()=>runSecRawIngest({accessionNumber:expected.accession,formTypes:[raw.raw_payload.form_type],limit:1},
     {fetchRawItems:async()=>({ok:true,status:200,items:[raw],diagnostics:{documentsRequested:0,documentsFetched:0,documentsFailed:0,source:'retained_exact_SEC_source'}})});
   const first=await run();save(`${expected.name}-ingest-first.json`,first);assert.equal(first.ok,true);
   assert.equal(first.items.length,1);const automatic=first.items[0].form25_listing_status;
   assert.ok(['inserted','replayed'].includes(automatic.status),JSON.stringify(automatic));
   assert.equal(automatic.attachment,expected.attachment);assert.equal(automatic.listing,expected.reportedListing);
   assert.equal(automatic.trading,expected.trading);assert.equal(automatic.evaluatedAsOf,String(raw.published_at).slice(0,10));
   const runs=(await pg.query('select id,status,stats,metadata from source_runs where id=$1',[first.runId])).rows;
   assert.equal(runs[0].status,'completed');assert.deepEqual(runs[0].metadata.form25_listing_status[0],automatic);
   save(`${expected.name}-source-run.json`,runs[0]);
   const history=await readSecListingHistory({rawItemId:raw.id});save(`${expected.name}-history.json`,history);
   const item=history.find(r=>r.id===automatic.observationId);assert.ok(item?.usable,item?.reason);
   assert.equal(item.observation.reported.removalDate,expected.removal);assert.equal(item.observation.reported.suspensionDate,expected.suspension);
   const sourceStateAsOf=summarize(evaluateObservation(item.observation,'2026-09-30'));
   assert.equal(sourceStateAsOf.listing,expected.name==='TTOO'?'confirmed_exchange_delisting':expected.reportedListing);
   assert.equal(sourceStateAsOf.trading,expected.trading);
   if(expected.name==='PLTR')assert.equal(item.observation.attachment.securityIdentityId,'816ec549-767d-5da6-9966-28d2b3c20118');
   const projection=await readSecListingStatusAsOf({scope:item.observation.scope,
     securityIdentityId:item.observation.attachment.securityIdentityId,asOf:'2026-09-30'});
   save(`${expected.name}-projection.json`,projection);
   assert.equal(projection.listing,'unresolved');assert.equal(projection.trading,'unresolved');
   assert.equal(projection.reasons.includes('canonical_identity_unresolved'),expected.attachment==='unresolved');
   const count=Number((await pg.query('select count(*) n from sec_listing_status_observations')).rows[0].n);
   const repeats=[];for(let i=0;i<2;i++)repeats.push(await run());
   save(`${expected.name}-ingest-repeats.json`,repeats);
   for(const result of repeats){assert.equal(result.ok,true);assert.equal(result.items[0].form25_listing_status.status,'replayed');
     assert.equal(result.items[0].form25_listing_status.observationId,automatic.observationId);}
   assert.equal(Number((await pg.query('select count(*) n from sec_listing_status_observations')).rows[0].n),count);
   const afterRaw=await supabaseSelect('raw_items',{select:'*',id:`eq.${raw.id}`,limit:'1'});assert.ok(afterRaw.ok);
   assert.deepEqual(listingSourceSnapshot(afterRaw.data[0]),sourceBefore,'original filing bytes/dates preserved');
   reports.push({case:expected.name,rawItemId:raw.id,runIds:[first.runId,...repeats.map(r=>r.runId)],
     automatic,sourceStateAsOf,delisting:first.items[0].form25_delisting,
     coverPersistence:first.items[0].sec_cover_observation_persistence,readback:true,projection,replayed:2,directFactsUnchanged:true});
 }
 const oldAfter=(await pg.query('select * from sec_listing_status_observations where id=any($1::uuid[]) order by id',[existing.map(x=>x.id)])).rows;
 assert.deepEqual(oldAfter,existing);const after=await protectedState();save('protected-after.json',after);assert.deepEqual(after,before);
 // The normal cover sidecar is retained, not stubbed: it may append an unresolved
 // change decision for these Form 25 sources, but must not claim a new continuity.
 const decisions=(await pg.query('select * from sec_ticker_resolution_decisions order by id')).rows;
 assert.deepEqual(decisions.filter(r=>oldDecisions.some(o=>o.id===r.id)),oldDecisions);
 const appendedDecisions=decisions.filter(r=>!oldDecisions.some(o=>o.id===r.id));
 assert.ok(appendedDecisions.every(r=>r.resolution_state==='UNRESOLVED' && r.security_identity_id===null
   && cases.some(c=>c.accession===r.evidence_accession_number)));
 save('existing-ticker-sidecar-appends.json',appendedDecisions);
 save('result.json',{target:'127.0.0.1:57322',providerCalls:0,source:'retained SEC original source through normal raw-ingest entry',
  automaticWriterNotInjected:true,protectedTablesUnchanged:true,oldObservationsUnchanged:true,appendedUnresolvedTickerDecisions:appendedDecisions.length,cases:reports});
 console.log(JSON.stringify(reports.map(r=>({case:r.case,write:r.automatic.status,attachment:r.automatic.attachment,
   listingAtFiling:r.automatic.listing,currentDeterministicListing:r.delisting.result?.listing,observation:r.automatic.observationId,replays:r.replayed}))));
}finally{await pg.end();}
