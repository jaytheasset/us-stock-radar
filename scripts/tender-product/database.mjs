import assert from 'node:assert/strict';
import fs from 'node:fs';
import {connect,insertRaw,pgRepo} from './local.mjs';
import {fixture} from './fixture.mjs';
import {buildTenderBinding,hash,stable} from '../../lib/sec-tender/source.ts';
import {buildTenderStructuredRequest} from '../../lib/sec-tender/contract.ts';
import {reserveTenderStructured,readTenderStructured} from '../../lib/sec-tender/persistence.ts';
import {enqueueTenderStructured,processTenderStructured} from '../../lib/sec-tender/runtime.ts';
const db=await connect();const reports=[];
try{
 const migration=fs.readFileSync('supabase/migrations/20261006223000_sec_tender_structured_v1.sql','utf8');
 await db.query(migration);await db.query(migration);reports.push('migration apply/reapply PASS');
 assert.equal((await db.query("select count(*)::int n from pg_indexes where indexname in ('sec_tender_execution_once','sec_tender_output_once','sec_tender_accession_once')")).rows[0].n,3);
 assert.equal((await db.query("select has_function_privilege('anon','reserve_sec_tender_structured(uuid,jsonb)','EXECUTE') allowed")).rows[0].allowed,false);
 for(const scenario of ['checkpoint_replay','started','source_stale','response_write_failure']){
  await db.query('begin');const raw=await insertRaw(db,fixture()),repo=pgRepo(db),built=buildTenderBinding(raw);let starts=0,calls=0;
  const opts={repository:repo,start:async()=>{starts++;return {runId:'offline-workflow'};}};
  assert.equal((await enqueueTenderStructured(raw.id,opts)).status,'enqueued');assert.equal((await enqueueTenderStructured(raw.id,opts)).status,'duplicate');assert.equal(starts,1);
  const request=buildTenderStructuredRequest(built.providerSource),job={rawItemId:raw.id,executionId:built.executionId};
  const wire={offer_price:null,board_recommendation:null,offer_status:null,final_results_observed:{evidence_refs:[built.providerSource.evidence[0].ref]}};
  const fetchImpl=async()=>{calls++;return new Response(JSON.stringify({modelVersion:'gemini-3.5-flash',candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(wire)}]}}]}),{status:200});};
  if(scenario==='started'){
   const b=await repo.rpc('sec_tender_transition',{p_id:built.executionId,p_action:'begin',p_value:{stage:'structured',request,requestHash:hash(JSON.stringify(request)),mode:'offline'}});assert.equal(b.data.claimed,true);
   assert.equal((await processTenderStructured(job,{repository:repo,fetchImpl,apiKey:'offline'})).status,'busy');assert.equal(calls,0);
   await repo.rpc('sec_tender_transition',{p_id:built.executionId,p_action:'uncertain',p_value:{token:b.data.token}});
   assert.equal((await processTenderStructured(job,{repository:repo,fetchImpl,apiKey:'offline'})).status,'uncertain');assert.equal(calls,0);
  }else if(scenario==='source_stale'){
   const changed=structuredClone(raw.raw_payload);changed.documents[0].text+=' source revision';await db.query('update raw_items set raw_payload=$1 where id=$2',[changed,raw.id]);
   assert.equal((await processTenderStructured(job,{repository:repo,fetchImpl,apiKey:'offline'})).status,'stale');assert.equal(calls,0);assert.equal((await readTenderStructured(raw.id,repo)).status,'not_ready');
   await assert.rejects(reserveTenderStructured(raw.id,repo),/conflict/);
  }else{
   let injected=true;const failing={...repo,rpc:async(name,p)=>{if(injected&&name===(scenario==='checkpoint_replay'?'finish_sec_tender_structured':'sec_tender_transition')&&(scenario==='checkpoint_replay'||p.p_action==='checkpoint')){injected=false;return {ok:false,error:'simulated DB outage'};}return repo.rpc(name,p);}};
   await assert.rejects(processTenderStructured(job,{repository:failing,fetchImpl,apiKey:'offline'}),/simulated/);assert.equal(calls,1);
   const again=await processTenderStructured(job,{repository:repo,fetchImpl,apiKey:'offline'});assert.equal(calls,1);
   if(scenario==='response_write_failure'){assert.equal(again.status,'busy');}
   else{
    assert.equal(again.status,'succeeded');const read=await readTenderStructured(raw.id,repo);assert.equal(read.status,'available');
    assert.equal((await processTenderStructured(job,{repository:repo,fetchImpl,apiKey:'offline'})).status,'succeeded');assert.equal(calls,1);
    assert.equal((await db.query('select count(*)::int n from ai_outputs where ai_run_id=$1',[built.executionId])).rows[0].n,1);
    for(const sql of ["update ai_outputs set payload='{}' where ai_run_id=$1","delete from ai_runs where id=$1","update ai_runs set metadata=metadata-'stages' where id=$1"]){await db.query('savepoint guard');await assert.rejects(db.query(sql,[built.executionId]),/immutable/);await db.query('rollback to savepoint guard');}
    const changed=structuredClone(raw.raw_payload);changed.documents[0].text+=' revision';await db.query('update raw_items set raw_payload=$1 where id=$2',[changed,raw.id]);assert.equal((await readTenderStructured(raw.id,repo)).status,'not_ready');
   }
  }
  await db.query('rollback');reports.push(`${scenario} PASS (mock provider)`);
 }
 assert.equal((await db.query("select count(*)::int n from raw_items where source_code='sec_edgar' and source_unique_id='0001702510-26-000009'")).rows[0].n,0);
 fs.mkdirSync('scripts/tender-product/artifacts',{recursive:true});fs.writeFileSync('scripts/tender-product/artifacts/database-preflight.json',JSON.stringify({pass:true,local:true,actualProviderCalls:0,reports},null,2)+'\n');console.log(JSON.stringify(reports));
}finally{await db.query('rollback').catch(()=>{});await db.end();}
