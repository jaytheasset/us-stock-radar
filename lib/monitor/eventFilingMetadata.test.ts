import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { projectEventFilingMetadata, readEventFilingMetadata, registrationFilingAlertText, REGISTRATION_FILING_FORMS } from "./eventFilingMetadata.ts";
import { evaluateMonitorConditions, evaluateListingMonitorEvent } from "../listingMonitorMatcher.ts";
import { parseListingMonitorCreateRequest } from "./listingMonitorApi.ts";
import { createListingMonitor, type ListingMonitor } from "./listingMonitorPersistence.ts";
import { consumeListingMonitorAlertsForEvent, type ListingMonitorAlertConsumerDependencies } from "./listingMonitorAlertConsumer.ts";

const E="11000000-0000-4000-8000-000000000001", R="11000000-0000-4000-8000-000000000002", X="11000000-0000-4000-8000-000000000003";
const M="11000000-0000-4000-8000-000000000004", U="11000000-0000-4000-8000-000000000005";
const accession="0000000001-26-000001";
function fixture(form="S-4") {
  return {event:{id:E,raw_item_id:R,source_code:"sec_edgar"},
    raw:{id:R,source_code:"sec_edgar",source_group:"filings",source_unique_id:accession,
      raw_payload:{form_type:form,accession_number:accession,cik:"1",filing_date:"2026-06-01",primary_document_url:`https://www.sec.gov/Archives/edgar/data/1/${accession.replaceAll("-","")}/filing.htm`}},
    run:{id:X,event_id:E,raw_item_id:R,prompt_key:"sec_s4_f4_analysis",status:"completed",finished_at:"2026-06-01T18:00:00Z"}};
}
const condition=(value:unknown,operator="eq")=>({key:"event.sec_form",operator,value});
const project=(f=fixture())=>projectEventFilingMetadata(f.event,f.raw,f.run);
const readers=(filing=project())=>({filing,listing:{status:"not_ready" as const,reason:"unused"},corporateAction:{status:"not_ready" as const,reason:"unused"},ownership:{status:"not_ready" as const,reason:"unused"}});

test("exact four forms reuse API validation and generic matcher, without semantic classifications",()=>{
  for(const form of REGISTRATION_FILING_FORMS){
    const f=fixture(form),read=project(f);
    assert.equal(read.status,"available");
    assert.equal(parseListingMonitorCreateRequest({conditions:[condition(form)]}).ok,true);
    for(const expected of REGISTRATION_FILING_FORMS){
      assert.equal(evaluateMonitorConditions(readers(read),[condition(expected)],{evaluationDate:"2026-06-02"}).status,
        form===expected?"match":"no_match");
    }
    assert.equal(evaluateMonitorConditions(readers(read),[condition([form],"in")],{evaluationDate:"2026-06-02"}).status,"match");
    assert.match(registrationFilingAlertText(form).title,/registration .*filed/);
    assert.doesNotMatch(registrationFilingAlertText(form).title,/merger|completed|terms changed/i);
  }
  for(const value of ["425","EFFECT","S-4*","merger","S-8",null])assert.equal(parseListingMonitorCreateRequest({conditions:[condition(value)]}).ok,false);
  assert.equal(parseListingMonitorCreateRequest({conditions:[condition("S-4","neq")]}).ok,false);
});

test("missing or conflicting source metadata fails closed; analysis values are irrelevant",()=>{
  const bad = [
    (f:ReturnType<typeof fixture>)=>{f.raw.raw_payload.filing_date="2026-02-30";},
    (f:ReturnType<typeof fixture>)=>{f.raw.raw_payload.filing_date="";},
    (f:ReturnType<typeof fixture>)=>{f.raw.source_unique_id="0000000001-26-000002";},
    (f:ReturnType<typeof fixture>)=>{f.raw.raw_payload.form_type="EFFECT";},
    (f:ReturnType<typeof fixture>)=>{f.raw.raw_payload.cik="2";},
    (f:ReturnType<typeof fixture>)=>{f.raw.raw_payload.primary_document_url="https://example.com/filing.htm";},
    (f:ReturnType<typeof fixture>)=>{f.event.raw_item_id=X;},
    (f:ReturnType<typeof fixture>)=>{f.run.raw_item_id=X;},
    (f:ReturnType<typeof fixture>)=>{f.run.status="failed";},
  ];
  for(const mutate of bad){const f=fixture();mutate(f);assert.equal(project(f).status,"not_ready");}
  const f=fixture();assert.deepEqual(projectEventFilingMetadata({...f.event,score:100,summary:"different merger",metadata:{form_type:"F-4/A"}},f.raw,f.run),project(f));
});

