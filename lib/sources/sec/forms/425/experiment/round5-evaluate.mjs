// Offline accounting plus explicitly manual source review. Never correct model output.
import fs from 'node:fs';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {sha256,durableNew} from './round2-guard.mjs';
import {auditRound5Diff,validateRound5Output} from './round5-contract.mjs';

globalThis.fetch=async()=>{throw Error('offline_evaluation_network_forbidden');};
const [directory]=process.argv.slice(2);if(!directory)throw Error('evidence_directory_required');
const read=name=>JSON.parse(fs.readFileSync(path.join(directory,name),'utf8'));
const hash=name=>sha256(fs.readFileSync(path.join(directory,name)));
if(hash('plan.json')!=='a5a2a9698cb597409a96f9574f9b4a4cdabbff2e536e32f5995d1b20e25be69f')throw Error('unreviewed_plan');
const plan=read('plan.json');
const parse=response=>JSON.parse(response.candidates[0].content.parts.filter(p=>p.thought!==true).map(p=>p.text??'').join(''));

// Findings were checked against preserved SEC HTML and exact transmitted heading/text.
// Annotations describe the existing response. They are not automatic semantic inference or repaired output.
const manual={
  signed:{
    selectionPass:true,expectedCount:1,expectedKind:'definitive_agreement_signed',
    selectionBasis:'054/056 report entry into a definitive merger agreement, newly announced here. One signing, no separate board/buyback/proposal candidate. Statement keeps a future two-step merger; no completed closing is asserted.',
    statementAssessment:'SUPPORTED_ACTION_AND_FINAL_MERGER_DIRECTION',
    partiesAssessment:'Named parties supported by056. Adviser limited-purpose participation appears in root quote, but is not explicit in parties/statement/terms.',
    termsAssessment:'INCOMPLETE_USER_FACING_CONDITIONS',
    perTerm:[
      {index:0,result:'LABEL_ONLY',notes:'Agreement Date is only a label; date value is in exact056 evidence.'},
      {index:1,result:'LABEL_ONLY',notes:'Merger Structure is only a label;056/487/488 correctly preserve initial surviving OBDC II and final surviving OBDC in evidence.'},
      {index:2,result:'LABEL_ONLY',notes:'Merger Consideration is only a label;057 contains share conversion and ownership exclusions in evidence.'},
      {index:3,result:'INCOMPLETE_APPLICABILITY',notes:'Exchange Ratio Calculation is only a label. Two exact formula snippets from1501/1503 omit their row thresholds <=100% versus >100%, which are present in transmitted row text. Full HTML table header is not in selected blocks; do not infer or calculate missing context. Not a complete calculation contract.'},
      {index:4,result:'LABEL_ONLY',notes:'Board approvals are supported in056/489/490, correctly not emitted as a separate regulatory event.'},
      {index:5,result:'LABEL_ONLY',notes:'Intended tax treatment is in evidence; label alone does not communicate intended versus completed status.'},
      {index:6,result:'LABEL_ONLY',notes:'Reimbursement cap, percentage and consummation condition are in1504 quotation only.'},
      {index:7,result:'LABEL_ONLY',notes:'Shareholder/regulatory/other closing conditions appear in1505 quote, not in term explanation.'},
      {index:8,result:'LABEL_ONLY',notes:'Conditional expected Q1 2026 closing appears in1505 quote; no occurred closing is claimed.'},
    ],
    semanticDetailPass:false,allQualityGatesPass:false,
  },
  background:{
    selectionPass:true,expectedCount:0,expectedKind:null,
    selectionBasis:'009 reports a filed proxy and future meeting/vote, neither supported announcement. not_applicable/null is correct for supplied scope; uncertainty is not substituted and complete-filing absence is not claimed.',
    statementAssessment:'NOT_APPLICABLE',partiesAssessment:'NOT_APPLICABLE',termsAssessment:'NOT_APPLICABLE',perTerm:[],semanticDetailPass:true,allQualityGatesPass:false,
  },
  'revised-offer':{
    selectionPass:true,expectedCount:1,expectedKind:'acquisition_proposal_announced',
    selectionBasis:'011/019 establish current revised offer;045 supports non-binding;042 supports Star Bulk partnership. One proposal with revised consideration, no separate consideration event. May4/May27 actions from067 do not become current candidates, as required in Round5.',
    statementAssessment:'SUPPORTED_CURRENT_NON_BINDING_PROPOSAL_AND_OWNERSHIP_SCOPE',
    partiesAssessment:'Diana and Star Bulk partnership are supported in042, not hallucinated. Genco is correctly the acquisition target; not-already-owned scope is retained.',
    termsAssessment:'MOST_KEY_TERMS_SUPPORTED_BUT_MATERIAL_QUALIFIERS_OMITTED',
    perTerm:[
      {index:0,result:'SUPPORTED',notes:'Stated implied27.34 from011/019; no code arithmetic.'},
      {index:1,result:'SUPPORTED',notes:'24.80 cash plus one Diana share from011;070 conditional future second-step context is not an occurred merger.'},
      {index:2,result:'SUPPORTED',notes:'Stated2.54 share valuation and30-day VWAP basis from011/008 preserved without calculation.'},
      {index:3,result:'SUPPORTED_SOURCE_CLAIM',notes:'53% undisturbed-price and6% NAV premiums are source-stated009, not independently recomputed/verified.'},
      {index:4,result:'SUPPORTED',notes:'1.433bn financing and explicit absence of financing condition from016/042 preserved.'},
      {index:5,result:'SUPPORTED',notes:'045 supports non-binding and absence of legal obligation until definitive execution.'},
      {index:6,result:'INCOMPLETE_MATERIAL_CONDITION',notes:'068 is now correctly cited, but term says termination of rights plan and omits source alternative OR inapplicability. Majority tender lacks fully diluted basis in the summary. Exact quote retains both; quotation correctness does not cure narrower term wording. Other customary conditions continues in069 heading, not in the chosen068 span.'},
      {index:7,result:'SUPPORTED',notes:'070 preserves planned second-step merger contingent on successful offer, not actual completion.'},
      {index:8,result:'SUPPORTED',notes:'042 preserves partnership and explicit absence of Star Bulk transaction-completion condition.'},
    ],
    additionalOmission:'Current cash-component adjustment for dividends/distributions in067 is not included. Historical standalone actions are intentionally not requested and their non-return is not a Round5 failure.',
    semanticDetailPass:false,allQualityGatesPass:false,
  },
};

