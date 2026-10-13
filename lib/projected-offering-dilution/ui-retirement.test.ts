import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {hasRetiredMonitorConditions} from '../monitor/conditionRegistry.ts';
import {rolesHavePermission} from '../admin/policy.ts';

const require=createRequire(import.meta.url),ts=require('typescript'),React=require('react');
const {renderToStaticMarkup:render}=require('react-dom/server');
function load(path:string,dependencies:Record<string,unknown>){
 const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{} as any};
 new Function('require','module','exports',code)((name:string)=>{
  if(Object.hasOwn(dependencies,name))return dependencies[name];
  if(name.endsWith('.module.css'))return {default:{}};
  if(name==='react'||name==='react/jsx-runtime')return require(name);
  if(name==='./OfferingPlanAlertDetails')return {OfferingPlanAlertDetails:()=>null};
  throw Error(`Unexpected UI dependency: ${name}`);
 },module,module.exports);return module.exports;
}
const Link={default:({href,children}:any)=>React.createElement('a',{href},children)};
const noOp=()=>null;
const commonExecutionUI=load('components/admin/CommonOfferingExecution.tsx',{'next/link':Link});

test('saved retired active, paused and mixed sets remain visible without resume/edit or active claims',()=>{
 const condition={key:'projected.issuer_new_shares_base',operator:'gte',value:1000};
 const monitors=[{id:'active',isActive:true,conditions:[condition]},{id:'paused',isActive:false,conditions:[condition]},
  {id:'mixed',kind:'form4_insider_purchase',isActive:false,conditions:[condition,{key:'event.sec_form',operator:'eq',value:'4'}]}];
 const before=JSON.stringify(monitors),states=[monitors,[],0,false,false,'','',''];let index=0;
 const {ListingMonitorManagement}=load('components/alerts-v2/ListingMonitorDraftBuilder.tsx',{
  react:{...React,useState:()=>[states[index++],()=>{throw Error('Render must not mutate');}],useEffect:noOp,useMemo:(f:()=>unknown)=>f()},
  'next/link':Link,'lucide-react':Object.fromEntries(['AlertTriangle','BellRing','CheckCircle2','Pause','Pencil','Play','Trash2'].map(k=>[k,noOp])),
  '@/lib/monitor/listingMonitorDraftReview':{getListingMonitorConditionEditorCatalog:()=>[],formatListingMonitorConditionPreview:()=>({text:'Original saved threshold'})},
  '@/lib/monitor/conditionRegistry':{hasRetiredMonitorConditions},
  '@/lib/monitor/monitorPresets':{getMonitorPresetCatalog:()=>[],getMonitorAddConditionCatalog:()=>[]},
  './Form4InsiderPurchaseMonitor':{Form4InsiderPurchaseBuilder:noOp,Form4PurchaseAlertDetails:noOp,Form4PurchaseMonitorSummary:()=>{throw Error('Retired mixed set must not expose its editor');}},
  './ProjectedAlertDetails':{ProjectedAlertDetails:noOp},
 });
 const html=render(React.createElement(ListingMonitorManagement));
 assert.equal((html.match(/Retired condition/g)||[]).length,3);
 assert.equal((html.match(/data-active="false"/g)||[]).length,3);
 assert.equal((html.match(/>Pause</g)||[]).length,1);
 assert.equal((html.match(/ Delete</g)||[]).length,3);
 assert.doesNotMatch(html,/>Resume<|>Edit<|data-active="true"/);
 assert.equal(JSON.stringify(monitors),before);
});

