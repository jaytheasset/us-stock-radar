// Explicitly approved local stack only. Credentials remain in memory, never in receipts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { supabaseApiKeyHeaders } from '../lib/supabaseKeys.ts';
import { parseReviewDraft, reviewRequestHash } from '../lib/ticker-verification/kiwoom/review.ts';
async function main() {
const [mode, output, mainEnvFile] = process.argv.slice(2);
assert.ok(['inspect','serve'].includes(mode) && output && mainEnvFile);
const cli = (...args) => execFileSync(process.execPath,['node_modules/supabase/dist/supabase.js',...args],{encoding:'utf8',stdio:'pipe',windowsHide:true});
const local = JSON.parse(cli('status','-o','json'));
assert.equal(local.API_URL,'http://127.0.0.1:56321');
const dbUrl=new URL(local.DB_URL);
assert.equal(dbUrl.hostname,'127.0.0.1');assert.equal(dbUrl.port,'56322');assert.equal(dbUrl.pathname,'/postgres');
const inspect=name=>JSON.parse(execFileSync('docker',['inspect','supabase_'+name+'_US-Stock_Radar'],{encoding:'utf8',stdio:'pipe',windowsHide:true}))[0];
const containers=['kong','rest','auth','db'].map(inspect),[kong,rest,auth,db]=containers;
const env=c=>Object.fromEntries(c.Config.Env.map(e=>{const i=e.indexOf('=');return[e.slice(0,i),e.slice(i+1)];}));
const network='supabase_network_US-Stock_Radar',networkId=db.NetworkSettings.Networks[network].NetworkID;
assert.ok(containers.every(c=>c.Config.Labels['com.supabase.cli.project']==='US-Stock_Radar'&&c.NetworkSettings.Networks[network]?.NetworkID===networkId));
assert.equal(kong.NetworkSettings.Ports['8000/tcp'][0].HostPort,'56321');assert.equal(db.NetworkSettings.Ports['5432/tcp'][0].HostPort,'56322');
for(const[c,k]of [[rest,'PGRST_DB_URI'],[auth,'GOTRUE_DB_DATABASE_URL']]){const u=new URL(env(c)[k]);assert.equal(u.hostname.toLowerCase(),db.Name.slice(1).toLowerCase());assert.equal(u.pathname,'/postgres');assert.equal(u.port,'5432');}
const kongConfig=execFileSync('docker',['exec',kong.Name.slice(1),'cat',env(kong).KONG_DECLARATIVE_CONFIG],{encoding:'utf8',stdio:'pipe',windowsHide:true});
assert.ok(kongConfig.includes(`http://${rest.Name.slice(1)}:3000`)&&kongConfig.includes(`http://${auth.Name.slice(1)}:9999`));
const previousEnv=parseEnv(fs.readFileSync(mainEnvFile,'utf8'));
const keyNames={SUPABASE_PUBLISHABLE_KEY:'PUBLISHABLE_KEY',SUPABASE_SECRET_KEY:'SECRET_KEY',SUPABASE_ANON_KEY:'ANON_KEY',SUPABASE_SERVICE_ROLE_KEY:'SERVICE_ROLE_KEY'};
const keyEquality=Object.fromEntries(Object.entries(keyNames).map(([name,k])=>[name,{mainPresent:!!previousEnv[name],mainEqualsLocal:previousEnv[name]===local[k],localPresent:!!local[k],inRunningGateway:!!local[k]&&kongConfig.includes(local[k])}]));
assert.ok(Object.values(keyEquality).every(k=>k.localPresent&&k.inRunningGateway));
const headers=supabaseApiKeyHeaders({apiKey:local.SECRET_KEY});
const request=async suffix=>{const r=await fetch(local.API_URL+suffix,{headers,signal:AbortSignal.timeout(15000)});assert.equal(r.status,200,`local REST status ${r.status}`);return r.json();};
const client=new pg.Client({connectionString:local.DB_URL,connectionTimeoutMillis:5000,statement_timeout:60000});
const report={capturedAt:new Date().toISOString(),target:{api:local.API_URL,sql:'127.0.0.1:56322/postgres',network,networkId},keyEquality,
  containers:containers.map(c=>({name:c.Name,id:c.Id})),mainEnvHash:createHash('sha256').update(fs.readFileSync(mainEnvFile)).digest('hex')};
try{
  await client.connect();await client.query('begin isolation level repeatable read read only');
  report.identity=(await client.query('select system_identifier::text,current_database() database from pg_control_system()')).rows[0];
  assert.equal(report.identity.system_identifier,'7678429483712069671');
  if(mode==='inspect'){
    report.ledger=(await client.query('select version,name from supabase_migrations.schema_migrations order by version')).rows;
    const versions=new Set(report.ledger.map(r=>r.version));
    report.pending=fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')&&!versions.has(f.split('_')[0]));
    report.tables=(await client.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows.map(r=>r.tablename);
    for(const required of ['admin_role_assignments','admin_audit_logs','sec_ticker_resolution_decisions','sec_structured_raw_sources','sec_cover_observation_results','sec_cover_security_observations'])assert.ok(report.tables.includes(required));
    report.functions=(await client.query("select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args,p.proacl::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (p.proname='admin_actor_role' or p.proname like '%kiwoom%') and n.nspname in ('public','private') order by p.proname")).rows;
    report.fingerprints={};
    for(const table of report.tables.filter(t=>/ticker|projection|current|watchlist|alert|subscription|preference|setting|user_profile|monitor/.test(t)&&!t.startsWith('kiwoom'))){
      assert.match(table,/^[a-z0-9_]+$/);
      report.fingerprints[table]=(await client.query(`select count(*)::text count,md5(coalesce(string_agg(h,',' order by h),'')) hash from (select md5(to_jsonb(t)::text) h from public."${table}" t) s`)).rows[0];
    }
    report.candidates=(await client.query('select id,issuer_cik,evidence_accession_number,resolution_state,decision_sha256 from public.sec_ticker_resolution_decisions order by id limit 20')).rows;
    const remote=await request('/rest/v1/sec_ticker_resolution_decisions?select=id,issuer_cik,evidence_accession_number,resolution_state,decision_sha256&order=id&limit=20');
    assert.deepEqual(remote,report.candidates);report.restSqlCandidateEquality=true;
    report.candidateCount=(await client.query('select count(*)::int count from public.sec_ticker_resolution_decisions')).rows[0].count;
    report.kiwoomSchema=(await client.query("select c.relname,c.relrowsecurity,c.relacl::text,(select json_agg(t.tgname) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal) triggers from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname like 'kiwoom%' order by c.relname")).rows;
    report.kiwoomIndexes=(await client.query("select tablename,indexname,indexdef from pg_indexes where schemaname='public' and tablename like 'kiwoom%' order by indexname")).rows;
    const spec=await request('/rest/v1/');report.restPaths=Object.keys(spec.paths).filter(p=>/kiwoom|sec_ticker|admin_role|admin_audit/.test(p));
    report.featureCounts={};for(const t of report.tables.filter(t=>t.startsWith('kiwoom')))report.featureCounts[t]=(await client.query(`select count(*)::int count from public."${t}"`)).rows[0].count;
    report.auditCount=(await client.query("select count(*)::int count from public.admin_audit_logs where action like 'kiwoom%'")).rows[0].count;
    if(report.tables.includes('kiwoom_ticker_evidence_reviews')) {
      const columns='id,case_id,revision,actor_user_id,request_id,request_hash,source_hash,verdict,draft,snapshot,ticker_authority,audit_log_id';
      const sqlRows=(await client.query(`select ${columns} from public.kiwoom_ticker_evidence_reviews order by id`)).rows;
      const restRows=await request(`/rest/v1/kiwoom_ticker_evidence_reviews?select=${columns}&order=id`);
      assert.deepEqual(restRows,sqlRows); report.restSqlReviewEquality=true;
      assert.ok(sqlRows.every(r=>reviewRequestHash(parseReviewDraft(r.draft))===r.request_hash));
      report.reviewRequestHashesValid=true;
      report.reviewReadback=sqlRows.map(r=>({id:r.id,caseId:r.case_id,revision:r.revision,verdict:r.verdict,facts:r.draft.facts,
        usMarketRowReviewed:r.draft.usMarketRowReviewed,sourceHash:r.source_hash,proof:r.draft.proof,
        expectedRevision:r.draft.expectedRevision,requestId:r.request_id,requestHash:r.request_hash,auditId:r.audit_log_id,
        actorSha256:createHash('sha256').update(r.actor_user_id).digest('hex'),tickerAuthority:r.ticker_authority}));
      report.reviewAuditChecks=(await client.query(`select r.id,r.revision,a.actor_role,a.action,
        r.actor_user_id=a.actor_user_id actor_matches,r.request_id::text=a.request_id request_matches,
        a.target_id=r.case_id::text case_matches,a.after_data->>'id'=r.id::text record_matches,
        (a.after_data->>'revision')::int=r.revision revision_matches,
        a.after_data->>'tickerAuthority'=r.ticker_authority authority_matches,
        a.before_data predecessor
        from public.kiwoom_ticker_evidence_reviews r join public.admin_audit_logs a on a.id=r.audit_log_id order by r.revision`)).rows;
      assert.equal(report.reviewAuditChecks.length,sqlRows.length);
      assert.ok(report.reviewAuditChecks.every(r=>r.actor_matches&&r.request_matches&&r.case_matches&&r.record_matches&&r.revision_matches&&r.authority_matches));
    }
  }
  await client.query('commit');
}catch{console.error(JSON.stringify({stage:mode,message:'Verification failed; sensitive diagnostics suppressed'}));process.exitCode=1;}
finally{await client.end();}
if(process.exitCode)process.exit(process.exitCode);
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({mode,systemIdentifier:report.identity.system_identifier,keyEquality,ledgerCount:report.ledger?.length,pending:report.pending,protectedTables:Object.keys(report.fingerprints??{}).length,candidateCount:report.candidateCount,kiwoomTables:report.kiwoomSchema?.length,restPaths:report.restPaths?.filter(p=>p.includes('kiwoom'))}));
if(mode==='serve'){
  const port=Number(process.env.KIWOOM_CANDIDATE_PORT||3111);assert.ok(Number.isInteger(port)&&port>3110&&port<65536);
  const childEnv=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(path|systemroot|windir|temp|tmp|userprofile|appdata|localappdata|comspec|pathext)$/i.test(k)));
  Object.assign(childEnv,{SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SECRET_KEY,SUPABASE_PUBLISHABLE_KEY:local.PUBLISHABLE_KEY,
    APP_BASE_URL:`http://127.0.0.1:${port}`,DEV_ALLOWED_ORIGINS:`http://127.0.0.1:${port},${local.API_URL}`,NEXT_TELEMETRY_DISABLED:'1'});
  console.log(JSON.stringify({candidatePort:port,restOrigin:childEnv.SUPABASE_URL,envNames:Object.keys(childEnv).filter(k=>/SUPABASE|APP_BASE|DEV_ALLOWED/.test(k))}));
  const child=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port',String(port)],{env:childEnv,stdio:'inherit',windowsHide:true});
  fs.writeFileSync(output+'.pid',JSON.stringify({launcher:process.pid,child:child.pid,port,cwd:process.cwd()}));
  process.on('SIGINT',()=>child.kill('SIGINT'));process.on('SIGTERM',()=>child.kill('SIGTERM'));
  child.on('exit',code=>{process.exitCode=code??0;});
}
}
// Child-process errors may contain captured CLI output with API keys. Never print them.
main().catch(()=>{console.error('Local verification failed; sensitive diagnostics suppressed.');process.exitCode=1;});
