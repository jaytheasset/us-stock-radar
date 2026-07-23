import assert from "node:assert/strict";
import test from "node:test";
import {
  getNewYorkMarketSession,
  rankExtendedMovers,
} from "./dashboardV2ExtendedMovers.ts";

test("classifies New York market-session boundaries", () => {
  assert.equal(session("2026-07-23T07:59:59Z"), null);
  assert.equal(session("2026-07-23T08:00:00Z"), "Pre");
  assert.equal(session("2026-07-23T13:29:59Z"), "Pre");
  assert.equal(session("2026-07-23T13:30:00Z"), "Regular");
  assert.equal(session("2026-07-23T19:59:59Z"), "Regular");
  assert.equal(session("2026-07-23T20:00:00Z"), "After");
  assert.equal(session("2026-07-23T23:59:59Z"), "After");
  assert.equal(session("2026-07-24T00:00:00Z"), null);
});

test("uses America/New_York across DST and rejects non-session timestamps", () => {
  assert.equal(session("2026-01-15T09:00:00Z"), "Pre");
  assert.equal(session("2026-07-23T08:00:00Z"), "Pre");
  assert.equal(session("2026-07-25T14:00:00Z"), null);
  assert.equal(session("not-a-timestamp"), null);

  const numeric = getNewYorkMarketSession(1_784_809_169_000);
  assert.equal(numeric?.date, "2026-07-23");
  assert.equal(numeric?.session, "Pre");
});

test("ranks gainers, losers, and volume without mutating input", () => {
  const rows = [
    mover("AAA", 5, 10),
    mover("BBB", -2, 50),
    mover("CCC", 8, 20),
    mover("DDD", -9, 5),
    mover("EEE", 0, 100),
    mover("FFF", 2),
  ];

  assert.deepEqual(tickers(rankExtendedMovers(rows, "gainers")), ["CCC", "AAA", "FFF"]);
  assert.deepEqual(tickers(rankExtendedMovers(rows, "losers")), ["DDD", "BBB"]);
  assert.deepEqual(tickers(rankExtendedMovers(rows, "volume")), [
    "EEE",
    "BBB",
    "CCC",
    "AAA",
    "DDD",
  ]);
  assert.deepEqual(tickers(rows), ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"]);
});

function session(timestamp: unknown) {
  return getNewYorkMarketSession(timestamp)?.session || null;
}

function mover(ticker: string, changePercentage: number, volumeValue?: number) {
  return { changePercentage, ticker, volumeValue };
}

function tickers(rows: readonly { ticker: string }[]) {
  return rows.map((row) => row.ticker);
}
