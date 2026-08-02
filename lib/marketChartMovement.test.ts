import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveMarketRangeMovement,
  resolveMarketRangeChangePercent,
} from "./marketChartMovement.ts";
import type { PricePoint } from "./marketTypes.ts";

const rangeFixtures = [
  { contextRange: "1D", closes: [100, 101], expected: 1 },
  { contextRange: "5D", closes: [100, 103, 105], expected: 5 },
  { contextRange: "30D", closes: [100, 96, 90], expected: -10 },
] as const;

test("1D, 5D, and 30D fixtures display distinct selected-range changes", () => {
  const quoteChangePercent = 7.25;
  const displayed = rangeFixtures.map((fixture) => {
    const points = fixture.closes.map(point);
    const rangeMovement = deriveMarketRangeMovement(points);
    assert.ok(rangeMovement);

    const result = resolveMarketRangeChangePercent({
      points,
      rangeChangePercent: rangeMovement.changePercent,
    });
    assert.notEqual(result, quoteChangePercent);
    assert.equal(result, fixture.expected, fixture.contextRange);
    return result;
  });

  assert.deepEqual(displayed, [1, 5, -10]);
  assert.equal(new Set(displayed).size, 3);
});

test("range change falls back to the selected points instead of quote change", () => {
  const points = [point(80), point(84)];
  assert.equal(
    resolveMarketRangeChangePercent({ points }),
    5,
  );
});

function point(close: number, index = 0): PricePoint {
  return {
    close,
    high: close,
    low: close,
    open: close,
    time: `2026-08-${String(index + 1).padStart(2, "0")}`,
    volume: 100,
    vwap: close,
  };
}
