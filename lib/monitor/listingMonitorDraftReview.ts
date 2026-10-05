import {
  getReadyMonitorCondition,
  getReadyMonitorConditions,
  MONITOR_CONDITION_OPERATOR_DISPLAY_LABELS,
  validateMonitorConditionInput,
  type MonitorConditionDefinition,
  type MonitorConditionOperator,
  type MonitorConditionValueType,
} from "./conditionRegistry.ts";
import type { CanonicalListingMonitorCondition } from "./listingMonitorPersistence.ts";
import {
  getListingMonitorConfirmationCatalog,
  type ListingMonitorConfirmationChoice,
  type ListingMonitorProposedConditionPreview,
} from "./listingMonitorConfirmation.ts";

export const LISTING_MONITOR_DRAFT_REVIEW_VERSION = "listing_monitor_draft_review_v1" as const;

export type ListingMonitorDraftReviewIssue = Readonly<{
  id: string;
  kind: "unsupported" | "ambiguous";
  sourceText: string;
  detail: string;
  abandoned: boolean;
}>;

export type ListingMonitorDraftReview = Readonly<{
  version: typeof LISTING_MONITOR_DRAFT_REVIEW_VERSION;
  conditions: readonly CanonicalListingMonitorCondition[];
  issues: readonly ListingMonitorDraftReviewIssue[];
  proposals: readonly Readonly<{
    id: string;
    preview: ListingMonitorProposedConditionPreview;
    choices: readonly ListingMonitorConfirmationChoice[];
  }>[];
}>;

export type ListingMonitorConditionEditorCatalogItem = Readonly<{
  key: string;
  label: string;
  valueType: Extract<MonitorConditionValueType, "text" | "boolean" | "date" | "number">;
  exclusiveMinimum?: number;
  operators: readonly Readonly<{ value: MonitorConditionOperator; label: string }>[];
  values: readonly Readonly<{ value: string; label: string }>[];
}>;

export type ListingMonitorDraftCreateGate = Readonly<{
  ready: boolean;
  errors: readonly string[];
  conditions: readonly CanonicalListingMonitorCondition[];
}>;

export type ListingMonitorConditionPreview = Readonly<{
  label: string;
  value: string;
  text: string;
}>;

const LISTING_EDITOR_CATALOG = Object.freeze(
  getReadyMonitorConditions()
    .filter((definition) => definition.monitorDomains?.includes("listing"))
    .map(toEditorCatalogItem),
);

export function getListingMonitorConditionEditorCatalog() {
  return LISTING_EDITOR_CATALOG;
}

export function createListingMonitorDraftReview(value: unknown): ListingMonitorDraftReview {
  if (!record(value) || value.version !== "natural_language_monitor_draft_v1") {
    throw new Error("Monitor draft response is invalid.");
  }
  if (
    !Array.isArray(value.conditions)
    || !Array.isArray(value.unsupported)
    || !Array.isArray(value.ambiguous)
    || !Array.isArray(value.proposed)
  ) {
    throw new Error("Monitor draft response is incomplete.");
  }

  const conditions = Object.freeze(value.conditions.map((condition, index) => {
    if (!isCanonicalConditionShape(condition)) {
      throw new Error(`Monitor draft condition ${index + 1} is malformed.`);
    }
    return cloneCondition(condition);
  }));
  const draftStatus = value.draftStatus;
  const validation = validateListingConditionSet(conditions, draftStatus === "READY_FOR_REVIEW");
  if (
    (
      draftStatus !== "READY_FOR_REVIEW"
      && draftStatus !== "NEEDS_CONFIRMATION"
      && draftStatus !== "NEEDS_ATTENTION"
    )
    || (draftStatus === "READY_FOR_REVIEW" && !validation.valid)
  ) {
    throw new Error("Monitor draft readiness is invalid.");
  }

  const issues = Object.freeze([
    ...value.unsupported.map((item, index) => readIssue(item, "unsupported", index)),
    ...value.ambiguous.map((item, index) => readIssue(item, "ambiguous", index)),
  ]);
  const proposals = Object.freeze(value.proposed
    .map((item, index) => readProposal(item, index))
    .filter((item) => item.state === "pending")
    .map(({ id, preview, choices }) => Object.freeze({ id, preview, choices })));
  if (
    value.unresolvedCount !== proposals.length
    || (draftStatus === "NEEDS_CONFIRMATION") !== (proposals.length > 0 && issues.length === 0)
    || (draftStatus === "READY_FOR_REVIEW" && (issues.length > 0 || proposals.length > 0))
  ) {
    throw new Error("Monitor draft confirmation status is invalid.");
  }

  return Object.freeze({
    version: LISTING_MONITOR_DRAFT_REVIEW_VERSION,
    conditions,
    issues,
    proposals,
  });
}

