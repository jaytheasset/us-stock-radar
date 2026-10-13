import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {analyzeCombined} from './adapter.ts';
import {buildCombinedSource,assertCombinedSource,isCombinedForm} from './source.ts';
import {combinedBinding,validateCombinedResponse,REVISION,schemaText} from './contract.ts';
import {FORMS} from './schema.ts';
import {atmTermSchema} from '../sec-offering-plan/atm.ts';
import {isOsForm,buildSource as osSource,bindingFor as osBinding} from '../sec-os-snapshot/source.ts';
import {buildSource as offeringSource,bindingFor as offeringBinding} from '../sec-offering-plan/source.ts';
import {processSnapshot} from '../sec-os-snapshot/runtime.ts';
import {processOfferingPlan} from '../sec-offering-plan/runtime.ts';
import type {Repository} from '../sec-offering-plan/repository.ts';
import {sha,stable} from '../sec-os-snapshot/contract.ts';

// Synthetic input/response only. No retained output is rewritten for the product source IDs.
const rawItem=(form='S-1')=>({id:'00000000-0000-4000-a000-000000000042',source_code:'sec_edgar',source_unique_id:'0000000042-26-000001',
 raw_payload:{company_name:'Synthetic issuer Ω',cik:'0000000042',accession_number:'0000000042-26-000001',form_type:form,filing_date:'2026-10-10',
 primary_document_url:'https://www.sec.gov/Archives/synthetic-only',primary_document_html:'<p>100 common shares outstanding as of October 1, 2026. Offered shares blank. Ω £0.01</p>',primary_document_html_truncated:false}});
