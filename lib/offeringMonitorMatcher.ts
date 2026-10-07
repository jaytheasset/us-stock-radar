import {
  MONITOR_COMPARISON_ELIGIBLE_QUALITIES,
  getReadyMonitorCondition,
  type MonitorConditionOperator,
} from "./monitor/conditionRegistry.ts";
import type {
  MinimalOfferingMaterialized,
  MinimalOfferingMonitor,
  MinimalOfferingNumericFact,
} from "./minimalOfferingMonitor.ts";

export const OFFERING_MONITOR_MATCHER_VERSION = "offering_monitor_matcher_v1" as const;

export type OfferingMonitorMatchStatus = "match" | "no_match" | "ineligible";

export type OfferingMonitorMatchReasonCode =
  | "all_conditions_match"
  | "condition_not_met"
  | "canonical_not_ready"
  | "canonical_unavailable"
  | "canonical_not_applicable"
  | "condition_set_empty"
  | "condition_invalid"
  | "condition_key_unknown"
  | "condition_operator_unknown"
  | "condition_value_invalid"
  | "fact_unavailable"
  | "fact_value_invalid"
  | "fact_quality_unknown"
  | "fact_unit_incompatible"
  | "currency_required"
  | "currency_incompatible"
  | "basis_incompatible"
  | "side_unknown";

export type OfferingMonitorCondition = Readonly<{
  key: unknown;
  operator: unknown;
  value: unknown;
  currency?: unknown;
  comparisonBasisType?: unknown;
}>;

export type OfferingMonitorConditionResult = Readonly<{
  key: string;
  status: OfferingMonitorMatchStatus;
  reasonCode: OfferingMonitorMatchReasonCode;
}>;

export type OfferingMonitorMatchResult = Readonly<{
  version: typeof OFFERING_MONITOR_MATCHER_VERSION;
  status: OfferingMonitorMatchStatus;
  reasonCode: OfferingMonitorMatchReasonCode;
  canonicalReason?: string;
  conditions: readonly OfferingMonitorConditionResult[];
}>;

export type OfferingMonitorConditionSet = Readonly<{
  id: string;
  conditions: readonly OfferingMonitorCondition[];
}>;

/**
 * The matcher consumes facts, not the persistence lineage that produced them.
 * The exact-event Registry adapter implements this deliberately small boundary.
 */
export type OfferingMonitorFactReadResult =
  | Readonly<{
      status: "available";
      canonical: MinimalOfferingMonitor;
      materialized: MinimalOfferingMaterialized;
    }>
  | Readonly<{ status: "not_ready"; reason: string }>;

export type OfferingMonitorEventMatchResult = Readonly<{
  version: typeof OFFERING_MONITOR_MATCHER_VERSION;
  eventId: string;
  evaluations: readonly Readonly<{ id: string; result: OfferingMonitorMatchResult }>[];
}>;

const NUMERIC_FACTS = Object.freeze({
  "offering.amount": {
    factKey: "actual_primary_offering_amount",
    unit: "currency",
    basis: "market_cap",
    currencyRequired: true,
  },
  "offering.offering_price": {
    factKey: "offering_price",
    unit: "currency_per_security",
    basis: "market_price",
    currencyRequired: true,
  },
  "offering.immediate_primary_share_exposure": {
    factKey: "immediate_primary_share_exposure",
    unit: "shares",
    basis: "shares_outstanding",
    currencyRequired: false,
  },
  "offering.additional_potential_primary_share_exposure": {
    factKey: "additional_potential_primary_share_exposure",
    unit: "shares",
    basis: "shares_outstanding",
    currencyRequired: false,
  },
  "offering.resale_share_exposure": {
    factKey: "resale_share_exposure",
    unit: "shares",
    basis: "public_float",
    currencyRequired: false,
  },
  "offering.total_potential_share_exposure": {
    factKey: "total_potential_primary_share_exposure",
    unit: "shares",
    basis: "shares_outstanding",
    currencyRequired: false,
  },
} as const);

const NUMERIC_OPERATORS = new Set<MonitorConditionOperator>(["eq", "neq", "gt", "gte", "lt", "lte"]);
const SIDE_VALUES = new Set(["primary", "resale", "mixed"]);

/** Pure, deterministic AND evaluation over one already-read canonical result. */
export function evaluateOfferingMonitorConditions(
  canonical: OfferingMonitorFactReadResult,
  conditions: readonly OfferingMonitorCondition[],
): OfferingMonitorMatchResult {
  if (canonical.status !== "available") {
    const reasonCode = canonical.reason === "canonical_unavailable" ? "canonical_unavailable" : "canonical_not_ready";
    return result("ineligible", reasonCode, [], canonical.reason);
  }
  if (canonical.canonical.applicability !== "applicable") {
    return result("ineligible", "canonical_not_applicable", []);
  }
  if (!Array.isArray(conditions) || conditions.length === 0) {
    return result("ineligible", "condition_set_empty", []);
  }

  const evaluated = conditions.map((condition) => evaluateCondition(canonical, condition));
  const firstNoMatch = evaluated.find((item) => item.status === "no_match");
  if (firstNoMatch) return result("no_match", firstNoMatch.reasonCode, evaluated);
  const firstIneligible = evaluated.find((item) => item.status === "ineligible");
  if (firstIneligible) return result("ineligible", firstIneligible.reasonCode, evaluated);
  return result("match", "all_conditions_match", evaluated);
}

