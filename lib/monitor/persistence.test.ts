import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseOwnershipFiling } from "../sources/sec/forms/ownership/parser.ts";
import {
  buildOwnershipFactRows,
  persistEventMarketSnapshots,
  persistOptionalMonitorFoundation,
  persistOwnershipParserFacts,
  type MonitorPersistenceRepository,
} from "./persistence.ts";

type Row = Record<string, unknown>;
const here = dirname(fileURLToPath(import.meta.url));
const eventId = "11111111-1111-4111-8111-111111111111";
const eventTime = "2026-08-11T00:00:00.000Z";

function fixture(name: string) {
  const path = join(here, "../sources/sec/forms/ownership/fixtures", name);
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function mockRepository(options: {
  select?: (table: string, search: Record<string, string>) => Row[];
  readFailureTable?: string;
  failMarketReplace?: boolean;
  failOwnershipReplace?: boolean;
  market?: Row[];
  form4?: Row[];
  form144?: Row[];
} = {}) {
  const state = {
    market: [...(options.market || [])],
    form4: [...(options.form4 || [])],
    form144: [...(options.form144 || [])],
    marketReplaceCalls: 0,
    ownershipReplaceCalls: 0,
  };
  const repository: MonitorPersistenceRepository = {
    async select(table, search) {
      if (table === options.readFailureTable) {
        return { ok: false, status: 500, data: null, error: "fixture read boundary" };
      }
      return { ok: true, status: 200, data: options.select?.(table, search) || [] };
    },
    async replaceMarketSnapshots(_eventId, rows) {
      state.marketReplaceCalls += 1;
      if (options.failMarketReplace) return { ok: false, status: 500, data: null, error: "fixture persistence failure" };
      state.market = structuredClone(rows);
      return { ok: true, status: 200, data: rows.length };
    },
    async replaceOwnershipFacts(_eventId, form4Rows, form144Rows) {
      state.ownershipReplaceCalls += 1;
      if (options.failOwnershipReplace) return { ok: false, status: 500, data: null, error: "fixture persistence failure" };
      state.form4 = structuredClone(form4Rows);
      state.form144 = structuredClone(form144Rows);
      return { ok: true, status: 200, data: {} };
    },
  };
  return { repository, state };
}

test("analysis context wins, preserves offering separation, and stores shares/float with four quality states", async () => {
  const { repository, state } = mockRepository({
    select: (table) => table === "event_tickers" ? [{ symbol: "OFFER", exchange: "NASDAQ", metadata: {} }] : [],
  });
  const count = await persistEventMarketSnapshots({
    eventId,
    eventTime,
    primaryTicker: { symbol: "OFFER", exchange: "NASDAQ" },
    analysisMarketContext: {
      ticker: "OFFER",
      price: 4.25,
      market_cap: 125_000_000,
      shares_outstanding: 40_000_000,
      public_float: 20_000_000,
      value_quality: {
        price: "exact",
        market_cap: "estimated",
        shares_outstanding: "derived",
        public_float: "unknown",
      },
      as_of: "2026-08-10T23:58:00Z",
      source: "analysis_fixture",
    },
  }, repository);

  assert.equal(count, 1);
  const row = state.market[0];
  assert.equal(row.price_value_quality, "exact");
  assert.equal(row.market_cap_value_quality, "estimated");
  assert.equal(row.shares_outstanding_value_quality, "derived");
  assert.equal(row.float_shares, null);
  assert.equal(row.float_shares_value_quality, "unknown");
  assert.equal(row.float_shares_availability, "unavailable");
  assert.equal(row.source_kind, "analysis_context");
  assert.equal("offering_amount" in row, false);
  assert.equal("price_quality" in row, false);
});

test("fresh local snapshots support non-offering multi-ticker shares and float", async () => {
  const rowsByTicker: Record<string, Row> = {
    ALFA: { ticker: "ALFA", price: 10, market_cap: 1_000_000_000, shares_outstanding: 100_000_000, float_shares: 75_000_000, source: "local_cache", fetched_at: "2026-08-10T23:30:00Z" },
    BETA: { ticker: "BETA", price: 20, market_cap: 2_000_000_000, shares_outstanding: 200_000_000, float_shares: 150_000_000, source: "local_cache", fetched_at: "2026-08-10T23:31:00Z" },
  };
  const { repository, state } = mockRepository({
    select(table, search) {
      if (table === "event_tickers") return [
        { symbol: "ALFA", exchange: "NYSE", metadata: {} },
        { symbol: "BETA", exchange: "NASDAQ", metadata: { security_key: "class-a" } },
      ];
      if (table === "market_snapshots") {
        const symbol = String(search.ticker || "").replace("eq.", "");
        return rowsByTicker[symbol] ? [rowsByTicker[symbol]] : [];
      }
      return [];
    },
  });

  const count = await persistEventMarketSnapshots({ eventId, eventTime, primaryTicker: { symbol: "ALFA" } }, repository);
  assert.equal(count, 2);
  assert.deepEqual(state.market.map((row) => row.symbol).sort(), ["ALFA", "BETA"]);
  assert.ok(state.market.every((row) => row.shares_outstanding_availability === "available"));
  assert.ok(state.market.every((row) => row.float_shares_availability === "available"));
});

test("tickerless success clears stale snapshots while unavailable ticker data remains explicit", async () => {
  const tickerless = mockRepository({ market: [{ symbol: "STALE" }] });
  const count = await persistEventMarketSnapshots({ eventId, eventTime }, tickerless.repository);
  assert.equal(count, 0);
  assert.deepEqual(tickerless.state.market, []);
  assert.equal(tickerless.state.marketReplaceCalls, 1);

  const unavailable = mockRepository({
    select: (table) => table === "event_tickers" ? [{ symbol: "NONE", metadata: {} }] : [],
  });
  await persistEventMarketSnapshots({ eventId, eventTime, primaryTicker: { symbol: "NONE" } }, unavailable.repository);
  const row = unavailable.state.market[0];
  assert.equal(row.snapshot_status, "unavailable");
  assert.equal(row.price_availability, "unavailable");
  assert.equal(row.price_value_quality, "unknown");
  assert.equal(row.market_cap_availability, "unavailable");
});

test("market replace is scoped, idempotent, and failures or read errors preserve prior rows", async () => {
  const subjects = [
    { symbol: "ONE", metadata: {} },
    { symbol: "TWO", metadata: {} },
  ];
  const replacing = mockRepository({
    market: [{ symbol: "ONE" }, { symbol: "TWO" }, { symbol: "STALE" }],
    select: (table) => table === "event_tickers" ? subjects : [],
  });
  await persistEventMarketSnapshots({ eventId, eventTime }, replacing.repository);
  assert.deepEqual(replacing.state.market.map((row) => row.symbol), ["ONE", "TWO"]);
  const firstWrite = structuredClone(replacing.state.market).map(({ updated_at: _updatedAt, ...row }) => row);
  await persistEventMarketSnapshots({ eventId, eventTime }, replacing.repository);
  assert.deepEqual(replacing.state.market.map(({ updated_at: _updatedAt, ...row }) => row), firstWrite);

  const existing = [{ symbol: "VALID" }];
  const readFailure = mockRepository({ market: existing, readFailureTable: "market_snapshots", select: (table) => table === "event_tickers" ? subjects : [] });
  const readResult = await persistOptionalMonitorFoundation({ eventId, eventTime }, readFailure.repository);
  assert.equal(readResult.ok, false);
  assert.deepEqual(readFailure.state.market, existing);
  assert.equal(readFailure.state.marketReplaceCalls, 0);

  const writeFailure = mockRepository({ market: existing, failMarketReplace: true });
  const writeResult = await persistOptionalMonitorFoundation({ eventId, eventTime }, writeFailure.repository);
  assert.equal(writeResult.ok, false);
  assert.deepEqual(writeFailure.state.market, existing);
});

test("Form 4 transactions remain separate and preserve parser-supplied ownership fields", () => {
  const single = parseOwnershipFiling(fixture("form4-insider-purchase.json") as never);
  const singleRows = buildOwnershipFactRows({ eventId, symbol: "ATRB", parserOutput: single }).form4Transactions;
  assert.equal(singleRows.length, 1);
  assert.equal(singleRows[0].transaction_value, 310_000);
  assert.equal(singleRows[0].transaction_value_value_quality, "derived");
  assert.equal(singleRows[0].transaction_value_availability, "available");
  assert.equal(singleRows[0].post_transaction_shares_value_quality, "exact");
  assert.equal("ownership_percent" in singleRows[0], false);

  const multi = parseOwnershipFiling(fixture("form4-multi-owner-10b5-1-conversion.json") as never);
  const rows = buildOwnershipFactRows({ eventId, symbol: "UWMC", parserOutput: multi }).form4Transactions;
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => row.transaction_index), [0, 1, 2]);
  assert.deepEqual(rows.map((row) => row.acquired_disposed_code), ["D", "A", "D"]);
  assert.deepEqual(rows.map((row) => row.shares), [632_874, 6_600_000, 6_600_000]);
  assert.ok((rows[0].reporting_owner_roles as string[]).length > 1);
  assert.equal(rows[0].is_10_percent_owner, true);
  assert.equal(rows[0].is_10b5_1, true);
  assert.ok(rows.every((row) => row.post_transaction_shares !== undefined));
});

