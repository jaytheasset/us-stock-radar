// Bounded diagnostic only. No DB/worker/ingest execution, output repair or retry.
import fs from 'node:fs';
import path from 'node:path';
import {parseEnv} from 'node:util';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {sourceInput,responseAssessment} from '../lib/sec425/storage.ts';
import {assessFacts,locateProof} from '../lib/sec425/facts.ts';
import {sendFactMonitorOnce} from '../lib/sources/sec/forms/425/experiment/fact-monitor-guard.mjs';
import {sha256,durableNew} from '../lib/sources/sec/forms/425/experiment/round2-guard.mjs';

const nativeFetch=globalThis.fetch;
globalThis.fetch=async()=>{throw Error('diagnostic_network_forbidden');};
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const [mode,directory,evidenceRootOrCase,credentialFile]=process.argv.slice(2);
if(!['prepare','send'].includes(mode)||!directory)throw Error('prepare directory evidence_root | send directory case existing_credentials_file');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const write=(n,x)=>durableNew(path.join(directory,n),x);
const parse=b=>JSON.parse(b.candidates[0].content.parts.filter(p=>!p.thought).map(p=>p.text??'').join(''));
const codeFiles=['lib/sec425/facts.ts','lib/sec425/storage.ts','lib/sec425/conditions.ts','lib/ai/sec425FactInput.ts','lib/ai/secFilingAnalysisPreview.ts','lib/prompts/secFilingAnalysisPackage.ts','lib/sources/sec/forms/425/verification.ts','lib/sources/sec/sourceTickerSelection.ts','scripts/verify-sec425-disclosure-first.mjs','lib/sources/sec/forms/425/experiment/fact-monitor-guard.mjs'];
function checkpoint(status,next){
 const attempts=fs.readdirSync(path.join(directory,'ledger')).filter(n=>/^attempt-[1-3]\.json$/.test(n));
 fs.writeFileSync(path.join(directory,'ACTIVE-CHECKPOINT.json'),JSON.stringify({task:'425 disclosure-first FACT',base:'dffaed945279fe14855bc317d496218fece92996',budget:3,used:attempts.length,status,next,priorBudgetClosed:true},null,2));
}
if(mode==='prepare'){
 const root=evidenceRootOrCase;if(!root)throw Error('evidence_root_required');
 const sourceDir=path.join(root,'sec425-veeco-stage-trial-20261015/sources'),oldProduct=path.join(root,'sec425-monitor-product-20261015');
 const tracked={},track=p=>{const b=fs.readFileSync(p);tracked[p]=sha256(b);return b;};
 const json=p=>JSON.parse(track(p).toString('utf8'));
 const cases=[],baseline=[];
 for(const [id,label]of [['background','axcelis'],['revised-offer','diana'],['signed','blue-owl']]){
  let raw,provenance,oldResponse,oldRequest;
  if(id!=='signed'){
   const rawPath=path.join(sourceDir,label+'-fresh-raw.json');raw=json(rawPath);
   provenance={kind:'preserved_production_collector_raw',rawPath,rawFileSha256:tracked[rawPath],identitySupplementation:false};
   oldResponse=json(path.join(oldProduct,'budget',label+'-response.json'));oldRequest=json(path.join(oldProduct,'budget',label+'-request.json'));
  }else{
   const prior=path.join(root,'sec425-primary-events-20261014');
   const source=json(path.join(prior,'sources.json')).find(s=>s.id==='signed'),bytes=track(path.join(prior,'signed.htm'));
   assert.equal(sha256(bytes),source.sha256);
   // Reuse the original archive's manifest/HTML envelope, not its generated parser/LLM data.
   // No collected official identity or timestamps exist here: they stay absent.
   raw={source_code:'sec_edgar',source_group:'filings',source_unique_id:source.accession,source_url:source.url,body_text:bytes.toString('utf8'),
    raw_payload:{form_type:'425',accession_number:source.accession,cik:source.cik,primary_document_url:source.url,
     primary_document_html:bytes.toString('utf8'),primary_document_html_truncated:false,
     documents:[{type:'425',isPrimary:true,url:source.url,filename:source.document,description:'Primary 425 document'}]}};
   provenance={kind:'archived_primary_html_manifest_envelope',sourceManifest:path.join(prior,'sources.json'),sourceHtml:path.join(prior,'signed.htm'),
    normalCollectorRawAvailable:false,officialIdentity:'unavailable; not injected',timestamps:'unavailable; not inferred from action',
    limitation:'Common production sourceInput/package/parser used over archived primary bytes; NOT a full collector/identity replay. No DB import.'};
   oldResponse=json(path.join(root,'sec425-fact-monitor-v1-20261015/trial/signed-response.json'));
  }
  const source=sourceInput(raw),old=parse(oldResponse),user=JSON.parse(source.prompt.user);
  if(oldRequest){assert.deepEqual(source.request.generationConfig,oldRequest.generationConfig);}
  write(id+'-raw.json',raw);write(id+'-input.json',source.input);write(id+'-prompt.json',source.prompt);write(id+'-request.json',JSON.stringify(source.request));
  write(id+'-prior-response.json',oldResponse);
  if(oldRequest)write(id+'-prior-request.json',oldRequest);
  const references=user.official_company_references;
  if(id==='signed')assert.equal(references.length,0);
  const priorAssessment=oldRequest?assessFacts(old,source.input):null;
  if(id==='background'){assert.equal(old.announcement.announcement_type,'definitive_agreement_signed');assert.equal(priorAssessment.status,'available');}
  baseline.push({id,label,priorDecision:old.decision,priorType:old.announcement?.announcement_type??null,priorReason:old.reason,priorStatement:old.announcement?.statement??null,
   oldSchemaPreserved:true,oldOutputNotReclassified:true,priorMechanicalStatus:priorAssessment?.status??'different_legacy_contract',
   sameUserAsProduct:oldRequest?oldRequest.contents[0].parts[0].text===source.request.contents[0].parts[0].text:null,
   generationSettingsUnchanged:oldRequest?true:'same production serializer/Flash as current other cases'});
  cases.push({id,label,model:'gemini-2.5-flash',sourceSha256:source.binding.sourceSha256,accession:source.binding.accession,
   sourceUrl:source.binding.sourceUrl,provenance,rawSha256:sha256(fs.readFileSync(path.join(directory,id+'-raw.json'))),
   inputSha256:sha256(fs.readFileSync(path.join(directory,id+'-input.json'))),promptSha256:sha256(fs.readFileSync(path.join(directory,id+'-prompt.json'))),
   requestSha256:sha256(fs.readFileSync(path.join(directory,id+'-request.json'))),blockCount:user.cleaned_source_blocks.length,references,
   generationSettings:source.request.generationConfig});
 }
 const masterDir=path.join(root,'sec425-two-announcements-round5-20261015');
 const masterResponse=json(path.join(masterDir,'background-response.json')),master=parse(masterResponse),masterPrompt=json(path.join(masterDir,'background-prompt.json'));
 assert.equal(master.decision,'not_applicable');assert.equal(master.announcement,null);
 const blocks=JSON.parse(masterPrompt.user).cleaned_source_blocks,proofs=master.evidence.map(p=>locateProof(p,blocks));assert.ok(proofs.every(Boolean));
 const masterBytes=track(path.join(masterDir,'background.htm'));
 write('masterbrand-offline.json',{sourceSha256:sha256(masterBytes),decision:master.decision,announcement:master.announcement,reason:master.reason,proofs,
  mode:'retained old-contract response; no new extraction or code semantic classifier',providerCalls:0});
 write('BASELINE-REVIEW.json',{baseline,masterbrand:'retained not_applicable; source009 proxy filing and scheduled vote',
  manualSourceCriterion:{background:'current shareholder approval, previously announced agreement; old enum contradicts its own rationale',
   'revised-offer':'current revised non-binding proposal with source valuation and ownership exclusion',signed:'actual signed agreement, closing conditional; OBDC II is not established ticker'},
  noAutomaticSemanticCorrection:true});
 const codeHashes=Object.fromEntries(codeFiles.map(n=>[n,sha256(fs.readFileSync(path.join(repo,n)))]));
 const plan={version:'sec425-fact-monitor-v1',task:'disclosure-first-20261015',base:'dffaed945279fe14855bc317d496218fece92996',maxRequests:3,cases,codeHashes,retainedInputs:tracked,
  schemaChanged:false,db:0,worker:0,secNetwork:0,router:0,primary:0,compiler:0,retry:0,repair:0,fallback:0};
 write('plan.json',plan);write('plan-sha256.txt',sha256(fs.readFileSync(path.join(directory,'plan.json'))));
 checkpoint('FROZEN_PREPARED','offline tests then one bounded request per case; no mid-trial changes');
 console.log(JSON.stringify({used:0,cases:cases.map(c=>({id:c.id,label:c.label,blocks:c.blockCount,refs:c.references.map(r=>r.ref),provenance:c.provenance.kind})),baseline}));
}else{
 const id=evidenceRootOrCase,plan=read(path.join(directory,'plan.json')),digest=fs.readFileSync(path.join(directory,'plan-sha256.txt'),'utf8').trim();
 assert.equal(plan.task,'disclosure-first-20261015');assert.equal(sha256(fs.readFileSync(path.join(directory,'plan.json'))),digest);
 for(const [n,h]of Object.entries(plan.codeHashes))assert.equal(sha256(fs.readFileSync(path.join(repo,n))),h,'frozen_code_changed');
 for(const [n,h]of Object.entries(plan.retainedInputs))assert.equal(sha256(fs.readFileSync(n)),h,'retained_evidence_changed');
 const item=plan.cases.find(c=>c.id===id);if(!item)throw Error('unapproved_case');
 for(const [suffix,hashKey]of [['raw','rawSha256'],['input','inputSha256'],['prompt','promptSha256'],['request','requestSha256']])assert.equal(sha256(fs.readFileSync(path.join(directory,id+'-'+suffix+'.json'))),item[hashKey]);
 const source=sourceInput(read(path.join(directory,id+'-raw.json')));assert.equal(sha256(JSON.stringify(source.request)),item.requestSha256);
 if(!credentialFile)throw Error('existing_credential_file_required');
 const apiKey=parseEnv(fs.readFileSync(credentialFile,'utf8')).GEMINI_API_KEY;if(!apiKey)throw Error('existing_gemini_key_missing');
 if(JSON.stringify(source.request).includes(apiKey))throw Error('credential_in_request');
 try{
  const result=await sendFactMonitorOnce({directory,caseId:id,expectedPlanSha256:digest,apiKey,fetchImpl:nativeFetch,
   validateOutput:output=>{const a=assessFacts(output,source.input);return{ok:a.status!=='invalid',schemaPass:a.status!=='invalid',assessment:a,semanticAccuracy:'manual_source_review_required',corrected:false};}});
  // Preserve native response; repeat product response decoder only as read-only mechanical check.
  try{write(id+'-product-assessment.json',responseAssessment(fs.readFileSync(path.join(directory,id+'-response.json'),'utf8'),source));}catch{write(id+'-product-assessment.json',{status:'unavailable_no_repair'});}
  checkpoint('CALL_SETTLED',fs.readdirSync(path.join(directory,'ledger')).filter(n=>/^attempt-[1-3]\.json$/.test(n)).length===3?'budget exhausted; source-based report and stop':'only unsent frozen cases remain; no tuning');
  console.log(JSON.stringify({caseId:id,number:result.number,status:result.status,usage:result.body.usageMetadata,decision:result.parsed?.decision,type:result.parsed?.announcement?.announcement_type??null}));
 }catch{checkpoint('HALTED_OR_BLOCKED','inspect preserved receipt; no retry or fallback');throw Error('bounded_trial_stopped_no_retry');}
}
