import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {sha} from '../sec-os-snapshot/contract.ts';
import {allowsProjectedDetailRead} from './access.ts';

const require=createRequire(import.meta.url),ts=require('typescript');
// Compile only the target boundary. Every dependency must be explicitly supplied;
// an accidental calculator, Supabase, provider or Alert import fails the test.
function load(path:string,dependencies:Record<string,unknown>):any{
 const compiled=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}};
 new Function('require','module','exports',compiled)((name:string)=>{
  assert.ok(Object.hasOwn(dependencies,name),`unexpected dependency ${name}`);return dependencies[name];
 },module,module.exports);
 return module.exports;
}

for(const domain of ['os-snapshot','offering-plan','combined-offering'] as const){
 test(`${domain}: default repository finish/checkpoint recovery/terminal replay preserve raw outputs without projected publication`,async()=>{
  const status=domain==='combined-offering'?'COMPLETE':'PASS',rpcName=`sec_${domain.replaceAll('-','_')}_transition`;
  const source={filing:{accession:'0000000001-26-000001'},fingerprint:'original'},binding={source,rawItemId:'raw',contractVersion:'frozen'};
  const value={status:'PASS',current_os:[{quantity:'100',evidence_blocks:['e1']}],plan:{components:[{quantity:{value:'20'},evidence_blocks:['e1']}]},review:null};
  const raw=JSON.stringify({label:'LOCAL ONLY Pré — £',...value}),rawHash=sha(raw),calls:string[]=[];
  let checkpoint:any=null,finished=false,recoverCheckpoint=false,providerCalls=0,repositories=0,planEvaluations=0,historyPublications=0;
  const repo={rpc:async(name:string,args:any)=>{
   assert.equal(name,rpcName);calls.push(args.p_action);
   if(args.p_action==='claim')return {claimed:!finished,token:'lease',status,binding,attempt:1,checkpoint:recoverCheckpoint?checkpoint:null};
   if(args.p_action==='checkpoint'){checkpoint=structuredClone(args.p_value);return {};}
   if(args.p_action==='finish'){finished=true;return {status};}
   assert.equal(args.p_action,'provider_started');return {};
  }};
  const repositoryModule={repository:async()=>{repositories++;return repo;},rpc:(r:any,n:string,a:any)=>r.rpc(n,a),loadOfferingSource:async()=>binding,hydrateCombined:async()=>binding};
  const contract={sha,validateOutput:(text:string,s:unknown,version?:string)=>{
   assert.equal(text,raw);assert.equal(s,source);
   if(domain==='offering-plan')assert.equal(version,'frozen');
   return {ok:true,value,meaning:'NOT_ASSESSED'};
  },evidenceRefs:()=>['e1'],combinedBinding:()=>binding,validateCombinedResponse:()=>({os_snapshot:{ok:true,value:{status:'PASS',current_os:value.current_os,review:null}},offering_plan:{ok:true,value:{status:'PASS',plan:value.plan,review:null}}})};
  const historyPublisher={osSnapshotRunSaved:async(id:string)=>{assert.equal(id,'run');historyPublications++;return {status:'not_published'};}};
  const runtime=load(`lib/sec-${domain}/runtime.ts`,{'./historyPublication.ts':historyPublisher,'../sec-os-snapshot/historyPublication.ts':historyPublisher,'./contract.ts':contract,'../sec-os-snapshot/contract.ts':{sha},'./repository.ts':repositoryModule,'../monitor/offeringPlanTrigger.ts':{offeringPlanRunSaved:async(id:string)=>{assert.equal(id,'run');planEvaluations++;return {status:'completed'};}}});
  const run=runtime[domain==='os-snapshot'?'processSnapshot':domain==='offering-plan'?'processOfferingPlan':'processCombinedOffering'];
  const provider={run:async()=>{providerCalls++;return {raw,stdout:'',stderr:'',exitCode:0,cliVersion:'offline mock',startedAt:'',finishedAt:''};}};
  // Deliberately omit supplied repository: the former hooks used only this branch.
  assert.equal((await run('run',provider)).status,status);
  assert.equal(checkpoint.raw,raw);assert.equal(checkpoint.rawHash,rawHash);
  if(domain==='combined-offering')assert.deepEqual(checkpoint.validation,{os_snapshot:{ok:true,value:{status:'PASS',current_os:value.current_os,review:null}},offering_plan:{ok:true,value:{status:'PASS',plan:value.plan,review:null}}});
  else assert.deepEqual(checkpoint.validated,value);
  const saved=JSON.stringify(checkpoint);
  assert.equal((await run('run',provider)).status,status);
  finished=false;recoverCheckpoint=true;
  assert.equal((await run('run',provider)).status,status);
  assert.equal(JSON.stringify(checkpoint),saved);assert.equal(providerCalls,1);assert.equal(repositories,3);
  assert.equal(planEvaluations,domain==='os-snapshot'?0:3);
  assert.equal(historyPublications,domain==='offering-plan'?0:3);
  assert.deepEqual(calls,['claim','provider_started','checkpoint','finish','claim','claim','finish']);
 });
}

