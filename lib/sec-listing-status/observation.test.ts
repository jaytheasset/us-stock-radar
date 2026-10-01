import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildObservation, evaluateObservation, projectListingStatus, hash, unattached,
  type Attachment, type ListingObservation, type Row } from "./observation.ts";
import { attachmentFromResolution } from "./identity.ts";
import { persistSecListingObservation, readSecListingHistory } from "./persistence.ts";
import { LISTING_RISK_EVENT_FACTS_VERSION } from "../monitor/listingRiskFacts.ts";
import { LISTING_RISK_ANALYZER_PROMPT_VERSION } from "../monitor/listingRiskAnalyzer.ts";
import type { SecTickerResolutionReadResult, SecTickerResolutionRepository } from "../sec-ticker-resolution/persistence.ts";

const dir = new URL("../sources/sec/forms/form25/fixtures/source-connection/", import.meta.url);
const scope = { issuerCik: "0001492674", securityTitle: "Common Stock", exchange: "Nasdaq Stock Market LLC" };
const rawId = "25000000-0000-4000-8000-000000000001";
const securityId = "25000000-0000-4000-8000-000000000002";
// Synthetic attachment only for projection tests; real DB cases must resolve their own identity.
const attached: Attachment = { status: "attached", securityIdentityId: securityId,
  decisionId: "25000000-0000-4000-8000-000000000003", knownAt: "2025-07-01T00:00:00Z", proofHash: "a".repeat(64), reason: "test_only" };
function raw(notice?: string): Row {
  return { id: rawId, source_code: "sec_edgar", source_unique_id: "0001354457-25-000637",
    source_url: "https://www.sec.gov/Archives/edgar/data/1354457/000135445725000637/0001354457-25-000637-index.html",
    published_at: "2025-07-10T00:00:00Z", raw_payload: { form_type: "25-NSE/A", accession_number: "0001354457-25-000637",
      primary_document_url: "https://www.sec.gov/Archives/edgar/data/1354457/000135445725000637/primary_doc.xml",
      primary_document_html: readFileSync(new URL("TTOO-4.xml", dir), "utf8"),
      attachment_texts: [{ url: "https://www.sec.gov/Archives/edgar/data/1354457/000135445725000637/ttoodelistreason.txt",
        text: notice ?? readFileSync(new URL("TTOO-5.txt", dir), "utf8") }] } };
}
function observation(source = raw(), attachment = attached) {
  return buildObservation({ raw: source, scope, asOf: "2026-09-30", attachment });
}
function project(observations: ListingObservation[], asOf = "2026-09-30") {
  return projectListingStatus({ scope, securityIdentityId: securityId, asOf,
    observations: observations.map((o, i) => ({ id: String(i), observation: o, usable: true, reason: null })) });
}

