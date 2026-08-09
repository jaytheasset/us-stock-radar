import assert from "node:assert/strict";
import test from "node:test";
import { normalizeStoredAlertTickers } from "./alertTickerNormalization.ts";
import {
  buildDeliveryDedupeKey,
  matchWatchedEventTickers,
} from "./eventDeliveryDedupe.ts";

for (const sourceTicker of ["GOOG", "GOOGL"] as const) {
  test(`stored Alphabet linkage keeps ${sourceTicker} primary and excludes non-product tickers`, () => {
    const relatedTicker = sourceTicker === "GOOG" ? "GOOGL" : "GOOG";
    const normalized = normalizeStoredAlertTickers(sourceTicker, [
      { symbol: sourceTicker, role: "primary", sort_order: 1 },
      { symbol: relatedTicker, role: "related", sort_order: 2 },
    ]);

    assert.equal(normalized.primaryTicker, sourceTicker);
    assert.deepEqual(normalized.tickers, [sourceTicker, relatedTicker]);
    assert.equal(normalized.tickers.includes("GOOGM"), false);
    assert.equal(normalized.tickers.includes("GOOGN"), false);
  });
}

test("GOOG-only, GOOGL-only, and both settings produce one user-event delivery identity", () => {
  const eventId = "f46d2e4e-7587-49cb-b8ed-9905e37b8944";
  const userId = "user-1";
  const eventTickers = ["GOOG", "GOOGL"];
  const cases = [
    { watched: new Set(["GOOG"]), expectedMatches: ["GOOG"] },
    { watched: new Set(["GOOGL"]), expectedMatches: ["GOOGL"] },
    {
      watched: new Set(["GOOG", "GOOGL"]),
      expectedMatches: ["GOOG", "GOOGL"],
    },
  ];

  const deliveryIdentities = cases.map(({ watched, expectedMatches }) => {
    const matchedTickers = matchWatchedEventTickers(eventTickers, watched);
    assert.deepEqual(matchedTickers, expectedMatches);
    assert.ok(matchedTickers.length > 0);
    return `${userId}:${buildDeliveryDedupeKey(eventId)}`;
  });

  assert.deepEqual(deliveryIdentities, [
    `user-1:event:${eventId}`,
    `user-1:event:${eventId}`,
    `user-1:event:${eventId}`,
  ]);
  assert.equal(new Set(deliveryIdentities).size, 1);
});
