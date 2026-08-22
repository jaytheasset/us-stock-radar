import assert from "node:assert/strict";
import test from "node:test";
import {
  getReadyMonitorCondition,
  getReadyMonitorConditions,
  MONITOR_COMPARISON_ELIGIBLE_QUALITIES,
  MONITOR_CONDITION_REGISTRY,
  MONITOR_CONDITION_REGISTRY_VERSION,
  MONITOR_CONDITION_OPERATOR_DISPLAY_LABELS,
  validateMonitorConditionInput,
} from "./conditionRegistry.ts";
import {
  CORPORATE_ACTION_EVENT_KIND_VOCABULARY,
  CORPORATE_ACTION_STAGE_VOCABULARY,
  CORPORATE_ACTION_STAGES,
} from "./corporateActionCanonicalFacts.ts";
import {
  LISTING_EVENT_KINDS,
  LISTING_EVENT_OUTCOMES,
  LISTING_PROCEEDING_KINDS,
  LISTING_PROCEEDING_STATUSES,
} from "./listingRiskFacts.ts";

test("Corporate Action Monitor V1 derives stock splits and monitorable stages from canonical vocabulary", () => {
  const entries = getReadyMonitorConditions().filter((entry) => entry.family === "corporate_action");
  assert.deepEqual(entries.map((entry) => entry.key), [
    "corporate_action.event_kind",
    "corporate_action.action_stage",
  ]);
  assert.deepEqual(entries.map((entry) => entry.allowedOperators), [["eq", "in"], ["eq", "in"]]);
  assert.deepEqual(entries[0].enumValues, ["reverse_split", "forward_split"]);
  assert.deepEqual(entries[1].enumValues, CORPORATE_ACTION_STAGE_VOCABULARY
    .filter((entry) => entry.monitorable)
    .map((entry) => entry.value));
  assert.deepEqual(entries[1].enumValues, [
    "announced",
    "board_approved",
    "shareholder_approved",
    "scheduled",
    "effective",
  ]);
  assert.equal(entries[0].display?.label, "Corporate action");
  assert.equal(entries[0].display?.enumValueLabels?.reverse_split, "Reverse stock split");
  assert.equal(entries[0].display?.enumValueLabels?.forward_split, "Forward stock split");
  assert.equal(entries[1].display?.label, "Corporate action stage");
  assert.equal(entries[1].display?.enumValueLabels?.effective, "Effective");
  assert.equal(entries[0].requiresExplicitConfirmationInAiDraft, undefined);
  assert.equal(entries[1].requiresExplicitConfirmationInAiDraft, true);
  assert.deepEqual(entries[1].aiDraftConfirmation, {
    useLabel: "Use this filter",
    omitLabel: "Any stage",
    enumValueLabels: {
      announced: "Initial plan announced",
      board_approved: "Board approved",
      shareholder_approved: "Shareholders approved",
      scheduled: "Scheduled",
      effective: "Effective",
    },
  });
  assert.ok(getReadyMonitorConditions()
    .filter((entry) => entry.key !== "corporate_action.action_stage")
    .every((entry) => entry.requiresExplicitConfirmationInAiDraft !== true));
  assert.match(entries[1].description ?? "", /lifecycle-stage restriction/i);
  assert.deepEqual(entries[0].enumValues, CORPORATE_ACTION_EVENT_KIND_VOCABULARY
    .filter((entry) => entry.monitorable)
    .map((entry) => entry.value));
  for (const entry of [...CORPORATE_ACTION_EVENT_KIND_VOCABULARY, ...CORPORATE_ACTION_STAGE_VOCABULARY]) {
    const definition = entries.find((candidate) => candidate.enumValues?.includes(entry.value));
    if (!entry.monitorable) {
      assert.equal(Boolean(definition?.enumValues?.includes(entry.value)), false);
      continue;
    }
    assert.equal(definition?.enumValueDescriptions?.[entry.value], entry.description);
    assert.equal(definition?.display?.enumValueLabels?.[entry.value], entry.displayLabel);
  }
  assert.ok(entries.every((entry) => entry.source.table === "event_corporate_action_facts"));
  assert.ok(entries.every((entry) => entry.source.reader === "read_current_event_corporate_action_facts"));
  assert.ok(entries.every((entry) => entry.eligibility?.requiredReaderStatus === "available"));
  assert.ok(entries.every((entry) => entry.monitorDomains?.includes("listing")));
  const userLabels = entries.flatMap((entry) => [
    entry.display?.label,
    ...Object.values(entry.display?.enumValueLabels ?? {}),
  ]).join("\n");
  assert.doesNotMatch(userLabels, /reverse_split|board_approved|shareholder_approved/);
});

