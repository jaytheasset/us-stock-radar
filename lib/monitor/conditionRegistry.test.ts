import assert from "node:assert/strict";
import test from "node:test";
import {
  getReadyMonitorCondition,
  getReadyMonitorConditions,
  MONITOR_CONDITION_REGISTRY,
  MONITOR_CONDITION_REGISTRY_VERSION,
} from "./conditionRegistry.ts";

test("condition registry exposes only V1 READY canonical conditions", () => {
  assert.equal(MONITOR_CONDITION_REGISTRY_VERSION, "monitor_conditions_v1");
  assert.ok(MONITOR_CONDITION_REGISTRY.length > 0);
  assert.deepEqual(getReadyMonitorConditions(), MONITOR_CONDITION_REGISTRY);
  assert.ok(MONITOR_CONDITION_REGISTRY.every((entry) => entry.status === "READY"));
  assert.equal(new Set(MONITOR_CONDITION_REGISTRY.map((entry) => entry.key)).size, MONITOR_CONDITION_REGISTRY.length);
});

test("offering conditions point directly to canonical event_offering_terms", () => {
  const offeringEntries = MONITOR_CONDITION_REGISTRY.filter((entry) => entry.family === "offering");
  assert.ok(offeringEntries.length > 0);
  assert.ok(offeringEntries.every((entry) => entry.source.table === "event_offering_terms"));
  assert.equal(getReadyMonitorCondition("market.event_time_price")?.source.table, "event_market_snapshots");
});

test("ownership condition qualities distinguish exact source values from derived calculations", () => {
  assert.deepEqual(getReadyMonitorCondition("ownership.form4.transaction_value")?.qualityCapability, ["derived", "unavailable"]);
  assert.deepEqual(getReadyMonitorCondition("ownership.form144.aggregate_market_value")?.qualityCapability, ["exact", "unavailable"]);
  assert.deepEqual(getReadyMonitorCondition("ownership.form144.proposed_sale_percent")?.qualityCapability, ["derived", "unavailable"]);
});
