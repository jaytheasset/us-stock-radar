import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readAuthorizedContinuation} from './round2-continuation.mjs';

export const sha256=x=>createHash('sha256').update(x).digest('hex');
const nativeFetch=globalThis.fetch;
const fail=code=>{throw Error(code);};
export function durableNew(file,value){
 const fd=fs.openSync(file,'wx');try{fs.writeFileSync(fd,typeof value==='string'?value:JSON.stringify(value,null,2));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));

/** One real fetch, durable reservation BEFORE it; failures consume budget and halt the trial. */
export async function sendPreparedOnce({directory,caseId,expectedPlanSha256,apiKey,validateOutput,fetchImpl=nativeFetch}){
 const planBytes=fs.readFileSync(path.join(directory,'plan.json'));
 if(sha256(planBytes)!==expectedPlanSha256)fail('plan_digest_mismatch');
 const plan=JSON.parse(planBytes);
 if(plan.version!=='sec425-round2-v1'||plan.maxRequests!==3||plan.cases.length!==3||new Set(plan.cases.map(c=>c.id)).size!==3)fail('invalid_frozen_plan');
 const item=plan.cases.find(c=>c.id===caseId);
 if(!item||!['signed','background','revised-offer'].includes(caseId)||!['gemini-2.5-flash','gemini-2.5-flash-lite'].includes(item.model))fail('case_outside_approved_plan');
 if(!apiKey||typeof validateOutput!=='function')fail('credentials_or_validator_missing');
 const requestBytes=fs.readFileSync(path.join(directory,caseId+'-request.json'));
 if(sha256(requestBytes)!==item.requestSha256)fail('request_digest_mismatch');
 const ledger=path.join(directory,'ledger'),lock=path.join(ledger,'exclusive.lock');
 // A stale lock is NEVER cleared automatically. Crash/uncertain send is fail closed.
 fs.mkdirSync(lock);
 let reserved=false,settled=false;
 try{
  const continuation=readAuthorizedContinuation(directory);
  if(fs.existsSync(path.join(ledger,'HALTED.json'))&&!continuation)fail('trial_halted');
  if(fs.readdirSync(ledger).some(n=>/^HALTED-\d+\.json$/.test(n)))fail('trial_halted_after_continuation');
  const names=fs.readdirSync(ledger).filter(n=>/^attempt-[1-3]\.json$/.test(n));
  const attempts=names.map(n=>read(path.join(ledger,n)));
  if(attempts.some(a=>a.planSha256!==expectedPlanSha256)||new Set(attempts.map(a=>a.caseId)).size!==attempts.length)fail('ledger_integrity_failure');
  if(attempts.some(a=>!fs.existsSync(path.join(ledger,`result-${a.number}.json`))))fail('prior_attempt_unsettled');
  if(attempts.some(a=>{
   const r=read(path.join(ledger,`result-${a.number}.json`));
   if(r.caseId!==a.caseId||r.number!==a.number)return true;
   if(continuation&&a.number===1&&a.caseId==='signed'&&r.status==='failed_consumes_budget')return false;
   if(continuation&&r.status==='output_validation_failed')return r.httpStatus!==200||r.finishReason!=='STOP'||sha256(fs.readFileSync(path.join(directory,a.caseId+'-response.json')))!==r.responseSha256||sha256(fs.readFileSync(path.join(directory,a.caseId+'-validation.json')))!==r.validationSha256;
   return r.status!=='received_validated';
  }))fail('prior_attempt_not_validated');
  if(attempts.some(a=>a.caseId===caseId))fail('case_already_reserved');
  if(attempts.length>=3)fail('total_request_cap_reached');
  const number=attempts.length+1;
  durableNew(path.join(ledger,`attempt-${number}.json`),{number,caseId,planSha256:expectedPlanSha256,requestSha256:item.requestSha256,at:new Date().toISOString(),status:'reserved_before_fetch'});
  reserved=true;
  const started=Date.now();
  try{
   const url=`https://generativelanguage.googleapis.com/v1beta/models/${item.model}:generateContent`;
   const response=await fetchImpl(url,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},body:requestBytes.toString('utf8'),signal:AbortSignal.timeout(120000)});
   const raw=await response.text();
   if(raw.includes(apiKey))fail('response_withheld_secret_echo');
   durableNew(path.join(directory,caseId+'-response.json'),raw);
   const body=JSON.parse(raw),finish=body.candidates?.[0]?.finishReason;
   if(response.status!==200||finish!=='STOP'||body.candidates?.length!==1)fail('provider_response_failed_or_ambiguous');
   const text=(body.candidates[0].content?.parts??[]).filter(p=>p.thought!==true).map(p=>p.text??'').join('');
   const parsed=JSON.parse(text); // No markdown repair/fallback/parser value correction.
   const validation=await validateOutput(parsed);
   durableNew(path.join(directory,caseId+'-validation.json'),validation);
   if(validation.ok!==true){
    if(!continuation)fail('output_validation_failed');
    durableNew(path.join(ledger,`result-${number}.json`),{number,caseId,status:'output_validation_failed',httpStatus:response.status,finishReason:finish,usage:body.usageMetadata??null,latencyMs:Date.now()-started,responseSha256:sha256(raw),validationSha256:sha256(fs.readFileSync(path.join(directory,caseId+'-validation.json')))});
    settled=true;return {number,caseId,parsed,body,validation,status:'output_validation_failed'};
   }
   durableNew(path.join(ledger,`result-${number}.json`),{number,caseId,status:'received_validated',httpStatus:response.status,finishReason:finish,usage:body.usageMetadata??null,latencyMs:Date.now()-started,responseSha256:sha256(raw)});
   settled=true;return {number,caseId,parsed,body,validation,status:'received_validated'};
  }catch{
   const haltName=fs.existsSync(path.join(ledger,'HALTED.json'))?`HALTED-${number}.json`:'HALTED.json';
   durableNew(path.join(ledger,haltName),{number,caseId,reason:'request_or_output_failed_no_retry',at:new Date().toISOString()});
   // No raw exception text, response statusText or secret-bearing request headers in receipts.
   durableNew(path.join(ledger,`result-${number}.json`),{number,caseId,status:'failed_consumes_budget',latencyMs:Date.now()-started});
   settled=true;fail('trial_halted_after_reserved_attempt');
  }
 }finally{
  if(!reserved||settled)fs.rmdirSync(lock); // Never recursive. Unsettled reservation keeps its lock.
 }
}
