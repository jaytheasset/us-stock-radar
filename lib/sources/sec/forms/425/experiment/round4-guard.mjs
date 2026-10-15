// Same bounded reservation/lock pattern as round2; no continuation or retry framework.
import fs from 'node:fs';
import path from 'node:path';
import {sha256,durableNew} from './round2-guard.mjs';
const nativeFetch=globalThis.fetch;
const fail=code=>{throw Error(code);};
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));

export async function sendRound4Once({directory,caseId,expectedPlanSha256,apiKey,validateOutput,fetchImpl=nativeFetch}){
 const planBytes=fs.readFileSync(path.join(directory,'plan.json'));
 if(sha256(planBytes)!==expectedPlanSha256)fail('plan_digest_mismatch');
 const plan=JSON.parse(planBytes),item=plan.cases.find(c=>c.id===caseId);
 if(plan.version!=='sec425-round4-combined-v1'||plan.maxRequests!==3||plan.cases.length!==3||new Set(plan.cases.map(c=>c.id)).size!==3||!item||!['signed','background','revised-offer'].includes(caseId)||!['gemini-2.5-flash','gemini-2.5-flash-lite'].includes(item.model))fail('outside_frozen_plan');
 if(!apiKey||typeof validateOutput!=='function')fail('credentials_or_validator_missing');
 const requestBytes=fs.readFileSync(path.join(directory,caseId+'-request.json'));
 if(sha256(requestBytes)!==item.requestSha256)fail('request_digest_mismatch');
 const ledger=path.join(directory,'ledger'),lock=path.join(ledger,'exclusive.lock');fs.mkdirSync(lock);
 let reserved=false,settled=false;
 try{
  if(fs.existsSync(path.join(ledger,'HALTED.json')))fail('transport_or_protocol_halted');
  const attempts=fs.readdirSync(ledger).filter(n=>/^attempt-[1-3]\.json$/.test(n)).map(n=>read(path.join(ledger,n)));
  if(new Set(attempts.map(a=>a.caseId)).size!==attempts.length||attempts.some(a=>a.planSha256!==expectedPlanSha256))fail('ledger_integrity_failure');
  for(const a of attempts){
   const file=path.join(ledger,`result-${a.number}.json`);if(!fs.existsSync(file))fail('prior_attempt_unsettled');const r=read(file);
   if(!['received_validated','output_validation_failed'].includes(r.status)||r.caseId!==a.caseId||r.number!==a.number||r.httpStatus!==200||typeof r.finishReason!=='string'||!r.finishReason||r.status==='received_validated'&&r.finishReason!=='STOP'||sha256(fs.readFileSync(path.join(directory,a.caseId+'-response.json')))!==r.responseSha256||sha256(fs.readFileSync(path.join(directory,a.caseId+'-validation.json')))!==r.validationSha256)fail('prior_attempt_unsettled_or_changed');
  }
  if(attempts.some(a=>a.caseId===caseId))fail('case_already_reserved');if(attempts.length>=3)fail('total_cap_reached');
  const number=attempts.length+1,start=Date.now();let httpStatus=null,body=null,raw=null;
  durableNew(path.join(ledger,`attempt-${number}.json`),{number,caseId,planSha256:expectedPlanSha256,requestSha256:item.requestSha256,at:new Date().toISOString(),status:'reserved_before_fetch'});reserved=true;
  try{
   const response=await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${item.model}:generateContent`,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},body:requestBytes.toString('utf8'),signal:AbortSignal.timeout(120000)});
   httpStatus=response.status;durableNew(path.join(directory,caseId+'-http-status.json'),{number,caseId,httpStatus,at:new Date().toISOString()});
   raw=await response.text();if(raw.includes(apiKey))fail('response_withheld_secret_echo');durableNew(path.join(directory,caseId+'-response.json'),raw);
   body=JSON.parse(raw);if(httpStatus!==200||body.candidates?.length!==1||typeof body.candidates[0].finishReason!=='string'||!body.candidates[0].finishReason)fail('provider_http_or_protocol_failure');
   let parsed=null,validation;
   if(body.candidates[0].finishReason!=='STOP')validation={ok:false,error:'complete_response_generation_not_STOP',corrected:false};
   else try{parsed=JSON.parse(body.candidates[0].content.parts.filter(p=>p.thought!==true).map(p=>p.text??'').join(''));}catch{validation={ok:false,modelJsonParsePass:false,error:'complete_model_output_not_strict_json',corrected:false};}
   if(!validation){try{validation=await validateOutput(parsed);}catch{validation={ok:false,error:'local_validation_exception_no_repair',corrected:false};}}
   durableNew(path.join(directory,caseId+'-validation.json'),validation);
   const status=validation.ok===true?'received_validated':'output_validation_failed';
   durableNew(path.join(ledger,`result-${number}.json`),{number,caseId,status,httpStatus,finishReason:body.candidates[0].finishReason,usage:body.usageMetadata??null,latencyMs:Date.now()-start,responseSha256:sha256(raw),validationSha256:sha256(fs.readFileSync(path.join(directory,caseId+'-validation.json')))});
   settled=true;return {number,caseId,status,parsed,body,validation};
  }catch{
   durableNew(path.join(ledger,'HALTED.json'),{number,caseId,reason:'transport_or_protocol_failure_no_retry',at:new Date().toISOString()});
   durableNew(path.join(ledger,`result-${number}.json`),{number,caseId,status:'transport_or_protocol_failed_consumes_budget',httpStatus,finishReason:body?.candidates?.[0]?.finishReason??null,usage:body?.usageMetadata??null,latencyMs:Date.now()-start,responseSha256:raw===null?null:sha256(raw)});
   settled=true;fail('trial_halted_after_reserved_request');
  }
 }finally{if(!reserved||settled)fs.rmdirSync(lock);}
}
