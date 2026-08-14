import {
  getReadyMonitorCondition,
  MONITOR_CONDITION_OPERATOR_DISPLAY_LABELS,
  validateMonitorConditionInput,
  type MonitorConditionDefinition,
  type MonitorConditionOperator,
} from "./conditionRegistry.ts";
import {
  NaturalLanguageConditionCompilerError,
  revalidateNaturalLanguageConditionCompilerResult,
  type NaturalLanguageConditionCompilerResult,
  type NaturalLanguageConditionLedgerCondition,
} from "./naturalLanguageConditionCompiler.ts";

export const NATURAL_LANGUAGE_MONITOR_DRAFT_VERSION = "natural_language_monitor_draft_v1" as const;

export type NaturalLanguageMonitorDraftStatus = "READY_FOR_REVIEW" | "NEEDS_ATTENTION";

export type NaturalLanguageMonitorDraftConditionPreview = Readonly<{
  label: string;
  value: string;
  text: string;
}>;

export type NaturalLanguageMonitorDraft = Readonly<{
  version: typeof NATURAL_LANGUAGE_MONITOR_DRAFT_VERSION;
  draftStatus: NaturalLanguageMonitorDraftStatus;
  compilerStatus: NaturalLanguageConditionCompilerResult["status"];
  conditions: NaturalLanguageConditionCompilerResult["conditions"];
  mapped: readonly Readonly<{
    sourceText: string;
    conditions: readonly NaturalLanguageMonitorDraftConditionPreview[];
  }>[];
  unsupported: readonly Readonly<{
    sourceText: string;
    status: "Unsupported";
    reason: string;
  }>[];
  ambiguous: readonly Readonly<{
    sourceText: string;
    status: "Needs clarification";
    question: string;
  }>[];
  message: string;
}>;

export function buildNaturalLanguageMonitorDraft(
  result: NaturalLanguageConditionCompilerResult,
  originalText: string,
): NaturalLanguageMonitorDraft {
  const finalized = revalidateNaturalLanguageConditionCompilerResult(result, originalText);
  const conditionsById = new Map(finalized.ledger.conditions.map((condition) => [condition.id, condition]));
  const mapped = Object.freeze(finalized.ledger.requirements
    .filter((requirement) => requirement.decision === "mapped")
    .map((requirement) => Object.freeze({
      sourceText: requirement.source_text,
      conditions: Object.freeze(requirement.condition_refs.map((ref) => {
        const condition = conditionsById.get(ref);
        if (!condition) throw draftInvalid(`condition_ref_unknown:${ref}`);
        return formatNaturalLanguageMonitorDraftCondition(condition);
      })),
    })));
  const unsupported = Object.freeze(finalized.ledger.requirements
    .filter((requirement) => requirement.decision === "unsupported")
    .map((requirement) => Object.freeze({
      sourceText: requirement.source_text,
      status: "Unsupported" as const,
      reason: requirement.reason as string,
    })));
  const ambiguous = Object.freeze(finalized.ledger.requirements
    .filter((requirement) => requirement.decision === "ambiguous")
    .map((requirement) => Object.freeze({
      sourceText: requirement.source_text,
      status: "Needs clarification" as const,
      question: requirement.question as string,
    })));
  const draftStatus: NaturalLanguageMonitorDraftStatus = finalized.status === "VALID"
    ? "READY_FOR_REVIEW"
    : "NEEDS_ATTENTION";

  if (draftStatus === "READY_FOR_REVIEW" && (finalized.conditions.length === 0 || mapped.length === 0)) {
    throw draftInvalid("ready_draft_conditions_empty");
  }

  return Object.freeze({
    version: NATURAL_LANGUAGE_MONITOR_DRAFT_VERSION,
    draftStatus,
    compilerStatus: finalized.status,
    conditions: finalized.conditions,
    mapped,
    unsupported,
    ambiguous,
    message: draftStatus === "READY_FOR_REVIEW"
      ? "Review this draft before creating a monitor."
      : "Review the highlighted requirements before creating a monitor.",
  });
}

export function formatNaturalLanguageMonitorDraftCondition(
  condition: NaturalLanguageConditionLedgerCondition,
): NaturalLanguageMonitorDraftConditionPreview {
  const validationErrors = validateMonitorConditionInput(condition);
  const definition = getReadyMonitorCondition(condition.key);
  if (validationErrors.length > 0 || !definition || definition.family !== "listing" || !definition.display) {
    throw draftInvalid(validationErrors[0] ?? `condition_not_displayable:${condition.key}`);
  }
  const value = formatConditionValue(definition, condition.operator, condition.value);
  return Object.freeze({
    label: definition.display.label,
    value,
    text: `${definition.display.label} — ${value}`,
  });
}

function formatConditionValue(
  definition: MonitorConditionDefinition,
  operator: MonitorConditionOperator,
  value: unknown,
) {
  if (operator === "within_days") {
    const days = value as number;
    return `${MONITOR_CONDITION_OPERATOR_DISPLAY_LABELS.within_days} ${days} ${days === 1 ? "day" : "days"}`;
  }
  if (operator === "in" || operator === "not_in") {
    const items = (value as readonly unknown[]).map((item) => formatScalar(definition, item));
    return `${MONITOR_CONDITION_OPERATOR_DISPLAY_LABELS[operator]}: ${items.join(", ")}`;
  }
  const scalar = formatScalar(definition, value);
  if (operator === "eq") return definition.valueType === "date" ? `On ${scalar}` : scalar;
  if (operator === "neq") return definition.valueType === "date"
    ? `Not on ${scalar}`
    : `${MONITOR_CONDITION_OPERATOR_DISPLAY_LABELS.neq} ${scalar}`;
  if (operator === "before" || operator === "after") {
    return `${MONITOR_CONDITION_OPERATOR_DISPLAY_LABELS[operator]} ${scalar}`;
  }
  throw draftInvalid(`operator_not_displayable:${operator}`);
}

function formatScalar(definition: MonitorConditionDefinition, value: unknown) {
  if (definition.enumValues) {
    const label = typeof value === "string" ? definition.display?.enumValueLabels?.[value] : null;
    if (!label) throw draftInvalid(`enum_value_label_missing:${definition.key}`);
    return label;
  }
  if (definition.valueType === "boolean") {
    const label = definition.display?.booleanValueLabels?.[String(value) as "true" | "false"];
    if (!label) throw draftInvalid(`boolean_value_label_missing:${definition.key}`);
    return label;
  }
  if (definition.valueType === "date") return formatDate(value as string);
  if (typeof value === "string" && value.length > 0) return value;
  throw draftInvalid(`condition_value_not_displayable:${definition.key}`);
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const monthLabel = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ][month - 1];
  if (!monthLabel || !year || !day) throw draftInvalid("date_value_not_displayable");
  return `${monthLabel} ${day}, ${year}`;
}

function draftInvalid(detail: string) {
  return new NaturalLanguageConditionCompilerError(
    "CONDITION_COMPILER_OUTPUT_INVALID",
    "Condition Compiler output could not be presented as a monitor draft.",
    502,
    [detail],
  );
}
