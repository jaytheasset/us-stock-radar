import { compareExactDecimals } from "./monitor/periodicFinancialMonitor.ts";
import {
  getSection16MonitorCondition,
  monitorDateOnlyUtcDay,
  validateSection16MonitorConditionInput,
  type MonitorConditionOperator,
} from "./monitor/conditionRegistry.ts";
import type {
  Section16MonitorFactReadResult,
  Section16MonitorFactRow,
} from "./monitor/section16MonitorFacts.ts";
import type {
  CanonicalSection16MonitorCondition,
  Section16MonitorConditionSet,
} from "./monitor/section16MonitorPersistence.ts";
import type { Section16XmlFieldStatus } from "./sources/sec/forms/section16Xml/parser.ts";

export const SECTION16_MONITOR_MATCHER_VERSION = "section16_monitor_matcher_v1" as const;

export type Section16MonitorMatchStatus = "match" | "no_match" | "ineligible";
export type Section16MonitorMatchReasonCode =
  | "all_conditions_match"
  | "condition_not_met"
  | "condition_set_empty"
  | "condition_invalid"
  | "condition_key_unknown"
  | "condition_operator_unknown"
  | "condition_value_invalid"
  | "row_families_mixed"
  | "reader_not_ready"
  | "filing_not_found"
  | "source_field_missing"
  | "source_field_empty"
  | "source_field_footnote_only"
  | "source_field_invalid"
  | "row_conjunction_not_met";

export type Section16MonitorConditionResult = Readonly<{
  key: string;
  status: Section16MonitorMatchStatus;
  reasonCode: Section16MonitorMatchReasonCode;
  sourceFieldStatus?: Section16XmlFieldStatus | "structural_exact";
}>;

export type Section16MonitorMatchResult = Readonly<{
  version: typeof SECTION16_MONITOR_MATCHER_VERSION;
  status: Section16MonitorMatchStatus;
  reasonCode: Section16MonitorMatchReasonCode;
  readerReason?: string;
  conditions: readonly Section16MonitorConditionResult[];
  evidence?: Readonly<{
    accessionNumber: string;
    formType: string;
    rowFamily: "holding" | "transaction";
    matchedFilingRowCount: number;
    countMeaning: "filing_rows_not_unique_trades";
    matchedRows: readonly Readonly<{ accessionNumber: string; rowOrdinal: number }>[];
    excludedConfirmedDuplicateRowCount: number;
    historyScope: "complete_stored_history_not_sec_global";
  }>;
}>;

export type Section16MonitorMatcherDependencies = Readonly<{
  readFacts?(accessionNumber: string): Promise<Section16MonitorFactReadResult>;
}>;

export async function evaluateSection16MonitorFiling(
  input: Readonly<{
    accessionNumber: string;
    conditionSet: Pick<Section16MonitorConditionSet, "rowFamily" | "conditions">;
  }>,
  dependencies: Section16MonitorMatcherDependencies = {},
): Promise<Section16MonitorMatchResult> {
  let facts: Section16MonitorFactReadResult;
  try {
    const reader = dependencies.readFacts ?? (await import("./monitor/section16MonitorFacts.ts")).readSection16MonitorFacts;
    facts = await reader(input.accessionNumber);
  } catch {
    facts = { status: "not_ready", reason: "reader_unavailable" };
  }
  return evaluateSection16MonitorConditions(facts, input.conditionSet.conditions, input.conditionSet.rowFamily);
}