export function replaceListingMonitorDraftCondition(
  review: ListingMonitorDraftReview,
  index: number,
  condition: CanonicalListingMonitorCondition,
): ListingMonitorDraftReview {
  if (!Number.isInteger(index) || index < 0 || index >= review.conditions.length) return review;
  const conditions = review.conditions.map((item, itemIndex) => (
    itemIndex === index ? cloneCondition(condition) : item
  ));
  return Object.freeze({ ...review, conditions: Object.freeze(conditions) });
}

export function removeListingMonitorDraftCondition(
  review: ListingMonitorDraftReview,
  index: number,
): ListingMonitorDraftReview {
  if (!Number.isInteger(index) || index < 0 || index >= review.conditions.length) return review;
  return Object.freeze({
    ...review,
    conditions: Object.freeze(review.conditions.filter((_, itemIndex) => itemIndex !== index)),
  });
}

export function addListingMonitorDraftCondition(
  review: ListingMonitorDraftReview,
  condition: CanonicalListingMonitorCondition,
): ListingMonitorDraftReview {
  if (review.conditions.some((current) => current.key === condition.key)) return review;
  const validation = validateListingConditionSet([...review.conditions, cloneCondition(condition)], true);
  if (!validation.valid) return review;
  return Object.freeze({ ...review, conditions: validation.conditions });
}

export function setListingMonitorDraftIssueAbandoned(
  review: ListingMonitorDraftReview,
  issueId: string,
  abandoned: boolean,
): ListingMonitorDraftReview {
  return Object.freeze({
    ...review,
    issues: Object.freeze(review.issues.map((issue) => (
      issue.id === issueId ? Object.freeze({ ...issue, abandoned }) : issue
    ))),
  });
}

export function getListingMonitorDraftCreateGate(
  review: ListingMonitorDraftReview,
): ListingMonitorDraftCreateGate {
  const validation = validateListingConditionSet(review.conditions, true);
  const unresolved = review.issues.filter((issue) => !issue.abandoned);
  const errors = [
    ...validation.errors,
    ...(unresolved.length > 0 ? ["requirements_unresolved"] : []),
    ...(review.proposals.length > 0 ? ["confirmations_unresolved"] : []),
  ];
  return Object.freeze({
    ready: errors.length === 0,
    errors: Object.freeze(errors),
    conditions: validation.valid ? validation.conditions : Object.freeze([]),
  });
}

export function formatListingMonitorConditionPreview(
  condition: CanonicalListingMonitorCondition,
): ListingMonitorConditionPreview {
  const definition = getListingDefinition(condition.key);
  if (!definition || validateMonitorConditionInput(condition).length > 0) {
    return Object.freeze({ label: "Condition", value: "Choose a valid value", text: "Condition — Choose a valid value" });
  }
  const value = formatConditionValue(definition, condition.operator, condition.value);
  return Object.freeze({
    label: definition.display!.label,
    value,
    text: `${definition.display!.label} — ${value}`,
  });
}

export type ListingMonitorConditionDomain =
  | "market"
  | "corporate-actions"
  | "listing-risk"
  | "proxy";

export type ListingMonitorConditionDomainGroup = Readonly<{
  id: ListingMonitorConditionDomain;
  title: "Market" | "Corporate Actions" | "Listing Risk" | "Proxy";
  items: readonly Readonly<{
    condition: CanonicalListingMonitorCondition;
    index: number;
  }>[];
}>;

const CONDITION_DOMAIN_DEFINITIONS: readonly Readonly<{
  id: ListingMonitorConditionDomain;
  title: ListingMonitorConditionDomainGroup["title"];
  matches: (condition: CanonicalListingMonitorCondition) => boolean;
}>[] = [
  {
    id: "market",
    title: "Market",
    matches: (condition) => condition.key === "market.price",
  },
  {
    id: "corporate-actions",
    title: "Corporate Actions",
    matches: (condition) => condition.key.startsWith("corporate_action."),
  },
  {
    id: "listing-risk",
    title: "Listing Risk",
    matches: (condition) => condition.key.startsWith("listing."),
  },
  { id: "proxy", title: "Proxy", matches: condition => condition.key.startsWith("proxy.") },
];

export function groupListingMonitorConditionsByDomain(
  conditions: readonly CanonicalListingMonitorCondition[],
): readonly ListingMonitorConditionDomainGroup[] {
  return CONDITION_DOMAIN_DEFINITIONS.flatMap((definition) => {
    const items = conditions.flatMap((condition, index) =>
      definition.matches(condition) ? [{ condition, index }] : [],
    );

    return items.length > 0
      ? [{ id: definition.id, title: definition.title, items }]
      : [];
  });
}

