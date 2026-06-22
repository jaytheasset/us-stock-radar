import {
  buildSecTenderAnalysisPromptDraft,
  SEC_TENDER_ANALYSIS_PROMPT_KEY,
  SEC_TENDER_ANALYSIS_PROMPT_VERSION,
} from "./analysisPrompt";
import {
  parseSecTenderArchiveSubmission,
  parseSecTenderFiling,
  SEC_TENDER_PARSER_VERSION,
} from "./parser";
import {
  SEC_TENDER_PARSER_GROUP,
  SEC_TENDER_ROOM_FORM_TYPE,
} from "./types";

export const SEC_TENDER_ADAPTER_KEY = "sec_tender_cb_13e3";
export const SEC_TENDER_ANALYSIS_MODE = "analysis_only";

export const SEC_TENDER_SUPPORTED_FORMS = [
  "SC TO-C",
  "SC TO-I",
  "SC TO-I/A",
  "SC TO-T",
  "SC TO-T/A",
  "SC 13E3",
  "SC 13E3/A",
  "CB",
  "CB/A",
  "SC 14D9",
  "SC 14D9/A",
] as const;

export const secTenderFormAdapter = {
  key: SEC_TENDER_ADAPTER_KEY,
  parserGroup: SEC_TENDER_PARSER_GROUP,
  forms: SEC_TENDER_SUPPORTED_FORMS,
  analysisMode: SEC_TENDER_ANALYSIS_MODE,
  matches: isTenderCanonicalFormType,
  parse: parseSecTenderFiling,
  formType: SEC_TENDER_ROOM_FORM_TYPE,
  parserVersion: SEC_TENDER_PARSER_VERSION,
  supportedForms: SEC_TENDER_SUPPORTED_FORMS,
  analysisPrompt: {
    key: SEC_TENDER_ANALYSIS_PROMPT_KEY,
    version: SEC_TENDER_ANALYSIS_PROMPT_VERSION,
    build: buildSecTenderAnalysisPromptDraft,
  },
  parseFiling: parseSecTenderFiling,
  parseArchiveSubmission: parseSecTenderArchiveSubmission,
} as const;

export const tenderFormAdapter = secTenderFormAdapter;

export function isTenderCanonicalFormType(form: string | null | undefined) {
  return typeof form === "string" && SEC_TENDER_SUPPORTED_FORMS.includes(form as (typeof SEC_TENDER_SUPPORTED_FORMS)[number]);
}

export {
  buildSecTenderAnalysisPromptDraft,
  parseSecTenderArchiveSubmission,
  parseSecTenderFiling,
};
