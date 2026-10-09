import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Ajv2020} from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {getContract,REVISION,LEGACY_REVISION,validateOutput,sha,stable,planReferenceErrors} from './contract.ts';
import {buildSource,bindingFor,compactBinding,hydrateBinding} from './source.ts';
import {CodexCliOfferingProvider} from './provider.ts';
import {processOfferingPlan} from './runtime.ts';
import {readOfferingPlan,enqueueOfferingPlan,type Repository} from './repository.ts';

const cases=JSON.parse(readFileSync('lib/sec-offering-plan/fixtures/atm-regressions.json','utf8'));
const schema=JSON.parse(getContract(REVISION).schemaText);
const ajv=new Ajv2020({allErrors:true,strict:false});addFormats(ajv);
const validatePlan=ajv.compile({$defs:schema.$defs,...schema.$defs.plan});
// Entirely synthetic F1/F1A metadata and content. Not an actual extraction.
function fixture(form='F-1',revision=REVISION){
 const raw={id:'00000000-0000-5000-a000-000000000042',source_code:'sec_edgar',source_unique_id:'0000000042-26-000001',raw_payload:{company_name:'Synthetic ATM shape Ω',cik:'42',accession_number:'0000000042-26-000001',form_type:form,filing_date:'2026-10-10',primary_document_html:'<p>ATM up to $35,000,000. Ordinary shares £0.01.</p>',primary_document_html_truncated:false}};
 const source=buildSource(raw),binding=bindingFor(raw.id,source,revision);
 const plan=structuredClone(cases[0].plan);
 for(const c of plan.components)c.evidence_blocks=[source.blocks[0].id];
 for(const t of plan.atm_terms)t.evidence_blocks=[source.blocks[0].id];
 if(revision===LEGACY_REVISION)delete plan.atm_terms;
 return {raw,source,binding,value:{version:'offering_plan_v1',filing:source.filing,status:'PASS',plan,review:null} as any};
}
for(const c of cases)test('retained ATM plan excerpt: '+c.id,()=>{
 const before=stable(c);assert.equal(validatePlan(c.plan),true,JSON.stringify(validatePlan.errors));
 assert.deepEqual(planReferenceErrors({plan:c.plan,review:null}),[]);
 for(const b of c.atmEvidence)assert.equal(sha(b.text),b.sha256);
 for(const t of c.plan.atm_terms)for(const id of t.evidence_blocks)assert.ok(c.atmEvidence.some((b:any)=>b.id===id));
 assert.equal(stable(c),before);
 if(c.id==='silvaco')assert.deepEqual(c.plan.atm_terms.map((r:any)=>[r.kind,r.amount,r.currency]),[['offering_limit','35000000','$'],['increase_amount','20000000','$'],['remaining_offering_amount','30668720','$']]);
 if(c.id==='shimmick-atm-amendment')assert.deepEqual(c.plan.atm_terms.map((r:any)=>[r.kind,r.status,r.amount]),[['offering_limit','prior','7800000'],['offering_limit','current','4986750']]);
 if(c.id==='ibio')assert.deepEqual(c.plan.atm_terms,[]);
});
for(const form of ['F-1','F-1/A'])test('synthetic new contract shape '+form,()=>{
 const f=fixture(form),raw=JSON.stringify(f.value);assert.equal(validateOutput(raw,f.source,REVISION).ok,true);
 assert.equal(JSON.stringify(f.value),raw);
 assert.equal(validateOutput(raw,f.source,LEGACY_REVISION).ok,false);
 delete f.value.plan.atm_terms;assert.equal(validateOutput(JSON.stringify(f.value),f.source,REVISION).ok,false);
 assert.equal(validateOutput(JSON.stringify(f.value),f.source,LEGACY_REVISION).ok,true);
 f.value.plan.atm_terms=[];assert.equal(validateOutput(JSON.stringify(f.value),f.source,REVISION).ok,true);
});
test('ATM detects bad types, dates, component/evidence refs without correction',()=>{
 for(const patch of [{amount:35000000},{amount:'-1'},{amount:'3.5e7'},{currency:''},{kind:'net_proceeds'},{status:'completed'},{as_of_date:'2026-02-30'},{component_ids:[]},{component_ids:['absent']},{evidence_blocks:[]},{evidence_blocks:['other-accession']},{basis:''}]){
  const f=fixture();Object.assign(f.value.plan.atm_terms[0],patch);const raw=JSON.stringify(f.value);
  assert.equal(validateOutput(raw,f.source,REVISION).ok,false,JSON.stringify(patch));assert.equal(JSON.stringify(f.value),raw);
 }
});
test('review candidates require ATM presence; unresolved main plan stays empty',()=>{
 const f=fixture(),candidate=f.value.plan;f.value.status='REVIEW_REQUIRED';
 f.value.plan={components:[],over_allotment:[],post_offering_os:[],proceeds:[],atm_terms:[]};
 f.value.review={code:'other_core_conflict',evidence_blocks:[f.source.blocks[0].id],candidates:[candidate]};
 assert.equal(validateOutput(JSON.stringify(f.value),f.source,REVISION).ok,true);
 delete candidate.atm_terms;assert.equal(validateOutput(JSON.stringify(f.value),f.source,REVISION).ok,false);
});
test('historical full/compact binding keys and hashes are unchanged; new binding differs',()=>{
 const f=fixture('F-1',LEGACY_REVISION),b=f.binding;
 assert.equal(b.schemaHash,'861dac72eb8ccfb57fea01faf57ac875cd23daa7ff929314ec17c8d0717122bb');
 assert.equal(b.promptHash,'d3860dadab45d8c02cc30c174a8a781ee4a4a663b55fbb472984c2e2cf4578bb');
 assert.equal(b.key,sha(stable([f.raw.id,f.source.filing.accession,f.source.fingerprint,LEGACY_REVISION,b.schemaHash,b.promptHash,b.providerProfile])));
 for(const stored of [b,compactBinding(b)])assert.deepEqual(hydrateBinding(stored,f.raw),b);
 assert.notEqual(bindingFor(f.raw.id,f.source).id,b.id);
 assert.throws(()=>hydrateBinding({...compactBinding(b),promptHash:sha('wrong')},f.raw),/mismatch/);
 assert.throws(()=>getContract('unknown'),/unsupported/);
 assert.equal(validateOutput(JSON.stringify(f.value),f.source,'unknown').ok,false);
});
for(const revision of [LEGACY_REVISION,REVISION])test('provider uses recorded contract and recovers exact bytes: '+revision,async()=>{
 const f=fixture('F-1',revision),raw=JSON.stringify(f.value),root=await mkdtemp(join(tmpdir(),'atm-contract-'));let calls=0;
 const provider=new CodexCliOfferingProvider({root,executable:process.execPath,runner:async(_e,_a,o)=>{
  calls++;assert.equal(await readFile(join(o.cwd,'schema.json'),'utf8'),getContract(revision).schemaText);
  assert.equal(await readFile(join(o.cwd,'extraction-instructions.md'),'utf8'),getContract(revision).promptText);
  await o.onPid(2147483647);await writeFile(join(o.cwd,'cli-final-output.json'),raw);return {stdout:'',stderr:'',exitCode:0};
 }});
 assert.equal((await provider.run(f.binding,1)).raw,raw);
 assert.equal((await provider.run(f.binding,1,true)).raw,raw);assert.equal(calls,1);
 await assert.rejects(provider.run({...f.binding,schemaHash:sha('wrong')},1),/mismatch/);assert.equal(calls,1);
});
for(const revision of [LEGACY_REVISION,REVISION])test('runtime, reader and decision provenance keep recorded revision: '+revision,async()=>{
 const f=fixture('F-1',revision);let checkpoint:any,calls=0;const decisions=[{action:'approve',candidate_indexes:[0],reason:'Synthetic review',id:'retained-decision'}];
 const repo:Repository={select:async(table)=>({ok:true,data:table==='raw_items'?[f.raw]:table==='sec_offering_plan_decisions'?decisions:[{metadata:{binding:compactBinding(f.binding),offeringCheckpoint:checkpoint}}]}),rpc:async(_name,args)=>{
  if(args.p_action==='claim')return {ok:true,data:{claimed:true,token:'fixture-token',attempt:1,binding:compactBinding(f.binding)}};
  if(args.p_action==='checkpoint')checkpoint=args.p_value;
  return {ok:true,data:{status:checkpoint?.status}};
 }};
 const output=JSON.stringify(f.value),outputHash=sha(output);
 const result=await processOfferingPlan(f.binding.id,{run:async()=>{calls++;return {raw:output,stdout:'',stderr:'',exitCode:0,cliVersion:'mock',startedAt:'',finishedAt:''};}},repo);
 assert.equal(result.status,'PASS');assert.equal(calls,1);assert.equal(checkpoint.rawHash,outputHash);
 assert.deepEqual(checkpoint.validated,f.value);
 const read=await readOfferingPlan(f.binding.id,repo);assert.deepEqual(read.decisions,decisions);assert.equal(read.sourceError,null);
 assert.equal(Object.hasOwn(read.run.metadata.offeringCheckpoint.validated.plan,'atm_terms'),revision===REVISION);
 assert.equal(checkpoint.raw,output);
});
test('default enqueue selects r3 compact binding without source persistence',async()=>{
 const f=fixture();let saved:any;await enqueueOfferingPlan(f.raw.id,{select:async()=>({ok:true,data:[f.raw]}),rpc:async(_n,args)=>{saved=args.p_binding;return {ok:true,data:{}};}});
 assert.equal(saved.contractVersion,REVISION);assert.equal(saved.schemaHash,getContract(REVISION).schemaHash);assert.equal('source' in saved,false);
});
test('new runtime rejects old missing ATM output instead of supplying an empty array',async()=>{
 const f=fixture();delete f.value.plan.atm_terms;let checkpoint:any;
 const repo:Repository={select:async()=>({ok:true,data:[f.raw]}),rpc:async(_n,a)=>{if(a.p_action==='claim')return {ok:true,data:{claimed:true,token:'t',attempt:1,binding:compactBinding(f.binding)}};if(a.p_action==='checkpoint')checkpoint=a.p_value;return {ok:true,data:{status:checkpoint?.status}};}};
 await processOfferingPlan(f.binding.id,{run:async()=>({raw:JSON.stringify(f.value),stdout:'',stderr:'',exitCode:0,cliVersion:'mock',startedAt:'',finishedAt:''})},repo);
 assert.equal(checkpoint.status,'VALIDATION_FAILED');assert.equal(checkpoint.validated,null);assert.equal(checkpoint.raw,JSON.stringify(f.value));
});
