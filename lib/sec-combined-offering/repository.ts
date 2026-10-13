import {repository,rpc,select,type Repository} from '../sec-os-snapshot/repository.ts';
import {sha,stable} from '../sec-os-snapshot/contract.ts';
import {PROFILE} from '../sec-offering-plan/contract.ts';
import {familyFor} from '../sec-offering-plan/source.ts';
import {combinedBinding,validateCombinedResponse} from './contract.ts';
import {buildCombinedSource,type CombinedSource} from './source.ts';
export {repository,rpc,select};export type {Repository};
export const PURPOSE='sec_combined_offering';
export const uuid=(key:string)=>`${key.slice(0,8)}-${key.slice(8,12)}-5${key.slice(13,16)}-a${key.slice(17,20)}-${key.slice(20,32)}`;
export function durableBinding(rawItemId:string,source:CombinedSource){
 const binding=combinedBinding(rawItemId,source);
 return {...binding,id:uuid(binding.key),providerProfile:PROFILE,filing:source.filing,ticker:source.ticker,
  documents:source.documents.map(({id,original_sha256,text_sha256})=>({id,original_sha256,text_sha256})),
  blockCount:source.blocks.length,family:familyFor(source.filing),
  osRunId:uuid(sha(binding.key+':os')),offeringRunId:uuid(sha(binding.key+':offering'))};
}
export type DurableBinding=ReturnType<typeof durableBinding>;
export async function enqueueCombinedOffering(rawItemId:string,supplied?:Repository){
 const repo=supplied??await repository();const raw=(await select(repo,'raw_items',{id:`eq.${rawItemId}`,select:'*',limit:'1'}))[0];
 if(!raw)return {status:'source_not_ready'};
 const built=buildCombinedSource(raw);if(!built.ok)return {status:'source_not_ready',reason:built.reason};
 return rpc(repo,'reserve_sec_combined_offering',{p_binding:durableBinding(rawItemId,built.source)});
}
export async function hydrateCombined(binding:DurableBinding,repo:Repository){
 const raw=(await select(repo,'raw_items',{id:`eq.${binding.rawItemId}`,select:'*',limit:'1'}))[0];
 if(!raw)throw Error('combined_raw_unavailable');const built=buildCombinedSource(raw);
 if(!built.ok||stable(durableBinding(raw.id,built.source))!==stable(binding))throw Error('combined_source_binding_mismatch');
 return {...binding,source:built.source};
}
/** Administrator history only. Raw output remains inspectable even when current source hydration fails. */
export async function readCommonInvocation(run:Record<string,any>,repo:Repository){
 const parent=(await select(repo,'ai_runs',{id:`eq.${run.metadata.combinedInvocationId}`,prompt_key:`eq.${PURPOSE}`,select:'*',limit:'1'}))[0];
 const b=parent?.metadata.binding,cp=parent?.metadata.combinedCheckpoint;
 const expectedId=run.prompt_key==='sec_os_snapshot'?b?.osRunId:run.prompt_key==='sec_offering_plan'?b?.offeringRunId:null;
 if(!parent||parent.metadata.combinedStatus!=='COMPLETE'||expectedId!==run.id||parent.raw_item_id!==run.raw_item_id)throw Error('combined_history_mismatch');
 const output=(await select(repo,'ai_outputs',{ai_run_id:`eq.${parent.id}`,output_type:`eq.${PURPOSE}`,select:'payload',limit:'1'}))[0]?.payload;
 if(!cp||stable(cp)!==stable(output)||sha(cp.provider?.rawBytesBase64?Buffer.from(cp.provider.rawBytesBase64,'base64'):cp.raw)!==cp.rawHash)throw Error('combined_history_output_mismatch');
 return {id:String(parent.id),raw:String(cp.raw),rawHash:String(cp.rawHash),osRunId:String(b.osRunId),offeringRunId:String(b.offeringRunId)};
}
/** Domain views are not independent invocations. Resolve the immutable common parent. */
export async function readCombinedDomainSource(run:Record<string,any>,repo:Repository){
 if(run.metadata?.executionKind!=='derived_domain_view')throw Error('combined_domain_kind_invalid');
 const parent=(await select(repo,'ai_runs',{id:`eq.${run.metadata.combinedInvocationId}`,prompt_key:`eq.${PURPOSE}`,select:'*',limit:'1'}))[0];
 if(!parent||parent.metadata.combinedStatus!=='COMPLETE'||parent.status!=='succeeded')throw Error('combined_parent_unavailable');
 const b=parent.metadata.binding as DurableBinding;
 const domain=run.prompt_key==='sec_os_snapshot'?'os':run.prompt_key==='sec_offering_plan'?'offering':null;
 if(!domain||run.id!==(domain==='os'?b.osRunId:b.offeringRunId)||run.raw_item_id!==parent.raw_item_id
  ||parent.id!==b.id||parent.raw_item_id!==b.rawItemId||run.prompt_version!==b.contractVersion||run.model!=='derived-domain-view')throw Error('combined_domain_binding_mismatch');
 const filing=domain==='os'?Object.fromEntries(Object.entries(b.filing).filter(([k])=>!['accepted_at','file_number','registration_number'].includes(k))):b.filing;
 const expectedBinding={...b,id:run.id,key:sha(b.key+':'+domain),source:{filing,ticker:b.ticker}};
 if(stable(run.metadata.binding)!==stable(expectedBinding))throw Error('combined_domain_binding_mismatch');
 const output=(await select(repo,'ai_outputs',{ai_run_id:`eq.${parent.id}`,output_type:`eq.${PURPOSE}`,select:'payload',limit:'1'}))[0]?.payload;
 const cp=parent.metadata.combinedCheckpoint;
 if(!output||stable(output)!==stable(cp)||cp.status!=='COMPLETE'
  ||sha(cp.provider?.rawBytesBase64?Buffer.from(cp.provider.rawBytesBase64,'base64'):cp.raw)!==cp.rawHash)throw Error('combined_parent_output_mismatch');
 const source=(await hydrateCombined(b,repo)).source;
 const validation=!cp.provider?.integrityError&&cp.raw?validateCombinedResponse(cp.raw,source,combinedBinding(b.rawItemId,source)):null;
 const expectedValidation=validation?{os_snapshot:validation.os_snapshot,offering_plan:validation.offering_plan}:null;
 if(stable(cp.validation)!==stable(expectedValidation))throw Error('combined_parent_validation_mismatch');
 const part=validation?.[domain==='os'?'os_snapshot':'offering_plan']??null;
 const value=part?.ok&&part.value?{version:domain==='os'?'os_snapshot_v1':'offering_plan_v1',filing,...part.value}:null;
 const status=value?.status??'VALIDATION_FAILED';
 const expected={status,validated:value,validation:part,rawHash:cp.rawHash,combinedInvocationId:parent.id,domain,provider:{providerInvoked:false,retrySafe:false}};
 const child=(await select(repo,'ai_outputs',{ai_run_id:`eq.${run.id}`,output_type:`eq.${run.prompt_key}`,select:'payload',limit:'1'}))[0]?.payload;
 if(stable(child)!==stable(expected)||stable(run.metadata[domain==='os'?'osCheckpoint':'offeringCheckpoint'])!==stable(expected)
  ||run.metadata[domain==='os'?'osStatus':'offeringStatus']!==status
  ||run.status!==(status==='VALIDATION_FAILED'?'failed':'succeeded'))throw Error('combined_domain_projection_mismatch');
 return {parent,source,value};
}
