// Execute only after frozen preparation review; one named case, no retry/repair/fallback.
import fs from 'node:fs';
import path from 'node:path';
import {parseEnv} from 'node:util';
import {sha256} from './round2-guard.mjs';
import {sendRound5Once} from './round5-guard.mjs';
import {validateRound5Output,auditRound5Diff} from './round5-contract.mjs';

const [directory,caseId,digest,envFile,flag]=process.argv.slice(2);
const approvedDirectory='C:/Users/PC/.codex/visualizations/sec425-two-announcements-round5-20261015';
const approvedDigest='a5a2a9698cb597409a96f9574f9b4a4cdabbff2e536e32f5995d1b20e25be69f';
if(flag!=='--execute-one-reviewed-request'||!envFile||!directory||path.resolve(directory).toLowerCase()!==path.resolve(approvedDirectory).toLowerCase()||digest!==approvedDigest)throw Error('outside_frozen_two_announcements_trial');
globalThis.fetch=async()=>{throw Error('unguarded_network_forbidden');};
if(sha256(fs.readFileSync(path.join(directory,'plan.json')))!==digest)throw Error('plan_changed');
const read=name=>JSON.parse(fs.readFileSync(path.join(directory,name),'utf8'));
const item=read('plan.json').cases.find(c=>c.id===caseId);if(!item)throw Error('case_not_in_plan');
for(const [name,hash]of [[caseId+'.htm',item.sourceSha256],[caseId+'-saved-router.json',item.savedRouterSha256],[caseId+'-round4-response.json',item.referenceResponseSha256],[caseId+'-prompt.json',item.promptSha256],[caseId+'-request.json',item.requestSha256]])if(sha256(fs.readFileSync(path.join(directory,name)))!==hash)throw Error('frozen_input_changed');
const prompt=read(caseId+'-prompt.json'),request=read(caseId+'-request.json'),blocks=JSON.parse(prompt.user).cleaned_source_blocks;
if(sha256(prompt.user)!==item.userSha256)throw Error('user_payload_changed');
auditRound5Diff(read(caseId+'-round4-prompt.json'),read(caseId+'-round4-request.json'),prompt,request);
const env=parseEnv(fs.readFileSync(envFile,'utf8'));
if((env.SEC_ANALYSIS_LLM_PROVIDER||'gemini')!=='gemini'||!env.GEMINI_API_KEY)throw Error('existing_gemini_configuration_required');
const result=await sendRound5Once({directory,caseId,expectedPlanSha256:digest,apiKey:env.GEMINI_API_KEY,validateOutput:parsed=>validateRound5Output(parsed,blocks)});
console.log(JSON.stringify({caseId,attempt:result.number,status:result.status,requiresDirectSourceReview:true}));
