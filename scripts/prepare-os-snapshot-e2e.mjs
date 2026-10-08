import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {localContext} from './os-local-context.mjs';
const frozen=process.argv[2],out=process.argv[3];if(!frozen||!out)throw Error('frozen and evidence directories required');mkdirSync(out,{recursive:true});
const {env,db}=localContext();await db.connect();
try {
 const columns=(await db.query("select table_name,column_name,is_nullable,column_default from information_schema.columns where table_schema='public' and table_name in ('raw_items','ai_runs','ai_outputs') order by table_name,ordinal_position")).rows;
 writeFileSync(join(out,'db-columns.json'),JSON.stringify(columns,null,2));
 const existing=(await db.query("select to_regprocedure('public.reserve_sec_os_snapshot(jsonb)') fn")).rows[0].fn;
 if(!existing){await db.query('begin');try{await db.query(readFileSync('supabase/migrations/20261008171255_sec_os_snapshot_v1.sql','utf8'));await db.query('commit');}catch(e){await db.query('rollback');throw e;}}
 // One known filing's frozen SEC original; no SEC refetch and no prior GPT output in product input.
 const selected=JSON.parse(readFileSync(join(frozen,'regression-selection.json'),'utf8')).find(x=>x.case_id==='canaan-f1');
 const documents=JSON.parse(readFileSync(join(selected.source,'documents.json'),'utf8')).documents;
 const primary=documents.find(d=>d.kind==='primary'),meta=documents.find(d=>d.kind==='official_metadata').metadata;
 const original=readFileSync(join(selected.source,primary.original_path),'utf8');
 const matches=(await db.query("select id,raw_payload from public.raw_items where source_code='sec_edgar' and source_unique_id=$1",[meta.accession])).rows;
 let id;
 if(matches.length){id=matches[0].id;if(matches[0].raw_payload.primary_document_html!==original)throw Error('Existing raw differs; refusing to overwrite it');}
 else {
  id=randomUUID();await db.query(`insert into public.raw_items(id,source_code,source_group,source_unique_id,source_url,title,body_text,analysis_text,raw_payload,metadata,dedupe_key)
   values($1,'sec_edgar','filings',$2,$3,$4,'','',$5,$6,$7)`,[id,meta.accession,primary.url,meta.issuer+' '+meta.form,
   {accession_number:meta.accession,cik:meta.cik,company_name:meta.issuer,form_type:meta.form,filing_date:meta.filingDate,primary_document_html:original,primary_document_html_truncated:false,primary_document_url:primary.url},
   {os_snapshot_candidate_e2e:true},'sec_edgar:'+meta.accession]);
 }
 const api=env.API_URL??env.api_url,secret=env.SERVICE_ROLE_KEY??env.service_role_key,anon=env.ANON_KEY??env.anon_key;
 if(!api||!secret||!anon||!/^http:\/\/127\.0\.0\.1:56321\/?$/.test(api))throw Error('Local API config unavailable');
 // Candidate-only .env.local generated from local CLI, never copied from main or committed.
 const config={SUPABASE_URL:api,SUPABASE_SERVICE_ROLE_KEY:secret,SUPABASE_ANON_KEY:anon,NEXT_PUBLIC_SUPABASE_URL:api,NEXT_PUBLIC_SUPABASE_ANON_KEY:anon,APP_BASE_URL:'http://localhost:3112'};
 if(!existsSync('.env.local'))writeFileSync('.env.local',Object.entries(config).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{mode:0o600});
 const admins=(await db.query("select user_id,role from public.admin_role_assignments where active and role in ('super_admin','operations')")).rows;
 const registered=(await db.query("select exists(select 1 from supabase_migrations.schema_migrations where version='20261008171255') registered")).rows[0].registered;
 writeFileSync(join(out,'setup.json'),JSON.stringify({rawItemId:id,accession:meta.accession,localMigration:'20261008171255_sec_os_snapshot_v1',registeredMigrationHistory:registered,adminCount:admins.length},null,2));
 console.log(JSON.stringify({rawItemId:id,accession:meta.accession,localMigrationApplied:true,adminCount:admins.length}));
} finally {await db.end();}
