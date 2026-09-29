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
    beneficialOwnership: ready([]),
    cashAnnual: ready([]),
    cashQuarterly: ready([]),
    enterpriseValues: ready([]),
    incomeAnnual: ready([]),
    incomeQuarterly: ready([]),
    institutionalHolders: unavailable(),
    institutionalSummary: unavailable(),
    sharesFloat: ready([]),
    splits: ready([]),
    ...overrides,
  };
}

test("normalizes quarterly and annual statements plus verified share structure", () => {
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
      beneficialOwnership: ready([
        {
          acceptedDate: "2026-04-29 12:00:00",
          amountBeneficiallyOwned: 122_092_206,
          filingDate: "2026-04-29",
          nameOfReportingPerson: "Vanguard Capital Management",
          percentOfClass: 7.48,
          typeOfReportingPerson: "IA",
          url: "https://www.sec.gov/Archives/example.xml",
        },
        {
          acceptedDate: "2026-05-01 12:00:00",
          amountBeneficiallyOwned: 0,
          filingDate: "2026-05-01",
          nameOfReportingPerson: "Exited Holder",
          percentOfClass: 0,
          url: "javascript:alert(1)",
        },
        {
          acceptedDate: "2026-04-01 12:00:00",
          amountBeneficiallyOwned: 8_000_000,
          filingDate: "2026-04-01",
          nameOfReportingPerson: "Exited Holder",
          percentOfClass: 5.1,
          url: "https://www.sec.gov/Archives/older.xml",
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
      enterpriseValues: ready([
        { date: "2026-03-28", numberOfShares: 1_650_000_000 },
        { date: "2025-12-27", numberOfShares: 1_625_000_000 },
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
      sharesFloat: ready([
        {
          date: "2026-07-29 10:56:42",
          floatShares: 1_621_991_068,
          freeFloat: 99.472039,
          outstandingShares: 1_630_600_000,
        },
      ]),
      splits: ready([
        { date: "2000-08-22", denominator: 1, numerator: 2 },
      ]),
    }),
    "2026-07-31T00:00:00.000Z",
  );

  assert.equal(snapshot.symbol, "AMD");
  assert.equal(snapshot.financials.quarters[0]?.totalDebt, 3_871);
  assert.equal(snapshot.financials.quarters[0]?.commonStockRepurchased, 221);
  assert.equal(snapshot.financials.annuals[0]?.operatingCashFlow, 6_000);
  assert.equal(snapshot.financials.annuals[0]?.reportedCurrency, "USD");
  assert.equal(snapshot.sharesFloat?.outstandingShares, 1_630_600_000);
  assert.equal(snapshot.shareHistory[0]?.shares, 1_650_000_000);
  assert.deepEqual(snapshot.splits[0], {
    date: "2000-08-22",
    denominator: 1,
    numerator: 2,
  });
  assert.equal(snapshot.ownership.beneficialFilings.length, 3);
  assert.equal(snapshot.ownership.beneficialFilings[0]?.url, "");
  assert.deepEqual(
    snapshot.ownership.reportedBeneficialOwners.map(
      (owner) => owner.nameOfReportingPerson,
    ),
    ["Vanguard Capital Management"],
  );
  assert.equal(snapshot.sources.institutionalOwnership.state, "plan_unavailable");
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

test("stock-detail FMP request omits financial statements and insider transactions", async () => {
  const requestedUrls: string[] = [];
  const seenApiKeys: string[] = [];
  const fetchImpl = async (
    input: string | URL,
    init?: RequestInit & { next?: { revalidate: number } },
  ) => {
    const url = String(input);
    requestedUrls.push(url);
    seenApiKeys.push(new Headers(init?.headers).get("apikey") ?? "");
    if (url.includes("/shares-float?")) {
      return Response.json([{ outstandingShares: 1_630_600_000 }]);
    }
    if (url.includes("/enterprise-values?")) {
      return Response.json([{ date: "2026-03-28", numberOfShares: 1_650_000_000 }]);
    }
    if (url.includes("/splits?")) {
      return Response.json([{ date: "2000-08-22", denominator: 1, numerator: 2 }]);
    }
    if (url.includes("/institutional-ownership/")) {
      return new Response("plan details", { status: 403 });
    }
    return Response.json([]);
  };

  const snapshot = await fetchStockFundamentals("AMD", {
    apiKey: "server-only-test-key",
    fetchImpl,
    now: new Date("2026-07-31T00:00:00.000Z"),
  });

  assert.equal(snapshot.sources.incomeStatement.state, "unavailable");
  assert.equal(snapshot.sources.balanceSheet.state, "unavailable");
  assert.equal(snapshot.sources.cashFlow.state, "unavailable");
  assert.equal(snapshot.sources.beneficialOwnership.state, "empty");
  assert.equal(snapshot.sources.institutionalOwnership.state, "plan_unavailable");
  assert.equal("trades" in snapshot.ownership, false);
  assert.equal("statistics" in snapshot.ownership, false);
  assert.equal(snapshot.sources.sharesHistory.state, "ready");
  assert.equal(snapshot.sources.splits.state, "ready");
  assert.equal(snapshot.financials.quarters.length, 0);
  assert.equal(snapshot.financials.annuals.length, 0);
  assert.equal(requestedUrls.some((url) => url.includes("/income-statement?")), false);
  assert.equal(requestedUrls.some((url) => url.includes("/balance-sheet-statement?")), false);
  assert.equal(requestedUrls.some((url) => url.includes("/cash-flow-statement?")), false);
  assert.equal(requestedUrls.some((url) => url.includes("/insider-trading/")), false);
  assert.ok(requestedUrls.every((url) => !url.includes("apikey")));
  assert.ok(seenApiKeys.every((key) => key === "server-only-test-key"));
  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes("server-only-test-key"), false);
  assert.equal(serialized.includes("provider details"), false);
  assert.equal(serialized.includes("upstream details"), false);
  assert.equal(serialized.includes("plan details"), false);
});
