import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateMargin,
  calculatePercentChange,
  calculateTrailingEquityCashFlow,
  findPriorYearQuarter,
  normalizeStockFundamentals,
  type StockFundamentalsProviderResult,
  type StockFundamentalsProviderSources,
} from "./stockFundamentals.ts";
import { fetchStockFundamentals } from "./stockFundamentalsServer.ts";

const ready = (data: unknown): StockFundamentalsProviderResult => ({
  data,
  state: "ready",
});

const unavailable = (): StockFundamentalsProviderResult => ({
  data: [],
  state: "plan_unavailable",
});

function sources(
  overrides: Partial<StockFundamentalsProviderSources> = {},
): StockFundamentalsProviderSources {
  return {
    balanceAnnual: ready([]),
    balanceQuarterly: ready([]),
    cashAnnual: ready([]),
    cashQuarterly: ready([]),
    incomeAnnual: ready([]),
    incomeQuarterly: ready([]),
    institutionalHolders: unavailable(),
    institutionalSummary: unavailable(),
    ...overrides,
  };
}

test("normalizes quarterly and annual statements while retaining institutional ownership status", () => {
  const snapshot = normalizeStockFundamentals(
    "amd",
    sources({
      balanceAnnual: ready([
        {
          cashAndShortTermInvestments: 6_000,
          date: "2025-12-27",
          fiscalYear: "2025",
          period: "FY",
          reportedCurrency: "USD",
          totalDebt: 3_000,
        },
      ]),
      balanceQuarterly: ready([
        {
          cashAndShortTermInvestments: 12_347,
          date: "2026-03-28",
          fiscalYear: "2026",
          period: "Q1",
          reportedCurrency: "USD",
          totalAssets: 79_642,
          totalDebt: 3_871,
          totalStockholdersEquity: 64_462,
        },
      ]),
      cashAnnual: ready([
        {
          date: "2025-12-27",
          fiscalYear: "2025",
          freeCashFlow: 5_000,
          operatingCashFlow: 6_000,
          period: "FY",
        },
      ]),
      cashQuarterly: ready([
        {
          commonStockIssued: null,
          commonStockRepurchased: -221,
          date: "2026-03-28",
          fiscalYear: "2026",
          freeCashFlow: 2_566,
          period: "Q1",
          stockBasedCompensation: 487,
        },
      ]),
      incomeAnnual: ready([
        {
          date: "2025-12-27",
          epsDiluted: 2.5,
          filingDate: "2026-02-04",
          fiscalYear: "2025",
          netIncome: 4_000,
          period: "FY",
          reportedCurrency: "USD",
          revenue: 30_000,
        },
      ]),
      incomeQuarterly: ready([
        {
          date: "2026-03-28",
          epsDiluted: 0.84,
          filingDate: "2026-05-06",
          fiscalYear: "2026",
          grossProfit: 5_416,
          netIncome: 1_383,
          operatingIncome: 1_476,
          period: "Q1",
          reportedCurrency: "USD",
          revenue: 10_253,
          weightedAverageShsOutDil: 1_650,
        },
        {
          date: "2025-03-29",
          epsDiluted: 0.44,
          filingDate: "2025-05-07",
          fiscalYear: "2025",
          period: "Q1",
          revenue: 7_438,
          weightedAverageShsOutDil: 1_626,
        },
      ]),
      institutionalHolders: ready([
        {
          date: "2026-03-31",
          holder: "Reported Manager",
          sharesNumber: 125_000,
        },
      ]),
      institutionalSummary: ready([
        {
          investorsHolding: 42,
          ownershipPercent: 12.5,
          quarter: 1,
          year: 2026,
        },
      ]),
    }),
    "2026-07-31T00:00:00.000Z",
  );

  assert.equal(snapshot.symbol, "AMD");
  assert.equal(snapshot.financials.quarters[0]?.totalDebt, 3_871);
  assert.equal(snapshot.financials.quarters[0]?.commonStockRepurchased, 221);
  assert.equal(snapshot.financials.annuals[0]?.operatingCashFlow, 6_000);
  assert.equal(snapshot.financials.annuals[0]?.reportedCurrency, "USD");
  assert.equal(snapshot.sources.institutionalOwnership.state, "ready");
  assert.equal(snapshot.ownership.institutionalSummary?.ownershipPercent, 12.5);
  assert.equal(snapshot.ownership.institutionalHolders[0]?.shares, 125_000);
  assert.equal(
    findPriorYearQuarter(
      snapshot.financials.quarters,
      snapshot.financials.quarters[0],
    )?.fiscalYear,
    "2025",
  );
});

test("marks a statement source partial when only one cadence is available", () => {
  const snapshot = normalizeStockFundamentals(
    "AMD",
    sources({
      incomeAnnual: unavailable(),
      incomeQuarterly: ready([
        { date: "2026-03-28", fiscalYear: "2026", period: "Q1" },
      ]),
    }),
  );
  assert.equal(snapshot.sources.incomeStatement.state, "partial");
});

test("only calculates comparable changes with a positive baseline", () => {
  assert.equal(calculatePercentChange(110, 100), 10);
  assert.equal(calculatePercentChange(10, 0), null);
  assert.equal(calculatePercentChange(10, -4), null);
  assert.equal(calculatePercentChange(null, 10), null);
  assert.equal(calculateMargin(25, 100), 25);
  assert.equal(calculateMargin(25, 0), null);
});

test("normalizes issuance and repurchase magnitudes before net supply math", () => {
  const quarters = [
    { commonStockIssued: 100, commonStockRepurchased: 300 },
    { commonStockIssued: null, commonStockRepurchased: 50 },
    { commonStockIssued: 25, commonStockRepurchased: null },
    { commonStockIssued: null, commonStockRepurchased: null },
  ] as unknown as Parameters<typeof calculateTrailingEquityCashFlow>[0];
  assert.deepEqual(calculateTrailingEquityCashFlow(quarters), {
    issued: 125,
    net: -225,
    repurchased: 350,
  });
});

test("retired stock fundamentals ignore credentials and return unavailable without fetch or cache", async () => {
  let calls = 0;
  const snapshot = await fetchStockFundamentals("AMD", { apiKey: "retired-test-key", cache: true, fetchImpl: async () => { calls++; throw new Error("must not fetch"); } });
  assert.equal(calls, 0);
  for (const source of Object.values(snapshot.sources)) assert.equal(source.state, "unavailable");
  assert.equal(snapshot.ownership.institutionalSummary, null);
  assert.deepEqual(snapshot.ownership.institutionalHolders, []);
  assert.deepEqual(snapshot.financials.quarters, []);
  assert.deepEqual(snapshot.financials.annuals, []);
  assert.equal(JSON.stringify(snapshot).includes("retired-test-key"), false);
});
