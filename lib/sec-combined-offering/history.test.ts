import test from 'node:test';
import assert from 'node:assert/strict';
import {sha} from '../sec-os-snapshot/contract.ts';
import type {Repository} from '../sec-os-snapshot/repository.ts';
import {readCommonInvocation} from './repository.ts';

function fixture(){
 const raw='{"original":"Pré — £"}',checkpoint={raw,rawHash:sha(raw)};
 const parent={id:'parent',raw_item_id:'raw',metadata:{combinedStatus:'COMPLETE',
  binding:{osRunId:'os',offeringRunId:'offering'},combinedCheckpoint:checkpoint}};
 const run={id:'offering',raw_item_id:'raw',prompt_key:'sec_offering_plan',metadata:{combinedInvocationId:'parent'}};
 const state={output:structuredClone(checkpoint)};
 const repo:Repository={async select(table,q){
  if(table==='ai_runs'){assert.equal(q.id,'eq.parent');return {ok:true,data:[parent]};}
  if(table==='ai_outputs'){assert.equal(q.ai_run_id,'eq.parent');return {ok:true,data:[{payload:state.output}]};}
  throw Error('History must not hydrate current source');
 },async rpc(){throw Error('History must not write');}};
 return {raw,parent,run,state,repo};
}
test('administrator common history preserves exact Unicode output without hydrating changed source',async()=>{
 const f=fixture();assert.deepEqual(await readCommonInvocation(f.run,f.repo),{
  id:'parent',raw:f.raw,rawHash:sha(f.raw),osRunId:'os',offeringRunId:'offering',
 });
});
test('administrator common history rejects mismatched child, raw, checkpoint and output hashes',async()=>{
 for(const damage of ['child','raw','status','output','hash']){
  const f=fixture();
  if(damage==='child')f.run.id='different';
  if(damage==='raw')f.run.raw_item_id='different';
  if(damage==='status')f.parent.metadata.combinedStatus='RUNNING';
  if(damage==='output')f.state.output.raw='changed';
  if(damage==='hash'){f.state.output.rawHash='wrong';f.parent.metadata.combinedCheckpoint.rawHash='wrong';}
  await assert.rejects(readCommonInvocation(f.run,f.repo),/combined_history_/);
 }
});
