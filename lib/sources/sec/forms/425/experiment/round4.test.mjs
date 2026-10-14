import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import Ajv from 'ajv';
import {buildRound2Prompt} from './round2.ts';
import {buildRound4Combined,auditRound4Diff,validateRound4Output,inspectClassification} from './round4-contract.mjs';
import {auditEmptyEventContract} from './round3-event-only.mjs';
import {sendRound4Once} from './round4-guard.mjs';
import {durableNew,sha256} from './round2-guard.mjs';

// Synthetic fixtures, never claims about an actual SEC filing.
const blocks=[{block_id:'synthetic-action',source_ref:'primary',heading:null,text:'Example Acquirer submitted a revised offer. The acquisition is non-binding and subject to a definitive agreement.'}];
function prompts(){
  const primary={key:'primary',version:'v1',system:'Write the unchanged Primary analysis_output.',user:JSON.stringify({cleaned_source_blocks:blocks,router_result:{display_type:'generic'},analysis_source_selection:{mode:'old'}}),responseFormat:{type:'json_schema',json_schema:{name:'primary',strict:true,schema:{type:'object',additionalProperties:false,required:['analysis_output'],properties:{analysis_output:{type:'object'}}}}}};
  const prompt=buildRound2Prompt(primary,blocks,[blocks[0].block_id]).prompt;
  const request={systemInstruction:{parts:[{text:prompt.system}]},contents:[{role:'user',parts:[{text:prompt.user}]}],generationConfig:{responseSchema:structuredClone(prompt.responseFormat.json_schema.schema),responseMimeType:'application/json',temperature:0,thinkingConfig:{thinkingBudget:0},maxOutputTokens:5000}};
  return {prompt,request};
}
function event(){return {kind:'acquisition_proposal',action:'proposal_made',event_state:'occurred',disclosure_context:'current_announcement',statement:'Example Acquirer submitted a revised non-binding offer, conditional on a definitive agreement.',date_literal:null,decision_scope_literal:null,actor:{name:'Example Acquirer',role:'transaction_party'},target:{description:'Acquisition of Example Target',category:'business_combination'},transaction_status:{binding:'non_binding',completion:'not_stated',conditions:'Subject to a definitive agreement'},evidence:[{block_id:'synthetic-action',source_field:'text',quote:blocks[0].text,purpose:'both'}]};}
function validate(events,source=blocks){
  const old=prompts(),next=buildRound4Combined(old.prompt,old.request);
  return validateRound4Output({analysis_output:{},filing_events:{coverage:'supplied_current_filing_blocks_only',empty_events_meaning:'not_a_finding_of_no_event',events,unresolved:[]}},next.prompt.responseFormat.json_schema.schema,source);
}

