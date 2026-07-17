import { buildNtAnalysisPrompt, validateNtRequiredOutputJson } from "./analysisPrompt";
import { buildNtDisplayPayload } from "./displayPayload";
import { secNtFetchPlan } from "./fetchPlan";
import { parseNtFiling } from "./parser";
import { buildNtRouterPrompt, routeNtParserOutput } from "./routerPrompt";
import {
  NT_PARSER_GROUP,
  NT_PARSER_VERSION,
  type NtFilingInput,
  type NtParserOutput,
  type NtRouterDecision,
} from "./types";

export const SEC_NT_ADAPTER_KEY = "sec-form-nt";

export const SEC_NT_SUPPORTED_FORMS = [
  "NT 10-K",
  "NT 10-K/A",
  "NT 10-Q",
  "NT 10-Q/A",
  "NT 20-F",
  "NT 20-F/A",
] as const;

export type SecNtSupportedRuntimeForm = (typeof SEC_NT_SUPPORTED_FORMS)[number];

export const secNtFormAdapter = {
  adapterKey: SEC_NT_ADAPTER_KEY,
  parserGroup: NT_PARSER_GROUP,
  parserVersion: NT_PARSER_VERSION,
  supportedForms: SEC_NT_SUPPORTED_FORMS,
  analysisMode: "router_then_analysis",
  fetchPlan: secNtFetchPlan,
  parse: parseNtFiling,
  buildRouterPrompt: buildNtRouterPrompt,
  routeParserOutput: routeNtParserOutput,
  buildDisplayPayload: buildNtDisplayPayload,
  buildAnalysisPrompt: buildNtAnalysisPrompt,
  validateRequiredOutputJson: validateNtRequiredOutputJson,
} satisfies {
  adapterKey: string;
  parserGroup: typeof NT_PARSER_GROUP;
  parserVersion: typeof NT_PARSER_VERSION;
  supportedForms: typeof SEC_NT_SUPPORTED_FORMS;
  analysisMode: "router_then_analysis";
  fetchPlan: typeof secNtFetchPlan;
  parse: (input: NtFilingInput) => NtParserOutput;
  buildRouterPrompt: (parserOutput: NtParserOutput) => string;
  routeParserOutput: (parserOutput: NtParserOutput) => NtRouterDecision;
  buildDisplayPayload: typeof buildNtDisplayPayload;
  buildAnalysisPrompt: typeof buildNtAnalysisPrompt;
  validateRequiredOutputJson: typeof validateNtRequiredOutputJson;
};
