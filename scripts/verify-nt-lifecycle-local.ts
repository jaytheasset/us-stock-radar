/** Bounded local verification. No Primary/provider calls or external delivery.
 * Existing SEC/Primary records are reused; optional follow-up collection uses normal raw ingestion.
 * Usage: node --experimental-strip-types --experimental-loader <absolute resolve-ts-paths.mjs URL>
 *   scripts/verify-nt-lifecycle-local.ts <outside-repository evidence directory> [--ingest-followup]
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import pg from "pg";

const out = resolve(process.argv[2] || "");
const relation = relative(process.cwd(), out);
assert.ok(relation.startsWith("..") || isAbsolute(relation), "Evidence must be outside repository");
const cli = JSON.parse(execFileSync(process.execPath, ["node_modules/supabase/dist/supabase.js", "status", "-o", "json"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
const target = new URL(cli.DB_URL);
assert.equal(target.hostname,"127.0.0.1"); assert.equal(target.port,"56322");
process.env.SUPABASE_URL = cli.API_URL;
process.env.SUPABASE_SECRET_KEY = cli.SECRET_KEY || cli.SERVICE_ROLE_KEY;
process.env.SUPABASE_SERVICE_ROLE_KEY = cli.SERVICE_ROLE_KEY;
process.env.SUPABASE_PUBLISHABLE_KEY = cli.PUBLISHABLE_KEY || cli.ANON_KEY;
// Only the existing SEC contact setting is needed, never model/delivery credentials.
for (const line of readFileSync(".env.local","utf8").split(/\r?\n/)) {
  const m = line.match(/^SEC_USER_AGENT=(.*)$/); if (m) process.env.SEC_USER_AGENT=m[1].replace(/^["']|["']$/g,"");
}
const db = new pg.Client({ connectionString: cli.DB_URL }); await db.connect();
try {
  assert.equal((await db.query("select system_identifier::text id from pg_control_system()")).rows[0].id,"7678429483712069671");
  mkdirSync(out,{recursive:true});
  const record: Record<string,unknown> = { target:"127.0.0.1:56322/postgres", startedAt:new Date().toISOString(),
    primaryCalls:0,secondaryCalls:0,workflowTransport:"in-process verification through production starter and processor; no durable transport claim" };
  if (process.argv.includes("--ingest-followup")) {
    const {runSecRawIngest}=await import("../lib/secIngest.ts");
    const ingest=await runSecRawIngest({accessionNumber:"0001477932-26-005627",cik:"1729637",formTypes:["10-K"],limit:1,includeDocuments:true,attachmentLimit:0});
    record.ingest=ingest; save("ingest.json",ingest); assert.equal(ingest.ok,true);
  }
  const {buildGenericMonitorPrimaryExecutionContext,enqueueGenericMonitorChildrenAfterPrimary}=await import("../lib/monitor/genericMonitorChildWorkflowStarter.ts");
  const {processGenericMonitorChild}=await import("../lib/monitor/genericMonitorChildRuntime.ts");
  const {readCurrentNtLifecycle}=await import("../lib/monitor/ntLifecycleRuntime.ts");
  const {evaluateMonitorConditions}=await import("../lib/listingMonitorMatcher.ts");
  const {createListingMonitor,listListingMonitorsForOwner}=await import("../lib/monitor/listingMonitorPersistence.ts");
  const {consumeListingMonitorAlertsForEvent}=await import("../lib/monitor/listingMonitorAlertConsumer.ts");
  const ownerId="d2f2c6ce-64fa-40d6-a0b6-7e42e1fa0d32";
  assert.equal((await db.query("select count(*)::int n from auth.users where id=$1 and email like 'sr-review-user-%@example.test'",[ownerId])).rows[0].n,1);
  const monitors: Awaited<ReturnType<typeof createListingMonitor>>[]=[];
  for(const key of ["nt.notice_filed","nt.report_filed"]){
    const conditions=[{key,operator:"eq",value:true},{key:"nt.issuer_cik",operator:"eq",value:"0001729637"}];
    const existing=(await listListingMonitorsForOwner(ownerId)).monitors.find(m=>m.conditions.length===2
      && m.conditions.some(c=>c.key===key&&c.value===true)&&m.conditions.some(c=>c.key==="nt.issuer_cik"&&c.value==="0001729637"));
    monitors.push(existing??await createListingMonitor({ownerId,conditions}));
  }
  record.testMonitorIds=monitors.map(m=>m.id);
  const cases=[];
  for(const accession of ["0001477932-26-005311","0001493152-26-040484"]){
    const rows=(await db.query(`select r.*,e.id event_id,a.id parent_id,a.prompt_key,a.prompt_version
      from raw_items r join events e on e.raw_item_id=r.id join ai_runs a on a.event_id=e.id
      where r.source_unique_id=$1 and a.prompt_key='sec_nt_analysis' and a.status='completed'
      order by a.finished_at desc limit 1`,[accession])).rows;
    assert.equal(rows.length,1);const row=rows[0];
    const primary=buildGenericMonitorPrimaryExecutionContext({eventId:row.event_id,rawItemId:row.id,sourceGroup:"filings",sourceCode:"sec_edgar",
      sourceIdentity:accession,parentPrimaryAiRunId:row.parent_id,parentPromptKey:row.prompt_key,parentPromptVersion:row.prompt_version,secFormType:row.raw_payload.form_type});
    let processing: unknown;
    const enqueue=await enqueueGenericMonitorChildrenAfterPrimary({primary,primaryAnalysis:{},dependencies:{startWorkflow:async(_workflow,[identity])=>{
      processing=await processGenericMonitorChild(identity);return{runId:`nt-local-verification-${identity.executionId}`};
    }}});
    const first=await readCurrentNtLifecycle(row.event_id);
    assert.equal(first.status,"available",JSON.stringify(first));if(first.status!=="available")throw Error("reader failed");
    const readers={nt:first,listing:{status:"not_ready" as const,reason:"not_requested"},corporateAction:{status:"not_ready" as const,reason:"not_requested"},ownership:{status:"not_ready" as const,reason:"not_requested"}};
    const evaluations=["nt.notice_filed","nt.report_filed"].map(key=>({key,result:evaluateMonitorConditions(readers,[{key,operator:"eq",value:true}],{evaluationDate:new Date().toISOString().slice(0,10)})}));
    const consumer=await consumeListingMonitorAlertsForEvent({eventId:row.event_id});
    if(accession==="0001477932-26-005311")for(const monitor of monitors){
      const actual=consumer.evaluations.find(e=>e.monitorId===monitor.id);
      assert.equal(actual?.reasonCode,monitor.conditions.some(c=>c.key==="nt.report_filed") ? "fact_unavailable" : "monitor_activation_not_met");
    }
    const before=await counts(row.event_id);
    const rerun=await enqueueGenericMonitorChildrenAfterPrimary({primary,primaryAnalysis:{},dependencies:{startWorkflow:async()=>{throw Error("Duplicate workflow must not restart");}}});
    assert.equal(rerun.status,"duplicate");assert.deepEqual(await counts(row.event_id),before);
    assert.deepEqual(await readCurrentNtLifecycle(row.event_id),first);
    if(accession==="0001477932-26-005311" && process.argv.includes("--ingest-followup")) assert.equal(first.facts.followUp.report?.accession,"0001477932-26-005627");
    if(accession==="0001493152-26-040484")assert.equal(first.facts.followUp.status,"unresolved");
    cases.push({accession,eventId:row.event_id,parentPrimaryAiRunId:row.parent_id,enqueue,processing,readback:first,evaluations,consumer,rerun,counts:before});
    save(`${accession}-source.json`,row.raw_payload);
  }
  record.cases=cases;record.finishedAt=new Date().toISOString();save("result.json",record);
  console.log(JSON.stringify({evidence:out,cases:cases.map(c=>({accession:c.accession,enqueue:c.enqueue.status,followUp:c.readback.facts.followUp.status,counts:c.counts}))}));
} finally { await db.end(); }
async function counts(eventId:string){return(await db.query(`select
  (select count(*)::int from ai_runs where event_id=$1 and metadata->>'monitor_analyzer_key'='nt_lifecycle') runs,
  (select count(*)::int from ai_outputs where event_id=$1 and payload->>'monitor_analyzer_key'='nt_lifecycle') outputs,
  (select count(*)::int from user_alert_deliveries where alert_event_id=$1) alerts`,[eventId])).rows[0];}
function save(name:string,value:unknown){const s=JSON.stringify(value,null,2)+"\n";writeFileSync(resolve(out,name),s);writeFileSync(resolve(out,`${name}.sha256`),createHash("sha256").update(s).digest("hex")+"\n");}
