import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv from 'ajv';
import {buildRound5Standalone,auditRound5Diff,round5LocalSchema,round5WireSchema,validateRound5Output} from './round5-contract.mjs';
import {sendRound5Once} from './round5-guard.mjs';
import {durableNew,sha256} from './round2-guard.mjs';

// All unit fixtures are synthetic. No claims about actual SEC source outcomes.
const blocks=[{block_id:'synthetic-1',heading:'Current announcement',text:'Example Acquirer announced a revised offer for Example Target. The proposal is non-binding and has no financing condition.'},{block_id:'synthetic-2',heading:null,text:'The parties entered into a definitive merger agreement. Closing remains subject to shareholder approval.'}];
const proof=(index,quote)=>({block_id:blocks[index].block_id,source_field:'text',quote});
function result(decision='confirmed'){
  return {coverage:'supplied_current_filing_blocks_only',decision,reason:'Synthetic current revised proposal announcement.',announcement:decision==='confirmed'?{kind:'acquisition_proposal_announced',parties:['Example Acquirer as bidder'],target:'Example Target',statement:'Example Acquirer announced a revised non-binding proposal.',key_terms:[{term:'Non-binding; no financing condition.',evidence:[proof(0,'The proposal is non-binding and has no financing condition.')]}]}:null,evidence:[proof(0,'Example Acquirer announced a revised offer for Example Target.')]};
}
function prompts(){
  const prompt={key:'old',version:'v1',system:'Previous combined Primary and events task.',user:JSON.stringify({cleaned_source_blocks:blocks,router_result:{event_type:'untrusted_metadata',score:99}}),responseFormat:{type:'json_schema',json_schema:{name:'old',strict:true,schema:{type:'object',properties:{analysis_output:{type:'object'},filing_events:{type:'object'}}}}}};
  const request={systemInstruction:{parts:[{text:prompt.system}]},contents:[{role:'user',parts:[{text:prompt.user}]}],generationConfig:{responseSchema:structuredClone(prompt.responseFormat.json_schema.schema),responseMimeType:'application/json',temperature:0,thinkingConfig:{thinkingBudget:0},maxOutputTokens:5000}};
  return {prompt,request};
}
test('standalone two kinds: user bytes/router/settings unchanged, only system and output schema differ',()=>{
  const old=prompts(),before=JSON.stringify(old),next=buildRound5Standalone(old.prompt,old.request);
  assert.equal(JSON.stringify(old),before);assert.deepEqual(next.request.contents,old.request.contents);assert.equal(next.request.generationConfig.maxOutputTokens,5000);
  assert.deepEqual(next.request.generationConfig.thinkingConfig,{thinkingBudget:0});assert.equal(next.request.generationConfig.temperature,0);
  assert.deepEqual(next.prompt.responseFormat.json_schema.schema.properties.announcement.properties.kind.enum,['acquisition_proposal_announced','definitive_agreement_signed']);
  assert.equal('analysis_output' in next.prompt.responseFormat.json_schema.schema.properties,false);assert.equal('filing_events' in next.prompt.responseFormat.json_schema.schema.properties,false);
  next.request.contents[0].parts[0].text+=' ';assert.throws(()=>auditRound5Diff(old.prompt,old.request,next.prompt,next.request),/outside_standalone/);
});
test('changed saved prompt/request binding fails preparation',()=>{
  const old=prompts();old.request.systemInstruction.parts[0].text+=' ';
  assert.throws(()=>buildRound5Standalone(old.prompt,old.request),/payload_mismatch/);
});
test('both local and provider schemas support nullable not_applicable and uncertain without forcing a candidate',()=>{
  for(const s of [round5LocalSchema,round5WireSchema])for(const decision of ['not_applicable','uncertain']){
    const value=result(decision);value.evidence=[];
    assert.equal(new Ajv({strict:false}).compile(s)(value),true);
    const v=validateRound5Output(value,blocks);assert.equal(v.ok,true);assert.equal(value.announcement,null);assert.equal(v.semanticAccuracy,'UNREVIEWED_REQUIRES_DIRECT_SEC_SOURCE');
  }
});
test('one revised non-binding proposal contains consideration/conditions as terms, not another event',()=>{
  const value=result(),before=JSON.stringify(value),v=validateRound5Output(value,blocks);
  assert.equal(v.ok,true);assert.equal(Array.isArray(value.announcement),false);assert.equal(JSON.stringify(value),before);
  assert.equal('transaction_status' in value.announcement,false);assert.equal('action' in value.announcement,false);
});
test('definitive signing with conditional future closing is representable without asserting completion',()=>{
  const value=result();Object.assign(value.announcement,{kind:'definitive_agreement_signed',statement:'Example parties signed a definitive merger agreement.'});
  value.announcement.key_terms=[{term:'Closing remains subject to shareholder approval.',evidence:[proof(1,'Closing remains subject to shareholder approval.')]}];
  value.evidence=[proof(1,'The parties entered into a definitive merger agreement.')];
  assert.equal(validateRound5Output(value,blocks).ok,true);
});
test('uncertain parties/target or ambiguous multiple transactions stay uncertain/null, never filled from Router',()=>{
  const value=result('uncertain');value.reason='Synthetic excerpt leaves the identity of the acquisition target ambiguous.';value.evidence=[];
  const before=JSON.stringify(value),v=validateRound5Output(value,blocks);assert.equal(v.confirmationShapePass,true);assert.equal(value.decision,'uncertain');assert.equal(value.announcement,null);assert.equal(JSON.stringify(value),before);
});
test('confirmed/null, uncertain/candidate and missing action evidence are explicit consistency failures',()=>{
  const a=result();a.announcement=null;assert.ok(validateRound5Output(a,blocks).consistencyErrors.includes('confirmed_announcement_missing'));
  const b=result();b.decision='uncertain';assert.ok(validateRound5Output(b,blocks).consistencyErrors.includes('nonconfirmed_announcement_must_be_null'));
  const c=result();c.evidence=[];assert.ok(validateRound5Output(c,blocks).consistencyErrors.includes('confirmed_action_evidence_missing'));
});
test('old seven-kind consideration/board/vote categories and multiple announcements cannot pass new schema',()=>{
  for(const kind of ['consideration_changed','regulator_or_court_decision','shareholder_vote_result']){const v=result();v.announcement.kind=kind;assert.equal(validateRound5Output(v,blocks).schemaPass,false);}
  const v=result();v.announcement=[v.announcement,v.announcement];assert.equal(validateRound5Output(v,blocks).schemaPass,false);
});
test('each term requires its own evidence and unknown fields do not silently disappear',()=>{
  const v=result();v.announcement.key_terms[0].evidence=[];assert.equal(validateRound5Output(v,blocks).schemaPass,false);
  const x=result();x.announcement.event_state='occurred';const before=JSON.stringify(x);assert.equal(validateRound5Output(x,blocks).schemaPass,false);assert.equal(JSON.stringify(x),before);
});
test('wrong ID, field or quotation fails without relocation; heading is allowed explicitly',()=>{
  const v=result();v.evidence[0].block_id='missing';assert.equal(validateRound5Output(v,blocks).citation.pass,false);
  v.evidence[0]={block_id:'synthetic-1',source_field:'heading',quote:'Current announcement'};assert.equal(validateRound5Output(v,blocks).citation.pass,true);
  v.evidence[0].source_field='text';assert.equal(validateRound5Output(v,blocks).citation.pass,false);
});
test('length and whitespace formatting are reported separately and never normalized into acceptance',()=>{
  const v=result();v.evidence[0].quote=v.evidence[0].quote.replace('announced','announced\n');const before=JSON.stringify(v),r=validateRound5Output(v,blocks);
  assert.equal(r.confirmationShapePass,true);assert.equal(r.citation.pass,false);assert.equal(r.citation.proofs[0].diagnosticWhitespaceOnlyMatch,true);assert.equal(JSON.stringify(v),before);
  const x=result();x.evidence=[proof(0,'x'.repeat(241))];const y=validateRound5Output(x,[{...blocks[0],text:'x'.repeat(241)},blocks[1]]);assert.equal(y.schemaPass,false);assert.equal(y.structuralSchemaPass,true);assert.equal(y.citation.pass,false);
});
test('mechanical pass does not establish a correct kind: proposal source mislabeled signed needs semantic review',()=>{
  const v=result();v.announcement.kind='definitive_agreement_signed';v.announcement.statement='The current filing newly announces a signed agreement.';
  const r=validateRound5Output(v,blocks);assert.equal(r.ok,true);assert.equal(r.semanticAccuracy,'UNREVIEWED_REQUIRES_DIRECT_SEC_SOURCE');assert.equal(r.productAuthority,'none');
});

