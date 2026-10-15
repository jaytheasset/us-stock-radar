import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import {sendFactMonitorOnce} from './fact-monitor-guard.mjs';
import {durableNew,sha256} from './round2-guard.mjs';
function fixture(){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sec425-round5-'));fs.mkdirSync(path.join(directory,'ledger'));
  const cases=['signed','background','revised-offer'].map(id=>{durableNew(path.join(directory,id+'-request.json'),{synthetic:true});return {id,model:'gemini-2.5-flash',requestSha256:sha256(fs.readFileSync(path.join(directory,id+'-request.json')))};});
  durableNew(path.join(directory,'plan.json'),{version:'sec425-fact-monitor-v1',maxRequests:3,cases});
  return {directory,expectedPlanSha256:sha256(fs.readFileSync(path.join(directory,'plan.json'))),apiKey:'synthetic-key-never-live',validateOutput:()=>({ok:true})};
}
const response=(text='{}',finishReason='STOP',status=200)=>new Response(JSON.stringify({candidates:[{finishReason,content:{parts:[{text}]}}],usageMetadata:{promptTokenCount:1,candidatesTokenCount:1}}),{status});
test('durable pre-fetch reservations: all three validation failures consume budget; no fourth/duplicate request',async()=>{
  const f=fixture();let calls=0;const fetchImpl=async(url,init)=>{calls++;assert.equal(init.redirect,'error');assert.equal(init.method,'POST');assert.equal(init.signal.aborted,false);assert.ok(fs.existsSync(path.join(f.directory,'ledger',`attempt-${calls}.json`)));return response();};
  for(const caseId of ['signed','background','revised-offer'])assert.equal((await sendFactMonitorOnce({...f,caseId,fetchImpl,validateOutput:()=>({ok:false})})).status,'output_validation_failed');
  await assert.rejects(sendFactMonitorOnce({...f,caseId:'signed',fetchImpl}),/reserved|cap/);await assert.rejects(sendFactMonitorOnce({...f,caseId:'fourth',fetchImpl}),/outside/);assert.equal(calls,3);
});
for(const [name,make] of [['JSON failure',()=>response('{')],['MAX_TOKENS',()=>response('{','MAX_TOKENS')]])test(`${name} consumes slot and permits only an unsent case`,async()=>{
  const f=fixture();let calls=0;const fetchImpl=async()=>{calls++;return calls===1?make():response();};
  assert.equal((await sendFactMonitorOnce({...f,caseId:'signed',fetchImpl})).status,'output_validation_failed');
  assert.equal((await sendFactMonitorOnce({...f,caseId:'background',fetchImpl})).status,'received_validated');assert.equal(calls,2);
});
for(const status of [302,429,503])test(`HTTP ${status} logged and halts without retry`,async()=>{
  const f=fixture();let calls=0;const fetchImpl=async()=>{calls++;return response('{}','STOP',status);};
  await assert.rejects(sendFactMonitorOnce({...f,caseId:'signed',fetchImpl}),/halted/);await assert.rejects(sendFactMonitorOnce({...f,caseId:'background',fetchImpl}),/halted/);assert.equal(calls,1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.directory,'ledger/result-1.json'))).httpStatus,status);
});
test('transport uncertainty halts entire trial and consumes one attempt',async()=>{
  const f=fixture();let calls=0;const fetchImpl=async()=>{calls++;throw Error('synthetic connection failure');};
  await assert.rejects(sendFactMonitorOnce({...f,caseId:'signed',fetchImpl}),/halted/);await assert.rejects(sendFactMonitorOnce({...f,caseId:'background',fetchImpl}),/halted/);assert.equal(calls,1);
});
test('digest changes and stale lock block dispatch',async()=>{
  const f=fixture();let calls=0;const fetchImpl=async()=>{calls++;return response();};
  await assert.rejects(sendFactMonitorOnce({...f,caseId:'signed',expectedPlanSha256:'0'.repeat(64),fetchImpl}),/digest/);
  fs.appendFileSync(path.join(f.directory,'signed-request.json'),' ');await assert.rejects(sendFactMonitorOnce({...f,caseId:'signed',fetchImpl}),/digest/);
  fs.mkdirSync(path.join(f.directory,'ledger/exclusive.lock'));await assert.rejects(sendFactMonitorOnce({...f,caseId:'background',fetchImpl}),/EEXIST/);assert.equal(calls,0);
});
test('cross-process race and restart cannot resend a case',async()=>{
  const f=fixture(),moduleUrl=new URL('./fact-monitor-guard.mjs',import.meta.url).href;
  const code=`import fs from 'node:fs';import path from 'node:path';import {sendFactMonitorOnce} from ${JSON.stringify(moduleUrl)};try{await sendFactMonitorOnce({...${JSON.stringify({directory:f.directory,expectedPlanSha256:f.expectedPlanSha256,apiKey:f.apiKey})},caseId:'signed',validateOutput:()=>({ok:true}),fetchImpl:async()=>{fs.writeFileSync(path.join(${JSON.stringify(f.directory)},'mock-'+process.pid),'one',{flag:'wx'});await new Promise(r=>setTimeout(r,80));return new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:'{}'}]}}]}));}});}catch{process.exitCode=2;}`;
  const child=()=>new Promise(resolve=>{const p=spawn(process.execPath,['--input-type=module','-e',code],{stdio:'ignore',windowsHide:true});p.on('exit',resolve);});
  const results=await Promise.all([child(),child()]);assert.equal(results.filter(c=>c===0).length,1);assert.equal(await child(),2);assert.equal(fs.readdirSync(f.directory).filter(n=>n.startsWith('mock-')).length,1);
});
