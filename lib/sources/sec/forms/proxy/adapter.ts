import {
  PROXY_PARSER_GROUP,
  parseProxyFiling,
  type ProxyParserInput,
  type ProxyParserOutput,
} from "./parser.ts";
import {
  buildDeterministicProxyAnalysis,
  buildProxyAnalysisPrompt,
  buildProxyLlmDisplayPayloadPlaceholder,
  buildProxyLlmRouterPlaceholder,
  deriveDeliveryLevel,
  type ProxyAnalysisOutput,
  type ProxyAnalysisPromptInput,
} from "./analysisPrompt.ts";
import type { ProxyDisplayPayload } from "./displayPayload.ts";
import {
  buildProxyRouterPrompt,
  routeProxyFiling,
  type ProxyRouterDecision,
} from "./routerPrompt.ts";

export const PROXY_ADAPTER_KEY = "sec_proxy";
export const PROXY_ANALYSIS_MODE = "router_required";

export const PROXY_SUPPORTED_FORMS = [
  "DEF 14A",
  "DEF 14A/A",
  "PRE 14A",
  "PRE 14A/A",
  "DEFA14A",
  "DEFA14A/A",
  "DEFR14A",
  "PRER14A",
  "DEFM14A",
  "PREM14A",
  "DEFC14A",
  "PREC14A",
  "SC 14A",
  "SC 14A/A",
] as const;

export type ProxySupportedForm = (typeof PROXY_SUPPORTED_FORMS)[number];

export interface ProxyAdapterRuntimeInput {
  parserInput: ProxyParserInput;
  marketContext?: Record<string, unknown> | null;
}

export interface ProxyAdapterRuntimePackage {
  parser_output: ProxyParserOutput;
  router_decision: ProxyRouterDecision;
  display_payload: ProxyDisplayPayload;
  analysis_prompt: string | null;
  analysis_output: ProxyAnalysisOutput | null;
  analysis_mode: typeof PROXY_ANALYSIS_MODE;
  adapter_key: typeof PROXY_ADAPTER_KEY;
  parser_group: typeof PROXY_PARSER_GROUP;
}

export function isProxySupportedForm(formType: string | null | undefined): boolean {
  const normalized = normalizeProxyFormType(formType);
  return PROXY_SUPPORTED_FORMS.includes(normalized as ProxySupportedForm);
}

export function buildProxyRuntimePackage(input: ProxyAdapterRuntimeInput): ProxyAdapterRuntimePackage {
  const parserOutput = parseProxyFiling(input.parserInput);
  const routerDecision = buildProxyLlmRouterPlaceholder();
  const displayPayload = buildProxyLlmDisplayPayloadPlaceholder();
  const deterministicAnalysis = null;
  const analysisPrompt = buildProxyAnalysisPrompt({
    parserOutput,
    routerDecision,
    displayPayload,
    marketContext: input.marketContext ?? input.parserInput.market_context ?? null,
  });

  return {
    parser_output: parserOutput,
    router_decision: routerDecision,
    display_payload: displayPayload,
    analysis_prompt: analysisPrompt,
    analysis_output: deterministicAnalysis,
    analysis_mode: PROXY_ANALYSIS_MODE,
    adapter_key: PROXY_ADAPTER_KEY,
    parser_group: PROXY_PARSER_GROUP,
  };
}

export function buildProxyAnalysisPromptFromRuntime(input: ProxyAnalysisPromptInput): string {
  return buildProxyAnalysisPrompt(input);
}

export const proxyAdapter = {
  adapterKey: PROXY_ADAPTER_KEY,
  parserGroup: PROXY_PARSER_GROUP,
  analysisMode: PROXY_ANALYSIS_MODE,
  supportedForms: PROXY_SUPPORTED_FORMS,
  isSupportedForm: isProxySupportedForm,
  parser: parseProxyFiling,
  parse: parseProxyFiling,
  route: routeProxyFiling,
  buildRouterPrompt: buildProxyRouterPrompt,
  buildAnalysisPrompt: buildProxyAnalysisPromptFromRuntime,
  buildRuntimePackage: buildProxyRuntimePackage,
  buildDeterministicAnalysis: buildDeterministicProxyAnalysis,
  deriveDeliveryLevel,
} as const;

export const proxyFormAdapter = proxyAdapter;

function normalizeProxyFormType(formType: string | null | undefined): string {
  return String(formType ?? "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^FORM\s+/, "");
}
