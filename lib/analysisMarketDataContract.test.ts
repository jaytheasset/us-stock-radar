import assert from "node:assert/strict";
import test from "node:test";
import { hasStoredAnalysisChartRange } from "./analysisMarketDataContract.ts";

const point = {
  close: 11,
  high: 12,
  low: 9,
  open: 10,
  time: "2026-08-03T13:30:00.000Z",
  volume: 100,
  vwap: 10.5,
};

test("a valid stored range prevents the client fallback", () => {
  assert.equal(
    hasStoredAnalysisChartRange(
      { periods: { "1D": [point] }, previousClose: 10 },
      "1D",
    ),
    true,
  );
});

test("missing range or invalid previous close requires the chart API fallback", () => {
  assert.equal(
    hasStoredAnalysisChartRange(
      { periods: { "5D": [point] }, previousClose: 10 },
      "1D",
    ),
    false,
  );
  assert.equal(
    hasStoredAnalysisChartRange(
      { periods: { "1D": [point] }, previousClose: 0 },
      "1D",
    ),
    false,
  );
});
