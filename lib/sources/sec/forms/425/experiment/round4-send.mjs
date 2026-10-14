// Later reviewed execution only: one named case, one POST, no retry/repair/fallback.
import fs from 'node:fs';
import path from 'node:path';
import {parseEnv} from 'node:util';
import {sha256} from './round2-guard.mjs';
import {sendRound4Once} from './round4-guard.mjs';
import {validateRound4Output,auditRound4Diff} from './round4-contract.mjs';

const [directory,caseId,digest,envFile,flag]=process.argv.slice(2);
const approvedDirectory='C:/Users/PC/.codex/visualizations/sec425-primary-events-round4-20261015';
const approvedDigest='0f361dd49831e6b480a8a14701c30bcbd70a3032997a8c159afbbc6e125042b2';
if(flag!=='--execute-one-reviewed-request'||!envFile||!directory||path.resolve(directory).toLowerCase()!==path.resolve(approvedDirectory).toLowerCase()||digest!==approvedDigest)throw Error('outside_frozen_combined_trial');
globalThis.fetch=async()=>{throw Error('unguarded_network_forbidden');};
const bytes=fs.readFileSync(path.join(directory,'plan.json'));
if(sha256(bytes)!==digest)throw Error('plan_changed');
const item=JSON.parse(bytes).cases.find(c=>c.id===caseId);if(!item)throw Error('case_not_in_plan');
for(const [name,hash]of [[caseId+'.htm',item.sourceSha256],[caseId+'-saved-router.json',item.savedRouterSha256],[caseId+'-round2-response.json',item.baselineResponseSha256],[caseId+'-prompt.json',item.promptSha256],[caseId+'-request.json',item.requestSha256]])if(sha256(fs.readFileSync(path.join(directory,name)))!==hash)throw Error('frozen_input_changed');
const read=name=>JSON.parse(fs.readFileSync(path.join(directory,name),'utf8'));
const prompt=read(caseId+'-prompt.json'),request=read(caseId+'-request.json'),blocks=JSON.parse(prompt.user).cleaned_source_blocks;
if(sha256(prompt.user)!==item.userSha256)throw Error('user_payload_changed');
auditRound4Diff(read(caseId+'-round2-prompt.json'),read(caseId+'-round2-request.json'),prompt,request);
const env=parseEnv(fs.readFileSync(envFile,'utf8'));
if((env.SEC_ANALYSIS_LLM_PROVIDER||'gemini')!=='gemini'||!env.GEMINI_API_KEY)throw Error('existing_gemini_configuration_required');
const result=await sendRound4Once({directory,caseId,expectedPlanSha256:digest,apiKey:env.GEMINI_API_KEY,validateOutput:parsed=>validateRound4Output(parsed,prompt.responseFormat.json_schema.schema,blocks)});
console.log(JSON.stringify({caseId,attempt:result.number,status:result.status,requiresDirectSourceReview:true}));
