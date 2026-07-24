import assert from "node:assert/strict";
import test from "node:test";
import { formatMarketDateLabel, isSameMarketDate } from "./marketDate.ts";

test("uses Today for events on the current New York date", () => {
  assert.equal(
    formatMarketDateLabel(
      "2026-07-25T03:59:00.000Z",
      "2026-07-25T03:59:30.000Z",
    ),
    "Today",
  );
});

test("switches Today to the calendar date after New York midnight", () => {
  const eventTime = "2026-07-25T03:59:00.000Z";
  const afterMidnight = "2026-07-25T04:01:00.000Z";

  assert.equal(isSameMarketDate(eventTime, afterMidnight), false);
  assert.equal(formatMarketDateLabel(eventTime, afterMidnight), "Jul 24");
});
