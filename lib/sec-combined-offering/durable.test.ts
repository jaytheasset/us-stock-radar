import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildCombinedSource} from './source.ts';
import {durableBinding,readCombinedDomainSource} from './repository.ts';
import {processCombinedOffering} from './runtime.ts';
import {combinedProvider} from './provider.ts';
import {REVISION,schemaText,promptText} from './contract.ts';
import {sha} from '../sec-os-snapshot/contract.ts';
import {readMatchingOsRun} from '../sec-offering-plan/repository.ts';
import type {Repository} from '../sec-os-snapshot/repository.ts';

function fixture(){
 const raw={id:'00000000-0000-4000-a000-000000000042',source_code:'sec_edgar',source_unique_id:'0000000042-26-000042',raw_payload:{company_name:'LOCAL ONLY Ω',cik:'0000000042',accession_number:'0000000042-26-000042',form_type:'S-1',filing_date:'2026-10-10',primary_document_html:'<p>Local test Ω</p>',primary_document_html_truncated:false}};
 const built=buildCombinedSource(raw);if(!built.ok)throw Error(built.reason);
 const binding=durableBinding(raw.id,built.source),value={version:REVISION,filing:built.source.filing,
  os_snapshot:{status:'NO_DIRECT_CURRENT_OS',current_os:[],review:null},
  offering_plan:{status:'NO_DIRECT_OFFERING_PLAN',plan:{components:[],over_allotment:[],post_offering_os:[],proceeds:[],atm_terms:[]},review:null}};
 return {raw,source:built.source,binding,text:JSON.stringify(value)};
}
const response=(raw:string)=>({raw,stdout:'',stderr:'',exitCode:0,cliVersion:'mock',startedAt:'',finishedAt:''});
async function history(){
 const f=fixture();let cp:any;
 const repository:Repository={select:async()=>({ok:true,data:[f.raw]}),rpc:async(_n,a)=>{
  if(a.p_action==='claim')return {ok:true,data:{claimed:true,token:'local',binding:f.binding}};
  if(a.p_action==='checkpoint')cp=a.p_value;
  return {ok:true,data:{status:'COMPLETE'}};
 }};
 await processCombinedOffering(f.binding.id,{run:async()=>response(f.text)},repository);
 const parent={id:f.binding.id,raw_item_id:f.raw.id,status:'succeeded',metadata:{binding:f.binding,combinedStatus:'COMPLETE',combinedCheckpoint:cp}};
 const b=f.binding,filing=b.filing,part=cp.validation.offering_plan;
 const view={status:'NO_DIRECT_OFFERING_PLAN',validated:{version:'offering_plan_v1',filing,...part.value},validation:part,rawHash:cp.rawHash,combinedInvocationId:parent.id,domain:'offering',provider:{providerInvoked:false,retrySafe:false}};
 const child={id:b.offeringRunId,raw_item_id:f.raw.id,prompt_key:'sec_offering_plan',prompt_version:b.contractVersion,model:'derived-domain-view',status:'succeeded',metadata:{executionKind:'derived_domain_view',combinedInvocationId:b.id,binding:{...b,id:b.offeringRunId,key:sha(b.key+':offering'),source:{filing,ticker:b.ticker}},offeringStatus:view.status,offeringCheckpoint:view}};
 const outputs=[{id:parent.id,payload:structuredClone(cp)},{id:child.id,payload:structuredClone(view)}];
 const repo:Repository={rpc:async()=>{throw Error('read must not write');},select:async(t,q)=>({ok:true,data:t==='raw_items'?[f.raw]:t==='ai_runs'?[parent]:outputs.filter(o=>'eq.'+o.id===q.ai_run_id)})};
 return {...f,parent,child,outputs,repo};
}
test('derived reader accepts exact immutable parent/output/projection, without new invocation',async()=>{
 const f=await history(),result=await readCombinedDomainSource(f.child,f.repo);
 assert.equal(result.parent.id,f.binding.id);assert.equal(result.source.fingerprint,f.source.fingerprint);
 assert.deepEqual(result.value,f.child.metadata.offeringCheckpoint.validated);
});

