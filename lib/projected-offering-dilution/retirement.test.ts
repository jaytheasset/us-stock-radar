import test from 'node:test';
import assert from 'node:assert/strict';
import {prepare,refreshProjectedForRun,refreshProjected,readProjectedFacts,PROJECTED_RETIRED_REASON} from './repository.ts';
import {createListingMonitor,listListingMonitorsForOwner,readListingMonitorForOwner,pauseListingMonitor,resumeListingMonitor,updateListingMonitor,listActiveListingMonitorsForConsumer,validateCanonicalListingConditions,type ListingMonitorRepository} from '../monitor/listingMonitorPersistence.ts';

const owner='00000000-0000-4000-a000-000000000001',id='00000000-0000-4000-a000-000000000002',other='00000000-0000-4000-a000-000000000003';
const retired={key:'projected.issuer_new_shares_base',operator:'gte',value:100};
const ordinary={key:'event.sec_form',operator:'eq',value:'S-4'};

test('retired repository entry points never read, calculate, persist or resolve default database access',async()=>{
 let calls=0;const forbidden=async()=>{calls++;throw Error('repository must remain unopened');};
 const repo={select:forbidden,rpc:forbidden};
 assert.equal(await prepare('raw',repo),null);
 for(const supplied of [undefined,repo]){
  assert.deepEqual(await refreshProjected('raw',supplied),{status:'retired',reason:PROJECTED_RETIRED_REASON});
  assert.deepEqual(await refreshProjectedForRun('run',supplied),{status:'retired',reason:PROJECTED_RETIRED_REASON});
  assert.deepEqual(await readProjectedFacts('event',supplied),{status:'not_ready',reason:PROJECTED_RETIRED_REASON});
 }
 assert.equal(calls,0);
});

function fixture(){
 const row:Record<string,unknown>={id,user_id:owner,domain:'listing',monitor_kind:'condition_set',conditions:[ordinary,retired],is_active:true,created_at:'2026-10-09T00:00:00Z',updated_at:'2026-10-09T00:00:00Z'};
 const patches:Record<string,unknown>[]=[];
 const repo:ListingMonitorRepository={
  list:async()=>({ok:true,data:[row]}),read:async()=>({ok:true,data:[row]}),
  create:async()=>{throw Error('create must be rejected before persistence');},
  update:async(o,i,patch)=>{assert.equal(o,owner);assert.equal(i,id);patches.push(patch);Object.assign(row,patch);return {ok:true,data:[row]};},
  delete:async()=>{throw Error('not part of this test');},
 };
 return {row,repo,patches};
}

test('owner historical conditions retain exact JSON and preview semantics; pause remains supported',async()=>{
 const {row,repo,patches}=fixture(),before=JSON.stringify(row.conditions);
 const list=await listListingMonitorsForOwner(owner,repo);
 assert.equal(list.monitors.length,1);assert.deepEqual(list.diagnostics,[]);
 assert.equal(JSON.stringify(list.monitors[0].conditions),before);
 const read=await readListingMonitorForOwner(owner,id,repo);assert.equal(read.status,'available');
 assert.equal((await pauseListingMonitor(owner,id,repo)).isActive,false);
 assert.equal(patches.length,1);assert.deepEqual(Object.keys(patches[0]).sort(),['is_active','updated_at']);
 assert.equal(JSON.stringify(row.conditions),before);
});

test('create, resume and conversion of a retired set fail without rewriting saved conditions',async()=>{
 const {row,repo,patches}=fixture(),before=JSON.stringify(row);
 await assert.rejects(createListingMonitor({ownerId:owner,conditions:[retired]},repo),/invalid/);
 await assert.rejects(resumeListingMonitor(owner,id,repo),/retired/);
 await assert.rejects(updateListingMonitor({ownerId:owner,monitorId:id,conditions:[ordinary]},repo),/retired/);
 await assert.rejects(updateListingMonitor({ownerId:owner,monitorId:id,form4PurchaseSettings:{}},repo),/retired/);
 assert.deepEqual(patches,[]);assert.equal(JSON.stringify(row),before);
 assert.equal((await listListingMonitorsForOwner(other,repo)).monitors.length,0);
 assert.equal((await readListingMonitorForOwner(other,id,repo)).status,'not_found');
 await assert.rejects(pauseListingMonitor(other,id,repo),/not found/);
});

test('consumer excludes entire mixed sets while owner read validation stays strict for all other definitions',async()=>{
 const {row}=fixture();
 const result=await listActiveListingMonitorsForConsumer({listActivePage:async()=>({ok:true,data:[row,{...row,id:other,conditions:[ordinary]}]})});
 assert.deepEqual(result.monitors.map(m=>m.id),[other]);
 assert.deepEqual(result.diagnostics,[{id,reason:'stored_conditions_retired',errors:['condition_key_retired']}]);
 assert.equal(validateCanonicalListingConditions(row.conditions).ok,false);
 assert.equal(validateCanonicalListingConditions(row.conditions,'draft').ok,false);
 assert.equal(validateCanonicalListingConditions(row.conditions,'history').ok,true);
 for(const conditions of [[{...ordinary,value:'invented'}],[{key:'offering.unknown',operator:'eq',value:true}],
  [{...retired,value:'100'}],[{...retired,operator:'unknown'}],[{...retired,extra:true}]]){
  assert.equal(validateCanonicalListingConditions(conditions,'history').ok,false);
 }
});
