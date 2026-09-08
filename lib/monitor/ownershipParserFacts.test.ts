import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildOwnershipParserFactRows,
  OwnershipParserSourceError,
} from "./ownershipParserFacts.ts";
import {
  persistOwnershipAnalysisFacts,
  type MonitorPersistenceRepository,
} from "./persistence.ts";

type Row = Record<string, unknown>;

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = join(here, "../sources/sec/forms/ownership/fixtures");
const eventId = "22222222-2222-4222-8222-222222222222";
const eventTime = "2026-09-08T00:00:00.000Z";

test("verified Form 4 XML builds source-backed rows without LLM semantics or calculations", () => {
  const rawItem = rawItemFromFixture("form4-insider-purchase.json", "ATRB");
  const result = buildOwnershipParserFactRows({ eventId, rawItem });

  assert.equal(result.formType, "4");
  assert.equal(result.form4Transactions.length, 1);
  assert.equal(result.form144ProposedSales.length, 0);
  const row = result.form4Transactions[0];
  assert.equal(row.transaction_index, 0);
  assert.equal(row.transaction_kind, "non_derivative");
  assert.equal(row.transaction_code, "P");
  assert.equal(row.acquired_disposed_code, "A");
  assert.equal(row.economic_direction, "unknown");
  assert.equal(row.shares, 25_000);
  assert.equal(row.price_per_share, 12.4);
  assert.equal(row.post_transaction_shares, 425_000);
  assert.equal(row.transaction_date, "2026-05-20");
  assert.equal(row.transaction_value, null);
  assert.equal(row.transaction_value_availability, "unavailable");
  assert.equal(row.is_10b5_1, null);
  assert.deepEqual(row.reporting_owner_names, ["Maya Chen"]);
  assert.equal((row.provenance as Row).source, "sec_ownership_xml_parser");
  assert.equal((row.provenance as Row).source_verified, true);
  assert.equal((row.provenance as Row).fact_kind, "reported_form4_transaction");
  assert.deepEqual((row.provenance as Row).issuer_identity, {
    source: "ownership_xml",
    match_status: "exact_cik",
    xml_cik: "0001999001",
    target_cik: "0001999001",
    xml_ticker: "ATRB",
    target_ticker: "ATRB",
    canonical_ticker: "ATRB",
  });
  assert.equal((row.calculation_basis as Row).transaction_value_not_computed, true);
});

test("multiple Form 4 reporters remain a filing-level unattributed set", () => {
  const result = buildOwnershipParserFactRows({
    eventId,
    rawItem: rawItemFromFixture("form4-multiple-owners-unknown-code.json", "UNKN"),
  });
  const row = result.form4Transactions[0];

  assert.deepEqual(row.reporting_owner_names, ["First Owner", "Second Owner LLC"]);
  assert.deepEqual(row.reporting_owner_roles, ["director", "10_percent_owner"]);
  assert.equal(row.is_director, null);
  assert.equal(row.is_10_percent_owner, null);
  assert.equal((row.provenance as Row).reporting_owner_scope, "filing_level_unattributed_owner_set");
  assert.equal(row.shares, 100);
  assert.equal(row.price_per_share, null);
  assert.equal(row.post_transaction_shares, null);
});

test("Form 144 XML remains a proposed-sale type and does not derive a blind percentage", () => {
  const result = buildOwnershipParserFactRows({
    eventId,
    rawItem: rawItemFromFixture("form144-proposed-sale-safety.json", "SELL"),
  });

  assert.equal(result.form4Transactions.length, 0);
  assert.equal(result.form144ProposedSales.length, 1);
  const row = result.form144ProposedSales[0];
  assert.equal(row.proposed_sale_index, 0);
  assert.equal(row.seller_name, "Sam Seller");
  assert.equal(row.securities_to_be_sold, 2_500);
  assert.equal(row.aggregate_market_value, 50_000);
  assert.equal(row.shares_outstanding, 10_000_000);
  assert.equal(row.approximate_sale_date, "2026-05-25");
  assert.equal(row.proposed_sale_percent, null);
  assert.equal((row.provenance as Row).fact_kind, "form144_proposed_sale_notice");
  assert.equal((row.provenance as Row).execution_status, "proposed_not_executed");
  assert.match(
    String((row.calculation_basis as Row).proposed_sale_percent_not_computed),
    /unit_comparability/,
  );
});

