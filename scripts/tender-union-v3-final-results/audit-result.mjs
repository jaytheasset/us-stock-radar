import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {folder,root,json,hash,verifyInputs} from './run.mjs';
import {projectCanonical} from '../tender-union-v3-dxl/contract.mjs';

await verifyInputs();
const raw=await readFile(join(folder,'structured.txt'),'utf8'),out=JSON.parse(raw),provider=await json(join(folder,'provider-response.txt'));
assert.equal(raw,provider.candidates[0].content.parts.filter(p=>typeof p.text==='string'&&!p.thought).map(p=>p.text).join(''));
assert.deepEqual(await json(join(folder,'canonical.json')),projectCanonical(out));
const audit=await json(join(folder,'audit.json')),review=await json(join(folder,'review.json')),result=await json(join(folder,'result.json'));
assert.equal(audit.physicalCalls,1);assert.equal(audit.retries+audit.repairCalls+audit.fallbackCalls,0);assert.equal(audit.semanticCorrections,0);assert.equal(audit.technicalPass,true);
assert.equal(review.pass,false);assert.equal(review.failureClass,'MODEL_ERROR');assert.equal(result.pass,false);assert.equal(result.failureClass,'MODEL_ERROR');
assert.equal(out.final_results_observed?.observed,true);assert.equal(out.expiration?.current,'2026-01-21');assert.equal(out.offer_price,null);
const started=await json(join(folder,'started.json'));assert.equal(started.requestHash,hash(await readFile(join(folder,'request.json'))));
const files={};for(const f of await readdir(folder))files[f]=hash(await readFile(join(folder,f)));
console.log(JSON.stringify({artifactConsistency:'PASS',singleCallV3Carlyle:'FAIL',failureClass:'MODEL_ERROR',physicalCalls:1,technicalPass:true,semanticPass:false,primaryError:'historical expiration emitted as current',files},null,2));
