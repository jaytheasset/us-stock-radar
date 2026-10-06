// Read-only audit: tally authored SEC reviews; never infer or repair FACT meaning.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {verifyBatch,hash,resolveRefs,model} from './runner.mjs';
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const allowed=new Set(['direct','corroborating']);
const totals=[];
for(const fact of ['expiration','offer_price','board_recommendation']){
  const {dir,cases}=await verifyBatch(fact);
  const ledger=await json(join(dir,'ledger.json'));
  assert.equal(ledger.physicalCalls,cases.length);assert.equal(ledger.stoppedEarly,false);
  const batch=await json(join(dir,'started-batch.json'));assert.equal(batch.model,model);
  let claims=0,refs=0,abstentions=0;
  for(const c of cases){
    const f=await json(join(c.folder,'frozen.json'));const started=await json(join(c.folder,'started.json'));
    assert.equal(started.runId,f.runId);assert.equal(started.model,model);assert.equal(started.requestHash,hash(c.body));
    assert.equal(started.mappingHash,c.frozenMapHash);assert.equal(started.physicalCallLimit,1);assert.ok(Date.parse(f.frozenAt)<=Date.parse(started.startedAt));
    const raw=await readFile(join(c.folder,'structured.txt'),'utf8');const response=await json(join(c.folder,'provider-response.txt'));
    const candidate=response.candidates[0];assert.equal(candidate.finishReason,'STOP');assert.equal(response.modelVersion,model);
    assert.equal(raw,candidate.content.parts.filter(p=>typeof p.text==='string'&&!p.thought).map(p=>p.text).join(''));
    const validation=c.validate(raw,c.source.evidence.map((_,i)=>`E${i+1}`));assert.equal(validation.providerSchema.valid,true);assert.equal(validation.local.valid,true);
    const provenance=resolveRefs(raw,c.mapBytes,c.frozenMapHash,c.source,c.validate);
    assert.deepEqual(provenance,await json(join(c.folder,'provenance-audit.json')));assert.equal(provenance.valid,true);
    const audit=await json(join(c.folder,'audit.json'));assert.equal(audit.physicalCalls,1);assert.equal(audit.httpStatus,200);assert.equal(audit.technicalPass,true);
    assert.deepEqual(audit,ledger.cases.find(a=>a.runId===c.identity.runId));
    const review=await json(join(c.folder,'semantic-review.json'));assert.equal(review.semanticPass,true);assert.equal(review.evidenceSupportPass,true);
    const out=JSON.parse(raw);
    for(const item of out.facts){
      const keys=['current',...('previous'in item?['previous']:[])];claims+=keys.length;
      for(const claim of keys){
        let direct=0;
        for(const ref of item.evidence_refs){
          const entry=review.refs[ref];assert.ok(entry,`${fact}/${c.identity.name}/${ref} unreviewed`);
          const strength=entry.supports?.includes(claim)?entry.strength:entry[claim];
          assert.ok(allowed.has(strength),`${fact}/${c.identity.name}/${ref}/${claim}`);if(strength==='direct')direct++;
        }
        assert.ok(direct>=1,`${fact}/${c.identity.name}/${claim}: direct support missing`);
      }
      refs+=item.evidence_refs.length;
    }
    if(!out.facts.length){abstentions++;assert.ok(out.unresolved.length);}
    // Narrative refs have been manually reviewed; matching tokens checks inventory only.
    for(const ref of out.unresolved.join(' ').match(/\bE\d+\b/g)??[]){assert.ok(review.refs[ref],`Unreviewed narrative ref ${ref}`);assert.ok(JSON.parse(c.mapBytes)[ref]);}
  }
  assert.equal((await json(join(dir,'result.json'))).practicalPass,true);
  totals.push({fact,calls:cases.length,claims,selectedClaimRefs:refs,abstentions,frozen:'PASS',schema:'PASS',local:'PASS',provenance:'PASS',authoredSupportReview:'PASS'});
}
console.log(JSON.stringify({model,physicalCalls:totals.reduce((n,r)=>n+r.calls,0),results:totals},null,2));
