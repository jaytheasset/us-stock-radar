import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {localContext} from './os-local-context.mjs';
import {buildSource as osSource,bindingFor as osBinding} from '../lib/sec-os-snapshot/source.ts';
import {buildSource as offSource,bindingFor as offBinding,compactBinding} from '../lib/sec-offering-plan/source.ts';
import {prepare,refreshProjected,readProjectedFacts} from '../lib/projected-offering-dilution/repository.ts';
const isolated=process.env.PROJECTED_TEST_DB_URL;
if(isolated){const u=new URL(isolated);if(u.hostname!=='127.0.0.1'||u.port!=='56439'||u.pathname!=='/stock_radar_projected_test')throw Error('Unexpected isolated DB');}
const {db,env}=isolated?{db:new pg.Client({connectionString:isolated}),env:{DB_URL:isolated}}:localContext();await db.connect();const pool=new pg.Pool({connectionString:env.DB_URL,max:6});
const schema='projected_test_'+Date.now(), rawId=randomUUID(),actor=randomUUID(),eventId=randomUUID(),monitorId=randomUUID();
const sql=readFileSync('supabase/migrations/20261009104931_projected_offering_dilution_v1.sql','utf8').replaceAll('public.',schema+'.');
const repo={async rpc(name,args){try{const keys=Object.keys(args);const r=await pool.query(`select ${schema}.${name}(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')}) value`,keys.map(k=>typeof args[k]==='object'&&args[k]!==null?JSON.stringify(args[k]):args[k]));return {ok:true,data:r.rows[0].value};}catch(e){return {ok:false,error:e.message};}},
 async select(table,q){try{const keys=Object.keys(q).filter(k=>!['select','order','limit'].includes(k));const r=await pool.query(`select ${q.select} from ${schema}.${table} where ${keys.map((k,i)=>`${k}=$${i+1}`).join(' and ')}`,keys.map(k=>q[k].slice(3)));return {ok:true,data:r.rows};}catch(e){return {ok:false,error:e.message};}}};
