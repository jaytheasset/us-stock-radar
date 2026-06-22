import type { SecFormFetchPlan } from "./fetchPlan";
import type { SecRequiredOutputJson } from "./secIntegrationContract";
import type { SecFormPersistenceRequest } from "./runtimeStoreContract";

export const SEC_FORM_ADAPTER_ANALYSIS_MODES = [
  "generic_sec_analysis",
  "s3_offering_flow",
  "ownership_direct_analysis",
  "analysis_only",
  "current_report_router_flow",
  "router_required",
  "router_then_analysis",
  "deterministic-first-router-fallback",
  "parser_router_display_analysis",
  "parser_classifier_payload_analysis",
  "router_then_display_payload_then_analysis",
  "deterministic_with_router_fallback",
] as const;

export type SecFormAdapterAnalysisMode = (typeof SEC_FORM_ADAPTER_ANALYSIS_MODES)[number];

export type SecFormAdapterRawItem = {
  id?: unknown;
  source_code?: unknown;
  source_group?: unknown;
  source_unique_id?: unknown;
  source_url?: unknown;
  title?: unknown;
  published_at?: unknown;
  body_text?: unknown;
  analysis_text?: unknown;
  raw_payload?: unknown;
  metadata?: unknown;
};

export type SecFormAdapterInfo<TKey extends string = string> = {
  key: TKey;
  parserGroup: string;
  analysisMode: SecFormAdapterAnalysisMode;
};

export type SecFormAdapterParseResult<TKey extends string = string> = {
  worker: SecFormAdapterInfo<TKey> | null;
  hardParsers: Record<string, unknown>;
  parserOutputs?: Record<string, unknown>;
};

export type SecFormAdapterDefinition<
  TKey extends string = string,
  TRawItem extends SecFormAdapterRawItem = SecFormAdapterRawItem,
  TParseResult extends SecFormAdapterParseResult<TKey> = SecFormAdapterParseResult<TKey>,
> = {
  key: TKey;
  parserGroup: string;
  forms: readonly string[];
  analysisMode: SecFormAdapterAnalysisMode;
  matches: (canonicalFormType: string) => boolean;
  parse: (rawItem: TRawItem, formType: string | null) => TParseResult;
};

export type SecFormRuntimeAdapter<
  TKey extends string = string,
  TRawItem extends SecFormAdapterRawItem = SecFormAdapterRawItem,
  TParserOutput = unknown,
> = SecFormAdapterDefinition<TKey, TRawItem, SecFormAdapterParseResult<TKey>> & {
  fetchPlan?: SecFormFetchPlan;
  tryDeterministicResult?: (parserOutput: TParserOutput) => SecRequiredOutputJson | null;
  buildAnalysisPrompt?: (parserOutput: TParserOutput) => {
    key: string;
    version: string;
    system: string;
    user: string;
    responseFormat: {
      json_schema: Record<string, unknown>;
    };
  };
  buildPersistenceRequest?: (output: SecRequiredOutputJson) => SecFormPersistenceRequest;
};

export function isSecFormAdapterAnalysisMode(value: unknown): value is SecFormAdapterAnalysisMode {
  return typeof value === "string" && SEC_FORM_ADAPTER_ANALYSIS_MODES.includes(value as SecFormAdapterAnalysisMode);
}
