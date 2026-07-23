import assert from "node:assert/strict";
import test from "node:test";
import { buildMassiveExtendedCandidates } from "./dashboardV2MassiveMovers.ts";

test("builds pre-market changes from the latest minute and previous close", () => {
  const result = buildMassiveExtendedCandidates({
    session: "Pre",
    snapshotPayload: {
      tickers: [
        snapshot("AAA", "2026-07-23T08:15:00Z", 110, 100, 1_250),
        snapshot("BBB", "2026-07-23T08:16:00Z", 90, 100, 2_500),
        snapshot("OLD", "2026-07-22T08:16:00Z", 200, 100, 3_000),
      ],
    },
  });

  assert.equal(result.marketDate, "2026-07-23");
  assert.equal(result.sourceCount, 3);
  assert.deepEqual(
    result.candidates.map((row) => [
      row.ticker,
      row.changePercentage,
      row.volumeValue,
    ]),
    [
      ["AAA", 10, 1_250],
      ["BBB", -10, 2_500],
    ],
  );
});

test("builds after-hours changes from the regular close and isolates after-hours volume", () => {
  const result = buildMassiveExtendedCandidates({
    dailyPayload: {
      results: [
        { T: "AAA", c: 100, v: 10_000 },
        { T: "BBB", c: 200, v: 25_000 },
      ],
    },
    session: "After",
    snapshotPayload: {
      tickers: [
        snapshot("AAA", "2026-07-23T20:15:00Z", 105, 95, 10_600),
        snapshot("BBB", "2026-07-23T20:16:00Z", 180, 190, 26_500),
        snapshot("NOBASE", "2026-07-23T20:17:00Z", 10, 9, 100),
      ],
    },
  });

  assert.equal(result.marketDate, "2026-07-23");
  assert.deepEqual(
    result.candidates.map((row) => [
      row.ticker,
      row.changePercentage,
      row.volumeValue,
    ]),
    [
      ["AAA", 5, 600],
      ["BBB", -10, 1_500],
    ],
  );
});

test("rejects regular-session minute bars from extended-session rankings", () => {
  const result = buildMassiveExtendedCandidates({
    session: "Pre",
    snapshotPayload: {
      tickers: [snapshot("AAA", "2026-07-23T14:00:00Z", 110, 100, 1_250)],
    },
  });

  assert.equal(result.candidates.length, 0);
  assert.equal(result.marketDate, "");
});

function snapshot(
  ticker: string,
  timestamp: string,
  price: number,
  previousClose: number,
  accumulatedVolume: number,
) {
  return {
    ticker,
    min: {
      av: accumulatedVolume,
      c: price,
      t: Date.parse(timestamp),
      v: 100,
    },
    prevDay: { c: previousClose },
  };
}