test("reader selects metadata columns only, binds raw accession and execution; no HTML/Primary output read",async()=>{
  const f=fixture(),queries:string[]=[];
  const read=await readEventFilingMetadata(E,{async supabaseSelect(table,query){
    queries.push(query.select);assert.ok(!query.select.includes("primary_document_html"));
    const row=table==="events"?f.event:table==="raw_items"?{...f.raw,...f.raw.raw_payload}:f.run;
    return {ok:true,data:[row]};
  }});
  assert.deepEqual(read,project(f));assert.equal(queries.length,3);
  assert.ok(queries.every(s=>!s.includes("summary")&&!s.includes("output")&&!s.split(",").includes("raw_payload")));
  const evaluated=await evaluateListingMonitorEvent({eventId:E,evaluationDate:"2026-06-02",conditionSets:[{id:M,conditions:[condition("S-4")]}]},
    {readFilingMetadata:async()=>read,now:()=>new Date("2026-06-02")});
  assert.equal(evaluated.evaluations[0].result.status,"match");
  assert.equal((await readEventFilingMetadata(E,{supabaseSelect:async()=>({ok:false,data:null})})).status,"not_ready");
});

test("existing create/readback → consumer → replay dedupe; activation and unrelated monitors are guarded",async()=>{
  const parsed=parseListingMonitorCreateRequest({conditions:[condition(["S-4","S-4/A"],"in")]});assert.ok(parsed.ok);
  let saved:Record<string,unknown>={};
  const repository={async create(row:Record<string,unknown>){saved={...row,id:M,created_at:"2026-05-01T00:00:00Z",updated_at:"2026-05-01T00:00:00Z"};return {ok:true,data:[saved]};},
    async read(){return {ok:true,data:[saved]};},async list(){return {ok:true,data:[saved]};},async update(){return {ok:true,data:[saved]};},async delete(){return {ok:true,data:[]};}};
  const monitor=await createListingMonitor({ownerId:U,conditions:parsed.value.conditions},repository);
  let metadata=project(),createdAt=monitor.createdAt;
  const writes=new Map<string,unknown>();
  const deps:ListingMonitorAlertConsumerDependencies={
    readFilingMetadata:async()=>metadata,
    listActiveMonitors:async()=>({monitors:[{...monitor,createdAt},{...monitor,id:X,conditions:[{key:"proxy.has_proposal",operator:"eq",value:true}]} as ListingMonitor],diagnostics:[]}),
    now:()=>new Date("2026-06-02"),
    async createAlert(input){const key=`${input.monitorId}:${input.eventId}`;assert.equal(input.filingForm,"S-4");
      if(writes.has(key))return {status:"existing",monitorId:input.monitorId};writes.set(key,input);return {status:"created",monitorId:input.monitorId};},
  };
  assert.equal((await consumeListingMonitorAlertsForEvent({eventId:E,conditionFamily:"filing"},deps)).createdCount,1);
  const changedRun=fixture();changedRun.run.id=M;metadata=project(changedRun);
  assert.equal((await consumeListingMonitorAlertsForEvent({eventId:E,conditionFamily:"filing"},deps)).existingCount,1);
  assert.equal(writes.size,1);
  createdAt="2026-06-01T12:00:00Z";assert.equal((await consumeListingMonitorAlertsForEvent({eventId:E,conditionFamily:"filing"},deps)).writes.length,0);
  createdAt=monitor.createdAt;metadata={status:"not_ready",reason:"unavailable"};
  assert.equal((await consumeListingMonitorAlertsForEvent({eventId:E,conditionFamily:"filing"},deps)).writes.length,0);
});

test("existing DB uniqueness and source pipeline hooks retain accession/event/monitor idempotency",()=>{
  const root=new URL("../../",import.meta.url),read=(p:string)=>readFileSync(new URL(p,root),"utf8");
  const baseline=read("supabase/migrations/20260728113243_canonical_baseline.sql");
  assert.match(baseline,/CREATE UNIQUE INDEX "raw_items_source_unique_idx"[^;]+"source_code", "source_unique_id"/);
  assert.match(baseline,/CREATE UNIQUE INDEX "events_group_dedupe_idx"[^;]+"source_group", "group_dedupe_key"/);
  assert.match(read("supabase/migrations/20260813213027_listing_monitor_alert_event_dedupe_fix.sql"),/unique \(listing_monitor_id, alert_event_id\)/);
  const consumer=read("lib/monitor/listingMonitorAlertConsumer.ts");assert.match(consumer,/onConflict: "listing_monitor_id,alert_event_id"/);
  const ingest=read("lib/secFilingAnalysisIngest.ts");assert.match(ingest,/!options.suppressAlerts && isRegistrationFilingForm\(proxyRecord\(rawResult.rawItem.raw_payload\).form_type\)/);
  assert.match(ingest,/conditionFamily: "filing"/);
});
