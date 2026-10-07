import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  evaluateOfferingMonitorConditions,
  type OfferingMonitorCondition,
} from "./offeringMonitorMatcher.ts";
import type { OfferingMonitorCanonicalReadResult } from "./offeringMonitorCanonicalPersistence.ts";
import {
  buildMinimalOfferingMarketSnapshot,
  materializeMinimalOfferingMonitor,
  type MinimalOfferingMonitor,
  type MinimalOfferingValueQuality,
} from "./minimalOfferingMonitor.ts";

const EVENT_ID = "69606800-ee16-4a75-9bbf-3b64bdc56d69";

test("IPDN canonical facts satisfy the required numeric and AND cases", () => {
  const canonical = availableCanonical();
  assert.equal(evaluateOfferingMonitorConditions(canonical, [amount("gte", 5_000_000)]).status, "match");
  assert.equal(evaluateOfferingMonitorConditions(canonical, [amount("gt", 20_000_000)]).status, "no_match");
  assert.equal(evaluateOfferingMonitorConditions(canonical, [total("gte", 30_000_000)]).status, "match");
  assert.equal(evaluateOfferingMonitorConditions(canonical, [total("gt", 40_000_000)]).status, "no_match");
  assert.equal(evaluateOfferingMonitorConditions(canonical, [amount("gte", 5_000_000), total("gte", 30_000_000)]).status, "match");
  assert.equal(evaluateOfferingMonitorConditions(canonical, [amount("gt", 20_000_000), total("gte", 30_000_000)]).status, "no_match");
});

test("all registry numeric comparison operators are deterministic", () => {
  const canonical = availableCanonical();
  for (const [operator, value, expected] of [
    ["gt", 9_000_000, "match"],
    ["gte", 10_000_000, "match"],
    ["lt", 11_000_000, "match"],
    ["lte", 10_000_000, "match"],
    ["eq", 10_000_000, "match"],
    ["neq", 10_000_000, "no_match"],
  ] as const) {
    assert.equal(evaluateOfferingMonitorConditions(canonical, [amount(operator, value)]).status, expected);
  }
});

test("side supports existing eq and in enum syntax", () => {
  const canonical = availableCanonical();
  assert.equal(evaluateOfferingMonitorConditions(canonical, [{ key: "offering.side", operator: "eq", value: "primary" }]).status, "match");
  assert.equal(evaluateOfferingMonitorConditions(canonical, [{ key: "offering.side", operator: "in", value: ["resale", "primary"] }]).status, "match");
  assert.equal(evaluateOfferingMonitorConditions(canonical, [{ key: "offering.side", operator: "eq", value: "resale" }]).status, "no_match");
});

test("unavailable price and unknown quality are ineligible without zero coercion", () => {
  const canonical = availableCanonical();
  const price = { key: "offering.offering_price", operator: "gte", value: 0, currency: "USD" };
  assert.deepEqual(statusAndReason(evaluateOfferingMonitorConditions(canonical, [price])), ["ineligible", "fact_unavailable"]);

  for (const quality of ["exact", "derived", "estimated"] as const) {
    const value = availableCanonical();
    value.canonical.facts.actual_primary_offering_amount.value_quality = quality;
    assert.equal(evaluateOfferingMonitorConditions(value, [amount("gte", 5_000_000)]).status, "match");
  }
  const unknown = availableCanonical();
  unknown.canonical.facts.actual_primary_offering_amount.value_quality = "unknown";
  assert.deepEqual(statusAndReason(evaluateOfferingMonitorConditions(unknown, [amount("gte", 0)])), ["ineligible", "fact_quality_unknown"]);

  const malformed = availableCanonical();
  malformed.canonical.facts.actual_primary_offering_amount.value = null;
  malformed.canonical.facts.actual_primary_offering_amount.availability = "unavailable";
  assert.deepEqual(statusAndReason(evaluateOfferingMonitorConditions(malformed, [amount("eq", 0)])), ["ineligible", "fact_unavailable"]);
});

test("currency and share comparison basis must be compatible", () => {
  const canonical = availableCanonical();
  assert.deepEqual(statusAndReason(evaluateOfferingMonitorConditions(canonical, [{ key: "offering.amount", operator: "gte", value: 5_000_000 }])), ["ineligible", "currency_required"]);
  assert.deepEqual(statusAndReason(evaluateOfferingMonitorConditions(canonical, [{ ...amount("gte", 5_000_000), currency: "EUR" }])), ["ineligible", "currency_incompatible"]);
  assert.deepEqual(statusAndReason(evaluateOfferingMonitorConditions(canonical, [{ ...total("gte", 30_000_000), comparisonBasisType: "public_float" }])), ["ineligible", "basis_incompatible"]);

  const incompatible = availableCanonical();
  incompatible.materialized.total_potential_primary_share_exposure.comparison_basis_type = "public_float";
  assert.deepEqual(statusAndReason(evaluateOfferingMonitorConditions(incompatible, [total("gte", 30_000_000)])), ["ineligible", "basis_incompatible"]);
});

test("matcher reads the canonical materialized total and never recalculates it", () => {
  const canonical = availableCanonical();
  canonical.materialized.total_potential_primary_share_exposure.value = 7;
  canonical.totalPotentialPrimaryShareExposure = 7;
  assert.equal(evaluateOfferingMonitorConditions(canonical, [total("eq", 7)]).status, "match");
  assert.equal(evaluateOfferingMonitorConditions(canonical, [total("gte", 30_000_000)]).status, "no_match");
});

