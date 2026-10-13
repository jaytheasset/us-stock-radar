import {adminHistoryFilter,commonSummaryFields,commonExecution,readAdminHistoryRun} from "../sec-combined-offering/adminHistory.ts";
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
/** Existing exact-filing pairing only; no calculation, persistence or family fallback. */
export async function readMatchingOsRun(run:Record<string,any>,repo:Repository):Promise<string|null>{
 if(run.metadata?.executionKind==='derived_domain_view'){
  const common=await (await import('../sec-combined-offering/repository.ts')).readCommonInvocation(run,repo);
  return common.osRunId;
 }
 const pair=await rpc(repo,'read_projected_offering_inputs',{p_raw_id:run.raw_item_id});
 return pair.raw?.id===run.raw_item_id&&pair.offering?.id===run.id&&typeof pair.os?.id==='string'?pair.os.id:null;
}
const summary=commonSummaryFields+',id,raw_item_id,started_at,finished_at,status:metadata->>offeringStatus,filing:metadata->binding->filing,ticker:metadata->binding->ticker,legacyFiling:metadata->binding->source->filing,legacyTicker:metadata->binding->source->ticker,family:metadata->binding->family,plan:metadata->offeringCheckpoint->validated->plan';
const summaries=(rows:Record<string,any>[]):Record<string,any>[]=>rows.map(({legacyFiling,legacyTicker,...r})=>({...r,commonExecution:commonExecution(r),filing:r.filing??legacyFiling,ticker:r.ticker??legacyTicker}));
export async function listOfferingPlans(repo?:Repository){return summaries(await select(repo??await repository(),'ai_runs',{or:adminHistoryFilter(PURPOSE),select:summary,order:'metadata->>reservedAt.desc',limit:'100'}));}
export async function readOfferingPlan(id:string,repo?:Repository){
 if(!/^[0-9a-f-]{36}$/i.test(id))throw Error('offering_id_invalid');repo??=await repository();
 const {run,commonExecution}=await readAdminHistoryRun(id,PURPOSE,repo);
 if(commonExecution)return {run,commonExecution,decisions:[],family:[],identity:{filing:commonExecution.filing,ticker:commonExecution.ticker},source:null,sourceError:null,commonInvocation:null};
 const decisions=await select(repo,'sec_offering_plan_decisions',{run_id:`eq.${run.id}`,select:'*',order:'created_at.asc'});
 const familyKey=run.metadata.binding.family.key;
 const family=familyKey?summaries(await select(repo,'ai_runs',{prompt_key:`eq.${PURPOSE}`,'metadata->binding->family->>key':`eq.${familyKey}`,select:summary,limit:'100'})).sort((a,b)=>a.filing.filing_date.localeCompare(b.filing.filing_date)||a.filing.accession.localeCompare(b.filing.accession)):[];
 let source=null,sourceError:string|null=null;
 let commonInvocation:null|{id:string;raw:string;rawHash:string}=null;
 try{
  if(run.metadata.executionKind==='derived_domain_view'){
   commonInvocation=await (await import('../sec-combined-offering/repository.ts')).readCommonInvocation(run,repo);
   const combined=await (await import('../sec-combined-offering/repository.ts')).readCombinedDomainSource(run,repo);
   source=combined.source;const cp=combined.parent.metadata.combinedCheckpoint;
   commonInvocation={id:combined.parent.id,raw:cp.raw,rawHash:cp.rawHash};
  }else source=(await loadOfferingSource(run.metadata.binding,repo)).source;
 }catch{sourceError='source_unavailable_or_mismatch';}
 // Separate accession snapshots; no current/latest value composition or carry-forward.
 return {run,decisions,family,identity:bindingIdentity(run.metadata.binding),source,sourceError,commonInvocation,commonExecution:null};
}
