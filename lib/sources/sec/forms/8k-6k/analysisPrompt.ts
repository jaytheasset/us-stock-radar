import { SEC_8K_6K_APPROVED_EVENT_TYPES } from "./types";
import {
  buildSec8k6kPromptInputForLlm,
  SEC_8K_6K_ROUTER_CONFIDENCE_VALUES,
  SEC_8K_6K_ROUTER_DISPLAY_TYPE_VALUES,
  type Sec8k6kRouterPromptInput,
} from "./routerPrompt";
import { buildSec8k6kDisplayPayload } from "./displayPayload";

export const SEC_8K_6K_ANALYSIS_PROMPT_KEY = "sec_8k_6k_analysis_draft";
export const SEC_8K_6K_ANALYSIS_PROMPT_VERSION = "v1";

export const SEC_8K_6K_ANALYSIS_CASE_VALUES = [
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
  "other_8k_6k",
] as const;

export type Sec8k6kAnalysisPromptInput = Sec8k6kRouterPromptInput & {
  router_result: Record<string, unknown>;
  market_context?: Record<string, unknown> | null;
};

const analysisOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "source_group",
    "market_scope",
    "event_type",
    "event_title",
    "primary_ticker",
    "tickers",
    "sector",
    "industry_group",
    "theme_group",
    "sub_theme",
    "score",
    "score_reason",
    "signal",
    "quick_take",
    "summary",
    "why_it_matters",
    "bullish_points",
    "bearish_points",
    "key_evidence",
    "what_to_watch_next",
    "related_tickers",
    "calendar_items",
    "confidence",
    "needs_human_review",
  ],
  properties: {
    source_group: { type: "string", enum: ["filings"] },
    market_scope: { type: "string", enum: ["company", "sector", "theme", "macro"] },
    event_type: { type: "string", enum: SEC_8K_6K_APPROVED_EVENT_TYPES },
    event_title: { type: "string" },
    primary_ticker: {
      type: "object",
      additionalProperties: false,
      required: ["ticker", "exchange"],
      properties: {
        ticker: { type: ["string", "null"] },
        exchange: { type: ["string", "null"] },
      },
    },
    tickers: { type: "array", items: { type: "string" } },
    sector: { type: ["string", "null"] },
    industry_group: { type: ["string", "null"] },
    theme_group: { type: ["string", "null"] },
    sub_theme: { type: ["string", "null"] },
    score: { type: "integer", minimum: 0, maximum: 100 },
    score_reason: { type: "string" },
    signal: { type: "string", enum: ["bullish", "bearish", "volatile", "neutral"] },
    quick_take: { type: "string" },
    summary: { type: "string" },
    why_it_matters: { type: "string" },
    bullish_points: { type: "array", items: { type: "string" } },
    bearish_points: { type: "array", items: { type: "string" } },
    key_evidence: { type: "array", items: { type: "string" } },
    what_to_watch_next: { type: "array", items: { type: "string" } },
    related_tickers: { type: "array", items: { type: "string" } },
    calendar_items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "dateText", "evidence"],
        properties: {
          label: { type: "string" },
          dateText: { type: "string" },
          evidence: { type: "string" },
        },
      },
    },
    confidence: { type: "string", enum: SEC_8K_6K_ROUTER_CONFIDENCE_VALUES },
    needs_human_review: { type: "boolean" },
  },
} as const;

const displayPayloadSchema = {
  type: "object",
  additionalProperties: false,
  required: ["display_type", "data", "evidence", "notes"],
  properties: {
    display_type: { type: "string", enum: SEC_8K_6K_ROUTER_DISPLAY_TYPE_VALUES },
    data: { type: "object", additionalProperties: true },
    evidence: { type: "array", items: { type: "string" } },
    notes: { type: "array", items: { type: "string" } },
  },
} as const;

