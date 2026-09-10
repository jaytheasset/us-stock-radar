import { getReadyMonitorCondition, validateMonitorConditionInput } from "./monitor/conditionRegistry.ts";
import {
  compareExactDecimals,
  subtractExactDecimals,
  type PeriodicFinancialMonitorComparison,
} from "./monitor/periodicFinancialMonitor.ts";
import type { FinancialMonitorFactReadResult } from "./monitor/financialMonitorFacts.ts";
import type { CanonicalFinancialMonitorCondition } from "./monitor/financialMonitorPersistence.ts";
import { normalizeFilingDecimal } from "./sec-structured-data/periodicFinancialResolver.ts";

export const FINANCIAL_MONITOR_MATCHER_VERSION = "financial_monitor_matcher_v1" as const;
export type FinancialMonitorMatchStatus = "match" | "no_match" | "ineligible";
export type FinancialMonitorMatchReasonCode =
  | "all_conditions_match"
  | "condition_not_met"
  | "condition_set_empty"
  | "condition_invalid"
  | "condition_key_unknown"
  | "condition_operator_unknown"
  | "condition_value_invalid"
  | "reader_not_ready"
  | "event_identity_mismatch"
  | "comparison_unavailable"
  | "current_provenance_invalid"
  | "prior_year_comparison_unavailable"
  | "currency_mismatch"
  | "comparison_identity_mismatch";

export type FinancialMonitorMatchResult = Readonly<{
  version: typeof FINANCIAL_MONITOR_MATCHER_VERSION;
  status: FinancialMonitorMatchStatus;
  reasonCode: FinancialMonitorMatchReasonCode;
  readerReason?: string;
  conditions: readonly Readonly<{ key: string; status: FinancialMonitorMatchStatus; reasonCode: FinancialMonitorMatchReasonCode }>[];
}>;

export function evaluateFinancialMonitorConditions(
  facts: FinancialMonitorFactReadResult,
  conditions: readonly CanonicalFinancialMonitorCondition[],
  expectedEventId?: string,
): FinancialMonitorMatchResult {
  if (!Array.isArray(conditions) || conditions.length === 0) return result("ineligible", "condition_set_empty", []);
  if (facts.status !== "available") return result("ineligible", "reader_not_ready", conditions.map((condition) => conditionResult(condition.key, "ineligible", "reader_not_ready")), facts.reason);
  if (expectedEventId && facts.eventId !== expectedEventId) return result("ineligible", "event_identity_mismatch", conditions.map((condition) => conditionResult(condition.key, "ineligible", "event_identity_mismatch")));

  const evaluated = conditions.map((condition) => evaluateCondition(facts, condition));
  const noMatch = evaluated.find((item) => item.status === "no_match");
  if (noMatch) return result("no_match", noMatch.reasonCode, evaluated);
  const ineligible = evaluated.find((item) => item.status === "ineligible");
  if (ineligible) return result("ineligible", ineligible.reasonCode, evaluated);
  return result("match", "all_conditions_match", evaluated);
}

