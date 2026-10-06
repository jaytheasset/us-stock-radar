import test from 'node:test';
import assert from 'node:assert/strict';
import {validateOutput,buildRequest} from './offer_status/contract.mjs';
const valid=x=>validateOutput(JSON.stringify(x),['E1','E2']).local.valid;
test('status shape, sparse absence, foreign refs and no coercion',()=>{
 const good={facts:[{type:'offer_status',current:'terminated',evidence_refs:['E1']}],unresolved:[]};
 assert.ok(valid(good));assert.ok(valid({facts:[],unresolved:[]}));
 for(const patch of [{current:'expired'},{previous:'withdrawn'},{evidence_refs:[]},{evidence_refs:['E99']},{evidence_refs:['E1','E1']}])assert.equal(valid({...good,facts:[{...good.facts[0],...patch}]}),false);
 assert.equal(valid({...good,facts:[...good.facts,...good.facts]}),false);
 // A source-unsupported but well-shaped claim MUST pass format validation: no semantic correction.
 assert.ok(valid({...good,facts:[{...good.facts[0],current:'withdrawn'}]}));
 const s={form:'SC TO-I',coverage:{},evidence:[{ref:'E1',text:'source'}]};assert.deepEqual(JSON.parse(buildRequest(s).contents[0].parts[0].text),s);
});