test('peer lookup uses the exact combined invocation without calculating or substituting another parent',async()=>{
 const f=await history();
 assert.equal(await readMatchingOsRun(f.child,f.repo),f.binding.osRunId);
 f.parent.id='unrelated-parent';
 await assert.rejects(readMatchingOsRun(f.child,f.repo));
});
test('derived reader rejects swapped roles, unrelated parent, hash/contract/source/projection and output damage',async()=>{
 const mutations:((f:Awaited<ReturnType<typeof history>>)=>void)[]=[
  f=>{f.child.id=f.binding.osRunId;},f=>{f.parent.id='other';},
  f=>{f.child.metadata.binding.schemaHash=sha('wrong');},f=>{f.child.metadata.binding.sourceFingerprint=sha('wrong');},
  f=>{f.child.metadata.offeringCheckpoint.validated.plan.components.push({} as never);},
  f=>{f.outputs[0].payload.raw+=' ';},f=>{f.outputs[1].payload.rawHash=sha('wrong');},
  f=>{f.raw.raw_payload.primary_document_html+=' changed';},f=>{f.parent.metadata.combinedStatus='RUNNING';},
 ];
 for(const mutate of mutations){const f=await history();mutate(f);await assert.rejects(readCombinedDomainSource(f.child,f.repo));}
});
test('runtime does not invoke on stale source; resumes checkpoint without another provider call',async()=>{
 for(const checkpoint of [null,{status:'COMPLETE'}]){
  const f=fixture();f.raw.raw_payload.primary_document_html+='changed';let calls=0,saved:any;
  const repo:Repository={select:async()=>({ok:true,data:[f.raw]}),rpc:async(_n,a)=>{
   if(a.p_action==='claim')return {ok:true,data:{claimed:true,token:'test',binding:f.binding,checkpoint}};
   if(a.p_action==='checkpoint')saved=a.p_value;
   return {ok:true,data:{status:checkpoint?.status??saved?.status}};
  }};
  const result=await processCombinedOffering(f.binding.id,{run:async()=>{calls++;throw Error('must not invoke');}},repo);
  assert.equal(calls,0);assert.equal(result.status,checkpoint?'COMPLETE':'TECHNICAL_FAILED');
 }
});
test('combined provider freezes one real mock process result with the combined contract; lost journal forbids recall',async()=>{
 const f=fixture(),root=await mkdtemp(join(tmpdir(),'combined-provider-'));let calls=0;
 const p=combinedProvider({executable:process.execPath,root,runner:async(_e,_a,o)=>{
  calls++;assert.equal(await readFile(join(o.cwd,'schema.json'),'utf8'),schemaText);
  assert.equal(await readFile(join(o.cwd,'extraction-instructions.md'),'utf8'),promptText);
  await o.onPid(2147483647);await writeFile(join(o.cwd,'cli-final-output.json'),f.text);
  return {stdout:'',stderr:'',exitCode:0};
 }});
 const binding={...f.binding,source:f.source};
 assert.equal((await p.run(binding,1)).raw,f.text);assert.equal((await p.run(binding,1,true)).raw,f.text);assert.equal(calls,1);
 const empty=combinedProvider({executable:process.execPath,root:await mkdtemp(join(tmpdir(),'combined-missing-')),runner:async()=>{throw Error('must not invoke');}});
 await assert.rejects(empty.run(binding,1,true),/missing_journal/);
});
test('retained complete domestic primary is used only when the ordinary primary is truncated',()=>{
 const f=fixture();const raw=structuredClone(f.raw) as any;
 raw.raw_payload.primary_document_html_truncated=true;raw.raw_payload.combined_offering_primary_html=raw.raw_payload.primary_document_html;
 raw.raw_payload.primary_document_html='truncated';const built=buildCombinedSource(raw);
 assert.equal(built.ok,true);if(built.ok)assert.deepEqual(built.source,f.source);
 delete raw.raw_payload.combined_offering_primary_html;assert.equal(buildCombinedSource(raw).ok,false);
});
