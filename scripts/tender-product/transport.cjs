// Local verification only: one exact approved request, no other outbound provider/delivery.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const root=process.env.TENDER_E2E_ARTIFACTS,original=globalThis.fetch;
if(!root)throw Error('Explicit local artifact directory required');
const hash=s=>createHash('sha256').update(s).digest('hex');
globalThis.fetch=async(url,init)=>{
 const address=new URL(String(url instanceof Request?url.url:url));
 if(['127.0.0.1','localhost','[::1]'].includes(address.hostname))return original(url,init);
 if(address.hostname!=='generativelanguage.googleapis.com')throw Error('Local Tender verification blocks external network/delivery');
 const body=String(init?.body),frozen=JSON.parse(fs.readFileSync(path.join(root,'frozen.json'),'utf8'));
 const permit=JSON.parse(fs.readFileSync(path.join(root,'permit.json'),'utf8'));
 if(permit.maxCalls!==1||hash(body)!==frozen.requestHash||address.href!=='https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent')throw Error('Unapproved provider request');
 fs.writeFileSync(path.join(root,'physical-call-started.json'),JSON.stringify({at:new Date().toISOString(),requestHash:hash(body),physicalCalls:1}),{flag:'wx'});
 const started=Date.now();const response=await original(url,init),raw=await response.text();
 fs.writeFileSync(path.join(root,'provider-response.json'),raw,{flag:'wx'});
 fs.writeFileSync(path.join(root,'transport.json'),JSON.stringify({http:response.status,latencyMs:Date.now()-started,physicalCalls:1}),{flag:'wx'});
 return new Response(raw,{status:response.status});
};