test("Form 144 exchange and exact value are retained; percentage is only derived from both inputs", () => {
  const parsed = parseOwnershipFiling(fixture("form144-detailed-proposed-sale.json") as never);
  const rows = buildOwnershipFactRows({ eventId, symbol: "D144", parserOutput: parsed }).form144ProposedSales;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].exchange, "NASDAQ");
  assert.equal(rows[0].aggregate_market_value, 987_600);
  assert.equal(rows[0].aggregate_market_value_value_quality, "exact");
  assert.equal(rows[0].proposed_sale_percent, 0.02469);
  assert.equal(rows[0].proposed_sale_percent_value_quality, "derived");

  const withoutDenominator = structuredForm144ParserOutput({
    securities_to_be_sold: 1_000,
    aggregate_market_value: 25_000,
    shares_outstanding: null,
    proposed_sale_percent_of_shares_outstanding: 99,
  });
  const unsupported = buildOwnershipFactRows({ eventId, symbol: "CBLD", parserOutput: withoutDenominator }).form144ProposedSales[0];
  assert.equal(unsupported.proposed_sale_percent, null);
  assert.equal(unsupported.proposed_sale_percent_value_quality, "unknown");
  assert.equal(unsupported.proposed_sale_percent_availability, "unavailable");
});

test("ownership replace removes stale rows, is idempotent, clears known-empty, and preserves on failure", async () => {
  const parsed = parseOwnershipFiling(fixture("form4-multi-owner-10b5-1-conversion.json") as never);
  const replacing = mockRepository({ form4: [{ transaction_index: 0 }, { transaction_index: 1 }, { transaction_index: 2 }] });
  await persistOwnershipParserFacts({ eventId, eventTime, ownershipParserOutput: parsed, ownershipInputState: "known" }, replacing.repository);
  assert.equal(replacing.state.form4.length, 3);
  const twoTransactions = structuredClone(parsed) as unknown as Row;
  const facts = twoTransactions.facts as Row;
  const form4 = facts.form4 as Row;
  form4.transactions = (form4.transactions as Row[]).slice(0, 2);
  await persistOwnershipParserFacts({ eventId, eventTime, ownershipParserOutput: twoTransactions, ownershipInputState: "known" }, replacing.repository);
  assert.equal(replacing.state.form4.length, 2);
  await persistOwnershipParserFacts({ eventId, eventTime, ownershipParserOutput: twoTransactions, ownershipInputState: "known" }, replacing.repository);
  assert.equal(replacing.state.form4.length, 2);

  await persistOwnershipParserFacts({ eventId, eventTime, ownershipParserOutput: emptyOwnershipParserOutput(), ownershipInputState: "known" }, replacing.repository);
  assert.deepEqual(replacing.state.form4, []);
  assert.deepEqual(replacing.state.form144, []);

  const existing = [{ transaction_index: 0 }];
  const failed = mockRepository({ form4: existing, failOwnershipReplace: true });
  const failedResult = await persistOptionalMonitorFoundation({ eventId, eventTime, ownershipParserOutput: parsed, ownershipInputState: "known" }, failed.repository);
  assert.equal(failedResult.ok, false);
  assert.deepEqual(failed.state.form4, existing);

  const malformed = mockRepository({ form4: existing });
  const malformedResult = await persistOptionalMonitorFoundation({ eventId, eventTime, ownershipParserOutput: {}, ownershipInputState: "known" }, malformed.repository);
  assert.equal(malformedResult.ok, false);
  assert.deepEqual(malformed.state.form4, existing);
  assert.equal(malformed.state.ownershipReplaceCalls, 0);

  const notApplicable = mockRepository({ form4: existing });
  await persistOwnershipParserFacts({ eventId, eventTime, ownershipInputState: "not_applicable" }, notApplicable.repository);
  assert.deepEqual(notApplicable.state.form4, existing);
  assert.equal(notApplicable.state.ownershipReplaceCalls, 0);
});