test("missing, stale, unavailable, and not-applicable canonical states are ineligible", () => {
  for (const reason of ["canonical_missing", "parent_not_current", "canonical_invalid_or_stale_raw"]) {
    assert.deepEqual(
      statusAndReason(evaluateOfferingMonitorConditions({ status: "not_ready", reason }, [amount("gte", 5_000_000)])),
      ["ineligible", "canonical_not_ready"],
    );
  }
  const notApplicable = availableCanonical();
  notApplicable.canonical.applicability = "not_applicable";
  assert.deepEqual(statusAndReason(evaluateOfferingMonitorConditions(notApplicable, [amount("gte", 5_000_000)])), ["ineligible", "canonical_not_applicable"]);
});

test("unknown keys, operators, values, and empty sets fail closed", () => {
  const canonical = availableCanonical();
  assert.deepEqual(statusAndReason(evaluateOfferingMonitorConditions(canonical, [{ key: "offering.percent", operator: "gte", value: 1 }])), ["ineligible", "condition_key_unknown"]);
  assert.deepEqual(statusAndReason(evaluateOfferingMonitorConditions(canonical, [{ key: "offering.amount", operator: "approximately", value: 1, currency: "USD" }])), ["ineligible", "condition_operator_unknown"]);
  assert.deepEqual(statusAndReason(evaluateOfferingMonitorConditions(canonical, [{ key: "offering.amount", operator: "gte", value: "5M", currency: "USD" }])), ["ineligible", "condition_value_invalid"]);
  assert.deepEqual(statusAndReason(evaluateOfferingMonitorConditions(canonical, [])), ["ineligible", "condition_set_empty"]);
});

test("AND aggregation gives no_match precedence over ineligible", () => {
  const result = evaluateOfferingMonitorConditions(availableCanonical(), [
    { key: "offering.unknown", operator: "eq", value: 1 },
    amount("gt", 20_000_000),
  ]);
  assert.deepEqual(statusAndReason(result), ["no_match", "condition_not_met"]);
  assert.deepEqual(result.conditions.map((item) => item.status), ["ineligible", "no_match"]);
});

test("pure matcher has no reader, provider, or fallback dependencies", () => {
  const source = readFileSync(new URL("./offeringMonitorMatcher.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /offering_monitor_payload|event_offering_terms|parser terms|ai_runs|Gemini|alert queue|Telegram|Email|notification/i);
  assert.doesNotMatch(source, /offeringMonitorCanonicalPersistence|offeringMonitorHistoricalContract|readOfferingMonitorCanonical|evaluateOfferingMonitorEvent/);
  assert.deepEqual(statusAndReason(evaluateOfferingMonitorConditions(
    { status: "not_ready", reason: "canonical_unavailable" }, [amount("gte", 5_000_000)],
  )), ["ineligible", "canonical_unavailable"]);
});

function availableCanonical(): Extract<OfferingMonitorCanonicalReadResult, { status: "available" }> {
  const canonical: MinimalOfferingMonitor = {
    version: "minimal_offering_monitor_v1",
    applicability: "applicable",
    financing_stage: "registration_only",
    primary_or_resale: "primary",
    security_nature: "equity_linked",
    has_warrant: true,
    has_prefunded_warrant: true,
    has_convertible: false,
    facts: {
      actual_primary_offering_amount: fact(10_000_000, "currency", "USD", "unit_offering", "market_cap", "estimated"),
      offering_price: unavailableFact("currency_per_security", "market_price"),
      immediate_primary_share_exposure: fact(15_713_387, "shares", null, "common_shares", "shares_outstanding", "exact"),
      additional_potential_primary_share_exposure: fact(15_713_387, "shares", null, "common_warrants", "shares_outstanding", "derived"),
      resale_share_exposure: unavailableFact("shares", "public_float"),
    },
  };
  const materialized = materializeMinimalOfferingMonitor(canonical, buildMinimalOfferingMarketSnapshot(null));
  return {
    status: "available",
    eventId: EVENT_ID,
    rawItemId: "efea3384-9eef-4e6b-9e63-60dc1cd3090e",
    parentPrimaryAiRunId: "5e56353f-e700-4c3f-89c1-0d7c6faf851a",
    sourceExecutionId: "42745e3b-7ac8-55af-a362-dec6ee07b96f",
    formFamily: "s1",
    contractVersion: "second_stage_direct_v8",
    schemaVersion: "offering_monitor_second_stage_candidate_v2",
    canonical,
    materialized,
    totalPotentialPrimaryShareExposure: 31_426_774,
    promotedAt: "2026-08-12T00:00:00.000Z",
  };
}

function fact(
  value: number,
  unit: "currency" | "shares",
  currency: string | null,
  securityBasis: string,
  comparisonBasis: "market_cap" | "shares_outstanding",
  quality: MinimalOfferingValueQuality,
) {
  return {
    value,
    availability: "available" as const,
    value_quality: quality,
    bound: "maximum" as const,
    unit,
    currency,
    security_basis: securityBasis,
    comparison_basis_type: comparisonBasis,
    comparable_to_event_market_basis: false,
    source_ref: "ipdn_fixture",
  };
}

function unavailableFact(
  unit: "currency_per_security" | "shares",
  comparisonBasis: "market_price" | "public_float",
) {
  return {
    value: null,
    availability: "unavailable" as const,
    value_quality: "unknown" as const,
    bound: "unknown" as const,
    unit,
    currency: null,
    security_basis: null,
    comparison_basis_type: comparisonBasis,
    comparable_to_event_market_basis: null,
    source_ref: null,
  };
}

function amount(operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte", value: number): OfferingMonitorCondition {
  return { key: "offering.amount", operator, value, currency: "USD" };
}

function total(operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte", value: number): OfferingMonitorCondition {
  return { key: "offering.total_potential_share_exposure", operator, value, comparisonBasisType: "shares_outstanding" };
}

function statusAndReason(value: { status: string; reasonCode: string }) {
  return [value.status, value.reasonCode];
}