class ApiError extends Error{code:string;status:number;constructor(code:string,message:string,status:number){super(message);this.code=code;this.status=status;}}
test('saved-event API entry evaluates direct plan before optional Registry routing without changing Primary',async()=>{
 const calls:string[]=[];
 const starter=load('lib/offeringMonitorJobStarter.ts',{
  './monitor/offeringPlanTrigger.ts':{consumeOfferingPlanEvent:async(id:string)=>{calls.push(id);}},
  'workflow/api':{},
  '@/lib/offeringMonitorJobFoundation':{buildOfferingMonitorJobIdentity:()=>null},
  '@/lib/offeringMonitorJobRepository':{},
  '@/workflows/offering-monitor-normalization':{},
 });
 const primary={ok:true,event:{id:'saved-event',event_type:'dilution_risk'},output:{unchanged:'Pré £'}},before=JSON.stringify(primary);
 assert.deepEqual(await starter.enqueueOfferingMonitorAfterPrimary(primary),{status:'not_applicable'});
 assert.deepEqual(calls,['saved-event']);assert.equal(JSON.stringify(primary),before);
 await starter.enqueueOfferingMonitorAfterPrimary({ok:false,event:{id:'failed-event'}});
 assert.deepEqual(calls,['saved-event']);
});
const response={json:(body:unknown,init?:ResponseInit)=>Response.json(body,init)};
const privateHeaders={'Cache-Control':'private, no-store'};
const runId='00000000-0000-4000-a000-000000000001',requestId='00000000-0000-4000-a000-000000000002';

