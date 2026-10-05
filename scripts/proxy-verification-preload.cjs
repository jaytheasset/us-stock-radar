// Explicit local verification transport only. Never enabled by application code.
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const original = globalThis.fetch;
const root = process.env.PROXY_VERIFICATION_EVIDENCE;
if (!root) throw Error('Explicit evidence directory required');
globalThis.fetch = async (url, init) => {
  const address = String(url instanceof Request ? url.url : url);
  if (!address.includes('generativelanguage.googleapis.com')) return original(url, init);
  const settings = JSON.parse(fs.readFileSync(path.join(root,'transport.json'),'utf8'));
  const stage = address.includes('gemini-2.5-flash-lite:') ? 'call1' : address.includes('gemini-3.5-flash:') ? 'call2' : null;
  if (!stage || !['replay','fresh'].includes(settings.mode)) throw Error('Provider not authorized by bounded Proxy transport');
  const body = String(init?.body);
  const requestHash=createHash('sha256').update(body).digest('hex');
  const name = stage==='call1'
    ? requestHash==='5c04aed28ffe62cdc53c74593a2a5e2342fbc1f60e01603cff65270de90d8408'?'Alternus'
      :requestHash==='92f529ec13f1897ad5a4b4828941170e2a69f873f7445875d00b4b975130c6db'?'BigBear':null
    :body.includes('0001213900-24-072316') ? 'Alternus' : body.includes('0001193125-25-075782') ? 'BigBear' : null;
  if (!name) throw Error('Unapproved Proxy filing');
  const prefix = path.join(root,`${settings.mode}-${name}-${stage}`);
  fs.writeFileSync(prefix+'-claimed.json',JSON.stringify({at:new Date().toISOString(),mode:settings.mode}),{flag:'wx'});
  fs.writeFileSync(prefix+'-request.json',body);
  const started=Date.now();
  let response;
  if(settings.mode==='replay') response=new Response(fs.readFileSync(settings.responses[name][stage],'utf8'),{status:200});
  else response=await original(url,init);
  const raw=await response.text();
  fs.writeFileSync(prefix+'-response.json',raw);
  fs.writeFileSync(prefix+'-transport.json',JSON.stringify({status:response.status,latencyMs:Date.now()-started,
    actualProviderCalls:settings.mode==='fresh'?1:0,preservedResponseReplays:settings.mode==='replay'?1:0}));
  return new Response(raw,{status:response.status});
};