test("retained TTOO facts and source are unchanged; as-of uses effective date, not filing date", () => {
  const source = raw(); const before = structuredClone(source); const o = observation(source);
  assert.deepEqual(source, before);
  assert.equal(o.reported.listing, "confirmed_exchange_delisting");
  assert.equal(o.reported.removalDate, "2025-07-21");
  assert.equal(o.reported.suspensionDate, "2025-02-12");
  assert.equal(project([o], "2025-07-20").listing, "removal_pending");
  assert.equal(project([o], "2025-07-21").listing, "confirmed_exchange_delisting");
  assert.equal(project([o], "2025-07-09").listing, "unresolved", "future filings cannot leak into earlier knowledge");
  assert.equal(project([o]).trading, "suspended");
});
test("no evidence never implies active; exact exchange/class identity is required", () => {
  assert.equal(project([]).listing, "unresolved");
  assert.equal(project([observation(raw(), unattached("missing"))]).listing, "unresolved");
  assert.equal(project([observation(raw(), { ...attached, securityIdentityId: rawId })]).listing, "unresolved");
  const o = observation(); o.scope = { ...scope, securityTitle: "Class A Common Stock" };
  assert.deepEqual(project([o]).observationIds, []);
  o.scope = { ...scope, exchange: "New York Stock Exchange" };
  assert.deepEqual(project([o]).observationIds, []);
  assert.equal(project([observation(raw(), { ...attached, knownAt: "2027-01-01T00:00:00Z" })]).listing, "unresolved");
});
test("withdrawal, stay, unsupported recovery or conflicting dates cannot confirm an old removal", () => {
  const text = readFileSync(new URL("TTOO-5.txt", dir), "utf8");
  for (const suffix of ["The Form 25 was withdrawn.", "The removal was stayed."]) {
    const o = observation(raw(text + suffix));
    assert.equal(project([observation(), o]).listing, "unresolved");
    assert.equal(project([o]).trading, "unresolved");
  }
  const changed = observation(raw(text.replaceAll("July 21, 2025", "July 22, 2025")));
  assert.equal(project([observation(), changed]).listing, "unresolved");
  assert.equal(project([observation(), changed]).trading, "suspended", "independent unchanged suspension axis");
});
test("source states intention only remains pending even long after the proposed date", () => {
  const text = readFileSync(new URL("TTOO-5.txt", dir), "utf8") + " This removal is subject to approval.";
  assert.equal(project([observation(raw(text))], "2030-01-01").listing, "removal_pending");
});
test("8-A is not accepted as status evidence", () => {
  const source = raw(); (source.raw_payload as Row).form_type = "8-A";
  assert.throws(() => observation(source), /invalid_listing_observation_input/);
});
test("repeat input has a stable payload; changed source changes its hash", () => {
  assert.equal(hash(observation()), hash(observation()));
  assert.notEqual(hash(observation()), hash(observation(raw("The removal was withdrawn."))));
});
test("existing validated continuity identity must prove both exact security and exchange", () => {
  const cover = { issuerCik: scope.issuerCik, securityTitle: scope.securityTitle, exchange: scope.exchange,
    resultId: "cover", observationKey: "class", acceptedAt: "2025-07-01T00:00:00Z" };
  const proof = { status: "available", evaluation: { resolutionState: "AUTO" }, decision: { id: attached.decisionId },
    identity: { id: securityId, issuer_cik: scope.issuerCik, before_result_id: "cover", after_result_id: "cover",
      before_observation_key: "class", after_observation_key: "class" }, evidence: {},
    sourceObservations: { before: [cover], after: [cover] } } as unknown as Extract<SecTickerResolutionReadResult, { status: "available" }>;
  assert.equal(attachmentFromResolution(proof, scope).status, "attached");
  for (const wrong of [{ ...scope, issuerCik: "0000000001" }, { ...scope, securityTitle: "Warrants" }, { ...scope, exchange: "NYSE" }])
    assert.equal(attachmentFromResolution(proof, wrong).status, "unresolved");
  const review = { ...proof, evaluation: { ...proof.evaluation, resolutionState: "REVIEW" as const } };
  assert.equal(attachmentFromResolution(review, scope).status, "unresolved");
});
test("official readback detects stale source and forged facts instead of dropping the observation", async () => {
  const o = observation(raw(), unattached("missing"));
  const repo = (source: Row, value = o): SecTickerResolutionRepository => ({
    select: async table => ({ ok: true, status: 200, data: table === "raw_items" ? [source]
      : [{ id: rawId, raw_item_id: rawId, observation: value }] }),
    rpc: async () => { throw Error("unexpected RPC"); },
  });
  const clean = await readSecListingHistory({ rawItemId: rawId, repository: repo(raw()) });
  assert.equal(clean[0].usable, true);
  const stale = await readSecListingHistory({ rawItemId: rawId, repository: repo(raw("altered")) });
  assert.equal(stale[0].reason, "stale_or_missing_sec_source");
  const forged = structuredClone(o); forged.reported.removalDate = "2025-07-22";
  assert.equal((await readSecListingHistory({ rawItemId: rawId, repository: repo(raw(), forged) }))[0].reason, "observation_facts_changed");
});
test("unsupported 8-K recovery is retained as unresolved, never converted into active", () => {
  const o = observation(); o.form = "8-K";
  o.listingRisk = { status: "available", facts: { classification: { event_kind: "compliance_recovery" } } } as ListingObservation["listingRisk"];
  const result = evaluateObservation(o, "2026-09-30");
  assert.equal(result.listing, "unresolved");
  assert.ok(result.reasons.includes("unsupported_listing_transition"));
});

