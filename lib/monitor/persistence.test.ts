import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildOwnershipFactRows,
  persistEventMarketSnapshots,
  persistOptionalMonitorFoundation,
  persistOwnershipAnalysisFacts,
  type MonitorPersistenceRepository,
} from "./persistence.ts";
import { validateOwnershipMonitorFacts } from "./ownershipAnalysisFacts.ts";

type Row = Record<string, unknown>;
const here = dirname(fileURLToPath(import.meta.url));
const eventId = "11111111-1111-4111-8111-111111111111";
const eventTime = "2026-08-11T00:00:00.000Z";

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
  assert.equal(row.float_shares, 20_000_000);
  assert.equal(row.float_shares_value_quality, "unknown");
  assert.equal(row.float_shares_availability, "available");
  assert.deepEqual(row.field_sources, {
    price: { kind: "analysis_context", source: "analysis_fixture", as_of: "2026-08-10T23:58:00.000Z", value_quality: "exact" },
    market_cap: { kind: "analysis_context", source: "analysis_fixture", as_of: "2026-08-10T23:58:00.000Z", value_quality: "estimated" },
    shares_outstanding: { kind: "analysis_context", source: "analysis_fixture", as_of: "2026-08-10T23:58:00.000Z", value_quality: "derived" },
    float_shares: { kind: "analysis_context", source: "analysis_fixture", as_of: "2026-08-10T23:58:00.000Z", value_quality: "unknown" },
  });
  assert.equal(row.source_as_of, "2026-08-10T23:58:00.000Z");
  assert.deepEqual(row.provenance, {
    resolution_order: ["analysis_context", "market_snapshots", "market_quotes", "tickers"],
    no_external_fetch: true,
  });
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

test("Form 4 Analysis facts preserve raw rows, roles, semantics, 10b5 state, and deterministic values", () => {
  const analysisOutput = form4AnalysisFacts([
    form4Transaction({ direction: "buy", code: "P", side: "A", shares: numericFact(25_000), price: numericFact(12.4), postShares: numericFact(425_000), is10b51: true }),
    form4Transaction({ direction: "sell", code: "S", side: "D", shares: numericFact(2_000), price: numericFact(null), postShares: numericFact(423_000), is10b51: null }),
    form4Transaction({ direction: "other", code: "G", side: "D", shares: numericFact(null), price: numericFact(5), postShares: numericFact(null), is10b51: false }),
    form4Transaction({ direction: "unknown", code: "V", side: null, shares: numericFact(10, "unknown"), price: numericFact(2), postShares: numericFact(100, "unknown"), is10b51: null, kind: null }),
  ]);
  const rows = buildOwnershipFactRows({ eventId, symbol: "ATRB", analysisOutput }).form4Transactions;

  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((row) => row.transaction_index), [0, 1, 2, 3]);
  assert.deepEqual(rows.map((row) => row.economic_direction), ["buy", "sell", "other", "unknown"]);
  assert.deepEqual(rows.map((row) => row.acquired_disposed_code), ["A", "D", "D", null]);
  assert.deepEqual(rows[0].reporting_owner_names, ["Maya Chen", "Control Holdings LLC"]);
  assert.deepEqual(rows[0].reporting_owner_roles, ["CEO", "Director", "10% Owner"]);
  assert.equal(rows[0].is_officer, true);
  assert.equal(rows[0].is_director, true);
  assert.equal(rows[0].is_10_percent_owner, true);
  assert.equal(rows[0].is_10b5_1, true);
  assert.equal(rows[1].is_10b5_1, null);
  assert.equal(rows[0].transaction_value, 310_000);
  assert.equal(rows[0].transaction_value_value_quality, "derived");
  assert.equal(rows[1].transaction_value, null);
  assert.equal(rows[1].transaction_value_availability, "unavailable");
  assert.equal(rows[2].transaction_value, null);
  assert.equal(rows[3].transaction_value, 20);
  assert.equal(rows[3].transaction_value_value_quality, "unknown");
  assert.equal(rows[3].transaction_value_availability, "available");
  assert.equal(rows[3].shares_availability, "available");
  assert.equal(rows[3].shares_value_quality, "unknown");
  assert.equal(rows[3].transaction_kind, null);
  assert.equal("ownership_percent" in rows[0], false);
  assert.equal((rows[0].provenance as Row).parser_fallback, false);
});

