// Bounded diagnostic harness, not the production runtime (which may retry/repair).
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {parseEnv} from 'node:util';
import {execFileSync} from 'node:child_process';
import Ajv from 'ajv';
import {durableNew,sha256} from './round2-guard.mjs';
import {sendDianaAnalysisOnce} from './diana-dual-guard.mjs';
import {resolveSecLlmConfig,resolveSec425AnalysisLlmConfig,buildSec425AnalysisModelPlan,buildSecGeminiRequestBody} from '../../../../../ai/secFilingAnalysisPreview.ts';
import {normalizeSec425RouterResultForInput,shouldRunSec425Analysis,buildSec425DeterministicAnalysisForInput,buildSec425AnalysisPromptForInput,adaptSec425AnalysisPromptResultForAnalysis} from '../../../../../ai/sec425AnalysisAdapter.ts';
import {buildSec425FactInput} from '../../../../../ai/sec425FactInput.ts';
import {createSec425FactCandidate,SEC425_FACT_WIRE_SCHEMA} from '../factsCandidate.ts';

globalThis.fetch=async()=>{throw Error('unguarded_network_forbidden');};
const repo=path.resolve(fileURLToPath(new URL('../../../../../../',import.meta.url)));
const expectedRepo='C:/Users/PC/.codex/worktrees/sec425-primary-events/US-Stock Radar';
const root='C:/Users/PC/.codex/visualizations/sec425-diana-primary-fact-20261015';
const directory=root+'/trial',sources='C:/Users/PC/.codex/visualizations/sec425-veeco-stage-trial-20261015/sources';
const routerRoot='C:/Users/PC/.codex/visualizations/sec425-router-reference-once-20261015/trial';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const write=(name,value)=>durableNew(directory+'/'+name,value);
const [mode,stage,expectedPlanHash]=process.argv.slice(2);
assert.equal(repo.toLowerCase(),path.resolve(expectedRepo).toLowerCase());
assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),'0c5a4c3be131679ff43b483619d3fc17f544c887');
if(!['prepare','send'].includes(mode))throw Error('prepare_or_send_required');
// Read existing configuration only into memory. Never persist or log the credential.
const configValues=parseEnv(fs.readFileSync('C:/Users/PC/Documents/Codex/US-Stock Radar/.env.local','utf8'));
if((configValues.SEC_ANALYSIS_LLM_PROVIDER||'gemini')!=='gemini'||!configValues.GEMINI_API_KEY)throw Error('existing_gemini_config_required');
const pkg=read(sources+'/diana-package.json'),input={filing_package:pkg};
const originalRouter=read(routerRoot+'/model-output.json');
const router=normalizeSec425RouterResultForInput(originalRouter,input);
assert.deepEqual(router,read(routerRoot+'/normalized-router.json'));
const branch={rawShouldRun:shouldRunSec425Analysis(originalRouter),normalizedShouldRun:shouldRunSec425Analysis(router),
 rawArchive:buildSec425DeterministicAnalysisForInput(input,originalRouter),normalizedArchive:buildSec425DeterministicAnalysisForInput(input,router),
 rawStage:originalRouter.deterministic_stage,normalizedStage:router.deterministic_stage};
assert.deepEqual([branch.rawShouldRun,branch.normalizedShouldRun,branch.rawArchive,branch.normalizedArchive],[true,true,null,null]);
const primary=buildSec425AnalysisPromptForInput(input,router),fact=buildSec425FactInput(input);
assert.deepEqual(primary,read(routerRoot+'/offline-primary-prompt.json'));
assert.deepEqual(fact,read(sources+'/diana-fact-input.json'));
const config=resolveSecLlmConfig({secAnalysisLlmProvider:configValues.SEC_ANALYSIS_LLM_PROVIDER||'gemini',secAnalysisAllowOpenAi:false,
 geminiModel:configValues.GEMINI_MODEL||'gemini-2.5-flash',geminiApiKey:configValues.GEMINI_API_KEY},{},input);
const modelPlan=buildSec425AnalysisModelPlan(primary,config),primaryConfig=resolveSec425AnalysisLlmConfig(config,{},modelPlan);
assert.equal(primaryConfig.model,'gemini-2.5-flash');assert.equal(config.model,'gemini-2.5-flash');
const prompts={primary,fact},models={primary:primaryConfig.model,fact:config.model};
const requests=Object.fromEntries(Object.entries(prompts).map(([key,prompt])=>[key,buildSecGeminiRequestBody(prompt,models[key])]));
requests.fact.generationConfig.responseSchema=SEC425_FACT_WIRE_SCHEMA;
const primaryInput=JSON.parse(primary.user),factInput=JSON.parse(fact.user);
assert.equal(primaryInput.cleaned_source_blocks.length,12);assert.equal(factInput.cleaned_source_blocks.length,72);
const nativeBytes=fs.readFileSync(sources+'/response-4.body'),source={...factInput.source,representation:'raw_html'};
assert.equal(sha256(nativeBytes),'9494a3beb1e5fc55361ed7ac52d3d9af3b3e255d2c6972f8470288f4108a271d');
assert.equal(source.sourceSha256,sha256(nativeBytes));
const receipt=read(sources+'/LIVE-RECEIPT.json');
assert.ok(receipt.requests.some(r=>r.n===4&&r.url===source.sourceUrl&&r.status===200));

