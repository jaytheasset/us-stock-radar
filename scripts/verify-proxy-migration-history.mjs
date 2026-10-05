// Only the explicitly authorized local history row can change; schema is read-only.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import pg from 'pg';
const [mode,outDir]=process.argv.slice(2);
assert.ok(['check','apply'].includes(mode));const out=resolve(outDir);mkdirSync(out,{recursive:true});
const version='20261005043414',cliPath='node_modules/supabase/dist/supabase.js';
const cli=JSON.parse(execFileSync(process.execPath,[cliPath,'status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
assert.equal(new URL(cli.DB_URL).hostname,'127.0.0.1');assert.equal(new URL(cli.DB_URL).port,'56322');
const db=new pg.Client({connectionString:cli.DB_URL});await db.connect();
const sql=readFileSync(`supabase/migrations/${version}_sec_proxy_structured_product_v1.sql`,'utf8');
const hash=s=>createHash('sha256').update(s).digest('hex');
const normalize=s=>s.replace(/\r\n/g,'\n').trim();
// Parentheses/casts emitted by pg_get_indexdef are syntactic decoration for these exact expressions.
const indexNormal=s=>s.split(/('[^']*')/).map(part=>part.startsWith("'")?part:part.toLowerCase().replace(/::text|using btree|public\.|[\s();]/g,'')).join('');
async function objects(){return {
 functions:(await db.query("select p.proname,pg_get_function_identity_arguments(p.oid) args,pg_get_function_result(p.oid) result,p.prosrc,p.prosecdef,p.proconfig,l.lanname,p.provolatile,pg_get_expr(p.proargdefaults,0) defaults,pg_get_functiondef(p.oid) definition,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where n.nspname='public' and p.proname in ('reserve_sec_proxy_structured','sec_proxy_transition','finish_sec_proxy_structured','guard_sec_proxy_history') order by p.proname")).rows,
 indexes:(await db.query("select c.relname name,pg_get_indexdef(i.indexrelid) definition,i.indisvalid,i.indisready from pg_index i join pg_class c on c.oid=i.indexrelid where c.relname in ('sec_proxy_execution_once','sec_proxy_output_once') order by c.relname")).rows,
 triggers:(await db.query("select tgname name,pg_get_triggerdef(oid) definition,tgenabled from pg_trigger where tgname in ('sec_proxy_run_guard','sec_proxy_output_guard') order by tgname")).rows,
 grants:(await db.query("select p.proname,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('authenticated',p.oid,'execute') authenticated,has_function_privilege('service_role',p.oid,'execute') service from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('reserve_sec_proxy_structured','sec_proxy_transition','finish_sec_proxy_structured','guard_sec_proxy_history') order by p.proname")).rows,
};}
try{
 assert.equal((await db.query('select system_identifier::text id from pg_control_system()')).rows[0].id,'7678429483712069671');
 const before=await objects();assert.equal(before.functions.length,4);assert.equal(before.indexes.length,2);assert.equal(before.triggers.length,2);
 for(const f of before.functions){
  const match=sql.match(new RegExp(`create function public\\.${f.proname}\\(([^)]*)\\)\\s*returns (jsonb|trigger) language plpgsql(?: security invoker)? set search_path='' as \\$\\$([\\s\\S]*?)\\$\\$;`));
  assert.ok(match,`migration definition ${f.proname}`);assert.equal(normalize(f.prosrc),normalize(match[3]));
  assert.equal(f.args,match[1].replace(/ default '\{\}'::jsonb/g,'').replaceAll(',',', '));
  assert.equal(f.result,match[2]);assert.equal(f.prosecdef,false);assert.equal(f.lanname,'plpgsql');assert.equal(f.provolatile,'v');assert.deepEqual(f.proconfig,['search_path=""']);
  assert.equal(f.defaults,f.proname==='sec_proxy_transition'?"'{}'::jsonb":null);
 }
 for(const i of before.indexes){const expected=sql.match(new RegExp(`create unique index ${i.name}[\\s\\S]*?;`))?.[0];assert.ok(expected);assert.equal(indexNormal(i.definition),indexNormal(expected));assert.ok(i.indisvalid&&i.indisready);}
 for(const t of before.triggers){const expected=sql.match(new RegExp(`create trigger ${t.name}[^;]+;`))?.[0];assert.ok(expected);const norm=s=>s.toLowerCase().replace('update or delete','delete or update').replaceAll('public.','').replace(/[\s;]/g,'');assert.equal(norm(t.definition),norm(expected));assert.equal(t.tgenabled,'O');}
 for(const g of before.grants){assert.equal(g.anon,false);assert.equal(g.authenticated,false);if(g.proname!=='guard_sec_proxy_history')assert.equal(g.service,true);}
 const historyBefore=(await db.query('select * from supabase_migrations.schema_migrations order by version')).rows;
 writeFileSync(resolve(out,'migration-object-audit.json'),JSON.stringify({version,fileHash:hash(sql),equivalent:true,objects:before},null,2));
 if(mode==='apply'&&!historyBefore.some(r=>r.version===version)){
  const result=execFileSync(process.execPath,[cliPath,'migration','repair',version,'--status','applied','--local'],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
  writeFileSync(resolve(out,'migration-repair.log'),result);
 }
 const after=await objects(),historyAfter=(await db.query('select * from supabase_migrations.schema_migrations order by version')).rows;
 assert.deepEqual(after,before);assert.deepEqual(historyAfter.filter(r=>r.version!==version),historyBefore.filter(r=>r.version!==version));
 const target=historyAfter.filter(r=>r.version===version);if(mode==='apply')assert.equal(target.length,1);
 const report={version,equivalent:true,functions:4,indexes:2,triggers:2,grantsVerified:true,schemaUnchanged:true,otherHistoryUnchanged:true,applied:target.length===1,localOnly:true};
 writeFileSync(resolve(out,'migration-history-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await db.end();}
