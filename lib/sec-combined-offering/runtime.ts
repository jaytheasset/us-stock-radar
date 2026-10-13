import {offeringPlanRunSaved} from '../monitor/offeringPlanTrigger.ts';
import {osSnapshotRunSaved} from '../sec-os-snapshot/historyPublication.ts';
import {sha} from '../sec-os-snapshot/contract.ts';
import type {OfferingProvider} from '../sec-offering-plan/runtime.ts';
import {combinedBinding,validateCombinedResponse} from './contract.ts';
import {hydrateCombined,repository,rpc,type Repository} from './repository.ts';
export async function processCombinedOffering(id:string,provider:OfferingProvider,supplied?:Repository){
 const repo=supplied??await repository(),claimed=await rpc(repo,'sec_combined_offering_transition',{p_id:id,p_action:'claim'});
 if(!claimed.claimed){if(claimed.status==='COMPLETE')await offeringPlanRunSaved(id,repo);return {status:claimed.status,...(claimed.status==='COMPLETE'?{historyPublication:await osSnapshotRunSaved(id,repo)}:{})};}
 const token=String(claimed.token),transition=(action:string,value?:unknown)=>rpc(repo,'sec_combined_offering_transition',{p_id:id,p_action:action,p_token:token,p_value:value??null});
 let leaseError:unknown;const heartbeat=setInterval(()=>{void transition('heartbeat').catch(e=>{leaseError=e;});},20000);
 try{
  if(!claimed.checkpoint){
   let binding;
   try{binding=await hydrateCombined(claimed.binding,repo);}catch{
    await transition('checkpoint',{status:'TECHNICAL_FAILED',raw:'',rawHash:sha(''),providerInvoked:false,reason:'source_unavailable_or_mismatch'});
    return await transition('finish');
   }
   const permit=await transition('provider_started',{journalId:provider.journalId??'injected-test-provider'});
   const result=await provider.run(binding,1,permit.recoverOnly===true);
   const validation=!result.integrityError&&result.raw?validateCombinedResponse(result.raw,binding.source,combinedBinding(binding.rawItemId,binding.source)):null;
   const {raw:providerRaw,...providerMetadata}=result;
   const cp={status:result.raw||result.rawBytesBase64?'COMPLETE':'TECHNICAL_FAILED',raw:providerRaw,
    rawHash:sha(result.rawBytesBase64?Buffer.from(result.rawBytesBase64,'base64'):result.raw),
    validation:validation?{os_snapshot:validation.os_snapshot,offering_plan:validation.offering_plan}:null,
    provider:{...providerMetadata,retrySafe:false},providerInvoked:true};
   if(leaseError)throw leaseError;await transition('checkpoint',cp);
  }
  const saved=await transition('finish');
  if(saved.status==='COMPLETE')await offeringPlanRunSaved(id,repo);
  return {...saved,...(saved.status==='COMPLETE'?{historyPublication:await osSnapshotRunSaved(id,repo)}:{})};
 }finally{clearInterval(heartbeat);}
}
