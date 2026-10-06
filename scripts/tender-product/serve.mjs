import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import net from 'node:net';
import {settings} from './local.mjs';
const probe=net.createServer();await new Promise((ok,no)=>{probe.once('error',no);probe.listen(3117,'127.0.0.1',ok);});await new Promise(ok=>probe.close(ok));
const c=settings();const env={...process.env,SUPABASE_URL:c.API_URL,SUPABASE_SECRET_KEY:c.SECRET_KEY||c.SERVICE_ROLE_KEY,SUPABASE_PUBLISHABLE_KEY:c.PUBLISHABLE_KEY||c.ANON_KEY,NEXT_PUBLIC_SUPABASE_URL:c.API_URL,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:c.PUBLISHABLE_KEY||c.ANON_KEY,APP_BASE_URL:'http://127.0.0.1:3117',NEXT_TELEMETRY_DISABLED:'1',TENDER_E2E_ARTIFACTS:resolve('scripts/tender-product/artifacts'),NODE_OPTIONS:`--require "${resolve('scripts/tender-product/transport.cjs').replaceAll('\\','/')}"`};
for(const line of readFileSync(process.argv[2],'utf8').split(/\r?\n/)){const m=line.match(/^(GEMINI_API_KEY|SEC_USER_AGENT)=(.*)$/);if(m)env[m[1]]=m[2].replace(/^["']|["']$/g,'');}
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--webpack','--hostname','127.0.0.1','--port','3117'],{env,stdio:'inherit',windowsHide:true});
child.on('exit',code=>process.exit(code??1));
