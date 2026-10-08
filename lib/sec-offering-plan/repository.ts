import {repository,rpc,select,type Repository} from '../sec-os-snapshot/repository.ts';
import {buildSource,bindingFor} from './source.ts';
import {PURPOSE} from './contract.ts';
export {repository,rpc,select};export type {Repository};
export async function enqueueOfferingPlan(rawItemId:string,repo?:Repository){
 repo??=await repository();
 const raw=(await select(repo,'raw_items',{id:`eq.${rawItemId}`,select:'*',limit:'1'}))[0];
 if(!raw)throw Error('offering_raw_missing');
 let source;try{source=buildSource(raw);}catch(e){if(String(e).includes('not_ready'))return {status:'source_not_ready'};throw e;}
 return rpc(repo,'reserve_sec_offering_plan',{p_binding:bindingFor(rawItemId,source)});
}
const summary='id,raw_item_id,started_at,finished_at,status:metadata->>offeringStatus,filing:metadata->binding->source->filing,ticker:metadata->binding->source->ticker,family:metadata->binding->family,plan:metadata->offeringCheckpoint->validated->plan';
export async function listOfferingPlans(repo?:Repository){return select(repo??await repository(),'ai_runs',{prompt_key:`eq.${PURPOSE}`,select:summary,order:'metadata->>reservedAt.desc',limit:'100'});}
export async function readOfferingPlan(id:string,repo?:Repository){
 if(!/^[0-9a-f-]{36}$/i.test(id))throw Error('offering_id_invalid');repo??=await repository();
 const run=(await select(repo,'ai_runs',{id:`eq.${id}`,prompt_key:`eq.${PURPOSE}`,select:'*',limit:'1'}))[0];if(!run)throw Error('offering_run_missing');
 const decisions=await select(repo,'sec_offering_plan_decisions',{run_id:`eq.${id}`,select:'*',order:'created_at.asc'});
 const familyKey=run.metadata.binding.family.key;
 const family=familyKey?await select(repo,'ai_runs',{prompt_key:`eq.${PURPOSE}`,'metadata->binding->family->>key':`eq.${familyKey}`,select:summary,order:'metadata->binding->source->filing->>filing_date.asc',limit:'100'}):[];
 // Separate accession snapshots; no current/latest value composition or carry-forward.
 return {run,decisions,family};
}
