import { secNtFetchPlan } from "./fetchPlan";
import { SEC_NT_FORMS } from "../common/forms";
import { parseNtFiling } from "./parser";
import {
  NT_PARSER_GROUP,
  NT_PARSER_VERSION,
  type NtFilingInput,
  type NtParserOutput,
} from "./types";

export const SEC_NT_ADAPTER_KEY = "sec-form-nt";

export const SEC_NT_SUPPORTED_FORMS = SEC_NT_FORMS;

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
