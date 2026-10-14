import type { NaturalLanguageConditionCompilerResult } from "./naturalLanguageConditionCompiler.ts";
export const SEC425_MONITOR_EXAMPLES = [
  "Notify me when an SEC 425 filing announces a new acquisition proposal.",
  "Notify me when an SEC 425 filing announces a revised acquisition proposal.",
  "Notify me when an SEC 425 filing announces a signed definitive merger agreement.",
  "Notify me when an SEC 425 filing announces a revised tender offer.",
] as const;
export type Sec425MonitorPreview = {
  version: "sec425_monitor_preview_v1";
  status: "not_ready";
  interpretation: NaturalLanguageConditionCompilerResult["status"];
  conditions: readonly { key: string; label: string; value: unknown }[];
  requirements: NaturalLanguageConditionCompilerResult["ledger"]["requirements"];
  message: string;
  canSave: false;
  canMatch: false;
  canAlert: false;
};
export function formatSec425PreviewValue(condition: Sec425MonitorPreview["conditions"][number]) {
  if (condition.key === "sec425.announcement_type") {
    const labels: Record<string, string> = { new_acquisition_proposal: "New acquisition proposal", revised_acquisition_proposal: "Revised acquisition proposal", definitive_agreement_signed: "Definitive agreement signed" };
    return typeof condition.value === "string" ? labels[condition.value] ?? "Unavailable" : "Unavailable";
  }
  return typeof condition.value === "boolean" ? condition.value ? "Yes" : "No" : typeof condition.value === "string" ? condition.value : "Unavailable";
}
