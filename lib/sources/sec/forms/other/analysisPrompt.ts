import { secFilingAnalysisResponseSchema } from "@/lib/prompts/secFilingAnalysis";
import {
  SEC_OTHER_ROUTER_ACTION_VALUES,
  SEC_OTHER_ROUTER_DISPLAY_MODEL_VALUES,
  type SecOtherRouterPromptInput,
} from "./routerPrompt";

export const SEC_OTHER_ANALYSIS_PROMPT_KEY = "sec_other_analysis_draft";
export const SEC_OTHER_ANALYSIS_PROMPT_VERSION = "v1";

export type SecOtherAnalysisPromptInput = SecOtherRouterPromptInput & {
  router_result: Record<string, unknown>;
  market_context?: Record<string, unknown> | null;
};

export const secOtherAnalysisSystemPrompt = [
  "Analyze one SEC Other Filing fallback candidate and return only strict JSON matching the provided response schema.",
  "Use the filing excerpt and source-backed parser facts as the source of truth. Do not invent facts, dates, tickers, values, schedules, or counterparties.",
  "The router result is a non-authoritative routing hint. If source evidence does not support the route, lower the event_type to other, lower the score, and explain the evidence gap.",
  "Fallback output should be conservative. Administrative, routine, correspondence, exhibit-only, or unclear filings should be archived with score below 50.",
  "Use the common score/action policy: score below 50 action archive; 50-74 action feed; 75 or above action feed_alert.",
  "For event_type other, normally use display_model_type generic_filing or none, confidence low or medium, and a concise summary that says what the filing appears to be.",
  "For a canonical event type, cite short source-backed evidence and keep the analysis focused on the investor-relevant disclosure, not the SEC form label.",
  "Do not produce offering-specific calculations. If the filing contains offering or dilution mechanics, preserve extracted source facts and leave dilution math to market-context code.",
  "Do not add calendar_items unless the filing states an investor-relevant scheduled date or deadline.",
  "Keep all user-facing text compact and natural. Do not expose parser field names or schema language in summaries.",
].join("\n");

export const secOtherAnalysisResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    ...secFilingAnalysisResponseSchema.required,
    "source_form_type",
    "analysis_family",
    "display_model_type",
    "action",
    "parser_facts",
    "router",
    "market_context",
    "display_model",
    "debug",
  ],
  properties: {
    ...secFilingAnalysisResponseSchema.properties,
    source_form_type: { type: "string" },
    analysis_family: { type: "string", enum: ["sec_other_fallback"] },
    display_model_type: { type: "string", enum: SEC_OTHER_ROUTER_DISPLAY_MODEL_VALUES },
    action: { type: "string", enum: SEC_OTHER_ROUTER_ACTION_VALUES },
    parser_facts: { type: "object", additionalProperties: true },
    router: { type: "object", additionalProperties: true },
    market_context: { type: ["object", "null"], additionalProperties: true },
    display_model: { type: ["object", "null"], additionalProperties: true },
    debug: {
      type: "object",
      additionalProperties: false,
      required: ["parser_version", "router_prompt_key", "router_prompt_version", "analysis_prompt_key", "analysis_prompt_version"],
      properties: {
        parser_version: { type: ["string", "null"] },
        router_prompt_key: { type: ["string", "null"] },
        router_prompt_version: { type: ["string", "null"] },
        analysis_prompt_key: { type: "string" },
        analysis_prompt_version: { type: "string" },
      },
    },
  },
} as const;

export function buildSecOtherAnalysisPromptDraft(input: SecOtherAnalysisPromptInput) {
  return {
    key: SEC_OTHER_ANALYSIS_PROMPT_KEY,
    version: SEC_OTHER_ANALYSIS_PROMPT_VERSION,
    system: secOtherAnalysisSystemPrompt,
    user: JSON.stringify(input),
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "sec_other_analysis",
        strict: true,
        schema: secOtherAnalysisResponseSchema,
      },
    },
  };
}
