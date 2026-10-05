import { findRegistrationTargets, verifyRegistrationTarget, type Select, defaultSelect } from "./registration.ts";
import { hasEffect, targetConditions, type RegistrationTarget } from "./conditions.ts";
import type { NaturalLanguageMonitorDraft } from "../monitor/naturalLanguageMonitorDraft.ts";
import { formatNaturalLanguageMonitorDraftCondition } from "../monitor/naturalLanguageMonitorDraft.ts";
import { validateMonitorConditionInput } from "../monitor/conditionRegistry.ts";
import { createListingMonitorDraftReview } from "../monitor/listingMonitorDraftReview.ts";

export type EffectResolution = { status: "needs_selection" | "unresolved" | "confirmed"; candidates: RegistrationTarget[]; message: string };
export async function resolveEffectDraft(draft: NaturalLanguageMonitorDraft, select: Select = defaultSelect): Promise<NaturalLanguageMonitorDraft> {
  if (!hasEffect(draft.conditions)) return draft;
  const query = draft.conditions.find(c => c.key === "effect.target_query");
  const form = draft.conditions.find(c => c.key === "effect.registration_form");
  let candidates: RegistrationTarget[] = [], message: string;
  try {
    if (!query || typeof query.value !== "string") throw new Error("Specify the registration company, file number or accession, then build the monitor again.");
    candidates = await findRegistrationTargets(query.value, typeof form?.value === "string" ? form.value : undefined, select);
    message = candidates.length ? "Select the exact registration to confirm. Amendments with the same CIK and file number are grouped."
      : "No verifiable registration was found in the saved source records. Specify its accession or file number; effectiveness remains unknown.";
  } catch (error) { message = error instanceof Error ? error.message : "Registration lookup unavailable."; }
  return { ...draft, effectResolution: { status: candidates.length ? "needs_selection" : "unresolved", candidates, message } };
}

export async function confirmEffectDraft(value: unknown, select: Select = defaultSelect): Promise<NaturalLanguageMonitorDraft> {
  const body = value as { draft?: NaturalLanguageMonitorDraft; registrationAccession?: string };
  const draft = body?.draft;
  createListingMonitorDraftReview(draft);
  if (!draft || draft.version !== "natural_language_monitor_draft_v1" || !Array.isArray(draft.conditions)
    || draft.conditions.some(c => validateMonitorConditionInput(c).length)
    || !Array.isArray(draft.unsupported) || !Array.isArray(draft.ambiguous) || !Array.isArray(draft.proposed)
    || new Set(draft.conditions.map(c => c.key)).size !== draft.conditions.length
    || draft.conditions.some(c => c.operator !== "eq" || !["effect.observed", "effect.target_query", "effect.registration_form"].includes(c.key))
    || draft.conditions.find(c => c.key === "effect.observed")?.value !== true) throw new Error("Invalid EFFECT draft.");
  const resolved = await resolveEffectDraft(draft, select);
  const target = resolved.effectResolution?.candidates.find(c => c.accession === body.registrationAccession);
  if (!target) throw new Error("The selected registration is no longer a verified candidate. Build the monitor again.");
  const conditions = targetConditions(target);
  await verifyRegistrationTarget(conditions, select);
  return { ...draft, conditions,
    mapped: [{ sourceText: "Confirmed registration", conditions: conditions.map((c,i) => formatNaturalLanguageMonitorDraftCondition({ id: `c${i+1}`, ...c })) }],
    effectResolution: { status: "confirmed", candidates: [target], message: `Confirmed ${target.company} ${target.form} · ${target.fileNumber}` } };
}