function fixture(){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sec425-round5-'));fs.mkdirSync(path.join(directory,'ledger'));
  const cases=['signed','background','revised-offer'].map(id=>{durableNew(path.join(directory,id+'-request.json'),{synthetic:true});return {id,model:'gemini-2.5-flash',requestSha256:sha256(fs.readFileSync(path.join(directory,id+'-request.json')))};});
  durableNew(path.join(directory,'plan.json'),{version:'sec425-round5-two-announcements-v1',maxRequests:3,cases});
  return {directory,expectedPlanSha256:sha256(fs.readFileSync(path.join(directory,'plan.json'))),apiKey:'synthetic-key-never-live',validateOutput:()=>({ok:true})};
}
const response=(text='{}',finishReason='STOP',status=200)=>new Response(JSON.stringify({candidates:[{finishReason,content:{parts:[{text}]}}],usageMetadata:{promptTokenCount:1,candidatesTokenCount:1}}),{status});
test('durable pre-fetch reservations: all three validation failures consume budget; no fourth/duplicate request',async()=>{
  const f=fixture();let calls=0;const fetchImpl=async(url,init)=>{calls++;assert.equal(init.redirect,'error');assert.equal(init.method,'POST');assert.equal(init.signal.aborted,false);assert.ok(fs.existsSync(path.join(f.directory,'ledger',`attempt-${calls}.json`)));return response();};
  for(const caseId of ['signed','background','revised-offer'])assert.equal((await sendRound5Once({...f,caseId,fetchImpl,validateOutput:()=>({ok:false})})).status,'output_validation_failed');
  await assert.rejects(sendRound5Once({...f,caseId:'signed',fetchImpl}),/reserved|cap/);await assert.rejects(sendRound5Once({...f,caseId:'fourth',fetchImpl}),/outside/);assert.equal(calls,3);
});
for(const [name,make] of [['JSON failure',()=>response('{')],['MAX_TOKENS',()=>response('{','MAX_TOKENS')]])test(`${name} consumes slot and permits only an unsent case`,async()=>{
  const f=fixture();let calls=0;const fetchImpl=async()=>{calls++;return calls===1?make():response();};
  assert.equal((await sendRound5Once({...f,caseId:'signed',fetchImpl})).status,'output_validation_failed');
  assert.equal((await sendRound5Once({...f,caseId:'background',fetchImpl})).status,'received_validated');assert.equal(calls,2);
});
for(const status of [302,429,503])test(`HTTP ${status} logged and halts without retry`,async()=>{
  const f=fixture();let calls=0;const fetchImpl=async()=>{calls++;return response('{}','STOP',status);};
  await assert.rejects(sendRound5Once({...f,caseId:'signed',fetchImpl}),/halted/);await assert.rejects(sendRound5Once({...f,caseId:'background',fetchImpl}),/halted/);assert.equal(calls,1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.directory,'ledger/result-1.json'))).httpStatus,status);
});
test('transport uncertainty halts entire trial and consumes one attempt',async()=>{
  const f=fixture();let calls=0;const fetchImpl=async()=>{calls++;throw Error('synthetic connection failure');};
  await assert.rejects(sendRound5Once({...f,caseId:'signed',fetchImpl}),/halted/);await assert.rejects(sendRound5Once({...f,caseId:'background',fetchImpl}),/halted/);assert.equal(calls,1);
});
test('digest changes and stale lock block dispatch',async()=>{
  const f=fixture();let calls=0;const fetchImpl=async()=>{calls++;return response();};
  await assert.rejects(sendRound5Once({...f,caseId:'signed',expectedPlanSha256:'0'.repeat(64),fetchImpl}),/digest/);
  fs.appendFileSync(path.join(f.directory,'signed-request.json'),' ');await assert.rejects(sendRound5Once({...f,caseId:'signed',fetchImpl}),/digest/);
  fs.mkdirSync(path.join(f.directory,'ledger/exclusive.lock'));await assert.rejects(sendRound5Once({...f,caseId:'background',fetchImpl}),/EEXIST/);assert.equal(calls,0);
});
test('cross-process race and restart cannot resend a case',async()=>{
  const f=fixture(),moduleUrl=new URL('./round5-guard.mjs',import.meta.url).href;
  const code=`import fs from 'node:fs';import path from 'node:path';import {sendRound5Once} from ${JSON.stringify(moduleUrl)};try{await sendRound5Once({...${JSON.stringify({directory:f.directory,expectedPlanSha256:f.expectedPlanSha256,apiKey:f.apiKey})},caseId:'signed',validateOutput:()=>({ok:true}),fetchImpl:async()=>{fs.writeFileSync(path.join(${JSON.stringify(f.directory)},'mock-'+process.pid),'one',{flag:'wx'});await new Promise(r=>setTimeout(r,80));return new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:'{}'}]}}]}));}});}catch{process.exitCode=2;}`;
  const child=()=>new Promise(resolve=>{const p=spawn(process.execPath,['--input-type=module','-e',code],{stdio:'ignore',windowsHide:true});p.on('exit',resolve);});
  const results=await Promise.all([child(),child()]);assert.equal(results.filter(c=>c===0).length,1);assert.equal(await child(),2);assert.equal(fs.readdirSync(f.directory).filter(n=>n.startsWith('mock-')).length,1);
});