const results=[];
for(const [index,c]of plan.cases.entries()){
  const id=c.id,attempt=read(`ledger/attempt-${index+1}.json`),receipt=read(`ledger/result-${index+1}.json`);
  if(attempt.caseId!==id||attempt.planSha256!==hash('plan.json')||receipt.caseId!==id||receipt.httpStatus!==200||receipt.finishReason!=='STOP')throw Error('unexpected_actual_request');
  for(const [name,digest]of [[id+'.htm',c.sourceSha256],[id+'-saved-router.json',c.savedRouterSha256],[id+'-prompt.json',c.promptSha256],[id+'-request.json',c.requestSha256],[id+'-response.json',receipt.responseSha256],[id+'-validation.json',receipt.validationSha256],[id+'-round4-response.json',c.referenceResponseSha256]])if(hash(name)!==digest)throw Error('frozen_artifact_changed');
  const prompt=read(id+'-prompt.json'),request=read(id+'-request.json'),source=JSON.parse(prompt.user).cleaned_source_blocks;
  auditRound5Diff(read(id+'-round4-prompt.json'),read(id+'-round4-request.json'),prompt,request);
  const body=read(id+'-response.json'),output=parse(body),validation=validateRound5Output(output,source);
  if(body.modelVersion!==c.model||!isDeepStrictEqual(validation,read(id+'-validation.json')))throw Error('model_or_validation_changed');
  const input=receipt.usage.promptTokenCount,out=receipt.usage.candidatesTokenCount,thinking=receipt.usage.thoughtsTokenCount??0,lite=c.model==='gemini-2.5-flash-lite';
  const actualCount=output.announcement===null?0:1;
  if(actualCount!==manual[id].expectedCount||output.announcement?.kind!==undefined&&output.announcement.kind!==manual[id].expectedKind)throw Error('manual_annotation_not_aligned_with_frozen_output');
  results.push({id,accession:c.accession,sourceSha256:c.sourceSha256,sourceUrl:c.sourceUrl,model:c.model,receipt,rawOutput:output,validation,manualDirectSourceReview:manual[id],selectionCount:actualCount,quotes:{total:validation.citation.proofs.length,exact:validation.citation.proofs.filter(p=>p.exact).length,over240:validation.citation.proofs.filter(p=>!p.lengthPass).length},round4Reference:parse(read(id+'-round4-response.json')).filing_events,Primary:'NOT_REQUESTED_NOT_EVALUATED',cost:{input,output:out,thinking,estimatedUSD:(input*(lite?0.1:0.3)+(out+thinking)*(lite?0.4:2.5))/1e6}});
}
if(fs.readdirSync(path.join(directory,'ledger')).filter(n=>/^attempt-/.test(n)).length!==3)throw Error('unexpected_attempt_count');
const totals=results.reduce((a,r)=>({input:a.input+r.cost.input,output:a.output+r.cost.output,thinking:a.thinking+r.cost.thinking,latencyMs:a.latencyMs+r.receipt.latencyMs,estimatedUSD:a.estimatedUSD+r.cost.estimatedUSD,quotes:a.quotes+r.quotes.total,exact:a.exact+r.quotes.exact,over240:a.over240+r.quotes.over240}),{input:0,output:0,thinking:0,latencyMs:0,estimatedUSD:0,quotes:0,exact:0,over240:0});
const evaluation={status:'THREE_REQUESTS_COMPLETE_SELECTION_3_OF_3_FULL_QUALITY_0_OF_3',planSha256:hash('plan.json'),actualProviderRequests:3,perCaseRequests:1,router:0,baseline:0,retry:0,repair:0,fallback:0,tokenCountApi:0,modelValidationApi:0,secNetwork:0,db:0,PrimaryCalls:0,rawOutputMutations:0,results,totals,priceSource:'https://ai.google.dev/gemini-api/docs/pricing',priceSnapshotDate:'2026-10-14',priceBasis:'previously verified Standard Flash .30/2.50 and Lite .10/.40 USD per million; historical estimate',actualBilling:'UNVERIFIED',comparisonLimit:'Task scope and Primary presence changed together; Round3/4 are references, not single-variable causal proof',scopeLimit:'Three observed samples only; no general correctness/product alert readiness',nextAction:'STOP_NO_TUNING_OR_RETRY'};
durableNew(path.join(directory,'FINAL-ROUND5-EVALUATION.json'),evaluation);
console.log(JSON.stringify({status:evaluation.status,totals,cases:results.map(r=>({id:r.id,decision:r.rawOutput.decision,count:r.selectionCount,kind:r.rawOutput.announcement?.kind??null,shape:r.validation.confirmationShapePass,schema:r.validation.schemaPass,quotes:r.quotes,selection:r.manualDirectSourceReview.selectionPass,detail:r.manualDirectSourceReview.semanticDetailPass}))}));