test("Form 144 Analysis facts retain owners, sale terms, and only derive percent from a clear denominator", () => {
  const analysisOutput = form144AnalysisFacts([
    form144Sale({ shares: numericFact(9_876), value: numericFact(987_600), outstanding: numericFact(40_000_000), date: "2026-08-15", exchange: "NASDAQ", percentDecision: percentDecision({ comparable: true }) }),
    form144Sale({ shares: numericFact(1_000), value: numericFact(25_000, "estimated"), outstanding: numericFact(null), date: null, exchange: null, percentDecision: percentDecision({ comparable: null }) }),
    form144Sale({ shares: numericFact(500, "unknown"), value: numericFact(12_500, "unknown"), outstanding: numericFact(20_000_000, "unknown"), date: "2026-08-16", exchange: "NYSE", percentDecision: percentDecision({ comparable: true }) }),
    form144Sale({
      shares: numericFact(1_533),
      value: numericFact(153_008.73),
      outstanding: numericFact(5_693_585_848),
      date: "2026-03-30",
      exchange: "NASDAQ",
      percentDecision: percentDecision({
        comparable: true,
        numeratorUnit: "ADS",
        denominatorUnit: "ordinary shares",
        target: "numerator",
        multiplier: 4,
        sourceRelation: "One ADS represents four ordinary shares.",
      }),
    }),
  ]);
  const rows = buildOwnershipFactRows({ eventId, symbol: "D144", analysisOutput }).form144ProposedSales;
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0].reporting_owner_names, ["Jordan Seller"]);
  assert.equal(rows[0].seller_name, "Jordan Seller");
  assert.equal(rows[0].exchange, "NASDAQ");
  assert.equal(rows[0].aggregate_market_value, 987_600);
  assert.equal(rows[0].aggregate_market_value_value_quality, "exact");
  assert.equal(rows[0].proposed_sale_percent, 0.02469);
  assert.equal(rows[0].proposed_sale_percent_value_quality, "derived");
  assert.equal(rows[1].proposed_sale_percent, null);
  assert.equal(rows[1].proposed_sale_percent_value_quality, "unknown");
  assert.equal(rows[1].proposed_sale_percent_availability, "unavailable");
  assert.equal(rows[1].aggregate_market_value_value_quality, "estimated");
  assert.equal(rows[1].aggregate_market_value_availability, "available");
  assert.equal(rows[2].shares_outstanding_availability, "available");
  assert.equal(rows[2].shares_outstanding_value_quality, "unknown");
  assert.equal(rows[2].proposed_sale_percent, null);
  assert.equal(rows[3].proposed_sale_percent, 0.0001077);
  assert.equal(rows[3].proposed_sale_percent_value_quality, "derived");
  assert.equal((rows[3].calculation_basis as Row).normalization_target, "numerator");
  assert.equal((rows[3].calculation_basis as Row).normalization_multiplier, 4);
  assert.equal((rows[3].calculation_basis as Row).selected_numerator, 6_132);
  assert.equal((rows[3].calculation_basis as Row).selected_denominator, 5_693_585_848);
});

