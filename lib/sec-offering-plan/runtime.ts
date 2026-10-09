import {sha,validateOutput,evidenceRefs} from './contract.ts';
import type {Binding} from './source.ts';
import {repository,rpc,loadOfferingSource,type Repository} from './repository.ts';
import type {ProviderResult as OsProviderResult} from '../sec-os-snapshot/runtime.ts';
export type ProviderResult=OsProviderResult&{rawBytesBase64?:string};
export interface OfferingProvider {journalId?:string;run(binding:Binding,attempt:number,recoverOnly?:boolean):Promise<ProviderResult>}
/** Same ai_runs lease/checkpoint protocol as O/S; the domain validator is separate. */
export async function processOfferingPlan(id:string,provider:OfferingProvider,supplied?:Repository){
 const repo=supplied??await repository();
 const claimed=await rpc(repo,'sec_offering_plan_transition',{p_id:id,p_action:'claim'});if(!claimed.claimed){
  if(!supplied&&['PASS','REVIEW_REQUIRED'].includes(claimed.status))await (await import('../projected-offering-dilution/repository.ts')).refreshProjectedForRun(id);
  return {status:claimed.status};
 }
 const token=String(claimed.token),transition=(action:string,value?:unknown)=>rpc(repo,'sec_offering_plan_transition',{p_id:id,p_action:action,p_token:token,p_value:value??null});
 let leaseError:unknown;const heartbeat=setInterval(()=>{void transition('heartbeat').catch(e=>{leaseError=e;});},20000);
 try{
  if(!claimed.checkpoint){
   let binding:Binding;
   try{binding=await loadOfferingSource(claimed.binding,repo);}catch{
    // No invocation intent or provider journal is created for an unavailable/mismatched source.
    const cp={status:'TECHNICAL_FAILED',raw:'',rawHash:sha(''),validated:null,
     validation:{ok:false,stage:'pre_provider_source',errors:['offering_source_unavailable_or_mismatch'],value:null,meaning:'NOT_ASSESSED'},
     provider:{raw:'',technicalError:'offering_source_unavailable_or_mismatch',retrySafe:false,providerInvoked:false},evidenceRefs:[]};
    if(leaseError)throw leaseError;await transition('checkpoint',cp);const saved=await transition('finish');return {status:saved.status};
   }
   const permit=await transition('provider_started',{journalId:provider.journalId??'injected-test-provider'});
   const result=await provider.run(binding,Number(claimed.attempt),permit.recoverOnly===true);
   const hasOutput=Boolean(result.raw||result.rawBytesBase64);
   const validation=hasOutput?result.integrityError?{ok:false,stage:'source_output_integrity',errors:[result.integrityError],value:null,meaning:'NOT_ASSESSED'}:validateOutput(result.raw,binding.source,binding.contractVersion):null;
   const status=hasOutput?validation?.ok?validation.value!.status:'VALIDATION_FAILED':'TECHNICAL_FAILED';
   const cp={status,raw:result.raw,rawHash:sha(result.rawBytesBase64?Buffer.from(result.rawBytesBase64,'base64'):result.raw),validated:validation?.value??null,validation,provider:result,evidenceRefs:validation?.value?evidenceRefs(validation.value):[]};
   if(leaseError)throw leaseError;await transition('checkpoint',cp);
  }
  const saved=await transition('finish');
  if(!supplied&&['PASS','REVIEW_REQUIRED'].includes(saved.status))await (await import('../projected-offering-dilution/repository.ts')).refreshProjectedForRun(id);
  return {status:saved.status};
 }finally{clearInterval(heartbeat);}
}
