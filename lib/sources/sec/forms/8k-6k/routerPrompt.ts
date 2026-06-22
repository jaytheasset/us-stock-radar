import { buildSecSourceBlockPromptInput } from "./sourceBlockPromptInput";
import { SEC_8K_6K_APPROVED_EVENT_TYPES } from "./types";

export const SEC_8K_6K_ROUTER_PROMPT_KEY = "sec_8k_6k_router_draft";
export const SEC_8K_6K_ROUTER_PROMPT_VERSION = "v1";

export const SEC_8K_6K_ROUTER_ACTION_VALUES = ["archive", "feed", "alert"] as const;
export const SEC_8K_6K_ROUTER_CONFIDENCE_VALUES = ["high", "medium", "low"] as const;
export const SEC_8K_6K_ROUTER_DISPLAY_TYPE_VALUES = ["generic", "offering_terms", "spac_transaction_status", "candidate_special"] as const;
export const SEC_8K_6K_ROUTER_DISPLAY_VERSION_VALUES = [
  "sec_8k_6k_generic_v1",
  "sec_8k_6k_offering_terms_v1",
  "sec_8k_6k_spac_transaction_status_v1",
  "sec_8k_6k_candidate_special_v1",
] as const;
export const SEC_8K_6K_ROUTER_CASE_VALUES = [
  "listing_risk",
  "dilution_or_offering",
  "ipo_listing",
  "earnings_or_results",
  "sales_or_operating_update",
  "product_or_commercial_update",
  "leadership_or_governance",
  "insider_or_control_update",
  "shareholder_vote",
  "strategic_transaction",
  "financial_distress_or_default",
  "legal_or_regulatory_risk",
  "dividend",
  "capital_return",
  "fda_or_clinical",
  "routine_amendment",
  "material_amendment",
  "other",
] as const;

export type Sec8k6kRouterPromptInput = {
  filing_package: Record<string, unknown>;
  parser_output: Record<string, unknown>;
  filing_excerpt?: string | null;
  parent_filing_context?: Record<string, unknown> | null;
};

