// Candidate-local only. Never reset the shared database or modify a retained raw filing.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {localContext} from './os-local-context.mjs';
const out=process.argv[2],rawId=process.argv[3];if(!out||!rawId)throw Error('Evidence directory and existing full raw ID required');
mkdirSync(out,{recursive:true});const {db,env}=localContext();await db.connect();
try{
 const raw=(await db.query("select * from public.raw_items where id=$1 and source_code='sec_edgar'",[rawId])).rows[0];
 if(!raw||!['F-1','F-1/A'].includes(raw.raw_payload.form_type)||!(raw.raw_payload.os_snapshot_primary_html||raw.raw_payload.primary_document_html)?.length)throw Error('Full F-1 source required');
 const osBefore=(await db.query("select id,md5(row_to_json(r)::text) hash from public.ai_runs r where prompt_key='sec_os_snapshot' order by id")).rows;
 const osOutputs=(await db.query("select id,md5(row_to_json(o)::text) hash from public.ai_outputs o where output_type='sec_os_snapshot' order by id")).rows;
 if(!(await db.query("select to_regprocedure('public.reserve_sec_offering_plan(jsonb)') fn")).rows[0].fn){
  await db.query('begin');try{await db.query(readFileSync('supabase/migrations/20261008211452_sec_offering_plan_v1.sql','utf8'));await db.query('commit');}catch(e){await db.query('rollback');throw e;}
 }
 const api=env.API_URL,secret=env.SERVICE_ROLE_KEY,anon=env.ANON_KEY;if(api!=='http://127.0.0.1:56321'||!secret||!anon)throw Error('Local credentials unavailable');
 if(!existsSync('.env.local'))writeFileSync('.env.local',Object.entries({SUPABASE_URL:api,SUPABASE_SERVICE_ROLE_KEY:secret,SUPABASE_ANON_KEY:anon,NEXT_PUBLIC_SUPABASE_URL:api,NEXT_PUBLIC_SUPABASE_ANON_KEY:anon,APP_BASE_URL:'http://localhost:3113'}).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{mode:0o600});
 writeFileSync(join(out,'setup.json'),JSON.stringify({rawItemId:rawId,accession:raw.source_unique_id,migration:'20261008211452',migrationHistoryRegistered:false,osBefore,osOutputs},null,2),{flag:'wx'});
 console.log(JSON.stringify({prepared:true,accession:raw.source_unique_id,localOnly:true,rawUnchanged:true}));
}finally{await db.end();}
