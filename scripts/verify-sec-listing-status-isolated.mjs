// Retained real SEC evidence -> NEW observation table only. No ingestion, model,
// Monitor, account, alert or operational-source writes. Repeat/concurrent writes
// must return the same observation ID. Run only against the explicit review DB.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {supabaseSelect,supabaseRpc} from '../lib/supabase.ts';
import {persistSecListingObservation,readSecListingHistory,readSecListingStatusAsOf} from '../lib/sec-listing-status/persistence.ts';

const need=k=>{assert.ok(process.env[k],`Missing ${k}`);return process.env[k];};
const endpoint=new URL(need('LISTING_HISTORY_TEST_DB_URL'));
assert.equal(endpoint.hostname,'127.0.0.1');assert.equal(endpoint.port,'57322');
assert.equal(process.env.SUPABASE_URL,'http://127.0.0.1:57321');
const out=need('LISTING_HISTORY_EVIDENCE_DIR');fs.mkdirSync(out,{recursive:true});
const save=(n,x)=>fs.writeFileSync(path.join(out,n),JSON.stringify(x,null,2)+'\n');
const pg=new (createRequire(import.meta.url)('pg').Client)({connectionString:endpoint.href});
const protectedTables=['raw_items','events','ai_runs','ai_outputs','event_listing_risk_results','event_listing_risk_facts','listing_monitors','user_alert_deliveries','sec_ticker_security_identities','sec_ticker_resolution_decisions','sec_cover_observation_results'];
async function snapshot(){const values={};for(const t of protectedTables)values[t]=(await pg.query(`select count(*)::int count,encode(extensions.digest(coalesce(string_agg(to_jsonb(x)::text,E'\n' order by to_jsonb(x)::text),''),'sha256'),'hex') sha256 from public.${t} x`)).rows[0];return values;}
const cases=[
  {name:'TTOO',accession:'0001354457-25-000637',listing:'confirmed_exchange_delisting',trading:'suspended',removal:'2025-07-21',suspension:'2025-02-12'},
  {name:'FTCH',accession:'0000876661-23-001010',listing:'removal_pending',trading:'unresolved',removal:'2024-01-02',suspension:null},
  {name:'PLTR',accession:'0001321655-24-000231',listing:'unresolved',trading:'unresolved',removal:null,suspension:null},
];
const asOf='2026-09-30';
// Explicit expected identity from the separate stable-cover validation. Omit for
// the original pre-identity fixture state; never derive expectations from output.
const stablePltrId=process.env.LISTING_HISTORY_EXPECT_STABLE_PLTR_ID || null;
await pg.connect();
try {
  assert.equal((await pg.query('select system_identifier::text from pg_control_system()')).rows[0].system_identifier,'7689949482832261158');
  const before=await snapshot();save('protected-before-runtime.json',before);
  const count=async()=>Number((await pg.query('select count(*) n from sec_listing_status_observations')).rows[0].n);
  const countBefore=await count();const reports=[];let inserts=0;
  for(const fixture of cases){
    const read=await supabaseSelect('raw_items',{select:'*',source_unique_id:`eq.${fixture.accession}`,source_code:'eq.sec_edgar'});
    assert.ok(read.ok);assert.equal(read.data.length,1);const raw=read.data[0];
    const input={rawItemId:raw.id,asOf};
    const first=await persistSecListingObservation(input);if(first.status==='inserted')inserts++;
    const again=await Promise.all([persistSecListingObservation(input),persistSecListingObservation(input)]);
    assert.ok(again.every(r=>r.status==='replayed'&&r.id===first.id));
    const history=await readSecListingHistory({rawItemId:raw.id});
    const item=history.find(x=>x.id===first.id);assert.ok(item?.usable,JSON.stringify(item?.reason));
    const o=item.observation;
    assert.equal(o.reported.listing,fixture.listing);assert.equal(o.reported.trading,fixture.trading);
    assert.equal(o.reported.removalDate,fixture.removal);assert.equal(o.reported.suspensionDate,fixture.suspension);
    assert.deepEqual(o.sourceSnapshot.raw_payload,raw.raw_payload);assert.ok(o.reported.sources.length>0);
    assert.ok(o.scope);
    const expectAttached=fixture.name==='PLTR' && stablePltrId;
    assert.equal(o.attachment.status,expectAttached?'attached':'unresolved');
    if(expectAttached){assert.equal(o.attachment.securityIdentityId,stablePltrId);
      assert.equal(o.attachment.reason,'validated_stable_sec_security_exchange');assert.equal(o.attachment.decisionId,null);}
    const projection=await readSecListingStatusAsOf({scope:o.scope,securityIdentityId:o.attachment.securityIdentityId,asOf});
    assert.equal(projection.listing,'unresolved');assert.equal(projection.trading,'unresolved');
    assert.equal(projection.reasons.includes('canonical_identity_unresolved'),!expectAttached);
    if(expectAttached)assert.ok(projection.reasons.includes('listing_evidence_unresolved_or_conflicting'));
    save(`${fixture.name}-history.json`,history);save(`${fixture.name}-projection.json`,projection);
    const report={case:fixture.name,accession:fixture.accession,rawItemId:raw.id,observationId:first.id,
      sourceUrl:raw.source_url,sourceHash:o.sourceHash,sourceDocuments:o.reported.sources,reported:o.reported,
      attachment:o.attachment,projection,firstWrite:first.status,replays:again.map(r=>r.status),readback:true};
    reports.push(report);save('real-cases.json',reports);
  }
  assert.equal(await count(),countBefore+inserts);
  // Rejected requests must not persist any state. Original SEC rows are never changed.
  const o=(await readSecListingHistory({rawItemId:reports[0].rawItemId}))[0].observation;
  const rejected=[];
  for(const kind of ['forged_source','unsupported_active','fake_identity']){
    const bad=structuredClone(o);
    if(kind==='forged_source')bad.sourceSnapshot.source_url='https://example.org/wrong';
    if(kind==='unsupported_active')bad.reported.listing='active';
    if(kind==='fake_identity')bad.attachment={status:'attached',securityIdentityId:'25000000-0000-4000-8000-000000000099',decisionId:'25000000-0000-4000-8000-000000000098',knownAt:'2025-01-01T00:00:00Z',proofHash:'a'.repeat(64),reason:'invalid-test-only'};
    const result=await supabaseRpc('persist_sec_listing_status_observation',{p_observation:bad});
    assert.equal(result.ok,false,kind);rejected.push({kind,status:result.status,error:result.error});
  }
  assert.equal(await count(),countBefore+inserts);
  const permissions=(await pg.query(`select r,has_table_privilege(r,'public.sec_listing_status_observations','SELECT') can_read,
    has_table_privilege(r,'public.sec_listing_status_observations','UPDATE') can_update,
    has_table_privilege(r,'public.sec_listing_status_observations','DELETE') can_delete,
    has_function_privilege(r,'public.persist_sec_listing_status_observation(jsonb)','EXECUTE') can_write
    from unnest(array['anon','authenticated','service_role']) r`)).rows;
  assert.ok(permissions.every(x=>!x.can_update&&!x.can_delete));
  assert.ok(permissions.filter(x=>x.r!=='service_role').every(x=>!x.can_read&&!x.can_write));
  const inventory=(await pg.query(`select
    (select count(*)::int from raw_items where source_code='sec_edgar' and raw_payload->>'form_type' in ('8-K','8-K/A','6-K','6-K/A')) existing_8k_6k,
    (select count(*)::int from sec_ticker_security_identities) canonical_security_identities`)).rows[0];
  const after=await snapshot();save('protected-after-runtime.json',after);assert.deepEqual(after,before);
  const migrationBefore=path.join(out,'protected-before.json');
  if(fs.existsSync(migrationBefore))assert.deepEqual(after,JSON.parse(fs.readFileSync(migrationBefore,'utf8')));
  const migration='supabase/migrations/20260930182700_sec_listing_status_observations.sql';
  const report={target:'127.0.0.1:57322',providerCalls:0,existingEvidenceOnly:true,asOf,
    countBefore,inserted:inserts,countAfter:await count(),sequentialAndConcurrentReplay:true,
    protectedTablesUnchanged:true,rejected,permissions,inventory,
    migration, migrationSHA256:createHash('sha256').update(fs.readFileSync(migration)).digest('hex'),
    cases:reports.map(r=>({case:r.case,listing:r.reported.listing,trading:r.reported.trading,
      attachment:r.attachment.status,projectedListing:r.projection.listing,readback:r.readback}))};
  save('verification-result.json',report);console.log(JSON.stringify(report));
}finally{await pg.end();}
