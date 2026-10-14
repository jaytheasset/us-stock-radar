// Explicit later execution only. One named case per invocation, no loops/retries/repair.
import fs from 'node:fs';
import path from 'node:path';
import {parseEnv} from 'node:util';
import Ajv from 'ajv';
import {sendPreparedOnce,sha256} from './round2-guard.mjs';
import {inspectRound2Evidence} from './round2.ts';

const [directory,caseId,expectedPlanSha256,envFile,executionFlag]=process.argv.slice(2);
if(executionFlag!=='--execute-one-approved-request'||!directory||!caseId||!expectedPlanSha256||!envFile)throw Error('explicit_named_case_plan_digest_and_execution_flag_required');
// One approved trial, not a CLI switch to reset allowance by choosing another output folder.
const approvedDirectory='C:/Users/PC/.codex/visualizations/sec425-primary-events-round2-20261014';
const approvedPlan='94a25902d0589fe7f84cbeb92510043425d64818a2c9cc5f091e0025c860f8f7';
if(path.resolve(directory).toLowerCase()!==path.resolve(approvedDirectory).toLowerCase()||expectedPlanSha256!==approvedPlan)throw Error('outside_approved_round2_trial');
globalThis.fetch=async()=>{throw Error('non_guarded_network_forbidden');};
const bytes=fs.readFileSync(path.join(directory,'plan.json'));
if(sha256(bytes)!==expectedPlanSha256)throw Error('plan_digest_mismatch');
const item=JSON.parse(bytes).cases.find(c=>c.id===caseId);
if(!item)throw Error('case_outside_plan');
if(sha256(fs.readFileSync(path.join(directory,caseId+'.htm')))!==item.sourceSha256||sha256(fs.readFileSync(path.join(directory,caseId+'-saved-router.json')))!==item.savedRouterSha256||sha256(fs.readFileSync(path.join(directory,caseId+'-round1-response.json')))!==item.priorResponseSha256)throw Error('retained_evidence_changed');
const promptBytes=fs.readFileSync(path.join(directory,caseId+'-prompt.json'));
if(sha256(promptBytes)!==item.promptSha256)throw Error('prompt_digest_mismatch');
const prompt=JSON.parse(promptBytes),blocks=JSON.parse(prompt.user).cleaned_source_blocks;
const schema=new Ajv({strict:false,allErrors:true}).compile(prompt.responseFormat.json_schema.schema);
const env=parseEnv(fs.readFileSync(envFile,'utf8'));
if((env.SEC_ANALYSIS_LLM_PROVIDER||'gemini')!=='gemini'||!env.GEMINI_API_KEY)throw Error('existing_gemini_config_required');
const result=await sendPreparedOnce({directory,caseId,expectedPlanSha256,apiKey:env.GEMINI_API_KEY,validateOutput:parsed=>{
 const schemaPass=schema(parsed),bindings=schemaPass?inspectRound2Evidence(parsed.filing_events,blocks):null;
 return {ok:schemaPass&&bindings.exactPass,schemaPass,schemaErrors:schema.errors,evidence:bindings,semanticPass:'UNREVIEWED',primaryImportantConditions:'UNREVIEWED',primaryOutputRules:'UNREVIEWED',rawOutputUnmodified:true,adapterApplied:false};
}});
console.log(JSON.stringify({caseId,attempt:result.number,status:result.status,humanSourceReviewRequired:true}));
