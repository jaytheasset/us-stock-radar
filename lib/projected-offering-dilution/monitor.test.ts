import test from 'node:test';
import assert from 'node:assert/strict';
import {getMonitorAddConditionCatalog,createMonitorPresetDraft} from '../monitor/monitorPresets.ts';
import {createListingMonitorDraftReview,getListingMonitorDraftCreateGate} from '../monitor/listingMonitorDraftReview.ts';
import {evaluateMonitorConditions} from '../listingMonitorMatcher.ts';
import {consumeListingMonitorAlertsForEvent,type ListingMonitorAlertConsumerDependencies} from '../monitor/listingMonitorAlertConsumer.ts';
import type {ReadResult} from './repository.ts';
import type {Fact} from './calculate.ts';
const conditions=[{key:'projected.projected_increase_percent_base',operator:'gte' as const,value:10}];
const facts={issuer_new_shares_base:20,projected_increase_percent_base:20,projected_increase_percent_full_overallotment:25,resale_only:false,has_prefunded_warrants:true,has_warrants:true,calculation_issue:true} as Fact;
const available:ReadResult={status:'available',eventId:'event',rawItemId:'raw',sourceExecutionId:'derived-fact',persistedAt:'2026-10-09T10:00:00Z',filedAt:'2026-10-09',facts,guard:{},sourceUrl:'',evidence:[]};
const notReady={status:'not_ready' as const,reason:'not_requested'};
test('seven typed conditions are editable through the existing builder with a ready projected preset',()=>{
 const g=getMonitorAddConditionCatalog().find(g=>g.id==='projected')!;
 assert.deepEqual(g.options.map(o=>o.condition.key),['projected.issuer_new_shares_base','projected.projected_increase_percent_base','projected.projected_increase_percent_full_overallotment','projected.resale_only','projected.has_prefunded_warrants','projected.has_warrants','projected.calculation_issue']);
 const review=createListingMonitorDraftReview(createMonitorPresetDraft('projected-offering-dilution'));
 assert.deepEqual(review.conditions,conditions);assert.equal(getListingMonitorDraftCreateGate(review).ready,true);
});
test('existing matcher compares available values; null/fingerprint/review gate cannot match numeric zero',()=>{
 const readers={projected:available,listing:notReady,corporateAction:notReady,ownership:notReady};
 const evaluate=(c=conditions)=>evaluateMonitorConditions(readers,c,{evaluationDate:'2026-10-09'});
 assert.equal(evaluate().status,'match');assert.equal(evaluate([{...conditions[0],value:30}]).status,'no_match');
 assert.equal(evaluateMonitorConditions({...readers,projected:{...available,facts:{...facts,projected_increase_percent_base:null}}},[{...conditions[0],value:0}],{evaluationDate:'2026-10-09'}).status,'ineligible');
 assert.equal(evaluateMonitorConditions({...readers,projected:notReady},conditions,{evaluationDate:'2026-10-09'}).status,'ineligible');
});
test('existing consumer evaluates only explicit publication trigger, propagates fact/scenario and retries idempotently',async()=>{
 let current:ReadResult=available;let reads=0;const seen=new Set<string>();
 const deps:ListingMonitorAlertConsumerDependencies={readProjectedFacts:async()=>{reads++;return current;},
  listActiveMonitors:async()=>({monitors:[{id:'condition',userId:'owner',domain:'listing',conditions,isActive:true,createdAt:'2026-01-01',updatedAt:'2026-01-01'}],diagnostics:[]}),
  createAlert:async i=>{assert.equal(i.projectedAlert?.factId,'derived-fact');assert.equal(i.projectedAlert?.scenario,'base');assert.deepEqual(i.projectedAlert?.conditions,conditions);const exists=seen.has(i.monitorId);seen.add(i.monitorId);return {status:exists?'existing':'created',monitorId:i.monitorId};},now:()=>new Date('2026-10-09')};
 assert.equal((await consumeListingMonitorAlertsForEvent({eventId:'event'},deps)).createdCount,0);assert.equal(reads,0);
 assert.equal((await consumeListingMonitorAlertsForEvent({eventId:'event',conditionFamily:'projected'},deps)).createdCount,1);
 assert.equal((await consumeListingMonitorAlertsForEvent({eventId:'event',conditionFamily:'projected'},deps)).existingCount,1);
 current=notReady;assert.equal((await consumeListingMonitorAlertsForEvent({eventId:'event',conditionFamily:'projected'},deps)).writes.length,0);
});
