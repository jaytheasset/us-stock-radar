// Explicit synthetic LOCAL browser fixtures; no model, source fetch or backfill.
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {localContext} from './os-local-context.mjs';
import {buildSource,bindingFor} from '../lib/sec-offering-plan/source.ts';
import {processOfferingPlan} from '../lib/sec-offering-plan/runtime.ts';
const out=process.argv[2];if(!out)throw Error('Evidence directory required');const{db}=localContext();await db.connect();
try{
 const repo={async rpc(name,args){try{const keys=Object.keys(args);return{ok:true,data:(await db.query(`select public.${name}(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')}) value`,keys.map(k=>typeof args[k]==='object'&&args[k]!==null?JSON.stringify(args[k]):args[k]))).rows[0].value};}catch(e){return{ok:false,error:e.message};}},async select(){throw Error('Unused');}};
 const ids={};
 for(const[kind,n]of [['PASS',1],['REVIEW_REQUIRED',2],['TECHNICAL_FAILED',3],['VALIDATION_FAILED',4]]){
  const raw={id:randomUUID(),source_code:'sec_edgar',source_unique_id:`0000000001-26-99000${n}`,raw_payload:{accession_number:`0000000001-26-99000${n}`,company_name:'LOCAL SYNTHETIC Offering UI fixture',cik:'0000000001',form_type:n===1?'F-1':'F-1/A',filing_date:`2026-01-0${n}`,file_number:'333-999999999',primary_document_html:'<p>LOCAL SYNTHETIC UI fixture. Issuer offers ordinary shares; terms are blank. Candidate alternatives are test data only.</p>',primary_document_html_truncated:false}};
  await db.query(`insert into public.raw_items(id,source_code,source_group,source_unique_id,title,body_text,analysis_text,raw_payload,metadata,dedupe_key) values($1,'sec_edgar','filings',$2,$3,'','',$4,$5,$6)`,[raw.id,raw.source_unique_id,raw.raw_payload.company_name,raw.raw_payload,{offering_candidate_synthetic_test:true},'offering-ui-fixture:'+raw.id]);
  const source=buildSource(raw),binding=bindingFor(raw.id,source);const r=await repo.rpc('reserve_sec_offering_plan',{p_binding:binding});if(!r.ok)throw Error(r.error);
  const empty={components:[],over_allotment:[],post_offering_os:[],proceeds:[]},c={id:'c1',seller_type:'issuer',security_type:'ordinary_shares',security_label:'Ordinary shares (synthetic)',quantity:{status:'blank',value:null,unit:'shares'},price:{status:'blank',qualification:'not_stated',value:null,low:null,high:null,currency:null,per_unit:null},scenario:null,depositary:null,evidence_blocks:[source.blocks[0].id]},plan={...empty,components:[c]};
  const value={version:'offering_plan_v1',filing:source.filing,status:kind==='REVIEW_REQUIRED'?'REVIEW_REQUIRED':'PASS',plan:kind==='REVIEW_REQUIRED'?empty:plan,review:kind==='REVIEW_REQUIRED'?{code:'unclear_seller',evidence_blocks:[source.blocks[0].id],candidates:[plan,{...plan,components:[{...c,seller_type:'selling_shareholders'}]}]}:null};
  await processOfferingPlan(binding.id,{run:async()=>({raw:kind==='TECHNICAL_FAILED'?'':kind==='VALIDATION_FAILED'?'{synthetic invalid':JSON.stringify(value),stdout:'',stderr:'',exitCode:kind==='TECHNICAL_FAILED'?1:0,cliVersion:'synthetic-no-model',startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),retrySafe:kind==='TECHNICAL_FAILED'})},repo);
  ids[kind]=binding.id;
 }
 writeFileSync(join(out,'ui-fixtures.json'),JSON.stringify({synthetic:true,realGptCalls:0,ids},null,2),{flag:'wx'});console.log(JSON.stringify({syntheticFixtures:4,realGptCalls:0}));
}finally{await db.end();}
