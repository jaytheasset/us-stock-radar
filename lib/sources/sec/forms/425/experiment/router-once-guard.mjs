import fs from 'node:fs';import path from 'node:path';
import {durableNew,sha256} from './round2-guard.mjs';
const nativeFetch=globalThis.fetch;
/** New single-call experiment; never reads/resumes another trial's attempt ledger. */
export async function sendRouterOnce({directory,planHash,apiKey,validate,fetchImpl=nativeFetch}){
 const bytes=fs.readFileSync(path.join(directory,'plan.json'));if(sha256(bytes)!==planHash)throw Error('plan_changed');
 const plan=JSON.parse(bytes);
 if(plan.version!=='sec425-router-references-once-v1'||plan.maxRequests!==1||plan.model!=='gemini-2.5-flash-lite'||plan.caseId!=='diana'||!apiKey)throw Error('outside_single_router_plan');
 for(const[p,h]of Object.entries(plan.frozenFiles))if(sha256(fs.readFileSync(p))!==h)throw Error('frozen_input_changed');
 const request=fs.readFileSync(path.join(directory,'request.json'));if(sha256(request)!==plan.requestSha256)throw Error('request_changed');
 const body=JSON.parse(request),config=body.generationConfig;
 if(config.maxOutputTokens!==5000||config.temperature!==0||config.thinkingConfig?.thinkingBudget!==0)throw Error('settings_changed');
 // Exclusive, durable reservation is the whole budget. Failure or uncertainty never releases it.
 const ledger=path.join(directory,'ledger'),started=Date.now();
 durableNew(path.join(ledger,'attempt.json'),{caseId:'diana',stage:'router',planHash,requestSha256:plan.requestSha256,reservedAt:new Date().toISOString()});
 let responseText=null,providerBody=null,status=null;
 try{
  const response=await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${plan.model}:generateContent`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(120000),headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},body:request.toString('utf8')});
  status=response.status;durableNew(path.join(directory,'http-status.json'),{status});responseText=await response.text();
  if(responseText.includes(apiKey))throw Error('secret_echo');durableNew(path.join(directory,'response.json'),responseText);
  providerBody=JSON.parse(responseText);if(status!==200||providerBody.candidates?.length!==1||providerBody.candidates[0].finishReason!=='STOP')throw Error('http_or_generation_failure');
  const parsed=JSON.parse(providerBody.candidates[0].content.parts.filter(p=>p.thought!==true).map(p=>p.text??'').join(''));
  durableNew(path.join(directory,'model-output.json'),parsed);const checked=await validate(parsed);durableNew(path.join(directory,'validation.json'),checked);
  const result={status:checked.ok?'mechanical_pass':'contract_failed',httpStatus:status,model:providerBody.modelVersion,finishReason:providerBody.candidates[0].finishReason,usage:providerBody.usageMetadata??null,latencyMs:Date.now()-started,responseSha256:sha256(responseText),requestSha256:plan.requestSha256};
  durableNew(path.join(ledger,'result.json'),result);return{result,parsed,checked};
 }catch{
  const result={status:'failed_consumes_only_slot',httpStatus:status,usage:providerBody?.usageMetadata??null,latencyMs:Date.now()-started,responseSha256:responseText===null?null:sha256(responseText),requestSha256:plan.requestSha256};
  durableNew(path.join(ledger,'result.json'),result);throw Error('single_router_trial_failed_no_retry');
 }
}