test('combined Primary, original instructions, input and settings remain unchanged; no input mutation',()=>{
  const old=prompts(),before=JSON.stringify(old),next=buildRound4Combined(old.prompt,old.request);
  assert.equal(JSON.stringify(old),before);assert.deepEqual(next.request.contents,old.request.contents);
  assert.deepEqual(next.request.generationConfig.thinkingConfig,{thinkingBudget:0});assert.equal(next.request.generationConfig.maxOutputTokens,5000);
  assert.deepEqual(next.prompt.responseFormat.json_schema.schema.properties.analysis_output,old.prompt.responseFormat.json_schema.schema.properties.analysis_output);
  assert.deepEqual(next.prompt.responseFormat.json_schema.schema.properties.filing_events.properties.unresolved,old.prompt.responseFormat.json_schema.schema.properties.filing_events.properties.unresolved);
  assert.equal(next.audit.originalSystemPrefixByteIdentical,true);
  next.request.generationConfig.temperature=1;
  assert.throws(()=>auditRound4Diff(old.prompt,old.request,next.prompt,next.request),/outside_event_contract/);
});
test('actual request mismatch and removed Primary root fail closed',()=>{
  const a=prompts();a.request.contents[0].parts[0].text+=' ';
  assert.throws(()=>buildRound4Combined(a.prompt,a.request),/payload_mismatch/);
  const b=prompts();delete b.prompt.responseFormat.json_schema.schema.properties.analysis_output;
  assert.throws(()=>buildRound4Combined(b.prompt,b.request),/Primary_boundary/);
});
test('both event schemas accept zero events/unresolved but missing Primary fails full combined schema',()=>{
  const old=prompts(),next=buildRound4Combined(old.prompt,old.request);
  const wrap=eventSchema=>({type:'object',properties:{filing_events:eventSchema}});
  const audit=auditEmptyEventContract(wrap(next.prompt.responseFormat.json_schema.schema.properties.filing_events),wrap(next.request.generationConfig.responseSchema.properties.filing_events));
  assert.equal(audit.localEmptyPass,true);assert.equal(audit.actualProviderSchemaEmptyPass,true);
  assert.equal(validate([]).ok,true);assert.equal(validate([]).positiveRecall,'UNREVIEWED_EMPTY_IS_NOT_SUCCESS');
  assert.equal(new Ajv({strict:false}).compile(next.prompt.responseFormat.json_schema.schema)({filing_events:{coverage:'supplied_current_filing_blocks_only',empty_events_meaning:'not_a_finding_of_no_event',events:[],unresolved:[]}}),false);
});
test('occurred non-binding proposal and consideration revision preserve explanation and conditions',()=>{
  for(const [kind,action] of [['acquisition_proposal','proposal_made'],['consideration_changed','consideration_revised']]){
    const e={...event(),kind,action},before=JSON.stringify(e),v=validate([e]);
    assert.equal(v.ok,true);assert.equal(v.semanticPass,'UNREVIEWED_REQUIRES_DIRECT_SEC_SOURCE');assert.equal(JSON.stringify(e),before);
    assert.notEqual(e.statement,e.evidence[0].quote);
  }
});
test('issued conditional/partial regulatory approval is occurred even when acquisition is not completed',()=>{
  const e=event();e.kind='regulator_or_court_decision';e.action='regulatory_decision';e.actor.role='regulator';
  e.transaction_status={binding:'not_stated',completion:'not_completed',conditions:'Closing remains conditional on remedies'};
  e.statement='Regulator issued conditional approval; the acquisition has not closed.';
  assert.equal(inspectClassification([e]).pass,true);
});
test('court decision, vote result, signing, closing, termination and withdrawal remain distinct valid combinations',()=>{
  for(const [kind,action,role] of [['regulator_or_court_decision','court_decision','court'],['shareholder_vote_result','vote_result','shareholders'],['agreement_signed','signed','transaction_party'],['transaction_closed','closed','transaction_party'],['agreement_terminated_or_proposal_withdrawn','agreement_terminated','transaction_party'],['agreement_terminated_or_proposal_withdrawn','proposal_withdrawn','transaction_party']]){
    const e=event();Object.assign(e,{kind,action});e.actor.role=role;
    e.transaction_status={binding:'not_stated',completion:action==='closed'?'completed':'not_completed',conditions:null};
    assert.equal(inspectClassification([e]).pass,true,action);
  }
});
test('board/regulator, own buyback/proposal, proxy/vote, mismatched kind/action produce reports without correction',()=>{
  const cases=[
    [e=>{e.kind='regulator_or_court_decision';e.action='regulatory_decision';e.actor.role='corporate_board';},'action_actor_role_conflict'],
    [e=>{e.target.category='own_share_repurchase';},'own_share_repurchase_not_acquisition_proposal_or_consideration_change'],
    [e=>{e.kind='shareholder_vote_result';e.action='vote_result';e.actor.role='shareholders';e.target.category='meeting_or_proxy_process';},'meeting_or_proxy_process_not_voting_result'],
    [e=>{e.kind='transaction_closed';},'kind_action_conflict'],
    [e=>{e.kind='transaction_closed';e.action='closed';e.transaction_status.completion='not_completed';},'closing_completion_conflict'],
  ];
  for(const [mutate,reason] of cases){const e=event();mutate(e);const before=JSON.stringify(e),v=validate([e]);assert.equal(v.classification.pass,false);assert.ok(v.classification.errors.some(x=>x.reason===reason));assert.equal(JSON.stringify(e),before);}
});
test('scheduled/conditional_future/unknown action never passes as occurred result',()=>{
  for(const state of ['scheduled','conditional_future','unknown']){
    const e=event();e.event_state=state;const v=validate([e]);
    assert.equal(v.structuralSchemaPass,true);assert.equal(v.classification.pass,false);assert.equal(e.event_state,state);
  }
});
test('qualifier assertion without qualifier evidence and event without action evidence are reported',()=>{
  const a=event();a.evidence[0].purpose='action';assert.ok(validate([a]).classification.errors.some(e=>e.reason==='transaction_qualification_evidence_missing'));
  const b=event();b.evidence[0].purpose='transaction_qualification';assert.ok(validate([b]).classification.errors.some(e=>e.reason==='action_evidence_missing'));
  const c=event();c.transaction_status={binding:'not_stated',completion:'not_stated',conditions:null};c.evidence[0].purpose='action';assert.equal(validate([c]).ok,true);
});
test('prior_background stays historical and does not receive current transaction status automatically',()=>{
  const e=event();e.disclosure_context='prior_background';e.transaction_status={binding:'not_stated',completion:'not_stated',conditions:null};const before=JSON.stringify(e);
  assert.equal(validate([e]).ok,true);assert.equal(JSON.stringify(e),before);assert.equal(e.disclosure_context,'prior_background');
});
test('exact quotation is not semantic approval: semantically wrong but consistent enums remain human-review required',()=>{
  const e=event();e.kind='transaction_closed';e.action='closed';e.transaction_status={binding:'not_stated',completion:'completed',conditions:null};e.statement='The acquisition closed.';
  const v=validate([e]);assert.equal(v.ok,true);assert.equal(v.semanticPass,'UNREVIEWED_REQUIRES_DIRECT_SEC_SOURCE');
});
test('citation whitespace/length failures remain separate from classification and never repaired',()=>{
  const e=event();e.evidence[0].quote=blocks[0].text.replace('submitted','submitted\n');
  const v=validate([e]);assert.equal(v.classification.pass,true);assert.equal(v.citation.pass,false);assert.equal(v.citation.evidence.proofs[0].diagnosticWhitespaceOnlyMatch,true);
  const long=event();long.evidence[0].quote='x'.repeat(241);const before=JSON.stringify(long);
  const r=validate([long],[{...blocks[0],text:'x'.repeat(241)}]);assert.equal(r.schemaPass,false);assert.equal(r.structuralSchemaPass,true);assert.equal(r.classification.pass,true);assert.equal(r.citation.pass,false);assert.equal(JSON.stringify(long),before);
});
test('unknown source ID and wrong heading/text field fail evidence without relocation',()=>{
  const e=event();e.evidence[0].source_field='heading';assert.equal(validate([e]).citation.pass,false);
  e.evidence[0].block_id='missing';assert.equal(validate([e]).citation.evidence.proofs[0].missingBlock,true);
});
test('unknown role is unconfirmed, never an accepted regulatory/court/vote result or corrected actor',()=>{
  for(const [kind,action] of [['regulator_or_court_decision','regulatory_decision'],['regulator_or_court_decision','court_decision'],['shareholder_vote_result','vote_result']]){
    const e=event();Object.assign(e,{kind,action});e.actor.role='unknown';
    const v=validate([e]);assert.equal(v.classification.pass,false);assert.ok(v.classification.errors.some(x=>x.reason==='action_actor_role_unconfirmed'));assert.equal(e.actor.role,'unknown');
  }
});
test('Primary schema failure does not hide valid event or citation diagnostics; full schema stays FAIL',()=>{
  const old=prompts(),next=buildRound4Combined(old.prompt,old.request);
  const parsed={analysis_output:'invalid Primary object',filing_events:{coverage:'supplied_current_filing_blocks_only',empty_events_meaning:'not_a_finding_of_no_event',events:[event()],unresolved:[]}};
  const before=JSON.stringify(parsed),v=validateRound4Output(parsed,next.prompt.responseFormat.json_schema.schema,blocks);
  assert.equal(v.ok,false);assert.equal(v.schemaPass,false);assert.equal(v.primarySchemaPass,false);assert.equal(v.eventStructuralSchemaPass,true);assert.equal(v.classification.pass,true);assert.equal(v.citation.pass,true);assert.equal(JSON.stringify(parsed),before);
});

