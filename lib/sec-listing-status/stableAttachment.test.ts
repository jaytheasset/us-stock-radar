import assert from "node:assert/strict";
import test from "node:test";
import { buildSecCoverObservationPayload } from "../sec-cover-observations/canonical.ts";
import { readStableIdentityEvidence } from "../sec-ticker-resolution/stableIdentity.ts";
import { resolveListingAttachment } from "./identity.ts";
import { buildObservation, unattached, type Row } from "./observation.ts";
import { readSecListingHistory, persistSecListingObservation, readSecListingStatusAsOf } from "./persistence.ts";
import { scpxListingRiskReplay } from "./fixtures/listingRiskReplay.ts";
import type { SecTickerResolutionRepository } from "../sec-ticker-resolution/persistence.ts";
import { selectListingCoverRow } from "./coverAttachment.ts";

const scope = { issuerCik: "0001321655", securityTitle: "Class A Common Stock", exchange: "New York Stock Exchange" };
// Synthetic inline cover documents exercise the actual parser and validating reader.
function cover(n: number, date: string, ticker = "SAME", form = "10-Q", empty = false) {
  const accession = `0001321655-24-${String(n).padStart(6, "0")}`;
  const url = `https://www.sec.gov/Archives/edgar/data/1321655/000132165524${String(n).padStart(6, "0")}/cover.htm`;
  const html = empty ? "<html>no inline cover</html>" : `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:ix="http://www.xbrl.org/2013/inlineXBRL" xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:dei="http://xbrl.sec.gov/dei/2024"><ix:header><ix:resources><xbrli:context id="c"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">${scope.issuerCik}</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>${date}</xbrli:instant></xbrli:period></xbrli:context></ix:resources></ix:header><ix:nonNumeric name="dei:Security12bTitle" contextRef="c">${scope.securityTitle}</ix:nonNumeric><ix:nonNumeric name="dei:TradingSymbol" contextRef="c">${ticker}</ix:nonNumeric><ix:nonNumeric name="dei:SecurityExchangeName" contextRef="c">${scope.exchange}</ix:nonNumeric></html>`;
  const rawId = `26000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const raw = { id: rawId, source_code: "sec_edgar", source_group: "filings", source_unique_id: accession,
    source_url: url, published_at: `${date}T00:00:00Z`, fetched_at: `${date}T12:00:00Z`,
    raw_payload: { accession_number: accession, cik: scope.issuerCik, form_type: form, filing_date: date,
      accepted_at: `${date}T00:00:00Z`, parser_version: "sec_edgar_raw_parser_v1", primary_document_url: url,
      primary_document_html: html, primary_document_html_char_count: html.length, primary_document_html_truncated: false } };
  const built = buildSecCoverObservationPayload(rawId, raw); assert.ok(built); return { ...built, raw };
}
async function fixture() {
  const b = cover(1, "2024-08-05"), a = cover(2, "2024-11-04");
  const tables: Record<string, Row[]> = { sec_ticker_resolution_decisions: [], sec_ticker_security_identities: [],
    sec_cover_observation_results: [], sec_cover_security_observations: [], sec_structured_raw_sources: [], raw_items: [],
    sec_listing_status_observations: [] };
  const add = (p: ReturnType<typeof cover>) => { tables.sec_cover_observation_results.push(p.result);
    tables.sec_cover_security_observations.push(...p.observations); if (p.sourceRaw) tables.sec_structured_raw_sources.push(p.sourceRaw);
    tables.raw_items.push(p.raw); };
  add(b); add(a);
  const repository: SecTickerResolutionRepository = { select: async (table, query) => {
    assert.ok(tables[table], table);
    const data = tables[table].filter(row => Object.entries(query).every(([k, v]) => !v.startsWith("eq.") || String(row[k]) === v.slice(3)));
    return { ok: true, status: 200, data: structuredClone(data) };
  }, rpc: async () => { throw Error("read-only check"); } };
  const proof = await readStableIdentityEvidence({ beforeAccession: b.payload.identity.accessionNumber,
    beforeSourceHash: b.payload.source.sha256!, afterAccession: a.payload.identity.accessionNumber,
    afterSourceHash: a.payload.source.sha256! }, repository);
  assert.equal(proof.status, "available");
  tables.sec_ticker_security_identities.push(proof.identity);
  return { tables, repository, add, b, a, proof };
}
test("stable exact attachment uses validated cover sources, with no AUTO decision or backdating", async () => {
  const f = await fixture();
  assert.equal((await resolveListingAttachment(scope, f.repository, "2024-11-25")).status, "attached");
  assert.equal((await resolveListingAttachment(scope, f.repository, "2024-08-06")).status, "unresolved");
  assert.equal((await resolveListingAttachment({ ...scope, exchange: "Nasdaq" }, f.repository, "2024-11-25")).status, "unresolved");
  assert.equal(f.tables.sec_ticker_resolution_decisions.length, 0);
});
test("a later known symbol transition requires change evidence; future evidence cannot rewrite the old scope", async () => {
  const f = await fixture(); f.add(cover(3, "2024-11-20", "CHANGED"));
  const blocked = await resolveListingAttachment(scope, f.repository, "2024-11-25");
  assert.equal(blocked.status, "conflict"); assert.match(blocked.reason, /requires_change_evidence/);
  assert.equal((await resolveListingAttachment(scope, f.repository, "2024-11-10")).status, "attached");
});
test("an intervening changed symbol cannot be skipped by selecting two equal endpoints", async () => {
  const f = await fixture(); f.add(cover(3, "2024-09-01", "OTHER"));
  assert.equal((await resolveListingAttachment(scope, f.repository, "2024-11-25")).status, "conflict");
});
test("a source without cover facts is not a conflicting Form 25 cover; unavailable 10-Q identity is blocked", async () => {
  const f = await fixture(); f.add(cover(3, "2024-11-25", "", "25", true));
  assert.equal((await resolveListingAttachment(scope, f.repository, "2024-11-25")).status, "attached");
  f.add(cover(4, "2024-11-24", "", "10-Q", true));
  assert.equal((await resolveListingAttachment(scope, f.repository, "2024-11-25")).status, "conflict");
});
test("conflicting revisions and tampered original source cannot establish identity", async () => {
  const f = await fixture(); const altered = structuredClone(f.a.result); altered.id = "26000000-0000-4000-8000-000000000099";
  altered.source_sha256 = "f".repeat(64);
  f.tables.sec_cover_observation_results.push(altered);
  assert.equal((await resolveListingAttachment(scope, f.repository, "2024-11-25")).status, "conflict");
  const g = await fixture(); g.tables.sec_structured_raw_sources[0].raw_content = "changed";
  assert.notEqual((await resolveListingAttachment(scope, g.repository, "2024-11-25")).status, "attached");
});

test("same-source cover collections are individually revalidated without choosing or deleting a version", async () => {
  const f = await fixture(), c = cover(3, "2024-11-20"); f.add(c);
  const repeated = structuredClone(c.raw); repeated.raw_payload.accepted_at = "";
  const rebuilt = buildSecCoverObservationPayload(repeated.id, repeated); assert.ok(rebuilt);
  assert.notEqual(rebuilt.result.id, c.result.id);
  assert.equal(rebuilt.payload.source.sha256, c.payload.source.sha256);
  f.tables.sec_cover_observation_results.push(rebuilt.result);
  f.tables.sec_cover_security_observations.push(...rebuilt.observations);
  if (rebuilt.sourceRaw) f.tables.sec_structured_raw_sources.push(rebuilt.sourceRaw);
  const original = structuredClone(f.tables);
  assert.equal((await resolveListingAttachment(scope, f.repository, "2024-11-25")).status, "attached");
  assert.deepEqual(f.tables, original);
  // Selecting by result ID must still verify that version's stored rows.
  f.tables.sec_cover_security_observations.find(o => o.result_id === rebuilt.result.id)!.security_title_raw = "tampered";
  assert.notEqual((await resolveListingAttachment(scope, f.repository, "2024-11-25")).status, "attached");
});
test("official history keeps old missing-identity record intact and exposes a separate validated attachment", async () => {
  const f = await fixture(); const raw = cover(3, "2024-11-25", "", "25", true).raw;
  f.tables.raw_items.push(raw);
  const o = buildObservation({ raw, scope, asOf: "2024-11-25", attachment: unattached("no_exact_canonical_security_exchange") });
  f.tables.sec_listing_status_observations.push({ id: raw.id, raw_item_id: raw.id, observation: o });
  const original = structuredClone(o);
  const read = await readSecListingHistory({ rawItemId: raw.id, repository: f.repository });
  assert.equal(read[0].usable, true); assert.equal(read[0].resolvedAttachment?.status, "attached");
  assert.deepEqual(read[0].observation, original); assert.deepEqual(o, original);
  o.attachment = unattached("multiple_security_identities", "conflict");
  assert.equal((await readSecListingHistory({ rawItemId: raw.id, repository: f.repository }))[0].resolvedAttachment, undefined);
});

test("status subject selects its exact cover row; rights remain and ambiguity/wrong class/venue block",()=>{
  const raw=structuredClone(cover(6,"2024-06-17","SCPX","8-K").raw);
  const body=raw.raw_payload.primary_document_html;
  const context=body.match(/<xbrli:context[\s\S]*?<\/xbrli:context>/)![0].replace('id="c"','id="rights"');
  const fields=body.match(/<ix:nonNumeric[\s\S]*<\/ix:nonNumeric>/)![0].replaceAll('contextRef="c"','contextRef="rights"')
    .replace(scope.securityTitle,"Common Stock Purchase Rights").replace('>SCPX<','>None<');
  raw.raw_payload.primary_document_html=body.replace('</html>',context+fields+'</html>')
    .replace(scope.securityTitle,"Common Stock, $0.0002 par value per share")
    .replaceAll(scope.exchange,"NYSE American LLC");
  raw.raw_payload.primary_document_html_char_count=raw.raw_payload.primary_document_html.length;
  const sc={issuerCik:scope.issuerCik,securityTitle:"common stock",exchange:"NYSE American"};
  const snapshot=structuredClone(raw);
  const selected=selectListingCoverRow(raw,sc);
  assert.equal(selected?.ticker,"SCPX"); assert.equal(selected?.exchange,"NYSE American LLC");
  assert.equal(buildSecCoverObservationPayload(raw.id,raw)?.observations.length,2);
  assert.deepEqual(raw,snapshot);
  for(const patch of [{securityTitle:"Class A Common Stock"},{securityTitle:"Common Stock, $0.01 par value per share"},
    {exchange:"NYSE"},{exchange:"Nasdaq"},{issuerCik:"0000000001"}])
    assert.equal(selectListingCoverRow(raw,{...sc,...patch}),null);
  raw.raw_payload.primary_document_html=raw.raw_payload.primary_document_html.replace("Common Stock Purchase Rights","Common Stock");
  raw.raw_payload.primary_document_html_char_count=raw.raw_payload.primary_document_html.length;
  assert.equal(selectListingCoverRow(raw,sc),null);
});

test("missing cover receipt fields use the retained filing date only to bound the scan",async()=>{
  const f=await fixture(),c=cover(3,"2024-11-20");
  c.raw.raw_payload.accepted_at="";c.raw.raw_payload.filing_date="";
  const rebuilt=buildSecCoverObservationPayload(c.raw.id,c.raw);assert.ok(rebuilt);
  f.add({...c,...rebuilt});
  const original=structuredClone(c.raw);
  const read=await resolveListingAttachment(scope,f.repository,"2024-11-25");
  assert.equal(read.status,"attached");assert.equal(Date.parse(read.knownAt!),Date.parse(f.a.raw.raw_payload.accepted_at));
  assert.deepEqual(c.raw,original);
  f.tables.raw_items.find(x=>x.id===c.raw.id)!.published_at=null;
  assert.equal((await resolveListingAttachment(scope,f.repository,"2024-11-25")).reason,"identity_observation_time_missing");
});

test("live typed Listing Risk uses the same exact cover binding and official read-back", async () => {
  for (const variant of ["exact", "wrong-class", "wrong-exchange", "changed-ticker", "ambiguous"] as const) {
    const f = await fixture(), c = cover(3, "2024-11-25", variant === "changed-ticker" ? "CHANGED" : "SAME", "8-K");
    if (variant === "ambiguous") {
      c.raw.raw_payload.primary_document_html = c.raw.raw_payload.primary_document_html.replace("</html>",
        c.raw.raw_payload.primary_document_html.match(/<ix:nonNumeric[\s\S]*<\/ix:nonNumeric>/)![0].replace(">SAME<", ">OTHER<") + "</html>");
      c.raw.raw_payload.primary_document_html_char_count = c.raw.raw_payload.primary_document_html.length;
    }
    const rebuilt = buildSecCoverObservationPayload(c.raw.id, c.raw); assert.ok(rebuilt);
    f.add({ ...c, ...rebuilt });
    const facts = scpxListingRiskReplay(false);
    facts.affected_security.title.value = variant === "wrong-class" ? "Class B Common Stock" : scope.securityTitle.toLowerCase();
    facts.exchange.value = variant === "wrong-exchange" ? "Nasdaq" : scope.exchange;
    const original = structuredClone(facts), eventId = "26000000-0000-4000-8000-000000000088";
    f.tables.events = [{ id: eventId, raw_item_id: c.raw.id, source_code: "sec_edgar" }];
    const rpcResult = { status: "available", event_id: eventId, raw_item_id: c.raw.id,
      parent_primary_ai_run_id: eventId, source_execution_id: eventId, persisted_at: "2026-10-01T00:00:00Z",
      monitor_analyzer_key: "listing_risk", analyzer_contract_version: "listing_risk_domain_analyzer_v11",
      fact_schema_version: "listing_risk_event_facts_v2", facts };
    const repository: SecTickerResolutionRepository = { ...f.repository, rpc: async (name, args) => {
      if (name === "read_current_event_listing_risk_facts") return { ok: true, status: 200, data: structuredClone(rpcResult) };
      assert.equal(name, "persist_sec_listing_status_observation");
      f.tables.sec_listing_status_observations = [{ id: eventId, raw_item_id: c.raw.id, observation: args.p_observation }];
      return { ok: true, status: 200, data: { id: eventId, status: "inserted" } };
    } };
    const saved = await persistSecListingObservation({ rawItemId: c.raw.id, eventId, asOf: "2024-11-25", repository });
    assert.deepEqual(saved.observation.listingRisk?.status === "available" && saved.observation.listingRisk.facts, original);
    const read = await readSecListingHistory({ rawItemId: c.raw.id, repository });
    assert.equal(read[0].usable, true, JSON.stringify(read[0]));
    if (variant === "exact") {
      assert.equal(saved.observation.attachment.status, "attached");
      assert.equal(saved.observation.attachment.coverRow?.ticker, "SAME");
      assert.equal(saved.observation.scope?.securityTitle, scope.securityTitle.toLowerCase());
      assert.equal(saved.observation.reported.listing, "removal_pending");
    } else assert.notEqual(saved.observation.attachment.status, "attached", variant);
  }
});

test("historical analysis is excluded only with a revalidated same-event replacement; reads preserve every row", async () => {
  const f=await fixture(), c=cover(3,"2024-11-25","SAME","8-K"); f.add(c);
  const eventId="26000000-0000-4000-8000-000000000081", oldId="26000000-0000-4000-8000-000000000082";
  const facts=scpxListingRiskReplay(false); facts.affected_security.title.value=scope.securityTitle; facts.exchange.value=scope.exchange;
  const current={status:"available",event_id:eventId,raw_item_id:c.raw.id,parent_primary_ai_run_id:eventId,
    source_execution_id:eventId,persisted_at:"2026-10-01T00:00:00Z",monitor_analyzer_key:"listing_risk",
    analyzer_contract_version:"listing_risk_domain_analyzer_v11",fact_schema_version:"listing_risk_event_facts_v2",facts};
  f.tables.events=[{id:eventId,raw_item_id:c.raw.id,source_code:"sec_edgar"}];
  const repo:SecTickerResolutionRepository={...f.repository,rpc:async(name,args)=>{
    if(name==="read_current_event_listing_risk_facts") return {ok:true,status:200,data:structuredClone(current)};
    assert.equal(name,"persist_sec_listing_status_observation");
    f.tables.sec_listing_status_observations.push({id:eventId,raw_item_id:c.raw.id,observation:args.p_observation});
    return {ok:true,status:200,data:{id:eventId,status:"inserted"}};
  }};
  const saved=await persistSecListingObservation({rawItemId:c.raw.id,eventId,asOf:"2024-11-25",repository:repo});
  const base=structuredClone(saved.observation); assert.equal(base.listingRisk?.status,"available");
  if(base.listingRisk?.status!=="available") throw Error("missing typed fixture");
  base.listingRisk.sourceExecutionId=oldId; base.listingRisk.parentPrimaryAiRunId=oldId; base.listingRisk.persistedAt="2026-09-30T00:00:00Z";
  const request={scope,securityIdentityId:saved.observation.attachment.securityIdentityId,asOf:"2024-11-25",repository:repo};
  for(const variant of ["lineage-only","duplicate-analysis","different-issue","forged-date","changed-document","missing-replacement"] as const) {
    const old=structuredClone(base);
    if(old.listingRisk?.status!=="available") throw Error("missing fixture");
    if(variant!=="lineage-only") old.listingRisk.facts.fact_provenance[0].confidence="medium";
    if(variant==="different-issue") old.listingRisk.facts.listing_rule.value="Section 1007";
    if(variant==="forged-date") old.reported.removalDate="2024-11-24";
    if(variant==="changed-document") (old.sourceSnapshot.raw_payload as Row).primary_document_html="altered";
    const rows=[{id:oldId,raw_item_id:c.raw.id,issuer_cik:scope.issuerCik,observation:old},
      ...(variant==="missing-replacement"?[]:[{id:eventId,raw_item_id:c.raw.id,issuer_cik:scope.issuerCik,observation:saved.observation}])];
    f.tables.sec_listing_status_observations=rows;
    const original=structuredClone(rows);
    const history=await readSecListingHistory({rawItemId:c.raw.id,repository:repo});
    const result=await readSecListingStatusAsOf(request);
    const again=await readSecListingStatusAsOf(request); assert.deepEqual(again,result); assert.deepEqual(rows,original);
    if(variant==="lineage-only") {assert.equal(history[0].usable,true);assert.equal(history[0].provenance?.analysis,"lineage_refreshed");}
    if(variant==="duplicate-analysis") {assert.equal(history[0].reason,"listing_evidence_changed");assert.equal(history[0].revalidationFailure?.replacement?.observationId,eventId);}
    if(["lineage-only","duplicate-analysis"].includes(variant)) {
      assert.equal(result.listing,"removal_pending");assert.equal(result.excludedObservations.length,variant==="duplicate-analysis"?1:0);
    } else {assert.equal(result.listing,"unresolved",variant);assert.equal(result.excludedObservations.length,0,variant);}
  }
});
