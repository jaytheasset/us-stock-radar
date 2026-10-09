import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {localContext} from './os-local-context.mjs';
import {bindingFor,buildSource,compactBinding} from '../lib/sec-offering-plan/source.ts';
import {sha} from '../lib/sec-offering-plan/contract.ts';
import {enqueueOfferingPlan,readOfferingPlan} from '../lib/sec-offering-plan/repository.ts';
import {processOfferingPlan} from '../lib/sec-offering-plan/runtime.ts';
const {db,env}=localContext();await db.connect();
const pool=new pg.Pool({connectionString:env.DB_URL,max:4});
const schema='offering_plan_test_'+Date.now();let count=0;
const sql=readFileSync('supabase/migrations/20261008211452_sec_offering_plan_v1.sql','utf8').replaceAll('public.',schema+'.').replaceAll('auth.users',schema+'.users');
try {
 await db.query(`create schema ${schema}; create table ${schema}.users(id uuid primary key); create table ${schema}.admin_role_assignments(user_id uuid,active boolean,role text);
 create table ${schema}.raw_items(id uuid primary key,source_code text,source_unique_id text,raw_payload jsonb);
 create table ${schema}.ai_runs(id uuid primary key,raw_item_id uuid,prompt_key text,prompt_version text,model text,status text,metadata jsonb,started_at timestamptz,finished_at timestamptz,created_at timestamptz default now());
 create table ${schema}.ai_outputs(id uuid default gen_random_uuid(),ai_run_id uuid,output_type text,payload jsonb);`);
 await db.query(readFileSync('supabase/migrations/20261008171255_sec_os_snapshot_v1.sql','utf8').replaceAll('public.',schema+'.').replaceAll('auth.users',schema+'.users'));
 await db.query(sql);
 const repo={
  async rpc(name,args){try{const keys=Object.keys(args);const r=await pool.query(`select ${schema}.${name}(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')}) value`,keys.map(k=>typeof args[k]==='object'&&args[k]!==null?JSON.stringify(args[k]):args[k]));return {ok:true,data:r.rows[0].value};}catch(e){return {ok:false,error:e.message};}},
  async select(table,q){try{const expr=x=>x.replace(/(->>?)([a-zA-Z]+)/g,"$1'$2'");const fields=q.select==='*'?'*':q.select.split(',').map(x=>x.includes(':')?expr(x.split(':')[1])+' as "'+x.split(':')[0]+'"':expr(x)).join(',');let s=`select ${fields} from ${schema}.${table}`,vals=[],where=[];for(const [k,v]of Object.entries(q)){if(['select','limit','order'].includes(k))continue;vals.push(v.slice(3));where.push(`${expr(k)}=$${vals.length}`);}if(where.length)s+=' where '+where.join(' and ');if(q.order)s+=' order by '+expr(q.order.replace('.',' '));return {ok:true,data:(await db.query(s,vals)).rows};}catch(e){return{ok:false,error:e.message};}}
 };
 const source=JSON.parse(gunzipSync(readFileSync('lib/sec-os-snapshot/fixtures/canaan-f1.source.json.gz')).toString());
 const rawId=randomUUID(),filing=source.filing;
 const raw={id:rawId,source_code:'sec_edgar',source_unique_id:filing.accession,raw_payload:{accession_number:filing.accession,form_type:filing.form,company_name:filing.issuer,cik:filing.cik,filing_date:filing.filing_date,file_number:'333-123456',primary_document_html:source.documents[0].original,primary_document_html_truncated:false}};
 await db.query(`insert into ${schema}.raw_items values($1,$2,$3,$4)`,[rawId,raw.source_code,raw.source_unique_id,raw.raw_payload]);
 const s=buildSource(raw), binding=bindingFor(rawId,s), actor=randomUUID();await db.query(`insert into ${schema}.users values($1);`,[actor]);await db.query(`insert into ${schema}.admin_role_assignments values($1,true,'operations')`,[actor]);
 const component={id:'c1',seller_type:'issuer',security_type:'ordinary_shares',security_label:'Ordinary shares',quantity:{status:'blank',value:null,unit:'shares'},price:{status:'blank',qualification:'not_stated',value:null,low:null,high:null,currency:'USD',per_unit:'share'},scenario:null,depositary:null,evidence_blocks:[s.blocks[0].id]};
 const empty={components:[],over_allotment:[],post_offering_os:[],proceeds:[]};
 const output={version:'offering_plan_v1',filing:s.filing,status:'PASS',plan:{...empty,components:[component]},review:null};
 const result=(value=output)=>({raw:JSON.stringify(value),stdout:'',stderr:'',exitCode:0,cliVersion:'fixture',startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),retrySafe:true});
 const provider={run:async()=>{count++;return result();}};
 const legacy=bindingFor(rawId,s,'legacy-full');assert.equal((await repo.rpc('reserve_sec_offering_plan',{p_binding:legacy})).ok,true);
 const legacyBefore=(await db.query(`select metadata from ${schema}.ai_runs where id=$1`,[legacy.id])).rows[0].metadata;
 await db.query(readFileSync('supabase/migrations/20261009072629_sec_offering_compact_binding.sql','utf8').replaceAll('public.',schema+'.'));
 for(const b of [legacy,compactBinding(legacy)])assert.equal((await repo.rpc('reserve_sec_offering_plan',{p_binding:b})).data.inserted,false);
 assert.deepEqual((await db.query(`select metadata from ${schema}.ai_runs where id=$1`,[legacy.id])).rows[0].metadata,legacyBefore);
 assert.equal((await readOfferingPlan(legacy.id,repo)).source.fingerprint,s.fingerprint);
 await processOfferingPlan(legacy.id,{run:async()=>result()},repo);
 const queued=await Promise.all([enqueueOfferingPlan(rawId,repo),enqueueOfferingPlan(rawId,repo)]);assert.equal(queued[0].id,queued[1].id);
 const savedBinding=(await db.query(`select metadata->'binding' b from ${schema}.ai_runs where id=$1`,[binding.id])).rows[0].b;assert.deepEqual(savedBinding,compactBinding(binding));assert.equal('source' in savedBinding,false);assert.equal('original' in savedBinding.documents[0],false);assert.ok(Buffer.byteLength(JSON.stringify(savedBinding))<2000);
 const badFamily=compactBinding(bindingFor(rawId,s,'spoofed-family'));badFamily.family={status:'confirmed',key:'0000000001:333-999999',number:'333-999999'};assert.equal((await repo.rpc('reserve_sec_offering_plan',{p_binding:badFamily})).ok,false);
 for(const extra of [{source:s},{blocks:s.blocks},{documents:s.documents}])assert.equal((await repo.rpc('reserve_sec_offering_plan',{p_binding:{...compactBinding(bindingFor(rawId,s,'oversized')), ...extra}})).ok,false);
 const runs=await Promise.all([processOfferingPlan(binding.id,provider,repo),processOfferingPlan(binding.id,provider,repo)]);assert.equal(count,1);assert.ok(runs.some(r=>r.status==='PASS'));
 await processOfferingPlan(binding.id,provider,repo);await enqueueOfferingPlan(rawId,repo);assert.equal(count,1);
 // Commit succeeds, response is lost: repeated delivery still returns immutable result.

 const before=(await db.query(`select payload from ${schema}.ai_outputs where ai_run_id=$1`,[binding.id])).rows[0].payload;
 await assert.rejects(db.query(`update ${schema}.ai_outputs set payload='{}' where ai_run_id=$1`,[binding.id]),/immutable/);
 async function reserve(revision){const b=bindingFor(rawId,s,revision);const r=await repo.rpc('reserve_sec_offering_plan',{p_binding:compactBinding(b)});assert.equal(r.ok,true,r.error);return b;}
 const loss=await reserve('loss');let lost=false;
 const lossRepo={...repo,rpc:async(name,args)=>{const r=await repo.rpc(name,args);if(args.p_action==='finish'&&!lost){lost=true;throw Error('response_lost_after_commit');}return r;}};
 await assert.rejects(processOfferingPlan(loss.id,provider,lossRepo),/response_lost/);const previous=count;await processOfferingPlan(loss.id,provider,repo);assert.equal(count,previous);
 // Expired claim without provider invocation can be recovered; checkpoint recovers without provider.
 const recovery=await reserve('recovery');await repo.rpc('sec_offering_plan_transition',{p_id:recovery.id,p_action:'claim'});
 await db.query(`update ${schema}.ai_runs set metadata=metadata||jsonb_build_object('leaseUntil',now()-interval '1 second') where id=$1`,[recovery.id]);
 await processOfferingPlan(recovery.id,provider,repo);assert.equal(count,previous+1);
 const cp=await reserve('checkpoint');const claimed=await repo.rpc('sec_offering_plan_transition',{p_id:cp.id,p_action:'claim'});
 await repo.rpc('sec_offering_plan_transition',{p_id:cp.id,p_action:'checkpoint',p_token:claimed.data.token,p_value:before});
 await db.query(`update ${schema}.ai_runs set metadata=metadata||jsonb_build_object('leaseUntil',now()-interval '1 second') where id=$1`,[cp.id]);
 await processOfferingPlan(cp.id,{run:async()=>{throw Error('must_not_call')}},repo);
 // DB invocation intent remains bound to the original host journal after a crash.
 const intent=await reserve('invocation-intent');const intentClaim=await repo.rpc('sec_offering_plan_transition',{p_id:intent.id,p_action:'claim'});
 const permit=await repo.rpc('sec_offering_plan_transition',{p_id:intent.id,p_action:'provider_started',p_token:intentClaim.data.token,p_value:{journalId:'original-journal'}});
 assert.equal(permit.data.recoverOnly,false);
 const expire=()=>db.query(`update ${schema}.ai_runs set metadata=metadata||jsonb_build_object('leaseUntil',now()-interval '1 second') where id=$1`,[intent.id]);
 await expire();let recoveryCalls=0;
 await assert.rejects(processOfferingPlan(intent.id,{journalId:'different-journal',run:async()=>{recoveryCalls++;return result();}},repo),/journal_location_changed/);
 assert.equal(recoveryCalls,0);await expire();
 await processOfferingPlan(intent.id,{journalId:'original-journal',run:async(_binding,_attempt,recoverOnly)=>{assert.equal(recoverOnly,true);return result();}},repo);
 const review=await reserve('review');await processOfferingPlan(review.id,{run:async()=>result({...output,status:'REVIEW_REQUIRED',plan:empty,review:{code:'unclear_seller',evidence_blocks:[s.blocks[0].id],candidates:[output.plan]}})},repo);
 const reviewBefore=(await db.query(`select payload from ${schema}.ai_outputs where ai_run_id=$1`,[review.id])).rows[0].payload;
 for(const action of ['approve','hold','reject']){const d=await repo.rpc('decide_sec_offering_plan',{p_id:review.id,p_actor:actor,p_action:action,p_indexes:action==='approve'?[0]:[],p_reason:'fixture decision',p_request:randomUUID()});assert.equal(d.ok,true,d.error);}
 const replayDecision={p_id:review.id,p_actor:actor,p_action:'approve',p_indexes:[0],p_reason:'idempotent decision',p_request:randomUUID()};assert.equal((await repo.rpc('decide_sec_offering_plan',replayDecision)).ok,true);assert.equal((await repo.rpc('decide_sec_offering_plan',replayDecision)).data.replayed,true);
 assert.equal((await repo.rpc('decide_sec_offering_plan',{...replayDecision,p_actor:randomUUID(),p_request:randomUUID()})).ok,false);
 assert.equal((await repo.rpc('decide_sec_offering_plan',{...replayDecision,p_indexes:[0,0],p_request:randomUUID()})).ok,false);
 assert.deepEqual((await db.query(`select payload from ${schema}.ai_outputs where ai_run_id=$1`,[review.id])).rows[0].payload,reviewBefore);
 const retry=(id)=>repo.rpc('decide_sec_offering_plan',{p_id:id,p_actor:actor,p_action:'retry',p_indexes:[],p_reason:'fixture retry',p_request:randomUUID()});
 assert.equal((await retry(review.id)).ok,false);
 const invalid=await reserve('invalid');assert.equal((await processOfferingPlan(invalid.id,{run:async()=>({...result(),raw:'{broken'})},repo)).status,'VALIDATION_FAILED');assert.equal((await retry(invalid.id)).ok,false);
 const none=await reserve('no-direct');assert.equal((await processOfferingPlan(none.id,{run:async()=>result({...output,status:'NO_DIRECT_OFFERING_PLAN',plan:empty})},repo)).status,'NO_DIRECT_OFFERING_PLAN');assert.equal((await retry(none.id)).ok,false);
 const bytes=await reserve('invalid-utf8');const rawBytesBase64=Buffer.from([0xff,0xfe]).toString('base64');assert.equal((await processOfferingPlan(bytes.id,{run:async()=>({...result(),raw:'',rawBytesBase64,integrityError:'invalid_utf8'})},repo)).status,'VALIDATION_FAILED');assert.equal((await retry(bytes.id)).ok,false);assert.equal((await db.query(`select payload->'provider'->>'rawBytesBase64' bytes from ${schema}.ai_outputs where ai_run_id=$1`,[bytes.id])).rows[0].bytes,rawBytesBase64);
 const tech=await reserve('technical');await processOfferingPlan(tech.id,{run:async()=>({...result(),raw:'',exitCode:1,technicalError:'timeout'})},repo);assert.equal((await retry(tech.id)).ok,true);
 await processOfferingPlan(tech.id,provider,repo);assert.equal((await retry(tech.id)).ok,false);
 for(const damage of ['changed','missing','fingerprint']){
  const b=compactBinding(bindingFor(rawId,s,'source-'+damage));if(damage==='fingerprint')b.sourceFingerprint=sha('wrong');
  assert.equal((await repo.rpc('reserve_sec_offering_plan',{p_binding:b})).ok,true);
  const changed=structuredClone(raw.raw_payload);if(damage==='changed')changed.primary_document_html+='<!-- altered -->';if(damage==='missing')delete changed.primary_document_html;
  await db.query(`update ${schema}.raw_items set raw_payload=$2 where id=$1`,[rawId,changed]);
  let invocations=0;assert.equal((await processOfferingPlan(b.id,{run:async()=>{invocations++;return result();}},repo)).status,'TECHNICAL_FAILED');assert.equal(invocations,0);
  const m=(await db.query(`select metadata from ${schema}.ai_runs where id=$1`,[b.id])).rows[0].metadata;assert.equal(m.invocationAttempt,undefined);assert.equal(m.offeringCheckpoint.validation.stage,'pre_provider_source');assert.equal((await retry(b.id)).ok,false);
  const read=await readOfferingPlan(b.id,repo);assert.equal(read.source,null);assert.equal(read.sourceError,'source_unavailable_or_mismatch');
  await db.query(`update ${schema}.raw_items set raw_payload=$2 where id=$1`,[rawId,raw.raw_payload]);
 }
 assert.equal((await readOfferingPlan(binding.id,repo)).source.fingerprint,s.fingerprint);
 // Optional retained full filings remain outside Git; enqueue them only in this isolated schema.
 if(process.env.OFFERING_LARGE_CASES){
  const cases=JSON.parse(readFileSync(process.env.OFFERING_LARGE_CASES,'utf8')).cases;
  for(const c of cases.filter(c=>['arm-f1a','birkenstock-f1','birkenstock-f1a'].includes(c.id))){
   const id=randomUUID(),f=c.filing,original=readFileSync(c.dir+'/source.html','utf8');assert.equal(sha(original),c.originalSha256);
   const p={accession_number:f.accession,form_type:f.form,company_name:f.issuer,cik:f.cik,filing_date:f.filing_date,accepted_at:f.accepted_at,file_number:f.file_number,registration_number:f.registration_number,primary_document_url:c.url,primary_document_html:original,primary_document_html_truncated:false};
   await db.query(`insert into ${schema}.raw_items values($1,'sec_edgar',$2,$3)`,[id,f.accession,p]);
   let requestBytes=0;const wrapped={...repo,rpc:async(name,args)=>{requestBytes=Buffer.byteLength(JSON.stringify(args));assert.equal('source' in args.p_binding,false);return repo.rpc(name,args);}};
   const t=performance.now(),r=await enqueueOfferingPlan(id,wrapped),elapsedMs=performance.now()-t;assert.equal(r.inserted,true);assert.ok(requestBytes<2000);
   const m=(await db.query(`select metadata->'binding' b from ${schema}.ai_runs where id=$1`,[r.id])).rows[0].b;assert.equal('source' in m,false);assert.equal('blocks' in m,false);assert.equal('original' in m.documents[0],false);
   assert.equal((await enqueueOfferingPlan(id,repo)).id,r.id);assert.equal((await readOfferingPlan(r.id,repo)).source.documents[0].original_sha256,c.originalSha256);
   console.log(JSON.stringify({largeSource:c.id,originalBytes:Buffer.byteLength(original),requestBytes,elapsedMs,realGptCalls:0}));
  }
 }
 raw.raw_payload.primary_document_html+='\n<!-- new source -->';await db.query(`update ${schema}.raw_items set raw_payload=$2 where id=$1`,[rawId,raw.raw_payload]);
 const newer=await enqueueOfferingPlan(rawId,repo);assert.notEqual(newer.id,binding.id);
 assert.deepEqual((await db.query(`select payload from ${schema}.ai_outputs where ai_run_id=$1`,[binding.id])).rows[0].payload,before);
 // Shared DB lease prevents both domains from claiming together, even through unchanged O/S RPC.
 assert.equal((await readOfferingPlan(binding.id,repo)).source,null);
 const cross=bindingFor(rawId,buildSource(raw),'cross-lock');assert.equal((await repo.rpc('reserve_sec_offering_plan',{p_binding:compactBinding(cross)})).ok,true);await repo.rpc('sec_offering_plan_transition',{p_id:cross.id,p_action:'claim'});
 const osId=randomUUID();await db.query(`insert into ${schema}.ai_runs(id,prompt_key,status,metadata) values($1,'sec_os_snapshot','pending',$2)`,[osId,{osStatus:'QUEUED'}]);
 assert.equal((await repo.rpc('sec_os_snapshot_transition',{p_id:osId,p_action:'claim'})).ok,false);
 await db.query(`update ${schema}.ai_runs set metadata=metadata||jsonb_build_object('leaseUntil',now()-interval '1 second') where id=$1`,[cross.id]);
 assert.equal((await repo.rpc('sec_os_snapshot_transition',{p_id:osId,p_action:'claim'})).data.claimed,true);
 assert.equal((await repo.rpc('sec_offering_plan_transition',{p_id:cross.id,p_action:'claim'})).ok,false);
 // Read-only credentials cannot execute RPCs or read private decisions; AI payload remains immutable.
 for(const role of ['anon','authenticated']){
  assert.equal((await db.query(`select has_function_privilege($1,'${schema}.reserve_sec_offering_plan(jsonb)','EXECUTE') allowed`,[role])).rows[0].allowed,false);
  assert.equal((await db.query(`select has_table_privilege($1,'${schema}.sec_offering_plan_decisions','SELECT') allowed`,[role])).rows[0].allowed,false);
 }
 await assert.rejects(db.query(`update ${schema}.sec_offering_plan_decisions set reason='changed'`),/immutable/);
 await assert.rejects(db.query(`delete from ${schema}.ai_runs where id=$1`,[binding.id]),/immutable/);
 console.log(JSON.stringify({passed:true,isolatedSchema:schema,providerCalls:count,realCodexCalls:0,checks:['enqueue','concurrent claim','terminal reuse','lost response','expired lease','checkpoint restart','invocation intent','journal binding','revision','fingerprint','immutability','review decisions','no-direct','validation','technical-only retry','stale source']}));
} finally {
 // Only the exact test-owned schema can be removed.
 await pool.end();if(!/^offering_plan_test_[0-9]+$/.test(schema))throw Error('unsafe schema');await db.query(`drop schema ${schema} cascade`);await db.end();
}
