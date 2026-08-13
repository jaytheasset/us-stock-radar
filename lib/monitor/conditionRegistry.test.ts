import assert from "node:assert/strict";
import test from "node:test";
import {
  getReadyMonitorCondition,
  getReadyMonitorConditions,
  MONITOR_COMPARISON_ELIGIBLE_QUALITIES,
  MONITOR_CONDITION_REGISTRY,
  MONITOR_CONDITION_REGISTRY_VERSION,
  validateMonitorConditionInput,
} from "./conditionRegistry.ts";
import {
  LISTING_EVENT_KINDS,
  LISTING_EVENT_OUTCOMES,
  LISTING_PROCEEDING_KINDS,
  LISTING_PROCEEDING_STATUSES,
} from "./listingRiskFacts.ts";

test("condition registry exposes only V1 READY canonical conditions", () => {
  assert.equal(MONITOR_CONDITION_REGISTRY_VERSION, "monitor_conditions_v1");
  assert.ok(MONITOR_CONDITION_REGISTRY.length > 0);
  assert.ok(getReadyMonitorConditions().every((entry) => entry.status === "READY"));
  assert.ok(getReadyMonitorConditions().length < MONITOR_CONDITION_REGISTRY.length);
  assert.equal(new Set(MONITOR_CONDITION_REGISTRY.map((entry) => entry.key)).size, MONITOR_CONDITION_REGISTRY.length);
});

