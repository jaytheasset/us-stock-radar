import fs from 'node:fs';
import path from 'node:path';
import {sha256,durableNew} from './round2-guard.mjs';
import {buildRound4Combined} from './round4-contract.mjs';
import {auditEmptyEventContract} from './round3-event-only.mjs';

globalThis.fetch=async()=>{throw Error('offline_preparation_network_forbidden');};
const [prior,directory]=process.argv.slice(2);
if(!prior||!directory)throw Error('usage: prior_round2_directory NEW_round4_directory');
const priorBytes=fs.readFileSync(path.join(prior,'plan.json'));
if(sha256(priorBytes)!=='94a25902d0589fe7f84cbeb92510043425d64818a2c9cc5f091e0025c860f8f7')throw Error('unexpected_round2_plan');
fs.mkdirSync(directory); // create-new: never reset/reuse a prior trial's allowance
const read=name=>JSON.parse(fs.readFileSync(path.join(prior,name),'utf8'));
const write=(name,value)=>durableNew(path.join(directory,name),value);
const copy=(old,name)=>fs.copyFileSync(path.join(prior,old),path.join(directory,name),fs.constants.COPYFILE_EXCL);
const previous=JSON.parse(priorBytes),cases=[];
for(const [index,c] of previous.cases.entries()){
  for(const [name,hash] of [[c.id+'.htm',c.sourceSha256],[c.id+'-request.json',c.requestSha256],[c.id+'-prompt.json',c.promptSha256],[c.id+'-saved-router.json',c.savedRouterSha256]])if(sha256(fs.readFileSync(path.join(prior,name)))!==hash)throw Error('round2_source_or_payload_changed');
  const oldPrompt=read(c.id+'-prompt.json'),oldRequest=read(c.id+'-request.json');
  const response=read(c.id+'-response.json'),result=read(`ledger/result-${index+1}.json`);
  if(result.caseId!==c.id||response.candidates?.[0]?.finishReason!=='STOP'||response.modelVersion!==c.model)throw Error('round2_actual_response_missing');
  const {prompt,request,audit}=buildRound4Combined(oldPrompt,oldRequest);
  // Empty event area must work with both real schemas. Primary remains separately required.
  const wrap=event=>({type:'object',required:['filing_events'],properties:{filing_events:event}});
  const emptyAudit=auditEmptyEventContract(wrap(prompt.responseFormat.json_schema.schema.properties.filing_events),wrap(request.generationConfig.responseSchema.properties.filing_events));
  write(c.id+'-prompt.json',prompt);write(c.id+'-request.json',request);
  write(c.id+'-diff-audit.json',{...audit,oldUserSha256:sha256(oldPrompt.user),newUserSha256:sha256(prompt.user),oldSystemSha256:sha256(oldPrompt.system),newSystemSha256:sha256(prompt.system),oldLocalEventSchema:oldPrompt.responseFormat.json_schema.schema.properties.filing_events,newLocalEventSchema:prompt.responseFormat.json_schema.schema.properties.filing_events,oldWireEventSchema:oldRequest.generationConfig.responseSchema.properties.filing_events,newWireEventSchema:request.generationConfig.responseSchema.properties.filing_events,emptyAudit});
  for(const name of [c.id+'.htm',c.id+'-saved-router.json'])copy(name,name);
  for(const suffix of ['prompt','request','response'])copy(c.id+'-'+suffix+'.json',c.id+'-round2-'+suffix+'.json');
  const settings=Object.fromEntries(Object.entries(request.generationConfig).filter(([key])=>key!=='responseSchema'));
  cases.push({id:c.id,accession:c.accession,model:c.model,sourceUrl:c.sourceUrl,sourceSha256:c.sourceSha256,savedRouterSha256:c.savedRouterSha256,baselineResponseSha256:sha256(fs.readFileSync(path.join(prior,c.id+'-response.json'))),userSha256:sha256(prompt.user),selectedBlockCount:JSON.parse(prompt.user).cleaned_source_blocks.length,promptSha256:sha256(fs.readFileSync(path.join(directory,c.id+'-prompt.json'))),requestSha256:sha256(fs.readFileSync(path.join(directory,c.id+'-request.json'))),generationSettings:settings,emptyAudit});
}
fs.mkdirSync(path.join(directory,'ledger'));
write('plan.json',{version:'sec425-round4-combined-v1',maxRequests:3,comparisonVariable:'filing_events classification contract only; original Round2 combined Primary retained',baseline:'retained Round2 combined responses; no new baseline requests',referenceComparison:'Round3 event-only is contextual, not a controlled comparison with combined Round4',cases,executionStatus:'PREPARED_NOT_SENT',timeoutMs:120000,router:0,repair:0,retry:0,fallback:0,tokenCountApi:0,modelValidationApi:0,secFetch:0});
const digest=sha256(fs.readFileSync(path.join(directory,'plan.json')));
write('plan-sha256.txt',digest+'\n');
console.log(JSON.stringify({status:'PREPARED_NOT_SENT',providerRequests:0,planSha256:digest,cases:cases.map(c=>({id:c.id,model:c.model,blocks:c.selectedBlockCount,userSha256:c.userSha256,emptyLocal:c.emptyAudit.localEmptyPass,emptyProvider:c.emptyAudit.actualProviderSchemaEmptyPass}))}));
