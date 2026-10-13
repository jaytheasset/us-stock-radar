import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { evaluateMonitorConditions, type ListingMonitorCondition } from "../listingMonitorMatcher.ts";
import { form144AlertEvidence } from "./form144AlertEvidence.ts";
import { secondaryMonitorDisplay, safeSecEvidenceUrl } from "./secondaryMonitorEvidence.ts";
import type { CurrentOwnershipReadResult } from "./ownershipMonitorPersistence.ts";

const eventId = "ea10cbc7-28d3-4973-9ab9-933306c318b4";
const rawItemId = "b183769d-489a-42f9-9e5a-5dc5280e7357";
const accessionNumber = "0001959173-26-000698";
const sourceUrl = "https://www.sec.gov/Archives/edgar/data/1748790/000195917326000698/primary_doc.xml";
// Deliberately synthetic for unit tests; retained real XML is exercised separately in the isolated DB.
const xml = "<synthetic-unit-fixture/>";
const raw = { accession_number: accessionNumber, form_type: "144", company_name: "Fixture issuer", ownership_source_url: sourceUrl, ownership_source_text: xml };
const conditions: ListingMonitorCondition[] = [
  { key: "ownership.form144.security_class", operator: "eq", value: "Common" },
  { key: "ownership.form144.proposed_sale_shares", operator: "gte", value: 25000 },
];
function current(shares = [1, 30000], titles = ["Common", "Common"]): CurrentOwnershipReadResult {
  return {
    status: "available", form: "form144", eventId, rawItemId, sourceExecutionId: eventId,
    accessionNumber, filingForm: "144", parserVersion: "ownership-parser-v1",
    persistedAt: "2026-09-29T11:33:10Z", filedAt: "2026-02-06T17:31:43Z",
    rows: shares.map((value, index) => ({
      event_id: eventId, proposed_sale_index: index, symbol: "AMCR", security_title: titles[index],
      securities_to_be_sold: value, securities_to_be_sold_availability: "available", securities_to_be_sold_value_quality: "exact",
      provenance: { source_url: sourceUrl, source_xml_sha256: createHash("sha256").update(xml).digest("hex"),
        issuer_identity: { canonical_ticker: "AMCR", target_ticker: "AMCR" } },
    })),
  };
}
function match(ownership = current(), definition = conditions) {
  return evaluateMonitorConditions({ ownership, listing: { status: "not_ready", reason: "unused" }, corporateAction: { status: "not_ready", reason: "unused" } }, definition, { evaluationDate: "2026-10-14" });
}

test("snapshot uses the actual matching row and survives changes to conditions and reader values", async () => {
  const definition = structuredClone(conditions), source = current();
  const result = match(source, definition);
  assert.equal(result.form144MatchedRowIndex, 1);
  const saved = await form144AlertEvidence(source, result, definition, "2026-10-14T01:00:00Z", async () => raw);
  assert(saved);
  assert.equal(saved.rowIndex, 1);
  assert.equal(saved.conditions[1].fact, 30000);
  assert.equal(saved.companyName, "Fixture issuer");
  definition[1] = { ...definition[1], value: 99999 };
  assert.equal(saved.conditions[1].expected, 25000);
  assert.equal(secondaryMonitorDisplay(saved, eventId, eventId).status, "stored");
  assert.equal(match(current([1, 2])).status, "no_match");
  assert.equal(saved.conditions[1].fact, 30000);
});

test("facts in separate rows never become a joint evidence match", async () => {
  const source = current([1, 30000], ["Common", "Preferred"]), result = match(source);
  assert.equal(result.status, "no_match");
  assert.equal(result.form144MatchedRowIndex, undefined);
  assert.equal(await form144AlertEvidence(source, result, conditions, "2026-10-14T01:00:00Z"), undefined);
});

test("missing/denied identity stays unconfirmed and hash-mismatched metadata is not reused", async () => {
  for (const read of [async () => { throw Error("denied"); }, async () => ({ ...raw, ownership_source_text: "changed" })]) {
    const evidence = await form144AlertEvidence(current(), match(), conditions, "2026-10-14T01:00:00Z", read);
    assert(evidence); assert.equal(evidence.companyName, null); assert.equal(evidence.ticker, "AMCR");
  }
  const source = current();
  if (source.status !== "available") throw Error("fixture");
  const noTicker = { ...source, rows: source.rows.map(row => ({ ...row, symbol: null })) } as CurrentOwnershipReadResult;
  assert.equal((await form144AlertEvidence(noTicker, match(noTicker), conditions, "2026-10-14T01:00:00Z", async () => raw))?.ticker, null);
});

test("legacy, malformed and cross-event snapshots are distinct and never reconstructed", async () => {
  assert.equal(secondaryMonitorDisplay(null, eventId, eventId).status, "not_preserved");
  assert.equal(secondaryMonitorDisplay({}, eventId, eventId).status, "invalid");
  const saved = await form144AlertEvidence(current(), match(), conditions, "2026-10-14T01:00:00Z", async () => raw);
  assert(saved);
  assert.equal(secondaryMonitorDisplay(saved, rawItemId, eventId).status, "invalid");
  assert.equal(secondaryMonitorDisplay(saved, eventId, rawItemId).status, "invalid");
  assert.equal(secondaryMonitorDisplay({ ...saved, sourceUrl: "javascript:alert(1)" }, eventId, eventId).status, "invalid");
  const partial = { ...saved, conditions: [...saved.conditions, { key: "market.current_price", label: "Price", operator: "gte", expected: 1, fact: null, factStatus: "not_preserved" }] };
  assert.equal(secondaryMonitorDisplay(partial, eventId, eventId).status, "partial");
});

test("SEC links must identify the stored accession and cannot contain credentials or redirects", () => {
  assert.equal(safeSecEvidenceUrl(sourceUrl, accessionNumber), sourceUrl);
  for (const url of [sourceUrl.replace("www.sec.gov", "evil.test"), sourceUrl.replace("000698", "000699"), sourceUrl + "?redirect=evil", sourceUrl.replace("https://", "https://user@"), "//www.sec.gov/Archives/edgar/data/1/file.xml"]) {
    assert.equal(safeSecEvidenceUrl(url, accessionNumber), null);
  }
});
