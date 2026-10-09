import test from 'node:test';
import assert from 'node:assert/strict';
import {getMonitorAddConditionCatalog,createMonitorPresetDraft} from '../monitor/monitorPresets.ts';
import {getListingMonitorConditionEditorCatalog,formatListingMonitorConditionPreview} from '../monitor/listingMonitorDraftReview.ts';
import {MONITOR_CONDITION_REGISTRY,getReadyMonitorConditions,validateMonitorConditionInput,validateStoredMonitorConditionInput} from '../monitor/conditionRegistry.ts';
import {buildNaturalLanguageConditionCompilerPrompt} from '../prompts/naturalLanguageConditionCompiler.ts';
import {evaluateMonitorConditions,evaluateListingMonitorEvent,evaluateForm4InsiderPurchaseMonitor} from '../listingMonitorMatcher.ts';
import {consumeListingMonitorAlertsForEvent,createListingMonitorAlert,type ListingMonitorAlertConsumerDependencies} from '../monitor/listingMonitorAlertConsumer.ts';
import type {ReadResult} from './repository.ts';
import type {Fact} from './calculate.ts';
import type {CanonicalListingMonitorCondition} from '../monitor/listingMonitorPersistence.ts';

const conditions=[{key:'projected.projected_increase_percent_base',operator:'gte' as const,value:10}];
const available:ReadResult={status:'available',eventId:'event',rawItemId:'raw',sourceExecutionId:'archived-fact',persistedAt:'2026-10-09T10:00:00Z',filedAt:'2026-10-09',facts:{projected_increase_percent_base:20} as Fact,guard:{},sourceUrl:'',evidence:[]};
const notReady={status:'not_ready' as const,reason:'not_requested'};
const filingCondition={key:'event.sec_form',operator:'eq' as const,value:'S-4'};
const retired=MONITOR_CONDITION_REGISTRY.filter(d=>d.family==='projected');

test('all seven historical keys retain typed validation but disappear from executable catalogs and compiler prompt',()=>{
 assert.equal(retired.length,7);
 for(const d of retired){
  assert.equal(d.status,'RETIRED');
  const condition={key:d.key,operator:d.allowedOperators[0],value:d.valueType==='number'?10:true};
  assert.deepEqual(validateMonitorConditionInput(condition),['condition_key_retired']);
  assert.deepEqual(validateStoredMonitorConditionInput(condition),[]);
  assert.ok(!formatListingMonitorConditionPreview(condition).text.includes('Choose a valid value'));
  assert.ok(!JSON.stringify(buildNaturalLanguageConditionCompilerPrompt('local offline test')).includes(d.key));
 }
 for(const catalog of [getReadyMonitorConditions(),getMonitorAddConditionCatalog(),getListingMonitorConditionEditorCatalog()]){
  assert.doesNotMatch(JSON.stringify(catalog),/projected\./);
 }
 assert.throws(()=>createMonitorPresetDraft('projected-offering-dilution'));
 assert.ok(validateStoredMonitorConditionInput({...conditions[0],value:'10'}).length>0);
 assert.ok(validateStoredMonitorConditionInput({...conditions[0],key:'projected.unknown'}).length>0);
});

test('positive, zero, null, conflict and unavailable injected facts cannot match any retired key',()=>{
 for(const projected of [available,{...available,facts:{...available.facts,projected_increase_percent_base:0}},
  {...available,facts:{...available.facts,projected_increase_percent_base:null}},
  {...available,facts:{...available.facts,calculation_status:'CONFLICT' as const}},notReady]){
  for(const d of retired){
   const c={key:d.key,operator:d.allowedOperators[0],value:d.valueType==='number'?0:true};
   for(const set of [[c],[null as never,c],[filingCondition,c],[{key:'effect.is_effective',operator:'eq',value:true},c]]){
    const result=evaluateMonitorConditions({projected,listing:notReady,corporateAction:notReady,ownership:notReady},set,{evaluationDate:'2026-10-10'});
    assert.equal(result.status,'ineligible');assert.equal(result.reasonCode,'condition_key_retired');
   }
  }
 }
 // The specialized Form 4 branch cannot bypass retirement with injected mixed conditions.
 assert.equal(evaluateForm4InsiderPurchaseMonitor(notReady,conditions,{} as never,'eligible').reasonCode,'condition_key_retired');
});

test('event evaluator never loads projected facts or readers requested only by a retired mixed set',async()=>{
 let reads=0;const forbidden=async()=>{reads++;throw Error('retired reader');};
 const result=await evaluateListingMonitorEvent({eventId:'event',evaluationDate:'2026-10-10',conditionSets:[{id:'old',conditions:[filingCondition,...conditions]}]},
  {readProjectedFacts:forbidden,readFilingMetadata:forbidden});
 assert.equal(reads,0);assert.equal(result.evaluations[0].result.reasonCode,'condition_key_retired');
});

test('publication, generic fanout, filing fanout and replay cannot read/write projected alerts; ordinary filing still runs',async()=>{
 const closed=await consumeListingMonitorAlertsForEvent({eventId:'event',conditionFamily:'projected'});
 assert.equal(closed.readerReason,'projected_calculation_retired');assert.equal(closed.createdCount,0);
 let reads=0,writes=0,lists=0;
 const monitor=(id:string,c:readonly CanonicalListingMonitorCondition[]=conditions)=>({id,userId:'owner',domain:'listing' as const,conditions:c,isActive:true,createdAt:'2026-01-01',updatedAt:'2026-01-01'});
 let monitors=[monitor('retired'),monitor('mixed',[filingCondition,...conditions])];
 const deps:ListingMonitorAlertConsumerDependencies={
  readProjectedFacts:async()=>{reads++;return available;},listActiveMonitors:async()=>{lists++;return {monitors,diagnostics:[]};},
  readFilingMetadata:async()=>({status:'available',eventId:'event',rawItemId:'raw',sourceExecutionId:'filing-source',persistedAt:'2026-10-10',filedAt:'2026-10-09',facts:{form:'S-4',accession:'0000000001-26-000001',issuerCik:'1',sourceUrl:'https://www.sec.gov/Archives/local-only'}}),
  createAlert:async i=>{writes++;assert.equal(i.monitorId,'ordinary');assert.equal(i.projectedAlert,undefined);return {status:'created',monitorId:i.monitorId};},now:()=>new Date('2026-10-10')};
 for(const family of ['projected','projected',undefined,'filing'] as const){
  const r=await consumeListingMonitorAlertsForEvent({eventId:'event',conditionFamily:family},deps);
  assert.equal(r.createdCount,0);assert.equal(r.existingCount,0);assert.equal(r.writes.length,0);
 }
 assert.equal(lists,2);assert.equal(reads,0);assert.equal(writes,0);
 monitors=[...monitors,monitor('ordinary',[filingCondition])];
 assert.equal((await consumeListingMonitorAlertsForEvent({eventId:'event',conditionFamily:'filing'},deps)).createdCount,1);
 assert.equal(reads,0);assert.equal(writes,1);
});

test('direct projected writer rejects before loading the database repository',async()=>{
 const r=await createListingMonitorAlert({eventId:'event',sourceExecutionId:'old',monitorId:'monitor',userId:'owner',createdAt:'2026-10-10',projectedAlert:{factId:'old',conditions,scenario:'base'}});
 assert.deepEqual(r,{status:'failed',monitorId:'monitor',error:'Projected calculation alerts have been retired.'});
});
