import { validateCanonicalListingConditions, type CanonicalListingMonitorCondition } from "./listingMonitorPersistence.ts";
import {
  formatNaturalLanguageMonitorDraftCondition,
  NATURAL_LANGUAGE_MONITOR_DRAFT_VERSION,
  type NaturalLanguageMonitorDraft,
} from "./naturalLanguageMonitorDraft.ts";

export type MonitorPreset = Readonly<{
  id: string;
  title: string;
  description: string;
  category: string;
  priority: number;
  conditions: readonly CanonicalListingMonitorCondition[];
}>;

export type MonitorAddConditionOption = Readonly<{
  id: string;
  category: "common" | "corporate-actions" | "listing-risk" | "proxy";
  title: string;
  condition: CanonicalListingMonitorCondition;
}>;

export type MonitorAddConditionGroup = Readonly<{
  id: MonitorAddConditionOption["category"];
  title: "Common" | "Corporate Actions" | "Listing Risk" | "Proxy";
  options: readonly MonitorAddConditionOption[];
}>;

const PRESET_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: "low-price-reverse-split",
    title: "Low-price reverse split",
    description: "Watch low-price stocks when a reverse split is reported.",
    category: "Corporate Actions",
    priority: 1,
    conditions: Object.freeze([
      Object.freeze({ key: "market.price", operator: "lt" as const, value: 1 }),
      Object.freeze({ key: "corporate_action.event_kind", operator: "eq" as const, value: "reverse_split" }),
    ]),
  }),
  Object.freeze({
    id: "low-price-listing-risk",
    title: "Low-price listing risk",
    description: "Watch low-price stocks that receive a listing deficiency notice.",
    category: "Listing Risk",
    priority: 2,
    conditions: Object.freeze([
      Object.freeze({ key: "market.price", operator: "lt" as const, value: 1 }),
      Object.freeze({ key: "listing.event_kind", operator: "eq" as const, value: "deficiency_notice" }),
    ]),
  }),
  Object.freeze({
    id: "listing-deadline-risk",
    title: "Listing deadline risk",
    description: "Watch deficiency notices with a near-term compliance deadline.",
    category: "Listing Risk",
    priority: 3,
    conditions: Object.freeze([
      Object.freeze({ key: "listing.event_kind", operator: "eq" as const, value: "deficiency_notice" }),
      Object.freeze({ key: "listing.compliance_deadline", operator: "within_days" as const, value: 30 }),
    ]),
  }),
  Object.freeze({
    id: "proxy-capital-proposal", title: "Proxy capital structure proposal",
    description: "Watch filings that contain a capital structure proposal. A proposal does not mean approval or execution.",
    category: "Proxy", priority: 4,
    conditions: Object.freeze([Object.freeze({ key: "proxy.has_capital_structure_proposal", operator: "eq" as const, value: true })]),
  }),
] satisfies readonly MonitorPreset[]);

const ADD_CONDITION_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: "price",
    category: "common" as const,
    title: "Price",
    condition: Object.freeze({ key: "market.price", operator: "lte" as const, value: 1 }),
  }),
  Object.freeze({
    id: "reverse-stock-split",
    category: "corporate-actions" as const,
    title: "Reverse stock split",
    condition: Object.freeze({ key: "corporate_action.event_kind", operator: "eq" as const, value: "reverse_split" }),
  }),
  Object.freeze({
    id: "listing-deficiency",
    category: "listing-risk" as const,
    title: "Listing deficiency",
    condition: Object.freeze({ key: "listing.event_kind", operator: "eq" as const, value: "deficiency_notice" }),
  }),
  Object.freeze({
    id: "compliance-deadline",
    category: "listing-risk" as const,
    title: "Compliance deadline",
    condition: Object.freeze({ key: "listing.compliance_deadline", operator: "within_days" as const, value: 30 }),
  }),
  Object.freeze({
    id: "delisting-determination",
    category: "listing-risk" as const,
    title: "Delisting determination",
    condition: Object.freeze({ key: "listing.event_kind", operator: "eq" as const, value: "delisting_determination" }),
  }),
  Object.freeze({
    id: "trading-suspension",
    category: "listing-risk" as const,
    title: "Trading suspension",
    condition: Object.freeze({ key: "listing.event_kind", operator: "eq" as const, value: "trading_suspension" }),
  }),
  Object.freeze({id:"proxy-proposal",category:"proxy" as const,title:"Proxy proposal present",
    condition:Object.freeze({key:"proxy.has_proposal",operator:"eq" as const,value:true})}),
  Object.freeze({id:"proxy-capital-proposal",category:"proxy" as const,title:"Proxy capital structure proposal",
    condition:Object.freeze({key:"proxy.has_capital_structure_proposal",operator:"eq" as const,value:true})}),
] satisfies readonly MonitorAddConditionOption[]);

export function getMonitorPresetCatalog() {
  return validateMonitorPresetCatalog(PRESET_DEFINITIONS);
}

export function getMonitorAddConditionCatalog() {
  return validateMonitorAddConditionCatalog(ADD_CONDITION_DEFINITIONS);
}

