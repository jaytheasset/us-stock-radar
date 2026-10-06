import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SecStructuredDataService } from '../lib/sec-structured-data/service.ts';
import { normalizeSecStructuredDocuments } from '../lib/sec-structured-data/normalization.ts';

export function syntheticDocument(number) {
  const cik=String(9000000000+number), sourceUrl=`https://data.sec.gov/submissions/CIK${cik}.json`;
  const payload={cik,name:`Synthetic concurrency ${number}`,tickers:['SYN'],exchanges:['Synthetic Exchange'],
    filings:{recent:{accessionNumber:[`${cik}-26-000001`],form:['10-K'],filingDate:['2026-10-06']},files:[]}};
  return {sourceKind:'submissions',sourceUrl,sourceIdentity:sourceUrl,cik,payload,
    rawBody:JSON.stringify(payload),rawBodyKind:'injected_exact_body',fetchedAt:'2026-10-06T00:00:00Z'};
}
const clientFor=doc=>({fetchSubmissions:async()=>[doc],fetchCompanyFacts:async()=>{throw Error('No CompanyFacts in synthetic cases');}});
export async function rawRaces(ctx, count, offset, requireSuccess) {
  const reports=[];
  for(let n=0;n<count;n++){
    const doc=syntheticDocument(offset+n), batch=normalizeSecStructuredDocuments([doc]);
    const a=await ctx.connect(),b=await ctx.connect();
    const pids=await Promise.all([a,b].map(async c=>(await c.query('select pg_backend_pid() pid')).rows[0].pid));
    assert.notEqual(pids[0],pids[1]);
    const existing=(await a.query('select count(*)::int n from public.sec_structured_raw_sources where id=$1',[batch.rawSources[0].id])).rows[0].n;
    assert.equal(existing,0);
    let release;const barrier=new Promise(resolve=>{release=resolve;});let arrived=0;
    const synchronize=async sql=>{if(/insert into public\.sec_structured_raw_sources/.test(sql)){if(++arrived===2)release();await barrier;}};
    const result=await Promise.allSettled([a,b].map((c,i)=>new SecStructuredDataService(clientFor(doc),ctx.repository(c,`synthetic-${offset+n}-${i}`,synchronize)).ingestIssuerSubmissions({cik:doc.cik})));
    await ctx.close(a);await ctx.close(b);
    const reader=await ctx.connect();
    const counts={};
    for(const [table,column] of [['sec_structured_raw_sources','cik'],['sec_issuers','cik'],['sec_issuer_source_observations','issuer_cik'],['sec_issuer_ticker_observations','issuer_cik'],['sec_filing_ledger','issuer_cik']]){
      counts[table]=(await reader.query(`select count(*)::int n from public.${table} where ${column}=$1`,[doc.cik])).rows[0].n;
    }
    const raw=(await reader.query('select id,content_hash,raw_content from public.sec_structured_raw_sources where id=$1',[batch.rawSources[0].id])).rows[0];
    assert.equal(raw.raw_content,doc.rawBody);assert.equal(raw.content_hash,batch.rawSources[0].contentHash);
    await ctx.close(reader);
    const outcomes=result.map(x=>x.status==='fulfilled'?{status:x.status,value:x.value}:{status:x.status,code:x.reason.code,constraint:x.reason.constraint,message:x.reason.message});
    reports.push({cik:doc.cik,pids,initialRows:existing,sourceId:raw.id,hash:raw.content_hash,outcomes,counts});
    ctx.report[requireSuccess?'afterRaces':'beforeRaces']=reports;
    assert.ok(Object.values(counts).every(n=>n===1));
    if(requireSuccess){
      assert.ok(result.every(x=>x.status==='fulfilled'));
      assert.deepEqual(outcomes.map(x=>x.value.inserted).sort((a,b)=>a-b),[0,5]);
      assert.deepEqual(outcomes.map(x=>x.value.deduped).sort((a,b)=>a-b),[0,5]);
      assert.equal(outcomes.reduce((s,x)=>s+x.value.rawSourcesInserted,0),1);
    }
  }
  return reports;
}

