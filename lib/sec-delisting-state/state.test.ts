import assert from "node:assert/strict";
import test from "node:test";
import { evaluateStoredForm25, applyCurrentListingRiskEvidence, validDate, type DelistingScope } from "./state.ts";
import { readStoredDelistingState, type DelistingRepository } from "./reader.ts";
import { LISTING_RISK_EVENT_FACTS_VERSION, validateListingRiskEventFacts, type ListingRiskEventFacts } from "../monitor/listingRiskFacts.ts";
import { LISTING_RISK_ANALYZER_PROMPT_VERSION } from "../monitor/listingRiskAnalyzer.ts";

const rawId = "25000000-0000-4000-8000-000000000001";
const eventId = "25000000-0000-4000-8000-000000000002";
const accession = "0001354457-25-000637";
const url = `https://www.sec.gov/Archives/edgar/data/1492674/${accession.replaceAll("-", "")}/primary_doc.xml`;
const scope: DelistingScope = { issuerCik: "1492674", securityTitle: "Common Stock", exchange: "Nasdaq Stock Market LLC" };
// Synthetic source contract cases, not real filing verification. Official
// source-byte DB roundtrips are performed separately in an isolated database.
const notice = "The Exchange has determined to remove from listing the security of Example, Inc. effective at the opening of the trading session on July 21, 2025. The Company security was suspended on February 12, 2025.";
function raw(text = notice, security = scope.securityTitle, exchange = scope.exchange) {
  return { id: rawId, source_code: "sec_edgar", source_unique_id: accession, source_url: url,
    published_at: "2025-07-10T00:00:00Z", raw_payload: { form_type: "25-NSE/A", accession_number: accession,
      cik: "1354457", primary_document_url: url, primary_document_html: `<notificationOfRemoval><exchange><cik>1354457</cik><entityName>${exchange}</entityName></exchange><issuer><cik>0001492674</cik><entityName>Example</entityName></issuer><descriptionClassSecurity>${security}</descriptionClassSecurity></notificationOfRemoval>`,
      attachment_texts: [{ url: url.replace("primary_doc.xml", "notice.txt"), type: "EX-99.25", text }] } };
}
const asOf = "2026-09-14";
function evaluate(source = raw(), target = scope, date = asOf) { return evaluateStoredForm25({ raw: source, scope: target, asOf: date }); }

