import fs from 'node:fs';
import path from 'node:path';
import {parseEnv} from 'node:util';
import Ajv from 'ajv';
import {sha256} from './round2-guard.mjs';
import {inspectRound2Evidence} from './round2.ts';
import {sendEventOnlyOnce} from './round3-guard.mjs';

const [directory,caseId,digest,envFile,flag]=process.argv.slice(2);
const approvedDirectory='C:/Users/PC/.codex/visualizations/sec425-events-only-round3-20261015';
const approvedDigest='d1e928af8f1482331e51961ffad886ae8bf4fb1ca1001eeed8b5b2ba34f18e5c';
if(flag!=='--execute-one-approved-request'||!envFile||!directory||path.resolve(directory).toLowerCase()!==path.resolve(approvedDirectory).toLowerCase()||digest!==approvedDigest)throw Error('outside_reviewed_event_only_trial');
globalThis.fetch=async()=>{throw Error('unguarded_network_forbidden');};
const planBytes=fs.readFileSync(path.join(directory,'plan.json'));if(sha256(planBytes)!==digest)throw Error('plan_changed');
const item=JSON.parse(planBytes).cases.find(c=>c.id===caseId);if(!item)throw Error('case_not_approved');
for(const [name,hash]of [[caseId+'.htm',item.sourceSha256],[caseId+'-saved-router.json',item.savedRouterSha256],[caseId+'-round2-response.json',item.baselineResponseSha256],[caseId+'-prompt.json',item.promptSha256]])if(sha256(fs.readFileSync(path.join(directory,name)))!==hash)throw Error('frozen_input_changed');
const prompt=JSON.parse(fs.readFileSync(path.join(directory,caseId+'-prompt.json'))),blocks=JSON.parse(prompt.user).cleaned_source_blocks;
if(sha256(prompt.user)!==item.userSha256)throw Error('user_payload_changed');
const schema=new Ajv({strict:false,allErrors:true}).compile(prompt.responseFormat.json_schema.schema);
const env=parseEnv(fs.readFileSync(envFile,'utf8'));if((env.SEC_ANALYSIS_LLM_PROVIDER||'gemini')!=='gemini'||!env.GEMINI_API_KEY)throw Error('existing_gemini_configuration_required');
const result=await sendEventOnlyOnce({directory,caseId,expectedPlanSha256:digest,apiKey:env.GEMINI_API_KEY,validateOutput:parsed=>{
 const schemaPass=schema(parsed),evidence=schemaPass?inspectRound2Evidence(parsed.filing_events,blocks):null;
 return {ok:schemaPass&&evidence.exactPass,schemaPass,schemaErrors:schema.errors,evidence,semanticPass:'UNREVIEWED',importantConditions:'UNREVIEWED',emptyEventsNotAutomaticallySuccess:true,PrimaryQuality:'NOT_EVALUATED_EVENT_ONLY',rawOutputUnmodified:true,adapterApplied:false};
}});
console.log(JSON.stringify({caseId,attempt:result.number,status:result.status,requiresSourceReview:true}));