export function validateMonitorPresetCatalog(value: unknown): readonly MonitorPreset[] {
  if (!Array.isArray(value) || value.length === 0) throw presetInvalid("catalog_empty");
  const ids = new Set<string>();
  const presets = value.map((candidate, index) => {
    if (!record(candidate) || !exactKeys(candidate, ["id", "title", "description", "category", "priority", "conditions"])) {
      throw presetInvalid(`presets[${index}]:shape_invalid`);
    }
    const id = readText(candidate.id, 80);
    const title = readText(candidate.title, 80);
    const description = readText(candidate.description, 180);
    const category = readText(candidate.category, 80);
    const priority = candidate.priority;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || !title || !description || !category || !Number.isInteger(priority) || Number(priority) < 1) {
      throw presetInvalid(`presets[${index}]:metadata_invalid`);
    }
    if (ids.has(id)) throw presetInvalid(`presets[${index}]:id_duplicate`);
    const validation = validateCanonicalListingConditions(candidate.conditions);
    if (!validation.ok) {
      throw presetInvalid(`presets[${index}]:${validation.errors.join(",")}`);
    }
    ids.add(id);
    return Object.freeze({ id, title, description, category, priority: Number(priority), conditions: validation.conditions });
  });
  if (new Set(presets.map((preset) => preset.priority)).size !== presets.length) {
    throw presetInvalid("priority_duplicate");
  }
  return Object.freeze([...presets].sort((left, right) => left.priority - right.priority));
}

export function validateMonitorAddConditionCatalog(value: unknown): readonly MonitorAddConditionGroup[] {
  if (!Array.isArray(value) || value.length === 0) throw presetInvalid("add_condition_catalog_empty");
  const allowedCategories = new Set<MonitorAddConditionOption["category"]>([
    "common",
    "corporate-actions",
    "listing-risk",
    "proxy",
  ]);
  const ids = new Set<string>();
  const options = value.map((candidate, index): MonitorAddConditionOption => {
    if (!record(candidate) || !exactKeys(candidate, ["id", "category", "title", "condition"])) {
      throw presetInvalid(`add_conditions[${index}]:shape_invalid`);
    }
    const id = readText(candidate.id, 80);
    const title = readText(candidate.title, 80);
    const category = candidate.category as MonitorAddConditionOption["category"];
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || ids.has(id) || !title || !allowedCategories.has(category)) {
      throw presetInvalid(`add_conditions[${index}]:metadata_invalid`);
    }
    const validation = validateCanonicalListingConditions([candidate.condition]);
    if (!validation.ok || validation.conditions.length !== 1) {
      throw presetInvalid(`add_conditions[${index}]:registry_invalid`);
    }
    ids.add(id);
    return Object.freeze({ id, category, title, condition: validation.conditions[0] });
  });

  const groups: readonly Omit<MonitorAddConditionGroup, "options">[] = [
    { id: "common", title: "Common" },
    { id: "corporate-actions", title: "Corporate Actions" },
    { id: "listing-risk", title: "Listing Risk" },
    ...(options.some(option => option.category === "proxy") ? [{id:"proxy" as const,title:"Proxy" as const}] : []),
  ];
  return Object.freeze(groups.map((group) => {
    const groupOptions = options.filter((option) => option.category === group.id);
    if (groupOptions.length === 0) throw presetInvalid(`add_conditions:${group.id}_empty`);
    return Object.freeze({ ...group, options: Object.freeze(groupOptions) });
  }));
}

export function createMonitorPresetDraft(
  presetId: string,
  catalog: unknown = PRESET_DEFINITIONS,
): NaturalLanguageMonitorDraft {
  const presets = validateMonitorPresetCatalog(catalog);
  const preset = presets.find((candidate) => candidate.id === presetId);
  if (!preset) throw presetInvalid("preset_unknown");
  const previews = Object.freeze(preset.conditions.map((condition, index) => (
    formatNaturalLanguageMonitorDraftCondition({ id: `preset-c${index + 1}`, ...condition })
  )));
  return Object.freeze({
    version: NATURAL_LANGUAGE_MONITOR_DRAFT_VERSION,
    draftStatus: "READY_FOR_REVIEW",
    compilerStatus: "VALID",
    conditions: preset.conditions,
    mapped: Object.freeze([Object.freeze({ sourceText: preset.title, conditions: previews })]),
    unsupported: Object.freeze([]),
    ambiguous: Object.freeze([]),
    proposed: Object.freeze([]),
    unresolvedCount: 0,
    message: "Review this preset before creating a monitor.",
  });
}

export function getMonitorPresetConditionSummary(preset: MonitorPreset) {
  const validated = validateMonitorPresetCatalog([preset])[0];
  return validated.conditions.map((condition, index) => (
    formatNaturalLanguageMonitorDraftCondition({ id: `summary-c${index + 1}`, ...condition }).text
  )).join(" + ");
}

function presetInvalid(detail: string) {
  return new Error(`Monitor preset catalog is invalid: ${detail}`);
}

function readText(value: unknown, maximumLength: number) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximumLength
    ? value.trim()
    : "";
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
