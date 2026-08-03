import assert from "node:assert/strict";
import test from "node:test";
import {
  getDashboardMoverLifecycle,
  getPreferredDashboardSession,
  isDashboardMoverFinalizationEligible,
  shouldFinalizeDashboardMoverSnapshot,
} from "./dashboardV2MoverLifecycle.ts";

test("prefers the currently active New York market session", () => {
  assert.equal(getPreferredDashboardSession("2026-08-03T13:27:00.000Z"), "Pre");
  assert.equal(getPreferredDashboardSession("2026-08-03T15:00:00.000Z"), "Regular");
  assert.equal(getPreferredDashboardSession("2026-08-03T21:00:00.000Z"), "After");
});

test("falls back to the regular snapshot outside active market sessions", () => {
  assert.equal(getPreferredDashboardSession("2026-08-03T02:00:00.000Z"), "Regular");
  assert.equal(getPreferredDashboardSession("2026-08-02T15:00:00.000Z"), "Regular");
});

test("keeps pre-market in finalization while delayed data catches up", () => {
  const lifecycle = getDashboardMoverLifecycle(
    "Pre",
    Date.parse("2026-07-24T13:40:00Z"),
  );
  assert.equal(lifecycle.marketDate, "2026-07-24");
  assert.equal(lifecycle.phase, "finalizing");
  assert.equal(
    isDashboardMoverFinalizationEligible(
      "Pre",
      lifecycle,
      "2026-07-24T13:42:00.000Z",
    ),
    false,
  );
  assert.equal(
    isDashboardMoverFinalizationEligible(
      "Pre",
      lifecycle,
      "2026-07-24T13:43:00.000Z",
    ),
    true,
  );
  assert.equal(lifecycle.expectedFinalProviderMinute, 9 * 60 + 29);
  assert.equal(
    shouldFinalizeDashboardMoverSnapshot({
      asOf: "2026-07-24T13:29:00Z",
      fetchedAt: "2026-07-24T13:40:00Z",
      lifecycle,
      session: "Pre",
    }),
    true,
  );
});

test("does not finalize pre-market before the delayed provider reaches 09:29 ET", () => {
  const lifecycle = getDashboardMoverLifecycle(
    "Pre",
    Date.parse("2026-07-24T13:40:00Z"),
  );
  assert.equal(
    shouldFinalizeDashboardMoverSnapshot({
      asOf: "2026-07-24T13:28:59Z",
      fetchedAt: "2026-07-24T13:40:00Z",
      lifecycle,
      session: "Pre",
    }),
    false,
  );
});

test("finalizes regular movers after the provider refresh delay", () => {
  const lifecycle = getDashboardMoverLifecycle(
    "Regular",
    Date.parse("2026-07-24T20:04:00Z"),
  );
  assert.equal(lifecycle.phase, "finalizing");
  assert.equal(
    shouldFinalizeDashboardMoverSnapshot({
      asOf: null,
      fetchedAt: "2026-07-24T20:04:00Z",
      lifecycle,
      session: "Regular",
    }),
    true,
  );
});

test("uses the early close when finalizing after-hours", () => {
  const lifecycle = getDashboardMoverLifecycle(
    "After",
    Date.parse("2026-11-27T22:10:00Z"),
  );
  assert.equal(lifecycle.phase, "finalizing");
  assert.equal(lifecycle.expectedFinalProviderMinute, 16 * 60 + 59);
  assert.equal(
    isDashboardMoverFinalizationEligible(
      "After",
      lifecycle,
      "2026-11-27T22:13:00.000Z",
    ),
    true,
  );
});

test("does not refresh movers on a market holiday", () => {
  const lifecycle = getDashboardMoverLifecycle(
    "Regular",
    Date.parse("2026-12-25T16:00:00Z"),
  );
  assert.equal(lifecycle.phase, "closed");
  assert.equal(lifecycle.refreshAllowed, false);
});
