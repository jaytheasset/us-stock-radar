import { createGenericSecFormAdapter } from "@/lib/sources/sec/forms/common/formAdapterRuntime";
import { buildSec8k6kAnalysisPromptDraft } from "./analysisPrompt";
import { buildSec8k6kDisplayPayload } from "./displayPayload";
import { parseSec8k6kFiling } from "./parser";
import { buildSec8k6kRouterPromptDraft } from "./routerPrompt";
import {
  SEC_8K_6K_FORM_SCOPE,
  SEC_8K_6K_PARSER_GROUP,
  type Sec8k6kParserOutput,
} from "./types";

export {
  buildSec8k6kAnalysisPromptDraft,
  isSec8k6kAnalysisPromptKey,
  resolveSec8k6kAnalysisPromptFamily,
  SEC_8K_6K_ANALYSIS_PROMPT_FAMILY_VALUES,
  SEC_8K_6K_ANALYSIS_PROMPT_KEYS,
} from "./analysisPrompt";
export { buildSec8k6kDisplayPayload } from "./displayPayload";
export { parseSec8k6kFiling } from "./parser";
export { buildSec8k6kRouterPromptDraft } from "./routerPrompt";
export { SEC_8K_6K_FORM_SCOPE, SEC_8K_6K_PARSER_GROUP } from "./types";
export type { Sec8k6kParserOutput } from "./types";

export const SEC_8K_6K_ADAPTER_KEY = "current_report";
export const SEC_8K_6K_SUPPORTED_FORMS = ["8-K", "8-K/A", "6-K", "6-K/A"] as const;
export const SEC_8K_6K_ANALYSIS_MODE = "current_report_router_flow";

export const currentReportFormAdapter = createGenericSecFormAdapter({
  key: SEC_8K_6K_ADAPTER_KEY,
  parserGroup: SEC_8K_6K_PARSER_GROUP,
  forms: SEC_8K_6K_SUPPORTED_FORMS,
  analysisMode: SEC_8K_6K_ANALYSIS_MODE,
  matches: isSec8k6kSupportedForm,
  parse: (input) => parseSec8k6kFiling(input),
});

export function isSec8k6kSupportedForm(formType: string | null | undefined) {
  const normalized = normalizeSec8k6kFormType(formType);
  return SEC_8K_6K_SUPPORTED_FORMS.includes(normalized as (typeof SEC_8K_6K_SUPPORTED_FORMS)[number]);
}

export function normalizeSec8k6kFormType(formType: string | null | undefined) {
  return (formType || "").trim().toUpperCase();
}

export const sec8k6kFormAdapterMetadata = {
  key: SEC_8K_6K_ADAPTER_KEY,
  parserGroup: SEC_8K_6K_PARSER_GROUP,
  formScope: SEC_8K_6K_FORM_SCOPE,
  forms: SEC_8K_6K_SUPPORTED_FORMS,
  analysisMode: SEC_8K_6K_ANALYSIS_MODE,
  parser: parseSec8k6kFiling,
  routerPrompt: buildSec8k6kRouterPromptDraft,
  analysisPrompt: buildSec8k6kAnalysisPromptDraft,
  displayPayload: buildSec8k6kDisplayPayload,
} satisfies {
  key: typeof SEC_8K_6K_ADAPTER_KEY;
  parserGroup: typeof SEC_8K_6K_PARSER_GROUP;
  formScope: typeof SEC_8K_6K_FORM_SCOPE;
  forms: typeof SEC_8K_6K_SUPPORTED_FORMS;
  analysisMode: typeof SEC_8K_6K_ANALYSIS_MODE;
  parser: typeof parseSec8k6kFiling;
  routerPrompt: typeof buildSec8k6kRouterPromptDraft;
  analysisPrompt: typeof buildSec8k6kAnalysisPromptDraft;
  displayPayload: typeof buildSec8k6kDisplayPayload;
};