/** Pure same-row AND evaluation over one validated canonical filing read. */
export function evaluateSection16MonitorConditions(
  current: Section16MonitorFactReadResult,
  conditions: readonly CanonicalSection16MonitorCondition[],
  declaredRowFamily?: "holding" | "transaction",
): Section16MonitorMatchResult {
  if (!Array.isArray(conditions) || conditions.length === 0) {
    return result("ineligible", "condition_set_empty", []);
  }
  const definitions = conditions.map((condition) => getSection16MonitorCondition(condition.key));
  const validationErrors = conditions.map((condition) => validateSection16MonitorConditionInput(condition)[0]);
  const invalidIndex = validationErrors.findIndex(Boolean);
  if (invalidIndex >= 0 || definitions.some((definition) => !definition)) {
    const reason = validationErrors[invalidIndex] ?? "condition_key_unknown";
    return result(
      "ineligible",
      reason,
      conditions.map((condition, index) => conditionResult(
        condition.key,
        "ineligible",
        validationErrors[index] ?? (definitions[index] ? reason : "condition_key_unknown"),
      )),
    );
  }
  const rowFamilies = new Set(definitions.map((definition) => definition!.rowFamily));
  if (rowFamilies.size !== 1 || (declaredRowFamily && !rowFamilies.has(declaredRowFamily))) {
    return result(
      "ineligible",
      "row_families_mixed",
      conditions.map((condition) => conditionResult(condition.key, "ineligible", "row_families_mixed")),
    );
  }
  if (current.status === "not_found") {
    return result(
      "ineligible",
      "filing_not_found",
      conditions.map((condition) => conditionResult(condition.key, "ineligible", "filing_not_found")),
    );
  }
  if (current.status !== "available") {
    return result(
      "ineligible",
      "reader_not_ready",
      conditions.map((condition) => conditionResult(condition.key, "ineligible", "reader_not_ready")),
      current.reason,
    );
  }

  const rowFamily = [...rowFamilies][0]!;
  const rows = current.rows.filter((row) => row.rowFamily === rowFamily);
  if (rows.length === 0) {
    return result(
      "no_match",
      "condition_not_met",
      conditions.map((condition) => conditionResult(condition.key, "no_match", "condition_not_met")),
    );
  }
  const rowEvaluations = rows.map((row) => conditions.map((condition, index) => (
    evaluateRowCondition(row, condition, definitions[index]!)
  )));
  const matchingRows = rows.filter((_, rowIndex) => rowEvaluations[rowIndex]!.every((item) => item.status === "match"));
  if (matchingRows.length > 0) {
    return {
      ...result(
        "match",
        "all_conditions_match",
        conditions.map((condition) => conditionResult(condition.key, "match", "all_conditions_match", "exact")),
      ),
      evidence: Object.freeze({
        accessionNumber: current.accessionNumber,
        formType: current.formType,
        rowFamily,
        matchedFilingRowCount: matchingRows.length,
        countMeaning: "filing_rows_not_unique_trades" as const,
        matchedRows: Object.freeze(matchingRows.map((row) => Object.freeze({
          accessionNumber: row.accessionNumber,
          rowOrdinal: row.rowOrdinal,
        }))),
        excludedConfirmedDuplicateRowCount: current.excludedConfirmedDuplicateRowCount,
        historyScope: "complete_stored_history_not_sec_global" as const,
      }),
    };
  }

  const conditionResults = conditions.map((condition, conditionIndex) => {
    const perRow = rowEvaluations.map((row) => row[conditionIndex]!);
    if (perRow.some((item) => item.status === "match")) {
      return conditionResult(condition.key, "match", "all_conditions_match", "exact");
    }
    return perRow.find((item) => item.status === "ineligible")
      ?? conditionResult(condition.key, "no_match", "condition_not_met");
  });
  const everyRowDefinitelyFails = rowEvaluations.every((row) => row.some((item) => item.status === "no_match"));
  if (everyRowDefinitelyFails) {
    return result(
      "no_match",
      conditions.length > 1 ? "row_conjunction_not_met" : "condition_not_met",
      conditionResults,
    );
  }
  const firstIneligible = rowEvaluations.flat().find((item) => item.status === "ineligible");
  return result("ineligible", firstIneligible?.reasonCode ?? "source_field_invalid", conditionResults);
}

