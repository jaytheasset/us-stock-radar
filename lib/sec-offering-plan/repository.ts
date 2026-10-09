import {repository,rpc,select,type Repository} from '../sec-os-snapshot/repository.ts';
import {buildSource,bindingFor,compactBinding,hydrateBinding,bindingIdentity,type StoredBinding} from './source.ts';
import {PURPOSE} from './contract.ts';
export {repository,rpc,select};export type {Repository};
export async function enqueueOfferingPlan(rawItemId:string,repo?:Repository){
 repo??=await repository();
 const raw=(await select(repo,'raw_items',{id:`eq.${rawItemId}`,select:'*',limit:'1'}))[0];
 if(!raw)throw Error('offering_raw_missing');
 let source;try{source=buildSource(raw);}catch(e){if(String(e).includes('not_ready'))return {status:'source_not_ready'};throw e;}
 return rpc(repo,'reserve_sec_offering_plan',{p_binding:compactBinding(bindingFor(rawItemId,source))});
}
export async function loadOfferingSource(binding:StoredBinding,repo:Repository){
 const raw=(await select(repo,'raw_items',{id:`eq.${binding.rawItemId}`,select:'*',limit:'1'}))[0];
 if(!raw)throw Error('offering_source_raw_missing');
 return hydrateBinding(binding,raw);
}
const summary='id,raw_item_id,started_at,finished_at,status:metadata->>offeringStatus,filing:metadata->binding->filing,ticker:metadata->binding->ticker,legacyFiling:metadata->binding->source->filing,legacyTicker:metadata->binding->source->ticker,family:metadata->binding->family,plan:metadata->offeringCheckpoint->validated->plan';
const summaries=(rows:Record<string,any>[]):Record<string,any>[]=>rows.map(({legacyFiling,legacyTicker,...r})=>({...r,filing:r.filing??legacyFiling,ticker:r.ticker??legacyTicker}));
export async function listOfferingPlans(repo?:Repository){return summaries(await select(repo??await repository(),'ai_runs',{prompt_key:`eq.${PURPOSE}`,select:summary,order:'metadata->>reservedAt.desc',limit:'100'}));}
export async function readOfferingPlan(id:string,repo?:Repository){
 if(!/^[0-9a-f-]{36}$/i.test(id))throw Error('offering_id_invalid');repo??=await repository();
 const run=(await select(repo,'ai_runs',{id:`eq.${id}`,prompt_key:`eq.${PURPOSE}`,select:'*',limit:'1'}))[0];if(!run)throw Error('offering_run_missing');
 const decisions=await select(repo,'sec_offering_plan_decisions',{run_id:`eq.${id}`,select:'*',order:'created_at.asc'});
 const familyKey=run.metadata.binding.family.key;
 const family=familyKey?summaries(await select(repo,'ai_runs',{prompt_key:`eq.${PURPOSE}`,'metadata->binding->family->>key':`eq.${familyKey}`,select:summary,limit:'100'})).sort((a,b)=>a.filing.filing_date.localeCompare(b.filing.filing_date)||a.filing.accession.localeCompare(b.filing.accession)):[];
 let source=null,sourceError:string|null=null;
 let commonInvocation:null|{id:string;raw:string;rawHash:string}=null;
 try{
  if(run.metadata.executionKind==='derived_domain_view'){
   const combined=await (await import('../sec-combined-offering/repository.ts')).readCombinedDomainSource(run,repo);
   source=combined.source;const cp=combined.parent.metadata.combinedCheckpoint;
   commonInvocation={id:combined.parent.id,raw:cp.raw,rawHash:cp.rawHash};
  }else source=(await loadOfferingSource(run.metadata.binding,repo)).source;
 }catch{sourceError='source_unavailable_or_mismatch';}
 // Separate accession snapshots; no current/latest value composition or carry-forward.
 return {run,decisions,family,identity:bindingIdentity(run.metadata.binding),source,sourceError,commonInvocation};
}
