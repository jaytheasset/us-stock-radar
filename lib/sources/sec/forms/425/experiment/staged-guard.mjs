import fs from 'node:fs';
import path from 'node:path';
import {sha256,durableNew} from './round2-guard.mjs';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const fail=code=>{throw Error(code);};
const nativeFetch=globalThis.fetch;
/** Bounded diagnostic only: two filings × router/primary/fact, durable pre-send reservations. */
export async function sendSec425StageOnce({directory,key,model,planHash,apiKey,validate,fetchImpl=nativeFetch}){
 const planBytes=fs.readFileSync(path.join(directory,'plan.json'));if(sha256(planBytes)!==planHash)fail('plan_changed');
 const plan=JSON.parse(planBytes),slot=plan.slots.find(s=>s.key===key);
 if(plan.version!=='sec425-six-stages-v1'||plan.maxRequests!==6||plan.slots.length!==6||new Set(plan.slots.map(s=>s.key)).size!==6||!slot||!slot.models.includes(model)||!apiKey)fail('outside_stage_plan');
 for(const [name,hash]of Object.entries(plan.frozenFiles??{}))if(sha256(fs.readFileSync(name))!==hash)fail('frozen_input_or_code_changed');
 const requestPath=path.join(directory,key+'-request.json'),requestBytes=fs.readFileSync(requestPath),request=JSON.parse(requestBytes);
 const metadata=read(path.join(directory,key+'-prepared.json'));
 if(metadata.key!==key||metadata.model!==model||metadata.planHash!==planHash||metadata.requestSha256!==sha256(requestBytes)||metadata.promptSha256!==sha256(fs.readFileSync(path.join(directory,key+'-prompt.json'))))fail('prepared_request_changed');
 if(request.generationConfig.temperature!==0||request.generationConfig.maxOutputTokens!==5000||request.generationConfig.thinkingConfig?.thinkingBudget!==0)fail('generation_settings_changed');
 const ledger=path.join(directory,'ledger'),lock=path.join(ledger,'exclusive.lock');fs.mkdirSync(lock);
 let reserved=false,settled=false;
 try{
  if(fs.existsSync(path.join(ledger,'HALTED.json')))fail('trial_halted');
  if(fs.existsSync(path.join(ledger,key+'-skip.json')))fail('stage_skipped');
  const attempts=fs.readdirSync(ledger).filter(n=>/^attempt-.*\.json$/.test(n)).map(n=>read(path.join(ledger,n)));
  if(attempts.length>=6||attempts.some(a=>a.key===key))fail('stage_or_total_budget_consumed');
  for(const a of attempts){
   if(a.planHash!==planHash||!fs.existsSync(path.join(ledger,'result-'+a.key+'.json')))fail('prior_attempt_uncertain');
   const r=read(path.join(ledger,'result-'+a.key+'.json'));
   if(r.status!=='validated'||r.requestSha256!==a.requestSha256||r.responseSha256!==sha256(fs.readFileSync(path.join(directory,a.key+'-response.json'))))fail('prior_attempt_failed_or_changed');
  }
  if(key.endsWith('-primary')){
   const routerKey=key.replace(/primary$/,'router'),p=path.join(ledger,'result-'+routerKey+'.json');
   if(!fs.existsSync(p)||read(p).runPrimary!==true)fail('primary_not_authorized_by_router');
  }
  const started=Date.now(),requestSha256=sha256(requestBytes);
  durableNew(path.join(ledger,'attempt-'+key+'.json'),{key,model,planHash,requestSha256,number:attempts.length+1,at:new Date().toISOString(),status:'reserved_before_fetch'});reserved=true;
  let raw=null,body=null,httpStatus=null;
  try{
   const response=await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},body:requestBytes.toString('utf8'),signal:AbortSignal.timeout(120000)});
   httpStatus=response.status;durableNew(path.join(directory,key+'-http.json'),{key,httpStatus});
   raw=await response.text();if(raw.includes(apiKey))fail('secret_echo_withheld');durableNew(path.join(directory,key+'-response.json'),raw);
   body=JSON.parse(raw);if(httpStatus!==200||body.candidates?.length!==1||body.candidates[0].finishReason!=='STOP')fail('http_protocol_or_incomplete_generation');
   const parsed=JSON.parse(body.candidates[0].content.parts.filter(p=>p.thought!==true).map(p=>p.text??'').join(''));
   durableNew(path.join(directory,key+'-model-output.json'),parsed);
   const validation=await validate(parsed);durableNew(path.join(directory,key+'-validation.json'),validation);
   if(validation.ok!==true)fail('local_output_contract_failed');
   const result={key,model,modelVersion:body.modelVersion,status:'validated',requestSha256,responseSha256:sha256(raw),httpStatus,finishReason:body.candidates[0].finishReason,usage:body.usageMetadata??null,latencyMs:Date.now()-started,runPrimary:validation.runPrimary??null};
   durableNew(path.join(ledger,'result-'+key+'.json'),result);settled=true;return {parsed,validation,result};
  }catch(error){
   const reason=['secret_echo_withheld','http_protocol_or_incomplete_generation','local_output_contract_failed'].includes(error?.message)?error.message:'transport_or_parse_failure';
   durableNew(path.join(ledger,'HALTED.json'),{key,reason,at:new Date().toISOString()});
   durableNew(path.join(ledger,'result-'+key+'.json'),{key,model,status:'failed_consumes_budget',reason,requestSha256,responseSha256:raw===null?null:sha256(raw),httpStatus,usage:body?.usageMetadata??null,latencyMs:Date.now()-started});
   settled=true;fail('trial_halted_no_retry');
  }
 }finally{if(!reserved||settled)fs.rmdirSync(lock);}
}
