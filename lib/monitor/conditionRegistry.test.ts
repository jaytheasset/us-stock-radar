import assert from "node:assert/strict";
import test from "node:test";
import {
  getReadyMonitorCondition,
  getReadyMonitorConditions,
  MONITOR_COMPARISON_ELIGIBLE_QUALITIES,
  MONITOR_CONDITION_REGISTRY,
  MONITOR_CONDITION_REGISTRY_VERSION,
} from "./conditionRegistry.ts";

test("condition registry exposes only V1 READY canonical conditions", () => {
  assert.equal(MONITOR_CONDITION_REGISTRY_VERSION, "monitor_conditions_v1");
  assert.ok(MONITOR_CONDITION_REGISTRY.length > 0);
  assert.ok(getReadyMonitorConditions().every((entry) => entry.status === "READY"));
  assert.ok(getReadyMonitorConditions().length < MONITOR_CONDITION_REGISTRY.length);
  assert.equal(new Set(MONITOR_CONDITION_REGISTRY.map((entry) => entry.key)).size, MONITOR_CONDITION_REGISTRY.length);
});

test("offering conditions point directly to canonical event_offering_terms", () => {
  const offeringEntries = MONITOR_CONDITION_REGISTRY.filter((entry) => entry.family === "offering");
  assert.ok(offeringEntries.length > 0);
  assert.ok(offeringEntries.every((entry) => entry.source.table === "event_offering_terms"));
  assert.equal(getReadyMonitorCondition("market.price_at_event")?.source.table, "event_market_snapshots");
  assert.equal(getReadyMonitorCondition("market.price_at_event")?.source.availabilityColumn, "price_availability");
});

test("registry separates value quality from availability and only exposes proven ownership facts", () => {
  assert.ok(MONITOR_CONDITION_REGISTRY.every((entry) => !entry.qualityCapability.includes("unavailable" as never)));
  assert.deepEqual(getReadyMonitorCondition("ownership.form4.transaction_value")?.qualityCapability, ["derived", "unknown"]);
  assert.deepEqual(getReadyMonitorCondition("ownership.form144.proposed_sale_value")?.qualityCapability, ["exact", "unknown"]);
  assert.equal(getReadyMonitorCondition("ownership.form4.direction")?.source.column, "economic_direction");
  assert.equal(getReadyMonitorCondition("ownership.form144.proposed_sale_percent"), null);
  assert.equal(getReadyMonitorCondition("ownership.form4.shares"), null);
});

test("future comparisons exclude unknown quality even when its numeric value is available", () => {
  assert.deepEqual(MONITOR_COMPARISON_ELIGIBLE_QUALITIES, ["exact", "derived", "estimated"]);
  assert.equal(MONITOR_COMPARISON_ELIGIBLE_QUALITIES.includes("unknown" as never), false);
});

test("common event scope fields and eligible ownership roles are READY canonical DB sources", () => {
  for (const key of ["event.market_scope", "event.sector", "event.theme_group", "ownership.form4.reporting_owner_role", "ownership.form4.is_10_percent_owner"]) {
    assert.equal(getReadyMonitorCondition(key)?.status, "READY");
  }
});

test("only DB-proven Ownership conditions are READY and 10b5-1 remains PARTIAL", () => {
  const readyOwnership = getReadyMonitorConditions()
    .filter((entry) => entry.family === "ownership")
    .map((entry) => entry.key)
    .sort();
  assert.deepEqual(readyOwnership, [
    "ownership.form144.proposed_sale_value",
    "ownership.form4.direction",
    "ownership.form4.is_10_percent_owner",
    "ownership.form4.reporting_owner_role",
    "ownership.form4.transaction_value",
  ]);
  assert.equal(MONITOR_CONDITION_REGISTRY.find((entry) => entry.key === "ownership.form4.is_10b5_1")?.status, "PARTIAL");
  assert.equal(getReadyMonitorCondition("ownership.form4.is_10b5_1"), null);
});
