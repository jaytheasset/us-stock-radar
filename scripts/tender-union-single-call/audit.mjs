// Offline audit/reporting only. Does not call Gemini or repair any output.
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verify} from './run.mjs';
import {hash,model,projectSource} from '../tender-fact-batches/runner.mjs';
import {contracts} from './contract.mjs';
const root=fileURLToPath(new URL('./',import.meta.url)),repo=join(root,'../..'),json=async p=>JSON.parse(await readFile(p,'utf8'));
const {manifest,cases}=await verify(),baseline=await json(join(root,'baseline.json')),rows=[];let physicalCalls=0,inputTokens=0,outputTokens=0;
for(const c of cases){
 const sourceText=JSON.stringify(projectSource(c.source).providerSource),b=baseline.cases[c.identity.name],files=await readdir(c.folder);
 assert.equal(hash(await readFile(join(root,manifest.cases.find(m=>m.name===c.identity.name).sourceFile))),b.sourceHash);
 const row={name:c.identity.name,accession:c.source.accession,form:c.source.form,evidenceCount:c.source.evidence.length,selectedSourceChars:c.source.evidence.reduce((n,e)=>n+e.text.length,0),providerInputChars:sourceText.length,requestChars:c.body.length,expected:b.facts};
 if(!files.includes('started.json')){assert.ok(!files.includes('provider-response.txt'));rows.push({...row,physicalCalls:0,status:'NOT_RUN; stopped after DXL failure',promptTokens:null,outputTokens:null});continue;}
 const started=await json(join(c.folder,'started.json')),a=await json(join(c.folder,'audit.json')),r=await json(join(c.folder,'review.json')),raw=await readFile(join(c.folder,'structured.txt'),'utf8'),p=await json(join(c.folder,'provider-response.txt')),output=JSON.parse(raw),prov=await json(join(c.folder,'provenance-audit.json'));
 assert.equal(started.physicalCallLimit,1);assert.equal(started.requestHash,hash(c.body));assert.equal(started.mappingHash,c.frozenMapHash);assert.equal(a.physicalCalls,1);assert.equal(a.modelVersion,model);assert.equal(a.technicalPass,true);assert.equal(r.outputHash,hash(raw));assert.equal(raw,p.candidates[0].content.parts.filter(p=>typeof p.text==='string'&&!p.thought).map(p=>p.text).join(''));
 for(const f of output.facts){const support=r.facts[f.type];assert.ok(support);const claimKey=f.type==='final_results_observed'?'observed':'current';assert.ok(Object.values(support[claimKey]).some(v=>v.startsWith('DIRECT:')));if(f.previous)assert.ok(Object.values(support.previous).some(v=>v.startsWith('DIRECT:')));
  const reviewedRefs=new Set(Object.values(support).filter(x=>typeof x==='object').flatMap(x=>Object.keys(x)));assert.deepEqual([...reviewedRefs].sort(),[...f.evidence_refs].sort());for(const ref of f.evidence_refs)assert.ok(prov.resolved.some(x=>x.fact_index===output.facts.indexOf(f)&&x.ref===ref));
 }
 physicalCalls+=a.physicalCalls;inputTokens+=a.usage.promptTokenCount;outputTokens+=a.usage.candidatesTokenCount;
 rows.push({...row,physicalCalls:a.physicalCalls,httpStatus:a.httpStatus,modelVersion:a.modelVersion,promptTokens:a.usage.promptTokenCount,outputTokens:a.usage.candidatesTokenCount,totalTokens:a.usage.totalTokenCount,latencyMs:a.latencyMs,outputTypes:output.facts.map(f=>f.type),schema:a.validation.providerSchema.valid,local:a.validation.local.valid,provenance:prov.valid,status:r.pass?'PASS':'FAIL',failureClass:r.failureClass,missingTypes:r.missingTypes,extraTypes:r.extraTypes,previousErrors:r.previousErrors,contamination:r.contamination});
}
assert.equal(physicalCalls,2);assert.equal(rows[0].status,'PASS');assert.equal(rows[1].status,'FAIL');assert.ok(rows.slice(2).every(r=>r.physicalCalls===0));
// Existing usage records only; do NOT load old model output/expected values.
const historicalPaths={
 'rumble-active':['scripts/tender-fact-batches/offer_price/runs/initial-competing/audit.json','scripts/tender-fact-batches/board_recommendation/runs/rumble-no-recommendation/audit.json','scripts/tender-terminal-facts/offer_status/runs/rumble-right-only/audit.json','scripts/tender-terminal-facts/final_results_observed/runs/rumble-active/audit.json'],
 'dxl-amendment':['scripts/tender-fact-batches/offer_price/runs/dxl-revised/audit.json','scripts/tender-fact-batches/board_recommendation/runs/dxl-amendment/audit.json','scripts/tender-terminal-facts/final_results_observed/runs/dxl-interim/audit.json']};
const historical=[];
for(const [name,paths]of Object.entries(historicalPaths)){const entries=[];for(const path of paths){const a=await json(join(repo,path));assert.equal(a.modelVersion,model);assert.equal(a.accession,rows.find(r=>r.name===name).accession);entries.push({path,fact:a.fact,inputTokens:a.usage.promptTokenCount,outputTokens:a.usage.candidatesTokenCount});}const oldInput=entries.reduce((n,a)=>n+a.inputTokens,0),newInput=rows.find(r=>r.name===name).promptTokens;historical.push({name,entries,oldCalls:entries.length,newCalls:1,oldInput,newInput,inputReductionPercent:100*(1-newInput/oldInput),limitation:'Existing independent experiments have different selected packets/prompts; incomplete five-FACT baseline, not controlled five-call token comparison. DXL failed meaning check, so cheaper does not qualify for production.'});}
// Character counterfactual only: no provider request per FACT is built or sent.
const counterfactual=cases.map(c=>{const s=projectSource(c.source).providerSource,refs=s.evidence.map(e=>e.ref),chars=JSON.stringify(s).length;return {name:c.identity.name,sourceJsonCharsOnce:chars,sourceJsonCharsRepeatedFiveTimes:chars*5,sourceRepetitionReductionPercent:80,independentPromptChars:Object.values(contracts).reduce((n,k)=>n+k.systemPrompt.length,0),independentSchemaChars:Object.values(contracts).reduce((n,k)=>n+JSON.stringify(k.buildProviderSchema(refs)).length,0),unionPromptChars:JSON.parse(c.body).systemInstruction.parts[0].text.length,unionSchemaChars:JSON.stringify(JSON.parse(c.body).generationConfig.responseJsonSchema).length,measurement:'Local character lengths only, not tokens, billed money or five paid calls'};});
const result={checkedAt:new Date().toISOString(),model,plannedFilings:4,executedFilings:2,physicalCalls,averageInputTokens:inputTokens/physicalCalls,inputTokens,outputTokens,retry:0,repair:0,fallback:0,recall:0,practicalPass:false,rows,historical,counterfactual,protectedFilesUnchanged:true,frozenRequestAndMapping:true,rawResponseByteIntegrity:true,everyEmittedRefReviewed:true,independentHumanSignoff:false};
if(process.argv.includes('--save'))await writeFile(join(root,'audit-summary.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(result,null,2));