test("SEC and News paths use the shared helper with explicit ownership input states after canonical writes", () => {
  const secStore = readFileSync(join(here, "../secStores/eventStore.ts"), "utf8");
  const newsStore = readFileSync(join(here, "../newsIngest.ts"), "utf8");
  assert.match(secStore, /await persistOptionalMonitorFoundation\(\{/);
  assert.match(secStore, /ownershipInputState: .* \? "known" : "not_applicable"/);
  assert.match(newsStore, /await persistOptionalMonitorFoundation\(\{/);
  assert.match(newsStore, /ownershipInputState: "not_applicable"/);
  assert.match(secStore, /persistEventOfferingTerms\(\{/);
  assert.match(newsStore, /persistNewsOfferingTerms\(\{/);
});

function structuredForm144ParserOutput(form144: Row) {
  return {
    parserVersion: "ownership-parser-v1",
    accessionNumber: "fixture-accession",
    facts: {
      filing: { source_format: "structured_xml", source_confidence: "high" },
      issuer: { ticker: "CBLD" },
      form144: { ...form144, proposed_sale_rows: [form144] },
    },
  };
}

function emptyOwnershipParserOutput() {
  return {
    parserVersion: "ownership-parser-v1",
    facts: {
      filing: { source_format: "structured_xml", source_confidence: "high" },
      reporting_owners: [],
      form4: { transactions: [] },
      form144: { proposed_sale_rows: [] },
    },
  };
}
