// Real local Workflow queue/HTTP steps + real Supabase. Provider mode is controlled by an external preload.
// Run only in the authorized candidate with its review server and preserved evidence directory.
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,existsSync} from "node:fs";
import {resolve} from "node:path";
import {execFileSync} from "node:child_process";
import {registerHooks} from "node:module";
import pg from "pg";
registerHooks({resolve(s,c,next){return s==='server-only'?{shortCircuit:true,url:'data:text/javascript,export{}'}:next(s,c)}});
const [mode,outDir,frozenDir,verificationPrefix="durable-20261002"]=process.argv.slice(2);assert.ok(['stub','canary'].includes(mode));
const out=resolve(outDir);assert.ok(!out.startsWith(process.cwd()));
const save=(n,v)=>writeFileSync(resolve(out,n),JSON.stringify(v,null,2));
const json=p=>JSON.parse(readFileSync(p,'utf8'));
const cli=JSON.parse(execFileSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
assert.equal(new URL(cli.DB_URL).hostname,'127.0.0.1');assert.equal(new URL(cli.DB_URL).port,'56322');
process.env.SUPABASE_URL=cli.API_URL;process.env.SUPABASE_SECRET_KEY=cli.SECRET_KEY||cli.SERVICE_ROLE_KEY;
process.env.WORKFLOW_LOCAL_BASE_URL='http://127.0.0.1:3113';process.env.WORKFLOW_LOCAL_DATA_DIR=resolve('.next/workflow-data');
const {start,getRun}=await import('workflow/api');
const {enqueueS8Structured,processS8Structured}=await import('../lib/sec-s8/structuredRuntime.ts');
const {loadS8StructuredInput,readS8Structured,s8Repository}=await import('../lib/sec-s8/structuredPersistence.ts');
const {s8MonitorFacts}=await import('../lib/monitor/s8StructuredFacts.ts');
const {evaluateMonitorConditions}=await import('../lib/listingMonitorMatcher.ts');
const {buildS8StructuredPrompt}=await import('../lib/ai/s8StructuredAnalyzerPreview.ts');
const {hash}=await import('../lib/sec-s8/directFacts.ts');
const db=new pg.Client({connectionString:cli.DB_URL});await db.connect();
const report={mode,providerCalls:0,primaryCalls:0,cases:[]};
try{
assert.equal((await db.query('select system_identifier::text id from pg_control_system()')).rows[0].id,'7678429483712069671');
if(mode==='canary'){const stubs=json(out+'/stub-report.json');assert.equal(stubs.cases.length,3);assert.ok(stubs.cases.every(c=>c.status==='succeeded'));}
const manifest=json('app/.well-known/workflow/v1/manifest.json');
const descriptor=manifest.workflows['workflows/s8-structured.ts'].s8StructuredWorkflow;
assert.ok(descriptor.workflowId);
const repo=await s8Repository();const cases=[['Microsoft','0001193125-25-337056'],['Nautilus','0001808805-26-000013'],['Lottery','0001641172-25-017852']];
for(const [name,accession] of mode==='canary'?cases.slice(0,1):cases){
 const verificationKey=verificationPrefix+'-'+mode;
 const rawId=(await db.query('select raw_item_id from sec_s8_registration_filings where accession_number=$1',[accession])).rows[0].raw_item_id;
 const input=await loadS8StructuredInput(rawId,repo,verificationKey);
 assert.deepEqual(input.source,json(resolve(frozenDir,name+'-source-package.json')));
 const p=buildS8StructuredPrompt(input.source),previous=json(resolve(frozenDir,name+'-request.json'));
 assert.equal(p.system,previous.systemInstruction.parts[0].text);assert.equal(p.user,previous.contents[0].parts[0].text);
 let starts=0;
 // Genuine Workflow start via the compiler-generated metadata; no direct worker or analyzer injection.
 const opts={repository:repo,verificationKey,start:async job=>{starts++;return start({workflowId:descriptor.workflowId},[job]);}};
 let enqueued=await enqueueS8Structured(rawId,opts);
 if(enqueued.status==='duplicate' && existsSync(out+'/'+mode+'-'+name+'-enqueue.json')) enqueued=json(out+'/'+mode+'-'+name+'-enqueue.json');
 else save(mode+'-'+name+'-enqueue.json',enqueued);
 assert.equal(enqueued.status,'enqueued');
 const second=await enqueueS8Structured(rawId,opts);assert.equal(second.status,'duplicate');assert.ok(starts<=1);
 const run=getRun(enqueued.workflowRunId);let status='pending';const began=Date.now();
 while(Date.now()-began<240000){status=await run.status;if(['completed','failed','cancelled'].includes(status))break;await new Promise(r=>setTimeout(r,1000));}
 save(mode+'-'+name+'-workflow-status.json',{runId:enqueued.workflowRunId,status,elapsedMs:Date.now()-began});
 assert.equal(status,'completed');const returned=await run.returnValue;assert.equal(returned.status,'succeeded');
 const read=await readS8Structured(rawId,repo,verificationKey);save(mode+'-'+name+'-readback.json',read);assert.equal(read.status,'available');
 assert.deepEqual(read.direct.registrationRows,input.direct.facts.registrationRows);
 if(mode==='stub')assert.deepEqual(read.semantic,json(resolve(frozenDir,name+'-result.json')).result.semantic);
 const facts=s8MonitorFacts(read),readerSet={s8:facts,listing:{status:'not_ready',reason:'unused'},corporateAction:{status:'not_ready',reason:'unused'},ownership:{status:'not_ready',reason:'unused'}};
 const eq=evaluateMonitorConditions(readerSet,[{key:'s8.filing_kind',operator:'eq',value:read.semantic.filing_kind}],{evaluationDate:'2026-10-02'});
 const ins=evaluateMonitorConditions(readerSet,[{key:'s8.filing_kind',operator:'in',value:[read.semantic.filing_kind]}],{evaluationDate:'2026-10-02'});
 assert.equal(eq.status,'match');assert.equal(ins.status,'match');
 assert.equal((await processS8Structured({executionId:input.executionId,rawItemId:rawId,verificationKey},{repository:repo,analyze:async()=>{throw Error('Duplicate must not analyze')}})).status,'duplicate');
 const stored=(await db.query("select a.*,o.payload,o.id output_id from ai_runs a join ai_outputs o on o.ai_run_id=a.id where a.id=$1",[input.executionId])).rows;assert.equal(stored.length,1);save(mode+'-'+name+'-stored.json',stored[0]);
 assert.equal((await db.query("select finish_sec_s8_structured($1,'succeeded',$2) result",[input.executionId,stored[0].payload])).rows[0].result.replayed,true);
 assert.deepEqual(await readS8Structured(rawId,repo,verificationKey),read);
 assert.equal((await readS8Structured(rawId,repo)).provenance.executionId, (await loadS8StructuredInput(rawId,repo)).executionId);
 const request=json(out+'/'+mode+'-'+name+'-request.json');assert.equal(request.systemInstruction.parts[0].text,p.system);assert.equal(request.contents[0].parts[0].text,p.user);
 const transport=json(out+'/'+mode+'-'+name+'-transport.json');
 report.cases.push({name,accession,executionId:input.executionId,workflowRunId:enqueued.workflowRunId,status:returned.status,providerCalls:mode==='canary'?1:0,stubResponses:mode==='stub'?1:0,transport,usage:stored[0].usage,semantic:read.semantic,eq,in:ins,duplicateEnqueue:second.status,duplicateClaim:'duplicate',exactReplay:true,promptHash:hash(p.system)});
 save(mode+'-report.json',report);console.log(name+' '+mode+' completed/readback/matcher PASS');
}
report.providerCalls=mode==='canary'?1:0;save(mode+'-report.json',report);
}catch(e){report.error=e.message;save(mode+'-report.json',report);throw e}finally{await db.end()}
process.exit(0);
