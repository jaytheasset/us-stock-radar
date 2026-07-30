import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateMargin,
  calculatePercentChange,
  calculateTrailingEquityCashFlow,
  findPriorYearQuarter,
  normalizeStockFundamentals,
  type StockFundamentalsProviderResult,
} from "./stockFundamentals.ts";
import { fetchStockFundamentals } from "./stockFundamentalsServer.ts";

const ready = (data: unknown): StockFundamentalsProviderResult => ({
  data,
  state: "ready",
});

test("normalizes joined quarterly statements and cash-flow signs", () => {
  const snapshot = normalizeStockFundamentals(
    "amd",
    {
      balanceSheet: ready([
        {
          cashAndShortTermInvestments: 12_347,
          date: "2026-03-28",
          fiscalYear: "2026",
          period: "Q1",
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
      cashFlow: ready([
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
      incomeStatement: ready([
        {
          date: "2026-03-28",
          epsDiluted: 0.84,
          filingDate: "2026-05-06",
          fiscalYear: "2026",
          grossProfit: 5_416,
          netIncome: 1_383,
          operatingIncome: 1_476,
          period: "Q1",
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
      insiderStatistics: ready([]),
      insiderTrades: ready([]),
      sharesFloat: ready([
        {
          date: "2026-07-29 10:56:42",
          floatShares: 1_621_991_068,
          freeFloat: 99.472039,
          outstandingShares: 1_630_600_000,
        },
      ]),
    },
    "2026-07-31T00:00:00.000Z",
  );

  assert.equal(snapshot.symbol, "AMD");
  assert.equal(snapshot.financials.quarters[0]?.totalDebt, 3_871);
  assert.equal(snapshot.financials.quarters[0]?.commonStockRepurchased, 221);
  assert.equal(snapshot.sharesFloat?.outstandingShares, 1_630_600_000);
  assert.equal(snapshot.ownership.beneficialFilings.length, 3);
  assert.equal(snapshot.ownership.beneficialFilings[0]?.url, "");
  assert.deepEqual(
    snapshot.ownership.reportedBeneficialOwners.map(
      (owner) => owner.nameOfReportingPerson,
    ),
    ["Vanguard Capital Management"],
  );
  assert.equal(
    findPriorYearQuarter(
      snapshot.financials.quarters,
      snapshot.financials.quarters[0],
    )?.fiscalYear,
    "2025",
  );
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

test("keeps 402 and failed FMP sources isolated without leaking provider details", async () => {
  const requestedUrls: string[] = [];
  const seenApiKeys: string[] = [];
  const fetchImpl = async (
    input: string | URL,
    init?: RequestInit & { next?: { revalidate: number } },
  ) => {
    const url = String(input);
    requestedUrls.push(url);
    seenApiKeys.push(new Headers(init?.headers).get("apikey") ?? "");
    if (url.includes("/income-statement?")) {
      return Response.json([
        {
          date: "2026-03-28",
          filingDate: "2026-05-06",
          fiscalYear: "2026",
          period: "Q1",
          revenue: 10_253,
        },
      ]);
    }
    if (url.includes("/balance-sheet-statement?")) {
      return new Response("provider secret details", { status: 402 });
    }
    if (url.includes("/cash-flow-statement?")) {
      return new Response("upstream failure secret", { status: 500 });
    }
    if (url.includes("/shares-float?")) {
      return Response.json([{ outstandingShares: 1_630_600_000 }]);
    }
    return Response.json([]);
  };

  const snapshot = await fetchStockFundamentals("AMD", {
    apiKey: "server-only-test-key",
    fetchImpl,
    now: new Date("2026-07-31T00:00:00.000Z"),
  });

  assert.equal(snapshot.sources.incomeStatement.state, "ready");
  assert.equal(snapshot.sources.balanceSheet.state, "plan_unavailable");
  assert.equal(snapshot.sources.cashFlow.state, "unavailable");
  assert.equal(snapshot.sources.beneficialOwnership.state, "empty");
  assert.equal(snapshot.sources.institutionalOwnership.state, "plan_unavailable");
  assert.equal(snapshot.financials.quarters[0]?.revenue, 10_253);
  assert.ok(requestedUrls.every((url) => !url.includes("apikey")));
  assert.ok(seenApiKeys.every((key) => key === "server-only-test-key"));
  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes("server-only-test-key"), false);
  assert.equal(serialized.includes("provider secret details"), false);
  assert.equal(serialized.includes("upstream failure secret"), false);
});