test("explicit operative removal and suspension are separate, source scoped dates", () => {
  const value = evaluate();
  assert.equal(value.listing, "confirmed_exchange_delisting");
  assert.equal(value.trading, "suspended");
  assert.equal(value.removalDate, "2025-07-21");
  assert.equal(value.suspensionDate, "2025-02-12");
  assert.equal(value.issuerCik, "0001492674");
  assert.equal(value.filedByCik, "1354457");
  assert.equal(value.sourceDocuments.length, 2);
  assert.equal(evaluate(raw(), scope, "2025-07-20").listing, "removal_pending");
});
test("filing/index effectiveness and inactive flag never supply removal date", async () => {
  const source = raw("No date is established by this notice.");
  Object.assign(source.raw_payload, { effectiveness_date: "2025-07-21", delisting_or_removal_date: "2025-07-21" });
  assert.equal(evaluate(source).listing, "unresolved");
  assert.equal(evaluate(source).removalDate, null);
  for (const flag of [false, true, null]) {
    const result = await readStoredDelistingState({ rawItemIds: [], scope, asOf, catalogIsActive: flag });
    assert.equal(result.listing, "unresolved");
    assert.equal(result.catalog, flag === false ? "inactive_only" : flag === true ? "active_flag_only" : "unavailable");
  }
});
test("suspension alone is not delisting", () => {
  const result = evaluate(raw("The Company security was suspended on February 12, 2025."));
  assert.equal(result.trading, "suspended"); assert.equal(result.listing, "unresolved");
});
test("intended and conditional removals remain unconfirmed after reported dates", () => {
  for (const text of [notice.replace("has determined", "intends"), `${notice} Subject to approval.`, `${notice} The proposed delisting remains subject to review.`]) {
    assert.notEqual(evaluate(raw(text)).listing, "confirmed_exchange_delisting");
  }
});
test("withdrawn or stayed removals do not confirm an old effective date", () => {
  for (const suffix of ["The removal was withdrawn.", "The delisting is stayed.", "The Form 25 was rescinded."]) {
    const value = evaluate(raw(`${notice} ${suffix}`));
    assert.equal(value.listing, "unresolved");
    assert.ok(value.reasons.includes("withdrawal_stay_or_conflicting_source_requires_review"));
  }
});
test("different effective dates in stored official notices do not use the first notice", () => {
  const source = raw();
  source.raw_payload.attachment_texts.push({ ...source.raw_payload.attachment_texts[0], url: url.replace("primary_doc.xml", "second.txt"), text: notice.replace("July 21, 2025", "July 22, 2025") });
  const value = evaluate(source);
  assert.equal(value.listing, "unresolved"); assert.ok(value.reasons.includes("notice_removal_date_conflict"));
});
test("opening of business associated only with suspension is not formal removal", () => {
  const value = evaluate(raw("Trading was suspended effective at the opening of business on July 21, 2025."));
  assert.notEqual(value.listing, "confirmed_exchange_delisting");
});
test("notice removing a different security cannot delist the XML common class", () => {
  for (const security of ["warrants", "Class B Common Stock", "preferred stock", "notes"]) {
    const value = evaluate(raw(notice.replace("the security of Example, Inc.", `the ${security} of Example, Inc.`)));
    assert.equal(value.listing, "unresolved"); assert.ok(value.reasons.includes("notice_security_conflict"));
  }
});
test("issuer, exchange and individual class must all match, no aliases or CIK-only merge", () => {
  for (const target of [{ ...scope, issuerCik: "1354457" }, { ...scope, exchange: "NYSE Arca" },
    { ...scope, securityTitle: "Warrants" }, { ...scope, securityTitle: "Class A Common Stock" }]) {
    assert.equal(evaluate(raw(), target).listing, "unresolved");
  }
  assert.equal(evaluate(raw(notice, "Warrants"), { ...scope, securityTitle: "Warrants" }).listing, "confirmed_exchange_delisting");
  assert.equal(evaluate(raw(notice, "Class B Common Stock"), { ...scope, securityTitle: "Class A Common Stock" }).listing, "unresolved");
  assert.equal(evaluate(raw(notice, "Common Stock and Warrants"), { ...scope, securityTitle: "Common Stock and Warrants" }).listing, "unresolved");
});
test("source mismatch/truncation/missing XML and invalid dates fail closed", () => {
  for (const mutate of [
    (r: ReturnType<typeof raw>) => { r.source_url = r.source_url.replace("www.sec.gov", "example.org"); },
    (r: ReturnType<typeof raw>) => { r.raw_payload.attachment_texts[0].url = r.source_url.replace(accession.replaceAll("-", ""), "000135445725000638"); },
    (r: ReturnType<typeof raw>) => { r.raw_payload.primary_document_html = ""; },
    (r: ReturnType<typeof raw>) => { Object.assign(r.raw_payload, { text_truncated: true }); },
    (r: ReturnType<typeof raw>) => { Object.assign(r.raw_payload, { documents: [{ url: r.raw_payload.attachment_texts[0].url, textTruncated: true }] }); },
    (r: ReturnType<typeof raw>) => { Object.assign(r.raw_payload, { primary_document_html_char_count: 1 }); },
    (r: ReturnType<typeof raw>) => { r.raw_payload.primary_document_html += r.raw_payload.primary_document_html; },
  ]) { const source = raw(); mutate(source); assert.equal(evaluate(source).listing, "unresolved"); }
  assert.equal(validDate("2025-13-40"), false); assert.equal(validDate("2025-02-30"), false);
  assert.equal(evaluate(raw(), scope, "2025-13-40").listing, "unresolved");
  assert.equal(evaluate(raw(), scope, "2025-07-09").listing, "unresolved");
});
test("existing site analysis conflicts block state without modifying the analysis", () => {
  const event = { id: eventId, raw_item_id: rawId, source_code: "sec_edgar",
    metadata: { display_payload: { data: { delisting_or_removal_date: "2025-02-12" } } } };
  const before = structuredClone(event);
  const value = evaluateStoredForm25({ raw: raw(), scope, asOf, event });
  assert.equal(value.listing, "unresolved"); assert.ok(value.reasons.includes("analysis_date_conflict"));
  assert.deepEqual(event, before);
});

