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
  conditions: readonly CanonicalListingMonitorCondition[];
}>;

const PRESET_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: "low-price-reverse-split",
    title: "Low-price reverse split",
    description: "Watch low-price stocks when a reverse split is reported.",
    category: "Price and corporate actions",
    conditions: Object.freeze([
      Object.freeze({ key: "market.price", operator: "lt" as const, value: 1 }),
      Object.freeze({ key: "corporate_action.event_kind", operator: "eq" as const, value: "reverse_split" }),
    ]),
  }),
  Object.freeze({
    id: "low-price-listing-risk",
    title: "Low-price listing risk",
    description: "Watch low-price stocks that receive a listing deficiency notice.",
    category: "Price and listing",
    conditions: Object.freeze([
      Object.freeze({ key: "market.price", operator: "lt" as const, value: 1 }),
      Object.freeze({ key: "listing.event_kind", operator: "eq" as const, value: "deficiency_notice" }),
    ]),
  }),
  Object.freeze({
    id: "listing-deadline-risk",
    title: "Listing deadline risk",
    description: "Watch deficiency notices with a near-term compliance deadline.",
    category: "Listing deadlines",
    conditions: Object.freeze([
      Object.freeze({ key: "listing.event_kind", operator: "eq" as const, value: "deficiency_notice" }),
      Object.freeze({ key: "listing.compliance_deadline", operator: "within_days" as const, value: 30 }),
    ]),
  }),
  Object.freeze({
    id: "reverse-split-listing-risk",
    title: "Reverse split + listing risk",
    description: "Watch for a reverse split together with a listing deficiency notice.",
    category: "Corporate actions and listing",
    conditions: Object.freeze([
      Object.freeze({ key: "corporate_action.event_kind", operator: "eq" as const, value: "reverse_split" }),
      Object.freeze({ key: "listing.event_kind", operator: "eq" as const, value: "deficiency_notice" }),
    ]),
  }),
] satisfies readonly MonitorPreset[]);

export function getMonitorPresetCatalog() {
  return validateMonitorPresetCatalog(PRESET_DEFINITIONS);
}

export function validateMonitorPresetCatalog(value: unknown): readonly MonitorPreset[] {
  if (!Array.isArray(value) || value.length === 0) throw presetInvalid("catalog_empty");
  const ids = new Set<string>();
  const presets = value.map((candidate, index) => {
    if (!record(candidate) || !exactKeys(candidate, ["id", "title", "description", "category", "conditions"])) {
      throw presetInvalid(`presets[${index}]:shape_invalid`);
    }
    const id = readText(candidate.id, 80);
    const title = readText(candidate.title, 80);
    const description = readText(candidate.description, 180);
    const category = readText(candidate.category, 80);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || !title || !description || !category) {
      throw presetInvalid(`presets[${index}]:metadata_invalid`);
    }
    if (ids.has(id)) throw presetInvalid(`presets[${index}]:id_duplicate`);
    const validation = validateCanonicalListingConditions(candidate.conditions);
    if (!validation.ok) {
      throw presetInvalid(`presets[${index}]:${validation.errors.join(",")}`);
    }
    ids.add(id);
    return Object.freeze({ id, title, description, category, conditions: validation.conditions });
  });
  return Object.freeze(presets);
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