if(mode==='prepare'){
 fs.mkdirSync(root);fs.mkdirSync(directory);fs.mkdirSync(directory+'/ledger');
 for(const key of ['primary','fact']){write(key+'-prompt.json',prompts[key]);write(key+'-request.json',requests[key]);}
 write('normalized-router.json',router);write('branch-and-selection.json',{branch,modelPlan,primaryBlocks:primaryInput.cleaned_source_blocks.map(b=>b.block_id),factBlockCount:72});
 write('source.json',source);fs.writeFileSync(directory+'/diana.htm',nativeBytes,{flag:'wx'});
 write('evaluation-criteria.json',{semanticReview:'Independent direct source assessment, never injected into prompts',
  dimensions:['non-binding revised proposal versus completed transaction','cash/share/implied consideration and qualifications','announcement type versus transaction types','current versus prior actions','filing roles versus acquirer/target roles','DSX/GNK official company identity','raw versus adapted values','schema versus exact citations versus source meaning'],
  primaryCoverage:'12 unchanged selected blocks;042/067/068 absent.045 non-binding present. FACT has all72.',
  noOutputCorrection:true,publication:false,monitorIntegration:false});
 const frozenFiles={};
 const preserved=[sources+'/diana-package.json',sources+'/diana-fresh-raw.json',sources+'/diana-fact-input.json',sources+'/LIVE-RECEIPT.json',sources+'/response-4.body',
  ...['model-output.json','normalized-router.json','response.json','validation.json','plan.json','ledger/result.json','offline-primary-prompt.json'].map(n=>routerRoot+'/'+n)];
 const code=execFileSync('git',['ls-files','lib/sources/sec/forms/425','lib/ai/sec425AnalysisAdapter.ts','lib/ai/sec425FactInput.ts','lib/ai/secFilingAnalysisPreview.ts','lib/env.ts','scripts/resolve-ts-paths.mjs','scripts/resolve-server-only.mjs'],{cwd:repo,encoding:'utf8'}).trim().split(/\r?\n/).map(p=>path.join(repo,p));
 for(const p of [...preserved,...code,fileURLToPath(import.meta.url),fileURLToPath(new URL('./diana-dual-guard.mjs',import.meta.url)),...fs.readdirSync(directory).filter(n=>n.endsWith('.json')||n.endsWith('.htm')).map(n=>directory+'/'+n)])frozenFiles[p]=sha256(fs.readFileSync(p));
 const slots=['primary','fact'].map(key=>({stage:key,model:models[key],requestSha256:sha256(fs.readFileSync(directory+'/'+key+'-request.json')),schemaAdapter:key==='primary'?'existing_runtime_converter':'SEC425_FACT_WIRE_SCHEMA'}));
 write('plan.json',{version:'sec425-diana-independent-two-v1',base:'0c5a4c3be131679ff43b483619d3fc17f544c887',maxRequests:2,slots,frozenFiles,timeoutMs:120000,
  router:0,retry:0,repair:0,fallback:0,baseline:0,tokenCountApi:0,SEC:0,DB:0,FACT:'experimental candidate, not production integration'});
 const planHash=sha256(fs.readFileSync(directory+'/plan.json'));write('plan-sha256.txt',planHash+'\n');
 console.log(JSON.stringify({status:'PREPARED_NOT_SENT',planHash,slots,modelPlan,branch,providerCalls:0}));
}else{
 if(!['primary','fact'].includes(stage)||!expectedPlanHash||sha256(fs.readFileSync(directory+'/plan.json'))!==expectedPlanHash)throw Error('reviewed_plan_hash_and_stage_required');
 for(const key of ['primary','fact']){assert.deepEqual(requests[key],read(directory+'/'+key+'-request.json'));assert.deepEqual(prompts[key],read(directory+'/'+key+'-prompt.json'));}
 const validator=new Ajv({strict:false,allErrors:true}).compile(prompts[stage].responseFormat.json_schema.schema);
 const sent=await sendDianaAnalysisOnce({directory,stage,planHash:expectedPlanHash,apiKey:configValues.GEMINI_API_KEY,validate:parsed=>{
  const before=JSON.stringify(parsed),schemaPass=validator(parsed),schemaErrors=structuredClone(validator.errors);
  if(stage==='primary'){
   const adapted=adaptSec425AnalysisPromptResultForAnalysis(parsed,input,router);write('primary-adapted.json',adapted);
   const warnings=adapted.ok?adapted.analysis.sec_425_validation_warnings:[],repairWarnings=warnings.filter(w=>/(?:key_evidence|current_changes|snapshot)/i.test(w));
   assert.equal(JSON.stringify(parsed),before);
   return{ok:schemaPass&&adapted.ok&&warnings.length===0,schemaPass,schemaErrors,adapterOk:adapted.ok,warnings,repairWarnings,wouldRequestRepair:repairWarnings.length>0,repairRequests:0,rawUnchanged:true,semanticAccuracy:'unreviewed'};
  }
  const candidate=createSec425FactCandidate(source,nativeBytes,parsed,factInput.cleaned_source_blocks,undefined,pkg);write('fact-candidate.json',candidate);
  assert.equal(JSON.stringify(parsed),before);
  return{ok:schemaPass&&candidate.assessment.mechanicalPass,schemaPass,schemaErrors,assessment:candidate.assessment,rawUnchanged:true,semanticAccuracy:'unreviewed'};
 }});
 console.log(JSON.stringify(sent.result));
}
