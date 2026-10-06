import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {registerHooks} from 'node:module';
import {resolve} from 'node:path';
import pg from 'pg';
registerHooks({resolve(s,c,next){return s==='server-only'?{shortCircuit:true,url:'data:text/javascript,export{}'}:next(s,c);}});
export function settings(){
 const c=JSON.parse(execFileSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
 assert.equal(new URL(c.DB_URL).hostname,'127.0.0.1');assert.equal(new URL(c.DB_URL).port,'56322');assert.equal(new URL(c.API_URL).hostname,'127.0.0.1');
 process.env.SUPABASE_URL=c.API_URL;process.env.SUPABASE_SECRET_KEY=c.SECRET_KEY||c.SERVICE_ROLE_KEY;
 process.env.WORKFLOW_LOCAL_BASE_URL='http://127.0.0.1:3117';process.env.WORKFLOW_LOCAL_DATA_DIR=resolve('.next/workflow-data');
 return c;
}
export async function connect(){const c=settings(),db=new pg.Client({connectionString:c.DB_URL});await db.connect();assert.equal((await db.query('select system_identifier::text id from pg_control_system()')).rows[0].id,'7678429483712069671');return db;}
export async function insertRaw(db,raw){const cols=Object.keys(raw);return JSON.parse(JSON.stringify((await db.query(`insert into raw_items(${cols.join(',')}) values(${cols.map((_,i)=>'$'+(i+1)).join(',')}) returning *`,Object.values(raw))).rows[0]));}
export function pgRepo(db){return {
 select:async(table,q)=>{
  assert.ok(['raw_items','ai_runs','ai_outputs','events'].includes(table));const params=[],clauses=[];
  for(const [k,v]of Object.entries(q)){if(['select','limit','order'].includes(k))continue;assert.match(k,/^[a-z_]+$/);assert.ok(v.startsWith('eq.'));params.push(v.slice(3));clauses.push(`${k}=$${params.length}`);}
  const result=await db.query(`select ${q.select||'*'} from ${table}${clauses.length?' where '+clauses.join(' and '):''}${q.limit?' limit '+Number(q.limit):''}`,params);return {ok:true,data:JSON.parse(JSON.stringify(result.rows))};
 },
 rpc:async(name,p)=>{assert.ok(['reserve_sec_tender_structured','sec_tender_transition','finish_sec_tender_structured'].includes(name));const keys=Object.keys(p);try{const r=await db.query(`select ${name}(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')}) data`,Object.values(p));return {ok:true,data:r.rows[0].data};}catch(e){return {ok:false,error:e.message,data:null};}}
};}
