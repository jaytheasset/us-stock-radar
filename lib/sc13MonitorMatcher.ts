import { compareExactDecimals } from "./monitor/periodicFinancialMonitor.ts";
import { getReadyMonitorCondition, validateMonitorConditionInput } from "./monitor/conditionRegistry.ts";
import {
  normalizeSc13Cusips,
  normalizeSc13SecurityClass,
  type CanonicalSc13MonitorCondition,
  type Sc13Monitor,
} from "./monitor/sc13MonitorPersistence.ts";
import type { Sc13IssuerCurrentStateRead } from "./sec-sc13-xml/currentState.ts";
import type { Sc13CurrentFieldKey, Sc13StoredPosition } from "./sec-sc13-xml/lineage.ts";
import type { Sc13VerifiedReporterIdentity } from "./sec-sc13-xml/reporterIdentity.ts";

export const SC13_MONITOR_MATCHER_VERSION = "sc13_monitor_matcher_v1" as const;
export type Sc13MonitorMatchStatus = "match" | "no_match" | "ineligible";
export type Sc13MonitorMatchReasonCode =
  | "all_conditions_match" | "condition_not_met" | "condition_set_empty" | "condition_invalid"
  | "condition_key_unknown" | "condition_key_retired" | "condition_operator_unknown" | "condition_value_invalid"
  | "reader_not_ready" | "issuer_identity_mismatch" | "position_identity_mismatch"
  | "position_identity_ambiguous" | "reporter_identity_mismatch" | "reporter_identity_ambiguous"
  | "current_value_unresolved" | "current_provenance_invalid";

export type Sc13MonitorMatchEvidence = Readonly<{
  reportingPersonIdentity?: Sc13VerifiedReporterIdentity;
  scope: "complete_stored_history_not_sec_global";
  meaning: "latest_saved_filing_value_not_realtime_ownership";
  positionKey: string;
  rootAccessionNumber: string;
  headAccessionNumber: string;
  issuerCik: string;
  reportingPersonCik: string;
  reportingPersonNameRaw: string;
  securityClass: string;
  cusips: readonly string[];
  conditions: readonly Readonly<{
    key: string; operator: CanonicalSc13MonitorCondition["operator"]; threshold: string;
    valueRaw: string; sourceAccessionNumber: string;
  }>[];
}>;

export type Sc13MonitorMatchResult = Readonly<{
  version: typeof SC13_MONITOR_MATCHER_VERSION;
  status: Sc13MonitorMatchStatus;
  reasonCode: Sc13MonitorMatchReasonCode;
  readerReason?: string;
  conditions: readonly Readonly<{ key: string; status: Sc13MonitorMatchStatus; reasonCode: Sc13MonitorMatchReasonCode; valueRaw?: string; sourceAccessionNumber?: string }>[];
  evidence?: Sc13MonitorMatchEvidence;
}>;

const FIELD_BY_KEY = Object.freeze({
  "sc13.aggregate_owned": "aggregateAmountOwnedRaw",
  "sc13.percent_of_class": "percentOfClassRaw",
  "sc13.sole_voting": "soleVotingPowerRaw",
  "sc13.shared_voting": "sharedVotingPowerRaw",
  "sc13.sole_dispositive": "soleDispositivePowerRaw",
  "sc13.shared_dispositive": "sharedDispositivePowerRaw",
} satisfies Record<string, Sc13CurrentFieldKey>);

