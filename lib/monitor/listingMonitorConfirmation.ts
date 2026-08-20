import {
  getReadyMonitorCondition,
  validateMonitorConditionInput,
} from "./conditionRegistry.ts";
import type { CanonicalListingMonitorCondition } from "./listingMonitorPersistence.ts";

export const LISTING_MONITOR_CONFIRMATION_USE_OPTION_ID = "use" as const;
export const LISTING_MONITOR_CONFIRMATION_OMIT_OPTION_ID = "omit" as const;

export type ListingMonitorConfirmationChoice = Readonly<{
  id: typeof LISTING_MONITOR_CONFIRMATION_USE_OPTION_ID
    | typeof LISTING_MONITOR_CONFIRMATION_OMIT_OPTION_ID;
  label: string;
}>;

export type ListingMonitorProposedConditionPreview = Readonly<{
  label: string;
  value: string;
  text: string;
}>;

export type ListingMonitorConfirmationCatalog = Readonly<{
  preview: ListingMonitorProposedConditionPreview;
  choices: readonly ListingMonitorConfirmationChoice[];
}>;

export function requiresExplicitAiDraftConfirmation(
  condition: CanonicalListingMonitorCondition,
) {
  const definition = getReadyMonitorCondition(condition.key);
  return Boolean(
    definition?.monitorDomains?.includes("listing")
    && definition.requiresExplicitConfirmationInAiDraft === true,
  );
}

export function getListingMonitorConfirmationCatalog(
  condition: CanonicalListingMonitorCondition,
): ListingMonitorConfirmationCatalog | null {
  const definition = getReadyMonitorCondition(condition.key);
  if (
    !definition?.monitorDomains?.includes("listing")
    || definition.requiresExplicitConfirmationInAiDraft !== true
    || !definition.aiDraftConfirmation
    || !definition.display
    || validateMonitorConditionInput(condition).length > 0
  ) {
    return null;
  }
  const rawValues = condition.operator === "in" ? condition.value : [condition.value];
  if (!Array.isArray(rawValues) || rawValues.some((value) => typeof value !== "string")) return null;
  const labels = rawValues.map((value) => (
    definition.aiDraftConfirmation?.enumValueLabels?.[value]
      ?? definition.display?.enumValueLabels?.[value]
      ?? ""
  ));
  if (labels.some((label) => !label)) return null;
  const value = condition.operator === "in" ? labels.join(", ") : labels[0];
  return Object.freeze({
    preview: Object.freeze({
      label: definition.display.label,
      value,
      text: `${definition.display.label} \u2014 ${value}`,
    }),
    choices: Object.freeze([
      Object.freeze({
        id: LISTING_MONITOR_CONFIRMATION_USE_OPTION_ID,
        label: definition.aiDraftConfirmation.useLabel,
      }),
      Object.freeze({
        id: LISTING_MONITOR_CONFIRMATION_OMIT_OPTION_ID,
        label: definition.aiDraftConfirmation.omitLabel,
      }),
    ]),
  });
}

export function resolveListingMonitorConfirmationChoice(
  condition: CanonicalListingMonitorCondition,
  choiceId: string,
): CanonicalListingMonitorCondition | null | undefined {
  if (!getListingMonitorConfirmationCatalog(condition)) return undefined;
  if (choiceId === LISTING_MONITOR_CONFIRMATION_OMIT_OPTION_ID) return null;
  if (choiceId !== LISTING_MONITOR_CONFIRMATION_USE_OPTION_ID) return undefined;
  return Object.freeze({
    key: condition.key,
    operator: condition.operator,
    value: Array.isArray(condition.value) ? Object.freeze([...condition.value]) : condition.value,
  });
}