export async function rawGuards(ctx) {
  const control=await ctx.connect('postgres'),reader=await ctx.connect();
  const mutations={
    different_body:row=>{row.raw_content=JSON.stringify({changed:true});row.payload={changed:true};row.content_hash='a'.repeat(64);},
    different_cik:row=>{row.cik='9999999999';},
    different_source:row=>{row.source_identity+='?other';row.source_url+='?other';},
    different_id:row=>{row.id=randomUUID();},
    hidden_body_damage:row=>{row.raw_content=JSON.stringify({changed:true});},
    hidden_payload_damage:row=>{row.payload={changed:true};},
    mixed_batch:row=>{row.payload={changed:true};},
  };
  const reports=[];let index=0;
  for(const [name,mutate] of Object.entries(mutations)){
    const doc=syntheticDocument(500+index++),batch=normalizeSecStructuredDocuments([doc]);
    const r=batch.rawSources[0];
    const row={id:r.id,source_kind:r.sourceKind,source_url:r.sourceUrl,source_identity:r.sourceIdentity,cik:r.cik,
      fetched_at:r.fetchedAt,ingested_at:r.ingestedAt,content_hash:r.contentHash,raw_content_kind:r.rawContentKind,raw_content:r.rawContent,payload:r.payload};
    mutate(row);
    const columns=Object.keys(row);
    await control.query(`insert into public.sec_structured_raw_sources (${columns.join(',')}) values (${columns.map((_,i)=>`$${i+1}`).join(',')})`,Object.values(row));
    if(name==='mixed_batch'){
      const good=normalizeSecStructuredDocuments([syntheticDocument(700)]);
      for(const field of Object.keys(batch))batch[field]=[...good[field],...batch[field]];
    }
    const before=await ctx.snapshot(reader),writer=await ctx.connect();
    let error;
    try{await ctx.repository(writer,`guard-${name}`).ingestBatch(batch);}catch(e){error=e;}
    await ctx.close(writer);
    assert.ok(error);assert.match(error.message,/raw_source_identity_mismatch/);
    assert.deepEqual(await ctx.snapshot(reader),before);
    reports.push({case:name,error:error.message,partialWrites:0,priorStatePreserved:true});
  }
  // Valid versions of the same main URL are distinct raw rows.
  const doc=syntheticDocument(800),writer=await ctx.connect();
  const service=new SecStructuredDataService(clientFor(doc),ctx.repository(writer,'version'));
  const first=await service.ingestIssuerSubmissions({cik:doc.cik});
  const before=await ctx.snapshot(reader);
  doc.rawBodyKind='authoritative_http_body';doc.fetchedAt='2026-10-06T01:00:00Z';
  const replay=await service.ingestIssuerSubmissions({cik:doc.cik});
  assert.equal(replay.inserted,0);assert.deepEqual(await ctx.snapshot(reader),before);
  doc.payload.name+=' version two';doc.rawBody=JSON.stringify(doc.payload);
  const second=await service.ingestIssuerSubmissions({cik:doc.cik});
  assert.equal(second.rawSourcesInserted,1);assert.notEqual(second.insertedRawSourceIds[0],first.insertedRawSourceIds[0]);
  assert.equal((await reader.query('select count(*)::int n from public.sec_structured_raw_sources where cik=$1',[doc.cik])).rows[0].n,2);
  const old=(await reader.query('select raw_content_kind,fetched_at from public.sec_structured_raw_sources where id=$1',[first.insertedRawSourceIds[0]])).rows[0];
  assert.equal(old.raw_content_kind,'injected_exact_body');assert.equal(old.fetched_at.toISOString(),'2026-10-06T00:00:00.000Z');
  ctx.report.guards=reports;ctx.report.versions={count:2,metadataReplayInserted:0,firstMetadataPreserved:true};
  await ctx.close(writer);await ctx.close(reader);await ctx.close(control);
}
