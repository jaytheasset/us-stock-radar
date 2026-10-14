// Offline evaluation of immutable provider output. Notes below are manual SEC-source assessment, never corrections.
import fs from 'node:fs';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {sha256,durableNew} from './round2-guard.mjs';
import {createSec425FactCandidate} from '../factsCandidate.ts';
globalThis.fetch=async()=>{throw Error('offline_evaluation_network_forbidden');};
const [directory]=process.argv.slice(2);if(!directory)throw Error('directory_required');
const read=n=>JSON.parse(fs.readFileSync(path.join(directory,n),'utf8')),hash=n=>sha256(fs.readFileSync(path.join(directory,n)));
if(hash('plan.json')!=='8e0ad7ac38df558a733c1a01db6cb4ed89c935da92800a4d5a7a432a31d15bad')throw Error('unreviewed_plan');
const plan=read('plan.json'),parse=b=>JSON.parse(b.candidates[0].content.parts.filter(p=>p.thought!==true).map(p=>p.text??'').join(''));
const manual={
 signed:{selectionPass:true,fullQualityPass:false,announcement:'One definitive_agreement_signed, source054/056. Correct future two-step direction; no board/buyback candidate or completed closing.',transactionTypes:'merger is source-supported; no exclusivity or completed-stage inference.',
  parties:[
   {index:0,name:'Blue Owl Capital Corporation II',role:'Target supported by056',ticker:'FAIL: OBDC II is the defined company abbreviation in056/1518, not source-established current trading symbol. Literal containment passes but does not prove symbol identity. Not replaced or set null after output.'},
   {index:1,name:'Blue Owl Capital Corporation',role:'Acquirer supported',ticker:'OBDC is explicitly source-stated NYSE: OBDC in1517, not borrowed from a future combined symbol. Official security identity remains unverified.'},
   {index:2,name:'Cowboy Merger Sub, Inc.',role:'merger_sub and wholly owned participation supported by056',ticker:'null preserved'},
   {index:3,name:'Blue Owl Credit Advisors LLC',role:'Investment adviser is supported, but limited-purpose contractual participation is omitted from value AND selected quote',ticker:'null preserved'},
  ],terms:'Actual values replace Round5 label-only terms. Share-conversion value omits exclusion for shares owned by OBDC/consolidated subsidiaries. NAV basis summary is not a complete exchange-ratio formula and omits possible price-based alternative; selected input table context remains incomplete. Future closing conditionality exists in preceding condition field and quote, but expected-quarter field alone drops the condition. No numerical calculation performed.',
 },
 background:{selectionPass:false,fullQualityPass:false,announcement:'FAIL held-out truth: source says agreement previously announced September2025 and current February2026 meeting/vote. Model confirms an old definitive agreement as a current announcement.',transactionTypes:'merger describes the prior transaction, not evidence of a new announcement.',
  parties:[{index:0,name:'Axcelis Technologies, Inc.',role:'Acquirer supported in full historical excerpt, but own party quote contains name only',ticker:'null correctly retained; cover ACLS was not supplied'},{index:1,name:'Veeco Instruments Inc.',role:'Historical target supported in full excerpt, own quote contains name only',ticker:'null retained'},{index:2,name:'Victory Merger Sub, Inc.',role:'Historical merger subsidiary source-supported',ticker:'null retained'}],
  terms:'Dates and vote outcomes exist in the excerpt, but do not make current signing true. Some term values are labels. Do not filter or rewrite this response into not_applicable.',
 },
 'revised-offer':{selectionPass:true,fullQualityPass:false,announcement:'Current revised_acquisition_proposal and non-binding explanation preserved. No separate price event or historical new candidate.',transactionTypes:'acquisition/tender_offer/planned merger mechanisms are source-supported across011/067/070. Root evidence only007/011/045 does not by itself establish tender/merger tags; source presence and associated evidence coverage differ.',
  parties:[{index:0,name:'Diana Shipping Inc.',role:'acquirer supported by011',ticker:'DSX explicitly stated in own011 quote'},{index:1,name:'Genco Shipping & Trading Limited',role:'target supported by011; source subject is Diana, not filed-by CIK copied to Genco',ticker:'GNK explicitly stated in own011 quote'},{index:2,name:'4 Dragon Merger Sub Inc.',role:'Named subsidiary in historical May4 tender action067; current role continuity is not independently restated in chosen evidence and needs review',ticker:'null retained'},{index:3,name:'Star Bulk Carriers Corp.',role:'Current partnership and no Star Bulk completion condition supported by042',ticker:'null retained'},{index:4,name:'DNB Carnegie',role:'Financial adviser supported044',ticker:'null retained'},{index:5,name:'Fried, Frank, Harris, Shriver & Jacobson LLP',role:'Legal counsel supported044',ticker:'null retained'},{index:6,name:'Seward & Kissel LLP',role:'Legal counsel supported044',ticker:'null retained'}],
  terms:'Cash/share/source-stated2.54 basis and non-binding/no-financing conditions retained. OR inapplicability and fully diluted basis now retained in the long condition value and quote. Value continues with conditions from069 but selected evidence ends068. Cash adjustment for distributions067 omitted. The standalone27.34 field omits implied wording, retained in statement/quote. Several values are long copied passages rather than concise terms; no code shortening. Star Bulk no-completion condition is preserved in party participation rather than key_terms.',
 },
};
const results=[];
for(const [i,c]of plan.cases.entries()){
 const id=c.id,receipt=read(`ledger/result-${i+1}.json`),attempt=read(`ledger/attempt-${i+1}.json`);
 if(receipt.caseId!==id||receipt.httpStatus!==200||receipt.finishReason!=='STOP'||attempt.planSha256!==hash('plan.json'))throw Error('unexpected_attempt');
 for(const [name,digest]of [[c.sourceFile,c.sourceSha256],[id+'-source.json',c.sourceMetadataSha256],[id+'-prompt.json',c.promptSha256],[id+'-request.json',c.requestSha256],[id+'-truth-before-call.json',c.truthSha256],[id+'-response.json',receipt.responseSha256],[id+'-validation.json',receipt.validationSha256]])if(hash(name)!==digest)throw Error('evidence_changed');
 const response=read(id+'-response.json'),raw=parse(response),blocks=JSON.parse(read(id+'-prompt.json').user).cleaned_source_blocks;
 const candidate=createSec425FactCandidate(read(id+'-source.json'),fs.readFileSync(path.join(directory,c.sourceFile)),raw,blocks);
 if(!isDeepStrictEqual(candidate,read(id+'-validation.json').candidate)||response.modelVersion!==c.model)throw Error('candidate_or_model_changed');
 const proofs=[];const visit=(node,p='')=>{if(Array.isArray(node)){node.forEach((x,j)=>visit(x,`${p}/${j}`));return;}if(!node||typeof node!=='object')return;if(Array.isArray(node.evidence))node.evidence.forEach((x,j)=>proofs.push({path:`${p}/evidence/${j}`,...x}));for(const[k,v]of Object.entries(node))if(k!=='evidence')visit(v,`${p}/${k}`);};visit(raw);
 const normalize=s=>s.replace(/\s+/g,' ').trim();
 const citationDiagnostics=candidate.assessment.bindings.map(b=>{const p=proofs.find(p=>p.path===b.path),field=blocks.find(x=>x.block_id===p.block_id)?.[p.source_field];return {...b,whitespaceOnly:!b.exact&&typeof field==='string'&&normalize(field).includes(normalize(p.quote)),acceptedByNormalization:false};});
 const input=receipt.usage.promptTokenCount,output=receipt.usage.candidatesTokenCount,thinking=receipt.usage.thoughtsTokenCount??0,lite=c.model==='gemini-2.5-flash-lite';
 results.push({id,label:c.label,source:c.source,truth:read(id+'-truth-before-call.json'),receipt,candidate,manualSourceAssessment:manual[id],citationDiagnostics,usage:{input,output,thinking,estimatedUSD:(input*(lite?0.1:0.3)+(output+thinking)*(lite?0.4:2.5))/1e6}});
}
const totals=results.reduce((a,r)=>({input:a.input+r.usage.input,output:a.output+r.usage.output,thinking:a.thinking+r.usage.thinking,latencyMs:a.latencyMs+r.receipt.latencyMs,estimatedUSD:a.estimatedUSD+r.usage.estimatedUSD,quotes:a.quotes+r.citationDiagnostics.length,exact:a.exact+r.citationDiagnostics.filter(x=>x.exact).length,over240:a.over240+r.citationDiagnostics.filter(x=>x.length>240).length,whitespaceOnly:a.whitespaceOnly+r.citationDiagnostics.filter(x=>x.whitespaceOnly).length}),{input:0,output:0,thinking:0,latencyMs:0,estimatedUSD:0,quotes:0,exact:0,over240:0,whitespaceOnly:0});
const historicalReference=['signed','background','revised-offer'].map(id=>{const output=parse(read(id+'-round5-reference-response.json'));return {id,contract:'Round5 old schema only',decision:output.decision,kind:output.announcement?.kind??null,newFieldsInvented:0};});
const result={status:'CANDIDATE_IMPLEMENTED_LIVE_EXTRACTION_QUALITY_NOT_READY',planSha256:hash('plan.json'),actualProviderRequests:3,PrimaryCalls:0,compilerLiveCalls:0,router:0,baseline:0,retry:0,repair:0,fallback:0,db:0,automaticAlerts:0,liveSelectionPass:'2/3; held-out FAIL',fullQualityPass:'0/3',results,totals,historicalReference,priceBasis:'Historical2026-10-14 official Standard snapshot Flash0.30/2.50 Lite0.10/0.40 USD/million; actual invoice unverified',sourceRepresentation:'Axcelis public excerpt, not raw HTML/full ingestion E2E',semanticCorrectionsApplied:0,nextAction:'STOP_NO_RESPONSE_TUNING; independent review required before next product connection'};
durableNew(path.join(directory,'FINAL-FACT-MONITOR-EVALUATION.json'),result);
console.log(JSON.stringify({status:result.status,selection:result.liveSelectionPass,fullQuality:result.fullQualityPass,totals}));
