import assert from 'node:assert/strict';
import test from 'node:test';
import { SecSubmissionsRefreshService } from './submissionsRefresh.ts';
import { PostgresSecStructuredRepository } from './repository.ts';
import { readCurrentIssuerSubmissions } from './currentSubmissionsReader.ts';
import { normalizeMainSubmissions } from './mainSubmissions.ts';

const cik = '9000000700';
const payload = { cik, name:'Synthetic Current', tickers:['SYN'], exchanges:['Synthetic'],
  filings:{recent:{accessionNumber:[],form:[],filingDate:[]},files:[{name:`CIK${cik}-submissions-001.json`}]}};
const now = () => new Date('2026-10-06T15:00:00Z');
const url = `https://data.sec.gov/submissions/CIK${cik}.json`;
function setup(body = JSON.stringify(payload)) {
  const calls = []; let saved;
  const repo = {
    async allocateSubmissionsRefreshSequence() { calls.push('sequence'); return '9007199254740993'; },
    async ingestSubmissionsRefresh(batch, confirmation) { calls.push('store'); saved={batch,confirmation}; return {counts:{},publication:'published'}; },
  };
  const service = new SecSubmissionsRefreshService(repo,'isolated test test@example.invalid',{
    now, fetchImplementation:async (requested) => {assert.equal(requested,url);calls.push('http');return new Response(body);},
  });
  return {service,calls,saved:()=>saved};
}
test('explicit refresh allocates bigint string before main-only HTTP and publishes verified response time', async()=>{
  const s=setup(); const result=await s.service.refreshIssuerSubmissions({cik});
  assert.deepEqual(s.calls,['sequence','http','store']);
  assert.equal(result.confirmation.refreshSequence,'9007199254740993');
  assert.equal(result.confirmation.confirmedAt,now().toISOString());
  assert.equal(s.saved().batch.rawSources.length,1);assert.equal(s.saved().batch.facts.length,0);
});
for(const [name,body] of [['JSON','{'],['structure',JSON.stringify({...payload,tickers:null})],['CIK',JSON.stringify({...payload,cik:'9000000701'})]]) {
  test(`${name} failure cannot publish`,async()=>{
    const s=setup(body);await assert.rejects(s.service.refreshIssuerSubmissions({cik}));
    assert.deepEqual(s.calls,['sequence','http']);assert.equal(s.saved(),undefined);
  });
}
test('external transaction mode rejects refresh before any query or HTTP',async()=>{
  let calls=0;const repo=new PostgresSecStructuredRepository({query:async()=>{calls++;throw Error('unexpected');}},'external');
  await assert.rejects(repo.allocateSubmissionsRefreshSequence(),/requires_managed/);
  await assert.rejects(repo.ingestSubmissionsRefresh({},{}),/requires_managed/);
  assert.equal(calls,0);
});
test('current publication rejects a batch that does not match its verified main raw before storage',async()=>{
  const batch=normalizeMainSubmissions([{cik,sourceKind:'submissions',sourceUrl:url,sourceIdentity:url,
    fetchedAt:now().toISOString(),rawBody:JSON.stringify(payload),rawBodyKind:'injected_exact_body',payload}],cik,now().toISOString());
  const confirmation={cik,sourceRawId:batch.rawSources[0].id,refreshSequence:'1',confirmedAt:now().toISOString()};
  let calls=0;const repo=new PostgresSecStructuredRepository({query:async()=>{calls++;throw Error('unexpected SQL');}});
  for(const field of ['issuers','issuerObservations','tickerObservations']) {
    await assert.rejects(repo.ingestSubmissionsRefresh({...batch,[field]:[]},confirmation),/invalid_submissions_confirmation_batch/);
  }
  await assert.rejects(repo.ingestSubmissionsRefresh(batch,{...confirmation,refreshSequence:1}),/invalid_submissions_confirmation/);
  const wrongHash=structuredClone(batch);wrongHash.rawSources[0].contentHash='0'.repeat(64);
  await assert.rejects(repo.ingestSubmissionsRefresh(wrongHash,confirmation),/invalid_submissions_confirmation_batch/);
  assert.equal(calls,0);
});
test('reader absent pointer is not-confirmed, never latest raw; database failure is unavailable',async()=>{
  let calls=0;
  const client={query:async(sql)=>{calls++;assert.match(sql,/left join public.sec_structured_raw_sources/);return {rows:[]};}};
  assert.deepEqual(await readCurrentIssuerSubmissions(client,{cik}),{status:'not-confirmed'});assert.equal(calls,1);
  assert.deepEqual(await readCurrentIssuerSubmissions({query:async()=>{throw Error('db');}},{cik}),{status:'unavailable'});
});
test('reader validates raw, reference, name and full listing set in the same snapshot',async()=>{
  const rawBody=JSON.stringify(payload);
  const batch=normalizeMainSubmissions([{cik,sourceKind:'submissions',sourceUrl:url,sourceIdentity:url,
    fetchedAt:now().toISOString(),rawBody,rawBodyKind:'injected_exact_body',payload}],cik,now().toISOString());
  const raw=batch.rawSources[0];
  const row={issuer_cik:cik,cik,id:raw.id,source_raw_id:raw.id,current_kind:'submissions',source_kind:'submissions',
    refresh_sequence:'9007199254740993',confirmed_at:now().toISOString(),fetched_at:now().toISOString(),
    source_url:url,source_identity:url,content_hash:raw.contentHash,raw_content:rawBody,payload,
    names:[{cik,name:payload.name,kind:'submissions'}],listings:[{cik,ticker:'SYN',exchange:'Synthetic',kind:'submissions'}]};
  const read=r=>readCurrentIssuerSubmissions({query:async()=>({rows:[r]})},{cik});
  assert.equal((await read(row)).status,'available');
  for(const bad of [{cik:'9000000701'},{id:null},{source_identity:url+'?old'},{content_hash:'0'.repeat(64)},
    {names:[]},{listings:[]},{listings:[...row.listings,...row.listings]},{payload:{...payload,name:'wrong'}},
    {confirmed_at:'invalid'},{raw_content:'{'}]) assert.equal((await read({...row,...bad})).status,'unavailable');
});
