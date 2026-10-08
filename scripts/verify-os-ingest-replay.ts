import {registerHooks} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import assert from 'node:assert/strict';
registerHooks({resolve(s,c,next){if(s==='server-only')return{shortCircuit:true,url:'data:text/javascript,export{}'};return next(s,c);}});
const {runSecRawIngest}=await import('../lib/secIngest.ts');
const {repository,select}=await import('../lib/sec-os-snapshot/repository.ts');
const out=process.argv[2],setup=JSON.parse(readFileSync(join(out,'setup.json'),'utf8')),repo=await repository();
const raw=(await select(repo,'raw_items',{select:'*',id:`eq.${setup.rawItemId}`,limit:'1'}))[0];
// Replay the retained SEC fetch result through the actual ingest hook. No fetch/provider/backfill.
const result=await runSecRawIngest({}, {
 fetchRawItems:async()=>({ok:true,status:200,items:[raw],diagnostics:{documentsRequested:1,documentsFetched:1,documentsFailed:0}}),
 ensureSource:async()=>{},createSourceRun:async()=>'running',finishSourceRun:async()=>{},
 findExistingRawItem:async()=>raw,
} as never);
const sidecar=result.items?.[0]?.os_snapshot as Record<string,unknown>;
assert.equal(result.ok,true);assert.equal(sidecar.status,'PASS');assert.equal(sidecar.inserted,false);
writeFileSync(join(out,'automatic-ingest-replay.json'),JSON.stringify({rawItemId:raw.id,sidecar,additionalCodexCalls:0},null,2));console.log(JSON.stringify(sidecar));
