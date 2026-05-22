import { SEC_EVENT_TYPE_VALUES } from "@/lib/prompts/secFilingAnalysis";

export const SEC_OTHER_ROUTER_PROMPT_KEY = "sec_other_router_draft";
export const SEC_OTHER_ROUTER_PROMPT_VERSION = "v1";

export const SEC_OTHER_ROUTER_ACTION_VALUES = ["archive", "feed", "feed_alert"] as const;
export const SEC_OTHER_ROUTER_DISPLAY_MODEL_VALUES = [
  "generic_filing",
  "offering_terms",
  "ownership",
  "governance",
  "calendar",
  "none",
] as const;
export const SEC_OTHER_ROUTER_CONFIDENCE_VALUES = ["high", "medium", "low"] as const;

export type SecOtherRouterPromptInput = {
  filing_package: Record<string, unknown>;
  parser_facts: Record<string, unknown>;
  filing_excerpt?: string | null;
};

export const secOtherRouterSystemPrompt = [
  "Route one fallback Other SEC Filing after the generic other parser has extracted candidate facts.",
  "Return only strict JSON matching the provided schema.",
  "This is a conservative fallback router. Prefer event_type other and action archive unless the filing text clearly supports an existing canonical event type.",
  "Do not invent new event_type values. Use only the canonical event types in the schema.",
  "Parser facts are candidate evidence only. Use the filing excerpt and parser evidence together; reject unsupported hints.",
  "If the filing looks like routine correspondence, administrative material, an exhibit-only update, or an unclear SEC filing, set event_type other, score below 50, action archive, and display_model_type generic_filing or none.",
  "Route to dilution_risk only when the source text clearly discloses an offering, resale registration, ATM, warrant, convertible, private placement, equity line, or share-overhang mechanic.",
  "Route to listing_risk only when the source text clearly discloses exchange deficiency, delisting, minimum-bid compliance, trading suspension, or compliance recovery.",
  "Route to shareholder_vote only for explicit meeting, vote, proposal, consent solicitation, approval, or record-date content.",
  "Route to leadership_governance only for executive, board, auditor, control, compensation, material weakness, or governance changes.",
  "Route to strategic_transaction only for merger, acquisition, tender, asset sale, joint venture, partnership, license, financing-party deal, or material agreement disclosures.",
  "Route to financial_risk only for going concern, liquidity, default, debt, covenant, restructuring, bankruptcy, or financing stress disclosures.",
  "Route to legal_risk only for lawsuits, investigations, subpoenas, settlements, enforcement, or material regulatory proceedings.",
  "Use action thresholds consistently: score below 50 archive, 50-74 feed, 75 or above feed_alert.",
  "When evidence is mixed or ambiguous, choose the lower score, lower action, and lower confidence.",
  "Document future dedicated parser candidates when the same fallback pattern should become a form room, but do not create a new event type.",
].join("\n");

export const secOtherRouterResponseSchema = {
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
    "routing_reason",
    "evidence",
    "parser_facts_used",
    "future_dedicated_parser_candidate",
    "debug",
  ],
  properties: {
    source_group: { type: "string", enum: ["filings"] },
    source_form_type: { type: "string" },
    analysis_family: { type: "string", enum: ["sec_other_fallback"] },
    event_type: { type: "string", enum: SEC_EVENT_TYPE_VALUES },
    display_model_type: { type: "string", enum: SEC_OTHER_ROUTER_DISPLAY_MODEL_VALUES },
    score: { type: "integer", minimum: 0, maximum: 100 },
    confidence: { type: "string", enum: SEC_OTHER_ROUTER_CONFIDENCE_VALUES },
    action: { type: "string", enum: SEC_OTHER_ROUTER_ACTION_VALUES },
    routing_reason: { type: "string" },
    evidence: { type: "array", items: { type: "string" } },
    parser_facts_used: { type: "array", items: { type: "string" } },
    future_dedicated_parser_candidate: {
      type: "object",
      additionalProperties: false,
      required: ["needed", "reason", "suggested_room"],
      properties: {
        needed: { type: "boolean" },
        reason: { type: ["string", "null"] },
        suggested_room: { type: ["string", "null"] },
      },
    },
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

export function buildSecOtherRouterPromptDraft(input: SecOtherRouterPromptInput) {
  return {
    key: SEC_OTHER_ROUTER_PROMPT_KEY,
    version: SEC_OTHER_ROUTER_PROMPT_VERSION,
    system: secOtherRouterSystemPrompt,
    user: JSON.stringify(input),
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "sec_other_router",
        strict: true,
        schema: secOtherRouterResponseSchema,
      },
    },
  };
}
