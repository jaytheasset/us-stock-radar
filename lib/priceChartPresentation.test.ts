import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  derivePriceChartMovement,
  resolvePriceChartTone,
} from "./priceChartPresentation.ts";

test("stored price movement uses the final point instead of the event signal", () => {
  const movement = derivePriceChartMovement(
    [{ close: 118 }, { close: 110 }],
    120,
  );

  assert.deepEqual(movement, {
    changeAmount: -10,
    changePercent: -8.333333333333332,
    latestPrice: 110,
    tone: "bearish",
  });
});

test("stored gains derive a bullish tone and displayed movement", () => {
  const movement = derivePriceChartMovement(
    [{ close: 98 }, { close: 105 }],
    100,
  );

  assert.deepEqual(movement, {
    changeAmount: 5,
    changePercent: 5,
    latestPrice: 105,
    tone: "bullish",
  });
});

test("missing movement data falls back to market change text and then neutral", () => {
  assert.equal(resolvePriceChartTone(undefined, "-8.33%"), "bearish");
  assert.equal(resolvePriceChartTone(undefined, "+2.10%"), "bullish");
  assert.equal(resolvePriceChartTone(undefined, "N/A"), "neutral");
  assert.equal(derivePriceChartMovement([], 100), null);
  assert.equal(derivePriceChartMovement([{ close: 100 }], 0), null);
});

test("PriceChartCard derives its presentation without falling back to the event tone", () => {
  const source = readFileSync(
    new URL("../app/events/[id]/PriceChartCard.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /derivePriceChartMovement\(\s*storedPoints,\s*series\.previousClose/);
  assert.match(source, /resolvePriceChartTone\(chartData\?\.changePercent,\s*change\)/);
  assert.doesNotMatch(source, /\?\s*tone\s*:\s*toneFromPercent/);
});
