import assert from "node:assert/strict";
import test from "node:test";
import {
  dashboardV2DefaultFilterState,
  filterDashboardV2Rows,
  getDashboardV2FilterOptionLabel,
  getDashboardV2FilterSections,
  sanitizeDashboardV2FilterState,
} from "./dashboardV2FilterConfig.ts";
import type { DashboardV2MarketMover } from "@/lib/dashboardV2Types";

const rows: DashboardV2MarketMover[] = [
  mover("AAA", 0.75, 200_000_000, 2_000_000, "earnings", "Earnings", "bullish", "high"),
  mover("BBB", 3, 800_000_000, 8_000_000, "legal_risk", "Legal Risk", "bearish", "medium"),
  mover("CCC", 12, 5_000_000_000, 20_000_000, "fda_clinical", "FDA / Clinical", "volatile", "low"),
  mover("DDD", 40, 300_000_000_000, 60_000_000),
];

test("filters every supported dashboard dimension", () => {
  assert.deepEqual(tickers(filter({ marketCap: "Mega" })), ["DDD"]);
  assert.deepEqual(tickers(filter({ price: "$1-$5" })), ["BBB"]);
  assert.deepEqual(tickers(filter({ volume: "10M+" })), ["CCC", "DDD"]);
  assert.deepEqual(tickers(filter({ eventType: "Earnings" })), ["AAA"]);
  assert.deepEqual(tickers(filter({ signal: "Bearish" })), ["BBB"]);
  assert.deepEqual(tickers(filter({ impact: "Low" })), ["CCC"]);
});

test("combines filters with AND semantics and can return zero rows", () => {
  assert.deepEqual(tickers(filter({ marketCap: "Small", signal: "Bearish" })), ["BBB"]);
  assert.deepEqual(tickers(filter({ marketCap: "Mega", signal: "Bullish" })), []);
});

test("clear all restores all rows and unavailable filters are sanitized", () => {
  assert.equal(filter({}).length, rows.length);
  const sections = getDashboardV2FilterSections(rows.map((row) => ({ ...row, volume: "—", volumeValue: undefined })));
  const sanitized = sanitizeDashboardV2FilterState(
    { ...dashboardV2DefaultFilterState, volume: "1M+" },
    sections,
  );
  assert.equal(sanitized.volume, "All");
});

test("dashboard market-cap options expose the shared range labels", () => {
  assert.equal(getDashboardV2FilterOptionLabel("marketCap", "Micro"), "Micro (<$100M)");
  assert.equal(getDashboardV2FilterOptionLabel("marketCap", "Small"), "Small ($100M-$2B)");
  assert.equal(getDashboardV2FilterOptionLabel("marketCap", "Mega"), "Mega ($200B+)");
});

function filter(overrides: Partial<typeof dashboardV2DefaultFilterState>) {
  return filterDashboardV2Rows(rows, { ...dashboardV2DefaultFilterState, ...overrides });
}

function tickers(filteredRows: DashboardV2MarketMover[]) {
  return filteredRows.map((row) => row.ticker);
}

function mover(
  ticker: string,
  priceValue: number,
  marketCapValue: number,
  volumeValue: number,
  code?: string,
  label?: string,
  signal?: "bullish" | "bearish" | "volatile" | "neutral",
  impact?: "high" | "medium" | "low",
): DashboardV2MarketMover {
  return {
    changePercent: "+1.00%",
    company: ticker,
    events: code && label
      ? [{ code, id: `${ticker}-event`, impact, label, score: 0, signal, timestamp: "2026-07-23T00:00:00Z", title: label, tone: "neutral" as const }]
      : [],
    marketCap: "$1.00B",
    marketCapValue,
    price: `$${priceValue.toFixed(2)}`,
    priceValue,
    rank: 1,
    ticker,
    volume: String(volumeValue),
    volumeValue,
  };
}
