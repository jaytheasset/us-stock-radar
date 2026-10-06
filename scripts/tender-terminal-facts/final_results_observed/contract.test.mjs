import test from 'node:test';
import assert from 'node:assert/strict';
import {validateOutput,buildRequest} from './contract.mjs';
test('true-only sparse schema; no false, coercion, foreign refs or extra fields',()=>{
 const good={facts:[{type:'final_results_observed',observed:true,evidence_refs:['E1']}],unresolved:[]},valid=x=>validateOutput(JSON.stringify(x),['E1']).local.valid;
 assert.ok(valid(good));assert.ok(valid({facts:[],unresolved:[]}));
 for(const patch of [{observed:false},{observed:'true'},{shares:42},{status:'completed'},{evidence_refs:['E9']},{evidence_refs:[]},{evidence_refs:['E1','E1']}])assert.equal(valid({...good,facts:[{...good.facts[0],...patch}]}),false);
 const source={form:'SC TO-I',coverage:{},evidence:[{ref:'E1',text:'Only preliminary results.'}]};
 assert.deepEqual(JSON.parse(buildRequest(source).contents[0].parts[0].text),source);
 assert.ok(valid(good),'Validator cannot semantically repair a well-shaped but unsupported observation');
});