for(const domain of ['offering-plans','os-snapshots'])test(`${domain}: exact-run page keeps permission gate, direct result, peer link and independent decisions`,async()=>{
 const offering=domain==='offering-plans',calls:string[]=[],filing={issuer:'Local Pré £',form:'F-1',accession:'0000000001-26-991101',filing_date:'2026-10-09'};
 const source={filing,blocks:[]},checkpoint={validated:{status:'PASS',plan:{components:[]},current_os:[{quantity:'123'}]}};
 const selected={run:{id:'exact',metadata:{binding:{source,family:{}},offeringStatus:'PASS',osStatus:'PASS',offeringCheckpoint:checkpoint,osCheckpoint:checkpoint}},current:true,source,identity:source,family:[],decisions:[{id:'decision',action:'hold',reason:'Independent direct review',candidate_indexes:[],created_at:'2026-10-09T00:00:00Z'}]};
 let allowed=true;
 const repo={repository:async()=>({}),listOfferingPlans:async()=>[],listSnapshots:async()=>[],readOfferingPlan:async(id:string)=>{assert.equal(id,'exact');return selected;},readSnapshot:async(id:string)=>{assert.equal(id,'exact');return selected;},readMatchingOsRun:async(run:any)=>{assert.equal(run.id,'exact');calls.push('peer');return 'os-peer';},readMatchingOfferingRun:async(run:any)=>{assert.equal(run.id,'exact');calls.push('peer');return 'offering-peer';}};
 const deps:Record<string,unknown>={'@/components/admin/CommonOfferingExecution':commonExecutionUI,'next/link':Link,'@/lib/admin/server':{requireAdminPermission:async(p:string)=>{assert.equal(p,'data.read');calls.push('gate');if(!allowed)throw Error('DENIED');return {roles:['operations']};}},'@/lib/admin/policy':{rolesHavePermission},[`@/lib/sec-${offering?'offering-plan':'os-snapshot'}/repository`]:repo};
 if(offering){deps['@/components/admin/OfferingPlanCard']={OfferingPlanCard:({plan}:any)=>{assert.equal(plan,checkpoint.validated.plan);return React.createElement('p',null,'Direct plan');}};deps['@/components/admin/OfferingPlanActions']={OfferingPlanActions:({canWrite}:any)=>{assert.equal(canWrite,true);return null;}};}
 else{deps['@/components/admin/OsSnapshotRecord']={OsSnapshotRecord:({record}:any)=>React.createElement('p',null,record.quantity)};deps['@/components/admin/OsSnapshotActions']={OsSnapshotActions:({canWrite}:any)=>{assert.equal(canWrite,true);return null;}};}
 const Page=load(`app/admin/data/${domain}/page.tsx`,deps).default,before=JSON.stringify(selected);
 const html=render(await Page({searchParams:Promise.resolve({id:'exact'})}));
 assert.match(html,/Independent direct review/);assert.match(html,/보류/);
 assert.ok(html.includes(offering?'/admin/data/os-snapshots?id=os-peer':'/admin/data/offering-plans?id=offering-peer'));
 assert.ok(html.includes(offering?'Direct plan':'123'));
 assert.doesNotMatch(html,/Projected offering impact|예상 증가율|Historical calculation/);
 assert.deepEqual(calls,['gate','peer']);assert.equal(JSON.stringify(selected),before);
 allowed=false;await assert.rejects(Page({searchParams:Promise.resolve({id:'exact'})}),/DENIED/);
 assert.deepEqual(calls,['gate','peer','gate']);
});
for(const domain of ['offering-plans','os-snapshots'])for(const status of ['QUEUED','RUNNING','TECHNICAL_FAILED'])test(`${domain}: ${status} common execution has filters, safe detail, no child controls and read errors`,async()=>{
 const offering=domain==='offering-plans',calls:string[]=[],execution={id:'parent',status,filing:{issuer:'LOCAL ONLY Pré Ω',form:'S-1',accession:'0000000042-26-000042',filing_date:'2026-10-10'},ticker:'LOCAL',reason:status==='TECHNICAL_FAILED'?'source_unavailable_or_mismatch':null};
 const selected={run:{id:'parent',metadata:{combinedStatus:status}},commonExecution:execution,decisions:[]};
 let denied=false,failRead=false;
 const repo={repository:async()=>{throw Error('Parent must not hydrate source or peer');},listOfferingPlans:async()=>{calls.push('list');if(failRead)throw Error('DB failed');return [{id:'parent',commonExecution:execution}];},listSnapshots:async()=>{calls.push('list');if(failRead)throw Error('DB failed');return [{id:'parent',commonExecution:execution}];},readOfferingPlan:async()=>selected,readSnapshot:async()=>selected};
 const forbidden=()=>{throw Error('Parent must not render child result/decision controls');};
 const deps={'next/link':Link,'@/components/admin/CommonOfferingExecution':commonExecutionUI,'@/lib/admin/server':{requireAdminPermission:async()=>{calls.push('gate');if(denied)throw Error('DENIED');return {roles:['operations']};}},'@/lib/admin/policy':{rolesHavePermission},[`@/lib/sec-${offering?'offering-plan':'os-snapshot'}/repository`]:repo,
  '@/components/admin/OfferingPlanCard':{OfferingPlanCard:forbidden},'@/components/admin/OfferingPlanActions':{OfferingPlanActions:forbidden},'@/components/admin/OsSnapshotRecord':{OsSnapshotRecord:forbidden},'@/components/admin/OsSnapshotActions':{OsSnapshotActions:forbidden}};
 const Page=load(`app/admin/data/${domain}/page.tsx`,deps).default;
 const html=render(await Page({searchParams:Promise.resolve({id:'parent',status})}));
 assert.match(html,/LOCAL ONLY Pré Ω/);assert.match(html,/개별 결과는 아직 생성되지 않았습니다/);assert.match(html,/공통 실행 ID: parent/);
 assert.match(html,/같은 공통 실행 보기/);assert.doesNotMatch(html,/검토 이력|원본 결과|검증 JSON|>NO_DIRECT|재시도|PRIVATE|예상 증가율/);
 const filtered=render(await Page({searchParams:Promise.resolve({status:'PASS'})}));assert.doesNotMatch(filtered,/LOCAL ONLY/);
 const all=render(await Page({searchParams:Promise.resolve({status:'ALL'})}));assert.match(all,/LOCAL ONLY/);
 failRead=true;const failed=render(await Page({searchParams:Promise.resolve({})}));assert.match(failed,/role="alert"/);assert.match(failed,/목록을 읽을 수 없습니다/);
 const before=calls.length;denied=true;await assert.rejects(Page({searchParams:Promise.resolve({})}),/DENIED/);assert.deepEqual(calls.slice(before),['gate']);
});
