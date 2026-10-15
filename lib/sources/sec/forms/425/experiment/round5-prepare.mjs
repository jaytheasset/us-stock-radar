import fs from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv';
import {sha256,durableNew} from './round2-guard.mjs';
import {buildRound5Standalone} from './round5-contract.mjs';

globalThis.fetch=async()=>{throw Error('offline_preparation_network_forbidden');};
const [prior,directory]=process.argv.slice(2);
if(!prior||!directory)throw Error('usage: prior_round4_directory NEW_round5_directory');
const priorBytes=fs.readFileSync(path.join(prior,'plan.json'));
if(sha256(priorBytes)!=='0f361dd49831e6b480a8a14701c30bcbd70a3032997a8c159afbbc6e125042b2')throw Error('unexpected_round4_plan');
fs.mkdirSync(directory);
const read=name=>JSON.parse(fs.readFileSync(path.join(prior,name),'utf8'));
const write=(name,value)=>durableNew(path.join(directory,name),value);
const copy=(old,name)=>fs.copyFileSync(path.join(prior,old),path.join(directory,name),fs.constants.COPYFILE_EXCL);
const previous=JSON.parse(priorBytes),cases=[];
for(const [index,c]of previous.cases.entries()){
  const response=read(c.id+'-response.json'),result=read(`ledger/result-${index+1}.json`);
  for(const [name,hash]of [[c.id+'.htm',c.sourceSha256],[c.id+'-request.json',c.requestSha256],[c.id+'-prompt.json',c.promptSha256],[c.id+'-saved-router.json',c.savedRouterSha256],[c.id+'-response.json',result.responseSha256]])if(sha256(fs.readFileSync(path.join(prior,name)))!==hash)throw Error('prior_source_or_payload_changed');
  if(result.caseId!==c.id||result.httpStatus!==200||response.candidates?.[0]?.finishReason!=='STOP'||response.modelVersion!==c.model)throw Error('prior_actual_response_missing');
  const oldPrompt=read(c.id+'-prompt.json'),oldRequest=read(c.id+'-request.json');
  const {prompt,request,audit}=buildRound5Standalone(oldPrompt,oldRequest);
  if(sha256(prompt.user)!==c.userSha256)throw Error('saved_user_contents_changed');
  const ajv=new Ajv({strict:false,allErrors:true}),local=ajv.compile(prompt.responseFormat.json_schema.schema),wire=ajv.compile(request.generationConfig.responseSchema);
  const nullStates=['not_applicable','uncertain'].map(decision=>{
    const value={coverage:'supplied_current_filing_blocks_only',decision,reason:'Synthetic offline contract check, not a live outcome.',announcement:null,evidence:[]};
    const localPass=local(value),wirePass=wire(value);if(!localPass||!wirePass)throw Error('null_decision_contract_failed');
    return {decision,localPass,wirePass};
  });
  write(c.id+'-prompt.json',prompt);write(c.id+'-request.json',request);
  write(c.id+'-diff-audit.json',{...audit,oldUserSha256:c.userSha256,newUserSha256:sha256(prompt.user),oldSystemSha256:sha256(oldPrompt.system),newSystemSha256:sha256(prompt.system),oldWireSchema:oldRequest.generationConfig.responseSchema,newWireSchema:request.generationConfig.responseSchema,nullStates});
  for(const name of [c.id+'.htm',c.id+'-saved-router.json'])copy(name,name);
  for(const suffix of ['prompt','request','response'])copy(c.id+'-'+suffix+'.json',c.id+'-round4-'+suffix+'.json');
  cases.push({id:c.id,accession:c.accession,model:c.model,sourceUrl:c.sourceUrl,sourceSha256:c.sourceSha256,savedRouterSha256:c.savedRouterSha256,referenceResponseSha256:result.responseSha256,userSha256:c.userSha256,selectedBlockCount:JSON.parse(prompt.user).cleaned_source_blocks.length,promptSha256:sha256(fs.readFileSync(path.join(directory,c.id+'-prompt.json'))),requestSha256:sha256(fs.readFileSync(path.join(directory,c.id+'-request.json'))),generationSettings:Object.fromEntries(Object.entries(request.generationConfig).filter(([key])=>key!=='responseSchema')),nullStates});
}
fs.mkdirSync(path.join(directory,'ledger'));
write('plan.json',{version:'sec425-round5-two-announcements-v1',maxRequests:3,task:'standalone two announcement kinds, one decision and at most one announcement',allowedInputChanges:['systemInstruction.parts[0].text','generationConfig.responseSchema'],references:'Round3 standalone seven-kind and Round4 combined retained; no causal claim from multiple task changes',cases,executionStatus:'PREPARED_NOT_SENT',timeoutMs:120000,router:0,baseline:0,repair:0,retry:0,fallback:0,tokenCountApi:0,modelValidationApi:0,secFetch:0});
const digest=sha256(fs.readFileSync(path.join(directory,'plan.json')));write('plan-sha256.txt',digest+'\n');
console.log(JSON.stringify({status:'PREPARED_NOT_SENT',providerRequests:0,planSha256:digest,cases:cases.map(c=>({id:c.id,model:c.model,blocks:c.selectedBlockCount,userSha256:c.userSha256,nullStates:c.nullStates}))}));
