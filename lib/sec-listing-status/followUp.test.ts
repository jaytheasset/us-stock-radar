import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { buildObservation, projectListingStatus, hash, type Attachment, type HistoryItem } from "./observation.ts";
import { validateSourceEvent, validateEventLink, type ListingSourceEvent } from "./sourceEvent.ts";
import { persistSecListingObservation, readSecListingHistory } from "./persistence.ts";
import type { SecTickerResolutionRepository } from "../sec-ticker-resolution/persistence.ts";

// Exact SEC excerpts. Test raw envelopes/identity are synthetic; real DB validation
// uses the complete retained HTTP documents, never these unit-test envelopes.
const f = JSON.parse(readFileSync(new URL("./fixtures/follow-up.json",import.meta.url),"utf8"));
const uid = (n: number) => `25000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const scope = {issuerCik:"0001476963",securityTitle:"common stock",exchange:"NYSE American"};
const attachment: Attachment = {status:"attached",securityIdentityId:uid(90),decisionId:null,
  knownAt:"2024-01-01T00:00:00Z",proofHash:"a".repeat(64),reason:"synthetic_unit_test_only"};
function event(kind: ListingSourceEvent["kind"],fixture: string,date: string,dateText: string): ListingSourceEvent {
  const q=f[fixture];return {version:"listing_source_event_v1",kind,date,dateText,documentUrl:q.url,
    documentHash:sha(q.quote),quote:q.quote,securityText:scope.securityTitle,exchangeText:scope.exchange,issue:"Section 1003(f)(v)"};
}
function item(n: number,e: ListingSourceEvent,filed: string): HistoryItem {
  const path=new URL(e.documentUrl).pathname.split("/"); const a=path.at(-2)!;
  const accession=`${a.slice(0,10)}-${a.slice(10,12)}-${a.slice(12)}`;
  const raw={id:uid(n),source_code:"sec_edgar",source_unique_id:accession,source_url:e.documentUrl,published_at:filed,
    raw_payload:{form_type:"8-K",cik:scope.issuerCik,primary_document_url:e.documentUrl,primary_document_html:e.quote}};
  return {id:uid(n),usable:true,reason:null,observation:buildObservation({raw,scope,asOf:filed.slice(0,10),attachment,sourceEvent:e})};
}
function initial(){return item(1,event("removal_decision","scpx-before","2024-06-14","June 14, 2024"),"2024-06-17");}
function follow(previous=initial()) {
  const e=event("removal_decision_withdrawn","scpx-after","2024-07-29","July 29, 2024");
  e.resolves={observationId:previous.id,sourceHash:previous.observation.sourceHash,eventDate:"2024-06-14"};
  return item(2,e,"2024-07-30");
}
const project=(observations:HistoryItem[],asOf="2024-07-30")=>projectListingStatus({securityIdentityId:uid(90),scope,asOf,observations});

test("real withdrawal closes only linked removal; original suspension and source stay intact",()=>{
  const a=initial(),b=follow(a),s=item(3,event("trading_suspension","scpx-before","2024-06-14","June 14, 2024"),"2024-06-17");
  const before=hash([a,b,s]);
  assert.equal(project([a,b,s],"2024-07-29").listing,"removal_pending");
  assert.equal(project([a,b,s]).listing,"removal_decision_withdrawn");
  assert.equal(s.observation.reported.trading,"suspended");
  assert.equal(s.observation.reported.suspensionDate,null); // Notice date is not an explicit effective date.
  assert.equal(project([a,b,s]).trading,"unresolved");
  assert.equal(project([a,b,s]).withdrawalNoticeDate,"2024-07-29");
  assert.equal(hash([a,b,s]),before);
});
test("expected resumption in the real withdrawal filing is not a confirmed resumption",()=>{
  const e=event("trading_resumed","scpx-after","2024-08-02","August 2, 2024");
  e.resolves={observationId:uid(1),sourceHash:"a".repeat(64),eventDate:"2024-06-14"};
  assert.throws(()=>item(2,e,"2024-08-03"));
});
test("appeal-only and conditional suspension are not completed source events",()=>{
  for(const name of ["aplm-before-ex1","aplm-before-ex2"]){
    const e=event("trading_resumed",name,"2025-09-29","September 29, 2025");
    e.securityText="securities";e.exchangeText="Nasdaq";e.issue="public shell";
    assert.throws(()=>validateSourceEvent({source_code:"sec_edgar",source_unique_id:"0001193125-25-217820",source_url:e.documentUrl,published_at:"2025-09-30",raw_payload:{cik:"1944885",form_type:"6-K",primary_document_url:e.documentUrl,primary_document_html:e.quote}},
      {issuerCik:"0001944885",securityTitle:e.securityText,exchange:"Nasdaq"},e));
  }
});
test("compliance recovery alone cannot cancel a removal decision",()=>{
  const e=event("removal_decision_withdrawn","scpx-after","2024-07-29","July 29, 2024");
  e.quote="On July 29, 2024 the common stock on NYSE American regained compliance with Section 1003(f)(v).";
  e.documentHash=sha(e.quote);e.resolves={observationId:uid(1),sourceHash:"a".repeat(64),eventDate:"2024-06-14"};
  assert.throws(()=>item(2,e,"2024-07-30"),/unsupported_listing_event_statement/);
});
test("wrong target, independent issue, stale evidence and unresolved observations do not disappear",()=>{
  const a=initial(),b=follow(a);
  for(const change of ["hash","id","issue","date"]){const bad=structuredClone(b);const e=bad.observation.sourceEvent!;
    if(change==="hash")e.resolves!.sourceHash="b".repeat(64);
    if(change==="id")e.resolves!.observationId=uid(99);
    if(change==="issue")e.issue="Section 1007";
    if(change==="date")e.resolves!.eventDate="2024-06-15";
    assert.equal(project([a,bad]).listing,"unresolved");
  }
  const other=structuredClone(a);other.id=uid(5);
  assert.equal(project([a,b,other]).listing,"unresolved");
  const stale=structuredClone(a);stale.usable=false;stale.reason="stale_or_missing_sec_source";
  assert.equal(project([stale,b]).listing,"unresolved");
  const unattached=structuredClone(b);unattached.observation.attachment.status="unresolved";
  assert.equal(project([a,unattached]).listing,"unresolved");
});
test("confirmed real APLM resumption wording is accepted, but different earlier date is rejected",()=>{
  const q=f["aplm-after"],e:ListingSourceEvent={version:"listing_source_event_v1",kind:"trading_resumed",date:"2025-10-14",dateText:"October 14, 2025",
    documentUrl:q.url,documentHash:sha(q.quote),quote:q.quote,securityText:"Class A Ordinary Shares",exchangeText:"Nasdaq",issue:"public shell",
    resolves:{observationId:uid(10),sourceHash:"a".repeat(64),eventDate:"2025-09-18"}};
  const raw={id:uid(11),source_code:"sec_edgar",source_unique_id:"0001193125-25-328822",source_url:e.documentUrl,published_at:"2025-12-22",
    raw_payload:{form_type:"6-K",cik:"1944885",primary_document_url:e.documentUrl,primary_document_html:e.quote}};
  validateSourceEvent(raw,{issuerCik:"0001944885",securityTitle:e.securityText,exchange:e.exchangeText},e);
  const prior={...e,kind:"trading_suspension" as const,date:"2025-09-18",dateText:"September 18, 2025",resolves:undefined};
  validateEventLink(e,prior);
  assert.throws(()=>validateEventLink(e,{...prior,date:"2025-09-29"}),/target_mismatch/);
  assert.throws(()=>validateSourceEvent(raw,{issuerCik:"0001944885",securityTitle:e.securityText,exchange:e.exchangeText},
    {...e,date:"2025-09-18",dateText:"September 18, 2025"}),/operative_date_mismatch/);
});

test("retrospective real 6-K dates do not become known before its filing; axes stay separate",()=>{
  const q=f["aplm-after"];
  const sc={issuerCik:"0001944885",securityTitle:"Class A Ordinary Shares",exchange:"Nasdaq"};
  const raw={id:uid(20),source_code:"sec_edgar",source_unique_id:"0001193125-25-328822",source_url:q.url,published_at:"2025-12-22",
    raw_payload:{form_type:"6-K",cik:sc.issuerCik,primary_document_url:q.url,primary_document_html:q.quote}};
  const e:ListingSourceEvent={version:"listing_source_event_v1",kind:"trading_suspension",date:"2025-09-18",dateText:"September 18, 2025",
    documentUrl:q.url,documentHash:sha(q.quote),quote:q.quote,securityText:sc.securityTitle,exchangeText:sc.exchange,issue:"public shell"};
  const a:HistoryItem={id:uid(21),usable:true,reason:null,observation:buildObservation({raw,scope:sc,asOf:"2025-12-22",attachment,sourceEvent:e})};
  const b:HistoryItem={id:uid(22),usable:true,reason:null,observation:buildObservation({raw,scope:sc,asOf:"2025-12-22",attachment,
    sourceEvent:{...e,kind:"trading_resumed",date:"2025-10-14",dateText:"October 14, 2025",
      resolves:{observationId:a.id,sourceHash:a.observation.sourceHash,eventDate:e.date}}})};
  const read=(asOf:string)=>projectListingStatus({securityIdentityId:uid(90),scope:sc,asOf,observations:[a,b]});
  assert.equal(read("2025-12-21").trading,"unresolved");
  assert.equal(read("2025-12-22").trading,"resumed");
  assert.equal(read("2025-12-22").resumptionDate,"2025-10-14");
  assert.equal(read("2025-12-22").listing,"unresolved");
  const bad=structuredClone(b);bad.observation.rawItemId=uid(99);
  assert.equal(projectListingStatus({securityIdentityId:uid(90),scope:sc,asOf:"2025-12-22",observations:[a,bad]}).trading,"unresolved");
});

test("source-only writer and official reader reject missing/stale targets without a Primary event",async()=>{
  const a=initial(),b=follow(a),rows=[{id:a.id,raw_item_id:a.observation.rawItemId,observation:a.observation}];
  const raws=[a.observation.sourceSnapshot,b.observation.sourceSnapshot];
  let writes=0;
  const repository:SecTickerResolutionRepository={
    select:async(table,query)=>{
      const source=table==="raw_items"?raws:table==="sec_listing_status_observations"?rows:[];
      const data=query.id?source.filter(x=>x.id===query.id.slice(3)):source;
      return {ok:true,status:200,data};
    },
    rpc:async(_name,args)=>{writes++;return {ok:true,status:200,data:{status:"inserted",id:b.id}};}
  };
  const request={rawItemId:b.observation.rawItemId,scope,asOf:b.observation.filingDate,sourceEvent:b.observation.sourceEvent!,repository};
  const missing={...request,sourceEvent:{...request.sourceEvent,resolves:{...request.sourceEvent.resolves!,observationId:uid(99)}}};
  await assert.rejects(persistSecListingObservation(missing),/target_mismatch/);
  assert.equal(writes,0);
  await persistSecListingObservation(request);
  assert.equal(writes,1);
  rows.push({id:b.id,raw_item_id:b.observation.rawItemId,observation:b.observation});
  (raws[0].raw_payload as Record<string,unknown>).primary_document_html="changed";
  const read=await readSecListingHistory({scope,repository});
  assert.ok(read.every(x=>!x.usable));
  await assert.rejects(persistSecListingObservation(request),/target_stale/);
  assert.equal(writes,1);
});
