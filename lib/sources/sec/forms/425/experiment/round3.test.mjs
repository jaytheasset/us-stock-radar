import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import Ajv from 'ajv';
import {buildRound2Prompt,round2EventsSchema} from './round2.ts';
import {buildEventOnly,auditEmptyEventContract} from './round3-event-only.mjs';
import {sendEventOnlyOnce} from './round3-guard.mjs';
import {durableNew,sha256} from './round2-guard.mjs';

function prompts(){
 const b={block_id:'synthetic-1',source_ref:'primary',heading:null,text:'Synthetic proposal was submitted. It is non-binding.'};
 const primary={key:'primary',version:'v1',system:'Write Primary analysis_output and score.',user:JSON.stringify({cleaned_source_blocks:[b],router_result:{display_type:'generic'},analysis_source_selection:{mode:'old'}}),responseFormat:{type:'json_schema',json_schema:{name:'primary',strict:true,schema:{type:'object',additionalProperties:false,required:['analysis_output'],properties:{analysis_output:{type:'object'}}}}}};
 const prompt=buildRound2Prompt(primary,[b],[b.block_id]).prompt;
 const request={systemInstruction:{parts:[{text:prompt.system}]},contents:[{role:'user',parts:[{text:prompt.user}]}],generationConfig:{responseMimeType:'application/json',responseSchema:structuredClone(prompt.responseFormat.json_schema.schema),temperature:0,thinkingConfig:{thinkingBudget:0},maxOutputTokens:5000}};
 return {prompt,request};
}
test('Primary removal alone: user bytes, event contracts and generation settings unchanged',()=>{
 const old=prompts(),snapshot=JSON.stringify(old),next=buildEventOnly(old.prompt,old.request);
 assert.equal(JSON.stringify(old),snapshot);assert.equal(next.prompt.user,old.prompt.user);assert.deepEqual(next.request.contents,old.request.contents);
 assert.deepEqual(next.prompt.responseFormat.json_schema.schema.properties.filing_events,round2EventsSchema);
 assert.deepEqual(next.request.generationConfig.responseSchema.properties.filing_events,old.request.generationConfig.responseSchema.properties.filing_events);
 assert.deepEqual(Object.keys(next.prompt.responseFormat.json_schema.schema.properties),['filing_events']);
 assert.equal(next.request.generationConfig.maxOutputTokens,5000);assert.equal(next.request.generationConfig.temperature,0);assert.equal(next.request.generationConfig.thinkingConfig.thinkingBudget,0);
 assert.equal(/Primary|BOTH|snapshot_items/.test(next.prompt.system),false);
 assert.ok(next.instructionDiff.some(d=>d.reason==='remove_original_Primary_task'));
});
test('empty events and unresolved pass both local and provider schemas without forced category',()=>{
 const old=prompts(),n=buildEventOnly(old.prompt,old.request),audit=auditEmptyEventContract(n.prompt.responseFormat.json_schema.schema,n.request.generationConfig.responseSchema);
 assert.equal(audit.localEmptyPass,true);assert.equal(audit.actualProviderSchemaEmptyPass,true);assert.ok(audit.arrays.every(x=>x.localMinItems===null&&x.providerMinItems===null));
 const schema=structuredClone(n.prompt.responseFormat.json_schema.schema);schema.properties.filing_events.properties.events.minItems=1;
 assert.throws(()=>auditEmptyEventContract(schema,n.request.generationConfig.responseSchema),/empty_output_contract_conflict/);
});
test('event definitions unchanged: future vote excluded, non-binding proposal occurrence allowed',()=>{
 const old=prompts(),n=buildEventOnly(old.prompt,old.request);assert.ok(n.prompt.system.includes('do not automatically put them in unresolved'));assert.ok(n.prompt.system.includes('A meeting date or a future vote is not a result'));assert.ok(n.prompt.system.includes('completed submission of a non-binding proposal'));
 const valid=new Ajv({strict:false}).compile(n.prompt.responseFormat.json_schema.schema);
 const value={filing_events:{coverage:'supplied_current_filing_blocks_only',empty_events_meaning:'not_a_finding_of_no_event',events:[{kind:'acquisition_proposal',action:'proposal_made',event_state:'occurred',disclosure_context:'current_announcement',statement:'A non-binding proposal was submitted.',date_literal:null,decision_scope_literal:null,evidence:[{block_id:'synthetic-1',source_field:'text',quote:'Synthetic proposal was submitted.'}]}],unresolved:[]}};
 assert.equal(valid(value),true);value.filing_events.events[0].event_state='proposed';assert.equal(valid(value),false);
});
test('unexpected actual payload change fails before preparation',()=>{
 const old=prompts();old.request.contents[0].parts[0].text+=' ';assert.throws(()=>buildEventOnly(old.prompt,old.request),/payload_mismatch/);
});