test("Corporate Action input validation accepts monitorable canonical values and rejects unknown stage", () => {
  assert.deepEqual(validateMonitorConditionInput({
    key: "corporate_action.event_kind",
    operator: "eq",
    value: "reverse_split",
  }), []);
  assert.deepEqual(validateMonitorConditionInput({
    key: "corporate_action.event_kind",
    operator: "in",
    value: ["reverse_split", "forward_split"],
  }), []);
  assert.deepEqual(validateMonitorConditionInput({
    key: "corporate_action.event_kind",
    operator: "eq",
    value: "forward_split",
  }), []);
  assert.deepEqual(validateMonitorConditionInput({
    key: "corporate_action.action_stage",
    operator: "eq",
    value: "effective",
  }), []);
  assert.deepEqual(validateMonitorConditionInput({
    key: "corporate_action.action_stage",
    operator: "in",
    value: ["scheduled", "effective"],
  }), []);
  assert.equal(CORPORATE_ACTION_STAGES.includes("unknown"), true);
  for (const value of ["unknown", "approved", "completed"]) {
    assert.deepEqual(validateMonitorConditionInput({
      key: "corporate_action.action_stage",
      operator: "eq",
      value,
    }), ["condition_value_invalid"]);
  }
});

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

test("every public Listing V1 condition and value has separate complete English semantic and display metadata", () => {
  const listingEntries = getReadyMonitorConditions().filter((entry) => entry.family === "listing");
  assert.equal(listingEntries.length, 11);
  assert.deepEqual(Object.keys(MONITOR_CONDITION_OPERATOR_DISPLAY_LABELS).sort(), [
    "after", "before", "eq", "gt", "gte", "in", "lt", "lte", "neq", "not_in", "within_days",
  ]);
  for (const label of Object.values(MONITOR_CONDITION_OPERATOR_DISPLAY_LABELS)) {
    assert.match(label, /^[\x20-\x7e]+$/);
    assert.ok(label.length > 0);
  }
  for (const entry of listingEntries) {
    assert.equal(typeof entry.description, "string", `${entry.key} description`);
    assert.match(entry.description ?? "", /^[\x20-\x7e]+$/, `${entry.key} description must be ASCII English`);
    assert.ok((entry.description?.length ?? 0) > 0 && (entry.description?.length ?? 0) <= 140);
    assert.match(entry.display?.label ?? "", /^[\x20-\x7e]+$/, `${entry.key} display label`);
    assert.ok((entry.display?.label.length ?? 0) > 0 && (entry.display?.label.length ?? 0) <= 48);
    if (entry.enumValues) {
      assert.deepEqual(
        Object.keys(entry.enumValueDescriptions ?? {}).sort(),
        [...entry.enumValues].sort(),
        `${entry.key} enum description keys`,
      );
      for (const value of entry.enumValues) {
        const description = entry.enumValueDescriptions?.[value] ?? "";
        assert.match(description, /^[\x20-\x7e]+$/, `${entry.key}.${value} description must be ASCII English`);
        assert.ok(description.length > 0 && description.length <= 140);
        const displayLabel = entry.display?.enumValueLabels?.[value] ?? "";
        assert.match(displayLabel, /^[\x20-\x7e]+$/, `${entry.key}.${value} display label`);
        assert.ok(displayLabel.length > 0 && displayLabel.length <= 48);
      }
    } else {
      assert.equal(entry.enumValueDescriptions, undefined);
      assert.equal(entry.display?.enumValueLabels, undefined);
    }
    if (entry.valueType === "boolean") {
      assert.deepEqual(entry.display?.booleanValueLabels, { true: "Yes", false: "No" });
    } else {
      assert.equal(entry.display?.booleanValueLabels, undefined);
    }
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

test("market.price is the sole current-market Monitor V1 contract and fails closed on non-positive values", () => {
  const price = getReadyMonitorCondition("market.price");
  assert.ok(price);
  assert.equal(price.family, "market");
  assert.equal(price.domain, "current_state");
  assert.equal(price.valueType, "number");
  assert.deepEqual(price.allowedOperators, ["lt", "lte", "gt", "gte"]);
  assert.equal(price.description, "Current market price of the security.");
  assert.equal(price.display?.label, "Price");
  assert.deepEqual(price.monitorDomains, ["listing"]);
  assert.equal(price.source.reader, "get_current_price");
  assert.deepEqual(price.eligibility?.requiredDataModes, ["realtime"]);
  assert.equal(price.eligibility?.maximumAgeSeconds, 300);
  assert.equal(price.numberValidation?.exclusiveMinimum, 0);
  assert.equal(getReadyMonitorCondition("market.volume"), null);
  assert.equal(getReadyMonitorCondition("market.market_cap"), null);

  for (const operator of ["lt", "lte", "gt", "gte"] as const) {
    assert.deepEqual(validateMonitorConditionInput({ key: "market.price", operator, value: 1 }), []);
  }
  for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "1", null]) {
    assert.deepEqual(
      validateMonitorConditionInput({ key: "market.price", operator: "lt", value }),
      ["condition_value_invalid"],
    );
  }
  assert.deepEqual(
    validateMonitorConditionInput({ key: "market.price", operator: "eq", value: 1 }),
    ["condition_operator_unknown"],
  );
});
