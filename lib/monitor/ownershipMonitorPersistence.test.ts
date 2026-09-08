import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildOwnershipParserFactRows } from "./ownershipParserFacts.ts";
import {
  readCurrentOwnershipFacts,
  type OwnershipMonitorRepository,
} from "./ownershipMonitorPersistence.ts";

type Row = Record<string, unknown>;

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = join(here, "../sources/sec/forms/ownership/fixtures");
const eventId = "22222222-2222-4222-8222-222222222222";
const rawItemId = "33333333-3333-4333-8333-333333333333";

test("official reader returns verified Form 4 XML rows and stable event execution lineage", async () => {
  const state = canonicalState("source-agig-form4-purchase.json", "AGIG");
  const current = await readCurrentOwnershipFacts(eventId, repository(state));

  assert.equal(current.status, "available");
  if (current.status !== "available") return;
  assert.equal(current.form, "form4");
  assert.equal(current.sourceExecutionId, eventId);
  assert.equal(current.rawItemId, rawItemId);
  assert.equal(current.accessionNumber, "0001493152-26-023264");
  assert.equal(current.rows.length, state.form4.length);
  assert.equal(current.rows[0].transaction_code, "P");
  assert.equal(current.rows[0].economic_direction, "unknown");
  assert.equal(current.rows[0].transaction_value, null);
});

test("official reader keeps Form 144 proposed-sale rows separate from executed Form 4 rows", async () => {
  const state = canonicalState("source-walmart-form144-namespaced.json", "WMT");
  const current = await readCurrentOwnershipFacts(eventId, repository(state));

  assert.equal(current.status, "available");
  if (current.status !== "available") return;
  assert.equal(current.form, "form144");
  assert.equal(current.accessionNumber, "0001958244-26-000308");
  assert.ok(current.rows.length > 0);
  assert.equal(record(current.rows[0].provenance).fact_kind, "form144_proposed_sale_notice");
  assert.equal(record(current.rows[0].provenance).execution_status, "proposed_not_executed");
  assert.equal(current.rows[0].proposed_sale_percent, null);
});

test("wrong provenance, LLM-only rows, mixed form families, and missing rows fail closed", async () => {
  const original = canonicalState("source-agig-form4-purchase.json", "XXII");
  const wrong = structuredClone(original);
  record(wrong.form4[0].provenance).source = "sec_ownership_analysis";
  assert.deepEqual(
    await readCurrentOwnershipFacts(eventId, repository(wrong)),
    { status: "not_ready", reason: "ownership_provenance_invalid" },
  );

  const llmOnly = structuredClone(original);
  llmOnly.form4[0].provenance = {
    source: "sec_ownership_analysis",
    canonical_input: "analysis_output.ownership_monitor_facts",
  };
  assert.deepEqual(
    await readCurrentOwnershipFacts(eventId, repository(llmOnly)),
    { status: "not_ready", reason: "ownership_provenance_invalid" },
  );

  const wrongIssuer = structuredClone(original);
  record(record(wrongIssuer.form4[0].provenance).issuer_identity).target_cik = "0001347858";
  assert.deepEqual(
    await readCurrentOwnershipFacts(eventId, repository(wrongIssuer)),
    { status: "not_ready", reason: "ownership_provenance_invalid" },
  );

  const injectedTicker = structuredClone(original);
  injectedTicker.form4[0].symbol = "XXII";
  assert.deepEqual(
    await readCurrentOwnershipFacts(eventId, repository(injectedTicker)),
    { status: "not_ready", reason: "ownership_provenance_invalid" },
  );

  const form144 = canonicalState("source-walmart-form144-namespaced.json", "WMT");
  const mixed = { ...structuredClone(original), form144: form144.form144 };
  assert.deepEqual(
    await readCurrentOwnershipFacts(eventId, repository(mixed)),
    { status: "not_ready", reason: "ownership_form_families_mixed" },
  );

  const empty = { ...structuredClone(original), form4: [] };
  assert.deepEqual(
    await readCurrentOwnershipFacts(eventId, repository(empty)),
    { status: "not_ready", reason: "ownership_rows_missing" },
  );
});

function canonicalState(filename: string, ticker: string) {
  const fixture = JSON.parse(readFileSync(join(fixtureRoot, filename), "utf8")) as Row;
  const accession = String(fixture.accessionNumber);
  const formType = String(fixture.formType);
  const sourceFilename = formType.startsWith("144") ? "primary_doc.xml" : "ownership.xml";
  const sourceUrl = `https://www.sec.gov/Archives/edgar/data/1000000/${accession.replace(/-/g, "")}/${sourceFilename}`;
  const sourceText = String(fixture.filingText ?? fixture.primaryDocumentText ?? "");
  const issuerCik = xmlValue(sourceText, "issuerCik");
  const issuerTicker = xmlValue(sourceText, "issuerTradingSymbol");
  const canonicalTicker = issuerTicker ?? ticker;
  const rawItem = {
    id: rawItemId,
    source_code: "sec_edgar",
    source_group: "filings",
    source_unique_id: accession,
    source_url: sourceUrl.replace(/\/[^/]+$/, `/${accession}-index.html`),
    title: `SEC Form ${formType}`,
    published_at: "2026-09-08T00:00:00.000Z",
    metadata: {},
    raw_payload: {
      form_type: formType,
      accession_number: accession,
      ticker: canonicalTicker,
      cik: issuerCik,
      ownership_issuer_cik: issuerCik,
      ...(issuerTicker ? { ownership_issuer_trading_symbol: issuerTicker } : {}),
      ownership_source_text: sourceText,
      ownership_source_url: sourceUrl,
      ownership_source_format: "ownership_xml",
      ownership_source_text_truncated: false,
    },
  };
  const built = buildOwnershipParserFactRows({ eventId, rawItem, symbol: canonicalTicker });
  return {
    event: {
      id: eventId,
      raw_item_id: rawItemId,
      source_code: "sec_edgar",
      source_group: "filings",
      event_type: "insider_ownership",
      metadata: { form_type: formType, accession_number: accession },
    },
    form4: built.form4Transactions,
    form144: built.form144ProposedSales,
  };
}

function xmlValue(sourceText: string, localName: string) {
  const tag = `(?:[A-Za-z_][\\w.-]*:)?${localName}`;
  return sourceText.match(new RegExp(`<${tag}\\b[^>]*>\\s*([^<]*?)\\s*<\\/${tag}>`, "i"))?.[1]?.trim() ?? null;
}

function repository(state: ReturnType<typeof canonicalState>): OwnershipMonitorRepository {
  return {
    async select(table) {
      if (table === "events") return { ok: true, status: 200, data: [state.event] };
      if (table === "event_form4_transactions") return { ok: true, status: 200, data: state.form4 };
      if (table === "event_form144_proposed_sales") return { ok: true, status: 200, data: state.form144 };
      return { ok: false, status: 404, data: null, error: "unexpected table" };
    },
  };
}

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}
