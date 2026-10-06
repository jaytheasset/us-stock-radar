// Offline artifact consistency only; never modifies or repairs model values.
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {folder,root,json,hash,verifyInputs} from './run.mjs';
import {types,projectCanonical} from './contract.mjs';

await verifyInputs();
const raw=await readFile(join(folder,'structured.txt'),'utf8'),output=JSON.parse(raw);
const audit=await json(join(folder,'audit.json')),review=await json(join(folder,'review.json'));
const provider=await json(join(folder,'provider-response.txt'));
assert.equal(raw,provider.candidates[0].content.parts.filter(p=>typeof p.text==='string'&&!p.thought).map(p=>p.text).join(''));
assert.deepEqual(await json(join(folder,'canonical.json')),projectCanonical(output));
const expected=(await json(join(root,'baseline.json'))).expected;
const actual={};
for(const type of types){const slot=output[type];actual[type]=slot===null?null:type==='offer_status'?{current:slot.current}:type==='final_results_observed'?{observed:slot.observed}:{current:slot.current,previous:slot.previous};}
actual.unresolved=output.unresolved;
const differences=[];
function compare(e,a,path=''){
 if(isDeepStrictEqual(e,a))return;
 if(e!==null&&a!==null&&typeof e==='object'&&typeof a==='object'&&!Array.isArray(e))for(const k of Object.keys(e))compare(e[k],a[k],path?`${path}.${k}`:k);
 else differences.push({field:path,expected:e,actual:a});
}
compare(expected,actual);
assert.deepEqual(differences,review.checks.filter(c=>!c.pass).map(({field,expected,actual})=>({field,expected,actual})));
assert.equal(review.pass,audit.technicalPass&&differences.length===0);
assert.equal(audit.physicalCalls,1);assert.equal(audit.semanticCorrections,0);
assert.equal(audit.retries+audit.repairCalls+audit.fallbackCalls,0);
const gate=await json(join(folder,'preflight.json'));
assert.equal(gate.pass,true);assert.equal(gate.frozenHash,hash(await readFile(join(folder,'frozen.json'))));assert.equal(gate.testOutputHash,hash(await readFile(join(folder,'preflight-tests.txt'))));
const started=await json(join(folder,'started.json'));
assert.equal(started.requestHash,hash(await readFile(join(folder,'request.json'))));
assert.ok(Date.parse(gate.checkedAt)<=Date.parse(started.startedAt));
const files={};for(const file of await readdir(folder))if(file!=='result.json')files[file]=hash(await readFile(join(folder,file)));
const result={pass:review.pass,failureClass:review.failureClass,physicalCalls:1,semanticCorrections:0,technicalPass:audit.technicalPass,differences,files};
if(process.argv.includes('--save')){
 const {save}=await import('./run.mjs');await save(join(folder,'result.json'),result);
}else assert.deepEqual(await json(join(folder,'result.json')),result);
console.log(JSON.stringify({artifactConsistency:'PASS',singleCallV2DXL:review.pass?'PASS':'FAIL',failureClass:review.failureClass,differences}));
