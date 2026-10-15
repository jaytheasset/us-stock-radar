import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import {durableNew,sha256,sendPreparedOnce} from './round2-guard.mjs';
import {prepareContinuation,appendReviewedContinuation,readAuthorizedContinuation} from './round2-continuation.mjs';

function fixture(){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sec425-continuation-'));fs.mkdirSync(path.join(directory,'ledger'));
 const write=(name,v)=>durableNew(path.join(directory,name),v);
 const response=JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:'{}'}]}}]});
 write('signed-prompt.json',{responseFormat:{json_schema:{schema:{type:'object',required:['missing']}}}});
 const cases=['signed','background','revised-offer'].map(id=>{write(id+'-request.json',{contents:[]});return {id,model:'gemini-2.5-flash',requestSha256:sha256(fs.readFileSync(path.join(directory,id+'-request.json'))),promptSha256:id==='signed'?sha256(fs.readFileSync(path.join(directory,'signed-prompt.json'))):null};});
 write('plan.json',{version:'sec425-round2-v1',maxRequests:3,cases});
 const expectedPlanSha256=sha256(fs.readFileSync(path.join(directory,'plan.json')));
 write('ledger/attempt-1.json',{number:1,caseId:'signed',planSha256:expectedPlanSha256,requestSha256:cases[0].requestSha256});
 // Synthetic HTTP 200 receipt, not an assertion about the actual first request's missing numeric status.
 write('ledger/result-1.json',{number:1,caseId:'signed',status:'failed_consumes_budget',httpStatus:200,finishReason:'STOP'});
 write('ledger/HALTED.json',{number:1,caseId:'signed',reason:'request_or_output_failed_no_retry'});
 write('signed-response.json',response);write('signed-validation.json',{ok:false,schemaPass:false});
 return {directory,expectedPlanSha256,apiKey:'synthetic-offline-test-key',validateOutput:()=>({ok:false,schemaPass:false}),response};
}
const statusResponse=(status=200)=>new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:'{}'}]}}]}),{status});
const authorize=f=>{const p=prepareContinuation(f.directory);appendReviewedContinuation(f.directory,p.proposalSha256);return p;};
test('proposal alone cannot send; explicit append-only authorization leaves original receipts identical',async()=>{
 const f=fixture(),files=['attempt-1.json','result-1.json','HALTED.json'];const hashes=files.map(n=>sha256(fs.readFileSync(path.join(f.directory,'ledger',n))));let calls=0;
 const proposal=prepareContinuation(f.directory),fetchImpl=async()=>{calls++;return statusResponse();};
 await assert.rejects(sendPreparedOnce({...f,caseId:'background',fetchImpl}),/halted/);assert.equal(calls,0);
 appendReviewedContinuation(f.directory,proposal.proposalSha256);assert.equal(readAuthorizedContinuation(f.directory),true);
 assert.deepEqual(files.map(n=>sha256(fs.readFileSync(path.join(f.directory,'ledger',n)))),hashes);
});
test('two unsent cases can each fail output validation once, while original failed case and total cap remain blocked',async()=>{
 const f=fixture();authorize(f);let calls=0;const fetchImpl=async()=>{calls++;return statusResponse();};
 for(const caseId of ['background','revised-offer']){const r=await sendPreparedOnce({...f,caseId,fetchImpl});assert.equal(r.status,'output_validation_failed');assert.equal(r.validation.ok,false);}
 await assert.rejects(sendPreparedOnce({...f,caseId:'signed',fetchImpl}),/reserved|cap/);
 await assert.rejects(sendPreparedOnce({...f,caseId:'background',fetchImpl}),/reserved|cap/);
 assert.equal(calls,2);assert.equal(fs.readdirSync(path.join(f.directory,'ledger')).filter(n=>/^attempt-/.test(n)).length,3);
});
for(const status of [201,302,429,503])test(`HTTP ${status} after continuation still halts the trial; no next case`,async()=>{
 const f=fixture();authorize(f);let calls=0;const fetchImpl=async()=>{calls++;return statusResponse(status);};
 await assert.rejects(sendPreparedOnce({...f,caseId:'background',fetchImpl}),/halted/);
 await assert.rejects(sendPreparedOnce({...f,caseId:'revised-offer',fetchImpl}),/halted/);assert.equal(calls,1);assert.ok(fs.existsSync(path.join(f.directory,'ledger','HALTED-2.json')));
});
test('timeout/unknown transmission remains halted after continuation',async()=>{
 const f=fixture();authorize(f);let calls=0;const fetchImpl=async()=>{calls++;throw Error('mock timeout');};
 await assert.rejects(sendPreparedOnce({...f,caseId:'background',fetchImpl}),/halted/);
 await assert.rejects(sendPreparedOnce({...f,caseId:'revised-offer',fetchImpl}),/halted/);assert.equal(calls,1);
});
test('a changed original raw response or HALTED receipt invalidates continuation before any transmission',async()=>{
 const f=fixture();authorize(f);fs.appendFileSync(path.join(f.directory,'signed-response.json'),' ');let calls=0;
 await assert.rejects(sendPreparedOnce({...f,caseId:'background',fetchImpl:async()=>{calls++;return statusResponse();}}),/proof_changed/);assert.equal(calls,0);
});
test('missing numeric HTTP status without the exact original guard proof fails closed',()=>{
 const f=fixture();const file=path.join(f.directory,'ledger/result-1.json');const r=JSON.parse(fs.readFileSync(file));delete r.httpStatus;fs.writeFileSync(file,JSON.stringify(r));
 assert.throws(()=>prepareContinuation(f.directory));assert.equal(fs.existsSync(path.join(f.directory,'CONTINUATION-PROPOSAL.json')),false);
});