test("product persistence ignores late or numerically wrong LLM detail output", async () => {
  const state = { form4: [] as Row[], form144: [] as Row[], calls: 0 };
  const repository = repositoryFor(state);
  const rawItem = rawItemFromFixture("form4-insider-purchase.json", "ATRB");
  const wrongLlmOutput = {
    version: "ownership_monitor_facts_v1",
    form4: {
      reporting_owners: [],
      transactions: [{ shares: { value: 999_999_999 } }],
    },
    form144: null,
  };

  await persistOwnershipAnalysisFacts({
    eventId,
    eventTime,
    primaryTicker: { symbol: "ATRB" },
    ownershipRawItem: rawItem,
    ownershipAnalysisOutput: wrongLlmOutput,
    ownershipInputState: "known",
  }, repository);
  const first = structuredClone(state.form4);
  await persistOwnershipAnalysisFacts({
    eventId,
    eventTime,
    primaryTicker: { symbol: "ATRB" },
    ownershipRawItem: rawItem,
    ownershipAnalysisOutput: { ...wrongLlmOutput, late: true },
    ownershipInputState: "known",
  }, repository);

  assert.equal(state.calls, 2);
  assert.equal(state.form4.length, 1);
  assert.equal(state.form4[0].shares, 25_000);
  assert.equal(state.form4[0].transaction_value, null);
  assert.deepEqual(
    stripUpdatedAt(state.form4),
    stripUpdatedAt(first),
    "same filing replay must not change parser-backed values",
  );
});

test("missing and unverifiable sources fail closed before any typed write", async () => {
  const missing = rawItemFromFixture("form4-insider-purchase.json", "MISS");
  delete (missing.raw_payload as Row).ownership_source_text;
  assertSourceError(() => buildOwnershipParserFactRows({ eventId, rawItem: missing }), "source_missing");

  const wrongAccessionUrl = rawItemFromFixture("form4-insider-purchase.json", "WRONGURL");
  (wrongAccessionUrl.raw_payload as Row).ownership_source_url =
    "https://www.sec.gov/Archives/edgar/data/1000000/000000000026999999/ownership.xml";
  assertSourceError(
    () => buildOwnershipParserFactRows({ eventId, rawItem: wrongAccessionUrl }),
    "source_verification_failed",
  );

  const untrusted = rawItemFromFixture("form4-insider-purchase.json", "BAD");
  (untrusted.raw_payload as Row).ownership_source_url = "https://example.com/untrusted.xml";
  assertSourceError(
    () => buildOwnershipParserFactRows({ eventId, rawItem: untrusted }),
    "source_verification_failed",
  );

  const malformed = rawItemFromFixture("form4-insider-purchase.json", "BADXML");
  (malformed.raw_payload as Row).ownership_source_text = String(
    (malformed.raw_payload as Row).ownership_source_text,
  ).replace(/<\/ownershipDocument>\s*$/i, "");
  assertSourceError(
    () => buildOwnershipParserFactRows({ eventId, rawItem: malformed }),
    "source_verification_failed",
  );

  const state = { form4: [{ shares: 7 }], form144: [] as Row[], calls: 0 };
  const validLlmOutput = {
    version: "ownership_monitor_facts_v1",
    form4: { reporting_owners: [], transactions: [] },
    form144: null,
  };
  await assert.rejects(
    persistOwnershipAnalysisFacts({
      eventId,
      eventTime,
      ownershipAnalysisOutput: validLlmOutput,
      ownershipInputState: "known",
    }, repositoryFor(state)),
    OwnershipParserSourceError,
  );
  assert.equal(state.calls, 0);
  assert.deepEqual(state.form4, [{ shares: 7 }]);

  await assert.rejects(
    persistOwnershipAnalysisFacts({
      eventId,
      eventTime,
      ownershipRawItem: missing,
      ownershipAnalysisOutput: validLlmOutput,
      ownershipInputState: "known",
    }, repositoryFor(state)),
    OwnershipParserSourceError,
  );
  assert.equal(state.calls, 0);
  assert.deepEqual(state.form4, [{ shares: 7 }]);

  await assert.rejects(
    persistOwnershipAnalysisFacts({
      eventId,
      eventTime,
      ownershipRawItem: untrusted,
      ownershipAnalysisOutput: validLlmOutput,
      ownershipInputState: "known",
    }, repositoryFor(state)),
    OwnershipParserSourceError,
  );
  assert.equal(state.calls, 0);
  assert.deepEqual(state.form4, [{ shares: 7 }]);

  await assert.rejects(
    persistOwnershipAnalysisFacts({
      eventId,
      eventTime,
      ownershipRawItem: wrongAccessionUrl,
      ownershipAnalysisOutput: validLlmOutput,
      ownershipInputState: "known",
    }, repositoryFor(state)),
    OwnershipParserSourceError,
  );
  assert.equal(state.calls, 0);
  assert.deepEqual(state.form4, [{ shares: 7 }]);

  await assert.rejects(
    persistOwnershipAnalysisFacts({
      eventId,
      eventTime,
      ownershipRawItem: malformed,
      ownershipAnalysisOutput: validLlmOutput,
      ownershipInputState: "known",
    }, repositoryFor(state)),
    OwnershipParserSourceError,
  );
  assert.equal(state.calls, 0);
  assert.deepEqual(state.form4, [{ shares: 7 }]);
});

