import {
  buildSecPeriodicReportsAmendmentAnalysisPromptDraft,
  buildSecPeriodicReportsAnalysisPromptDraft,
  SEC_PERIODIC_REPORTS_AMENDMENT_ANALYSIS_PROMPT_KEY,
  SEC_PERIODIC_REPORTS_AMENDMENT_ANALYSIS_PROMPT_VERSION,
  SEC_PERIODIC_REPORTS_ANALYSIS_PROMPT_KEY,
  SEC_PERIODIC_REPORTS_ANALYSIS_PROMPT_VERSION,
} from "./analysisPrompt.ts";
import { buildSecPeriodicReportsDisplayPayload, SEC_PERIODIC_REPORTS_DISPLAY_PAYLOAD_VERSION } from "./displayPayload.ts";
import { secPeriodicReportsFetchPlan } from "./fetchPlan.ts";
import { parseSecPeriodicReport, SEC_PERIODIC_REPORTS_PARSER_VERSION } from "./parser.ts";
import { PERIODIC_REPORT_DISPLAY_TYPES, PERIODIC_REPORTS_FORM_SCOPE, PERIODIC_REPORTS_PARSER_GROUP, SUPPORTED_PERIODIC_REPORT_FORMS } from "./types.ts";

export const SEC_PERIODIC_REPORTS_ADAPTER_KEY = "sec-periodic-reports";
export const SEC_PERIODIC_REPORTS_ANALYSIS_MODE = "analysis_only";

export const secPeriodicReportsAdapter = {
  key: SEC_PERIODIC_REPORTS_ADAPTER_KEY,
  parserGroup: PERIODIC_REPORTS_PARSER_GROUP,
  formScope: PERIODIC_REPORTS_FORM_SCOPE,
  supportedForms: SUPPORTED_PERIODIC_REPORT_FORMS,
  analysisMode: SEC_PERIODIC_REPORTS_ANALYSIS_MODE,
  parserVersion: SEC_PERIODIC_REPORTS_PARSER_VERSION,
  analysisPromptKey: SEC_PERIODIC_REPORTS_ANALYSIS_PROMPT_KEY,
  analysisPromptVersion: SEC_PERIODIC_REPORTS_ANALYSIS_PROMPT_VERSION,
  amendmentAnalysisPromptKey: SEC_PERIODIC_REPORTS_AMENDMENT_ANALYSIS_PROMPT_KEY,
  amendmentAnalysisPromptVersion: SEC_PERIODIC_REPORTS_AMENDMENT_ANALYSIS_PROMPT_VERSION,
  displayPayloadVersion: SEC_PERIODIC_REPORTS_DISPLAY_PAYLOAD_VERSION,
  displayTypes: PERIODIC_REPORT_DISPLAY_TYPES,
  fetchPlan: secPeriodicReportsFetchPlan,
  parse: parseSecPeriodicReport,
  parser: parseSecPeriodicReport,
  buildAnalysisPrompt: buildSecPeriodicReportsAnalysisPromptDraft,
  buildAmendmentAnalysisPrompt: buildSecPeriodicReportsAmendmentAnalysisPromptDraft,
  buildDisplayPayload: buildSecPeriodicReportsDisplayPayload,
} as const;

export default secPeriodicReportsAdapter;