// Explicit synthetic contract test, not a real 8-K filing verification.
test("8-K source/cover provenance survives persistence and official readback; typed facts are not canonical by themselves", async () => {
  const source = raw(); const payload = source.raw_payload as Row;
  source.source_url = String(source.source_url).replace("/data/1354457/", "/data/1492674/");
  payload.primary_document_url = String(payload.primary_document_url).replace("/data/1354457/", "/data/1492674/");
  const eventId = "25000000-0000-4000-8000-000000000004";
  const notice = "The Exchange has determined to remove from listing the security of Example, Inc. effective at the opening of the trading session on July 21, 2025.";
  const html = `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:ix="http://www.xbrl.org/2013/inlineXBRL" xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:dei="http://xbrl.sec.gov/dei/2025"><ix:header><ix:resources><xbrli:context id="c1"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">0001492674</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>2025-07-21</xbrli:instant></xbrli:period></xbrli:context></ix:resources></ix:header><ix:nonNumeric name="dei:Security12bTitle" contextRef="c1">Common Stock</ix:nonNumeric><ix:nonNumeric name="dei:TradingSymbol" contextRef="c1">EXAMPLE</ix:nonNumeric><ix:nonNumeric name="dei:SecurityExchangeName" contextRef="c1">Nasdaq Stock Market LLC</ix:nonNumeric><p>${notice}</p></html>`;
  Object.assign(source, { source_group: "filings", fetched_at: "2026-09-14T00:00:00Z" });
  Object.assign(payload, { cik: "1492674", form_type: "8-K", filing_date: "2025-07-21", primary_document_html: html,
    primary_document_html_char_count: html.length, primary_document_html_truncated: false,
    attachment_texts: [{ url: String(payload.primary_document_url).replace("primary_doc.xml", "notice.txt"), text: notice }] });
  const absent = { value: null, availability: "unavailable", value_quality: "unknown", source_ref: null };
  const absentDate = { ...absent, date_status: "unknown" };
  const text = (value: string) => ({ value, availability: "available", value_quality: "exact", source_ref: "sec:notice" });
  const facts = { version: LISTING_RISK_EVENT_FACTS_VERSION,
    classification: { event_kind: "listing_removal", event_outcome: "adverse", source_ref: "sec:notice" },
    exchange: text(scope.exchange), affected_security: { title: text(scope.securityTitle), ticker: absent, security_basis: absent },
    listing_rule: absent, listing_requirement: absent, compliance_period: absent,
    proceeding: { kind: "unknown", status: "unknown", source_ref: null },
    dates: { notice_date: absentDate, compliance_deadline: absentDate, hearing_date: absentDate, appeal_deadline: absentDate,
      trading_suspension_date: absentDate, removal_effective_date: { ...text("2025-07-21"), date_status: "occurred" } },
    continued_trading: { continues: absent, venue: absent }, as_of: { ...text("2025-07-21"), date_status: "occurred" }, confidence: null,
    sources: [{ source_family: "sec", source_id: source.source_unique_id, source_url: String(payload.primary_document_url).replace("primary_doc.xml", "notice.txt"), source_ref: "sec:notice", evidence: notice }],
    fact_provenance: ["classification.event_kind", "classification.event_outcome", "exchange.value", "affected_security.title.value", "dates.removal_effective_date.value"].map(fact_path => ({
      fact_path, origin: fact_path.startsWith("classification") ? "domain_interpreted" : "source_stated",
      source_ref: "sec:notice", evidence: notice, evidence_status: "available", evidence_issue: null, confidence: "high", as_of: "2025-07-21", formula_id: null, input_fact_paths: [],
    })) };
  const current = { status: "available", event_id: eventId, raw_item_id: rawId, parent_primary_ai_run_id: eventId,
    source_execution_id: eventId, monitor_analyzer_key: "listing_risk", analyzer_contract_version: LISTING_RISK_ANALYZER_PROMPT_VERSION,
    persisted_at: "2026-09-14T00:00:00Z", fact_schema_version: LISTING_RISK_EVENT_FACTS_VERSION, facts };
  let saved: ListingObservation | undefined;
  const repository: SecTickerResolutionRepository = {
    select: async table => ({ ok: true, status: 200, data: table === "raw_items" ? [source]
      : table === "events" ? [{ id: eventId, raw_item_id: rawId, source_code: "sec_edgar" }]
      : table === "sec_listing_status_observations" ? [{ id: rawId, raw_item_id: rawId, observation: saved }] : [] }),
    rpc: async (name, args) => {
      if (name === "persist_sec_listing_status_observation") {
        saved = JSON.parse(JSON.stringify(args.p_observation));
        return { ok: true, status: 200, data: { status: "inserted", id: rawId } };
      }
      return { ok: true, status: 200, data: current };
    },
  };
  const result = await persistSecListingObservation({ rawItemId: rawId, eventId, asOf: "2026-09-30", repository });
  assert.equal(result.observation.reported.listing, "confirmed_exchange_delisting", JSON.stringify(result.observation.reported));
  assert.equal(result.observation.reported.removalDate, "2025-07-21");
  assert.equal(result.observation.attachment.status, "unresolved");
  assert.equal((await readSecListingHistory({ rawItemId: rawId, repository }))[0].usable, true);
  assert.equal(project([result.observation]).listing, "unresolved");
  const malformed = structuredClone(result.observation);
  (malformed.sourceSnapshot.raw_payload as Row).primary_document_html = "no security identity";
  assert.equal(evaluateObservation(malformed, "2026-09-30").listing, "unresolved");
});
