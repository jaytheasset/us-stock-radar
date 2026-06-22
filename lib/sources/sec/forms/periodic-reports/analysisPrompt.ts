import type { PeriodicDisplayPayload, PeriodicParserOutput } from "./types";
import { buildSecPeriodicReportsSourceBlockPromptInput, type SecPeriodicReportsRouterPromptInput } from "./routerPrompt.ts";

export const SEC_PERIODIC_REPORTS_ANALYSIS_PROMPT_KEY = "sec_periodic_reports_analysis_draft";
export const SEC_PERIODIC_REPORTS_ANALYSIS_PROMPT_VERSION = "v3";

const PERIODIC_REPORTS_FORM_SCOPE = "10-K / 10-Q / 20-F, 10-K/A / 10-Q/A / 20-F/A";
const APPROVED_SEC_EVENT_TYPES = [
  "listing_risk",
  "dilution_risk",
  "ipo_listing",
  "earnings",
  "sales_performance",
  "product_update",
  "leadership_governance",
  "insider_ownership",
  "shareholder_vote",
  "strategic_transaction",
  "financial_risk",
  "legal_risk",
  "dividends",
  "capital_return",
  "fda_clinical",
  "other",
] as const;
const PERIODIC_REPORT_DISPLAY_TYPES = ["generic", "offering_terms", "candidate_special"] as const;

export type SecPeriodicReportsAnalysisPromptInput = SecPeriodicReportsRouterPromptInput & {
  parser_output: PeriodicParserOutput;
  router_result: Record<string, unknown>;
  display_payload: PeriodicDisplayPayload;
  market_context?: Record<string, unknown> | null;
};

const parserOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["parserVersion", "parserGroup", "formType", "accessionNumber", "isSupported", "summary", "facts", "signals", "calendarItems", "warnings", "raw"],
  properties: {
    parserVersion: { type: "string" },
    parserGroup: { type: "string", enum: ["periodic-reports"] },
    formType: { type: "string" },
    accessionNumber: { type: ["string", "null"] },
    isSupported: { type: "boolean" },
    summary: { type: ["string", "null"] },
    facts: { type: "object", additionalProperties: true },
    signals: { type: "array", items: { type: "object", additionalProperties: true } },
    calendarItems: { type: "array", items: { type: "object", additionalProperties: true } },
    warnings: { type: "array", items: { type: "string" } },
    raw: { type: "object", additionalProperties: true },
  },
} as const;

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
    event_type: { type: "string", enum: APPROVED_SEC_EVENT_TYPES },
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
    calendar_items: { type: "array", items: { type: "object", additionalProperties: true } },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    needs_human_review: { type: "boolean" },
  },
} as const;

const displayPayloadSchema = {
  type: "object",
  additionalProperties: false,
  required: ["display_type", "data", "evidence", "notes"],
  properties: {
    display_type: { type: "string", enum: PERIODIC_REPORT_DISPLAY_TYPES },
    data: { type: "object", additionalProperties: true },
    evidence: { type: "array", items: { type: "string" } },
    notes: { type: "array", items: { type: "string" } },
  },
} as const;

const fixtureExpectedSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "expected_delivery_level",
    "expected_impact",
    "market_context_needed",
    "market_context_reason",
    "market_context_fields",
    "special_ui_needed",
    "special_ui_reason",
    "integration_notes",
  ],
  properties: {
    expected_delivery_level: { type: "string", enum: ["archive", "feed", "alert"] },
    expected_impact: { type: "string", enum: ["low", "medium", "high"] },
    market_context_needed: { type: "boolean" },
    market_context_reason: { type: ["string", "null"] },
    market_context_fields: { type: "array", items: { type: "string" } },
    special_ui_needed: { type: "boolean" },
    special_ui_reason: { type: ["string", "null"] },
    integration_notes: { type: "array", items: { type: "string" } },
  },
} as const;

export const secPeriodicReportsAnalysisResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["parser_output", "analysis_output", "display_payload", "fixture_expected"],
  properties: {
    parser_output: parserOutputSchema,
    analysis_output: analysisOutputSchema,
    display_payload: displayPayloadSchema,
    fixture_expected: fixtureExpectedSchema,
  },
} as const;

export const secPeriodicReportsAnalysisSystemPrompt = [
  `Analyze one SEC periodic report filing in scope: ${PERIODIC_REPORTS_FORM_SCOPE}.`,
  "Return only strict JSON matching the required room result shape: parser_output, analysis_output, display_payload, and fixture_expected.",
  "Use cleaned_source_blocks as the evidence base. Do not invent source links, accession numbers, tickers, dates, or evidence.",
  "Do not use parser-generated facts, signals, route hints, deterministic classification, extraction summaries, event labels, display labels, or investment labels as analysis authority.",
  "Use router_result as the selected classification, not a suggestion. The analysis LLM writes investor-facing copy only.",
  "Copy analysis_output.event_type from router_result.event_type or parser deterministic classification. Do not choose, alter, invent, or rename event types.",
  "Copy display_payload from the supplied display_payload. Do not choose the UI template, do not invent UI fields, and do not create display types.",
  "If event_type is ipo_listing, preserve display_payload.data.ipo_kind as traditional or spac when supplied; do not split ipo_listing into separate event types.",
  "Score bands are fixed and must not be changed: score below 50 is archive, 50 to 74 is feed, 75 or above is alert.",
  "The delivery level belongs in fixture_expected.expected_delivery_level and must be derived from analysis_output.score.",
  "Use market context only when supplied as fixture market_context. Do not call or ask for live market data.",
  "For earnings and sales_performance, emphasize period-over-period revenue, profit/loss, margins, demand metrics, and management context only when source-backed.",
  "For financial_risk, emphasize going-concern language, liquidity runway, debt maturity, covenant or default risk, and whether market context is needed to size the issue.",
  "For legal_risk, use only disclosed proceedings, investigations, enforcement actions, or loss contingencies. Do not infer guilt or liability beyond the filing.",
  "For dividends and capital_return, include exact dividend, record/payable dates, buyback authorization, or repurchase activity only when source-backed.",
  "For ipo_listing, discuss only source-backed IPO/listing facts such as traditional IPO, SPAC IPO, direct listing, IPO pricing, first trading/listing date, or registration effectiveness tied to a new public listing.",
  "Do not treat ordinary resale registration, shelf offerings, ATM/offering dilution, already-listed issuer resale, post-closing business updates, SPAC redemption, liquidation, or de-SPAC updates as ipo_listing unless the IPO/listing itself is the dominant event.",
  "For 10-K/A, 10-Q/A, and 20-F/A, analyze only the change from the parent filing. Routine exhibit-only, certification-only, signature-only, XBRL-only, or no-other-change amendments should archive as other.",
  "Deterministic archive handling is allowed only when router_result says analysis_llm_needed is false for mechanically clear routine source text.",
  "If router_result.analysis_llm_needed is false, keep the copy brief and source-backed; do not escalate into a richer investor event.",
  "Do not decide special UI. If supplied display_payload.display_type is candidate_special, explain only the investor-facing implications and preserve the payload unchanged.",
].join("\n");

export function buildSecPeriodicReportsAnalysisPromptDraft(input: SecPeriodicReportsAnalysisPromptInput) {
  return {
    key: SEC_PERIODIC_REPORTS_ANALYSIS_PROMPT_KEY,
    version: SEC_PERIODIC_REPORTS_ANALYSIS_PROMPT_VERSION,
    system: secPeriodicReportsAnalysisSystemPrompt,
    user: JSON.stringify({
      ...buildSecPeriodicReportsSourceBlockPromptInput(input),
      router_result: input.router_result,
      display_payload: input.display_payload,
    }),
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "sec_periodic_reports_analysis",
        strict: true,
        schema: secPeriodicReportsAnalysisResponseSchema,
      },
    },
  };
}
