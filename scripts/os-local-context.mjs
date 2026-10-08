// Local credentials stay in process memory. This helper never reads another worktree's environment.
import {execFileSync} from 'node:child_process';
import pg from 'pg';
export function localContext() {
 const output=execFileSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','-o','json'],{encoding:'utf8',windowsHide:true});
 const env=JSON.parse(output);
 const dbUrl=env.DB_URL??env.db_url??env.db?.url;
 if(!dbUrl)throw Error('Local CLI DB_URL unavailable');
 const u=new URL(dbUrl);if(u.hostname!=='127.0.0.1'||u.port!=='56322')throw Error('Unexpected local DB endpoint');
 return {env,db:new pg.Client({connectionString:dbUrl})};
}
