// Test-only bootstrap. Never imported by application code; no live provider calls.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
export const isolated = JSON.parse(readFileSync(process.env.EFFECT_ISOLATED_STATUS, 'utf8').replace(/^\uFEFF/,''));
assert.equal(isolated.API_URL, 'http://127.0.0.1:59421');
assert.equal(new URL(isolated.DB_URL).port,'59422');
assert.equal(new URL(isolated.DB_URL).hostname,'127.0.0.1');
for (const key of Object.keys(process.env)) {
  if (/API_KEY|SUPABASE.*KEY|TELEGRAM|RESEND|CRON_SECRET|NAS_INGEST_TOKEN|SNAPTRADE/.test(key)) delete process.env[key];
}
Object.assign(process.env, {SUPABASE_URL:isolated.API_URL,SUPABASE_SERVICE_ROLE_KEY:isolated.SERVICE_ROLE_KEY,
  SUPABASE_ANON_KEY:isolated.ANON_KEY,APP_BASE_URL:'http://localhost:3117',GEMINI_API_KEY:'isolated-response-replay',
  ALERT_DELIVERY_SEND_EMAIL:'false',ALERT_DELIVERY_SEND_TELEGRAM:'false',ALERT_DELIVERY_SEND_TELEGRAM_PUBLIC:'false',
  ALERT_DELIVERY_CRON_WRITE_ENABLED:'false',NEXT_TELEMETRY_DISABLED:'1'});
const actualFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const u = new URL(input instanceof Request ? input.url : String(input));
  if (u.hostname==='generativelanguage.googleapis.com') {
    const request = JSON.parse(init.body);
    assert.ok(request.systemInstruction.parts[0].text.startsWith("You are Stock Radar's natural-language monitor condition compiler."),'Only the existing natural-language compiler may use the replay');
    const text = JSON.parse(request.contents[0].parts[0].text).text;
    if (!['Ibotta S-1 등록 건에 EFFECT가 나오면 알려줘','Ibotta S-3 등록 건에 EFFECT가 나오면 알려줘'].includes(text)) throw new Error('No compiler replay for this input');
    const result = {requirements:[{source_text:text,decision:'mapped',conditions:[
      {key:'effect.observed',operator:'eq',value:true},{key:'effect.target_query',operator:'eq',value:'IBTA'},
      {key:'effect.registration_form',operator:'eq',value:text.includes('S-3')?'S-3':'S-1'}],reason:null,question:null}]};
    return Response.json({candidates:[{content:{parts:[{text:JSON.stringify(result)}]},finishReason:'STOP'}]});
  }
  if (!['localhost','127.0.0.1'].includes(u.hostname) || !['3117','59421'].includes(u.port)) throw new Error('Isolated verification blocked external fetch');
  return actualFetch(input,init);
};
