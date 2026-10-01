import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildNtLifecycleFacts, readNtLifecycleSource, type NtSource } from "./ntLifecycle.ts";
import { buildGenericMonitorPrimaryExecutionContext, enqueueGenericMonitorChildrenAfterPrimary } from "./genericMonitorChildWorkflowStarter.ts";
import { evaluateMonitorConditions } from "../listingMonitorMatcher.ts";
import { consumeListingMonitorAlertsForEvent } from "./listingMonitorAlertConsumer.ts";

const accession = "0000000001-26-000001";
const fixture = JSON.parse(readFileSync(new URL("../sources/sec/forms/nt/fixtures/routine-nt-10q.json", import.meta.url), "utf8"));
function raw(overrides: Record<string, unknown> = {}) {
  return { id: "90000000-0000-4000-8000-000000000001", source_code: "sec_edgar", source_unique_id: accession,
    raw_payload: { accession_number: accession, cik: "1", form_type: "NT 10-Q", filing_date: "2026-08-17",
      primary_document_url: `https://www.sec.gov/Archives/edgar/data/1/${accession.replaceAll("-", "")}/notice.htm`,
      primary_document_html: fixture.source.filingText.replace("PART III", "For Period Ended: March 31, 2026\nPART III"), ...overrides } };
}
function pair() {
  const notice = readNtLifecycleSource(raw());
  const report: NtSource = { ...notice, rawItemId: "90000000-0000-4000-8000-000000000002", accession: "0000000001-26-000002",
    form: "10-Q", notice: false, filedDate: "2026-08-20" };
  return { notice, report };
}
test("NT source preserves direct facts, never promotes extension/Part IV to a deadline or completion", () => {
  const { notice } = pair();
  assert.equal(notice.notice, true); assert.equal(notice.reportForm, "10-Q");
  assert.equal(notice.linkEligible, true);
  const result = buildNtLifecycleFacts(notice, []);
  assert.equal(result.noticeFiled, true); assert.equal(result.reportFiled, null);
  assert.equal(result.followUp.status, "unresolved");
  assert.equal("dueDate" in result, false); assert.equal("extensionDays" in result, false);
});
test("unique issuer, form, explicit period and strictly later filing day link both directions", () => {
  const { notice, report } = pair();
  for (const current of [notice, report]) {
    const result = buildNtLifecycleFacts(current, [notice, report]);
    assert.equal(result.followUp.status, "linked"); assert.equal(result.reportFiled, current.notice ? null : true);
    assert.equal(result.followUp.notice?.accession, notice.accession);
    assert.equal(result.followUp.report?.accession, report.accession);
  }
});
test("wrong issuer/period/form, same-day/earlier report and amendments never prove completion", () => {
  const { notice, report } = pair();
  for (const change of [{issuerCik:"0000000002"},{reportPeriod:"2000-01-01"},{reportForm:"20-F"},
    {filedDate:notice.filedDate},{filedDate:"2020-01-01"},{amendment:true,linkEligible:false,issues:["amendment_link_unresolved"]}]) {
    assert.equal(buildNtLifecycleFacts(notice, [{...report,...change}]).reportFiled, null, JSON.stringify(change));
  }
  assert.equal(buildNtLifecycleFacts(notice, [report, {...report,accession:"0000000001-26-000003"}]).followUp.reason, "multiple_counterparts");
  assert.equal(buildNtLifecycleFacts(notice, [notice,{...notice,sourceHash:"conflict"},report]).followUp.reason,"conflicting_accession_evidence");
});
test("conflicting or absent filing dates and CIK are rejected; period conflicts remain unresolved", () => {
  for (const changes of [{filed_date:"2026-08-18"},{filing_date:""},{filing_date:"2026-02-30"},{issuer_cik:"2"}]) {
    assert.throws(() => readNtLifecycleSource(raw(changes)), /identity/);
  }
  const s = readNtLifecycleSource(raw({period_of_report:"2000-01-01"}));
  assert.equal(s.linkEligible, false); assert.equal(s.reportPeriod, null);
});
test("periodic source accepts explicit DEI date but never a filename date", () => {
  const report = readNtLifecycleSource(raw({ form_type:"10-Q", primary_document_html:'<ix:nonNumeric name="dei:DocumentPeriodEndDate" contextRef="c">2026-06-30</ix:nonNumeric>' }));
  assert.equal(report.reportPeriod,"2026-06-30");
  const noPeriod = readNtLifecycleSource(raw({form_type:"10-Q",primary_document_html:"Annual report"}));
  assert.equal(noPeriod.reportPeriod,null);
  const rendered = readNtLifecycleSource(raw({form_type:"10-Q",primary_document_html:"Annual report",
    periodic_report_core_xbrl_facts:[{name:"dei:DocumentPeriodEndDate",value:"June 30, 2026",contextRef:"c",sourceDocument:"report.htm",hasDimensions:false}]}));
  assert.equal(rendered.reportPeriod,"2026-06-30");
});
test("existing matcher treats unobserved follow-up as unavailable, including eq false", () => {
  const { notice } = pair();
  const facts=buildNtLifecycleFacts(notice,[]);
  const readers={listing:{status:"not_ready" as const,reason:"not_requested"},corporateAction:{status:"not_ready" as const,reason:"not_requested"},ownership:{status:"not_ready" as const,reason:"not_requested"},
    nt:{status:"available" as const,eventId:"e",rawItemId:"r",sourceExecutionId:"s",persistedAt:"2026-08-20",filedAt:notice.filedDate,facts}};
  for(const value of [true,false]) assert.equal(evaluateMonitorConditions(readers,[{key:"nt.report_filed",operator:"eq",value}],{evaluationDate:"2026-08-20"}).reasonCode,"fact_unavailable");
  assert.equal(evaluateMonitorConditions(readers,[{key:"nt.notice_filed",operator:"eq",value:true}],{evaluationDate:"2026-08-20"}).status,"match");
});
test("normal Primary starter mechanically schedules all NT forms without GPT routes, dedupes starts", async () => {
  for(const form of ["NT 10-K","NT 10-Q","NT 20-F","NT 10-K/A","NT 10-Q/A","NT 20-F/A"]){
    const primary=buildGenericMonitorPrimaryExecutionContext({eventId:"90000000-0000-4000-8000-000000000001",rawItemId:"90000000-0000-4000-8000-000000000002",parentPrimaryAiRunId:"90000000-0000-4000-8000-000000000003",sourceGroup:"filings",sourceCode:"sec_edgar",sourceIdentity:accession,parentPromptKey:"sec_nt_analysis",parentPromptVersion:"v1",secFormType:form});
    let started=0;const claimed=new Set<string>();
    const repository={reserve:async(i:{jobId:string})=>({reserved:true,jobId:i.jobId}),claimWorkflowStart:async(i:{jobId:string})=>{if(claimed.has(i.jobId))return false;claimed.add(i.jobId);return true;},releaseWorkflowStart:async()=>{},attachWorkflowRun:async()=>{}};
    const input={primary,primaryAnalysis:{},dependencies:{repository,startWorkflow:async()=>{started++;return{runId:"test"};}}};
    assert.equal((await enqueueGenericMonitorChildrenAfterPrimary(input)).status,"enqueued");
    assert.equal((await enqueueGenericMonitorChildrenAfterPrimary(input)).status,"duplicate");assert.equal(started,1);
  }
});
test("existing consumer activation and dedupe: historical facts match but do not alert newer monitors", async () => {
  const {notice}=pair();const facts=buildNtLifecycleFacts(notice,[]);let writes=0;
  const old={id:"old",userId:"user",domain:"listing" as const,conditions:[{key:"nt.notice_filed",operator:"eq" as const,value:true}],isActive:true,createdAt:"2026-01-01",updatedAt:"2026-01-01"};
  const dependencies={listActiveMonitors:async()=>({monitors:[old,{...old,id:"new",createdAt:"2026-09-01"}],diagnostics:[]}),
    readNtFacts:async()=>({status:"available" as const,eventId:"e",rawItemId:"r",sourceExecutionId:"s",persistedAt:"2026-10-01",filedAt:notice.filedDate,facts}),
    createAlert:async(i:{monitorId:string})=>({status:++writes===1?"created" as const:"existing" as const,monitorId:i.monitorId}),now:()=>new Date("2026-10-01")};
  const first=await consumeListingMonitorAlertsForEvent({eventId:"e"},dependencies);
  assert.equal(first.createdCount,1);assert.equal(first.evaluations.find(e=>e.monitorId==="new")?.reasonCode,"monitor_activation_not_met");
  assert.equal((await consumeListingMonitorAlertsForEvent({eventId:"e"},dependencies)).existingCount,1);
});