export const sec8k6kRouterSystemPrompt = [
  "You are the SEC 8-K / 6-K router for Stock Radar. Route one SEC 8-K / 6-K, 8-K/A / 6-K/A filing and return only strict JSON matching the provided schema.",
  "Use only cleaned_source_blocks, source/document/attachment inventory blocks, parser warnings, parent filing context blocks when supplied, and site market context blocks when supplied.",
  "Do not use full raw SEC text, full attachment text, outside knowledge, live market data, parser-generated labels, parser scores, parser classifications, or investment labels as classification authority.",
  "If a block contains source-backed filing language, use that language. Ignore fields that look like parser interpretation rather than filing text.",
  "Missing, PDF, graphic, binary, or truncated text means source coverage may be incomplete; it is not negative news by itself.",
  "For 8-K and 8-K/A, use Item numbers, headings, item excerpts, exhibit references, and selected exhibit snippets as evidence, but do not classify by Item number alone.",
  "For 6-K and 6-K/A, do not expect 8-K Item numbers. When the primary document is only a wrapper, treat the exhibit or attached report as the likely real filing content.",
  "Choose exactly one approved event_type: listing_risk, dilution_risk, ipo_listing, earnings, sales_performance, product_update, leadership_governance, insider_ownership, shareholder_vote, strategic_transaction, financial_risk, legal_risk, dividends, capital_return, fda_clinical, or other.",
  "Primary-event rule: classify by the main source-backed new fact. Use the document hierarchy: headline, exhibit title, first event paragraph, item heading, transaction/resolution/action language, and financial tables usually outrank boilerplate, About sections, contacts, forward-looking statements, risk factors, background profile text, and notes that merely support financial statements.",
  "Event semantics rule: choose the economic substance, not a trigger word. Financial results packages are earnings; narrow operating metrics are sales_performance; commercial/product/operational updates are product_update; shareholder meeting notices or results are shareholder_vote; leadership, board, auditor, control, ownership, transaction, financing/dilution, stress/default/restatement, litigation/regulatory, dividend, buyback, FDA/clinical, IPO/listing, and other events should map to their matching approved event_type.",
  "Dominance rule: when one filing contains multiple themes, pick the primary event and preserve secondary facts as evidence. A transaction paid in shares is still strategic_transaction when the acquisition/merger is the main event; share issuance is evidence, not automatically dilution_risk. A results package is not reclassified because a note mentions historical acquisitions, litigation, debt, or accounting details.",
  "Other rule: use other only when the filing's main source-backed event is administrative, referential, corrective, housekeeping, or outside the approved event taxonomy. Do not classify by keywords alone. Classify by the filing's main event, not by background descriptions, company profile language, risk factor references, historical disclosures, or incidental mentions.",
  "Do not use other merely because the filing seems low impact. Low impact affects archive gating; other is only for filings whose main event does not fit a substantive approved event_type.",
  "Do not classify a filing as other merely because it relates to a previously announced event. If it reports a new source-backed status change, approval, vote result, closing, termination, redemption result, condition satisfaction or failure, financing change, default, waiver, acceleration, listing change, ticker change, regulatory decision, or material amendment, classify it by the substantive event_type.",
  "Use other only when the filing does not add a substantive new event, condition, result, risk, economic term, financing effect, ownership change, vote outcome, litigation development, listing risk, earnings release, capital return, or strategic transaction.",
  "Examples usually suitable for other unless substantive new facts are present: total voting rights, block listing return, issued share capital update, routine treasury share movement with no buyback authorization, repurchase program update, cancellation, or shareholder return effect, employee plan share issuance without financing terms, analyst meeting schedule, investor presentation furnishing only with no new material event, officer certification only, coverage ratio exhibit only, exchange-rate or reference notice, routine exhibit filing, and minor correction, typo fix, or exhibit refile.",
  "Mechanical share count or denominator updates are not dilution_risk unless the source text shows a substantive financing, investor issuance, securities terms, proceeds, conversion, warrant exercise, offering, resale registration, or materially dilutive transaction.",
  "Insider ownership boundary: use insider_ownership only for a named insider, director, officer, PDMR, reporting person, beneficial owner, shareholder group, or control holder transaction, ownership change, voting-power change, dispositive-power change, or transaction-status change. Share count, total voting rights, block listing, issued capital denominator updates, or employee share-plan issuance are not insider_ownership unless a named holder transaction or ownership change is the main event.",
  "When in doubt, ask: what changed in this filing? If the answer is only that a document was furnished, a count was updated, a typo was corrected, or reference material was filed, use other. If the answer is that a deal closed, vote passed, condition changed, financing terms changed, default occurred, redemption happened, approval was received, or risk became active, do not use other.",
  "Clinical rule: use fda_clinical only when the main event announces a clinical or regulatory development. Pipeline descriptions, prior trial data, or planned study language inside boilerplate/background text do not control classification.",
  "IPO/SPAC rule: use ipo_listing only for the IPO/direct-listing/listing event itself. SPAC or de-SPAC business-combination status, vote, redemption, closing-condition, or ticker-change updates classify by the main event, often strategic_transaction or shareholder_vote, with spac_transaction_status only when enough transaction facts exist.",
  "Amendment rule: for 8-K/A and 6-K/A, decide whether the amendment is routine, supplemental, or materially changes the original event. Clearly clerical amendments are archive/other; substantive amendments need analysis. If parent comparison is needed and parent_filing_context is absent, set needs_parent_context true and do not over-score.",
  "Choose display_type from the approved list only: generic, offering_terms, spac_transaction_status, candidate_special.",
  "Use offering_terms when source blocks contain offering, financing, warrant, convertible, PIPE, ATM, or share issuance terms suitable for the offering UI.",
  "Use spac_transaction_status only when source blocks show enough SPAC/de-SPAC transaction facts to populate that page. Do not use it for a plain blank-check IPO with no target or transaction-status update.",
  "Use candidate_special only when the filing clearly needs a new detail UI and existing display types are insufficient; otherwise use generic.",
  "Router score is only an archive gate, not the final materiality score. If the filing can safely stop at compact archive display, use score 0-49, delivery_level archive, and analysis_needed false. Otherwise use score 50, delivery_level feed, and analysis_needed true so the analysis LLM assigns the final score.",
  "Do not use router delivery_level alert. Alert is only possible after the analysis LLM assigns a final score of 75 or higher.",
  "Archive only when source blocks clearly show routine administration, low incremental investor impact, a routine amendment, an empty wrapper with no meaningful exhibit text, or source coverage too incomplete to support material classification. If uncertain, set analysis_needed true with low or medium confidence.",
  "Evidence must cite short source-backed facts from cleaned_source_blocks. Do not quote huge passages, cite parser labels, invent values, or infer market reaction.",
  "Delivery is downstream score-derived. In router output, delivery_level must stay consistent with the router gate score.",
].join("\n");

