// Read-only audit: no semantic extraction or repair.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {verify} from './run.mjs';
import {hash,resolveRefs} from '../tender-fact-batches/runner.mjs';
const json=async p=>JSON.parse(await readFile(p,'utf8'));const c=await verify();
const raw=await readFile(join(c.folder,'structured.txt'),'utf8');const response=await json(join(c.folder,'provider-response.txt'));const candidate=response.candidates[0];
assert.equal(candidate.finishReason,'STOP');assert.equal(response.modelVersion,'gemini-3.5-flash');assert.equal(raw,candidate.content.parts.filter(p=>typeof p.text==='string'&&!p.thought).map(p=>p.text).join(''));
const started=await json(join(c.folder,'started.json'));const frozen=await json(join(c.folder,'frozen.json'));assert.equal(started.runId,frozen.runId);assert.equal(started.requestHash,hash(c.body));assert.equal(started.mappingHash,c.frozenMapHash);assert.equal(started.physicalCallLimit,1);assert.ok(Date.parse(frozen.frozenAt)<=Date.parse(started.startedAt));
const audit=await json(join(c.folder,'audit.json'));assert.equal(audit.physicalCalls,1);assert.equal(audit.httpStatus,200);assert.equal(audit.technicalPass,true);
const provenance=resolveRefs(raw,c.mapBytes,c.frozenMapHash,c.source,c.validate);assert.equal(provenance.valid,true);assert.deepEqual(provenance,await json(join(c.folder,'provenance-audit.json')));
const output=JSON.parse(raw);const review=await json(join(c.folder,'semantic-review.json'));assert.equal(review.semanticPass,true);assert.equal(review.evidenceSupportPass,true);assert.equal(review.sameTenderLineage,true);assert.equal(review.unrelatedTransactionsExcluded,true);
assert.equal(output.facts.length,1);assert.deepEqual(output.unresolved,[]);const fact=output.facts[0];
for(const ref of fact.evidence_refs){const r=review.refs[ref];assert.ok(r,`Unreviewed ${ref}`);assert.ok(['direct','corroborating'].includes(r.strength));assert.equal(r.nonconflicting,true);}
for(const claim of ['current','previous']){assert.equal(fact[claim],review[claim].value);assert.ok(fact.evidence_refs.some(ref=>review.refs[ref].strength==='direct'&&review.refs[ref].supports.includes(claim)));}
console.log(JSON.stringify({audit:'PASS',case:'josabank',physicalCalls:1,schema:'PASS',local:'PASS',provenance:'PASS',authoredSemanticReview:'PASS',priorArtifacts:'UNCHANGED',contract:'UNCHANGED',queries:'UNCHANGED'},null,2));
