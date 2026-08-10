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
  type MonitorPersistenceRepository,
} from "./persistence.ts";

const here = dirname(fileURLToPath(import.meta.url));
const eventId = "11111111-1111-4111-8111-111111111111";
const eventTime = "2026-08-11T00:00:00.000Z";

function fixture(name: string) {
  const path = join(here, "../sources/sec/forms/ownership/fixtures", name);
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function mockRepository(selectRows: Record<string, unknown[]> = {}, failedUpserts: string[] = []) {
  const upserts: Array<{ table: string; payload: Record<string, unknown> | Array<Record<string, unknown>> }> = [];
  const repository: MonitorPersistenceRepository = {
    async select(table) {
      return { ok: true, status: 200, data: selectRows[table] || [] };
    },
    async upsert(table, payload) {
      upserts.push({ table, payload });
      if (failedUpserts.includes(table)) return { ok: false, status: 500, data: null, error: "fixture persistence failure" };
      return { ok: true, status: 200, data: payload };
    },
  };
  return { repository, upserts };
}

test("analysis market context wins and creates an offering-linked event snapshot without copying offering facts", async () => {
  const { repository, upserts } = mockRepository({
    event_tickers: [{ symbol: "OFFER", exchange: "NASDAQ", metadata: {} }],
  });
  const count = await persistEventMarketSnapshots({
    eventId,
    eventTime,
    primaryTicker: { symbol: "OFFER", exchange: "NASDAQ" },
    analysisMarketContext: {
      ticker: "OFFER",
      price: 4.25,
      market_cap: 125_000_000,
      as_of: "2026-08-10T23:58:00Z",
      source: "analysis_fixture",
    },
  }, repository);

  assert.equal(count, 1);
  assert.deepEqual(upserts.map((item) => item.table), ["event_market_snapshots"]);
  const row = (upserts[0].payload as Array<Record<string, unknown>>)[0];
  assert.equal(row.price, 4.25);
  assert.equal(row.market_cap, 125_000_000);
  assert.equal(row.source_kind, "analysis_context");
  assert.equal("offering_amount" in row, false);
});

test("fresh local snapshots support non-offering multi-ticker event snapshots", async () => {
  const rowsByTicker: Record<string, Record<string, unknown>> = {
    ALFA: { ticker: "ALFA", price: 10, market_cap: 1_000_000_000, source: "local_fmp_cache", fetched_at: "2026-08-10T23:30:00Z" },
    BETA: { ticker: "BETA", price: 20, market_cap: 2_000_000_000, source: "local_fmp_cache", fetched_at: "2026-08-10T23:31:00Z" },
  };
  const upserts: Array<{ table: string; payload: Record<string, unknown> | Array<Record<string, unknown>> }> = [];
  const repository: MonitorPersistenceRepository = {
    async select(table, search) {
      if (table === "event_tickers") return { ok: true, status: 200, data: [
        { symbol: "ALFA", exchange: "NYSE", metadata: {} },
        { symbol: "BETA", exchange: "NASDAQ", metadata: { security_key: "class-a" } },
      ] };
      if (table === "market_snapshots") {
        const symbol = String(search.ticker || "").replace("eq.", "");
        return { ok: true, status: 200, data: rowsByTicker[symbol] ? [rowsByTicker[symbol]] : [] };
      }
      return { ok: true, status: 200, data: [] };
    },
    async upsert(table, payload) {
      upserts.push({ table, payload });
      return { ok: true, status: 200, data: payload };
    },
  };

  const count = await persistEventMarketSnapshots({
    eventId,
    eventTime,
    primaryTicker: { symbol: "ALFA", exchange: "NYSE" },
  }, repository);
  const snapshots = upserts[0].payload as Array<Record<string, unknown>>;
  assert.equal(count, 2);
  assert.deepEqual(snapshots.map((row) => row.symbol).sort(), ["ALFA", "BETA"]);
  assert.ok(snapshots.every((row) => row.snapshot_status === "available"));
  assert.ok(snapshots.every((row) => row.source_kind === "local_market_snapshot"));
});

test("unavailable market data is explicit and optional persistence failures never reject event persistence", async () => {
  const unavailable = mockRepository({ event_tickers: [{ symbol: "NONE", metadata: {} }] });
  await persistEventMarketSnapshots({ eventId, eventTime, primaryTicker: { symbol: "NONE" } }, unavailable.repository);
  const row = (unavailable.upserts[0].payload as Array<Record<string, unknown>>)[0];
  assert.equal(row.snapshot_status, "unavailable");
  assert.equal(row.price, null);
  assert.equal(row.market_cap, null);
  assert.equal(row.unavailable_reason, "analysis_context_and_valid_local_market_data_unavailable");

  const failing = mockRepository({ event_tickers: [{ symbol: "NONE", metadata: {} }] }, ["event_market_snapshots"]);
  const result = await persistOptionalMonitorFoundation({
    eventId,
    eventTime,
    primaryTicker: { symbol: "NONE" },
  }, failing.repository);
  assert.equal(result.ok, false);
  assert.equal(result.failures[0].scope, "market_snapshots");
});

test("a local cache read failure is not misreported as proof that market data is unavailable", async () => {
  const upserts: string[] = [];
  const repository: MonitorPersistenceRepository = {
    async select(table) {
      if (table === "event_tickers") return { ok: true, status: 200, data: [{ symbol: "READ", metadata: {} }] };
      if (table === "market_snapshots") return { ok: false, status: 500, data: null, error: "fixture read boundary" };
      return { ok: true, status: 200, data: [] };
    },
    async upsert(table, payload) {
      upserts.push(table);
      return { ok: true, status: 200, data: payload };
    },
  };
  const result = await persistOptionalMonitorFoundation({
    eventId,
    eventTime,
    primaryTicker: { symbol: "READ" },
  }, repository);
  assert.equal(result.ok, false);
  assert.match(result.failures[0].error, /Could not read READ market snapshots/);
  assert.equal(upserts.includes("event_market_snapshots"), false);
});

test("Form 4 transactions persist separately with no buy/sell netting and derived transaction values", () => {
  const single = parseOwnershipFiling(fixture("form4-insider-purchase.json") as never);
  const singleRows = buildOwnershipFactRows({ eventId, symbol: "ATRB", parserOutput: single }).form4Transactions;
  assert.equal(singleRows.length, 1);
  assert.equal(singleRows[0].shares_quality, "exact");
  assert.equal(singleRows[0].price_per_share_quality, "exact");
  assert.equal(singleRows[0].transaction_value, 310_000);
  assert.equal(singleRows[0].transaction_value_quality, "derived");
  assert.equal("ownership_percent" in singleRows[0], false);

  const multi = parseOwnershipFiling(fixture("form4-multi-owner-10b5-1-conversion.json") as never);
  const multiRows = buildOwnershipFactRows({ eventId, symbol: "UWMC", parserOutput: multi }).form4Transactions;
  assert.equal(multiRows.length, 3);
  assert.deepEqual(multiRows.map((row) => row.transaction_index), [0, 1, 2]);
  assert.deepEqual(multiRows.map((row) => row.acquired_disposed_code), ["D", "A", "D"]);
  assert.deepEqual(multiRows.map((row) => row.shares), [632_874, 6_600_000, 6_600_000]);
});

test("Form 144 source value is exact and proposed-sale percentage is derived only with both inputs", () => {
  const parsed = parseOwnershipFiling(fixture("form144-routine-proposed-sale.json") as never);
  const rows = buildOwnershipFactRows({ eventId, symbol: "CBLD", parserOutput: parsed }).form144ProposedSales;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].aggregate_market_value, 175_000);
  assert.equal(rows[0].aggregate_market_value_quality, "exact");
  assert.equal(rows[0].proposed_sale_percent, 0.025);
  assert.equal(rows[0].proposed_sale_percent_quality, "derived");

  const withoutDenominator = structuredForm144ParserOutput({
    securities_to_be_sold: 1_000,
    aggregate_market_value: 25_000,
    shares_outstanding: null,
    proposed_sale_percent_of_shares_outstanding: 99,
  });
  const unsupportedRows = buildOwnershipFactRows({ eventId, symbol: "CBLD", parserOutput: withoutDenominator }).form144ProposedSales;
  assert.equal(unsupportedRows[0].proposed_sale_percent, null);
  assert.equal(unsupportedRows[0].proposed_sale_percent_quality, null);
});

test("SEC and News event persistence both call the shared optional helper after canonical writes", () => {
  const secStore = readFileSync(join(here, "../secStores/eventStore.ts"), "utf8");
  const newsStore = readFileSync(join(here, "../newsIngest.ts"), "utf8");
  assert.match(secStore, /await persistOptionalMonitorFoundation\(\{/);
  assert.match(secStore, /ownershipParserOutput: toRecord\(toRecord\(filingPackage\.hard_parsers\)\?\.ownership\)/);
  assert.match(newsStore, /await persistOptionalMonitorFoundation\(\{/);
  assert.match(secStore, /persistEventOfferingTerms\(\{/);
  assert.match(newsStore, /persistNewsOfferingTerms\(\{/);
});

function structuredForm144ParserOutput(form144: Record<string, unknown>) {
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
