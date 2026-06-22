import { buildSc13AnalysisPrompt } from "./analysisPrompt";
import { secSc13FetchPlan } from "./fetchPlan";
import { parseSc13Filing } from "./parser";
import { SC13_OWNERSHIP_DISPLAY_VERSION } from "./routerPrompt";
import { SC13_PARSER_GROUP, SC13_PARSER_VERSION } from "./types";

export const sc13SupportedForms = ["SC 13D", "SC 13D/A", "SC 13G", "SC 13G/A"] as const;
export const sc13AdapterKey = "sc13";
export const sc13ParserGroup = SC13_PARSER_GROUP;
export const sc13AnalysisMode = "analysis_only" as const;

export const sc13Adapter = {
  key: sc13AdapterKey,
  adapterKey: sc13AdapterKey,
  parserGroup: sc13ParserGroup,
  parserVersion: SC13_PARSER_VERSION,
  supportedForms: sc13SupportedForms,
  forms: sc13SupportedForms,
  analysisMode: sc13AnalysisMode,
  fetchPlan: secSc13FetchPlan,
  parser: parseSc13Filing,
  parse: parseSc13Filing,
  buildAnalysisPrompt: buildSc13AnalysisPrompt,
  displayVersions: {
    ownership: SC13_OWNERSHIP_DISPLAY_VERSION,
  },
} as const;

export default sc13Adapter;
