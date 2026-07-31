import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCalendarEventFollowUsage,
  formatCalendarEventFollowUsage,
} from "./calendarFollowPolicy.ts";

test("Calendar follow usage keeps finite and unlimited plan contracts distinct", () => {
  assert.deepEqual(buildCalendarEventFollowUsage(3, 5), {
    activeCount: 3,
    limit: 5,
    remaining: 2,
  });
  assert.deepEqual(buildCalendarEventFollowUsage(70, null), {
    activeCount: 70,
    limit: null,
    remaining: null,
  });
  assert.deepEqual(buildCalendarEventFollowUsage(8, 5), {
    activeCount: 8,
    limit: 5,
    remaining: 0,
  });
});

test("Calendar follow usage labels match the compact UI contract", () => {
  assert.equal(
    formatCalendarEventFollowUsage(buildCalendarEventFollowUsage(3, 5)),
    "3 / 5 active",
  );
  assert.equal(
    formatCalendarEventFollowUsage(buildCalendarEventFollowUsage(70, null)),
    "70 active · Unlimited",
  );
});