function fixture(){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sec425-event-only-'));fs.mkdirSync(path.join(directory,'ledger'));
 const cases=['signed','background','revised-offer'].map(id=>{durableNew(path.join(directory,id+'-request.json'),{synthetic:true});return {id,model:'gemini-2.5-flash',requestSha256:sha256(fs.readFileSync(path.join(directory,id+'-request.json')))};});
 durableNew(path.join(directory,'plan.json'),{version:'sec425-round3-events-only-v1',maxRequests:3,cases});
 return {directory,expectedPlanSha256:sha256(fs.readFileSync(path.join(directory,'plan.json'))),apiKey:'synthetic-key-never-live',validateOutput:()=>({ok:true})};
}
const response=(text='{}',finishReason='STOP',status=200)=>new Response(JSON.stringify({candidates:[{finishReason,content:{parts:[{text}]}}],usageMetadata:{promptTokenCount:1,candidatesTokenCount:1}}),{status});
test('three complete output failures consume three slots without retry or global halt',async()=>{
 const f=fixture();let calls=0;const fetchImpl=async(url,init)=>{calls++;assert.equal(init.redirect,'error');assert.equal(init.method,'POST');assert.equal(fs.existsSync(path.join(f.directory,'ledger',`attempt-${calls}.json`)),true);return response();};
 for(const caseId of ['signed','background','revised-offer']){const r=await sendEventOnlyOnce({...f,caseId,fetchImpl,validateOutput:()=>({ok:false,semanticPass:false})});assert.equal(r.status,'output_validation_failed');}
 assert.equal(calls,3);assert.equal(fs.existsSync(path.join(f.directory,'ledger','HALTED.json')),false);
 await assert.rejects(sendEventOnlyOnce({...f,caseId:'signed',fetchImpl}),/reserved|cap/);await assert.rejects(sendEventOnlyOnce({...f,caseId:'fourth',fetchImpl}),/outside/);assert.equal(calls,3);
});
for(const [name,make] of [['model JSON parse failure',()=>response('{')],['complete MAX_TOKENS',()=>response('{','MAX_TOKENS')]])test(`${name} remains output FAIL and permits only the other unsent case`,async()=>{
 const f=fixture();let calls=0;const fetchImpl=async()=>{calls++;return calls===1?make():response();};
 assert.equal((await sendEventOnlyOnce({...f,caseId:'signed',fetchImpl})).status,'output_validation_failed');
 assert.equal((await sendEventOnlyOnce({...f,caseId:'background',fetchImpl})).status,'received_validated');assert.equal(calls,2);
});
for(const status of [302,429,503])test(`HTTP ${status} is logged and halts with zero retry`,async()=>{
 const f=fixture();let calls=0;const fetchImpl=async()=>{calls++;return response('{}','STOP',status);};
 await assert.rejects(sendEventOnlyOnce({...f,caseId:'signed',fetchImpl}),/halted/);await assert.rejects(sendEventOnlyOnce({...f,caseId:'background',fetchImpl}),/halted/);assert.equal(calls,1);
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.directory,'ledger/result-1.json'))).httpStatus,status);
});
test('network/unknown transmission failure consumes one slot and prevents later case',async()=>{
 const f=fixture();let calls=0;const fetchImpl=async()=>{calls++;throw Error('mock timeout');};
 await assert.rejects(sendEventOnlyOnce({...f,caseId:'signed',fetchImpl}),/halted/);await assert.rejects(sendEventOnlyOnce({...f,caseId:'background',fetchImpl}),/halted/);assert.equal(calls,1);
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.directory,'ledger/result-1.json'))).httpStatus,null);
});
test('changed plan/request and stale lock block dispatch without budget reset',async()=>{
 const f=fixture();let calls=0;const fetchImpl=async()=>{calls++;return response();};
 await assert.rejects(sendEventOnlyOnce({...f,caseId:'signed',expectedPlanSha256:'0'.repeat(64),fetchImpl}),/digest/);
 fs.appendFileSync(path.join(f.directory,'signed-request.json'),' ');await assert.rejects(sendEventOnlyOnce({...f,caseId:'signed',fetchImpl}),/digest/);
 fs.mkdirSync(path.join(f.directory,'ledger/exclusive.lock'));await assert.rejects(sendEventOnlyOnce({...f,caseId:'background',fetchImpl}),/EEXIST/);assert.equal(calls,0);
});
test('restart duplicate denial and two-process race retain one request per case',async()=>{
 const f=fixture(),moduleUrl=new URL('./round3-guard.mjs',import.meta.url).href;
 const code=`import fs from 'node:fs';import path from 'node:path';import {sendEventOnlyOnce} from ${JSON.stringify(moduleUrl)};try{await sendEventOnlyOnce({...${JSON.stringify({directory:f.directory,expectedPlanSha256:f.expectedPlanSha256,apiKey:f.apiKey})},caseId:'signed',validateOutput:()=>({ok:true}),fetchImpl:async()=>{fs.writeFileSync(path.join(${JSON.stringify(f.directory)},'mock-'+process.pid),'one',{flag:'wx'});await new Promise(r=>setTimeout(r,80));return new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:'{}'}]}}]}));}});}catch{process.exitCode=2;}`;
 const child=()=>new Promise(resolve=>{const p=spawn(process.execPath,['--input-type=module','-e',code],{stdio:'ignore',windowsHide:true});p.on('exit',resolve);});
 const results=await Promise.all([child(),child()]);assert.equal(results.filter(c=>c===0).length,1);assert.equal(await child(),2);assert.equal(fs.readdirSync(f.directory).filter(n=>n.startsWith('mock-')).length,1);
});