export function evaluateSc13Monitor(
  state: Sc13IssuerCurrentStateRead,
  monitor: Sc13Monitor,
): Sc13MonitorMatchResult {
  if (!monitor.conditions.length) return result("ineligible", "condition_set_empty", []);
  if (state.status !== "available") {
    const reason = state.status === "unavailable" ? state.reason : "issuer_history_empty";
    return result("ineligible", "reader_not_ready", monitor.conditions.map((condition) => conditionResult(condition.key, "ineligible", "reader_not_ready")), reason);
  }
  if (state.issuerCik !== monitor.target.issuerCik) return allIneligible(monitor, "issuer_identity_mismatch");

  const identityPositions = state.lineage.positions.filter((position): position is Extract<Sc13StoredPosition, { status: "available_stored_history" }> =>
    position.status === "available_stored_history"
      && position.issuerCik === monitor.target.issuerCik
      && normalizeSc13SecurityClass(position.securityClassRaw) === monitor.target.securityClass
      && sameStrings(normalizeSc13Cusips(position.cusipsRaw), monitor.target.cusips));
  if (identityPositions.length === 0) return allIneligible(monitor, "position_identity_mismatch");
  const positions = identityPositions.filter((position) =>
    position.currentReporters.some((reporter) => reporter.reportingPersonCik === monitor.target.reportingPersonCik));
  if (positions.length === 0) return allIneligible(monitor, "reporter_identity_mismatch");
  if (positions.length !== 1) return allIneligible(monitor, "position_identity_ambiguous");
  const position = positions[0]!;
  const reporters = position.currentReporters.filter((reporter) => reporter.reportingPersonCik === monitor.target.reportingPersonCik);
  if (reporters.length === 0) return allIneligible(monitor, "reporter_identity_mismatch");
  if (reporters.length !== 1) return allIneligible(monitor, "reporter_identity_ambiguous");
  const reporter = reporters[0]!;
  const evaluated = monitor.conditions.map((condition) => evaluateCondition(condition, position, reporter));
  const noMatch = evaluated.find((item) => item.status === "no_match");
  if (noMatch) return result("no_match", noMatch.reasonCode, evaluated);
  const ineligible = evaluated.find((item) => item.status === "ineligible");
  if (ineligible) return result("ineligible", ineligible.reasonCode, evaluated);
  return {
    ...result("match", "all_conditions_match", evaluated),
    evidence: {
      scope: "complete_stored_history_not_sec_global",
      meaning: "latest_saved_filing_value_not_realtime_ownership",
      positionKey: position.positionKey,
      rootAccessionNumber: position.rootAccessionNumber,
      headAccessionNumber: position.headAccessionNumber,
      issuerCik: position.issuerCik,
      reportingPersonCik: reporter.reportingPersonCik,
      reportingPersonNameRaw: reporter.reportingPersonNameRaw,
      ...(reporter.identityProvenance ? { reportingPersonIdentity: reporter.identityProvenance } : {}),
      securityClass: monitor.target.securityClass,
      cusips: monitor.target.cusips,
      conditions: evaluated.map((item, index) => ({
        key: item.key,
        operator: monitor.conditions[index]!.operator,
        threshold: monitor.conditions[index]!.value,
        valueRaw: item.valueRaw!,
        sourceAccessionNumber: item.sourceAccessionNumber!,
      })),
    },
  };
}

function evaluateCondition(
  condition: CanonicalSc13MonitorCondition,
  position: Extract<Sc13StoredPosition, { status: "available_stored_history" }>,
  reporter: Extract<Sc13StoredPosition, { status: "available_stored_history" }>["currentReporters"][number],
) {
  if (!condition || typeof condition !== "object") return conditionResult("", "ineligible", "condition_invalid");
  const validationError = validateMonitorConditionInput(condition)[0];
  const definition = getReadyMonitorCondition(condition.key);
  const field = FIELD_BY_KEY[condition.key as keyof typeof FIELD_BY_KEY];
  if (validationError || definition?.family !== "sc13" || !field) return conditionResult(condition.key || "", "ineligible", validationError || "condition_key_unknown");
  const current = reporter.values[field];
  if (current.status !== "available") return conditionResult(condition.key, "ineligible", "current_value_unresolved");
  if (reporter.sourceAccessionNumber !== position.headAccessionNumber || current.sourceAccessionNumber !== position.headAccessionNumber || !validActual(condition.key, current.valueRaw)) {
    return conditionResult(condition.key, "ineligible", "current_provenance_invalid");
  }
  let ordering: number;
  try { ordering = compareExactDecimals(current.valueRaw, condition.value); }
  catch { return conditionResult(condition.key, "ineligible", "condition_value_invalid"); }
  const matched = compareOrdering(ordering, condition.operator);
  if (matched === null) return conditionResult(condition.key, "ineligible", "condition_operator_unknown");
  return conditionResult(condition.key, matched ? "match" : "no_match", matched ? "all_conditions_match" : "condition_not_met", current.valueRaw, current.sourceAccessionNumber);
}

function validActual(key: string, value: string) {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return false;
  return key !== "sc13.percent_of_class" || compareExactDecimals(value, "100") <= 0;
}
function compareOrdering(ordering: number, operator: CanonicalSc13MonitorCondition["operator"]) {
  if (operator === "eq") return ordering === 0;
  if (operator === "neq") return ordering !== 0;
  if (operator === "gt") return ordering > 0;
  if (operator === "gte") return ordering >= 0;
  if (operator === "lt") return ordering < 0;
  if (operator === "lte") return ordering <= 0;
  return null;
}
function allIneligible(monitor: Sc13Monitor, reasonCode: Sc13MonitorMatchReasonCode) { return result("ineligible", reasonCode, monitor.conditions.map((condition) => conditionResult(condition.key, "ineligible", reasonCode))); }
function result(status: Sc13MonitorMatchStatus, reasonCode: Sc13MonitorMatchReasonCode, conditions: Sc13MonitorMatchResult["conditions"], readerReason?: string): Sc13MonitorMatchResult { return { version: SC13_MONITOR_MATCHER_VERSION, status, reasonCode, ...(readerReason ? { readerReason } : {}), conditions }; }
function conditionResult(key: string, status: Sc13MonitorMatchStatus, reasonCode: Sc13MonitorMatchReasonCode, valueRaw?: string, sourceAccessionNumber?: string) { return { key, status, reasonCode, ...(valueRaw !== undefined ? { valueRaw } : {}), ...(sourceAccessionNumber ? { sourceAccessionNumber } : {}) }; }
function sameStrings(left: readonly string[] | null, right: readonly string[]) { return Boolean(left && left.length === right.length && left.every((value, index) => value === right[index])); }
