import { secFilingAnalysisResponseSchema } from "@/lib/prompts/secFilingAnalysis";
import {
  SEC_S3_F3_ROUTER_ACTION_VALUES,
  SEC_S3_F3_ROUTER_DISPLAY_MODEL_VALUES,
  type SecS3F3RouterPromptInput,
} from "./routerPrompt";

export const SEC_S3_F3_ANALYSIS_PROMPT_KEY = "sec_s3_f3_analysis_draft";
export const SEC_S3_F3_ANALYSIS_PROMPT_VERSION = "v1";

export const SEC_S3_F3_ANALYSIS_CASE_VALUES = [
  "base_shelf",
  "automatic_shelf",
  "resale_registration",
  "atm_program",
  "mixed_shelf",
  "universal_shelf",
  "priced_takedown_supplement",
  "warrant_or_convertible_overhang",
  "routine_amendment",
  "material_amendment",
  "other_s3_f3",
] as const;

export type SecS3F3AnalysisPromptInput = SecS3F3RouterPromptInput & {
  router_result: Record<string, unknown>;
  market_context?: Record<string, unknown> | null;
};

export const secS3F3AnalysisSystemPrompt = [
  "Analyze one SEC S-3/F-3 family filing and return only strict JSON matching the provided response schema.",
  "Use source-backed filing text, parser facts, router result, and market context as evidence. Do not invent offering terms, dates, amounts, tickers, holders, or dilution math.",
  "This family is the offering/dilution baseline. Keep severity comparable to S-3 offering score 80, F-3 offering score 80, 424B5 offering score 80, and S-8 dilution score 80.",
  "Use the common score/action policy: score below 50 action archive; 50-74 action feed; 75 or above action feed_alert.",
  "Set event_type to dilution_risk for shelf, resale, ATM, warrant, convertible, fee-table economics, selling-holder overhang, concrete offering size, or share-supply mechanics unless the filing clearly belongs only to other.",
  "Base shelf or automatic shelf filings without concrete current sale mechanics usually belong in feed-level severity, not alert-level severity.",
  "ATM programs, priced/takedown supplements, large resale pools, warrant coverage, convertible share pools, and concrete offering amounts can justify alert-level severity when market context supports materiality.",
  "For S-3/A and F-3/A, analyze only changed or unresolved terms. Routine housekeeping amendments should archive below 50 and should not restate parent filing economics as a new event.",
  "Use display_model_type offering_terms when there are offering or dilution mechanics; use generic_filing or none for routine archive outcomes.",
  "Preserve parser_facts, router, market_context, and display_model objects in machine-readable form. Keep user-facing text compact and investor-focused.",
  "Do not add calendar_items for base shelf filing dates or vague future sale language. Add them only for exact offering closings, registration effectiveness, warrant deadlines, lock-up expirations, rights deadlines, or financing-related shareholder approval deadlines.",
].join("\n");

export const secS3F3AnalysisResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    ...secFilingAnalysisResponseSchema.required,
    "source_form_type",
    "analysis_family",
    "display_model_type",
    "action",
    "s3_f3_case",
    "parser_facts",
    "router",
    "market_context",
    "display_model",
    "debug",
  ],
  properties: {
    ...secFilingAnalysisResponseSchema.properties,
    source_form_type: { type: "string" },
    analysis_family: { type: "string", enum: ["sec_s3_f3_offering"] },
    display_model_type: { type: "string", enum: SEC_S3_F3_ROUTER_DISPLAY_MODEL_VALUES },
    action: { type: "string", enum: SEC_S3_F3_ROUTER_ACTION_VALUES },
    s3_f3_case: { type: "string", enum: SEC_S3_F3_ANALYSIS_CASE_VALUES },
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

export function buildSecS3F3AnalysisPromptDraft(input: SecS3F3AnalysisPromptInput) {
  return {
    key: SEC_S3_F3_ANALYSIS_PROMPT_KEY,
    version: SEC_S3_F3_ANALYSIS_PROMPT_VERSION,
    system: secS3F3AnalysisSystemPrompt,
    user: JSON.stringify(input),
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "sec_s3_f3_analysis",
        strict: true,
        schema: secS3F3AnalysisResponseSchema,
      },
    },
  };
}