export const sec8k6kRouterResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "source_group",
    "source_form_scope",
    "event_type",
    "route_case",
    "score",
    "delivery_level",
    "display_type",
    "display_version",
    "ipo_kind",
    "analysis_needed",
    "needs_parent_context",
    "confidence",
    "routing_reason",
    "evidence",
    "source_blocks_used",
    "market_context_needed",
    "market_context_reason",
    "market_context_fields",
    "debug",
  ],
  properties: {
    source_group: { type: "string", enum: ["filings"] },
    source_form_scope: { type: "string", enum: ["8-K / 6-K, 8-K/A / 6-K/A"] },
    event_type: { type: "string", enum: SEC_8K_6K_APPROVED_EVENT_TYPES },
    route_case: { type: "string", enum: SEC_8K_6K_ROUTER_CASE_VALUES },
    score: {
      type: "integer",
      minimum: 0,
      maximum: 100,
      description: "Router archive gate only: 0-49 archive short-circuit, 50 analysis-needed feed-or-higher candidate. Final materiality score comes from analysis LLM.",
    },
    delivery_level: {
      type: "string",
      enum: SEC_8K_6K_ROUTER_ACTION_VALUES,
      description: "Router gate delivery only. Use archive for score < 50, feed for analysis-needed candidates, and do not use alert in router output.",
    },
    display_type: { type: "string", enum: SEC_8K_6K_ROUTER_DISPLAY_TYPE_VALUES },
    display_version: { type: "string", enum: SEC_8K_6K_ROUTER_DISPLAY_VERSION_VALUES },
    ipo_kind: { type: ["string", "null"], enum: ["traditional", "spac", null] },
    analysis_needed: { type: "boolean" },
    needs_parent_context: { type: "boolean" },
    confidence: { type: "string", enum: SEC_8K_6K_ROUTER_CONFIDENCE_VALUES },
    routing_reason: { type: "string" },
    evidence: { type: "array", items: { type: "string" } },
    source_blocks_used: { type: "array", items: { type: "string" } },
    market_context_needed: { type: "boolean" },
    market_context_reason: { type: ["string", "null"] },
    market_context_fields: { type: "array", items: { type: "string" } },
    debug: {
      type: "object",
      additionalProperties: false,
      required: ["parser_version", "router_prompt_key", "router_prompt_version"],
      properties: {
        parser_version: { type: ["string", "null"] },
        router_prompt_key: { type: "string", enum: [SEC_8K_6K_ROUTER_PROMPT_KEY] },
        router_prompt_version: { type: "string", enum: [SEC_8K_6K_ROUTER_PROMPT_VERSION] },
      },
    },
  },
} as const;

export function buildSec8k6kRouterPromptDraft(input: Sec8k6kRouterPromptInput) {
  return {
    key: SEC_8K_6K_ROUTER_PROMPT_KEY,
    version: SEC_8K_6K_ROUTER_PROMPT_VERSION,
    system: sec8k6kRouterSystemPrompt,
    user: JSON.stringify(buildSec8k6kPromptInputForLlm(input)),
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "sec_8k_6k_router",
        strict: true,
        schema: sec8k6kRouterResponseSchema,
      },
    },
  };
}

export function buildSec8k6kPromptInputForLlm(input: Sec8k6kRouterPromptInput) {
  return buildSecSourceBlockPromptInput({
    filingPackage: input.filing_package,
    parserOutput: toRecord(input.parser_output),
    fallbackText: input.filing_excerpt,
    parentFilingContext: input.parent_filing_context,
  });
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