test("official reader is read-only, exact ID bound, replay/concurrent reads do not create rows", async () => {
  const source = raw(); const before = structuredClone(source); const calls: string[] = [];
  const repository = repositoryFor([source], calls);
  const reads = await Promise.all(Array.from({ length: 4 }, () => readStoredDelistingState({ rawItemIds: [rawId, rawId], scope, asOf, repository })));
  assert.ok(reads.every((row) => row.listing === "confirmed_exchange_delisting" && row.evidence.length === 1));
  assert.deepEqual(reads[0], reads[1]); assert.deepEqual(source, before);
  assert.ok(calls.every((call) => ["select:raw_items", "select:events", "rpc:read_current_event_listing_risk_facts"].includes(call)));
});
test("missing/read failed/ambiguous selection prevents false current status", async () => {
  for (const repository of [repositoryFor([]), { ...repositoryFor([raw()]), select: async () => ({ ok: false, status: 503, data: null }) }]) {
    assert.equal((await readStoredDelistingState({ rawItemIds: [rawId], scope, asOf, repository })).listing, "unresolved");
  }
  const later = raw(`${notice} This removal was withdrawn.`); later.id = "25000000-0000-4000-8000-000000000003";
  for (const ids of [[rawId, later.id], [later.id, rawId]]) {
    const value = await readStoredDelistingState({ rawItemIds: ids, scope, asOf, repository: repositoryFor([raw(), later]) });
    assert.equal(value.listing, "unresolved"); assert.equal(value.evidence.length, 2);
    assert.equal(value.coverage, "selected_stored_filing_evidence_only");
  }
});
test("current Listing Risk source-stated occurred facts pass the existing official validator", async () => {
  const facts = listingFacts();
  assert.deepEqual(validateListingRiskEventFacts(facts), []);
  const source = raw();
  const primary = `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:ix="http://www.xbrl.org/2013/inlineXBRL" xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:dei="http://xbrl.sec.gov/dei/2025"><ix:header><ix:resources><xbrli:context id="c1"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">0001492674</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>2025-07-21</xbrli:instant></xbrli:period></xbrli:context></ix:resources></ix:header><ix:nonNumeric name="dei:Security12bTitle" contextRef="c1">Common Stock</ix:nonNumeric><ix:nonNumeric name="dei:TradingSymbol" contextRef="c1">EXAMPLE</ix:nonNumeric><ix:nonNumeric name="dei:SecurityExchangeName" contextRef="c1">Nasdaq Stock Market LLC</ix:nonNumeric><p>${notice}</p></html>`;
  Object.assign(source, { source_group: "filings", fetched_at: "2026-09-14T00:00:00Z" });
  Object.assign(source.raw_payload, { cik: "1492674", form_type: "8-K", filing_date: "2025-07-21", primary_document_html: primary,
    primary_document_html_char_count: primary.length, primary_document_html_truncated: false });
  const repo = repositoryFor([source]);
  repo.rpc = async () => ({ ok: true, status: 200, data: {
    status: "available", event_id: eventId, raw_item_id: rawId,
    parent_primary_ai_run_id: "25000000-0000-4000-8000-000000000004",
    source_execution_id: "25000000-0000-4000-8000-000000000005", monitor_analyzer_key: "listing_risk",
    analyzer_contract_version: LISTING_RISK_ANALYZER_PROMPT_VERSION,
    persisted_at: "2026-09-14T00:00:00Z", fact_schema_version: LISTING_RISK_EVENT_FACTS_VERSION, facts,
  } });
  const value = await readStoredDelistingState({ rawItemIds: [rawId], scope, asOf, repository: repo });
  assert.equal(value.evidence[0].listingRisk?.status, "available");
  assert.equal(value.listing, "confirmed_exchange_delisting");
  assert.equal(value.evidence[0].parser, null, "8-K is not run through Form 25 semantics");
  const current = value.evidence[0].listingRisk!;
  assert.equal(current.status, "available");
  if (current.status !== "available") throw new Error("bad synthetic contract");
  const conflict = structuredClone(current); conflict.facts.dates.removal_effective_date.date_status = "conditional";
  assert.equal(applyCurrentListingRiskEvidence(value.evidence[0], conflict, scope, asOf).listing, "unresolved");
  const wrong = structuredClone(current); wrong.facts.affected_security.title.value = "Warrants";
  assert.equal(applyCurrentListingRiskEvidence(value.evidence[0], wrong, scope, asOf).listing, "unresolved");
  const poisoned = { ...value.evidence[0], reasons: ["notice_security_conflict"] };
  const withSuspension = structuredClone(current);
  withSuspension.facts.dates.trading_suspension_date = { ...withSuspension.facts.dates.removal_effective_date, value: "2025-02-12" };
  const guarded = applyCurrentListingRiskEvidence(poisoned, withSuspension, scope, asOf);
  assert.equal(guarded.listing, "unresolved"); assert.equal(guarded.trading, "unresolved");
});

