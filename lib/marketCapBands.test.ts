import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyMarketCapBand,
  marketCapRangeLabels,
  readStoredEventMarketCap,
} from "./marketCapBands.ts";

test("common market-cap bands use the exact shared boundaries", () => {
  assert.equal(classifyMarketCapBand(99_999_999), "Micro");
  assert.equal(classifyMarketCapBand(100_000_000), "Small");
  assert.equal(classifyMarketCapBand(1_999_999_999), "Small");
  assert.equal(classifyMarketCapBand(2_000_000_000), "Mid");
  assert.equal(classifyMarketCapBand(9_999_999_999), "Mid");
  assert.equal(classifyMarketCapBand(10_000_000_000), "Large");
  assert.equal(classifyMarketCapBand(199_999_999_999), "Large");
  assert.equal(classifyMarketCapBand(200_000_000_000), "Mega");
  assert.equal(classifyMarketCapBand(null), null);
});

test("common range labels match the shared site filter copy", () => {
  assert.deepEqual(marketCapRangeLabels, {
    Micro: "<$100M",
    Small: "$100M-$2B",
    Mid: "$2B-$10B",
    Large: "$10B-$200B",
    Mega: "$200B+",
  });
});

test("stored event market cap prefers the LLM-resolved value and preserves legacy fallback", () => {
  assert.equal(
    readStoredEventMarketCap({
      resolved_market_cap: { value: 350_000_000, source: "filing" },
      market_context: { market_cap: 12_000_000_000 },
    }),
    350_000_000,
  );
  assert.equal(
    readStoredEventMarketCap({ market_context: { market_cap: 12_000_000_000 } }),
    12_000_000_000,
  );
  assert.equal(
    readStoredEventMarketCap({
      resolved_market_cap: { value: null, source: "unavailable" },
      market_context: { market_cap: 12_000_000_000 },
    }),
    null,
  );
});