function evaluateCondition(
  facts: Extract<FinancialMonitorFactReadResult, { status: "available" }>,
  condition: CanonicalFinancialMonitorCondition,
) {
  if (!condition || typeof condition !== "object") return conditionResult("", "ineligible", "condition_invalid");
  const validationError = validateMonitorConditionInput(condition)[0];
  if (validationError) return conditionResult(condition.key || "", "ineligible", validationError);
  const definition = getReadyMonitorCondition(condition.key);
  if (definition?.family !== "financial" || !definition.monitorDomains?.includes("financial")) {
    return conditionResult(condition.key, "ineligible", "condition_key_unknown");
  }
  const identity = parseKey(condition.key);
  if (!identity) return conditionResult(condition.key, "ineligible", "condition_key_unknown");
  const comparison = facts.analysis.comparisons.find((row) => row.metric === identity.metric && row.basis === identity.basis);
  if (!comparison) return conditionResult(condition.key, "ineligible", "comparison_unavailable");
  if (!validEvidence(comparison, comparison.current, facts)) {
    return conditionResult(condition.key, "ineligible", "current_provenance_invalid");
  }
  if (comparison.current.currency !== condition.currency) {
    return conditionResult(condition.key, "ineligible", "currency_mismatch");
  }

  let actual = comparison.current.normalizedValue;
  if (identity.value === "yoy_change") {
    if (
      comparison.change.status !== "AVAILABLE"
      || !comparison.priorYear
    ) return conditionResult(condition.key, "ineligible", "prior_year_comparison_unavailable");
    if (
      comparison.priorYear.currency !== condition.currency
      || comparison.priorYear.currency !== comparison.current.currency
    ) return conditionResult(condition.key, "ineligible", "currency_mismatch");
    if (!likeForLike(comparison)) return conditionResult(condition.key, "ineligible", "comparison_identity_mismatch");
    if (!validEvidence(comparison, comparison.priorYear, facts)) {
      return conditionResult(condition.key, "ineligible", "prior_year_comparison_unavailable");
    }
    if (subtractExactDecimals(
      comparison.current.normalizedValue,
      comparison.priorYear.normalizedValue,
    ) !== comparison.change.absoluteChange) {
      return conditionResult(condition.key, "ineligible", "comparison_identity_mismatch");
    }
    actual = comparison.change.absoluteChange;
  }

  let ordering: number;
  try { ordering = compareExactDecimals(actual, condition.value); }
  catch { return conditionResult(condition.key, "ineligible", "condition_value_invalid"); }
  const matched = compareOrdering(ordering, condition.operator);
  if (matched === null) return conditionResult(condition.key, "ineligible", "condition_operator_unknown");
  return conditionResult(condition.key, matched ? "match" : "no_match", matched ? "all_conditions_match" : "condition_not_met");
}

function validEvidence(
  comparison: PeriodicFinancialMonitorComparison,
  evidence: PeriodicFinancialMonitorComparison["current"],
  facts: Extract<FinancialMonitorFactReadResult, { status: "available" }>,
) {
  return evidence.metric === comparison.metric
    && evidence.basis === comparison.basis
    && evidence.accession === facts.accession
    && evidence.form === facts.form
    && exactDecimal(evidence.normalizedValue)
    && /^[A-Z]{3}$/.test(evidence.currency)
    && evidence.filingFacts.length > 0
    && evidence.companyFacts.length > 0
    && evidence.filingFacts.every((fact) => fact.source.issuerCik === facts.issuerCik
      && fact.source.accession === facts.accession
      && fact.source.artifactId.length > 0
      && fact.source.sourceUrl.length > 0
      && /^[a-f0-9]{64}$/i.test(fact.source.contentHash)
      && fact.concept.localName === evidence.concept
      && fact.concept.namespaceUri === evidence.conceptNamespaceUri
      && fact.unit?.kind === "measure"
      && fact.unit.measure.localName === evidence.currency
      && samePeriod(fact.context.period, evidence.period)
      && fact.context.entityIdentifier.replace(/\D/g, "").padStart(10, "0") === facts.issuerCik
      && normalizeFilingDecimal(fact) === evidence.normalizedValue)
    && evidence.companyFacts.every((fact) => fact.issuerCik === facts.issuerCik
      && fact.filingAccession === facts.accession
      && fact.form === facts.form
      && fact.taxonomy === evidence.taxonomy
      && fact.concept === evidence.concept
      && fact.unit === evidence.currency
      && fact.valueNumeric === evidence.normalizedValue
      && companyFactPeriodMatches(fact, evidence.period)
      && fact.sourceFactKey.length > 0
      && fact.sourceFactPath.length > 0
      && fact.sourceRawId.length > 0);
}

function likeForLike(row: PeriodicFinancialMonitorComparison) {
  const prior = row.priorYear!;
  const current = row.current;
  return current.metric === prior.metric
    && current.basis === prior.basis
    && current.currency === prior.currency
    && current.taxonomy === prior.taxonomy
    && current.concept === prior.concept
    && current.conceptNamespaceUri === prior.conceptNamespaceUri
    && current.financialScope === prior.financialScope
    && isPriorYearPeriod(current.period, prior.period);
}