function repositoryFor(sources: ReturnType<typeof raw>[], calls: string[] = []): DelistingRepository {
  return { select: async (table, query) => {
    calls.push(`select:${table}`);
    if (table === "raw_items") return { ok: true, status: 200, data: sources.filter((row) => `eq.${row.id}` === query.id) };
    return { ok: true, status: 200, data: [{ id: eventId, raw_item_id: query.raw_item_id.slice(3), source_code: "sec_edgar", metadata: {} }] };
  }, rpc: async (name) => { calls.push(`rpc:${name}`); return { ok: true, status: 200, data: { status: "not_ready", reason: "no_typed_facts" } }; } };
}
function listingFacts(): ListingRiskEventFacts {
  const absent = { value: null, availability: "unavailable", value_quality: "unknown", source_ref: null } as const;
  const absentDate = { ...absent, date_status: "unknown" } as const;
  const text = (value: string) => ({ value, availability: "available", value_quality: "exact", source_ref: "sec:notice" }) as const;
  const facts: ListingRiskEventFacts = {
    version: LISTING_RISK_EVENT_FACTS_VERSION, classification: { event_kind: "listing_removal", event_outcome: "adverse", source_ref: "sec:notice" },
    exchange: text(scope.exchange), affected_security: { title: text(scope.securityTitle), ticker: absent, security_basis: absent },
    listing_rule: absent, listing_requirement: absent, compliance_period: absent,
    proceeding: { kind: "unknown", status: "unknown", source_ref: null },
    dates: { notice_date: absentDate, compliance_deadline: absentDate, hearing_date: absentDate, appeal_deadline: absentDate,
      trading_suspension_date: absentDate, removal_effective_date: { ...text("2025-07-21"), date_status: "occurred" } },
    continued_trading: { continues: absent, venue: absent }, as_of: { ...text("2025-07-21"), date_status: "occurred" }, confidence: null,
    sources: [{ source_family: "sec", source_id: accession, source_url: url.replace("primary_doc.xml", "notice.txt"), source_ref: "sec:notice", evidence: notice }],
    fact_provenance: ["classification.event_kind", "classification.event_outcome", "exchange.value", "affected_security.title.value", "dates.removal_effective_date.value"].map((path) => ({
      fact_path: path as ListingRiskEventFacts["fact_provenance"][number]["fact_path"], origin: path.startsWith("classification") ? "domain_interpreted" : "source_stated",
      source_ref: "sec:notice", evidence: notice, evidence_status: "available", evidence_issue: null, confidence: "high", as_of: "2025-07-21", formula_id: null, input_fact_paths: [],
    })),
  };
  return facts;
}
