import test from "node:test";
import assert from "node:assert/strict";
import { buildNtLifecycleChildIdentity, GENERIC_MONITOR_CHILD_OUTPUT_TYPE, GENERIC_MONITOR_CHILD_OUTPUT_SCHEMA_VERSION } from "./genericMonitorChildExecution.ts";
import { genericMonitorChildMetadata } from "./genericMonitorChildRepository.ts";
import { readCurrentNtLifecycle, resolveNtLifecycle } from "./ntLifecycleRuntime.ts";
import { readNtLifecycleSource, buildNtLifecycleFacts } from "./ntLifecycle.ts";

const eventId="90000000-0000-4000-8000-000000000001",rawItemId="90000000-0000-4000-8000-000000000002";
const accession="0000000001-26-000001";
const source={id:rawItemId,source_unique_id:accession,source_code:"sec_edgar",raw_payload:{form_type:"NT 10-Q",cik:"1",accession_number:accession,filing_date:"2026-08-17",
  primary_document_url:`https://www.sec.gov/Archives/edgar/data/1/${accession.replaceAll("-","")}/notice.htm`,
  primary_document_html:"FORM 12b-25 NOTIFICATION OF LATE FILING [X] Form 10-Q For Period Ended: June 30, 2026 PART I REGISTRANT INFORMATION Test PART III NARRATIVE More time is required. PART IV OTHER INFORMATION"}};
const identity=buildNtLifecycleChildIdentity({primary:{eventId,rawItemId,sourceFamily:"sec_nt",sourceGroup:"filings",sourceCode:"sec_edgar",sourceIdentity:accession,
  parentPrimaryAiRunId:"90000000-0000-4000-8000-000000000003",parentPromptKey:"sec_nt_analysis",parentPromptVersion:"v1"}});
function harness(){
  const raw=structuredClone(source);
  const run={id:identity.executionId,status:"completed",finished_at:"2026-10-01T00:00:00Z",metadata:genericMonitorChildMetadata(identity,"succeeded_applicable")};
  const output={event_id:eventId,payload:{schema_version:GENERIC_MONITOR_CHILD_OUTPUT_SCHEMA_VERSION,execution_id:run.id,parent_primary_ai_run_id:identity.parentPrimaryAiRunId,
    monitor_analyzer_key:identity.monitorAnalyzerKey,analyzer_contract_version:identity.analyzerContractVersion,result_classification:"succeeded_applicable",
    analysis:buildNtLifecycleFacts(readNtLifecycleSource(raw),[])}};
  let current=true;
  const select=async(table:string)=>({ok:true,status:200,count:null,error:undefined,data:table==="events"?[{id:eventId,raw_item_id:rawItemId}]:table==="ai_runs"?[run]:table==="ai_outputs"?[output]:[raw]});
  const loadExactParent=async()=>({rawItem:raw,analysis:{},aiRun:{},aiOutput:{},event:{},currentness:current
    ? {status:"current" as const,latestPrimaryAiRunId:identity.parentPrimaryAiRunId}
    : {status:"stale" as const,latestPrimaryAiRunId:"replacement"}});
  return {raw,run,output,select,loadExactParent,stale(){current=false;}};
}
test("official NT reader accepts only the persisted exact current deterministic result",async()=>{
  const h=harness();const first=await readCurrentNtLifecycle(eventId,h);assert.equal(first.status,"available");
  assert.deepEqual(await readCurrentNtLifecycle(eventId,h),first);
});
test("forged completion or mutated retained evidence cannot pass official readback",async()=>{
  const h=harness();h.output.payload.analysis.reportFiled=true;
  assert.deepEqual(await readCurrentNtLifecycle(eventId,h),{status:"not_ready",reason:"source_or_lifecycle_evidence_changed"});
  const changed=harness();changed.raw.raw_payload.primary_document_html+=" Changed source";
  assert.equal((await readCurrentNtLifecycle(eventId,changed)).status,"not_ready");
});
test("wrong parent output, incomplete child and stale Primary fail closed",async()=>{
  const wrong=harness();wrong.output.payload.parent_primary_ai_run_id="different";
  assert.equal((await readCurrentNtLifecycle(eventId,wrong)).status,"not_ready");
  const incomplete=harness();incomplete.run.status="running";
  assert.equal((await readCurrentNtLifecycle(eventId,incomplete)).status,"not_ready");
  const stale=harness();stale.stale();assert.equal((await readCurrentNtLifecycle(eventId,stale)).status,"not_ready");
});
test("an unreadable possible counterpart does not erase a valid NT notice or invent completion",async()=>{
  const h=harness();const resolved=await resolveNtLifecycle(h.raw,async()=>({ok:true,status:200,count:null,error:undefined,data:[h.raw,{id:"invalid",raw_payload:{form_type:"10-Q",cik:"1"}}]}));
  assert.equal(resolved.noticeFiled,true);assert.equal(resolved.reportFiled,null);
  assert.equal(resolved.followUp.reason,"candidate_source_unavailable:invalid");
});
test("candidate read failure is unavailable, not a report-not-filed assertion",async()=>{
  await assert.rejects(resolveNtLifecycle(source,async()=>({ok:false,status:503,count:null,data:null,error:"unavailable"})),/reader_unavailable/);
});
test("production child output type remains the existing generic Monitor type",()=>{
  assert.equal(GENERIC_MONITOR_CHILD_OUTPUT_TYPE,"domain_monitor_child_execution_result");
});