test("issuer CIK mismatch and caller ticker injection fail before any typed write", async () => {
  const agig = rawItemFromFixture("source-agig-form4-purchase.json", "AGIG");
  const wrongIssuer = structuredClone(agig);
  Object.assign(wrongIssuer.raw_payload as Row, {
    cik: "0001347858",
    ownership_issuer_cik: "0001347858",
    ticker: "XXII",
    ownership_issuer_trading_symbol: "XXII",
  });
  assert.throws(
    () => buildOwnershipParserFactRows({ eventId, rawItem: wrongIssuer, symbol: "XXII" }),
    /issuer CIK does not match/,
  );

  assert.throws(
    () => buildOwnershipParserFactRows({ eventId, rawItem: agig, symbol: "XXII" }),
    /ticker does not match/,
  );

  const state = { form4: [{ shares: 7 }], form144: [] as Row[], calls: 0 };
  await assert.rejects(
    persistOwnershipAnalysisFacts({
      eventId,
      eventTime,
      primaryTicker: { symbol: "XXII" },
      ownershipRawItem: wrongIssuer,
      ownershipInputState: "known",
    }, repositoryFor(state)),
    /issuer CIK does not match/,
  );
  assert.equal(state.calls, 0);
  assert.deepEqual(state.form4, [{ shares: 7 }]);

  await assert.rejects(
    persistOwnershipAnalysisFacts({
      eventId,
      eventTime,
      primaryTicker: { symbol: "XXII" },
      ownershipRawItem: agig,
      ownershipInputState: "known",
    }, repositoryFor(state)),
    /ticker does not match/,
  );
  assert.equal(state.calls, 0);
  assert.deepEqual(state.form4, [{ shares: 7 }]);
});

function rawItemFromFixture(filename: string, ticker: string) {
  const fixture = JSON.parse(readFileSync(join(fixtureRoot, filename), "utf8")) as Row;
  const accession = String(fixture.accessionNumber);
  const formType = String(fixture.formType);
  const sourceUrl = `https://www.sec.gov/Archives/edgar/data/1000000/${accession.replace(/-/g, "")}/ownership.xml`;
  const sourceText = String(fixture.filingText ?? fixture.primaryDocumentText ?? "");
  const issuerCik = xmlValue(sourceText, "issuerCik");
  const issuerTicker = xmlValue(sourceText, "issuerTradingSymbol");
  const canonicalTicker = issuerTicker ?? ticker;
  return {
    id: "33333333-3333-4333-8333-333333333333",
    source_code: "sec_edgar",
    source_unique_id: accession,
    source_url: sourceUrl.replace(/ownership\.xml$/, `${accession}-index.html`),
    title: `SEC Form ${formType}`,
    published_at: "2026-05-26T12:00:00.000Z",
    body_text: "",
    analysis_text: "",
    metadata: {},
    raw_payload: {
      form_type: formType,
      accession_number: accession,
      ticker: canonicalTicker,
      cik: issuerCik,
      ownership_issuer_cik: issuerCik,
      ...(issuerTicker ? { ownership_issuer_trading_symbol: issuerTicker } : {}),
      exchange: "NASDAQ",
      company_name: "Ownership Fixture Co.",
      ownership_source_text: sourceText,
      ownership_source_url: sourceUrl,
      ownership_source_format: "ownership_xml",
      ownership_source_text_truncated: false,
    },
  } satisfies Row;
}

function xmlValue(sourceText: string, localName: string) {
  const tag = `(?:[A-Za-z_][\\w.-]*:)?${localName}`;
  return sourceText.match(new RegExp(`<${tag}\\b[^>]*>\\s*([^<]*?)\\s*<\\/${tag}>`, "i"))?.[1]?.trim() ?? null;
}

function repositoryFor(state: { form4: Row[]; form144: Row[]; calls: number }): MonitorPersistenceRepository {
  return {
    async select() {
      return { ok: true, status: 200, data: [] };
    },
    async replaceMarketSnapshots() {
      return { ok: true, status: 200, data: [] };
    },
    async replaceOwnershipFacts(_eventId, form4Rows, form144Rows) {
      state.calls += 1;
      state.form4 = structuredClone(form4Rows);
      state.form144 = structuredClone(form144Rows);
      return { ok: true, status: 200, data: {} };
    },
  };
}

function assertSourceError(action: () => unknown, code: string) {
  assert.throws(action, (error) => error instanceof OwnershipParserSourceError && error.code === code);
}

function stripUpdatedAt(rows: Row[]) {
  return rows.map(({ updated_at: _updatedAt, ...row }) => row);
}
