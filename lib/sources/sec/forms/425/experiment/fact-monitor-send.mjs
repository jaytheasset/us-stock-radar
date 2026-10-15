// One reviewed extraction request only. No Primary/compiler/repair/provider helper invocation.
import fs from 'node:fs';
import path from 'node:path';
import {parseEnv} from 'node:util';
import {sha256} from './round2-guard.mjs';
import {sendFactMonitorOnce} from './fact-monitor-guard.mjs';
import {createSec425FactCandidate,SEC425_FACT_SYSTEM,SEC425_FACT_LOCAL_SCHEMA,SEC425_FACT_WIRE_SCHEMA} from '../factsCandidate.ts';
import {isDeepStrictEqual} from 'node:util';
const [directory,caseId,digest,envFile,flag]=process.argv.slice(2);
const approvedDirectory='C:/Users/PC/.codex/visualizations/sec425-fact-monitor-v1-20261015/trial';
const approvedDigest='8e0ad7ac38df558a733c1a01db6cb4ed89c935da92800a4d5a7a432a31d15bad';
if(flag!=='--execute-one-reviewed-request'||!envFile||!directory||path.resolve(directory).toLowerCase()!==path.resolve(approvedDirectory).toLowerCase()||digest!==approvedDigest)throw Error('outside_reviewed_fact_trial');
globalThis.fetch=async()=>{throw Error('unguarded_network_forbidden');};
const read=n=>JSON.parse(fs.readFileSync(path.join(directory,n),'utf8'));
if(sha256(fs.readFileSync(path.join(directory,'plan.json')))!==digest)throw Error('plan_changed');
const item=read('plan.json').cases.find(c=>c.id===caseId);if(!item)throw Error('case_unknown');
for(const [n,hash]of [[item.sourceFile,item.sourceSha256],[caseId+'-source.json',item.sourceMetadataSha256],[caseId+'-prompt.json',item.promptSha256],[caseId+'-request.json',item.requestSha256],[caseId+'-truth-before-call.json',item.truthSha256]])if(sha256(fs.readFileSync(path.join(directory,n)))!==hash)throw Error('frozen_evidence_changed');
const prompt=read(caseId+'-prompt.json'),request=read(caseId+'-request.json'),source=read(caseId+'-source.json'),sourceBytes=fs.readFileSync(path.join(directory,item.sourceFile));
if(prompt.system!==SEC425_FACT_SYSTEM||!isDeepStrictEqual(prompt.responseFormat.json_schema.schema,SEC425_FACT_LOCAL_SCHEMA)||!isDeepStrictEqual(request.generationConfig.responseSchema,SEC425_FACT_WIRE_SCHEMA)||sha256(prompt.user)!==item.userSha256)throw Error('contract_or_input_changed');
const blocks=JSON.parse(prompt.user).cleaned_source_blocks;
const env=parseEnv(fs.readFileSync(envFile,'utf8'));
if((env.SEC_ANALYSIS_LLM_PROVIDER||'gemini')!=='gemini'||!env.GEMINI_API_KEY)throw Error('existing_gemini_config_required');
const result=await sendFactMonitorOnce({directory,caseId,expectedPlanSha256:digest,apiKey:env.GEMINI_API_KEY,validateOutput:parsed=>{
 const candidate=createSec425FactCandidate(source,sourceBytes,parsed,blocks);
 return {ok:candidate.assessment.mechanicalPass,candidate,semanticPass:'UNREVIEWED',publication:'not_ready',identityMatching:'unverified',automaticAlert:false};
}});
console.log(JSON.stringify({caseId,attempt:result.number,status:result.status,requiresSourceReview:true,canonicalPublication:false}));
