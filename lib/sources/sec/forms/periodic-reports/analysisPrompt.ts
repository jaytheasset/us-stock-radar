import type { PeriodicParserOutput } from "./types";
import { buildSecPeriodicReportsSourceBlockPromptInput, type SecPeriodicReportsPromptInput } from "./sourceBlockPromptInput.ts";

export const SEC_PERIODIC_REPORTS_ANALYSIS_PROMPT_KEY = "sec_periodic_reports_analysis";
export const SEC_PERIODIC_REPORTS_ANALYSIS_PROMPT_VERSION = "v4";

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

export type SecPeriodicReportsAnalysisPromptInput = SecPeriodicReportsPromptInput & {
  parser_output: PeriodicParserOutput;
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
    event_type: { type: "string", enum: APPROVED_SEC_EVENT_TYPES },
    event_title: { type: "string", maxLength: 140 },
    primary_ticker: {
      type: "object",
      additionalProperties: false,
      required: ["ticker", "exchange"],
      properties: {
        ticker: { type: ["string", "null"] },
        exchange: { type: ["string", "null"] },
      },
    },
    tickers: { type: "array", maxItems: 10, items: { type: "string" } },
    sector: { type: ["string", "null"] },
    industry_group: { type: ["string", "null"] },
    theme_group: { type: ["string", "null"] },
    sub_theme: { type: ["string", "null"] },
    score: { type: "integer", minimum: 0, maximum: 100 },
    score_reason: { type: "string", maxLength: 220 },
    signal: { type: "string", enum: ["bullish", "bearish", "volatile", "neutral"] },
    quick_take: { type: "string", maxLength: 240 },
    summary: { type: "string", maxLength: 1200 },
    why_it_matters: { type: "string", maxLength: 500 },
    bullish_points: { type: "array", maxItems: 3, items: { type: "string", maxLength: 220 } },
    bearish_points: { type: "array", maxItems: 3, items: { type: "string", maxLength: 220 } },
    key_evidence: { type: "array", maxItems: 3, items: { type: "string", maxLength: 260 } },
    what_to_watch_next: { type: "array", maxItems: 3, items: { type: "string", maxLength: 180 } },
    related_tickers: { type: "array", maxItems: 10, items: { type: "string" } },
    calendar_items: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["item_type", "date", "description", "evidence"],
        properties: {
          item_type: { type: "string", maxLength: 80 },
          date: { type: ["string", "null"] },
          description: { type: "string", maxLength: 180 },
          evidence: { type: "string", maxLength: 260 },
        },
      },
    },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    needs_human_review: { type: "boolean" },
  },
} as const;

export const secPeriodicReportsAnalysisResponseSchema = analysisOutputSchema;

export const secPeriodicReportsAnalysisSystemPrompt = [
  `Analyze one SEC periodic report filing in scope: ${PERIODIC_REPORTS_FORM_SCOPE}.`,
  "Return only the strict investor-analysis JSON object matching the response schema.",
  "Do not return parser_output, display_payload, fixture_expected, source_bundle, or cleaned_source_blocks. Runtime preserves parser and UI data separately.",
  "Use cleaned_source_blocks as the evidence base. Do not invent source links, accession numbers, tickers, dates, or evidence.",
  "The source bundle is selected from periodic-report structure, not from an event router. Review all supplied material sections before choosing the representative event_type.",
  "Document inventory, attachment inventory, and parser warnings are not evidence and are intentionally excluded from cleaned_source_blocks.",
  "XBRL statement facts are filing-source data. Use their period and statement context, and never compare values from incompatible periods or units.",
  "Do not use parser-generated facts, signals, route hints, deterministic classification, extraction summaries, event labels, display labels, or investment labels as analysis authority.",
  "Choose event_type directly from the approved event types based on the dominant investor-relevant conclusion supported by the original source blocks.",
  "Periodic reports may contain several material subjects. Select one representative event_type for feed filtering, but preserve other material findings in the investor-facing analysis instead of discarding them.",
  "Score bands are fixed and must not be changed: score below 50 is archive, 50 to 74 is feed, 75 or above is alert.",
  "Write score_reason as one concise analyst-style conclusion of roughly 18 to 32 words. Explain why the impact level is reasonable without saying 'the score', repeating the summary, or describing filing mechanics.",
  "For material filings, write two or three concise key_evidence points chosen by importance. For routine archive filings, key_evidence may be empty.",
  "Use market context only when supplied in the site_market_context source block. Do not call or ask for live market data.",
  "For earnings and sales_performance, emphasize period-over-period revenue, profit/loss, margins, demand metrics, and management context only when source-backed.",
  "For financial_risk, emphasize going-concern language, liquidity runway, debt maturity, covenant or default risk, and whether market context is needed to size the issue.",
  "For legal_risk, use only disclosed proceedings, investigations, enforcement actions, or loss contingencies. Do not infer guilt or liability beyond the filing.",
  "For dividends and capital_return, include exact dividend, record/payable dates, buyback authorization, or repurchase activity only when source-backed.",
  "For ipo_listing, discuss only source-backed IPO/listing facts such as traditional IPO, SPAC IPO, direct listing, IPO pricing, first trading/listing date, or registration effectiveness tied to a new public listing.",
  "Do not treat ordinary resale registration, shelf offerings, ATM/offering dilution, already-listed issuer resale, post-closing business updates, SPAC redemption, liquidation, or de-SPAC updates as ipo_listing unless the IPO/listing itself is the dominant event.",
  "For 10-K/A, 10-Q/A, and 20-F/A, analyze only the change from the parent filing. Routine exhibit-only, certification-only, signature-only, XBRL-only, or no-other-change amendments should archive as other.",
  "For mechanically clear routine amendment source text, keep the copy brief and source-backed and do not escalate it into a richer investor event.",
  "Write only investor-facing analysis fields. Do not choose or describe an internal UI template.",
].join("\n");

export function buildSecPeriodicReportsAnalysisPromptDraft(input: SecPeriodicReportsAnalysisPromptInput) {
  return {
    key: SEC_PERIODIC_REPORTS_ANALYSIS_PROMPT_KEY,
    version: SEC_PERIODIC_REPORTS_ANALYSIS_PROMPT_VERSION,
    system: secPeriodicReportsAnalysisSystemPrompt,
    user: JSON.stringify({
      ...buildSecPeriodicReportsSourceBlockPromptInput(input),
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