test("report completion alerts belong to the report event, never both notice and report",async()=>{
  const {notice,report}=pair();let facts=buildNtLifecycleFacts(notice,[report]);let writes=0;
  const dependencies={listActiveMonitors:async()=>({monitors:[{id:"m",userId:"u",domain:"listing" as const,
    conditions:[{key:"nt.report_filed",operator:"eq" as const,value:true}],isActive:true,createdAt:"2026-01-01",updatedAt:"2026-01-01"}],diagnostics:[]}),
    readNtFacts:async()=>({status:"available" as const,eventId:"e",rawItemId:"r",sourceExecutionId:"s",persistedAt:"2026-10-01",filedAt:facts.source.filedDate,facts}),
    createAlert:async(i:{monitorId:string})=>({status:++writes===1?"created" as const:"existing" as const,monitorId:i.monitorId}),now:()=>new Date("2026-10-01")};
  assert.equal((await consumeListingMonitorAlertsForEvent({eventId:"notice"},dependencies)).createdCount,0);
  facts=buildNtLifecycleFacts(report,[notice]);
  assert.equal((await consumeListingMonitorAlertsForEvent({eventId:"report"},dependencies)).createdCount,1);
  assert.equal((await consumeListingMonitorAlertsForEvent({eventId:"report"},dependencies)).existingCount,1);
});