function fixture(){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sec425-round4-'));fs.mkdirSync(path.join(directory,'ledger'));
  const cases=['signed','background','revised-offer'].map(id=>{durableNew(path.join(directory,id+'-request.json'),{synthetic:true});return {id,model:'gemini-2.5-flash',requestSha256:sha256(fs.readFileSync(path.join(directory,id+'-request.json')))};});
  durableNew(path.join(directory,'plan.json'),{version:'sec425-round4-combined-v1',maxRequests:3,cases});
  return {directory,expectedPlanSha256:sha256(fs.readFileSync(path.join(directory,'plan.json'))),apiKey:'synthetic-key-never-live',validateOutput:()=>({ok:true})};
}
const response=(text='{}',finishReason='STOP',status=200)=>new Response(JSON.stringify({candidates:[{finishReason,content:{parts:[{text}]}}],usageMetadata:{promptTokenCount:1,candidatesTokenCount:1}}),{status});
test('durable pre-fetch reservations: all three validation failures consume budget; no fourth/duplicate request',async()=>{
  const f=fixture();let calls=0;const fetchImpl=async(url,init)=>{calls++;assert.equal(init.redirect,'error');assert.equal(init.method,'POST');assert.equal(init.signal.aborted,false);assert.ok(fs.existsSync(path.join(f.directory,'ledger',`attempt-${calls}.json`)));return response();};
  for(const caseId of ['signed','background','revised-offer'])assert.equal((await sendRound4Once({...f,caseId,fetchImpl,validateOutput:()=>({ok:false})})).status,'output_validation_failed');
  await assert.rejects(sendRound4Once({...f,caseId:'signed',fetchImpl}),/reserved|cap/);await assert.rejects(sendRound4Once({...f,caseId:'fourth',fetchImpl}),/outside/);assert.equal(calls,3);
});
for(const [name,make] of [['JSON failure',()=>response('{')],['MAX_TOKENS',()=>response('{','MAX_TOKENS')]])test(`${name} consumes slot and permits only an unsent case`,async()=>{
  const f=fixture();let calls=0;const fetchImpl=async()=>{calls++;return calls===1?make():response();};
  assert.equal((await sendRound4Once({...f,caseId:'signed',fetchImpl})).status,'output_validation_failed');
  assert.equal((await sendRound4Once({...f,caseId:'background',fetchImpl})).status,'received_validated');assert.equal(calls,2);
});
for(const status of [302,429,503])test(`HTTP ${status} logged and halts without retry`,async()=>{
  const f=fixture();let calls=0;const fetchImpl=async()=>{calls++;return response('{}','STOP',status);};
  await assert.rejects(sendRound4Once({...f,caseId:'signed',fetchImpl}),/halted/);await assert.rejects(sendRound4Once({...f,caseId:'background',fetchImpl}),/halted/);assert.equal(calls,1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.directory,'ledger/result-1.json'))).httpStatus,status);
});
test('transport uncertainty halts entire trial and consumes one attempt',async()=>{
  const f=fixture();let calls=0;const fetchImpl=async()=>{calls++;throw Error('synthetic connection failure');};
  await assert.rejects(sendRound4Once({...f,caseId:'signed',fetchImpl}),/halted/);await assert.rejects(sendRound4Once({...f,caseId:'background',fetchImpl}),/halted/);assert.equal(calls,1);
});
test('digest changes and stale lock block dispatch',async()=>{
  const f=fixture();let calls=0;const fetchImpl=async()=>{calls++;return response();};
  await assert.rejects(sendRound4Once({...f,caseId:'signed',expectedPlanSha256:'0'.repeat(64),fetchImpl}),/digest/);
  fs.appendFileSync(path.join(f.directory,'signed-request.json'),' ');await assert.rejects(sendRound4Once({...f,caseId:'signed',fetchImpl}),/digest/);
  fs.mkdirSync(path.join(f.directory,'ledger/exclusive.lock'));await assert.rejects(sendRound4Once({...f,caseId:'background',fetchImpl}),/EEXIST/);assert.equal(calls,0);
});
test('cross-process race and restart cannot resend a case',async()=>{
  const f=fixture(),moduleUrl=new URL('./round4-guard.mjs',import.meta.url).href;
  const code=`import fs from 'node:fs';import path from 'node:path';import {sendRound4Once} from ${JSON.stringify(moduleUrl)};try{await sendRound4Once({...${JSON.stringify({directory:f.directory,expectedPlanSha256:f.expectedPlanSha256,apiKey:f.apiKey})},caseId:'signed',validateOutput:()=>({ok:true}),fetchImpl:async()=>{fs.writeFileSync(path.join(${JSON.stringify(f.directory)},'mock-'+process.pid),'one',{flag:'wx'});await new Promise(r=>setTimeout(r,80));return new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:'{}'}]}}]}));}});}catch{process.exitCode=2;}`;
  const child=()=>new Promise(resolve=>{const p=spawn(process.execPath,['--input-type=module','-e',code],{stdio:'ignore',windowsHide:true});p.on('exit',resolve);});
  const results=await Promise.all([child(),child()]);assert.equal(results.filter(c=>c===0).length,1);assert.equal(await child(),2);assert.equal(fs.readdirSync(f.directory).filter(n=>n.startsWith('mock-')).length,1);
});
