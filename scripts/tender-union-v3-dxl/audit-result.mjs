import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {folder,root,json,hash,verifyInputs} from './run.mjs';
import {deriveCurrencyNotations,projectCanonical} from './contract.mjs';

await verifyInputs();
const raw=await readFile(join(folder,'structured.txt'),'utf8'),output=JSON.parse(raw),provider=await json(join(folder,'provider-response.txt'));
assert.equal(raw,provider.candidates[0].content.parts.filter(p=>typeof p.text==='string'&&!p.thought).map(p=>p.text).join(''));
assert.deepEqual(await json(join(folder,'canonical.json')),projectCanonical(output));
const baseline=(await json(join(root,'baseline.json'))).expected;
const actual={
 expiration:output.expiration&&{current:output.expiration.current,previous:output.expiration.previous},
 offer_price:output.offer_price&&{current:output.offer_price.current,previous:output.offer_price.previous},
 board_recommendation:output.board_recommendation&&{current:output.board_recommendation.current,previous:output.board_recommendation.previous},
 offer_status:output.offer_status&&{current:output.offer_status.current},
 final_results_observed:output.final_results_observed&&{observed:output.final_results_observed.observed},
 unresolved:output.unresolved
};
assert.ok(isDeepStrictEqual(actual,baseline));
assert.deepEqual(deriveCurrencyNotations(await json(join(folder,'provider-source.json'))),['$']);
const audit=await json(join(folder,'audit.json')),review=await json(join(folder,'review.json')),result=await json(join(folder,'result.json'));
assert.equal(audit.physicalCalls,1);assert.equal(audit.retries+audit.repairCalls+audit.fallbackCalls,0);assert.equal(audit.semanticCorrections,0);assert.equal(audit.technicalPass,true);
assert.equal(review.pass,true);assert.equal(review.checks.every(x=>x.pass),true);assert.equal(result.pass,true);
const started=await json(join(folder,'started.json'));assert.equal(started.requestHash,hash(await readFile(join(folder,'request.json'))));assert.deepEqual(started.currencyInventory,['$']);
const files={};for(const f of await readdir(folder))if(f!=='artifact-seal.json')files[f]=hash(await readFile(join(folder,f)));
console.log(JSON.stringify({artifactConsistency:'PASS',singleCallV3DXL:'PASS',physicalCalls:1,currencyInventory:['$'],technicalPass:true,semanticPass:true,files},null,2));
