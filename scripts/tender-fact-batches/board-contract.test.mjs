import test from 'node:test';
import assert from 'node:assert/strict';
import {validateOutput} from './contracts/board_recommendation.ts';
const value={facts:[{type:'board_recommendation',current:'accept',evidence_refs:['E1']}],unresolved:[]};
test('board distinguishes schema enum from uncertain or unsupported states',()=>{
  for(const s of ['accept','reject','no_recommendation']){const x=structuredClone(value);x.facts[0].current=s;assert.equal(validateOutput(JSON.stringify(x),['E1']).local.valid,true);}
  for(const s of ['neutral','take_no_action','unresolved',null]){const x=structuredClone(value);x.facts[0].current=s;assert.equal(validateOutput(JSON.stringify(x),['E1']).local.valid,false);}
  assert.equal(validateOutput('{"facts":[],"unresolved":["No supplied recommendation E1"]}',['E1']).local.valid,true);
});
test('board wrong semantics are not corrected; ref and structural errors fail',()=>{
  const raw=JSON.stringify(value);assert.equal(validateOutput(raw,['E1']).local.valid,true);assert.equal(raw,JSON.stringify(value));
  for(const refs of [['E9'],['E1','E1'],[]]){const x=structuredClone(value);x.facts[0].evidence_refs=refs;assert.equal(validateOutput(JSON.stringify(x),['E1']).local.valid,false);}
  const x=structuredClone(value);x.facts[0].changed=true;assert.equal(validateOutput(JSON.stringify(x),['E1']).local.valid,false);
});