export function changeListingMonitorDraftConditionKey(
  current: CanonicalListingMonitorCondition,
  key: string,
): CanonicalListingMonitorCondition {
  const definition = getListingDefinition(key);
  if (!definition) return current;
  if (current.key === key) return current;
  const operator = definition.allowedOperators[0];
  return cloneCondition({ key, operator, value: defaultValue(definition, operator) });
}

export function changeListingMonitorDraftConditionOperator(
  current: CanonicalListingMonitorCondition,
  operator: MonitorConditionOperator,
): CanonicalListingMonitorCondition {
  const definition = getListingDefinition(current.key);
  if (!definition?.allowedOperators.includes(operator)) return current;
  let value = current.value;
  if (operator === "in" || operator === "not_in") {
    value = Array.isArray(value) ? [...value] : [value];
  } else if (Array.isArray(value)) {
    value = value[0] ?? "";
  }
  if (validateMonitorConditionInput({ key: current.key, operator, value }).length > 0) {
    value = defaultValue(definition, operator);
  }
  return cloneCondition({ key: current.key, operator, value });
}

function toEditorCatalogItem(definition: MonitorConditionDefinition): ListingMonitorConditionEditorCatalogItem {
  if (!definition.display || !isListingValueType(definition.valueType)) {
    throw new Error(`Listing condition ${definition.key} lacks editor metadata.`);
  }
  const values = definition.enumValues
    ? definition.enumValues
        .filter((value) => !definition.eligibility?.ineligibleValues?.includes(value))
        .map((value) => ({ value, label: definition.display!.enumValueLabels?.[value] ?? "" }))
    : definition.valueType === "boolean"
      ? [
          { value: "true", label: definition.display.booleanValueLabels?.true ?? "" },
          { value: "false", label: definition.display.booleanValueLabels?.false ?? "" },
        ]
      : [];
  if (values.some((item) => !item.label)) {
    throw new Error(`Listing condition ${definition.key} lacks value display metadata.`);
  }
  return Object.freeze({
    key: definition.key,
    label: definition.display.label,
    valueType: definition.valueType,
    ...(definition.numberValidation?.exclusiveMinimum !== undefined
      ? { exclusiveMinimum: definition.numberValidation.exclusiveMinimum }
      : {}),
    operators: Object.freeze(definition.allowedOperators.map((operator) => Object.freeze({
      value: operator,
      label: MONITOR_CONDITION_OPERATOR_DISPLAY_LABELS[operator],
    }))),
    values: Object.freeze(values.map((item) => Object.freeze(item))),
  });
}

function validateListingConditionSet(
  value: readonly CanonicalListingMonitorCondition[],
  requireNonempty: boolean,
) {
  const errors: string[] = [];
  const conditions: CanonicalListingMonitorCondition[] = [];
  if (requireNonempty && value.length === 0) errors.push("condition_set_empty");
  value.forEach((condition, index) => {
    if (!isCanonicalConditionShape(condition)) {
      errors.push(`conditions[${index}]:condition_invalid`);
      return;
    }
    const definition = getListingDefinition(condition.key);
    const validationError = validateMonitorConditionInput(condition)[0];
    if (!definition || validationError) {
      errors.push(`conditions[${index}]:${validationError ?? "condition_key_unknown"}`);
      return;
    }
    conditions.push(cloneCondition(condition));
  });
  if (findEqContradictions(conditions).length > 0) errors.push("conditions_contradictory");
  return {
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    conditions: errors.length === 0 ? Object.freeze(conditions) : Object.freeze([]),
  };
}

function findEqContradictions(conditions: readonly CanonicalListingMonitorCondition[]) {
  const values = new Map<string, Set<string>>();
  for (const condition of conditions) {
    if (condition.operator !== "eq") continue;
    const entries = values.get(condition.key) ?? new Set<string>();
    entries.add(JSON.stringify(condition.value));
    values.set(condition.key, entries);
  }
  return [...values.values()].filter((entries) => entries.size > 1);
}

function readIssue(value: unknown, kind: ListingMonitorDraftReviewIssue["kind"], index: number) {
  if (!record(value)) throw new Error("Monitor draft issue is malformed.");
  const sourceText = readText(value.sourceText);
  const detail = readText(kind === "unsupported" ? value.reason : value.question);
  const expectedStatus = kind === "unsupported" ? "Unsupported" : "Needs clarification";
  if (!sourceText || !detail || value.status !== expectedStatus) {
    throw new Error("Monitor draft issue is malformed.");
  }
  return Object.freeze({
    id: `${kind}-${index + 1}`,
    kind,
    sourceText,
    detail,
    abandoned: false,
  });
}

