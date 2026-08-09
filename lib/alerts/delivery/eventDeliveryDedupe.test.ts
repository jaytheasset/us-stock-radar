import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDeliveryDedupeKey,
  matchWatchedEventTickers,
} from "./eventDeliveryDedupe.ts";

test("watching GOOG and GOOGL matches one event candidate with one delivery identity", () => {
  const eventId = "f46d2e4e-7587-49cb-b8ed-9905e37b8944";
  const matches = matchWatchedEventTickers(
    ["GOOG", "GOOGL", "GOOGL"],
    new Set(["GOOG", "GOOGL"]),
  );

  assert.deepEqual(matches, ["GOOG", "GOOGL"]);
  assert.equal(buildDeliveryDedupeKey(eventId), `event:${eventId}`);
  assert.equal(
    new Set(matches.map(() => buildDeliveryDedupeKey(eventId))).size,
    1,
  );
});
