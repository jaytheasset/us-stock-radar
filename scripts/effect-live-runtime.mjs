// Candidate-only live E2E guard. No response replay; never imported by product code.
import assert from 'node:assert/strict';
import {readFileSync, appendFileSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const isolated = JSON.parse(readFileSync(process.env.EFFECT_ISOLATED_STATUS,'utf8').replace(/^\uFEFF/,''));
assert.equal(isolated.API_URL,'http://127.0.0.1:59421');
assert.equal(new URL(isolated.DB_URL).hostname,'127.0.0.1');
assert.equal(new URL(isolated.DB_URL).port,'59422');
const credentials = readFileSync(process.env.EFFECT_LIVE_CREDENTIALS,'utf8');
for(const key of Object.keys(process.env)) {
  if(/API_KEY|SUPABASE|TELEGRAM|RESEND|CRON_SECRET|NAS_INGEST_TOKEN|SNAPTRADE/.test(key)) delete process.env[key];
}
for(const line of credentials.split(/\r?\n/)) {
  const m=line.match(/^\s*(GEMINI_API_KEY|NEWS_GEMINI_MODEL|SEC_USER_AGENT)\s*=\s*(.*)$/);
  if(m) process.env[m[1]]=m[2].replace(/^["']|["']$/g,'');
}
assert.ok(process.env.GEMINI_API_KEY && process.env.SEC_USER_AGENT);
Object.assign(process.env,{SUPABASE_URL:isolated.API_URL,SUPABASE_SERVICE_ROLE_KEY:isolated.SERVICE_ROLE_KEY,
  SUPABASE_ANON_KEY:isolated.ANON_KEY,APP_BASE_URL:'http://localhost:3117',
  ALERT_DELIVERY_SEND_EMAIL:'false',ALERT_DELIVERY_SEND_TELEGRAM:'false',ALERT_DELIVERY_SEND_TELEGRAM_PUBLIC:'false',
  ALERT_DELIVERY_CRON_WRITE_ENABLED:'false',NEXT_TELEMETRY_DISABLED:'1'});
const actualFetch=globalThis.fetch;
const logPath=process.env.EFFECT_LIVE_HTTP_LOG;
assert.ok(logPath);
const log=value=>appendFileSync(logPath,JSON.stringify({at:new Date().toISOString(),...value})+'\n');
globalThis.fetch=async(input,init)=>{
  const u=new URL(input instanceof Request?input.url:String(input));
  if(['localhost','127.0.0.1'].includes(u.hostname)&&['3117','59421'].includes(u.port)) return actualFetch(input,init);
  const provider=u.hostname==='generativelanguage.googleapis.com';
  if(provider){
    const request=JSON.parse(init.body);
    assert.ok(request.systemInstruction.parts[0].text.startsWith("You are Stock Radar's natural-language monitor condition compiler."));
    const prior=existsSync(logPath)?readFileSync(logPath,'utf8'):'';
    assert.ok(!prior.includes('"kind":"compiler_request"'),'One live compiler call per evidence log');
    log({kind:'compiler_request',model:u.pathname,replay:false});
  }else if(!['www.sec.gov','data.sec.gov'].includes(u.hostname)||u.protocol!=='https:'){
    throw new Error('Live EFFECT isolation blocked external fetch');
  }
  const response=await actualFetch(input,init);
  const body=await response.clone().text();
  log({kind:provider?'compiler_response':'sec_response',url:u.origin+u.pathname,status:response.status,
    contentType:response.headers.get('content-type'),chars:body.length,
    sha256:createHash('sha256').update(body).digest('hex'),replay:false});
  return response;
};
