import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){return s==='server-only'?{shortCircuit:true,url:'data:text/javascript,export{}'}:next(s,c);}});
const {tenderMonitorFacts}=await import('../../lib/monitor/tenderStructuredFacts.ts');
const {getReadyMonitorCondition,validateMonitorConditionInput}=await import('../../lib/monitor/conditionRegistry.ts');
const {evaluateMonitorConditions}=await import('../../lib/listingMonitorMatcher.ts');
const {compileNaturalLanguageListingConditions}=await import('../../lib/monitor/naturalLanguageConditionCompiler.ts');
const {buildNaturalLanguageMonitorDraft}=await import('../../lib/monitor/naturalLanguageMonitorDraft.ts');
const {getListingMonitorConditionEditorCatalog}=await import('../../lib/monitor/listingMonitorDraftReview.ts');
const {getListingConditionCompilerRegistryContext}=await import('../../lib/prompts/naturalLanguageConditionCompiler.ts');
const {parseTenderStructured,validateTenderStructured}=await import('../../lib/sec-tender/contract.ts');
const {buildTenderBinding}=await import('../../lib/sec-tender/source.ts');
const {fixture,condition}=await import('./fixture.mjs');
const price=(amount,currency_text='$',unit='cash_per_share')=>({amount,currency_text,unit});
const fact=(current=price(.84),previous=price(.82))=>({type:'offer_price',current,previous,evidence_refs:['E1']});
const read=facts=>({status:'available',canonical:{version:'tender_structured_v1',facts}});
const derive=facts=>tenderMonitorFacts(read(facts),'test').facts.offer_price_change;
test('positive-only exact comparison: increase/decrease, equality, missing, mismatched currencies and units',()=>{
 for(const [label,facts,expected]of [
  ['82 to 84',[fact()],'changed'],['84 to 82',[fact(price(.82),price(.84))],'changed'],
  ['same',[fact(price(.84),price(.84))],null],['previous absent',[{...fact(),previous:undefined}],null],
  ['no offer price',[],null],['current missing',[{...fact(),current:undefined}],null],
  ['USD mismatch',[fact(price(.84),price(.82,'USD'))],null],['US$ mismatch',[fact(price(.84),price(.82,'US$'))],null],
  ['US$ match',[fact(price(.84,'US$'),price(.82,'US$'))],'changed'],
  ['CAD mismatch',[fact(price(.84),price(.82,'CAD'))],null],
  ['current unit',[fact(price(.84,'$','share'),price(.82))],null],['previous unit',[fact(price(.84),price(.82,'$','share'))],null],
  ['NaN',[fact(price(NaN))],null],['infinity',[fact(price(Infinity))],null],['string',[fact(price('0.84'))],null],
 ])assert.equal(derive(facts),expected,label);
});
test('registry/UI metadata and matcher only eq changed; null never MATCH; invalid/false rejected',()=>{
 const def=getReadyMonitorCondition(condition.key);assert.equal(def.valueType,'text');assert.deepEqual(def.enumValues,['changed']);assert.deepEqual(def.allowedOperators,['eq']);assert.equal(def.display.booleanValueLabels,undefined);
 const editor=getListingMonitorConditionEditorCatalog().find(d=>d.key===condition.key);assert.equal(editor.valueType,'text');assert.deepEqual(editor.values,[{value:'changed',label:'Changed'}]);assert.deepEqual(editor.operators.map(o=>o.value),['eq']);
 for(const value of ['unchanged',false,true,'increased','decreased'])assert.ok(validateMonitorConditionInput({...condition,value}).length);
 for(const operator of ['neq','in','gt'])assert.ok(validateMonitorConditionInput({...condition,operator}).length);
 for(const value of ['changed',null]){
  const readers={tender:{status:'available',facts:{offer_price_change:value}},listing:{status:'not_ready'},corporateAction:{status:'not_ready'},ownership:{status:'not_ready'}};
  const result=evaluateMonitorConditions(readers,[condition],{evaluationDate:'2026-10-07'});
  assert.equal(result.status,value?'match':'ineligible');
 }
 assert.equal(getReadyMonitorCondition('tender.expiration'),null);assert.equal(getReadyMonitorCondition('tender.offer_price'),null);
});
test('provider prompt/schema/analyzer/source remain byte-identical to prior product candidate',()=>{
 for(const file of ['contract.ts','analyzer.ts','source.ts'])assert.equal(fs.readFileSync('lib/sec-tender/'+file,'utf8').replaceAll('\r\n','\n'),execFileSync('git',['show','47fd6b0ee8562e7208aa97c44a8abc737607e9ea:lib/sec-tender/'+file],{encoding:'utf8'}).replaceAll('\r\n','\n'));
});
test('product contract rejects invalid price and absent previous; null/composite cannot create change',()=>{
 const built=buildTenderBinding(fixture()),ref=built.providerSource.evidence[0].ref;
 const blank={offer_price:null,board_recommendation:null,offer_status:null,final_results_observed:null};
 const shape={current:{amount:.84,currency_text:'$'},previous:{amount:.82,currency_text:'$'},current_evidence_refs:[ref],previous_evidence_refs:[ref]};
 const valid=parseTenderStructured(JSON.stringify({...blank,offer_price:shape}),built.source,built.providerSource);assert.equal(valid.ok,true);assert.equal(derive(valid.result.canonical.facts),'changed');
 for(const amount of [NaN,Infinity,'0.84',null])assert.equal(validateTenderStructured({...blank,offer_price:{...shape,current:{amount,currency_text:'$'}}},built.source,built.providerSource).ok,false);
 const noPrevious={...shape};delete noPrevious.previous;assert.equal(validateTenderStructured({...blank,offer_price:noPrevious},built.source,built.providerSource).ok,false);
 assert.equal(derive(parseTenderStructured(JSON.stringify(blank),built.source,built.providerSource).result.canonical.facts),null);
});
test('Carlyle saved canonical: price change unavailable, final results still MATCH; no re-call',()=>{
 const canonical=JSON.parse(fs.readFileSync('scripts/tender-product/artifacts/canonical.json','utf8'));
 const tender=tenderMonitorFacts({status:'available',canonical},'carlyle');assert.equal(tender.facts.offer_price_change,null);
 const readers={tender,listing:{status:'not_ready'},corporateAction:{status:'not_ready'},ownership:{status:'not_ready'}};
 assert.equal(evaluateMonitorConditions(readers,[condition],{evaluationDate:'2026-10-07'}).status,'ineligible');
 assert.equal(evaluateMonitorConditions(readers,[{key:'tender.final_results_observed',operator:'eq',value:true}],{evaluationDate:'2026-10-07'}).status,'match');
});
for(const text of ['Tender 제안 가격이 바뀌면 알려줘','공개매수 가격이 변경되면 알려줘','Notify me when a tender offer price changes.'])test('NL compiler/draft contract stub: '+text,async()=>{
 const registry=getListingConditionCompilerRegistryContext().find(d=>d.key===condition.key);assert.deepEqual(registry.enum_values.map(v=>v.value),['changed']);
 let calls=0;const compiled=await compileNaturalLanguageListingConditions({text},{apiKey:'offline',model:'offline',runPrompt:async req=>{
  calls++;assert.ok(req.prompt.system.includes(condition.key));assert.equal(JSON.parse(req.prompt.user).text,text);
  return {ok:true,responseOk:true,parsed:{requirements:[{source_text:text,decision:'mapped',conditions:[condition],reason:null,question:null}]},usage:null};
 }});
 assert.equal(calls,1);assert.equal(compiled.result.status,'VALID');assert.deepEqual(compiled.result.conditions,[condition]);
 const draft=buildNaturalLanguageMonitorDraft(compiled.result,text);assert.equal(draft.draftStatus,'READY_FOR_REVIEW');assert.deepEqual(draft.conditions,[condition]);assert.match(draft.mapped[0].conditions[0].text,/Tender offer price changed/);
 await assert.rejects(compileNaturalLanguageListingConditions({text},{apiKey:'offline',model:'offline',runPrompt:async()=>({ok:true,responseOk:true,parsed:{requirements:[{source_text:text,decision:'mapped',conditions:[{...condition,value:false}],reason:null,question:null}]}})}));
});
