import fs from 'node:fs';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {sha256,durableNew} from './round2-guard.mjs';
import {SEC425_FACT_SYSTEM,SEC425_FACT_LOCAL_SCHEMA,SEC425_FACT_WIRE_SCHEMA} from '../factsCandidate.ts';
import {parseSec425Filing} from '../parser.ts';

globalThis.fetch=async()=>{throw Error('offline_prepare_network_forbidden');};
const [prior,evidenceRoot]=process.argv.slice(2);if(!prior||!evidenceRoot)throw Error('prior_round5_and_evidence_root_required');
const readPrior=n=>JSON.parse(fs.readFileSync(path.join(prior,n),'utf8'));
if(sha256(fs.readFileSync(path.join(prior,'plan.json')))!=='a5a2a9698cb597409a96f9574f9b4a4cdabbff2e536e32f5995d1b20e25be69f')throw Error('prior_plan_changed');
const previous=readPrior('plan.json'),directory=path.join(evidenceRoot,'trial');fs.mkdirSync(directory);
const write=(n,v)=>durableNew(path.join(directory,n),v);
const cases=[];
for(const id of ['signed','background','revised-offer']){
 const priorCase=previous.cases.find(c=>c.id===id),oldPrompt=readPrior(id+'-prompt.json'),oldRequest=readPrior(id+'-request.json');
 for(const [n,hash]of [[id+'-prompt.json',priorCase.promptSha256],[id+'-request.json',priorCase.requestSha256]])if(sha256(fs.readFileSync(path.join(prior,n)))!==hash)throw Error('prior_request_changed');
 let source,user,sourceFile,sourceBytes,label,truth;
 if(id==='background'){
  sourceFile='heldout-axcelis-excerpts.txt';sourceBytes=fs.readFileSync(path.join(evidenceRoot,sourceFile));
  source={accession:'0001104659-26-011578',sourceUrl:'https://www.sec.gov/Archives/edgar/data/1113232/000110465926011578/tm265450d2_425.htm',sourceSha256:sha256(sourceBytes),representation:'sec_public_text_excerpt'};
  const parsed=parseSec425Filing({accessionNumber:source.accession,formType:'425',sourceUrl:source.sourceUrl,primaryDocumentUrl:source.sourceUrl,primaryDocumentFilename:'tm265450d2_425.htm',filingText:sourceBytes.toString('utf8')});
  if(!parsed.raw.cleaned_source_blocks.length)throw Error('heldout_parser_no_blocks');
  user=JSON.stringify({source,scope:'Only preserved official public text excerpts, not publisher raw HTML or whole filing',cleaned_source_blocks:parsed.raw.cleaned_source_blocks.map(({block_id,heading,text,source_ref})=>({block_id,heading,text,source_ref}))});
  label='held-out Axcelis current vote / prior merger agreement';
  truth={decision:'not_applicable',announcement:null,basis:'Explicitly previously announced September2025 agreement; current February2026 meeting/vote. Source excerpt only. No ticker cover in supplied excerpt.'};
  fs.copyFileSync(path.join(evidenceRoot,'HELDOUT-SOURCE-REVIEW.json'),path.join(directory,'heldout-source-review.json'),fs.constants.COPYFILE_EXCL);
 }else{
  sourceFile=id+'.htm';sourceBytes=fs.readFileSync(path.join(prior,sourceFile));if(sha256(sourceBytes)!==priorCase.sourceSha256)throw Error('source_changed');
  source={accession:priorCase.accession,sourceUrl:priorCase.sourceUrl,sourceSha256:priorCase.sourceSha256,representation:'raw_html'};
  user=oldPrompt.user;label=id==='signed'?'Blue Owl current definitive agreement':'Diana current revised non-binding proposal';
  truth=id==='signed'?{decision:'confirmed',announcement_type:'definitive_agreement_signed',basis:'One new signed agreement. Future closing separate; adviser limited role. No standalone board/buyback event. Missing current-party ticker evidence stays null; incomplete ratio table context stays unavailable.'}:{decision:'confirmed',announcement_type:'revised_acquisition_proposal',basis:'One current non-binding revised proposal with stated cash/share terms; source-backed acquirer/target roles; no old offers promoted. Preserve alternatives/basis/negative conditions. Do not calculate.'};
 }
 fs.writeFileSync(path.join(directory,sourceFile),sourceBytes,{flag:'wx'});
 const prompt={key:'sec425_fact_candidate_v1',version:'v1',system:SEC425_FACT_SYSTEM,user,responseFormat:{type:'json_schema',json_schema:{name:'sec425_fact_candidate_v1',strict:true,schema:SEC425_FACT_LOCAL_SCHEMA}}};
 const request=structuredClone(oldRequest);request.systemInstruction.parts[0].text=prompt.system;request.contents[0].parts[0].text=user;request.generationConfig.responseSchema=SEC425_FACT_WIRE_SCHEMA;
 const settings=x=>Object.fromEntries(Object.entries(x.generationConfig).filter(([k])=>k!=='responseSchema'));
 if(!isDeepStrictEqual(settings(request),settings(oldRequest)))throw Error('generation_settings_changed');
 write(id+'-prompt.json',prompt);write(id+'-request.json',request);write(id+'-source.json',source);write(id+'-truth-before-call.json',truth);
 const audit={systemChanged:true,outputSchemaChanged:true,userContentsByteIdenticalToRound5:id!=='background',newHeldoutPublicExcerpt:id==='background',generationSettingsIdentical:true,modelUnchanged:true,oldUserSha256:sha256(oldPrompt.user),newUserSha256:sha256(user),sourceRepresentation:source.representation,originalSourceIdentity:source};write(id+'-diff-audit.json',audit);
 cases.push({id,label,model:priorCase.model,source,sourceFile,sourceSha256:source.sourceSha256,sourceMetadataSha256:sha256(fs.readFileSync(path.join(directory,id+'-source.json'))),userSha256:sha256(user),blockCount:JSON.parse(user).cleaned_source_blocks.length,promptSha256:sha256(fs.readFileSync(path.join(directory,id+'-prompt.json'))),requestSha256:sha256(fs.readFileSync(path.join(directory,id+'-request.json'))),truthSha256:sha256(fs.readFileSync(path.join(directory,id+'-truth-before-call.json'))),generationSettings:settings(request)});
}
// Preserve old outputs as old-contract references only: no invented new field values in replay.
for(const id of ['signed','background','revised-offer'])fs.copyFileSync(path.join(prior,id+'-response.json'),path.join(directory,id+'-round5-reference-response.json'),fs.constants.COPYFILE_EXCL);
fs.mkdirSync(path.join(directory,'ledger'));
write('plan.json',{version:'sec425-fact-monitor-v1',maxRequests:3,cases,executionStatus:'PREPARED_NOT_SENT',callsAllocation:{factExtraction:3,Primary:0,naturalLanguageCompiler:0,semanticValidationModel:0},compilerVerification:'injected provider fixtures only; real compiler provider not tested',timeoutMs:120000,router:0,baseline:0,retry:0,repair:0,fallback:0,tokenCountApi:0,canonicalPublishing:false,productionIngestHook:false,db:0,automaticAlert:false});
const digest=sha256(fs.readFileSync(path.join(directory,'plan.json')));write('plan-sha256.txt',digest+'\n');
console.log(JSON.stringify({status:'PREPARED_NOT_SENT',actualProviderRequests:0,planSha256:digest,cases:cases.map(c=>({id:c.id,label:c.label,model:c.model,blocks:c.blockCount,representation:c.source.representation,sourceSha256:c.sourceSha256}))}));
