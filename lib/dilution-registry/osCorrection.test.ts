import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {parseOsCorrectionDraft,OsCorrectionError} from './osCorrectionServer.ts';
const draft={action:'correct',quantity:'2000',asOf:'2026-01-31',evidence:'As of January 31, 2026, 2,000 shares of common stock were outstanding.',reason:'Correct transcription',
 expectedRevision:0,observationHash:'a'.repeat(64),sourceBindingHash:'b'.repeat(64),requestId:'a0000000-0000-4000-a000-000000000001'};
test('draft accepts source-bound literal quantity/date and rejects identity/actor/unit edits or empty evidence/reason',()=>{
 assert.equal(parseOsCorrectionDraft(draft).quantity,'2000');
 for(const change of [{issuerCik:'0000000092'},{actorUserId:'fake'},{unit:'ADS'},{classId:'Class B'},{reason:' '},{evidence:''},
  {quantity:'2,000'},{quantity:'2000.5'},{asOf:'2026-02-30'},{expectedRevision:-1}])assert.throws(()=>parseOsCorrectionDraft({...draft,...change}),OsCorrectionError);
});
test('withdrawal carries no replacement value and preserves its reason and revision binding',()=>{
 const withdraw={...draft,action:'revoke',quantity:null,asOf:null,evidence:null};
 assert.equal(parseOsCorrectionDraft(withdraw).action,'revoke');
 assert.throws(()=>parseOsCorrectionDraft({...withdraw,quantity:'2000'}),OsCorrectionError);
});
const require=createRequire(import.meta.url),ts=require('typescript');
function route(deps:Record<string,unknown>){
 const code=ts.transpileModule(readFileSync('app/api/admin/data/dilution-registry/observations/[id]/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{} as any};new Function('require','module','exports',code)((name:string)=>{assert(Object.hasOwn(deps,name),name);return deps[name];},module,module.exports);return module.exports;
}
test('existing authenticated role and origin gates precede preview/save; actor always comes from server session',async()=>{
 let permitted=true,loggedIn=true;const calls:string[]=[];
 const r=route({'next/server':{NextResponse:{json:Response.json}},'@/lib/auth/authRequest':{assertSameOriginAuthRequest:(req:Request)=>{if(req.headers.get('origin')!=='http://localhost:3121')throw new OsCorrectionError(403,'Origin');}},
  '@/lib/admin/api':{ADMIN_PRIVATE_RESPONSE_HEADERS:{'cache-control':'private, no-store'},applyAdminAuthCookies:()=>{},normalizeAdminError:(e:any)=>({status:e.status??500,message:e.message}),resolveAdminApiAccess:async(_r:Request,permission:string)=>{
   if(!loggedIn)throw new OsCorrectionError(401,'Login');if(!permitted)throw new OsCorrectionError(403,'Role');assert.equal(permission,'data.run');return {auth:{user:{id:'actual-session-actor'}}};}},
  '@/lib/dilution-registry/osCorrectionServer':{OsCorrectionError,previewOsCorrection:async()=>{calls.push('preview');return {};},saveOsCorrection:async(id:string,input:unknown,actor:string)=>{assert.equal(id,'123');assert.equal(actor,'actual-session-actor');calls.push('save');return {};}}});
 const post=(mode:string,origin='http://localhost:3121')=>r.POST(new Request('http://localhost:3121/api/admin/data/dilution-registry/observations/123',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({mode,...draft})}),{params:Promise.resolve({id:'123'})});
 assert.equal((await post('preview')).status,200);assert.equal((await post('save')).status,200);
 assert.equal((await post('save','http://another.test')).status,403);loggedIn=false;assert.equal((await post('save')).status,401);
 loggedIn=true;permitted=false;assert.equal((await post('save')).status,403);assert.deepEqual(calls,['preview','save']);
 permitted=true;
 for(const body of ['null','[]','{'])assert.equal((await r.POST(new Request('http://localhost:3121/api/admin/data/dilution-registry/observations/123',{
  method:'POST',headers:{origin:'http://localhost:3121','content-type':'application/json'},body,
 }),{params:Promise.resolve({id:'123'})})).status,400);
 assert.deepEqual(calls,['preview','save']);
});