function samePeriod(left: PeriodicFinancialMonitorComparison["current"]["period"], right: PeriodicFinancialMonitorComparison["current"]["period"]) {
  return left.kind === right.kind && (left.kind === "instant"
    ? left.instant === (right.kind === "instant" ? right.instant : "")
    : left.startDate === (right.kind === "duration" ? right.startDate : "")
      && left.endDate === (right.kind === "duration" ? right.endDate : ""));
}

function companyFactPeriodMatches(
  fact: PeriodicFinancialMonitorComparison["current"]["companyFacts"][number],
  period: PeriodicFinancialMonitorComparison["current"]["period"],
) {
  return period.kind === "instant"
    ? fact.instantDate === period.instant && fact.startDate === null && fact.endDate === null
    : fact.instantDate === null && fact.startDate === period.startDate && fact.endDate === period.endDate;
}

function isPriorYearPeriod(
  current: PeriodicFinancialMonitorComparison["current"]["period"],
  prior: PeriodicFinancialMonitorComparison["current"]["period"],
) {
  if (current.kind !== prior.kind) return false;
  if (current.kind === "instant" && prior.kind === "instant") return priorYearDayDistance(current.instant, prior.instant);
  if (current.kind === "duration" && prior.kind === "duration") {
    const currentDays = inclusiveDays(current.startDate, current.endDate);
    const priorDays = inclusiveDays(prior.startDate, prior.endDate);
    return priorYearDayDistance(current.endDate, prior.endDate)
      && currentDays !== null
      && priorDays !== null
      && Math.abs(currentDays - priorDays) <= 7;
  }
  return false;
}

function priorYearDayDistance(current: string, prior: string) {
  const currentDay = Date.parse(`${current}T00:00:00Z`);
  const priorDay = Date.parse(`${prior}T00:00:00Z`);
  if (!Number.isFinite(currentDay) || !Number.isFinite(priorDay)) return false;
  const elapsedDays = (currentDay - priorDay) / 86_400_000;
  return elapsedDays >= 350 && elapsedDays <= 380;
}

function inclusiveDays(start: string, end: string) {
  const startDay = Date.parse(`${start}T00:00:00Z`);
  const endDay = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(startDay) || !Number.isFinite(endDay) || endDay < startDay) return null;
  return ((endDay - startDay) / 86_400_000) + 1;
}

function parseKey(key: string) {
  const match = key.match(/^financial\.(revenue|operating_income_loss|net_income_loss|operating_cash_flow|cash)\.(quarter|year_to_date|annual|instant)\.(current|yoy_change)$/);
  if (!match) return null;
  return {
    metric: ({ revenue: "REVENUE", operating_income_loss: "OPERATING_INCOME_LOSS", net_income_loss: "NET_INCOME_LOSS", operating_cash_flow: "OPERATING_CASH_FLOW", cash: "CASH" } as const)[match[1] as "revenue"],
    basis: ({ quarter: "QUARTER", year_to_date: "YEAR_TO_DATE", annual: "ANNUAL", instant: "INSTANT" } as const)[match[2] as "quarter"],
    value: match[3] as "current" | "yoy_change",
  };
}

function compareOrdering(ordering: number, operator: CanonicalFinancialMonitorCondition["operator"]) {
  if (operator === "eq") return ordering === 0;
  if (operator === "neq") return ordering !== 0;
  if (operator === "gt") return ordering > 0;
  if (operator === "gte") return ordering >= 0;
  if (operator === "lt") return ordering < 0;
  if (operator === "lte") return ordering <= 0;
  return null;
}
function result(status: FinancialMonitorMatchStatus, reasonCode: FinancialMonitorMatchReasonCode, conditions: FinancialMonitorMatchResult["conditions"], readerReason?: string): FinancialMonitorMatchResult {
  return { version: FINANCIAL_MONITOR_MATCHER_VERSION, status, reasonCode, ...(readerReason ? { readerReason } : {}), conditions };
}
function conditionResult(key: string, status: FinancialMonitorMatchStatus, reasonCode: FinancialMonitorMatchReasonCode) { return { key, status, reasonCode }; }
function exactDecimal(value: unknown): value is string { return typeof value === "string" && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value); }