test("offering conditions point only to the fail-closed canonical reader", () => {
  const offeringEntries = MONITOR_CONDITION_REGISTRY.filter((entry) => entry.family === "offering");
  assert.deepEqual(offeringEntries.map((entry) => entry.key), [
    "offering.side",
    "offering.amount",
    "offering.offering_price",
    "offering.immediate_primary_share_exposure",
    "offering.additional_potential_primary_share_exposure",
    "offering.resale_share_exposure",
    "offering.total_potential_share_exposure",
  ]);
  assert.ok(offeringEntries.every((entry) => entry.source.table === "event_offering_monitor_canonical"));
  assert.ok(offeringEntries.every((entry) => entry.source.reader === "read_event_offering_monitor_canonical"));
  assert.equal(getReadyMonitorCondition("offering.estimated_dilution_percent"), null);
  assert.equal(getReadyMonitorCondition("offering.float_overhang_percent"), null);
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

test("Listing V1 conditions use exact official-reader Core fact paths and contracts", () => {
  const expected = {
    "listing.event_kind": ["text", ["eq", "in"], ["classification", "event_kind"], LISTING_EVENT_KINDS],
    "listing.event_outcome": ["text", ["eq", "in"], ["classification", "event_outcome"], LISTING_EVENT_OUTCOMES],
    "listing.exchange": ["text", ["eq", "neq", "in", "not_in"], ["exchange", "value"], undefined],
    "listing.compliance_deadline": ["date", ["eq", "neq", "before", "after", "within_days"], ["dates", "compliance_deadline", "value"], undefined],
    "listing.hearing_date": ["date", ["eq", "neq", "before", "after", "within_days"], ["dates", "hearing_date", "value"], undefined],
    "listing.appeal_deadline": ["date", ["eq", "neq", "before", "after", "within_days"], ["dates", "appeal_deadline", "value"], undefined],
    "listing.suspension_date": ["date", ["eq", "neq", "before", "after", "within_days"], ["dates", "trading_suspension_date", "value"], undefined],
    "listing.removal_effective_date": ["date", ["eq", "neq", "before", "after", "within_days"], ["dates", "removal_effective_date", "value"], undefined],
    "listing.continued_trading": ["boolean", ["eq", "neq"], ["continued_trading", "continues", "value"], undefined],
    "listing.proceeding_kind": ["text", ["eq", "in"], ["proceeding", "kind"], LISTING_PROCEEDING_KINDS],
    "listing.proceeding_status": ["text", ["eq", "in"], ["proceeding", "status"], LISTING_PROCEEDING_STATUSES],
  } as const;

  const listingEntries = getReadyMonitorConditions().filter((entry) => entry.family === "listing");
  assert.deepEqual(listingEntries.map((entry) => entry.key), Object.keys(expected));
  for (const [key, [valueType, operators, jsonPath, enumValues]] of Object.entries(expected)) {
    const entry = getReadyMonitorCondition(key);
    assert.ok(entry);
    assert.equal(entry.valueType, valueType);
    assert.deepEqual(entry.allowedOperators, operators);
    assert.deepEqual(entry.enumValues, enumValues);
    assert.equal(entry.source.table, "event_listing_risk_facts");
    assert.equal(entry.source.column, "facts_payload");
    assert.equal(entry.source.reader, "read_current_event_listing_risk_facts");
    assert.deepEqual(entry.source.jsonPath, jsonPath);
    assert.equal(entry.eligibility?.requiredReaderStatus, "available");
  }
});

test("Listing V1 fact eligibility fails closed for unavailable and unknown facts", () => {
  const envelopeKeys = [
    "listing.exchange",
    "listing.compliance_deadline",
    "listing.hearing_date",
    "listing.appeal_deadline",
    "listing.suspension_date",
    "listing.removal_effective_date",
    "listing.continued_trading",
  ];
  for (const key of envelopeKeys) {
    const entry = getReadyMonitorCondition(key);
    assert.equal(entry?.eligibility?.requiredAvailability, "available");
    assert.ok(entry?.source.availabilityJsonPath);
    assert.ok(entry?.source.valueQualityJsonPath);
    assert.equal(entry?.qualityCapability.includes("unknown"), true);
    assert.deepEqual(entry?.eligibility?.requiredValueQualities, ["exact", "derived", "estimated"]);
  }
  for (const key of ["listing.event_outcome", "listing.proceeding_kind", "listing.proceeding_status"]) {
    assert.deepEqual(getReadyMonitorCondition(key)?.eligibility?.ineligibleValues, ["unknown"]);
  }
  assert.equal(MONITOR_COMPARISON_ELIGIBLE_QUALITIES.includes("unknown" as never), false);
});

test("registry input validation rejects unknown Listing keys, operators, and values", () => {
  assert.deepEqual(validateMonitorConditionInput({ key: "listing.event_kind", operator: "eq", value: "deficiency_notice" }), []);
  assert.deepEqual(validateMonitorConditionInput({ key: "listing.event_kind", operator: "in", value: ["deficiency_notice", "listing_removal"] }), []);
  assert.deepEqual(validateMonitorConditionInput({ key: "listing.compliance_deadline", operator: "before", value: "2026-12-31" }), []);
  assert.deepEqual(validateMonitorConditionInput({ key: "listing.compliance_deadline", operator: "within_days", value: 0 }), []);
  assert.deepEqual(validateMonitorConditionInput({ key: "listing.compliance_deadline", operator: "within_days", value: 30 }), []);
  assert.deepEqual(validateMonitorConditionInput({ key: "listing.continued_trading", operator: "eq", value: false }), []);
  assert.deepEqual(validateMonitorConditionInput({ key: "listing.made_up", operator: "eq", value: "x" }), ["condition_key_unknown"]);
  assert.deepEqual(validateMonitorConditionInput({ key: "listing.event_kind", operator: "contains", value: "listing_removal" }), ["condition_operator_unknown"]);
  assert.deepEqual(validateMonitorConditionInput({ key: "listing.event_kind", operator: "eq", value: "delisted" }), ["condition_value_invalid"]);
  assert.deepEqual(validateMonitorConditionInput({ key: "listing.event_outcome", operator: "eq", value: "unknown" }), ["condition_value_invalid"]);
  assert.deepEqual(validateMonitorConditionInput({ key: "listing.proceeding_kind", operator: "in", value: ["hearing", "unknown"] }), ["condition_value_invalid"]);
  assert.deepEqual(validateMonitorConditionInput({ key: "listing.compliance_deadline", operator: "before", value: "2026-02-30" }), ["condition_value_invalid"]);
  for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, "7", "2026-12-31"]) {
    assert.deepEqual(
      validateMonitorConditionInput({ key: "listing.compliance_deadline", operator: "within_days", value }),
      ["condition_value_invalid"],
    );
  }
  assert.deepEqual(
    validateMonitorConditionInput({ key: "event.published_at", operator: "within_days", value: 7 }),
    ["condition_operator_unknown"],
  );
  assert.deepEqual(validateMonitorConditionInput({ key: "listing.continued_trading", operator: "eq", value: "false" }), ["condition_value_invalid"]);
});

test("Offering registry enum input remains valid after shared registry validation", () => {
  assert.deepEqual(getReadyMonitorCondition("offering.side")?.enumValues, ["primary", "resale", "mixed"]);
  assert.deepEqual(validateMonitorConditionInput({ key: "offering.side", operator: "eq", value: "primary" }), []);
  assert.deepEqual(validateMonitorConditionInput({ key: "offering.side", operator: "in", value: ["resale", "mixed"] }), []);
  assert.deepEqual(validateMonitorConditionInput({ key: "offering.side", operator: "eq", value: "unknown" }), ["condition_value_invalid"]);
});
