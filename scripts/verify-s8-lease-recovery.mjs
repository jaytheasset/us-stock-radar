// Bounded, real-DB fault injection. Only this runner's new verification executions may have leases expired.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {registerHooks} from 'node:module';
import pg from 'pg';
registerHooks({resolve(s,c,next){return s==='server-only'?{shortCircuit:true,url:'data:text/javascript,export{}'}:next(s,c)}});
const [outDir,frozenDir]=process.argv.slice(2),out=resolve(outDir);assert.ok(!out.startsWith(process.cwd()));mkdirSync(out,{recursive:true});
const json=p=>JSON.parse(readFileSync(p,'utf8')),save=(n,v)=>writeFileSync(out+'/'+n,JSON.stringify(v,null,2));
const cli=JSON.parse(execFileSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
assert.equal(new URL(cli.DB_URL).hostname,'127.0.0.1');assert.equal(new URL(cli.DB_URL).port,'56322');
process.env.SUPABASE_URL=cli.API_URL;process.env.SUPABASE_SECRET_KEY=cli.SECRET_KEY||cli.SERVICE_ROLE_KEY;
const fetchOriginal=globalThis.fetch;globalThis.fetch=(url,init)=>{assert.equal(new URL(String(url)).origin,new URL(cli.API_URL).origin,'No provider/network calls permitted');return fetchOriginal(url,init)};
const {s8Repository,loadS8StructuredInput,readS8Structured,reserveS8Structured,s8Rpc}=await import('../lib/sec-s8/structuredPersistence.ts');
const {processS8Structured,analyzeS8StructuredJob,persistS8StructuredJob,enqueueS8Structured}=await import('../lib/sec-s8/structuredRuntime.ts');
const {runS8StructuredAnalyzerPreview}=await import('../lib/ai/s8StructuredAnalyzerPreview.ts');
const {s8MonitorFacts}=await import('../lib/monitor/s8StructuredFacts.ts');const {evaluateMonitorConditions}=await import('../lib/listingMonitorMatcher.ts');
const db=new pg.Client({connectionString:cli.DB_URL});await db.connect();const repo=await s8Repository();
const report={realGeminiCalls:0,primaryCalls:0,crashes:[],normal:[],safety:[]};const prefix='lease-20261002-';
try{
assert.equal((await db.query('select system_identifier::text id from pg_control_system()')).rows[0].id,'7678429483712069671');
async function fixture(label,name='Microsoft'){
 const accession={Microsoft:'0001193125-25-337056',Nautilus:'0001808805-26-000013',Lottery:'0001641172-25-017852'}[name];
 const rawId=(await db.query('select raw_item_id from sec_s8_registration_filings where accession_number=$1',[accession])).rows[0].raw_item_id;
 const key=prefix+label;const input=await reserveS8Structured(rawId,repo,key);assert.equal(input.reserved,true,'Test key already exists; inspect prior report instead of overwriting it');
 const job={executionId:input.executionId,rawItemId:rawId,verificationKey:key};let calls=0;
 const retained=json(resolve(frozenDir,name+'-result.json'));
 const analyze=async raw=>{calls++;return runS8StructuredAnalyzerPreview(raw,{model:'gemini-3.5-flash',runPrompt:async()=>structuredClone(retained.run)})};
 const state=async()=>{const a=(await db.query('select * from ai_runs where id=$1',[job.executionId])).rows[0];return {status:a.status,worker:a.metadata.worker,checkpoint:!!a.metadata.s8Checkpoint,outputs:Number((await db.query('select count(*) n from ai_outputs where ai_run_id=$1',[job.executionId])).rows[0].n)}};
 async function expire(){const n=await db.query("update ai_runs set metadata=jsonb_set(metadata,'{worker,leaseExpiresAt}',to_jsonb((clock_timestamp()-interval '1 second')::text),true) where id=$1 and metadata->'binding'->>'attempt'=$2 and status='running'",[job.executionId,'verification:'+key]);assert.equal(n.rowCount,1);}
 function crash(action,after){let armed=true;return {...repo,rpc:async(n,p)=>{if(armed&&((action==='claim'&&n==='claim_sec_s8_structured')||(n==='sec_s8_worker_transition'&&p.p_action===action))){armed=false;if(after)await s8Rpc(repo,n,p);throw Error('injected-process-loss:'+action)}return repo.rpc(n,p)}}}
 async function finish(extra={}){return processS8Structured(job,{repository:repo,analyze,...extra})}
 async function check(){const st=await state(),read=await readS8Structured(rawId,repo,key);assert.equal(st.status,'succeeded');assert.equal(st.outputs,1);assert.equal(read.status,'available');assert.deepEqual(read.semantic,retained.result.semantic);assert.deepEqual(read.direct.registrationRows,input.direct.facts.registrationRows);save(label+'-readback.json',read);const facts=s8MonitorFacts(read);for(const op of ['eq','in'])assert.equal(evaluateMonitorConditions({s8:facts,listing:{status:'not_ready',reason:'unused'},corporateAction:{status:'not_ready',reason:'unused'},ownership:{status:'not_ready',reason:'unused'}},[{key:'s8.filing_kind',operator:op,value:op==='eq'?read.semantic.filing_kind:[read.semantic.filing_kind]}],{evaluationDate:'2026-10-02'}).status,'match');return st;}
 return {job,input,analyze,state,expire,crash,finish,check,calls:()=>calls};
}
for(const [label,action,after] of [['T1','claim',true],['T2','provider_started',false],['T3','checkpoint',true],['T5','finish',true]]){
 const f=await fixture(label.toLowerCase());await assert.rejects(f.finish({repository:f.crash(action,after)}),/injected-process-loss/);const interrupted=await f.state(),firstCalls=f.calls();if(interrupted.status==='running')await f.expire();await f.finish();const final=await f.check();assert.equal(f.calls(),1);report.crashes.push({test:label,action,firstCalls,recoveryCalls:f.calls()-firstCalls,interrupted,final,executionId:f.job.executionId});save('report.json',report);
}
{
 const f=await fixture('t4');await analyzeS8StructuredJob(f.job,{repository:repo,analyze:f.analyze});const interrupted=await f.state();assert.equal(interrupted.checkpoint,true);await f.expire();await f.finish();const final=await f.check();assert.equal(f.calls(),1);report.crashes.push({test:'T4',action:'before persistence',firstCalls:1,recoveryCalls:0,interrupted,final});
}
{
 const f=await fixture('t6');const old=await s8Rpc(repo,'claim_sec_s8_structured',{p_id:f.job.executionId,p_raw_item_id:f.job.rawItemId});await f.expire();const results=await Promise.all([f.finish(),f.finish()]);assert.equal(results.filter(r=>r.status==='succeeded').length,1);assert.ok(results.some(r=>['busy','duplicate'].includes(r.status)));assert.equal(f.calls(),1);const final=await f.check();assert.equal((await s8Rpc(repo,'sec_s8_worker_transition',{p_id:f.job.executionId,p_raw_item_id:f.job.rawItemId,p_action:'claim'})).status,'duplicate');report.crashes.push({test:'T6',action:'two concurrent expired-lease deliveries',results,providerCalls:f.calls(),final});
}
{
 const f=await fixture('t7');await f.finish();assert.equal((await f.finish()).status,'duplicate');const queued=await enqueueS8Structured(f.job.rawItemId,{repository:repo,verificationKey:f.job.verificationKey,start:async()=>{throw Error('completed job must not schedule')}});assert.equal(queued.status,'duplicate');assert.equal(f.calls(),1);report.crashes.push({test:'T7',action:'complete replay',recoveryCalls:0,final:await f.check()});
}
{
 const f=await fixture('uncertain');await assert.rejects(f.finish({repository:f.crash('checkpoint',false)}),/injected-process-loss/);assert.equal(f.calls(),1);assert.equal((await f.state()).checkpoint,false);await f.expire();await f.finish();assert.equal(f.calls(),2);const final=await f.check();assert.equal(final.worker.uncertainProviderAttempts,1);report.crashes.push({test:'C',action:'provider returned but checkpoint not durable',firstCalls:1,recoveryCalls:1,final});
}
{
 const f=await fixture('fencing');const old=await s8Rpc(repo,'claim_sec_s8_structured',{p_id:f.job.executionId,p_raw_item_id:f.job.rawItemId});await f.expire();const current=await s8Rpc(repo,'claim_sec_s8_structured',{p_id:f.job.executionId,p_raw_item_id:f.job.rawItemId});assert.notEqual(old.token,current.token);await assert.rejects(s8Rpc(repo,'sec_s8_worker_transition',{p_id:f.job.executionId,p_raw_item_id:f.job.rawItemId,p_action:'provider_started',p_token:old.token}),/lease_lost/);await f.expire();await f.finish();report.safety.push({test:'old owner fenced',final:await f.check()});
}
{
 const f=await fixture('max-attempts');for(let i=0;i<4;i++){const c=await s8Rpc(repo,'claim_sec_s8_structured',{p_id:f.job.executionId,p_raw_item_id:f.job.rawItemId});assert.equal(c.claimed,true);await f.expire();}assert.equal((await f.finish()).status,'recovery_exhausted');const st=await f.state();assert.equal(st.status,'failed');assert.equal(st.outputs,0);assert.equal(f.calls(),0);report.safety.push({test:'max four claims',final:st});
}
{
 const f=await fixture('stale-checkpoint');const prepared=await analyzeS8StructuredJob(f.job,{repository:repo,analyze:f.analyze});await f.expire();const changedRepo={...repo,select:async(t,q)=>{const r=await repo.select(t,q);if(t==='raw_items'&&r.ok){r.data=structuredClone(r.data);r.data[0].raw_payload.filing_date='1900-01-01'}return r}};const result=await f.finish({repository:changedRepo});assert.equal(result.status,'stale');assert.equal(f.calls(),1);assert.equal((await readS8Structured(f.job.rawItemId,repo,f.job.verificationKey)).status,'unavailable');report.safety.push({test:'changed source binding unavailable (read injection only, SEC DB unchanged)',final:await f.state()});
}
{
 const f=await fixture('ambiguous-start');let starts=0;const opts={repository:repo,verificationKey:f.job.verificationKey,start:async()=>{starts++;throw Error('unknown start outcome')}};assert.equal((await enqueueS8Structured(f.job.rawItemId,opts)).status,'enqueue_uncertain');assert.equal((await enqueueS8Structured(f.job.rawItemId,opts)).status,'duplicate');assert.equal(starts,1);await db.query("update ai_runs set metadata=jsonb_set(metadata,'{scheduler,leaseExpiresAt}',to_jsonb((clock_timestamp()-interval '1 second')::text)) where id=$1 and metadata->'binding'->>'attempt'=$2",[f.job.executionId,'verification:'+f.job.verificationKey]);const r=await enqueueS8Structured(f.job.rawItemId,{...opts,start:async()=>({runId:'fault-injection-recovery-no-server'})});assert.equal(r.status,'enqueued');await f.finish();report.safety.push({test:'ambiguous scheduler expiry recovery',final:await f.check()});
}
for(const name of ['Microsoft','Nautilus','Lottery']){const f=await fixture('normal-'+name.toLowerCase(),name);await f.finish();const final=await f.check();await f.finish();assert.equal(f.calls(),1);report.normal.push({name,providerStubCalls:1,final});}
save('report.json',report);console.log(JSON.stringify({crashes:report.crashes.length,safety:report.safety.length,normal:report.normal.length,realGeminiCalls:0}));
}finally{await db.end()}
