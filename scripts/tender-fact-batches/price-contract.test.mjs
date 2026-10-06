import test from 'node:test';
import assert from 'node:assert/strict';
import {validateOutput,buildRequest} from './contracts/offer_price.ts';
const valid={facts:[{type:'offer_price',current:{amount:7.5,currency_text:'$',unit:'cash_per_share'},evidence_refs:['E1']}],unresolved:[]};
test('price requires amount, source currency and cash per-share unit together',()=>{
  for(const field of ['amount','currency_text','unit']){const x=structuredClone(valid);delete x.facts[0].current[field];assert.equal(validateOutput(JSON.stringify(x),['E1']).local.valid,false);}
  for(const [field,value] of [['amount','7.5'],['unit','exchange_ratio']]){const x=structuredClone(valid);x.facts[0].current[field]=value;assert.equal(validateOutput(JSON.stringify(x),['E1']).local.valid,false);}
});
test('price validators detect bad refs and extra fields without repair',()=>{
  for(const refs of [['E9'],['E1','E1'],[]]){const x=structuredClone(valid);x.facts[0].evidence_refs=refs;assert.equal(validateOutput(JSON.stringify(x),['E1']).local.valid,false);}
  const x=structuredClone(valid);x.facts[0].increased=true;assert.equal(validateOutput(JSON.stringify(x),['E1']).local.valid,false);
});
test('wrong semantic amount is untouched, unresolved is permitted, expected not sent',()=>{
  const x=structuredClone(valid);x.facts[0].current.amount=999;const raw=JSON.stringify(x);assert.equal(validateOutput(raw,['E1']).local.valid,true);assert.equal(raw,JSON.stringify(x));
  assert.equal(validateOutput('{"facts":[],"unresolved":["Not established E1"]}',['E1']).local.valid,true);
  const source={evidence:[{ref:'E1',text:'quoted SEC text'}]};assert.deepEqual(JSON.parse(buildRequest(source).contents[0].parts[0].text),source);
});
