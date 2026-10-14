import fs from 'node:fs';
import path from 'node:path';
import {parseEnv} from 'node:util';
import {createHash} from 'node:crypto';
import Ajv from 'ajv';
import {getServerEnv} from '../../../../../env.ts';
import * as runtime from '../../../../../ai/secFilingAnalysisPreview.ts';
import {buildSec425RouterPromptForInput,normalizeSec425RouterResultForInput,shouldRunSec425Analysis,buildSec425AnalysisPromptForInput,adaptSec425AnalysisPromptResultForAnalysis} from '../../../../../ai/sec425AnalysisAdapter.ts';
import {combineWithFilingEvents,eventsSchema,validateEvidenceBindings} from './combined.ts';

const [mode,out,envFile]=process.argv.slice(2);
if(!['prepare','live'].includes(mode)||!out)throw Error('usage: prepare|live external_artifact_directory [existing_env_file]');
const sha=x=>createHash('sha256').update(x).digest('hex');
const write=(n,x)=>fs.writeFileSync(path.join(out,n),typeof x==='string'?x:JSON.stringify(x,null,2),{flag:'wx'});
const read=n=>JSON.parse(fs.readFileSync(path.join(out,n),'utf8'));
const manifest=read('sources.json');
const ajv=new Ajv({strict:false,allErrors:true});
let currentCase='',phase='',counter=0;
const nativeFetch=globalThis.fetch;
globalThis.fetch=async(input,init={})=>{
 const u=new URL(String(input));
 if(mode!=='live'||u.origin!=='https://generativelanguage.googleapis.com'||!u.pathname.endsWith(':generateContent')||init.method!=='POST')throw Error('experiment_network_scope_blocked');
 const number=++counter,label=`${currentCase}-${phase}-${number}`;
 const request=JSON.parse(init.body);write(label+'-request.json',{endpoint:u.origin+u.pathname,body:request});
 const start=Date.now();
 try{const r=await nativeFetch(input,init);const b=await r.clone().json();write(label+'-response.json',b);
  write(label+'-attempt.json',{phase,currentCase,number,status:r.status,latencyMs:Date.now()-start,model:u.pathname.split('/').at(-1).split(':')[0],usage:b.usageMetadata??null,finishReason:b.candidates?.map(c=>c.finishReason)??[],requestBodySha256:sha(init.body)});return r;
 }catch{write(label+'-transport-failure.json',{phase,currentCase,number,latencyMs:Date.now()-start,error:'transport_failed_details_redacted'});throw Error('experiment_provider_transport_failed');}
};
const previous={};
if(mode==='live'){
 if(!envFile)throw Error('existing_provider_config_required');
 const config=parseEnv(fs.readFileSync(envFile,'utf8'));
 for(const key of ['GEMINI_API_KEY','GEMINI_MODEL','SEC_ANALYSIS_LLM_PROVIDER']){previous[key]=process.env[key];if(config[key])process.env[key]=config[key];}
 if(getServerEnv().secAnalysisLlmProvider!=='gemini'||!getServerEnv().geminiApiKey)throw Error('existing_gemini_config_required');
 // Create-new reservation prevents rerunning this fixed experiment to cherry-pick outputs.
 write('live-started.json',{at:new Date().toISOString(),cases:manifest.map(x=>x.id),primaryAndEventsSameCall:true});
}
try{
for(const source of manifest){
 currentCase=source.id;
 const bytes=fs.readFileSync(path.join(out,source.id+'.htm'));if(sha(bytes)!==source.sha256)throw Error('source_hash_mismatch');
 const raw={source_code:'sec_edgar',source_group:'filings',source_unique_id:source.accession,source_url:source.url,body_text:bytes.toString('utf8'),raw_payload:{form_type:'425',accession_number:source.accession,cik:source.cik,primary_document_url:source.url,documents:[{type:'425',isPrimary:true,url:source.url,filename:source.document,description:'Primary 425 document'}]}};
 const input=runtime.buildInputFromSecRawRow(raw),parser=input.filing_package.hard_parsers['425'];
 if(mode==='prepare'){
  write(source.id+'-input.json',input);write(source.id+'-blocks.txt',parser.raw.cleaned_source_blocks.map(b=>`${b.block_id} [${b.document_role}]\n${b.text}`).join('\n\n'));
  write(source.id+'-router-prompt.json',buildSec425RouterPromptForInput(input));
  console.log(JSON.stringify({id:source.id,blocks:parser.raw.cleaned_source_blocks.length,routerBlocks:parser.raw.router_source_blocks.length,warnings:parser.warnings}));continue;
 }
 const env=getServerEnv(),base=runtime.resolveSecLlmConfig(env,{},input);
 phase='router';const routerPrompt=buildSec425RouterPromptForInput(input);
 const routerRun=await runtime.runOpenAiJsonPrompt(env,routerPrompt,runtime.resolveSec425RouterLlmConfig(base,{}));write(source.id+'-router-run.json',routerRun);
 if(!routerRun.ok)throw Error('router_failed_no_experiment_retry');
 const router=normalizeSec425RouterResultForInput(routerRun.parsed,input),normalPath=shouldRunSec425Analysis(router);
 const primary=buildSec425AnalysisPromptForInput(input,router),combined=combineWithFilingEvents(primary),selection=JSON.parse(primary.user);
 const plan=runtime.buildSec425AnalysisModelPlan(primary,base),config=runtime.resolveSec425AnalysisLlmConfig(base,{},plan);
 write(source.id+'-selection.json',{router,normalPath,diagnosticForceAnalysis:!normalPath,plan,blocks:selection.cleaned_source_blocks,selection:selection.analysis_source_selection,sourceTruncated:selection.analysis_source_blocks_truncated,parserBlockCount:parser.raw.cleaned_source_blocks.length});
 for(const [name,prompt] of [['baseline',primary],['combined',combined]]){
  phase=name;write(source.id+'-'+name+'-prompt.json',prompt);
  const start=counter,run=await runtime.runOpenAiJsonPrompt(env,prompt,config,{retryRunawayOnce:true});write(source.id+'-'+name+'-run.json',run);
  const schema=ajv.compile(prompt.responseFormat.json_schema.schema),schemaPass=!!run.parsed&&schema(run.parsed);
  const primaryValue=run.parsed?Object.fromEntries(Object.entries(run.parsed).filter(([k])=>k!=='filing_events')):null;
  const adapted=primaryValue?adaptSec425AnalysisPromptResultForAnalysis(primaryValue,input,router):null;
  const warnings=adapted?.ok?adapted.analysis.sec_425_validation_warnings:[];
  const repairWarnings=(warnings??[]).filter(w=>/key_evidence|current_changes|snapshot/i.test(w));
  let repair=null,repaired=null;
  if(repairWarnings.length){
   phase=name+'-existing-primary-repair';const rp=runtime.buildSec425ValidationRepairPrompt(primary,primaryValue,repairWarnings);write(source.id+'-'+name+'-repair-prompt.json',rp);
   repair=await runtime.runOpenAiJsonPrompt(env,rp,config,{maxAttempts:1,disableFallback:true});write(source.id+'-'+name+'-repair-run.json',repair);
   if(repair.ok)repaired=runtime.applySec425ValidationRepair(primaryValue,repair.parsed,repairWarnings);
  }
  const eventValue=run.parsed?.filing_events,eventCheck=ajv.compile(eventsSchema),eventSchemaPass=!!eventValue&&eventCheck(eventValue);
  write(source.id+'-'+name+'-validation.json',{normalPath,diagnosticForceAnalysis:!normalPath,schemaPass,schemaErrors:schema.errors,primaryAdapter:adapted,existingPrimaryRepairApplied:!!repaired,repairedPrimary:repaired,eventSchemaPass:name==='combined'?eventSchemaPass:null,eventSchemaErrors:name==='combined'?eventCheck.errors:null,evidenceBindings:eventSchemaPass?validateEvidenceBindings(eventValue,selection.cleaned_source_blocks):null,semantics:'manual_review_required',providerAttemptsIncludingExistingPrimaryRepair:counter-start});
  console.log(JSON.stringify({case:source.id,phase:name,normalPath,schemaPass,eventSchemaPass:name==='combined'?eventSchemaPass:null,attempts:counter-start}));
 }
}
}finally{globalThis.fetch=nativeFetch;for(const [key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