try{
 await db.query(`create schema ${schema};
 create table ${schema}.raw_items(id uuid primary key,source_code text,source_unique_id text,raw_payload jsonb,source_url text);
 create table ${schema}.ai_runs(id uuid primary key,raw_item_id uuid,prompt_key text,metadata jsonb);
 create table ${schema}.ai_outputs(ai_run_id uuid,output_type text,payload jsonb);
 create table ${schema}.sec_os_snapshot_decisions(id uuid primary key,run_id uuid,action text,candidate_indexes jsonb,created_at timestamptz default now());
 create table ${schema}.sec_offering_plan_decisions(like ${schema}.sec_os_snapshot_decisions including all);
 create table ${schema}.listing_monitors(id uuid primary key,user_id uuid,is_active boolean,conditions jsonb);
 create table ${schema}.events(id uuid primary key,raw_item_id uuid,source_code text);
 create table ${schema}.user_alert_deliveries(id uuid primary key default gen_random_uuid(),user_id uuid,alert_event_id uuid,title text,category text,source_type text,source_label text,alert_lane text,delivered_channels text[],delivery_status text,delivered_at timestamptz,alert_domain text,listing_source_execution_id uuid,scheduled_for timestamptz,sent_at timestamptz,attempted_at timestamptz);`);
 await db.query(sql);
 const raw={id:rawId,source_code:'sec_edgar',source_unique_id:'0001234567-26-000001',source_url:'https://www.sec.gov/Archives/edgar/data/1234567/test.htm',raw_payload:{accession_number:'0001234567-26-000001',form_type:'F-1/A',cik:'0001234567',company_name:'Synthetic projected dilution fixture',filing_date:'2026-10-09',primary_document_html:'<p>Ordinary shares: 100 issued. Offering 20 new shares. Pré-funded £ “Unicode”.</p>',primary_document_html_truncated:false}};
 await db.query(`insert into ${schema}.raw_items values($1,$2,$3,$4,$5)`,[rawId,raw.source_code,raw.source_unique_id,raw.raw_payload,raw.source_url]);
 await db.query(`insert into ${schema}.events values($1,$2,'sec_edgar')`,[eventId,rawId]);
 const os=osSource(raw),off=offSource(raw),ob=osBinding(rawId,os),fb=compactBinding(offBinding(rawId,off));
 const osValue={version:'os_snapshot_v1',filing:os.filing,status:'PASS',current_os:[{scope:'class',share_class:'ordinary shares',quantity:'100',as_of_date:null,as_of_text:'As of this prospectus',evidence_blocks:[os.blocks[0].id]}],review:null};
 const offValue={version:'offering_plan_v1',filing:off.filing,status:'PASS',plan:{components:[{id:'c1',seller_type:'issuer',security_type:'ordinary_shares',security_label:'ordinary shares',quantity:{status:'stated',value:'20',unit:'ordinary shares'},price:{status:'blank',value:null},scenario:null,depositary:null,evidence_blocks:[off.blocks[0].id]}],over_allotment:[],post_offering_os:[],proceeds:[]},review:null};
 for(const [binding,key,status,value] of [[ob,'sec_os_snapshot','osStatus',osValue],[fb,'sec_offering_plan','offeringStatus',offValue]]){
  await db.query(`insert into ${schema}.ai_runs values($1,$2,$3,$4)`,[binding.id,rawId,key,{binding,[status]:'PASS',reservedAt:new Date().toISOString()}]);
  await db.query(`insert into ${schema}.ai_outputs values($1,$2,$3)`,[binding.id,key,{validated:value}]);
 }
 const p=await prepare(rawId,repo);assert.equal(p.fact.calculated_post_os_base,120);
 const before=(await db.query(`select jsonb_agg(to_jsonb(a)) data from ${schema}.ai_outputs a`)).rows[0].data;
 await Promise.all(Array.from({length:6},()=>refreshProjected(rawId,repo)));
 assert.equal((await db.query(`select count(*)::int n from ${schema}.projected_offering_dilution_facts`)).rows[0].n,1);
 assert.equal((await readProjectedFacts(eventId,repo)).status,'available');
 await assert.rejects(db.query(`update ${schema}.projected_offering_dilution_facts set fact='{}'`),/immutable/);
 for(const role of ['anon','authenticated']){
  await db.query(`set role ${role}`);await assert.rejects(db.query(`select * from ${schema}.projected_offering_dilution_facts`),/permission/);await db.query('reset role');
 }
 const conditions=[{key:'projected.projected_increase_percent_base',operator:'gte',value:10}];
 await db.query(`insert into ${schema}.listing_monitors values($1,$2,true,$3)`,[monitorId,actor,JSON.stringify(conditions)]);
 const alert=()=>pool.query(`select * from ${schema}.create_projected_offering_alert($1,$2,$3,$4,'base')`,[monitorId,eventId,p.id,JSON.stringify(conditions)]);
 const writes=await Promise.all(Array.from({length:12},alert));assert.equal(writes.filter(r=>r.rows[0].created_new).length,1);assert.equal((await alert()).rows[0].created_new,false);
 const a=(await db.query(`select * from ${schema}.user_alert_deliveries`)).rows[0];assert.match(a.title,/예상/);assert.match(a.title,/공모 계획 기준/);assert.deepEqual(a.delivered_channels,[]);assert.equal(a.delivery_status,'queued');
 await assert.rejects(db.query(`update ${schema}.user_alert_deliveries set scheduled_for=now()`),/projected_internal_alert_shape/);
 await assert.rejects(pool.query(`select * from ${schema}.create_projected_offering_alert($1,$2,$3,$4,null)`,[monitorId,eventId,p.id,JSON.stringify(conditions)]),/identity_conflict/);
 await db.query(`update ${schema}.listing_monitors set is_active=false`);await assert.rejects(alert(),/identity_conflict/);
 await db.query(`update ${schema}.listing_monitors set is_active=true`);
 for(const part of ['os','offering']){
  const id=part==='os'?ob.id:fb.id, table=part==='os'?'sec_os_snapshot_decisions':'sec_offering_plan_decisions',status=part==='os'?'osStatus':'offeringStatus',original=part==='os'?osValue:offValue;
  const review=structuredClone(original);review.status='REVIEW_REQUIRED';review.review={code:'ambiguous',candidates:part==='os'?review.current_os:[review.plan]};
  await db.query(`update ${schema}.ai_runs set metadata=jsonb_set(metadata,$2,'"REVIEW_REQUIRED"') where id=$1`,[id,[status]]);
  await db.query(`update ${schema}.ai_outputs set payload=$2 where ai_run_id=$1`,[id,{validated:review}]);
  assert.equal(await prepare(rawId,repo),null);assert.equal((await readProjectedFacts(eventId,repo)).status,'not_ready');
  const decision=randomUUID();await db.query(`insert into ${schema}.${table}(id,run_id,action,candidate_indexes) values($1,$2,'approve','[0]')`,[decision,id]);
  await refreshProjected(rawId,repo);assert.equal((await readProjectedFacts(eventId,repo)).status,'available');
  const approved=await prepare(rawId,repo),approvedMonitor=randomUUID();
  await db.query(`insert into ${schema}.listing_monitors values($1,$2,true,$3)`,[approvedMonitor,actor,JSON.stringify(conditions)]);
  const approvedAlert=()=>pool.query(`select * from ${schema}.create_projected_offering_alert($1,$2,$3,$4,'base')`,[approvedMonitor,eventId,approved.id,JSON.stringify(conditions)]);
  const approvedWrites=await Promise.all(Array.from({length:6},approvedAlert));
  assert.equal(approvedWrites.filter(r=>r.rows[0].created_new).length,1);
  await refreshProjected(rawId,repo);assert.equal((await approvedAlert()).rows[0].created_new,false);
  await db.query(`insert into ${schema}.${table}(id,run_id,action,candidate_indexes,created_at) values($1,$2,'hold','[]',now()+interval '1 second')`,[randomUUID(),id]);
  assert.equal(await prepare(rawId,repo),null);await assert.rejects(alert(),/source_changed/);
  await db.query(`delete from ${schema}.${table} where run_id=$1`,[id]);
  await db.query(`update ${schema}.ai_runs set metadata=jsonb_set(metadata,$2,'"PASS"') where id=$1`,[id,[status]]);
  await db.query(`update ${schema}.ai_outputs set payload=$2 where ai_run_id=$1`,[id,{validated:original}]);
 }
 await db.query(`update ${schema}.raw_items set raw_payload=jsonb_set(raw_payload,'{primary_document_html}','"changed"') where id=$1`,[rawId]);
 assert.equal(await prepare(rawId,repo),null);assert.equal((await readProjectedFacts(eventId,repo)).status,'not_ready');await assert.rejects(alert(),/source_changed/);
 assert.deepEqual((await db.query(`select jsonb_agg(to_jsonb(a)) data from ${schema}.ai_outputs a`)).rows[0].data,before);
 console.log('PASS isolated DB: concurrent fact + Alert dedupe, immutable storage, role denial, review/hold, fingerprint, Unicode, original output preservation; actual GPT calls 0');
}finally{await db.query(`drop schema ${schema} cascade`);await pool.end();await db.end();}
