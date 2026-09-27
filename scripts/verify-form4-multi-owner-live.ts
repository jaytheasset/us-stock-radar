import assert from "node:assert/strict";
import {
  evaluateForm4InsiderPurchase,
  type Form4InsiderPurchaseSettings,
} from "../lib/monitor/form4InsiderPurchaseMonitor.ts";
import type { CurrentOwnershipReadResult } from "../lib/monitor/ownershipMonitorPersistence.ts";
import { buildOwnershipParserFactRows } from "../lib/monitor/ownershipParserFacts.ts";
import {
  buildOwnershipContextReferenceInventory,
  validateOwnershipContextCandidate,
} from "../lib/monitor/ownershipStructuredContext.ts";

const eventId = "82222222-2222-4222-8222-222222222222";
const rawItemId = "81111111-1111-4111-8111-111111111111";
const accessionNumber = "0001062993-21-005353";
const sourceUrl = "https://www.sec.gov/Archives/edgar/data/1015823/000106299321005353/form4.xml";
const response = await fetch(sourceUrl, {
  headers: { "User-Agent": "StockRadar/1.0 contact@example.com", Accept: "application/xml,text/xml;q=0.9,*/*;q=0.1" },
});
assert.equal(response.ok, true, `SEC XML fetch failed with ${response.status}`);
const sourceXml = await response.text();
assert.equal((sourceXml.match(/<reportingOwner>/g) ?? []).length, 5);
assert.equal((sourceXml.match(/<transactionCode>P<\/transactionCode>/g) ?? []).length, 4);

const issuerCik = xmlValue(sourceXml, "issuerCik");
const ticker = xmlValue(sourceXml, "issuerTradingSymbol");
assert.equal(ticker, "RVPH");
const built = buildOwnershipParserFactRows({
  eventId,
  symbol: ticker,
  rawItem: {
    id: rawItemId,
    source_unique_id: accessionNumber,
    raw_payload: {
      form_type: "4",
      accession_number: accessionNumber,
      cik: issuerCik,
      ownership_issuer_cik: issuerCik,
      ownership_issuer_trading_symbol: ticker,
      ticker,
      ownership_source_text: sourceXml,
      ownership_source_url: sourceUrl,
      ownership_source_format: "ownership_xml",
      ownership_source_text_truncated: false,
    },
  },
});
assert.equal(built.form4Transactions.length, 4);
const profiles = ((built.form4Transactions[0].provenance as Record<string, unknown>).reporting_owner_profiles ?? []) as Record<string, unknown>[];
const directorIndex = profiles.findIndex((profile) => profile.is_director === true);
assert.equal(String(profiles[directorIndex]?.name), "SAXENA PARAG");

const sourceFingerprint = `ownership-context-v1:${"a".repeat(64)}`;
const inventory = buildOwnershipContextReferenceInventory({
  eventId,
  form: "form4",
  isAmendment: false,
  sourceFingerprint,
  rows: built.form4Transactions,
  sourceXml,
});
const forgedPositive = validateOwnershipContextCandidate({
  version: "ownership_context_v1",
  event_ref: inventory.eventRef,
  form: "form4",
  source_fingerprint: sourceFingerprint,
  rows: inventory.rows.map((row) => ({
    row_ref: row.rowRef,
    assertions: [{
      fact: "ownership_relation",
      status: "supported",
      value: "indirect",
      owner_ref: row.ownerRefs[directorIndex],
      footnote_refs: row.linkedFootnoteRefs,
      evidence_refs: [row.evidenceRefs[0]],
    }],
  })),
}, inventory);
assert.equal(forgedPositive.ok, false, "linked entity footnotes must not be promoted into a director relation");
if (forgedPositive.ok) throw new Error("unreachable");
assert.ok(forgedPositive.errors.every((error) => /not established for that owner/.test(error)));

const current: Extract<CurrentOwnershipReadResult, { status: "available"; form: "form4" }> = {
  status: "available",
  form: "form4",
  filingForm: "4",
  filedAt: "2021-06-03T17:14:35.000Z",
  eventId,
  rawItemId,
  sourceExecutionId: eventId,
  accessionNumber,
  parserVersion: built.parserOutput.parserVersion,
  persistedAt: "2021-06-03T17:14:35.000Z",
  rows: built.form4Transactions as never,
  contextEligibility: { status: "eligible", inventory },
  context: { status: "absent" },
};
const settings: Form4InsiderPurchaseSettings = {
  target: { scope: "ticker", ticker: "RVPH" },
  role: "director",
  minimumShares: null,
};
const result = evaluateForm4InsiderPurchase(current, settings);
assert.deepEqual(result, {
  status: "ineligible",
  reasonCode: "ownership_reporter_attribution_unavailable",
});

process.stdout.write(`${JSON.stringify({
  ok: true,
  sourceUrl,
  accessionNumber,
  ticker,
  reportingOwnerCount: profiles.length,
  canonicalTransactionRows: built.form4Transactions.length,
  selectedRole: { owner: profiles[directorIndex].name, role: "director" },
  canonicalRelationValidation: "rejected",
  evaluation: result,
  conclusion: "multi-owner positive remains unverified; the real filing fails closed because linked footnotes do not establish the director's row relation",
}, null, 2)}\n`);

function xmlValue(sourceText: string, localName: string) {
  const tag = `(?:[A-Za-z_][\\w.-]*:)?${localName}`;
  return sourceText.match(new RegExp(`<${tag}\\b[^>]*>\\s*([^<]*?)\\s*</${tag}>`, "i"))?.[1]?.trim() ?? null;
}
