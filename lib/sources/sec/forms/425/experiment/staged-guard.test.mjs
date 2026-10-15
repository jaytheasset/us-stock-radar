import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {sendSec425StageOnce} from './staged-guard.mjs';import {durableNew,sha256} from './round2-guard.mjs';
function fixture(){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sec425-stages-'));fs.mkdirSync(path.join(directory,'ledger'));
 const slots=['diana','axcelis'].flatMap(c=>['router','primary','fact'].map(s=>({key:c+'-'+s,models:['gemini-2.5-flash']})));
 durableNew(path.join(directory,'plan.json'),{version:'sec425-six-stages-v1',maxRequests:6,slots});const planHash=sha256(fs.readFileSync(path.join(directory,'plan.json')));
 for(const{key}of slots){durableNew(path.join(directory,key+'-prompt.json'),{synthetic:true});durableNew(path.join(directory,key+'-request.json'),{generationConfig:{temperature:0,maxOutputTokens:5000,thinkingConfig:{thinkingBudget:0}}});durableNew(path.join(directory,key+'-prepared.json'),{key,model:'gemini-2.5-flash',planHash,promptSha256:sha256(fs.readFileSync(path.join(directory,key+'-prompt.json'))),requestSha256:sha256(fs.readFileSync(path.join(directory,key+'-request.json')))});}
 return{directory,planHash,apiKey:'synthetic-secret',model:'gemini-2.5-flash',validate:()=>({ok:true,runPrimary:true}),slots};}
const response=()=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'{}'}]}}]});
test('six unique one-attempt slots, duplicate/restart/seventh prohibited; reservation precedes HTTP',async()=>{const f=fixture();let calls=0;
 const fetchImpl=async()=>{calls++;assert.ok(fs.readdirSync(path.join(f.directory,'ledger')).filter(n=>n.startsWith('attempt-')).length===calls);return response();};
 for(const s of f.slots)await sendSec425StageOnce({...f,key:s.key,fetchImpl});
 await assert.rejects(sendSec425StageOnce({...f,key:'diana-router',fetchImpl}),/consumed/);await assert.rejects(sendSec425StageOnce({...f,key:'other-router',fetchImpl}),/outside/);assert.equal(calls,6);});
for(const kind of ['transport','http','MAX_TOKENS','schema'])test(`${kind} consumes slot and halts every remaining stage`,async()=>{const f=fixture();let calls=0;const fetchImpl=async()=>{calls++;if(kind==='transport')throw Error('failure');if(kind==='http')return new Response('{}',{status:503});if(kind==='MAX_TOKENS')return Response.json({candidates:[{finishReason:'MAX_TOKENS'}]});return response();};
 await assert.rejects(sendSec425StageOnce({...f,key:'diana-router',fetchImpl,validate:()=>({ok:kind!=='schema'})}),/halted/);await assert.rejects(sendSec425StageOnce({...f,key:'axcelis-router',fetchImpl}),/halted/);assert.equal(calls,1);});
test('concurrent sends cannot reserve duplicate; missing result remains fail-closed',async()=>{const f=fixture();let release;const hold=new Promise(r=>release=r);let calls=0;
 const a=sendSec425StageOnce({...f,key:'diana-router',fetchImpl:async()=>{calls++;await hold;return response();}});await assert.rejects(sendSec425StageOnce({...f,key:'diana-router',fetchImpl:async()=>{calls++;return response();}}),/EEXIST/);release();await a;assert.equal(calls,1);
 durableNew(path.join(f.directory,'ledger','attempt-axcelis-router.json'),{key:'axcelis-router',planHash:f.planHash});await assert.rejects(sendSec425StageOnce({...f,key:'diana-fact',fetchImpl:async()=>{calls++;return response();}}),/uncertain/);assert.equal(calls,1);});
test('Primary requires genuine prior result policy; Router skip does not consume independent FACT slot',async()=>{const f=fixture();let calls=0;const fetchImpl=async()=>{calls++;return response();};
 await assert.rejects(sendSec425StageOnce({...f,key:'diana-primary',fetchImpl}),/authorized/);
 await sendSec425StageOnce({...f,key:'diana-router',fetchImpl,validate:()=>({ok:true,runPrimary:false})});await assert.rejects(sendSec425StageOnce({...f,key:'diana-primary',fetchImpl}),/authorized/);
 await sendSec425StageOnce({...f,key:'diana-fact',fetchImpl});assert.equal(calls,2);});