for(const domain of ['os-snapshots','offering-plans']){
 test(`${domain}: independent approve/hold/reject/retry forward exact decision once; authorization/origin gates remain`,async()=>{
  const calls:{name:string;args:any}[]=[],domainName=domain==='os-snapshots'?'os_snapshot':'offering_plan';
  let user:string|null='operations',permission=true,planEvaluations=0,historyPublications=0;
  const route=load(`app/api/admin/data/${domain}/[id]/route.ts`,{
   '@/lib/sec-os-snapshot/historyPublication':{osSnapshotRunSaved:async(id:string)=>{assert.equal(id,runId);assert.equal(calls.at(-1)?.args.p_action,'approve');historyPublications++;return {status:'not_published'};}},
   '@/lib/monitor/offeringPlanTrigger':{offeringPlanRunSaved:async(id:string)=>{assert.equal(id,runId);assert.equal(calls.at(-1)?.args.p_action,'approve');planEvaluations++;return {status:'completed'};}},
   'next/server':{NextResponse:response},
   '@/lib/admin/api':{ADMIN_PRIVATE_RESPONSE_HEADERS:privateHeaders,applyAdminAuthCookies:()=>{},AdminApiError:ApiError,
    resolveAdminApiAccess:async(_r:unknown,p:string)=>{assert.equal(p,'data.run');if(!user)throw new ApiError('AUTH','Login required',401);if(!permission)throw new ApiError('FORBIDDEN','Permission required',403);return {access:{userId:user}};},
    normalizeAdminError:(e:ApiError)=>({code:e.code,status:e.status??500,message:e.message})},
   '@/lib/auth/authRequest':{assertSameOriginAuthRequest:(r:Request)=>{if(r.headers.get('origin')!==new URL(r.url).origin)throw new ApiError('ORIGIN','Invalid origin',403);}},
   [`@/lib/sec-${domain==='os-snapshots'?'os-snapshot':'offering-plan'}/repository`]:{repository:async()=>({}),rpc:async(_r:unknown,name:string,args:any)=>{calls.push({name,args});return {status:'saved',decisionId:'immutable-decision'};}},
  });
  const request=(action:string,origin='http://localhost:3111')=>new Request(`http://localhost:3111/api/admin/data/${domain}/${runId}`,{method:'POST',headers:{origin,'content-type':'application/json','x-request-id':requestId},body:JSON.stringify({action,reason:'Reviewed direct evidence Pré',candidateIndexes:[1]})});
  const invoke=(r:Request)=>route.POST(r,{params:Promise.resolve({id:runId})});
  for(const action of ['approve','hold','reject','retry']){
   const r=await invoke(request(action));assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);
   assert.deepEqual(calls.at(-1),{name:`decide_sec_${domainName}`,args:{p_id:runId,p_actor:'operations',p_action:action,p_indexes:[1],p_reason:'Reviewed direct evidence Pré',p_request:requestId}});
  }
  assert.equal(calls.length,4);
  assert.equal(planEvaluations,domain==='offering-plans'?1:0);
  assert.equal(historyPublications,domain==='os-snapshots'?1:0);
  assert.equal((await invoke(request('approve','http://foreign.test'))).status,403);
  user=null;assert.equal((await invoke(request('approve'))).status,401);
  user='ordinary';permission=false;assert.equal((await invoke(request('approve'))).status,403);
  assert.equal(calls.length,4);
  assert.equal(planEvaluations,domain==='offering-plans'?1:0);
 });
}

test('historical Alert route preserves owner-only lookup, same-origin and no-store without executing calculation',async()=>{
 let owner:string|null='owner';const reads:string[]=[];
 const archived={retired:true,current:false,read:{status:'not_ready',reason:'projected_calculation_retired'},recorded:{facts:{issuer_new_shares_base:20},evidence:[{id:'e1',text:'Pré'}]}};
 const route=load('app/api/monitors/listing/alerts/[id]/route.ts',{
  '@/lib/monitor/offeringPlanReader':{readOfferingPlanAlertForOwner:async()=>null},
  'next/server':{NextResponse:response},'@/lib/currentUser':{getOptionalCurrentUserId:async()=>owner},
  '@/lib/projected-offering-dilution/access':{allowsProjectedDetailRead},
  '@/lib/projected-offering-dilution/history':{readProjectedAlertForOwner:async(o:string,id:string)=>{reads.push(o);assert.equal(id,runId);return o==='owner'?archived:null;}},
  '../../shared':{MONITOR_API_NO_STORE_HEADERS:privateHeaders,monitorAuthRequiredResponse:()=>Response.json({ok:false},{status:401,headers:privateHeaders})},
 });
 const invoke=(origin='http://localhost:3111')=>route.GET(new Request(`http://localhost:3111/api/monitors/listing/alerts/${runId}`,{headers:{origin}}),{params:Promise.resolve({id:runId})});
 const r=await invoke();assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);assert.deepEqual((await r.json()).data,archived);
 assert.equal((await invoke('http://foreign.test')).status,403);
 owner=null;assert.equal((await invoke()).status,401);
 owner='other';assert.equal((await invoke()).status,404);assert.deepEqual(reads,['owner','other']);
});
