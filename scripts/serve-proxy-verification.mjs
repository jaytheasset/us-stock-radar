// Local candidate verification only. Credentials stay in process memory, never evidence files.
import {readFileSync} from 'node:fs';
import {execFileSync,spawn} from 'node:child_process';
import {resolve} from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
const [out,credentials,mode]=process.argv.slice(2);
const gate=mode==='merge-gate';
assert.ok(out&&(gate||credentials));
const probe=net.createServer();await new Promise((ok,no)=>{probe.once('error',no);probe.listen(3115,'127.0.0.1',ok)});await new Promise(ok=>probe.close(ok));
const cli=JSON.parse(execFileSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
assert.equal(new URL(cli.DB_URL).hostname,'127.0.0.1');assert.equal(new URL(cli.DB_URL).port,'56322');
const env={...process.env,SUPABASE_URL:cli.API_URL,SUPABASE_SECRET_KEY:cli.SECRET_KEY||cli.SERVICE_ROLE_KEY,
 SUPABASE_PUBLISHABLE_KEY:cli.PUBLISHABLE_KEY||cli.ANON_KEY,NEXT_PUBLIC_SUPABASE_URL:cli.API_URL,
 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:cli.PUBLISHABLE_KEY||cli.ANON_KEY,APP_BASE_URL:'http://127.0.0.1:3115',
 WORKFLOW_LOCAL_BASE_URL:'http://127.0.0.1:3115',WORKFLOW_LOCAL_DATA_DIR:resolve('.next/workflow-data'),
 PROXY_VERIFICATION_EVIDENCE:resolve(out),NEXT_TELEMETRY_DISABLED:'1',
 NODE_OPTIONS:`--require "${resolve(gate?'scripts/proxy-merge-gate-preload.cjs':'scripts/proxy-verification-preload.cjs').replaceAll('\\','/')}"`};
if(gate)env.GEMINI_API_KEY='saved-response-replay-only';
else for(const line of readFileSync(credentials,'utf8').split(/\r?\n/)){
 const m=line.match(/^(GEMINI_API_KEY|SEC_USER_AGENT)=(.*)$/);if(m)env[m[1]]=m[2].replace(/^["']|["']$/g,'');
}
assert.ok(env.GEMINI_API_KEY,'Gemini credential unavailable');
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--webpack','--hostname','127.0.0.1','--port','3115'],{env,stdio:'inherit',windowsHide:true});
child.on('exit',code=>process.exit(code??1));