function input(form='S-1'){
 const raw=rawItem(form),built=buildCombinedSource(raw);if(!built.ok)throw Error(built.reason);
 const source=built.source,binding=combinedBinding(raw.id,source),evidence=[source.blocks[0].id];
 const value:any={version:REVISION,filing:source.filing,os_snapshot:{status:'PASS',current_os:[{scope:'class',share_class:'common shares',quantity:'100',as_of_date:'2026-10-01',as_of_text:'as of October 1, 2026',evidence_blocks:evidence}],review:null},
 offering_plan:{status:'PASS',plan:{components:[{id:'c1',seller_type:'issuer',security_type:'common_stock',security_label:'Common shares Ω £0.01',quantity:{status:'blank',value:null,unit:'shares'},price:{status:'not_stated',qualification:'not_stated',value:null,low:null,high:null,currency:null,per_unit:null},scenario:null,depositary:null,evidence_blocks:evidence}],over_allotment:[],post_offering_os:[],proceeds:[],atm_terms:[]},review:null}};
 return {raw,source,binding,value};
}
for(const form of FORMS)test('one invocation, two independently retained domains: '+form,async()=>{
 const f=input(form),raw=JSON.stringify(f.value,null,2)+'\n';let calls=0;
 const r=await analyzeCombined(f.raw,{run:async request=>{calls++;assert.equal(request.schema,schemaText);assert.deepEqual(JSON.parse(request.source),f.source);assert.equal('documents' in request.binding,false);return {raw};}});
 assert.equal(calls,1);assert.equal(r.providerInvocations,1);assert.equal(r.ok,true);
 if(!('raw' in r))throw Error('no retained response');
 assert.equal(r.raw,raw);assert.equal(r.rawHash,sha(raw));assert.deepEqual(r.os_snapshot.value,f.value.os_snapshot);assert.deepEqual(r.offering_plan.value,f.value.offering_plan);
 assert.equal(r.offering_plan.value!.plan.components[0].quantity.value,null);assert.equal(r.os_snapshot.meaning,'NOT_ASSESSED');
});
test('combined and independent Offering use exactly one shared ATM schema',()=>{
 const combined=JSON.parse(schemaText);assert.deepEqual(combined.$defs.off_atm_term,atmTermSchema);
 assert.ok(combined.$defs.off_plan.required.includes('atm_terms'));
});
test('one domain schema/reference failure never replaces or blocks the other valid result',()=>{
 for(const domain of ['os_snapshot','offering_plan'] as const)for(const damage of ['schema','evidence','missing']){
  const f=input(),other=domain==='os_snapshot'?'offering_plan':'os_snapshot';
  if(damage==='missing')delete f.value[domain];
  else if(damage==='schema')f.value[domain].status='WRONG';
  else if(domain==='os_snapshot')f.value.os_snapshot.current_os[0].evidence_blocks=['D1-B0001'];
  else f.value.offering_plan.plan.components[0].evidence_blocks=['other-accession:L1'];
  const raw=JSON.stringify(f.value),result=validateCombinedResponse(raw,f.source,f.binding);
  assert.equal(result.ok,false);assert.equal(result[domain].ok,false);assert.equal(result[other].ok,true);
  assert.deepEqual(result[other].value,f.value[other]);assert.equal(result.raw,raw);assert.equal(JSON.stringify(f.value),raw);
 }
});
test('invalid common identity, unsupported output revision/shape reject both domains',()=>{
 for(const change of [(v:any)=>v.filing.accession='0000000042-26-000099',(v:any)=>v.filing.cik='0000000043',
  (v:any)=>v.filing.filing_date=null,(v:any)=>v.version='combined_offering_experiment_r2',
  (v:any)=>v.version='combined_offering_experiment_r1',(v:any)=>v.extra='private',
  (v:any)=>delete v.version]){
  const f=input();change(f.value);const result=validateCombinedResponse(JSON.stringify(f.value),f.source,f.binding);
  assert.equal(result.os_snapshot.ok,false);assert.equal(result.offering_plan.ok,false);
 }
 const f=input();for(const raw of ['{broken','null','[]'])assert.equal(validateCombinedResponse(raw,f.source,f.binding).ok,false);
});
test('ATM refs checked independently; monetary rows never fill share quantities',()=>{
 const f=input();f.value.offering_plan.plan.atm_terms=[{component_ids:['c1'],kind:'offering_limit',status:'current',amount:'35000000',currency:'$',as_of_date:null,as_of_text:null,qualification:'up to',basis:'Synthetic schema test only',evidence_blocks:[f.source.blocks[0].id]}];
 const r=validateCombinedResponse(JSON.stringify(f.value),f.source,f.binding);assert.equal(r.ok,true);
 assert.equal(r.offering_plan.value!.plan.components[0].quantity.value,null);
 f.value.offering_plan.plan.atm_terms[0].component_ids=['missing'];
 const bad=validateCombinedResponse(JSON.stringify(f.value),f.source,f.binding);assert.equal(bad.offering_plan.ok,false);assert.equal(bad.os_snapshot.ok,true);
});
test('review and no-direct remain domain outcomes, with no implied approval',()=>{
 const f=input();f.value.os_snapshot={status:'REVIEW_REQUIRED',current_os:[],review:{code:'CONFLICTING_CURRENT_OS',candidates:[f.value.os_snapshot.current_os[0],{...f.value.os_snapshot.current_os[0],quantity:'101'}]}};
 f.value.offering_plan={status:'NO_DIRECT_OFFERING_PLAN',plan:{components:[],over_allotment:[],post_offering_os:[],proceeds:[],atm_terms:[]},review:null};
 const r=validateCombinedResponse(JSON.stringify(f.value),f.source,f.binding);assert.equal(r.ok,true);assert.deepEqual(r.os_snapshot.value,f.value.os_snapshot);
 assert.equal(r.offering_plan.value!.status,'NO_DIRECT_OFFERING_PLAN');assert.equal(r.offering_plan.meaning,'NOT_ASSESSED');
});
test('incomplete metadata and unsupported form produce unavailable with zero invocations',async()=>{
 const patches=[{filing_date:null},{filing_date:''},{filing_date:'2026-02-30'},{cik:''},{cik:'0000000000'},{accession_number:''},{form_type:'F-1'},{form_type:'F-1/A'},{form_type:'424B2'},{form_type:'S-8'},{primary_document_html_truncated:true},{primary_document_html:''}];
 for(const patch of patches){const raw=rawItem();Object.assign(raw.raw_payload,patch);const r=await analyzeCombined(raw,{run:async()=>{throw Error('must not call');}});assert.equal(r.ok,false);assert.equal(r.providerInvocations,0);assert.equal('status' in r&&r.status,'UNAVAILABLE');}
});
test('source fingerprint/binding damage, including complete block coverage, fails closed',()=>{
 for(const mutate of [(s:any)=>s.blocks[0].text+='bad',(s:any)=>s.filing.filing_date='2026-10-09',
  (s:any)=>s.fingerprint=sha('wrong'),(s:any)=>s.documents[0].original+='x',
  (s:any)=>s.blocks[0].id='D1-B0001',(s:any)=>s.blocks.push(s.blocks[0]),(s:any)=>s.blocks=[]]){
  const f=input();mutate(f.source);assert.throws(()=>assertCombinedSource(f.source),/mismatch/);
  const r=validateCombinedResponse(JSON.stringify(f.value),f.source,f.binding);assert.equal(r.os_snapshot.ok,false);assert.equal(r.offering_plan.ok,false);
 }
 for(const patch of [{contractVersion:'old'},{schemaHash:sha('x')},{promptHash:sha('x')},{osContractVersion:'old'},{sourceFingerprint:sha('x')}]){
  const f=input();assert.equal(validateCombinedResponse(JSON.stringify(f.value),f.source,{...f.binding,...patch}).ok,false);
 }
});
test('sequential source blocks retain all text and Unicode; no topic selection',()=>{
 const raw=rawItem();raw.raw_payload.primary_document_html=Array.from({length:120},(_,i)=>`<p>Unselected line ${i} Ω £</p>`).join('');
 const result=buildCombinedSource(raw);assert.equal(result.ok,true);if(!result.ok)return;
 assert.ok(result.source.blocks.length>1);assert.equal(result.source.blocks.map(b=>b.text).join('\n'),result.source.documents[0].text);
 assertCombinedSource(result.source);assert.equal(result.source.documents[0].original,raw.raw_payload.primary_document_html);
});
test('provider exception or invalid output has one call and no repair/retry',async()=>{
 for(const mode of ['throw','bad-json','missing-raw']){let calls=0;const r=await analyzeCombined(rawItem(),{run:async()=>{calls++;if(mode==='throw')throw Error('failed');return (mode==='bad-json'?{raw:'{broken'}:{}) as {raw:string};}});assert.equal(calls,1);assert.equal(r.providerInvocations,1);assert.equal(r.ok,false);}
});
test('F1 retains separate O/S and Offering executions and source contracts',async()=>{
 const raw=rawItem('F-1'),os=osSource(raw),off=offeringSource(raw),ob=osBinding(raw.id,os),fb=offeringBinding(raw.id,off);let osCalls=0,offCalls=0;
 assert.equal(isOsForm('F-1'),true);assert.equal(isCombinedForm('F-1'),false);assert.equal(isOsForm('S-1'),false);
 const osOut={version:'os_snapshot_v1',filing:os.filing,status:'NO_DIRECT_CURRENT_OS',current_os:[],review:null};
 const offOut={version:'offering_plan_v1',filing:off.filing,status:'NO_DIRECT_OFFERING_PLAN',plan:{components:[],over_allotment:[],post_offering_os:[],proceeds:[],atm_terms:[]},review:null};
 function repo(binding:any):Repository{let cp:any;return {select:async()=>({ok:true,data:[raw]}),rpc:async(_name,a)=>{if(a.p_action==='claim')return {ok:true,data:{claimed:true,token:'t',attempt:1,binding}};if(a.p_action==='checkpoint')cp=a.p_value;return {ok:true,data:{status:cp?.status}};}};}
 const response=(v:unknown)=>({raw:JSON.stringify(v),stdout:'',stderr:'',exitCode:0,cliVersion:'mock',startedAt:'',finishedAt:''});
 assert.equal((await processSnapshot(ob.id,{run:async()=>{osCalls++;return response(osOut);}},repo(ob))).status,'NO_DIRECT_CURRENT_OS');
 assert.equal((await processOfferingPlan(fb.id,{run:async()=>{offCalls++;return response(offOut);}},repo(fb))).status,'NO_DIRECT_OFFERING_PLAN');
 assert.equal(osCalls,1);assert.equal(offCalls,1);assert.equal(stable(osSource(raw)),stable(os));assert.equal(stable(offeringSource(raw)),stable(off));
});
test('adapter cannot auto-enqueue or access production provider, DB, Primary or Registry',()=>{
 const code=readFileSync('lib/sec-combined-offering/adapter.ts','utf8');
 assert.doesNotMatch(code,/from ['"].*(supabase|repository|provider\.ts|secIngest|secFilingAnalysis|registry)/);
 assert.doesNotMatch(code,/fetch\(|process\.env|setInterval|\.rpc\(/);
});