test("Form 144 percent decision schema requires explicit comparability and source-confirmed normalization shape", () => {
  const valid = form144AnalysisFacts([
    form144Sale({
      shares: numericFact(1_533),
      value: numericFact(153_008.73),
      outstanding: numericFact(5_693_585_848),
      date: "2026-03-30",
      exchange: "NASDAQ",
      percentDecision: percentDecision({
        comparable: true,
        numeratorUnit: "ADS",
        denominatorUnit: "ordinary shares",
        target: "numerator",
        multiplier: 4,
        sourceRelation: "One ADS represents four ordinary shares.",
      }),
    }),
  ]);
  assert.deepEqual(validateOwnershipMonitorFacts(valid), []);

  for (const multiplier of [0, -1]) {
    const invalidMultiplier = structuredClone(valid) as unknown as Row;
    const invalidDecision = ((((invalidMultiplier.form144 as Row).proposed_sales as Row[])[0]).percent_calculation as Row);
    invalidDecision.normalization_multiplier = multiplier;
    assert.ok(
      validateOwnershipMonitorFacts(invalidMultiplier)
        .some((error) => /normalization_multiplier is invalid/.test(error)),
      `normalization_multiplier ${multiplier} must remain invalid`,
    );
  }

  const missing = structuredClone(valid) as unknown as Row;
  delete (((missing.form144 as Row).proposed_sales as Row[])[0]).percent_calculation;
  assert.ok(validateOwnershipMonitorFacts(missing).some((error) => /percent_calculation must be an object/.test(error)));

  const unconfirmedWithMultiplier = structuredClone(valid) as unknown as Row;
  const decision = ((((unconfirmedWithMultiplier.form144 as Row).proposed_sales as Row[])[0]).percent_calculation as Row);
  decision.comparable_units = null;
  assert.ok(validateOwnershipMonitorFacts(unconfirmedWithMultiplier).some((error) => /cannot select normalization/.test(error)));
});

test("LLM-only Ownership output cannot enter canonical persistence or clear existing rows", async () => {
  const parsed = form4AnalysisFacts([
    form4Transaction({ direction: "sell", shares: numericFact(10), price: numericFact(5) }),
    form4Transaction({ direction: "buy", shares: numericFact(20), price: numericFact(6) }),
    form4Transaction({ direction: "other", shares: numericFact(30), price: numericFact(null) }),
  ]);
  const existing = [{ transaction_index: 0 }];
  const llmOnly = mockRepository({ form4: existing });
  await assert.rejects(
    persistOwnershipAnalysisFacts({
      eventId,
      eventTime,
      ownershipAnalysisOutput: parsed,
      ownershipInputState: "known",
    }, llmOnly.repository),
    /Verified SEC Ownership XML raw item is required/,
  );
  assert.deepEqual(llmOnly.state.form4, existing);
  assert.equal(llmOnly.state.ownershipReplaceCalls, 0);

  const optionalResult = await persistOptionalMonitorFoundation({
    eventId,
    eventTime,
    ownershipAnalysisOutput: emptyOwnershipAnalysisOutput(),
    ownershipInputState: "known",
  }, llmOnly.repository);
  assert.equal(optionalResult.ok, false);
  assert.deepEqual(llmOnly.state.form4, existing);
  assert.equal(llmOnly.state.ownershipReplaceCalls, 0);

  const notApplicable = mockRepository({ form4: existing });
  await persistOwnershipAnalysisFacts({ eventId, eventTime, ownershipInputState: "not_applicable" }, notApplicable.repository);
  assert.deepEqual(notApplicable.state.form4, existing);
  assert.equal(notApplicable.state.ownershipReplaceCalls, 0);
});