function evaluateCondition(
  canonical: Extract<OfferingMonitorFactReadResult, { status: "available" }>,
  input: OfferingMonitorCondition,
): OfferingMonitorConditionResult {
  if (!recordValue(input)) return conditionResult("", "ineligible", "condition_invalid");
  const key = stringValue(input.key);
  const operator = stringValue(input.operator);
  if (!key) return conditionResult("", "ineligible", "condition_invalid");

  const registryEntry = getReadyMonitorCondition(key);
  if (!registryEntry || registryEntry.family !== "offering") {
    return conditionResult(key, "ineligible", "condition_key_unknown");
  }
  if (!operator || !registryEntry.allowedOperators.includes(operator as MonitorConditionOperator)) {
    return conditionResult(key, "ineligible", "condition_operator_unknown");
  }

  if (key === "offering.side") {
    return evaluateSideCondition(key, operator, input.value, canonical.canonical.primary_or_resale);
  }

  const definition = NUMERIC_FACTS[key as keyof typeof NUMERIC_FACTS];
  if (!definition) return conditionResult(key, "ineligible", "condition_key_unknown");
  if (!NUMERIC_OPERATORS.has(operator as MonitorConditionOperator)) {
    return conditionResult(key, "ineligible", "condition_operator_unknown");
  }
  if (typeof input.value !== "number" || !Number.isFinite(input.value)) {
    return conditionResult(key, "ineligible", "condition_value_invalid");
  }

  const fact = definition.factKey === "total_potential_primary_share_exposure"
    ? canonical.materialized.total_potential_primary_share_exposure
    : canonical.canonical.facts[definition.factKey];
  const eligibility = numericEligibility(fact, definition, input);
  if (eligibility) return conditionResult(key, "ineligible", eligibility);
  const matched = compareNumbers(fact.value as number, operator as MonitorConditionOperator, input.value);
  return conditionResult(key, matched ? "match" : "no_match", matched ? "all_conditions_match" : "condition_not_met");
}

function evaluateSideCondition(
  key: string,
  operator: string,
  expected: unknown,
  actual: string,
): OfferingMonitorConditionResult {
  if (!SIDE_VALUES.has(actual)) return conditionResult(key, "ineligible", "side_unknown");
  if (operator === "eq") {
    if (typeof expected !== "string" || !SIDE_VALUES.has(expected)) {
      return conditionResult(key, "ineligible", "condition_value_invalid");
    }
    return conditionResult(key, actual === expected ? "match" : "no_match", actual === expected ? "all_conditions_match" : "condition_not_met");
  }
  if (operator === "in") {
    if (!Array.isArray(expected) || expected.length === 0 || expected.some((value) => typeof value !== "string" || !SIDE_VALUES.has(value))) {
      return conditionResult(key, "ineligible", "condition_value_invalid");
    }
    const matched = expected.includes(actual);
    return conditionResult(key, matched ? "match" : "no_match", matched ? "all_conditions_match" : "condition_not_met");
  }
  return conditionResult(key, "ineligible", "condition_operator_unknown");
}

function numericEligibility(
  fact: MinimalOfferingNumericFact,
  definition: (typeof NUMERIC_FACTS)[keyof typeof NUMERIC_FACTS],
  condition: OfferingMonitorCondition,
): OfferingMonitorMatchReasonCode | null {
  if (!fact || fact.availability !== "available" || fact.value === null) return "fact_unavailable";
  if (typeof fact.value !== "number" || !Number.isFinite(fact.value) || fact.value < 0) return "fact_value_invalid";
  if (!MONITOR_COMPARISON_ELIGIBLE_QUALITIES.includes(fact.value_quality as never)) return "fact_quality_unknown";
  if (fact.unit !== definition.unit) return "fact_unit_incompatible";
  if (fact.comparison_basis_type !== definition.basis) return "basis_incompatible";

  const requestedBasis = optionalString(condition.comparisonBasisType);
  if (condition.comparisonBasisType !== undefined && !requestedBasis) return "condition_value_invalid";
  if (requestedBasis && requestedBasis !== fact.comparison_basis_type) return "basis_incompatible";

  if (definition.currencyRequired) {
    const requestedCurrency = optionalString(condition.currency);
    if (!requestedCurrency) return "currency_required";
    if (!fact.currency || normalizeToken(fact.currency) !== normalizeToken(requestedCurrency)) return "currency_incompatible";
  } else if (condition.currency !== undefined) {
    return "condition_value_invalid";
  }
  return null;
}

function compareNumbers(actual: number, operator: MonitorConditionOperator, expected: number) {
  if (operator === "eq") return actual === expected;
  if (operator === "neq") return actual !== expected;
  if (operator === "gt") return actual > expected;
  if (operator === "gte") return actual >= expected;
  if (operator === "lt") return actual < expected;
  if (operator === "lte") return actual <= expected;
  return false;
}

function result(
  status: OfferingMonitorMatchStatus,
  reasonCode: OfferingMonitorMatchReasonCode,
  conditions: readonly OfferingMonitorConditionResult[],
  canonicalReason?: string,
): OfferingMonitorMatchResult {
  return {
    version: OFFERING_MONITOR_MATCHER_VERSION,
    status,
    reasonCode,
    ...(canonicalReason ? { canonicalReason } : {}),
    conditions,
  };
}

function conditionResult(
  key: string,
  status: OfferingMonitorMatchStatus,
  reasonCode: OfferingMonitorMatchReasonCode,
): OfferingMonitorConditionResult {
  return { key, status, reasonCode };
}

function recordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalString(value: unknown) {
  return value === undefined ? "" : stringValue(value);
}

function normalizeToken(value: string) {
  return value.trim().toUpperCase();
}
