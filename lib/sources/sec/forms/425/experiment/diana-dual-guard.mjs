import fs from 'node:fs';import path from 'node:path';
import {sha256,durableNew} from './round2-guard.mjs';
const nativeFetch=globalThis.fetch,read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
/** Diagnostic only: independent Primary and FACT slots. No retries or production runner. */
export async function sendDianaAnalysisOnce({directory,stage,planHash,apiKey,validate,fetchImpl=nativeFetch}){
 const planBytes=fs.readFileSync(path.join(directory,'plan.json'));if(sha256(planBytes)!==planHash)throw Error('shared_plan_changed');
 const plan=JSON.parse(planBytes),slot=plan.slots?.find(s=>s.stage===stage);
 if(plan.version!=='sec425-diana-independent-two-v1'||plan.maxRequests!==2||plan.slots.length!==2||new Set(plan.slots.map(s=>s.stage)).size!==2||!['primary','fact'].includes(stage)||!slot||!['gemini-2.5-flash','gemini-2.5-flash-lite'].includes(slot.model)||!apiKey)throw Error('outside_two_slot_plan');
 for(const[p,h]of Object.entries(plan.frozenFiles))if(sha256(fs.readFileSync(p))!==h)throw Error('shared_input_integrity_failure');
 const request=fs.readFileSync(path.join(directory,stage+'-request.json'));if(sha256(request)!==slot.requestSha256)throw Error('request_changed');
 const config=JSON.parse(request).generationConfig;if(config.maxOutputTokens!==5000||config.temperature!==0||config.thinkingConfig?.thinkingBudget!==0)throw Error('settings_changed');
 const ledger=path.join(directory,'ledger'),lock=path.join(ledger,'exclusive.lock');fs.mkdirSync(lock);
 let reserved=false,settled=false;
 try{
  if(fs.existsSync(path.join(ledger,'COMMON-HALT.json')))throw Error('common_failure_halted');
  const attempts=fs.readdirSync(ledger).filter(n=>/^attempt-(primary|fact)\.json$/.test(n)).map(n=>read(path.join(ledger,n)));
  if(attempts.length>=2||attempts.some(a=>a.stage===stage))throw Error('slot_consumed');
  for(const a of attempts){
   if(a.planHash!==planHash||!fs.existsSync(path.join(ledger,'result-'+a.stage+'.json')))throw Error('prior_attempt_uncertain');
   const r=read(path.join(ledger,'result-'+a.stage+'.json'));
   if(r.responseSha256&&fs.existsSync(path.join(directory,a.stage+'-response.json'))&&sha256(fs.readFileSync(path.join(directory,a.stage+'-response.json')))!==r.responseSha256)throw Error('prior_response_changed');
  }
  const started=Date.now();durableNew(path.join(ledger,'attempt-'+stage+'.json'),{stage,planHash,model:slot.model,requestSha256:slot.requestSha256,at:new Date().toISOString(),number:attempts.length+1});reserved=true;
  let raw=null,body=null,status=null,reason=null,parsed=null,checked=null;
  try{
   const response=await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${slot.model}:generateContent`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(120000),headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},body:request.toString('utf8')});
   status=response.status;durableNew(path.join(directory,stage+'-http.json'),{status});raw=await response.text();
   if(raw.includes(apiKey)){durableNew(path.join(ledger,'COMMON-HALT.json'),{stage,reason:'secret_echo_withheld'});throw Error('secret_echo');}
   durableNew(path.join(directory,stage+'-response.json'),raw);
   if(status===401||status===403)durableNew(path.join(ledger,'COMMON-HALT.json'),{stage,reason:'authentication_or_access_failure',httpStatus:status});
   body=JSON.parse(raw);if(status!==200)throw Error('http_failure');
   if(body.candidates?.length!==1||body.candidates[0].finishReason!=='STOP')throw Error('incomplete_generation');
   const outputText=body.candidates[0].content.parts.filter(p=>p.thought!==true).map(p=>p.text??'').join('');durableNew(path.join(directory,stage+'-output-text.txt'),outputText);
   parsed=JSON.parse(outputText);durableNew(path.join(directory,stage+'-model-output.json'),parsed);
   try{checked=await validate(parsed);}catch{checked={ok:false,error:'local_validation_exception_no_repair'};}
   durableNew(path.join(directory,stage+'-validation.json'),checked);
   if(!checked.ok)reason='local_output_validation_failed';
  }catch(error){reason=['http_failure','incomplete_generation','secret_echo'].includes(error?.message)?error.message:'transport_or_model_json_failure';}
  const result={stage,status:reason?'failed_consumes_slot':'mechanical_pass',reason,httpStatus:status,model:body?.modelVersion??slot.model,finishReason:body?.candidates?.[0]?.finishReason??null,
   usage:body?.usageMetadata??null,latencyMs:Date.now()-started,responseSha256:raw===null?null:sha256(raw),requestSha256:slot.requestSha256,
   independentOtherSlotAllowed:!fs.existsSync(path.join(ledger,'COMMON-HALT.json'))};
  durableNew(path.join(ledger,'result-'+stage+'.json'),result);settled=true;return{result,parsed,checked};
 }finally{if(!reserved||settled)fs.rmdirSync(lock);}
}