export const sec8k6kAnalysisResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "analysis_output",
    "display_payload",
    "analysis_case",
    "source_form_scope",
    "source_blocks_used",
    "router",
    "market_context",
    "debug",
  ],
  properties: {
    analysis_output: analysisOutputSchema,
    display_payload: displayPayloadSchema,
    analysis_case: { type: "string", enum: SEC_8K_6K_ANALYSIS_CASE_VALUES },
    source_form_scope: { type: "string", enum: ["8-K / 6-K, 8-K/A / 6-K/A"] },
    source_blocks_used: { type: "array", items: { type: "string" } },
    router: { type: "object", additionalProperties: true },
    market_context: { type: ["object", "null"], additionalProperties: true },
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

export const sec8k6kAnalysisSystemPrompt = [
  "Analyze one SEC 8-K / 6-K, 8-K/A / 6-K/A filing and return only strict JSON matching the provided schema.",
  "Base conclusions only on cleaned_source_blocks, router result, parent filing context source blocks when provided, and site market context source blocks when provided.",
  "Full raw SEC text, XML, HTML, complete attachment text, parser facts, parser signals, parser route hints, and parser-generated event/display labels are intentionally excluded from the prompt. Do not assume missing exhibit text.",
  "Do not invent amounts, dates, tickers, terms, financial metrics, market reaction, or management names that are not present in cleaned_source_blocks or supplied context blocks.",
  "If parser warnings indicate PDF, graphic, binary, truncated, or missing attachment text, reflect uncertainty when relevant; do not treat a parser warning as negative news by itself.",
  "Distinguish filed versus furnished only when cleaned_source_blocks support it.",
  "For 8-K and 8-K/A, read Item numbers, Item excerpts, linked exhibit references, and selected exhibit snippets from cleaned_source_blocks.",
  "For 6-K and 6-K/A, do not expect 8-K Item numbers. Analyze wrapper status, meaningful exhibits, primary-only content, and exhibit role hints from cleaned_source_blocks.",
  "Use router_result.event_type as the analysis_output.event_type. Do not invent event types or change the classifier's event_type.",
  "router_result.score is an archive-gate score only, not the final analysis_output.score.",
  "If router_result.analysis_needed is true, calculate analysis_output.score independently from cleaned_source_blocks, router_result.event_type, score policy, urgency, and source-backed evidence. Do not copy router_result.score into analysis_output.score for analysis-needed cases.",
  "Archive short-circuit cases are different: when router_result.analysis_needed is false and router_result.score is below 50, runtime may persist archive output using the router score without calling the analysis LLM.",
  "Delivery is derived downstream from analysis_output.score and must not be chosen freely.",
  "The UI payload builder has already provided display_payload. Return that display_payload unchanged; do not choose the UI template, display_type, display_version, or invent display payload fields.",
  "Use exactly one approved event_type: listing_risk, dilution_risk, ipo_listing, earnings, sales_performance, product_update, leadership_governance, insider_ownership, shareholder_vote, strategic_transaction, financial_risk, legal_risk, dividends, capital_return, fda_clinical, or other.",
  "For ipo_listing, use the router-selected event_type and the supplied display_payload.data.ipo_kind. Do not split traditional IPO and SPAC IPO into separate event types.",
  "For SPAC/de-SPAC transaction status filings, use the supplied spac_transaction_status display payload when present. Do not treat a plain blank-check IPO with no target or deal status as a SPAC transaction-status page.",
  "Score by investor relevance and immediacy. Below 50 is archive, 50 to 74 is feed, and 75 or above is alert. The delivery level is derived later from score.",
  "Treat 8-K/A and 6-K/A as updates. Analyze only the changed terms or missing parent context. Routine amendment cases should stay below 50 unless the changed content is independently material.",
  "For dilution_risk, compare offering size, shares, warrants, and convertibles against fixture market context if provided. Say market context is needed when those comparisons are material but missing.",
  "For listing_risk, focus on common-equity or ADS delisting impact, cure periods, bid-price rules, hearing deadlines, and reverse-split implications.",
  "For strategic_transaction, distinguish signed agreements, completed closings, optional letters of intent, and terminated transactions.",
  "For fda_clinical, explain endpoint or regulatory consequence without overstating approval probability.",
  "Keep quick_take concise, evidence-backed, and investor-facing. Put exact source snippets in key_evidence.",
  "Use the supplied display_payload.display_type and display_payload.data.display_version. Never create a new display type or detail UI version.",
  "For archive-score filings, do not manufacture bullish_points, bearish_points, or what_to_watch_next. Keep those arrays empty when the source filing does not support them.",
  "For archive-score filings, use display_payload.display_type generic and put compact archive handoff fields in display_payload.data when available: archive_summary, archive_reason, source_url, source_availability_note, selected_source_snippets, selected_tables, and attachment_inventory. Do not put full raw text, XML, or complete attachment text in display_payload.",
].join("\n");

export function buildSec8k6kAnalysisPromptDraft(input: Sec8k6kAnalysisPromptInput) {
  const displayPayload = buildSec8k6kDisplayPayload({
    parser_output: input.parser_output,
    router_result: input.router_result,
    market_context: input.market_context,
  });
  return {
    key: SEC_8K_6K_ANALYSIS_PROMPT_KEY,
    version: SEC_8K_6K_ANALYSIS_PROMPT_VERSION,
    system: sec8k6kAnalysisSystemPrompt,
    user: JSON.stringify({
      ...buildSec8k6kPromptInputForLlm(input),
      router_result: input.router_result,
      display_payload: displayPayload,
      market_context: input.market_context ?? null,
    }),
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "sec_8k_6k_analysis",
        strict: true,
        schema: sec8k6kAnalysisResponseSchema,
      },
    },
  };
}
