// Explicit candidate-owned Supabase only; creates clearly labelled local fixture rows.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import pg from 'pg';
import {buildCombinedSource} from '../lib/sec-combined-offering/source.ts';
import {durableBinding,enqueueCombinedOffering} from '../lib/sec-combined-offering/repository.ts';
import {processCombinedOffering} from '../lib/sec-combined-offering/runtime.ts';
import {combinedProvider} from '../lib/sec-combined-offering/provider.ts';
import {REVISION} from '../lib/sec-combined-offering/contract.ts';
import {readOfferingPlan} from '../lib/sec-offering-plan/repository.ts';
import {readSnapshot} from '../lib/sec-os-snapshot/repository.ts';
import {sha} from '../lib/sec-os-snapshot/contract.ts';
import {prepare,refreshProjected} from '../lib/projected-offering-dilution/repository.ts';
const workdir=process.argv[2];if(!workdir)throw Error('Explicit candidate Supabase directory required');
assert.match(readFileSync(join(workdir,'supabase/config.toml'),'utf8'),/project_id = "projected-auth-e2e-1f6c"/);
const local=JSON.parse(execFileSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','--workdir',workdir,'-o','json'],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','ignore']}));
assert.equal(local.API_URL,'http://127.0.0.1:56461');const u=new URL(local.DB_URL);assert.equal(u.port,'56462');assert.ok(['127.0.0.1','localhost'].includes(u.hostname));
const db=new pg.Client({connectionString:local.DB_URL,application_name:'combined-isolated-1f6c'});await db.connect();
const headers={apikey:local.SERVICE_ROLE_KEY,Authorization:'Bearer '+local.SERVICE_ROLE_KEY,'Content-Type':'application/json'};
const request=async(url,options)=>{const r=await fetch(local.API_URL+'/rest/v1/'+url,{headers,...options});const data=await r.json();return {ok:r.ok,data,error:r.ok?undefined:JSON.stringify(data)};};
const repo={select:(t,q)=>request(t+'?'+new URLSearchParams(q)),rpc:(n,args)=>request('rpc/'+n,{method:'POST',body:JSON.stringify(args)})};
const evidence=mkdtempSync(join(tmpdir(),'combined-durable-1f6c-')),ids=[];let calls=0;
async function fixture(mode){
 const sequence=(await db.query("select coalesce(max(right(source_unique_id,6)::int),810000)+1 n from raw_items where source_code='sec_edgar' and source_unique_id like '0000000042-26-%' and metadata->>'verification'='combined-durable-1f6c'")).rows[0].n;
 const id=randomUUID(),accession='0000000042-26-'+String(sequence).padStart(6,'0');
 const raw={id,source_code:'sec_edgar',source_group:'filings',source_unique_id:accession,raw_payload:{company_name:'LOCAL ONLY combined '+mode,cik:'0000000042',accession_number:accession,form_type:'S-1',filing_date:'2026-10-10',primary_document_html:'<p>LOCAL ONLY: common stock 100 outstanding as of October 1, 2026. Issuer offers 20 shares; shareholder resells 5. Ω</p>',primary_document_html_truncated:false}};
 await db.query('insert into public.raw_items(id,source_code,source_group,source_unique_id,raw_payload,metadata) values($1,$2,$3,$4,$5,$6)',[id,raw.source_code,raw.source_group,accession,raw.raw_payload,{localOnly:true,verification:'combined-durable-1f6c'}]);
 ids.push(id);const built=buildCombinedSource(raw);assert.equal(built.ok,true);const b=durableBinding(id,built.source),refs=[built.source.blocks[0].id];
 const price={status:'not_stated',qualification:'not_stated',value:null,low:null,high:null,currency:null,per_unit:null};
 const value={version:REVISION,filing:built.source.filing,os_snapshot:{status:'PASS',current_os:[{scope:'class',share_class:'common stock',quantity:'100',as_of_date:'2026-10-01',as_of_text:'as of October 1, 2026',evidence_blocks:refs}],review:null},
 offering_plan:{status:'PASS',plan:{components:[{id:'c1',seller_type:'issuer',security_type:'common_stock',security_label:'common stock',quantity:{status:'stated',value:'20',unit:'shares'},price,scenario:null,depositary:null,evidence_blocks:refs},{id:'c2',seller_type:'selling_shareholders',security_type:'common_stock',security_label:'common stock',quantity:{status:'stated',value:'5',unit:'shares'},price,scenario:null,depositary:null,evidence_blocks:refs}],over_allotment:[],post_offering_os:[],proceeds:[],atm_terms:[]},review:null}};
 const queue=await enqueueCombinedOffering(id,repo);assert.equal(queue.id,b.id,JSON.stringify(queue));return {raw,b,value};
}
function provider(raw){return combinedProvider({executable:process.execPath,root:evidence,runner:async(_e,_a,o)=>{calls++;await o.onPid(2147483647);writeFileSync(join(o.cwd,'cli-final-output.json'),raw);return {stdout:'',stderr:'',exitCode:0};}});}
try{
 const f=await fixture('positive'),raw=JSON.stringify(f.value),p=provider(raw);
 const reservation=await Promise.all([enqueueCombinedOffering(f.raw.id,repo),enqueueCombinedOffering(f.raw.id,repo)]);assert.ok(reservation.every(r=>r.id===f.b.id&&r.inserted===false));
 const processed=await processCombinedOffering(f.b.id,p,repo);assert.equal(processed.status,'COMPLETE');assert.equal(calls,1);
 for(let i=0;i<3;i++)await processCombinedOffering(f.b.id,p,repo);assert.equal(calls,1);
 const offered=await readOfferingPlan(f.b.offeringRunId,repo),os=await readSnapshot(f.b.osRunId,repo);
 assert.equal(offered.sourceError,null);assert.equal(os.current,true);assert.equal(offered.commonInvocation.id,f.b.id);
 assert.deepEqual(offered.run.metadata.offeringCheckpoint.validated.plan,f.value.offering_plan.plan);
 assert.equal(offered.run.metadata.executionKind,'derived_domain_view');assert.equal(offered.run.model,'derived-domain-view');
 const prepared=await prepare(f.raw.id,repo);assert.ok(prepared);
 assert.equal(prepared.fact.issuer_new_shares_base,20);assert.equal(prepared.fact.resale_shares,5);
 assert.equal(prepared.fact.calculated_post_os_base,120);assert.equal(prepared.fact.projected_increase_percent_base,20);
 for(let n=0;n<3;n++)assert.equal((await refreshProjected(f.raw.id,repo)).id,prepared.id);
 assert.equal((await db.query('select count(*)::int n from projected_offering_dilution_facts where raw_item_id=$1',[f.raw.id])).rows[0].n,1);
 for(const patch of [{osRunId:f.b.offeringRunId},{providerProfile:'other'},{documents:null},{filing:null}]){
  const invalid=await repo.rpc('reserve_sec_combined_offering',{p_binding:{...f.b,...patch}});assert.equal(invalid.ok,false);
 }
 const rows=(await db.query('select * from ai_outputs where ai_run_id=any($1::uuid[])',[[f.b.id,f.b.osRunId,f.b.offeringRunId]])).rows;
 assert.equal(rows.length,3);assert.equal(rows.filter(r=>r.payload.raw).length,1);assert.equal(rows.find(r=>r.ai_run_id===f.b.id).payload.rawHash,sha(raw));
 for(const r of rows)await assert.rejects(db.query("update ai_outputs set payload='{}' where id=$1",[r.id]),/immutable/);
 const partial=await fixture('one-invalid');partial.value.os_snapshot.current_os[0].quantity='bad';
 await processCombinedOffering(partial.b.id,provider(JSON.stringify(partial.value)),repo);
 assert.equal((await readSnapshot(partial.b.osRunId,repo)).run.metadata.osStatus,'VALIDATION_FAILED');
 assert.equal((await readOfferingPlan(partial.b.offeringRunId,repo)).run.metadata.offeringStatus,'PASS');
 assert.equal(await prepare(partial.raw.id,repo),null);
 const lost=await fixture('lost-response');let lostOnce=false;const lossy={...repo,rpc:async(n,a)=>{const r=await repo.rpc(n,a);if(a.p_action==='finish'&&!lostOnce){lostOnce=true;throw Error('lost_response');}return r;}};
 await assert.rejects(processCombinedOffering(lost.b.id,provider(JSON.stringify(lost.value)),lossy),/lost_response/);const after=calls;
 await processCombinedOffering(lost.b.id,provider(JSON.stringify(lost.value)),repo);assert.equal(calls,after);
 const uncertain=await fixture('uncertain');const claimed=await repo.rpc('sec_combined_offering_transition',{p_id:uncertain.b.id,p_action:'claim'});assert.equal(claimed.ok,true);
 await repo.rpc('sec_combined_offering_transition',{p_id:uncertain.b.id,p_action:'provider_started',p_token:claimed.data.token,p_value:{journalId:p.journalId}});
 await db.query("update ai_runs set metadata=metadata||jsonb_build_object('leaseUntil',now()-interval '1 second') where id=$1",[uncertain.b.id]);
 await assert.rejects(processCombinedOffering(uncertain.b.id,provider(JSON.stringify(uncertain.value)),repo),/missing_journal/);assert.equal(calls,after);
 // Stop the test-owned lease, preserving the unresolved invocation and forbidding automatic recall.
 await db.query("update ai_runs set metadata=metadata||jsonb_build_object('leaseUntil',now()-interval '1 second') where id=$1",[uncertain.b.id]);
 const stale=await fixture('stale');await db.query("update raw_items set raw_payload=raw_payload||jsonb_build_object('primary_document_html','changed source') where id=$1",[stale.raw.id]);
 assert.equal((await processCombinedOffering(stale.b.id,provider(JSON.stringify(stale.value)),repo)).status,'TECHNICAL_FAILED');assert.equal(calls,after);
 // New parent wins even while queued; no fallback to an older successful domain pair.
 await db.query("update raw_items set raw_payload=raw_payload||jsonb_build_object('primary_document_html',raw_payload->>'primary_document_html'||'<p>new source revision</p>') where id=$1",[lost.raw.id]);
 await enqueueCombinedOffering(lost.raw.id,repo);assert.equal(await prepare(lost.raw.id,repo),null);
 const staleRead=await readSnapshot(lost.b.osRunId,repo);assert.equal(staleRead.current,false);
 for(const role of ['anon','authenticated'])assert.equal((await db.query("select has_function_privilege($1,'public.sec_combined_offering_transition(uuid,text,text,jsonb)','EXECUTE') allowed",[role])).rows[0].allowed,false);
 const report={passed:true,dbPort:56462,rawIds:ids,positive:f.b,projected:prepared.fact,providerMockCalls:calls,realGptCalls:0,unchangedRawHash:sha(raw),checks:['compact reserve','invalid descriptor rejection','replay','single invocation','parent and domain provenance','domain isolation','readback','immutable output','lost response','uncertain journal no recall','source mismatch before invocation','private RPCs','common_stock 100+20=120; resale 5; increase 20%','fact revision and replay','latest parent no fallback'],evidence};
 writeFileSync(join(evidence,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await db.end();}
