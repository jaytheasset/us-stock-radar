import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {eligibleCase,verify} from './run.mjs';
import {validateOutput} from '../tender-fact-batches/contracts/board_recommendation.ts';
import {buildTenderEvidenceIndex} from '../../lib/sources/sec/forms/tender/evidenceRetrieval.ts';
test('coverage-gated supplement permits only Beacon; preserved prompt and query bytes',async()=>{
  const cases=await verify();assert.deepEqual(cases.map(c=>c.identity.name),['beacon']);
  await assert.rejects(eligibleCase('cream'),/SOURCE_COVERAGE/);
  const raw=JSON.stringify({facts:[{type:'board_recommendation',current:'accept',evidence_refs:['E1']}],unresolved:[]});
  assert.equal(validateOutput(raw,['E1']).local.valid,true); // Missing previous is a semantic review failure, never inserted by validator.
  assert.equal(JSON.parse(raw).facts[0].previous,undefined);
});
test('real Cream6-K identity is unsupported without relabeling',async()=>{
  const identity=JSON.parse(await readFile(new URL('./cream-identity.json',import.meta.url),'utf8'));
  assert.equal(identity.form,'6-K');assert.equal(identity.documentType,'EX-99.8');assert.equal(identity.document,'notice.htm');
  assert.throws(()=>buildTenderEvidenceIndex({accession:identity.accession,form:identity.form,documents:[],unavailable:[]}),/Invalid Tender filing identity/);
});
