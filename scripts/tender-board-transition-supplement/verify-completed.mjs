// Read-only audit of immutable response, exact lookup and authored semantic review.
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verify} from './run.mjs';
import {hash,resolveRefs} from '../tender-fact-batches/runner.mjs';
const dir=fileURLToPath(new URL('./',import.meta.url));const json=async p=>JSON.parse(await readFile(p,'utf8'));
const [c]=await verify();const raw=await readFile(join(c.folder,'structured.txt'),'utf8');const provider=await json(join(c.folder,'provider-response.txt'));
const candidate=provider.candidates[0];assert.equal(candidate.finishReason,'STOP');assert.equal(provider.modelVersion,'gemini-3.5-flash');
assert.equal(raw,candidate.content.parts.filter(p=>typeof p.text==='string'&&!p.thought).map(p=>p.text).join(''));
const started=await json(join(c.folder,'started.json'));const frozen=await json(join(c.folder,'frozen.json'));
assert.equal(started.requestHash,hash(c.body));assert.equal(started.mappingHash,c.frozenMapHash);assert.equal(started.physicalCallLimit,1);assert.equal(started.runId,frozen.runId);assert.ok(Date.parse(frozen.frozenAt)<=Date.parse(started.startedAt));
const audit=await json(join(c.folder,'audit.json'));assert.equal(audit.physicalCalls,1);assert.equal(audit.httpStatus,200);assert.equal(audit.technicalPass,true);
const provenance=resolveRefs(raw,c.mapBytes,c.frozenMapHash,c.source,c.validate);assert.equal(provenance.valid,true);assert.deepEqual(provenance,await json(join(c.folder,'provenance-audit.json')));
const out=JSON.parse(raw);const review=await json(join(c.folder,'semantic-review.json'));assert.equal(review.semanticPass,true);assert.equal(review.evidenceSupportPass,true);
for(const fact of out.facts){
  for(const ref of fact.evidence_refs){const r=review.refs[ref];assert.ok(r,`Unreviewed ${ref}`);assert.ok(['direct','corroborating'].includes(r.strength));assert.equal(r.nonconflicting,true);}
  for(const claim of ['current','previous']){assert.equal(fact[claim],review[claim].value);assert.ok(fact.evidence_refs.some(ref=>review.refs[ref].strength==='direct'&&review.refs[ref].supports.includes(claim)));}
}
await assert.rejects(access(join(dir,'runs','cream','started.json')),{code:'ENOENT'});
const cream=await json(join(dir,'cream-result.json'));assert.equal(cream.physicalCalls,0);assert.equal(cream.failureClass,'SOURCE_COVERAGE');
const result=await json(join(dir,'result.json'));assert.equal(result.physicalCalls,1);assert.equal(result.transitionPathPass,false);assert.equal(result.boardFinalPracticalPass,'HELD');
console.log(JSON.stringify({audit:'PASS',priorArtifacts:'UNCHANGED',contract:'UNCHANGED',queries:'UNCHANGED',physicalCalls:1,beacon:'PASS',cream:'SOURCE_COVERAGE_NOT_EXECUTED',transition:'1/2; not PASS',boardFinal:'HELD'},null,2));
