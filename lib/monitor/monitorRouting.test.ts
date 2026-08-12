import assert from "node:assert/strict";
import test from "node:test";
import {
  MONITOR_ANALYZER_KEY_MAX_LENGTH,
  MONITOR_ROUTING_CONTRACT_VERSION,
  readMonitorRoutingResult,
  SUPPORTED_MONITOR_ANALYZER_KEYS,
  validateMonitorRoutingResult,
  type MonitorRoutingResult,
} from "./monitorRouting.ts";

const listingRoute = { monitor_analyzer_key: "listing_risk" } as const;

test("contract identifies V1 and enables only the implemented analyzer by default", () => {
  assert.equal(MONITOR_ROUTING_CONTRACT_VERSION, "monitor_routing_v1");
  assert.deepEqual(SUPPORTED_MONITOR_ANALYZER_KEYS, ["listing_risk"]);
});

test("empty monitor_routes is the canonical valid no-route result", () => {
  const result: MonitorRoutingResult = { monitor_routes: [] };
  assert.deepEqual(validateMonitorRoutingResult(result), []);
  assert.deepEqual(readMonitorRoutingResult(result), result);
});

test("one implemented analyzer route is valid", () => {
  assert.deepEqual(validateMonitorRoutingResult({ monitor_routes: [listingRoute] }), []);
});

test("multiple distinct analyzer routes are representable with an explicit deployment key set", () => {
  const result = {
    monitor_routes: [
      listingRoute,
      { monitor_analyzer_key: "financial_risk" },
    ],
  };
  assert.deepEqual(
    validateMonitorRoutingResult(result, {
      allowedAnalyzerKeys: ["listing_risk", "financial_risk"],
    }),
    [],
  );
});

test("the default validator rejects an analyzer that is not actually implemented", () => {
  const errors = validateMonitorRoutingResult({
    monitor_routes: [{ monitor_analyzer_key: "financial_risk" }],
  });
  assert.ok(errors.some((error) => error.includes("is not supported")));
});

test("the same analyzer cannot be routed twice from one Primary result", () => {
  const errors = validateMonitorRoutingResult({
    monitor_routes: [listingRoute, listingRoute],
  });
  assert.ok(errors.some((error) => error.includes("must be unique")));
});

test("analyzer keys have a bounded lowercase mechanical shape", () => {
  for (const monitor_analyzer_key of [
    "",
    " listing_risk",
    "Listing_Risk",
    "listing-risk",
    "1_listing_risk",
    `a${"b".repeat(MONITOR_ANALYZER_KEY_MAX_LENGTH)}`,
  ]) {
    const errors = validateMonitorRoutingResult(
      { monitor_routes: [{ monitor_analyzer_key }] },
      { allowedAnalyzerKeys: [monitor_analyzer_key] },
    );
    assert.ok(errors.some((error) => error.includes("must match")), monitor_analyzer_key);
  }

  const longestValidKey = `a${"b".repeat(MONITOR_ANALYZER_KEY_MAX_LENGTH - 1)}`;
  assert.deepEqual(
    validateMonitorRoutingResult(
      { monitor_routes: [{ monitor_analyzer_key: longestValidKey }] },
      { allowedAnalyzerKeys: [longestValidKey] },
    ),
    [],
  );
});

test("missing, null, or non-array routes are invalid instead of alternate no-route forms", () => {
  for (const value of [{}, { monitor_routes: null }, { monitor_routes: {} }]) {
    assert.notDeepEqual(validateMonitorRoutingResult(value), []);
  }
});

test("unknown outer fields are rejected", () => {
  const errors = validateMonitorRoutingResult({
    monitor_routes: [],
    version: 1,
  });
  assert.ok(errors.some((error) => error.includes("must contain exactly")));
});

test("relation, confidence, and reason are not part of the lightweight route item", () => {
  const errors = validateMonitorRoutingResult({
    monitor_routes: [{
      ...listingRoute,
      relation: "primary",
      confidence: "high",
      reason: "The source may warrant analyzer inspection.",
    }],
  });
  assert.ok(errors.some((error) => error.includes("must contain exactly")));
});

test("event_type remains independent from monitor_analyzer_key", () => {
  const primaryOutput = {
    event_type: "strategic_transaction",
    monitor_routing: { monitor_routes: [listingRoute] },
  };
  assert.deepEqual(validateMonitorRoutingResult(primaryOutput.monitor_routing), []);
  assert.notEqual(primaryOutput.event_type, primaryOutput.monitor_routing.monitor_routes[0].monitor_analyzer_key);
});

test("route items reject Listing domain facts", () => {
  const errors = validateMonitorRoutingResult({
    monitor_routes: [{
      ...listingRoute,
      listing_event_kind: "deficiency_notice",
      compliance_deadline: "2026-09-01",
      exchange: "Nasdaq",
    }],
  });
  assert.ok(errors.some((error) => error.includes("must contain exactly")));
});

test("routing rejects orchestration and persistence state", () => {
  const routeErrors = validateMonitorRoutingResult({
    monitor_routes: [{
      ...listingRoute,
      status: "queued",
      retry_count: 0,
      child_ai_run_id: "child-run",
    }],
  });
  const rootErrors = validateMonitorRoutingResult({
    monitor_routes: [listingRoute],
    parent_primary_ai_run_id: "parent-run",
    persisted_at: "2026-08-13T00:00:00Z",
  });
  assert.ok(routeErrors.some((error) => error.includes("must contain exactly")));
  assert.ok(rootErrors.some((error) => error.includes("must contain exactly")));
});

test("route array order has no validator priority semantics", () => {
  const allowedAnalyzerKeys = ["listing_risk", "financial_risk"] as const;
  const forward = {
    monitor_routes: [listingRoute, { monitor_analyzer_key: "financial_risk" }],
  };
  const reverse = {
    monitor_routes: [...forward.monitor_routes].reverse(),
  };
  assert.deepEqual(validateMonitorRoutingResult(forward, { allowedAnalyzerKeys }), []);
  assert.deepEqual(validateMonitorRoutingResult(reverse, { allowedAnalyzerKeys }), []);
});

test("invalid route containers fail closed and the reader returns null", () => {
  for (const value of [
    null,
    [],
    { monitor_routes: [null] },
    { monitor_routes: [[]] },
    { monitor_routes: [{}] },
  ]) {
    assert.notDeepEqual(validateMonitorRoutingResult(value), []);
    assert.equal(readMonitorRoutingResult(value), null);
  }
});
