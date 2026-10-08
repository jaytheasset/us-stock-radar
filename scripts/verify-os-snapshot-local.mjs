import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {localContext} from './os-local-context.mjs';
import {bindingFor,buildSource} from '../lib/sec-os-snapshot/source.ts';
import {sha} from '../lib/sec-os-snapshot/contract.ts';
import {enqueueOsSnapshot,readSnapshot} from '../lib/sec-os-snapshot/repository.ts';
import {processSnapshot} from '../lib/sec-os-snapshot/runtime.ts';
const {db,env}=localContext();await db.connect();
const pool=new pg.Pool({connectionString:env.DB_URL,max:4});
const schema='os_snapshot_test_'+Date.now();let count=0;
const sql=readFileSync('supabase/migrations/20261008171255_sec_os_snapshot_v1.sql','utf8').replaceAll('public.',schema+'.').replaceAll('auth.users',schema+'.users');
try {
 await db.query(`create schema ${schema}; create table ${schema}.users(id uuid primary key); create table ${schema}.admin_role_assignments(user_id uuid,active boolean,role text);
 create table ${schema}.raw_items(id uuid primary key,source_code text,source_unique_id text,raw_payload jsonb);
 create table ${schema}.ai_runs(id uuid primary key,raw_item_id uuid,prompt_key text,prompt_version text,model text,status text,metadata jsonb,started_at timestamptz,finished_at timestamptz,created_at timestamptz default now());
 create table ${schema}.ai_outputs(id uuid default gen_random_uuid(),ai_run_id uuid,output_type text,payload jsonb);`);
 await db.query(sql);
 const repo={
  async rpc(name,args){try{const keys=Object.keys(args);const r=await pool.query(`select ${schema}.${name}(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')}) value`,keys.map(k=>typeof args[k]==='object'&&args[k]!==null?JSON.stringify(args[k]):args[k]));return {ok:true,data:r.rows[0].value};}catch(e){return {ok:false,error:e.message};}},
  async select(table,q){try{let s=`select * from ${schema}.${table}`,vals=[],where=[];for(const [k,v]of Object.entries(q)){if(['select','limit','order'].includes(k))continue;vals.push(v.slice(3));where.push(`${k}=$${vals.length}`);}if(where.length)s+=' where '+where.join(' and ');if(q.order)s+=' order by '+q.order.replace('.',' ');return {ok:true,data:(await db.query(s,vals)).rows};}catch(e){return{ok:false,error:e.message};}}
 };
 const source=JSON.parse(gunzipSync(readFileSync('lib/sec-os-snapshot/fixtures/canaan-f1.source.json.gz')).toString());
 const rawId=randomUUID(),filing=source.filing;
 const raw={id:rawId,source_code:'sec_edgar',source_unique_id:filing.accession,raw_payload:{accession_number:filing.accession,form_type:filing.form,company_name:filing.issuer,cik:filing.cik,filing_date:filing.filing_date,primary_document_html:source.documents[0].original,primary_document_html_truncated:false}};
 await db.query(`insert into ${schema}.raw_items values($1,$2,$3,$4)`,[rawId,raw.source_code,raw.source_unique_id,raw.raw_payload]);
 const s=buildSource(raw), binding=bindingFor(rawId,s), actor=randomUUID();await db.query(`insert into ${schema}.users values($1);`,[actor]);await db.query(`insert into ${schema}.admin_role_assignments values($1,true,'operations')`,[actor]);
 const output={version:'os_snapshot_v1',filing:s.filing,status:'PASS',current_os:[{scope:'issuer_total',share_class:null,quantity:'1',as_of_date:null,as_of_text:'synthetic fixture',evidence_blocks:[s.blocks[0].id]}],review:null};
 const result=(value=output)=>({raw:JSON.stringify(value),stdout:'',stderr:'',exitCode:0,cliVersion:'fixture',startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),retrySafe:true});
 const provider={run:async()=>{count++;return result();}};
 const queued=await Promise.all([enqueueOsSnapshot(rawId,repo),enqueueOsSnapshot(rawId,repo)]);assert.equal(queued[0].id,queued[1].id);
 const runs=await Promise.all([processSnapshot(binding.id,provider,repo),processSnapshot(binding.id,provider,repo)]);assert.equal(count,1);assert.ok(runs.some(r=>r.status==='PASS'));
 await processSnapshot(binding.id,provider,repo);await enqueueOsSnapshot(rawId,repo);assert.equal(count,1);
 // Commit succeeds, response is lost: repeated delivery still returns immutable result.
 assert.equal((await readSnapshot(binding.id,repo)).current,true);
 const before=(await db.query(`select payload from ${schema}.ai_outputs where ai_run_id=$1`,[binding.id])).rows[0].payload;
 await assert.rejects(db.query(`update ${schema}.ai_outputs set payload='{}' where ai_run_id=$1`,[binding.id]),/immutable/);
 async function reserve(revision){const b=bindingFor(rawId,s,revision);const r=await repo.rpc('reserve_sec_os_snapshot',{p_binding:b});assert.equal(r.ok,true,r.error);return b;}
 const loss=await reserve('loss');let lost=false;
 const lossRepo={...repo,rpc:async(name,args)=>{const r=await repo.rpc(name,args);if(args.p_action==='finish'&&!lost){lost=true;throw Error('response_lost_after_commit');}return r;}};
 await assert.rejects(processSnapshot(loss.id,provider,lossRepo),/response_lost/);const previous=count;await processSnapshot(loss.id,provider,repo);assert.equal(count,previous);
 // Expired claim without provider invocation can be recovered; checkpoint recovers without provider.
 const recovery=await reserve('recovery');await repo.rpc('sec_os_snapshot_transition',{p_id:recovery.id,p_action:'claim'});
 await db.query(`update ${schema}.ai_runs set metadata=metadata||jsonb_build_object('leaseUntil',now()-interval '1 second') where id=$1`,[recovery.id]);
 await processSnapshot(recovery.id,provider,repo);assert.equal(count,previous+1);
 const cp=await reserve('checkpoint');const claimed=await repo.rpc('sec_os_snapshot_transition',{p_id:cp.id,p_action:'claim'});
 await repo.rpc('sec_os_snapshot_transition',{p_id:cp.id,p_action:'checkpoint',p_token:claimed.data.token,p_value:before});
 await db.query(`update ${schema}.ai_runs set metadata=metadata||jsonb_build_object('leaseUntil',now()-interval '1 second') where id=$1`,[cp.id]);
 await processSnapshot(cp.id,{run:async()=>{throw Error('must_not_call')}},repo);
 // DB invocation intent remains bound to the original host journal after a crash.
 const intent=await reserve('invocation-intent');const intentClaim=await repo.rpc('sec_os_snapshot_transition',{p_id:intent.id,p_action:'claim'});
 const permit=await repo.rpc('sec_os_snapshot_transition',{p_id:intent.id,p_action:'provider_started',p_token:intentClaim.data.token,p_value:{journalId:'original-journal'}});
 assert.equal(permit.data.recoverOnly,false);
 const expire=()=>db.query(`update ${schema}.ai_runs set metadata=metadata||jsonb_build_object('leaseUntil',now()-interval '1 second') where id=$1`,[intent.id]);
 await expire();let recoveryCalls=0;
 await assert.rejects(processSnapshot(intent.id,{journalId:'different-journal',run:async()=>{recoveryCalls++;return result();}},repo),/journal_location_changed/);
 assert.equal(recoveryCalls,0);await expire();
 await processSnapshot(intent.id,{journalId:'original-journal',run:async(_binding,_attempt,recoverOnly)=>{assert.equal(recoverOnly,true);return result();}},repo);
 const review=await reserve('review');await processSnapshot(review.id,{run:async()=>result({...output,status:'REVIEW_REQUIRED',current_os:[],review:{code:'AMBIGUOUS_CURRENT_SCOPE',candidates:output.current_os}})},repo);
 const reviewBefore=(await db.query(`select payload from ${schema}.ai_outputs where ai_run_id=$1`,[review.id])).rows[0].payload;
 for(const action of ['approve','hold','reject']){const d=await repo.rpc('decide_sec_os_snapshot',{p_id:review.id,p_actor:actor,p_action:action,p_indexes:action==='approve'?[0]:[],p_reason:'fixture decision',p_request:randomUUID()});assert.equal(d.ok,true,d.error);}
 assert.deepEqual((await db.query(`select payload from ${schema}.ai_outputs where ai_run_id=$1`,[review.id])).rows[0].payload,reviewBefore);
 const retry=(id)=>repo.rpc('decide_sec_os_snapshot',{p_id:id,p_actor:actor,p_action:'retry',p_indexes:[],p_reason:'fixture retry',p_request:randomUUID()});
 assert.equal((await retry(review.id)).ok,false);
 const invalid=await reserve('invalid');assert.equal((await processSnapshot(invalid.id,{run:async()=>({...result(),raw:'{broken'})},repo)).status,'VALIDATION_FAILED');assert.equal((await retry(invalid.id)).ok,false);
 const none=await reserve('no-direct');assert.equal((await processSnapshot(none.id,{run:async()=>result({...output,status:'NO_DIRECT_CURRENT_OS',current_os:[]})},repo)).status,'NO_DIRECT_CURRENT_OS');assert.equal((await retry(none.id)).ok,false);
 const tech=await reserve('technical');await processSnapshot(tech.id,{run:async()=>({...result(),raw:'',exitCode:1,technicalError:'timeout'})},repo);assert.equal((await retry(tech.id)).ok,true);
 await processSnapshot(tech.id,provider,repo);assert.equal((await retry(tech.id)).ok,false);
 raw.raw_payload.primary_document_html+='\n<!-- new source -->';await db.query(`update ${schema}.raw_items set raw_payload=$2 where id=$1`,[rawId,raw.raw_payload]);
 const newer=await enqueueOsSnapshot(rawId,repo);assert.notEqual(newer.id,binding.id);assert.equal((await readSnapshot(binding.id,repo)).current,false);
 assert.deepEqual((await db.query(`select payload from ${schema}.ai_outputs where ai_run_id=$1`,[binding.id])).rows[0].payload,before);
 console.log(JSON.stringify({passed:true,isolatedSchema:schema,providerCalls:count,realCodexCalls:0,checks:['enqueue','concurrent claim','terminal reuse','lost response','expired lease','checkpoint restart','invocation intent','journal binding','revision','fingerprint','immutability','review decisions','no-direct','validation','technical-only retry','stale source']}));
} finally {
 // Only the exact test-owned schema can be removed.
 await pool.end();if(!/^os_snapshot_test_[0-9]+$/.test(schema))throw Error('unsafe schema');await db.query(`drop schema ${schema} cascade`);await db.end();
}
