import { secNtFetchPlan } from "./fetchPlan";
import { parseNtFiling } from "./parser";
import {
  NT_PARSER_GROUP,
  NT_PARSER_VERSION,
  type NtFilingInput,
  type NtParserOutput,
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
  analysisMode: "analysis_only",
  fetchPlan: secNtFetchPlan,
  parse: parseNtFiling,
} satisfies {
  adapterKey: string;
  parserGroup: typeof NT_PARSER_GROUP;
  parserVersion: typeof NT_PARSER_VERSION;
  supportedForms: typeof SEC_NT_SUPPORTED_FORMS;
  analysisMode: "analysis_only";
  fetchPlan: typeof secNtFetchPlan;
  parse: (input: NtFilingInput) => NtParserOutput;
};
