// Bounded replay of the three frozen v6 outputs through real service-role persistence/readback.
// No Gemini credentials or provider request. Requires this task's migration already applied.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { registerHooks } from "node:module";
import { execFileSync } from "node:child_process";
import pg from "pg";
registerHooks({ resolve(s,c,next) { return s === "server-only" ? {shortCircuit:true,url:"data:text/javascript,export{}"} : next(s,c); } });
const [frozenDir,outDir] = process.argv.slice(2); assert.ok(frozenDir && outDir);
const out=resolve(outDir); assert.ok(relative(process.cwd(),out).startsWith("..") || isAbsolute(relative(process.cwd(),out)));
mkdirSync(out,{recursive:true});
const json=p=>JSON.parse(readFileSync(p,"utf8"));
const save=(n,v)=>writeFileSync(resolve(out,n),JSON.stringify(v,null,2));
const cli=JSON.parse(execFileSync(process.execPath,["node_modules/supabase/dist/supabase.js","status","-o","json"],{encoding:"utf8",stdio:["ignore","pipe","pipe"]}));
const target=new URL(cli.DB_URL); assert.equal(target.hostname,"127.0.0.1");assert.equal(target.port,"56322");
process.env.SUPABASE_URL=cli.API_URL;process.env.SUPABASE_SECRET_KEY=cli.SECRET_KEY || cli.SERVICE_ROLE_KEY;
process.env.SUPABASE_SERVICE_ROLE_KEY=cli.SERVICE_ROLE_KEY;
const originalFetch=globalThis.fetch;
globalThis.fetch=(url,init)=>{ assert.equal(new URL(String(url)).origin,new URL(cli.API_URL).origin,"Only local DB HTTP is allowed");return originalFetch(url,init); };
const db=new pg.Client({connectionString:cli.DB_URL});await db.connect();
const {loadS8StructuredInput,readS8Structured,s8Repository,s8ExecutionId}=await import("../lib/sec-s8/structuredPersistence.ts");
const {enqueueS8Structured,processS8Structured}=await import("../lib/sec-s8/structuredRuntime.ts");
const {s8MonitorFacts}=await import("../lib/monitor/s8StructuredFacts.ts");
const {evaluateMonitorConditions}=await import("../lib/listingMonitorMatcher.ts");
const {runS8StructuredAnalyzerPreview,buildS8StructuredPrompt}=await import("../lib/ai/s8StructuredAnalyzerPreview.ts");
const {hash,stable}=await import("../lib/sec-s8/directFacts.ts");
const report={target:"127.0.0.1:56322/postgres",mode:"frozen_response_replay",providerCalls:0,primaryCalls:0,cases:[],negativeChecks:[]};
const snapshot=async()=> (await db.query("select 'direct' scope,md5(coalesce(string_agg(row_to_json(t)::text,'' order by accession_number),'')) hash from sec_s8_registration_filings t union all select 'runs',md5(coalesce(string_agg(row_to_json(t)::text,'' order by id),'')) from ai_runs t where prompt_key<>'sec_s8_structured' union all select 'outputs',md5(coalesce(string_agg(row_to_json(t)::text,'' order by id),'')) from ai_outputs t where output_type<>'sec_s8_structured'")).rows;
try {
  assert.equal((await db.query("select system_identifier::text id from pg_control_system()")).rows[0].id,"7678429483712069671");
  report.before=await snapshot();
  const repo=await s8Repository();
  for(const [name,accession] of [["Microsoft","0001193125-25-337056"],["Nautilus","0001808805-26-000013"],["Lottery","0001641172-25-017852"]]) {
    const rawId=(await db.query("select raw_item_id from sec_s8_registration_filings where accession_number=$1",[accession])).rows[0]?.raw_item_id;assert.ok(rawId);
    const input=await loadS8StructuredInput(rawId,repo);
    assert.deepEqual(input.source,json(resolve(frozenDir,name+"-source-package.json")));
    const prompt=buildS8StructuredPrompt(input.source), request=json(resolve(frozenDir,name+"-request.json"));
    assert.equal(prompt.system,request.systemInstruction.parts[0].text);
    assert.equal(prompt.user,request.contents[0].parts[0].text);
    assert.deepEqual(prompt.responseFormat.json_schema,JSON.parse(request.contents[0].parts[0].text).output_contract);
    const retained=json(resolve(frozenDir,name+"-result.json"));
    const rawResponse=readFileSync(resolve(frozenDir,name+"-raw-response.json"),"utf8");
    const originalExecution=json(resolve(frozenDir,name+"-execution.json"));
    assert.equal(hash(retained.run.outputText),originalExecution.outputHash);
    let jobs=[],injections=0;
    const enqueued=await enqueueS8Structured(rawId,{repository:repo,start:async job=>{jobs.push(job);return {runId:"evidence-replay-"+job.executionId};}});
    if(enqueued.status==="enqueued") {
      assert.equal(jobs.length,1);
      const processed=await processS8Structured(jobs[0],{repository:repo,analyze:async raw=>{
        injections++;
        const result=await runS8StructuredAnalyzerPreview(raw,{model:"gemini-3.5-flash",runPrompt:async()=>structuredClone(retained.run)});
        assert.equal(result.stage,"complete");return result;
      }});
      assert.equal(processed.status,"succeeded");
    } else assert.equal(enqueued.status,"duplicate");
    const read=await readS8Structured(rawId,repo); assert.equal(read.status,"available");
    assert.deepEqual(read.semantic,retained.result.semantic);
    assert.deepEqual(read.direct.registrationRows,input.direct.facts.registrationRows);
    const facts=s8MonitorFacts(read);
    const match=evaluateMonitorConditions({s8:facts,listing:{status:"not_ready",reason:"unused"},
      corporateAction:{status:"not_ready",reason:"unused"},ownership:{status:"not_ready",reason:"unused"}},
      [{key:"s8.filing_kind",operator:"in",value:[read.semantic.filing_kind]}],{evaluationDate:"2026-10-02"});
    assert.equal(match.status,"match");
    const replay=await enqueueS8Structured(rawId,{repository:repo,start:async()=>{throw Error("duplicate start");}});
    assert.equal(replay.status,"duplicate");
    const duplicate=await processS8Structured({executionId:input.executionId,rawItemId:rawId},{repository:repo,analyze:async()=>{throw Error("duplicate analyze");}});
    assert.equal(duplicate.status,"duplicate");assert.deepEqual(await readS8Structured(rawId,repo),read);
    const records=(await db.query("select a.*,o.payload from ai_runs a join ai_outputs o on o.ai_run_id=a.id where a.id=$1",[input.executionId])).rows;
    assert.equal(records.length,1);assert.equal(records[0].event_id,null);
    save(name+"-readback.json",read);save(name+"-stored.json",records[0]);
    report.cases.push({name,accession,rawItemId:rawId,executionId:input.executionId,write:enqueued.status,
      injectedResponses:injections,providerCalls:0,sourceFingerprint:input.source.fingerprint,
      originalResponseSha256:hash(rawResponse),originalExecution,kind:read.semantic.filing_kind,
      directRowCount:read.direct.registrationRows.length,monitorMatch:match,replay:replay.status});
    // Transaction-only negative writes affect only these S8 executions; no source/direct row edits.
    await db.query("begin");await db.query("set local role service_role");
    async function rejected(label,sql,args) {
      await db.query("savepoint negative"); let failed=false;
      try {await db.query(sql,args);}catch{failed=true;}
      await db.query("rollback to savepoint negative");assert.ok(failed,label);report.negativeChecks.push(name+":"+label);
    }
    for(const [key,value] of [["accession","0000000001-26-000001"],["rawItemId","00000000-0000-4000-a000-000000000001"],["issuerCik","0000000001"],["sourceSha256","0".repeat(64)],["sourceFingerprint","0".repeat(64)]])
      await rejected("reject "+key,"select reserve_sec_s8_structured($1,$2)",[input.executionId,{...input.binding,[key]:value}]);
    const payload=records[0].payload;
    assert.equal((await db.query("select finish_sec_s8_structured($1,'succeeded',$2) result",[input.executionId,payload])).rows[0].result.replayed,true);
    await rejected("conflicting replacement","select finish_sec_s8_structured($1,'succeeded',$2)",[input.executionId,{...payload,outputText:"{}",outputSha256:hash("{}")}]);
    await rejected("immutable output update","update ai_outputs set payload='{}' where ai_run_id=$1",[input.executionId]);
    await rejected("immutable output delete","delete from ai_outputs where ai_run_id=$1",[input.executionId]);
    await rejected("terminal run immutable","update ai_runs set status='pending' where id=$1",[input.executionId]);
    const future={...input.binding,contractVersion:"s8_structured_v999"};
    const futureId=s8ExecutionId(rawId,input.source.fingerprint,future.contractVersion);
    assert.equal((await db.query("select reserve_sec_s8_structured($1,$2) result",[futureId,future])).rows[0].result.inserted,true);
    report.negativeChecks.push(name+":contract history separates (rolled back)");
    await db.query("rollback");
  }
  report.permissions=(await db.query("select has_function_privilege('anon','reserve_sec_s8_structured(uuid,jsonb)','EXECUTE') anon_rpc,has_function_privilege('authenticated','finish_sec_s8_structured(uuid,text,jsonb)','EXECUTE') user_rpc,has_table_privilege('anon','ai_outputs','SELECT') anon_output,has_table_privilege('authenticated','ai_runs','SELECT') user_run")).rows[0];
  assert.ok(Object.values(report.permissions).every(v=>v===false));
  report.after=await snapshot();assert.deepEqual(report.after,report.before);
  report.counts=(await db.query("select (select count(*) from ai_runs where prompt_key='sec_s8_structured') runs,(select count(*) from ai_outputs where output_type='sec_s8_structured') outputs")).rows[0];
  assert.equal(report.counts.runs,"3");assert.equal(report.counts.outputs,"3");
  report.status="PASS";
  console.log(JSON.stringify({status:report.status,cases:report.cases.map(c=>({name:c.name,kind:c.kind,replay:c.replay})),counts:report.counts,negativeChecks:report.negativeChecks.length,providerCalls:0}));
}catch(error){report.status="FAIL";report.error=String(error);throw error;}
finally{save("persistence-report.json",report);await db.end();}
