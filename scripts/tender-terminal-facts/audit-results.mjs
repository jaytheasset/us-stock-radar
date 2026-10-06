// Offline integrity audit only. Semantic judgments were made separately against SEC text.
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verify} from './run.mjs';
import {hash,model,projectSource} from '../tender-fact-batches/runner.mjs';
const root=fileURLToPath(new URL('./',import.meta.url)),json=async p=>JSON.parse(await readFile(p,'utf8'));
const cases=[];
for(const fact of ['offer_status','final_results_observed']){
 const {dir,cases:items}=await verify(fact),result=await json(join(dir,'result.json'));assert.equal(result.practicalPass,true);
 for(const c of items){
  const raw=await readFile(join(c.folder,'structured.txt'),'utf8'),output=JSON.parse(raw),audit=await json(join(c.folder,'audit.json')),review=await json(join(c.folder,'review.json')),started=await json(join(c.folder,'started.json')),provider=await json(join(c.folder,'provider-response.txt')),provenance=await json(join(c.folder,'provenance-audit.json'));
  assert.equal(audit.technicalPass,true);assert.equal(audit.physicalCalls,1);assert.equal(audit.httpStatus,200);assert.equal(audit.modelVersion,model);assert.equal(started.requestHash,hash(c.body));assert.equal(started.runId,c.identity.runId);assert.equal(review.outputHash,hash(raw));assert.equal(review.pass,true);
  assert.equal(raw,provider.candidates[0].content.parts.filter(p=>typeof p.text==='string'&&!p.thought).map(p=>p.text).join(''));
  assert.deepEqual(Object.keys(JSON.parse(c.body).contents[0].parts[0]).sort(),['text']);
  assert.deepEqual(JSON.parse(JSON.parse(c.body).contents[0].parts[0].text),projectSource(c.source).providerSource);
  const refs=output.facts.flatMap(f=>f.evidence_refs);assert.deepEqual([...new Set(refs)].sort(),Object.keys(review.refs).sort(),'Every emitted ref explicitly reviewed');
  assert.equal(provenance.resolved.length,refs.length);assert.equal(provenance.valid,true);
  for(const f of output.facts){assert.ok(f.evidence_refs.some(r=>review.refs[r].startsWith('DIRECT:')));for(const r of f.evidence_refs)assert.match(review.refs[r],/^(DIRECT|CORROBORATING):/);}
  cases.push({fact,name:c.identity.name,physicalCalls:1,httpStatus:audit.httpStatus,modelVersion:audit.modelVersion,promptTokens:audit.usage.promptTokenCount,outputTokens:audit.usage.candidatesTokenCount,totalTokens:audit.usage.totalTokenCount,latencyMs:audit.latencyMs,schema:true,local:true,provenance:true,semanticReview:true});
 }
}
async function inventory(dir){let files=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name);files.push(...e.isDirectory()?await inventory(p):[p]);}return files;}
const files=await inventory(root);let bytes=0,max=0;
for(const f of files){const b=await readFile(f);bytes+=b.length;max=Math.max(max,b.length);assert.ok(b.length<5_000_000,'Unexpected large artifact');assert.ok(!/AIza[0-9A-Za-z_-]{30,}|sk-proj-[0-9A-Za-z_-]{20,}|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/.test(b.toString()),'Possible credential');}
const report={checkedAt:new Date().toISOString(),physicalCalls:cases.length,model,cases,rawBytesPreserved:true,frozenInputsAndProtectedFilesUnchanged:true,everyCitedRefReviewed:true,scan:{files:files.length,bytes,maxFileBytes:max,credentialPatternMatches:0},independentHumanSignoff:false};
if(process.argv.includes('--save'))await writeFile(join(root,'verification.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report,null,2));