test("SEC uses parser-backed Ownership facts while News remains not applicable", () => {
  const secStore = readFileSync(join(here, "../secStores/eventStore.ts"), "utf8");
  const secIngest = readFileSync(join(here, "../secFilingAnalysisIngest.ts"), "utf8");
  const newsStore = readFileSync(join(here, "../newsIngest.ts"), "utf8");
  assert.match(secStore, /await persistOptionalMonitorFoundation\(\{/);
  assert.match(secStore, /promptKey === "sec_ownership_analysis"/);
  assert.match(secStore, /ownershipRawItem/);
  assert.match(secStore, /await persistOwnershipAnalysisFacts\(\{/);
  assert.match(secStore, /ownershipInputState: "known"/);
  assert.match(secStore, /ownershipInputState: "not_applicable"/);
  assert.match(secStore, /saveOwnershipParserDetailsEvent/);
  const analyzedSaveStart = secStore.indexOf("export async function saveAnalyzedSecFilingEvent");
  const sourceValidationAt = secStore.indexOf("buildOwnershipParserFactRows({", analyzedSaveStart);
  const eventUpsertAt = secStore.indexOf('supabaseUpsertSanitized("events", payload', sourceValidationAt);
  const strictDetailWriteAt = secStore.indexOf("await persistOwnershipAnalysisFacts({", eventUpsertAt);
  const analyzedChildrenAt = secStore.indexOf("await Promise.all([", strictDetailWriteAt);
  assert.ok(analyzedSaveStart >= 0 && sourceValidationAt > analyzedSaveStart);
  assert.ok(eventUpsertAt > sourceValidationAt, "required XML must validate before the analyzed event write");
  assert.ok(strictDetailWriteAt > eventUpsertAt && analyzedChildrenAt > strictDetailWriteAt);
  assert.match(secIngest, /ownershipDetailsPersistence/);
  assert.match(secIngest, /eventId: stringValue\(parserDetailsEvent\?\.id\) \|\| null/);
  assert.match(secIngest, /ok: false/);
  assert.match(newsStore, /await persistOptionalMonitorFoundation\(\{/);
  assert.match(newsStore, /ownershipInputState: "not_applicable"/);
  assert.match(secStore, /persistEventOfferingTerms\(\{/);
  assert.match(newsStore, /persistNewsOfferingTerms\(\{/);
});

test("Ownership migration keeps analysis provenance and atomic scoped replace semantics", () => {
  const migration = readFileSync(join(here, "../../supabase/migrations/20260811100000_ownership_analysis_monitor_facts.sql"), "utf8");
  assert.match(migration, /add column economic_direction text/);
  assert.match(migration, /add column reporting_owner_names jsonb/);
  assert.match(migration, /delete from public\.event_form4_transactions where event_id = p_event_id/);
  assert.match(migration, /delete from public\.event_form144_proposed_sales where event_id = p_event_id/);
  assert.match(migration, /source:\s*"sec_ownership_analysis"|Ownership Analysis/);
  assert.match(migration, /Successful known-empty arrays clear stale rows/);
  assert.doesNotMatch(migration, /parser object.*fallback/i);
});

test("canonical XML migration documents the parser source without widening the schema", () => {
  const migration = readFileSync(
    join(here, "../../supabase/migrations/20260907161909_ownership_xml_canonical_persistence.sql"),
    "utf8",
  );
  assert.match(migration, /verified SEC XML Form 4 transaction/);
  assert.match(migration, /Form 144 proposed-sale notice/);
  assert.match(migration, /LLM output is not the canonical numeric source/);
  assert.match(migration, /Atomically replaces one event Ownership detail domain/);
  assert.doesNotMatch(migration, /create\s+(?:or\s+replace\s+)?table/i);
  assert.doesNotMatch(migration, /create\s+or\s+replace\s+function/i);
});

function emptyOwnershipAnalysisOutput() {
  return {
    version: "ownership_monitor_facts_v1",
    form4: { reporting_owners: [], transactions: [] },
    form144: null,
  };
}

function form4AnalysisFacts(transactions: Row[]) {
  return {
    version: "ownership_monitor_facts_v1",
    form4: {
      reporting_owners: [
        reportingOwner({ name: "Maya Chen", roles: ["CEO", "Director"], isOfficer: true, isDirector: true, officerTitle: "Chief Executive Officer" }),
        reportingOwner({ name: "Control Holdings LLC", roles: ["10% Owner"], is10PercentOwner: true }),
      ],
      transactions,
    },
    form144: null,
  };
}

function form144AnalysisFacts(proposedSales: Row[]) {
  return {
    version: "ownership_monitor_facts_v1",
    form4: null,
    form144: {
      reporting_owners: [reportingOwner({ name: "Jordan Seller", roles: ["Director"], isDirector: true })],
      proposed_sales: proposedSales,
    },
  };
}

function reportingOwner({
  name,
  roles,
  isOfficer = null,
  isDirector = null,
  is10PercentOwner = null,
  officerTitle = null,
}: {
  name: string;
  roles: string[];
  isOfficer?: boolean | null;
  isDirector?: boolean | null;
  is10PercentOwner?: boolean | null;
  officerTitle?: string | null;
}) {
  return {
    name,
    roles,
    is_officer: isOfficer,
    is_director: isDirector,
    is_10_percent_owner: is10PercentOwner,
    officer_title: officerTitle,
    evidence: [`owner evidence: ${name}`],
    confidence: "high",
  };
}

function numericFact(value: number | null, valueQuality: "exact" | "derived" | "estimated" | "unknown" = value === null ? "unknown" : "exact") {
  return {
    value,
    value_quality: valueQuality,
    availability: value === null ? "unavailable" : "available",
  };
}

function form4Transaction({
  direction,
  code = "P",
  side = "A",
  shares,
  price,
  postShares = numericFact(null),
  is10b51 = null,
  kind = "non_derivative",
}: {
  direction: "buy" | "sell" | "other" | "unknown";
  code?: string | null;
  side?: "A" | "D" | null;
  shares: ReturnType<typeof numericFact>;
  price: ReturnType<typeof numericFact>;
  postShares?: ReturnType<typeof numericFact>;
  is10b51?: boolean | null;
  kind?: "non_derivative" | "derivative" | null;
}) {
  return {
    transaction_kind: kind,
    security_title: "Common Stock",
    transaction_date: "2026-08-10",
    transaction_code: code,
    acquired_disposed_code: side,
    economic_direction: direction,
    shares,
    price_per_share: price,
    post_transaction_shares: postShares,
    direct_or_indirect_ownership: "D",
    nature_of_ownership: null,
    is_10b5_1: is10b51,
    evidence: [`row evidence: ${direction}`],
    confidence: direction === "unknown" ? null : "high",
  };
}

function form144Sale({
  shares,
  value,
  outstanding,
  date,
  exchange,
  percentDecision: decision,
}: {
  shares: ReturnType<typeof numericFact>;
  value: ReturnType<typeof numericFact>;
  outstanding: ReturnType<typeof numericFact>;
  date: string | null;
  exchange: string | null;
  percentDecision: ReturnType<typeof percentDecision>;
}) {
  return {
    security_title: "Common Stock",
    proposed_sale_shares: shares,
    aggregate_market_value: value,
    proposed_sale_date: date,
    exchange,
    shares_outstanding: outstanding,
    percent_calculation: decision,
    evidence: ["proposed sale row evidence"],
    confidence: "high",
  };
}

function percentDecision({
  comparable,
  numeratorUnit = "shares",
  denominatorUnit = "shares",
  target = null,
  multiplier = null,
  sourceRelation = null,
}: {
  comparable: boolean | null;
  numeratorUnit?: string | null;
  denominatorUnit?: string | null;
  target?: "numerator" | "denominator" | null;
  multiplier?: number | null;
  sourceRelation?: string | null;
}) {
  return {
    comparable_units: comparable,
    numerator_unit: numeratorUnit,
    denominator_unit: denominatorUnit,
    normalization_target: target,
    normalization_multiplier: multiplier,
    source_relation: sourceRelation,
    evidence: sourceRelation ? [sourceRelation] : ["The source labels numerator and denominator in the same unit."],
    confidence: comparable === null ? null : "high",
  };
}
