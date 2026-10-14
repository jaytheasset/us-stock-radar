import {
  compileNaturalLanguageListingConditions,
  revalidateNaturalLanguageConditionCompilerResult,
  type ConditionCompilerPreviewScope,
  type NaturalLanguageConditionCompilerResult,
} from "./naturalLanguageConditionCompiler.ts";
import type { NaturalLanguageMonitorDraft } from "./naturalLanguageMonitorDraft.ts";
import type { CanonicalListingMonitorCondition } from "./listingMonitorPersistence.ts";
import type { Sec425MonitorPreview } from "./sec425CandidateDisplay.ts";

const announcements = ["new_acquisition_proposal", "revised_acquisition_proposal", "definitive_agreement_signed"];
const tags = ["acquisition", "merger", "tender_offer", "exchange_offer", "spac_business_combination", "asset_acquisition"];
const catalog = [
  { key: "sec425.announcement_type", label: "Current announcement", value_type: "text" as const, values: announcements,
    description: "Newly announced action in this filing, not a prior transaction description. New proposal, revised proposal, or execution of a final definitive acquisition/merger agreement. Closing, vote, LOI, negotiations and board approval are not supported announcements." },
  ...tags.map(tag => ({ key: `sec425.transaction.${tag}`, label: `Transaction includes ${tag.replaceAll("_", " ")}`, value_type: "boolean" as const, values: undefined,
    description: `Source-supported transaction includes ${tag}; true only. These tags may coexist. Not an announcement type and not proof of completion. Negative/absence inference is unsupported.` })),
  ...(["acquirer", "target"] as const).map(role => ({ key: `sec425.${role}_ticker`, label: `Source-stated ${role} ticker`, value_type: "text" as const, values: undefined,
    description: `User-specified ticker for the ${role} company only. Preserve explicit symbol, do not resolve company names or copy the filing issuer symbol. If role or symbol is unclear ask for clarification. A source-stated symbol is not verified security identity; future combined symbols do not qualify.` })),
];

// Scoped only to compiler previews. These definitions are NEVER registered as production READY/readers.
export const SEC425_COMPILER_PREVIEW_SCOPE: ConditionCompilerPreviewScope = {
  registry: catalog.map(c => ({ key: c.key, description: c.description, value_type: c.value_type, allowed_operators: ["eq"],
    ...(c.values ? { enum_values: c.values.map(value => ({ value, description: value.replaceAll("_", " ") })) } : {}),
  })),
  instructions: "This is a SEC425 candidate interpretation preview, not a live monitor. Only this injected catalog is supported. Preserve every user constraint and report unsupported/ambiguous requirements. Do not use other families' keys. Transaction tags can coexist; use separate true-valued tag conditions. Terms thresholds, expected price moves, completed deals, arbitrary company-name resolution and negative absence are unsupported. No instruction here makes FACTs or conditions ready for storage or automatic Alerts.",
  validateConditions(value) {
    if (!Array.isArray(value) || value.length === 0) return { ok: false, conditions: [], errors: ["preview_conditions_empty"] };
    const errors: string[] = [], conditions: CanonicalListingMonitorCondition[] = [];
    value.forEach((v, i) => {
      const entry = v && typeof v === "object" ? catalog.find(c => c.key === v.key) : undefined;
      if (!entry || Object.keys(v).sort().join(",") !== "key,operator,value" || v.operator !== "eq") { errors.push(`conditions[${i}]:preview_condition_invalid`); return; }
      const valid = entry.values ? entry.values.includes(v.value)
        : entry.value_type === "boolean" ? v.value === true
        : typeof v.value === "string" && /^[A-Z][A-Z0-9.-]{0,9}$/.test(v.value);
      if (!valid) errors.push(`conditions[${i}]:preview_value_invalid`);
      else conditions.push(Object.freeze({ key: v.key, operator: "eq", value: v.value }));
    });
    return { ok: errors.length === 0, conditions: errors.length ? [] : Object.freeze(conditions), errors };
  },
};

export function buildSec425MonitorPreview(result: NaturalLanguageConditionCompilerResult, text: string) {
  const validated = revalidateNaturalLanguageConditionCompilerResult(result, text, SEC425_COMPILER_PREVIEW_SCOPE);
  const message = "425 announcement alerts are not available yet. You can review this interpretation, but saving and alerts remain unavailable while source verification and the data connection are incomplete.";
  const preview: Sec425MonitorPreview = {
    version: "sec425_monitor_preview_v1", status: "not_ready", interpretation: validated.status,
    conditions: validated.conditions.map(c => ({ key: c.key, label: catalog.find(d => d.key === c.key)!.label, value: c.value })),
    requirements: validated.ledger.requirements, message, canSave: false, canMatch: false, canAlert: false,
  };
  // Reuse existing review/create gate with an unresolved readiness issue and NO executable conditions.
  const draft: NaturalLanguageMonitorDraft = {
    version: "natural_language_monitor_draft_v1", draftStatus: "NEEDS_ATTENTION", compilerStatus: validated.status,
    conditions: [], mapped: [], proposed: [], unresolvedCount: 0, message,
    unsupported: [{ sourceText: text, status: "Unsupported", reason: message }, ...validated.unsupported.map(v => ({ sourceText: v.text, status: "Unsupported" as const, reason: v.reason }))],
    ambiguous: validated.ledger.requirements.filter(v => v.decision === "ambiguous").map(v => ({ sourceText: v.source_text, status: "Needs clarification" as const, question: v.question! })),
  };
  return { draft, preview };
}

export async function compileSec425MonitorPreview(text: string, options: Parameters<typeof compileNaturalLanguageListingConditions>[1] = {}) {
  const run = await compileNaturalLanguageListingConditions({ text }, { ...options, previewScope: SEC425_COMPILER_PREVIEW_SCOPE });
  return { ...buildSec425MonitorPreview(run.result, text), telemetry: run.telemetry };
}
