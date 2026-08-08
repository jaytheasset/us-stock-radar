import {
  SEC_FORM_ROOM_MANIFEST,
  normalizeSecFormType,
  type SecFormRoomSlug,
} from "./sources/sec/forms/common/forms.ts";

export type FilingsV2FilingGroup = SecFormRoomSlug;

const filingGroupLabels = {
  ownership: "Ownership changes",
  "8k-6k": "Current reports",
  "s1-f1": "Initial registration",
  "s3-f3": "Shelf registration",
  "s4-f4": "Business combinations",
  "425": "Deal communications",
  "424b": "Prospectuses",
  tender: "Tender offers",
  proxy: "Proxy materials",
  "periodic-reports": "Periodic reports",
  s8: "Employee plans",
  sc13: "Beneficial ownership",
  nt: "Late filing notices",
  form25: "Delisting notices",
  effect: "Effectiveness notices",
} as const satisfies Record<SecFormRoomSlug, string>;

export const filingsV2FilingGroupOptions = SEC_FORM_ROOM_MANIFEST.map((room) => ({
  label: filingGroupLabels[room.slug],
  value: room.slug,
}));

export const filingsV2FilingGroupValues = SEC_FORM_ROOM_MANIFEST.map(
  (room) => room.slug,
);

export const filingsV2FilingGroupLabel = filingGroupLabels;

export function resolveFilingsV2FilingGroupQuery(
  groups: readonly FilingsV2FilingGroup[],
) {
  const selected = new Set(groups);
  const selectedRooms = SEC_FORM_ROOM_MANIFEST.filter((room) =>
    selected.has(room.slug),
  );
  const nativeForms = selectedRooms
    .filter((room) => room.slug !== "effect")
    .flatMap((room) => [...room.forms, ...room.aliases]);

  return {
    effectiveFilingForms: uniqueNormalizedForms(nativeForms),
    formTypes: uniqueNormalizedForms(nativeForms),
    includeEffectiveness: selected.has("effect"),
  };
}

export function filingGroupIncludesEffectiveForm(
  group: FilingsV2FilingGroup,
  effectiveFilingForm: string | null | undefined,
) {
  if (group === "effect") return false;
  const room = SEC_FORM_ROOM_MANIFEST.find((candidate) => candidate.slug === group);
  const normalized = normalizeSecFormType(effectiveFilingForm);
  return Boolean(
    normalized &&
      [...(room?.forms ?? []), ...(room?.aliases ?? [])].some(
        (form) => normalizeSecFormType(form) === normalized,
      ),
  );
}

export function formatFilingsV2FormType(
  formType: string,
  effectiveFilingForm?: string | null,
) {
  const normalizedFormType = normalizeSecFormType(formType);
  const normalizedRelatedForm = normalizeSecFormType(effectiveFilingForm);
  return normalizedFormType === "EFFECT" && normalizedRelatedForm
    ? `EFFECT · ${normalizedRelatedForm}`
    : formType;
}

function uniqueNormalizedForms(forms: readonly string[]) {
  return Array.from(new Set(forms.map(normalizeSecFormType).filter(Boolean)));
}