function readProposal(value: unknown, index: number) {
  if (!record(value) || !record(value.condition)) throw new Error("Monitor draft proposal is malformed.");
  const id = readText(value.id);
  const condition = isCanonicalConditionShape(value.condition) ? cloneCondition(value.condition) : null;
  const catalog = condition ? getListingMonitorConfirmationCatalog(condition) : null;
  if (
    !/^p[1-9]\d*$/.test(id)
    || !catalog
    || JSON.stringify(value.preview) !== JSON.stringify(catalog.preview)
    || JSON.stringify(value.choices) !== JSON.stringify(catalog.choices)
    || (value.state !== "pending" && value.state !== "used" && value.state !== "omitted")
  ) {
    throw new Error(`Monitor draft proposal ${index + 1} is malformed.`);
  }
  return Object.freeze({ id, preview: catalog.preview, choices: catalog.choices, state: value.state });
}

function formatConditionValue(
  definition: MonitorConditionDefinition,
  operator: MonitorConditionOperator,
  value: unknown,
) {
  if (operator === "within_days") {
    const days = value as number;
    return `Within ${days} ${days === 1 ? "day" : "days"}`;
  }
  if (operator === "in" || operator === "not_in") {
    const label = MONITOR_CONDITION_OPERATOR_DISPLAY_LABELS[operator];
    return `${label}: ${(value as readonly unknown[]).map((item) => formatScalar(definition, item)).join(", ")}`;
  }
  const scalar = formatScalar(definition, value);
  const template = definition.display?.operatorValueTemplates?.[operator];
  if (template) return template.replace("{value}", scalar);
  if (operator === "eq") return definition.valueType === "date" ? `On ${scalar}` : scalar;
  if (operator === "neq") return definition.valueType === "date" ? `Not on ${scalar}` : `Does not equal ${scalar}`;
  if (operator === "before" || operator === "after") {
    return `${MONITOR_CONDITION_OPERATOR_DISPLAY_LABELS[operator]} ${scalar}`;
  }
  return `${MONITOR_CONDITION_OPERATOR_DISPLAY_LABELS[operator]} ${scalar}`;
}

function formatScalar(definition: MonitorConditionDefinition, value: unknown) {
  if (definition.enumValues && typeof value === "string") {
    return definition.display?.enumValueLabels?.[value] ?? "Choose a valid value";
  }
  if (definition.valueType === "boolean") {
    return definition.display?.booleanValueLabels?.[String(value) as "true" | "false"] ?? "Choose a valid value";
  }
  if (definition.valueType === "date" && typeof value === "string") {
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.getTime())
      ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(parsed)
      : "Choose a valid date";
  }
  if (definition.valueType === "number" && typeof value === "number" && Number.isFinite(value)) {
    const format = definition.display?.numberFormat;
    if (!format) return "Choose a valid value";
    return new Intl.NumberFormat("en-US", {
      style: format.style,
      ...(format.currency ? { currency: format.currency } : {}),
      ...(format.minimumFractionDigits !== undefined
        ? { minimumFractionDigits: format.minimumFractionDigits }
        : {}),
      ...(format.maximumFractionDigits !== undefined
        ? { maximumFractionDigits: format.maximumFractionDigits }
        : {}),
    }).format(value);
  }
  return typeof value === "string" && value.trim() ? value.trim() : "Choose a valid value";
}

function defaultValue(definition: MonitorConditionDefinition, operator: MonitorConditionOperator) {
  const eligibleEnum = definition.enumValues?.find((value) => !definition.eligibility?.ineligibleValues?.includes(value));
  const scalar = eligibleEnum ?? (definition.valueType === "boolean"
    ? true
    : definition.valueType === "number"
      ? Math.max(1, (definition.numberValidation?.exclusiveMinimum ?? 0) + 1)
      : "");
  return operator === "in" || operator === "not_in" ? (scalar === "" ? [] : [scalar]) : scalar;
}

function getListingDefinition(key: string) {
  const definition = getReadyMonitorCondition(key);
  return definition?.monitorDomains?.includes("listing") && definition.display ? definition : null;
}

function isListingValueType(value: MonitorConditionValueType): value is ListingMonitorConditionEditorCatalogItem["valueType"] {
  return value === "text" || value === "boolean" || value === "date" || value === "number";
}

function isCanonicalConditionShape(value: unknown): value is CanonicalListingMonitorCondition {
  if (!record(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === 3
    && keys[0] === "key"
    && keys[1] === "operator"
    && keys[2] === "value"
    && typeof value.key === "string"
    && typeof value.operator === "string";
}

function cloneCondition(condition: CanonicalListingMonitorCondition): CanonicalListingMonitorCondition {
  return Object.freeze({
    key: condition.key,
    operator: condition.operator,
    value: Array.isArray(condition.value) ? Object.freeze([...condition.value]) : condition.value,
  });
}

function readText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : "";
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
