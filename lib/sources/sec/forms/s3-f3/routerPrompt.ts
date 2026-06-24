import { SEC_EVENT_TYPE_VALUES } from "@/lib/prompts/secFilingAnalysis";
import { buildSecSourceBlockPromptInput } from "../common/sourceBlockPromptInput";

export const SEC_S3_F3_ROUTER_PROMPT_KEY = "sec_s3_f3_router_draft";
export const SEC_S3_F3_ROUTER_PROMPT_VERSION = "v1";

export const SEC_S3_F3_ROUTER_ACTION_VALUES = ["archive", "feed", "feed_alert"] as const;
export const SEC_S3_F3_ROUTER_CONFIDENCE_VALUES = ["high", "medium", "low"] as const;
export const SEC_S3_F3_ROUTER_DISPLAY_MODEL_VALUES = ["offering_terms", "generic_filing", "calendar", "none"] as const;
export const SEC_S3_F3_ROUTER_CASE_VALUES = [
  "base_shelf_registration",
  "automatic_shelf_registration",
  "resale_registration",
  "atm_program",
  "priced_takedown_supplement",
  "warrant_or_convertible_overhang",
  "routine_amendment",
  "material_amendment",
  "needs_human_review",
  "other",
] as const;

export type SecS3F3RouterPromptInput = {
  filing_package: Record<string, unknown>;
  parser_facts: Record<string, unknown>;
  parser_output?: Record<string, unknown>;
  filing_excerpt?: string | null;
};

export const secS3F3RouterSystemPrompt = [
  "Route one SEC S-3/F-3 family filing from cleaned source blocks.",
  "Return only strict JSON matching the provided schema.",
  "This draft covers S-3, S-3/A, S-3ASR, S-3MEF, F-3, F-3/A, F-3ASR, and F-3MEF. Do not route broad SEC events here unless the filing content truly belongs to this family.",
  "Classify by economic structure, not only by form label: base shelf registration, automatic shelf registration, resale registration, ATM program, priced or takedown supplement, warrant or convertible overhang, routine amendment, material amendment, needs_human_review, or other.",
  "Use only cleaned_source_blocks. Do not use parser-generated facts, signals, route hints, extraction summaries, event labels, display labels, or investment labels as classification authority.",
  "Route to dilution_risk when the filing contains shelf, resale, ATM, warrant, convertible, concrete offering amount, fee table economics, selling-holder overhang, or other share-supply mechanics.",
  "Use other and archive only for routine administrative content, unclear records, or amendments with no investor-relevant changed offering terms.",
  "For S-3/A and F-3/A, preserve routine amendment handling: exhibit-only, consent-only, signature-only, unchanged-remainder, refiled fee-table exhibit, or no-other-changes amendments should normally be archive below 50 unless changed economics are evident.",
  "For material amendments, focus on what changed: offering size, registered shares, selling holders, fee table economics, ATM terms, warrant terms, conversion terms, distribution plan, or use of proceeds.",
  "Use display_model_type offering_terms for dilution/offering mechanics and generic_filing or none for routine archives.",
  "Use action thresholds consistently: score below 50 archive, 50-74 feed, 75 or above feed_alert.",
  "When evidence is ambiguous, choose needs_human_review, lower confidence, and avoid alerting unless the concrete terms are strong.",
].join("\n");

export const secS3F3RouterResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "source_group",
    "source_form_type",
    "analysis_family",
    "event_type",
    "display_model_type",
    "score",
    "confidence",
    "action",
    "route_case",
    "routing_reason",
    "evidence",
    "source_blocks_used",
    "needs_human_review",
    "debug",
  ],
  properties: {
    source_group: { type: "string", enum: ["filings"] },
    source_form_type: { type: "string" },
    analysis_family: { type: "string", enum: ["sec_s3_f3_offering"] },
    event_type: { type: "string", enum: SEC_EVENT_TYPE_VALUES },
    display_model_type: { type: "string", enum: SEC_S3_F3_ROUTER_DISPLAY_MODEL_VALUES },
    score: { type: "integer", minimum: 0, maximum: 100 },
    confidence: { type: "string", enum: SEC_S3_F3_ROUTER_CONFIDENCE_VALUES },
    action: { type: "string", enum: SEC_S3_F3_ROUTER_ACTION_VALUES },
    route_case: { type: "string", enum: SEC_S3_F3_ROUTER_CASE_VALUES },
    routing_reason: { type: "string" },
    evidence: { type: "array", items: { type: "string" } },
    source_blocks_used: { type: "array", items: { type: "string" } },
    needs_human_review: { type: "boolean" },
    debug: {
      type: "object",
      additionalProperties: false,
      required: ["parser_version", "router_prompt_key", "router_prompt_version"],
      properties: {
        parser_version: { type: ["string", "null"] },
        router_prompt_key: { type: "string" },
        router_prompt_version: { type: "string" },
      },
    },
  },
} as const;

export function buildSecS3F3RouterPromptDraft(input: SecS3F3RouterPromptInput) {
  return {
    key: SEC_S3_F3_ROUTER_PROMPT_KEY,
    version: SEC_S3_F3_ROUTER_PROMPT_VERSION,
    system: secS3F3RouterSystemPrompt,
    user: JSON.stringify(
      buildSecSourceBlockPromptInput({
        filingPackage: input.filing_package,
        parserOutput: input.parser_output || { facts: input.parser_facts },
        fallbackText: input.filing_excerpt,
      }),
    ),
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "sec_s3_f3_router",
        strict: true,
        schema: secS3F3RouterResponseSchema,
      },
    },
  };
}
