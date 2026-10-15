import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {sendPreparedOnce,sha256,durableNew} from './round2-guard.mjs';

const key='synthetic-test-key-never-live';
function fixture(){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sec425-round2-guard-'));fs.mkdirSync(path.join(directory,'ledger'));
 const cases=['signed','background','revised-offer'].map(id=>{
  const request=JSON.stringify({contents:[{parts:[{text:'synthetic offline fixture'}]}]});durableNew(path.join(directory,id+'-request.json'),request);
  return {id,model:'gemini-2.5-flash',requestSha256:sha256(request)};
 });
 durableNew(path.join(directory,'plan.json'),{version:'sec425-round2-v1',maxRequests:3,cases});
 return {directory,expectedPlanSha256:sha256(fs.readFileSync(path.join(directory,'plan.json'))),apiKey:key,validateOutput:()=>({ok:true})};
}
const success=()=>new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:'{"synthetic":true}'}]}}],usageMetadata:{promptTokenCount:1,candidatesTokenCount:1}}),{status:200});
const attemptCount=dir=>fs.readdirSync(path.join(dir,'ledger')).filter(n=>/^attempt-/.test(n)).length;
// All fetches below are mocks. Test temp dirs are retained as immutable receipts, not recursively deleted.
test('reservation is durable before fetch; settings prevent redirect; restart cannot resend',async()=>{
 const f=fixture();let calls=0;
 const fetchImpl=async(url,init)=>{calls++;assert.equal(attemptCount(f.directory),1);assert.equal(init.redirect,'error');assert.equal(init.method,'POST');assert.match(url,/^https:\/\/generativelanguage.googleapis.com\/v1beta\/models\/gemini-2.5-flash:generateContent$/);assert.equal(init.headers['x-goog-api-key'],key);return success();};
 await sendPreparedOnce({...f,caseId:'signed',fetchImpl});
 await assert.rejects(sendPreparedOnce({...f,caseId:'signed',fetchImpl}),/case_already_reserved/);assert.equal(calls,1);
 for(const file of fs.readdirSync(path.join(f.directory,'ledger')).filter(n=>n.endsWith('.json')))assert.equal(fs.readFileSync(path.join(f.directory,'ledger',file),'utf8').includes(key),false);
});
test('three cases consume total allowance; fourth and duplicate never transmit',async()=>{
 const f=fixture();let calls=0;const fetchImpl=async()=>{calls++;return success();};
 for(const caseId of ['signed','background','revised-offer'])await sendPreparedOnce({...f,caseId,fetchImpl});
 await assert.rejects(sendPreparedOnce({...f,caseId:'signed',fetchImpl}));await assert.rejects(sendPreparedOnce({...f,caseId:'fourth',fetchImpl}));assert.equal(calls,3);assert.equal(attemptCount(f.directory),3);
});
for(const [label,response] of [['429',()=>new Response('{}',{status:429})],['503',()=>new Response('{}',{status:503})],['redirect',()=>new Response('',{status:302,headers:{location:'https://example.invalid'}})],['invalid JSON',()=>new Response('{')],['non STOP',()=>new Response(JSON.stringify({candidates:[{finishReason:'MAX_TOKENS'}]}))],['transport failure',()=>{throw Error('synthetic transport failure');}]]){
 test(`${label} consumes one reservation and halts all subsequent cases with zero retry`,async()=>{
  const f=fixture();let calls=0;const fetchImpl=async()=>{calls++;return response();};
  await assert.rejects(sendPreparedOnce({...f,caseId:'signed',fetchImpl}),/halted/);
  await assert.rejects(sendPreparedOnce({...f,caseId:'background',fetchImpl}),/halted/);assert.equal(calls,1);assert.equal(attemptCount(f.directory),1);
 });
}
test('schema/evidence validation failure consumes budget and cannot call another case',async()=>{
 const f=fixture();let calls=0;const fetchImpl=async()=>{calls++;return success();};
 await assert.rejects(sendPreparedOnce({...f,caseId:'signed',fetchImpl,validateOutput:()=>({ok:false})}),/halted/);
 await assert.rejects(sendPreparedOnce({...f,caseId:'background',fetchImpl}),/halted/);assert.equal(calls,1);
});
test('changed plan/request and unknown case are blocked before reservation',async()=>{
 const f=fixture();let calls=0;const fetchImpl=async()=>{calls++;return success();};
 await assert.rejects(sendPreparedOnce({...f,caseId:'signed',expectedPlanSha256:'0'.repeat(64),fetchImpl}),/digest/);
 fs.appendFileSync(path.join(f.directory,'signed-request.json'),' ');
 await assert.rejects(sendPreparedOnce({...f,caseId:'signed',fetchImpl}),/digest/);assert.equal(calls,0);assert.equal(attemptCount(f.directory),0);
});
test('crash/stale lock is never automatically cleared',async()=>{
 const f=fixture();fs.mkdirSync(path.join(f.directory,'ledger','exclusive.lock'));let calls=0;
 await assert.rejects(sendPreparedOnce({...f,caseId:'signed',fetchImpl:async()=>{calls++;return success();}}),/EEXIST/);
 assert.equal(calls,0);assert.equal(fs.existsSync(path.join(f.directory,'ledger','exclusive.lock')),true);
});
test('unsettled reservation blocks restart even without a lock',async()=>{
 const f=fixture();durableNew(path.join(f.directory,'ledger','attempt-1.json'),{number:1,caseId:'signed',planSha256:f.expectedPlanSha256});let calls=0;
 await assert.rejects(sendPreparedOnce({...f,caseId:'background',fetchImpl:async()=>{calls++;return success();}}),/unsettled/);assert.equal(calls,0);
});
test('two independent processes racing the same filing transmit only once',async()=>{
 const f=fixture();const moduleUrl=new URL('./round2-guard.mjs',import.meta.url).href;
 const code=`import fs from 'node:fs';import path from 'node:path';import {sendPreparedOnce} from ${JSON.stringify(moduleUrl)};try{await sendPreparedOnce({...${JSON.stringify({directory:f.directory,expectedPlanSha256:f.expectedPlanSha256,apiKey:key})},caseId:'signed',validateOutput:()=>({ok:true}),fetchImpl:async()=>{fs.writeFileSync(path.join(${JSON.stringify(f.directory)},'mock-wire-'+process.pid),'one',{flag:'wx'});await new Promise(r=>setTimeout(r,100));return new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:'{}'}]}}]}));}});}catch{process.exitCode=2;}`;
 const child=()=>new Promise(resolve=>{const p=spawn(process.execPath,['--input-type=module','-e',code],{windowsHide:true,stdio:'ignore'});p.on('exit',resolve);});
 const result=await Promise.all([child(),child()]);assert.equal(result.filter(c=>c===0).length,1);assert.equal(fs.readdirSync(f.directory).filter(n=>n.startsWith('mock-wire-')).length,1);assert.equal(attemptCount(f.directory),1);
});
