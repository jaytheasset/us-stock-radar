import fs from 'node:fs';
import path from 'node:path';
import {buildRound2Prompt} from './round2.ts';
import {durableNew,sha256} from './round2-guard.mjs';

globalThis.fetch=async()=>{throw Error('prepare_network_forbidden');};
const [prior,directory]=process.argv.slice(2);
if(!prior||!directory)throw Error('usage: round2-prepare.mjs round1_directory NEW_round2_directory');
fs.mkdirSync(directory); // Create-new, never overwrite an earlier trial/ledger.
const read=n=>JSON.parse(fs.readFileSync(path.join(prior,n),'utf8'));
const write=(n,v)=>durableNew(path.join(directory,n),v);
const sources=read('sources.json');
const fixed=[['signed',4,'0001193125-25-267134','gemini-2.5-flash'],['background',9,'0001193125-25-220725','gemini-2.5-flash-lite'],['revised-offer',14,'0001104659-26-075214','gemini-2.5-flash']];
const cases=[];
for(const [id,number,accession,model] of fixed){
 const source=sources.find(s=>s.id===id);
 if(source?.accession!==accession)throw Error('source_identity_mismatch');
 const raw=fs.readFileSync(path.join(prior,id+'.htm'));
 if(sha256(raw)!==source.sha256)throw Error('raw_source_changed');
 fs.copyFileSync(path.join(prior,id+'.htm'),path.join(directory,id+'.htm'),fs.constants.COPYFILE_EXCL);
 const input=read(id+'-input.json'),selection=read(id+'-selection.json'),primary=read(id+'-baseline-prompt.json');
 const requestName=`${id}-combined-${number}-request.json`,responseName=`${id}-combined-${number}-response.json`;
 const actual=read(requestName),baseline=read(responseName),attempt=read(`${id}-combined-${number}-attempt.json`);
 if(attempt.model!==model||actual.body.contents[0].parts[0].text!==primary.user||sha256(JSON.stringify(actual.body))!==attempt.requestBodySha256)throw Error('first_response_input_mismatch');
 // Freeze FIRST combined response only; do not import repair or adapter output as baseline.
 fs.copyFileSync(path.join(prior,requestName),path.join(directory,id+'-round1-request.json'),fs.constants.COPYFILE_EXCL);
 fs.copyFileSync(path.join(prior,responseName),path.join(directory,id+'-round1-response.json'),fs.constants.COPYFILE_EXCL);
 const router=read(id+'-router-run.json');write(id+'-saved-router.json',router);
 const all=input.filing_package.hard_parsers['425'].raw.cleaned_source_blocks;
 const built=buildRound2Prompt(primary,all,selection.router.selected_source_block_ids);
 write(id+'-prompt.json',built.prompt);
 const payload=JSON.parse(built.prompt.user),oldPayload=JSON.parse(primary.user);
 const body=structuredClone(actual.body);
 body.systemInstruction.parts=[{text:built.prompt.system}];body.contents[0].parts=[{text:built.prompt.user}];
 // Retain the original provider schema/settings transport; only the event extension changes.
 const eventSchema=body.generationConfig.responseSchema.properties.filing_events;
 eventSchema.properties.events.items.properties.event_state.enum=['occurred'];
 for(const branch of ['events','unresolved']){
  const proof=eventSchema.properties[branch].items.properties.evidence.items;
  proof.required.push('source_field');proof.properties.source_field={type:'string',enum:['heading','text']};
  proof.properties.quote.description='Copy an exact contiguous span of at most 240 characters from the specified source_field. Preserve whitespace and newlines.';
 }
 write(id+'-request.json',body);
 write(id+'-input-diff.json',{priorUserSha256:sha256(primary.user),newUserSha256:sha256(built.prompt.user),sourceBytesUnchanged:true,priorSelectedCount:oldPayload.cleaned_source_blocks.length,newSelectedCount:payload.cleaned_source_blocks.length,allOriginalSelectedRetained:true,priorSelection:oldPayload.analysis_source_selection,newSelection:payload.analysis_source_selection,decisions:built.selection.decisions,priorUser:oldPayload,newUser:payload});
 const baselineOutput=JSON.parse(baseline.candidates[0].content.parts.filter(p=>p.thought!==true).map(p=>p.text??'').join(''));
 if(id==='revised-offer'){
  const p=baselineOutput.filing_events.events[0].evidence.find(e=>e.block_id==='425_primary_008');
  const block=oldPayload.cleaned_source_blocks.find(b=>b.block_id===p.block_id);
  write('round1-heading-correction.json',{actualHttpAttempt:14,blockId:p.block_id,transmittedHeading:block.heading,transmittedText:block.text,modelQuote:p.quote,exactHeadingMatch:block.heading===p.quote,bodyOnlyMatch:block.text.includes(p.quote),conclusion:'Original payload contains quote in heading. Round1 wrong-block diagnosis was incorrect; body-only validator had an unmodeled evidence field. Original response and strict body-only result remain preserved.'});
 }
 cases.push({id,accession,model,sourceSha256:source.sha256,sourceUrl:source.url,priorCombinedHttpAttempt:number,priorResponseSha256:sha256(fs.readFileSync(path.join(prior,responseName))),savedRouterSha256:sha256(fs.readFileSync(path.join(directory,id+'-saved-router.json'))),requestSha256:sha256(fs.readFileSync(path.join(directory,id+'-request.json'))),promptSha256:sha256(fs.readFileSync(path.join(directory,id+'-prompt.json'))),priorSelectedCount:oldPayload.cleaned_source_blocks.length,newSelectedCount:payload.cleaned_source_blocks.length,selectedTextChars:payload.cleaned_source_blocks.reduce((n,b)=>n+b.text.length,0),settingsPreservedExceptEventSchema:true});
}
fs.mkdirSync(path.join(directory,'ledger'));
write('plan.json',{version:'sec425-round2-v1',maxRequests:3,baseline:'round1 first combined HTTP responses 4/9/14 only',cases,executionStatus:'PREPARED_NOT_SENT',newRouterCalls:0,newBaselineCalls:0,retries:0,repairs:0,fallbacks:0,tokenCountApiCalls:0});
const digest=sha256(fs.readFileSync(path.join(directory,'plan.json')));write('plan-sha256.txt',digest+'\n');
console.log(JSON.stringify({status:'PREPARED',providerRequests:0,planSha256:digest,cases:cases.map(c=>({id:c.id,oldBlocks:c.priorSelectedCount,newBlocks:c.newSelectedCount,textChars:c.selectedTextChars,model:c.model}))}));
