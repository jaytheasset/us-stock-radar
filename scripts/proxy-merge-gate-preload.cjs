// Explicit verification-only transport: exact saved responses, no external fetches.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const original=globalThis.fetch,root=process.env.PROXY_VERIFICATION_EVIDENCE;
if(!root)throw Error('Evidence directory required');
globalThis.fetch=async(url,init)=>{
 const address=new URL(String(url instanceof Request?url.url:url));
 if(['127.0.0.1','localhost','[::1]'].includes(address.hostname))return original(url,init);
 if(address.hostname!=='generativelanguage.googleapis.com')throw Error('External fetch blocked by Proxy merge-gate verification');
 const cfg=JSON.parse(fs.readFileSync(path.join(root,'automatic-transport.json'),'utf8'));
 const body=String(init?.body),hash=createHash('sha256').update(body).digest('hex');
 const stage=Object.keys(cfg.stages).find(k=>cfg.stages[k].requestHash===hash&&address.pathname.includes(cfg.stages[k].model));
 if(!stage)throw Error('Unapproved synthetic provider request');
 const prefix=path.join(root,`automatic-${stage}`);
 fs.writeFileSync(prefix+'-claim.json',JSON.stringify({requestHash:hash,actualProviderCalls:0,replayed:true}),{flag:'wx'});
 fs.writeFileSync(prefix+'-request.json',body);
 return new Response(fs.readFileSync(cfg.stages[stage].response,'utf8'),{status:200});
};