function evaluateRowCondition(
  row: Section16MonitorFactRow,
  condition: CanonicalSection16MonitorCondition,
  definition: NonNullable<ReturnType<typeof getSection16MonitorCondition>>,
): Section16MonitorConditionResult {
  const field = row.fields[definition.field];
  if (typeof field === "string") {
    const matched = compareText(field, condition.operator, condition.value);
    return matched === null
      ? conditionResult(condition.key, "ineligible", "source_field_invalid", "structural_exact")
      : conditionResult(condition.key, matched ? "match" : "no_match", matched ? "all_conditions_match" : "condition_not_met", "structural_exact");
  }
  if (!field || typeof field !== "object" || !("status" in field)) {
    return conditionResult(condition.key, "ineligible", "source_field_invalid");
  }
  if (field.status !== "exact") {
    const reason = field.status === "missing"
      ? "source_field_missing"
      : field.status === "empty"
        ? "source_field_empty"
        : "source_field_footnote_only";
    return conditionResult(condition.key, "ineligible", reason, field.status);
  }
  const actual = field.rawValue;
  if (typeof actual !== "string" || actual.length === 0) {
    return conditionResult(condition.key, "ineligible", "source_field_invalid", field.status);
  }
  let matched: boolean | null;
  if (definition.valueType === "decimal") matched = compareDecimal(actual, condition.operator, condition.value);
  else if (definition.valueType === "date") matched = compareDate(actual, condition.operator, condition.value);
  else matched = compareText(actual, condition.operator, condition.value);
  return matched === null
    ? conditionResult(condition.key, "ineligible", "source_field_invalid", field.status)
    : conditionResult(condition.key, matched ? "match" : "no_match", matched ? "all_conditions_match" : "condition_not_met", field.status);
}

function compareDecimal(actual: string, operator: MonitorConditionOperator, expected: unknown) {
  if (typeof expected !== "string") return null;
  let ordering: number;
  try {
    ordering = compareExactDecimals(actual, expected);
  } catch {
    return null;
  }
  if (operator === "eq") return ordering === 0;
  if (operator === "neq") return ordering !== 0;
  if (operator === "gt") return ordering > 0;
  if (operator === "gte") return ordering >= 0;
  if (operator === "lt") return ordering < 0;
  if (operator === "lte") return ordering <= 0;
  return null;
}

function compareDate(actual: string, operator: MonitorConditionOperator, expected: unknown) {
  const actualDay = monitorDateOnlyUtcDay(actual);
  const expectedDay = monitorDateOnlyUtcDay(expected);
  if (actualDay === null || expectedDay === null) return null;
  if (operator === "eq") return actualDay === expectedDay;
  if (operator === "neq") return actualDay !== expectedDay;
  if (operator === "before") return actualDay < expectedDay;
  if (operator === "after") return actualDay > expectedDay;
  return null;
}

function compareText(actual: string, operator: MonitorConditionOperator, expected: unknown) {
  if (operator === "eq") return typeof expected === "string" ? actual === expected : null;
  if (operator === "neq") return typeof expected === "string" ? actual !== expected : null;
  if (operator === "in") return Array.isArray(expected) && expected.every((value) => typeof value === "string")
    ? expected.includes(actual)
    : null;
  if (operator === "not_in") return Array.isArray(expected) && expected.every((value) => typeof value === "string")
    ? !expected.includes(actual)
    : null;
  return null;
}

function result(
  status: Section16MonitorMatchStatus,
  reasonCode: Section16MonitorMatchReasonCode,
  conditions: readonly Section16MonitorConditionResult[],
  readerReason?: string,
): Section16MonitorMatchResult {
  return { version: SECTION16_MONITOR_MATCHER_VERSION, status, reasonCode, ...(readerReason ? { readerReason } : {}), conditions };
}

function conditionResult(
  key: string,
  status: Section16MonitorMatchStatus,
  reasonCode: Section16MonitorMatchReasonCode,
  sourceFieldStatus?: Section16XmlFieldStatus | "structural_exact",
): Section16MonitorConditionResult {
  return { key, status, reasonCode, ...(sourceFieldStatus ? { sourceFieldStatus } : {}) };
}
