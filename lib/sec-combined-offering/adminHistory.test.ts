import test from 'node:test';
import assert from 'node:assert/strict';
import {listSnapshots,readSnapshot,type Repository} from '../sec-os-snapshot/repository.ts';
import {listOfferingPlans,readOfferingPlan} from '../sec-offering-plan/repository.ts';

const id=(n:number)=>`00000000-0000-4000-a000-${String(n).padStart(12,'0')}`;
const filing={issuer:'LOCAL ONLY Pré Ω',form:'S-1',accession:'0000000042-26-000042',filing_date:'2026-10-10'};
function fixture(status:string){
 const parent={id:id(1),raw_item_id:id(2),prompt_key:'sec_combined_offering',metadata:{combinedStatus:status,
  reservedAt:'2026-10-10T00:00:00Z',binding:{id:id(1),rawItemId:id(2),filing,ticker:'LOCAL',family:{},osRunId:id(3),offeringRunId:id(4)},
  combinedCheckpoint:status==='TECHNICAL_FAILED'?{reason:'source_unavailable_or_mismatch',provider:{stderr:'PRIVATE PROVIDER LOG'}}:null}};
 const rows:Record<string,any>[]=[parent],calls:{table:string;query:Record<string,string>}[]=[];
 const repo:Repository={async rpc(){throw Error('Admin read must never write or enqueue');},async select(table,q){
  calls.push({table,query:q});if(table!=='ai_runs')return {ok:true,data:[]};
  let found=rows.filter(r=>!q.id||q.id===`eq.${r.id}`);
  if(q.prompt_key)found=found.filter(r=>q.prompt_key===`eq.${r.prompt_key}`||q.prompt_key.startsWith('in.(')&&q.prompt_key.slice(4,-1).split(',').includes(r.prompt_key));
  if(q.or){
   const domain=q.or.match(/^\(prompt_key\.eq\.(sec_os_snapshot|sec_offering_plan),/)?.[1];assert.ok(domain,'Expected domain or pending common-run selection');
   found=found.filter(r=>r.prompt_key===domain||r.prompt_key==='sec_combined_offering'&&['QUEUED','RUNNING','TECHNICAL_FAILED'].includes(r.metadata.combinedStatus));
  }
  if(q.select!=='*')found=found.map(r=>Object.fromEntries(q.select.split(',').map(field=>{
   const [alias,expr]=field.includes(':')?field.split(':'):[field,field];
   return [alias,expr.split(/->>?/).reduce((value,key)=>value?.[key],r)];
  })));
  return {ok:true,data:structuredClone(found)};
 }};
 return {parent,rows,calls,repo};
}

for(const status of ['QUEUED','RUNNING','TECHNICAL_FAILED']){
 for(const [domain,list,read] of [['os',listSnapshots,readSnapshot],['offering',listOfferingPlans,readOfferingPlan]] as const){
  test(`${domain}: childless common ${status} appears in list and exact detail without a domain result`,async()=>{
   const f=fixture(status),before=JSON.stringify(f.rows);
   const listed=await list(f.repo);assert.equal(listed.length,1,'The existing administrator list must include the childless parent');
   assert.equal(listed[0].id,f.parent.id);
   assert.equal(listed[0].commonExecution.status,status);
   const detail=await read(f.parent.id,f.repo);assert.equal(detail.run.id,f.parent.id);
   assert.equal(detail.commonExecution?.status,status);
   assert.equal(detail.run.prompt_key,'sec_combined_offering');
   assert.equal(detail.run.metadata.osCheckpoint,undefined);assert.equal(detail.run.metadata.offeringCheckpoint,undefined);
   assert.deepEqual(detail.decisions,[]);assert.ok(f.calls.every(c=>c.table==='ai_runs'));
   assert.equal(JSON.stringify(f.rows),before);
  });
 }
}
import {readAdminHistoryRun,commonExecution,adminHistoryFilter} from './adminHistory.ts';
for(const [domain,list,read] of [['sec_os_snapshot',listSnapshots,readSnapshot],['sec_offering_plan',listOfferingPlans,readOfferingPlan]] as const){
 test(`${domain}: completed parent is omitted from list and resolves only its designated child`,async()=>{
  const f=fixture('COMPLETE'),childId=domain==='sec_os_snapshot'?id(3):id(4);
  f.rows.push({id:childId,raw_item_id:id(2),prompt_key:domain,metadata:{executionKind:'derived_domain_view',combinedInvocationId:id(1),binding:{source:{filing},filing,family:{}},osStatus:'PASS',offeringStatus:'PASS'}});
  const listed=await list(f.repo);assert.deepEqual(listed.map(r=>r.id),[childId]);
  const resolved=await readAdminHistoryRun(id(1),domain,f.repo);assert.equal(resolved.run.id,childId);assert.equal(resolved.commonExecution,null);
  const detail=await read(id(1),f.repo);assert.equal(detail.run.id,childId);
  assert.ok(f.calls.some(c=>c.table.endsWith('_decisions')&&c.query.run_id===`eq.${childId}`));
  const query=f.calls.find(c=>c.query.or)!.query;assert.equal(query.or,adminHistoryFilter(domain));assert.equal(query.limit,'100');
  assert.ok(!query.select.includes('combinedCheckpoint'));assert.ok(!query.select.includes('provider'));
 });
 for(const mismatch of ['missing','raw','parent','kind','purpose','binding'])test(`${domain}: completed parent rejects ${mismatch} child linkage`,async()=>{
  const f=fixture('COMPLETE'),childId=domain==='sec_os_snapshot'?id(3):id(4);
  const child={id:childId,raw_item_id:id(2),prompt_key:domain,metadata:{executionKind:'derived_domain_view',combinedInvocationId:id(1)}};
  if(mismatch==='raw')child.raw_item_id=id(90);
  if(mismatch==='parent')child.metadata.combinedInvocationId=id(90);
  if(mismatch==='kind')child.metadata.executionKind='independent';
  if(mismatch==='purpose')child.prompt_key=(domain==='sec_os_snapshot'?'sec_offering_plan':'sec_os_snapshot');
  if(mismatch==='binding')f.parent.metadata.binding.rawItemId=id(90);
  if(mismatch!=='missing')f.rows.push(child);
  await assert.rejects(read(id(1),f.repo),/common_child_mismatch/);
 });
 test(`${domain}: independent F-1 reader remains exact and read failures are not empty history`,async()=>{
  const f=fixture('QUEUED');f.rows.length=0;
  f.rows.push({id:id(3),raw_item_id:id(2),prompt_key:domain,metadata:{binding:{source:{filing:{...filing,form:'F-1'}},filing:{...filing,form:'F-1'},family:{}}}});
  const detail=await read(id(3),f.repo);assert.equal(detail.run.id,id(3));assert.equal(detail.commonExecution,null);
  assert.ok(!f.calls.some(c=>c.query.id===`eq.${id(1)}`));
  const broken:Repository={...f.repo,select:async()=>({ok:false,error:'PRIVATE DATABASE ERROR'})};
  await assert.rejects(list(broken),/read_failed/);await assert.rejects(read(id(3),broken),/read_failed/);
 });
}
test('common failure reason is allowlisted, no arbitrary provider log or analysis fact',()=>{
 const f=fixture('TECHNICAL_FAILED');
 assert.equal(commonExecution(f.parent)?.reason,'source_unavailable_or_mismatch');
 f.parent.metadata.combinedCheckpoint!.reason='PRIVATE EXCEPTION';
 const safe=commonExecution(f.parent);assert.equal(safe?.reason,null);assert.doesNotMatch(JSON.stringify(safe),/PRIVATE|Checkpoint|rawHash|quantity/);
});
