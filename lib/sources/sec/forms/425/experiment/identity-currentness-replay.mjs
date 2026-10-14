// Offline only. Historical model responses are never migrated into new model answers.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createSec425FactCandidate} from '../factsCandidate.ts';
import {inspectSec425Currentness} from '../verification.ts';
import {adaptSec425AnalysisPromptResultForAnalysis} from '../../../../../ai/sec425AnalysisAdapter.ts';
globalThis.fetch=async()=>{throw Error('offline_network_forbidden');};
const [evidenceRoot,receiptPath]=process.argv.slice(2);
if(!evidenceRoot||!receiptPath)throw Error('evidence_root_and_new_receipt_required');
const tracked=new Map(),sha=b=>createHash('sha256').update(b).digest('hex');
const load=p=>{const b=fs.readFileSync(p);tracked.set(p,sha(b));return b;};
const json=p=>JSON.parse(load(p).toString('utf8'));
const parse=r=>JSON.parse(r.candidates[0].content.parts.filter(p=>p.thought!==true).map(p=>p.text??'').join(''));
const trial=path.join(evidenceRoot,'sec425-fact-monitor-v1-20261015','trial'),plan=json(path.join(trial,'plan.json'));
const results=[];
for(const [i,c]of plan.cases.entries()){
 const responsePath=path.join(trial,c.id+'-response.json'),receipt=json(path.join(trial,`ledger/result-${i+1}.json`));
 const response=json(responsePath);assert.equal(tracked.get(responsePath),receipt.responseSha256);
 const requestPath=path.join(trial,c.id+'-request.json');load(requestPath);assert.equal(tracked.get(requestPath),c.requestSha256);
 const promptPath=path.join(trial,c.id+'-prompt.json'),prompt=json(promptPath);assert.equal(tracked.get(promptPath),c.promptSha256);
 const source=json(path.join(trial,c.id+'-source.json')),bytes=load(path.join(trial,c.sourceFile));assert.equal(sha(bytes),c.sourceSha256);
 const blocks=JSON.parse(prompt.user).cleaned_source_blocks,raw=parse(response),before=JSON.stringify(raw);
 const candidate=createSec425FactCandidate(source,bytes,raw,blocks);
 assert.equal(JSON.stringify(raw),before);assert.deepEqual(candidate.rawOutput,raw);
 if(c.id==='background')assert.equal(candidate.assessment.currentness.status,'conflict');
 for(const identity of candidate.assessment.identities)assert.equal(identity.verifiedTicker,null);
 results.push({case:c.id==='background'?'Axcelis':c.id==='signed'?'Blue Owl':'Diana/Genco',source,responseSha256:tracked.get(responsePath),
  originalDecision:raw.decision,originalAnnouncementType:raw.announcement?.announcement_type,
  currentness:candidate.assessment.currentness,identities:candidate.assessment.identities,
  rawPartyRoles:raw.announcement?.parties.map(p=>({name:p.name,role:p.role,ticker:p.ticker})),
  citationPass:candidate.assessment.citationPass,mechanicalPass:candidate.assessment.mechanicalPass,
  oldResponseUnderNewGuard:true,newModelResponse:false,officialPartySnapshotsSupplied:0,rawUnchanged:true});
}
const masterPath=path.join(trial,'background-round5-reference-response.json'),master=parse(json(masterPath));
assert.equal(master.decision,'not_applicable');assert.equal(master.announcement,null);
results.push({case:'MasterBrand',contract:'preserved Round5, not v2 model output',responseSha256:tracked.get(masterPath),
 originalDecision:master.decision,originalAnnouncement:master.announcement,
 currentness:inspectSec425Currentness({decision:master.decision,announcementType:null,evidence:master.evidence},[]),rawUnchanged:true});
const primary=[];
const round4=path.join(evidenceRoot,'sec425-primary-events-round4-20261015'),round4Plan=json(path.join(round4,'plan.json'));
for(const id of ['signed','background','revised-offer']){
 const root=path.join(evidenceRoot,'sec425-primary-events-round4-20261015'),raw=parse(json(path.join(root,id+'-response.json')));
 const input=json(path.join(evidenceRoot,'sec425-primary-events-20261014',id+'-input.json'));
 const router=json(path.join(root,id+'-saved-router.json')).parsed;
 const originalCase=round4Plan.cases.find(c=>c.id===id);
 assert.equal(sha(load(path.join(root,id+'.htm'))),originalCase.sourceSha256);
 assert.equal(sha(load(path.join(root,id+'-request.json'))),originalCase.requestSha256);
 const result=adaptSec425AnalysisPromptResultForAnalysis(raw,input,router);
 assert.equal(result.ok,true);assert.deepEqual(result.analysis.sec_425_raw_model_output,raw);
 assert.equal(result.analysis.summary,raw.analysis_output.summary.trim());
 primary.push({id,originalPrimaryTicker:raw.analysis_output.primary_ticker,projectedTicker:result.analysis.primary_ticker,
  identity:result.analysis.sec_425_identity,rawPreserved:true,summaryPreserved:true,
  caveat:'Legacy package lacks new exact SEC catalog row provenance; no official source has been fabricated.'});
}
for(const [p,h]of tracked)assert.equal(sha(fs.readFileSync(p)),h);
fs.writeFileSync(receiptPath,JSON.stringify({mode:'offline_saved_response_replay',providerCalls:0,secCalls:0,dbCalls:0,
 preservedFiles:tracked.size,hashes:Object.fromEntries(tracked),results,primary,
 semanticAccuracyOfNewModel:'UNVERIFIED_NO_MODEL_CALL',automaticAlerts:0,mutatedResponses:0},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({receiptPath,filesUnchanged:tracked.size,results:results.map(x=>({case:x.case,currentness:x.currentness.status})),primaryReplays:primary.length,providerCalls:0,dbCalls:0}));
