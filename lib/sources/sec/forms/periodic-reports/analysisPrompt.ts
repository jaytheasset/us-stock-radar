import type { PeriodicParserOutput } from "./types";
import { buildSecPeriodicReportsSourceBlockPromptInput, type SecPeriodicReportsPromptInput } from "./sourceBlockPromptInput.ts";

export const SEC_PERIODIC_REPORTS_ANALYSIS_PROMPT_KEY = "sec_periodic_reports_analysis";
export const SEC_PERIODIC_REPORTS_ANALYSIS_PROMPT_VERSION = "v6-market-cap-scoring";

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
    "scoring_assessment",
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
    "report_ui",
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
    scoring_assessment: {
      type: "object",
      additionalProperties: false,
      required: [
        "market_cap_tier",
        "primary_change_severity",
        "operating_direction",
        "cash_flow_direction",
        "guidance_direction",
        "earnings_quality",
        "material_offsets",
        "alert_driver",
      ],
      properties: {
        market_cap_tier: {
          type: "string",
        },
        primary_change_severity: {
          type: "string",
        },
        operating_direction: {
          type: "string",
        },
        cash_flow_direction: {
          type: "string",
        },
        guidance_direction: {
          type: "string",
        },
        earnings_quality: {
          type: "string",
        },
        material_offsets: {
          type: "array",
          maxItems: 3,
          items: { type: "string", maxLength: 180 },
        },
        alert_driver: { type: ["string", "null"], maxLength: 180 },
      },
    },
    score: { type: "integer", minimum: 0, maximum: 100 },
    score_reason: { type: "string", maxLength: 220 },
    signal: { type: "string", enum: ["bullish", "bearish", "volatile", "neutral"] },
    quick_take: { type: "string", maxLength: 220 },
    summary: { type: "string", maxLength: 900 },
    why_it_matters: { type: "string", maxLength: 500 },
    bullish_points: { type: "array", maxItems: 3, items: { type: "string", maxLength: 220 } },
    bearish_points: { type: "array", maxItems: 3, items: { type: "string", maxLength: 220 } },
    key_evidence: { type: "array", maxItems: 3, items: { type: "string", maxLength: 260 } },
    what_to_watch_next: { type: "array", maxItems: 3, items: { type: "string", maxLength: 180 } },
    report_ui: {
      type: "object",
      additionalProperties: false,
      required: [
        "snapshot_intro",
        "snapshot_metrics",
        "performance_comparisons",
        "guidance_metrics",
        "key_business_updates",
      ],
      properties: {
        snapshot_intro: { type: "string", maxLength: 200 },
        snapshot_metrics: {
          type: "array",
          maxItems: 4,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["label", "value", "note"],
            properties: {
              label: { type: "string", maxLength: 36 },
              value: { type: "string", maxLength: 64 },
              note: { type: ["string", "null"], maxLength: 80 },
            },
          },
        },
        performance_comparisons: {
          type: "array",
          maxItems: 3,
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "label",
              "current_label",
              "current_value",
              "current_numeric",
              "comparison_label",
              "comparison_value",
              "comparison_numeric",
              "comparison_basis",
              "change_note",
              "change_tone",
            ],
            properties: {
              label: { type: "string", maxLength: 48 },
              current_label: { type: "string", maxLength: 24 },
              current_value: { type: "string", maxLength: 32 },
              current_numeric: { type: "number" },
              comparison_label: { type: "string", maxLength: 24 },
              comparison_value: { type: "string", maxLength: 32 },
              comparison_numeric: { type: "number" },
              comparison_basis: { type: "string", enum: ["yoy", "qoq", "other"] },
              change_note: { type: ["string", "null"], maxLength: 64 },
              change_tone: { type: "string", enum: ["improvement", "deterioration", "neutral"] },
            },
          },
        },
        guidance_metrics: {
          type: "array",
          maxItems: 3,
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "label",
              "guidance_label",
              "guidance_value",
              "performance_relationship",
              "performance_label",
              "note",
            ],
            properties: {
              label: { type: "string", maxLength: 48 },
              guidance_label: { type: "string", maxLength: 32 },
              guidance_value: { type: "string", maxLength: 48 },
              performance_relationship: {
                type: "string",
                enum: ["same_basis", "related_different_basis", "standalone"],
              },
              performance_label: { type: ["string", "null"], maxLength: 48 },
              note: { type: ["string", "null"], maxLength: 80 },
            },
          },
        },
        key_business_updates: {
          type: "array",
          maxItems: 3,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["title", "value", "summary"],
            properties: {
              title: { type: "string", maxLength: 64 },
              value: { type: ["string", "null"], maxLength: 64 },
              summary: { type: "string", maxLength: 180 },
            },
          },
        },
      },
    },
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
  "Score measures investor attention and urgency, not bullishness or bearishness. Signal expresses direction. A large positive or negative surprise can both receive a high score.",
  "Complete report_ui performance comparisons and scoring_assessment before assigning score, signal, score_reason, quick_take, or summary.",
  "Use only these scoring_assessment values: market_cap_tier micro/small/mid/large/mega/unknown; primary_change_severity routine/meaningful/strong/major/critical; operating_direction and cash_flow_direction positive/negative/mixed/neutral/unknown; guidance_direction positive/negative/mixed/neutral/absent; earnings_quality high/mixed/low/unknown.",
  "Use site-provided market capitalization only to choose the percentage threshold tier; never add or subtract score points merely because a company is larger or smaller.",
  "Market-cap tiers are fixed: micro below $100M; small $100M to below $500M; mid $500M to below $2B; large $2B to below $10B; mega $10B or more. Use unknown when market cap is absent or unusable.",
  "For revenue or sales changes, meaningful / strong / major percentage thresholds are: micro 25% / 50% / 100%; small 15% / 30% / 60%; mid 10% / 20% / 40%; large 7% / 15% / 30%; mega 5% / 10% / 20%. If market-cap tier is unknown, use mid thresholds conservatively and set market_cap_tier to unknown.",
  "For operating income, net income, or EPS changes, meaningful / strong / major thresholds are: micro 50% / 100% / 200%; small 30% / 60% / 120%; mid 20% / 40% / 80%; large 15% / 30% / 60%; mega 10% / 20% / 40%. Apply these percentages only when both periods are positive, comparable, and use the same accounting basis.",
  "Do not calculate or score a profit percentage when the comparison crosses zero or the prior-period denominator is near zero. Label negative-to-positive as turned profitable, positive-to-negative as turned unprofitable, and two negative periods as loss narrowed or loss widened using absolute loss amounts.",
  "Assess earnings quality before direction. Material tax benefits, fair-value gains, asset-sale gains, warrant or derivative remeasurement, impairment reversals, or other non-operating and non-cash items must not be presented as pure operating improvement.",
  "Treat cash flow, free cash flow, capital spending, liquidity, debt, and guidance as material offsets when they contradict headline revenue or profit. A major offset may keep impact high while changing signal to volatile.",
  "Score bands are fixed: below 50 is archive; 50 to 59 is routine or limited change; 60 to 64 is one meaningful change; 65 to 74 is a strong change or several aligned changes; 75 to 84 requires a major inflection, guidance shock, or material mixed shock; 85 to 94 is reserved for severe accounting reliability, liquidity, or business-continuity risk; 95 or above is reserved for bankruptcy or similarly existential events.",
  "Neutral signal must have score below 75. A score of 75 or above requires a concise, source-backed alert_driver. When major positive and negative developments coexist, prefer volatile over forcing bullish or bearish.",
  "Write score_reason as one concise analyst-style conclusion of roughly 18 to 32 words. Explain why the impact level is reasonable without saying 'the score', repeating the summary, or describing filing mechanics.",
  "For material filings, write two or three concise key_evidence points chosen by importance. For routine archive filings, key_evidence may be empty.",
  "Use market context only when supplied in the site_market_context source block. Do not call or ask for live market data.",
  "For earnings and sales_performance, emphasize period-over-period revenue, profit/loss, margins, demand metrics, and management context only when source-backed.",
  "Populate report_ui for substantive periodic reports. The application chooses the template; do not name or choose a UI display type.",
  "For a substantive report, write a one-sentence snapshot_intro and up to four source-backed snapshot_metrics. Prefer reporting period, revenue or sales, GAAP/IFRS net income or loss, and cash, free cash flow, debt, or another material balance-sheet measure. Omit unavailable metrics; never write Not disclosed placeholders.",
  "Write at most three performance_comparisons. Each comparison must use the same metric definition, unit, and period length. Prefer year-over-year comparisons for quarterly results and prior-year comparisons for annual results. Use quarter-over-quarter only when no comparable year-over-year value is supplied, and label it qoq.",
  "The period labels must visibly support comparison_basis: yoy requires the same quarter or comparable annual period in different years; qoq requires consecutive quarters. If the labels do not establish either relationship, use other and do not describe the result as YoY or QoQ.",
  "current_numeric and comparison_numeric must be raw signed numbers in the displayed unit. A loss or negative cash flow must be negative. current_value and comparison_value must retain the filing currency and clearly show negative values with parentheses or a minus sign.",
  "Set change_tone from investor meaning, not arithmetic direction alone. Higher revenue or profit is usually improvement; higher losses, expenses, cash burn, or debt can be deterioration.",
  "Choose the three comparisons that best explain investor impact. Normally include revenue or sales and GAAP/IFRS net income or loss when available. Do not let adjusted metrics hide a material deterioration in GAAP/IFRS results.",
  "Put forward guidance in guidance_metrics, not in performance_comparisons. Link guidance to a performance metric only when it is the same measure and accounting basis. Use related_different_basis for adjusted guidance next to a GAAP/IFRS actual, and standalone when no matching comparison exists.",
  "Write at most three key_business_updates for material business drivers, segment trends, operating milestones, risks, or offsets not already obvious from the comparison graph. Do not repeat the summary or merely restate a graphed number.",
  "For a routine amendment that should archive, report_ui arrays may be empty and snapshot_intro may be brief. Do not reconstruct the entire parent report.",
  "For financial_risk, emphasize going-concern language, liquidity runway, debt maturity, covenant or default risk, and whether market context is needed to size the issue.",
  "For legal_risk, use only disclosed proceedings, investigations, enforcement actions, or loss contingencies. Do not infer guilt or liability beyond the filing.",
  "For dividends and capital_return, include exact dividend, record/payable dates, buyback authorization, or repurchase activity only when source-backed.",
  "For ipo_listing, discuss only source-backed IPO/listing facts such as traditional IPO, SPAC IPO, direct listing, IPO pricing, first trading/listing date, or registration effectiveness tied to a new public listing.",
  "Do not treat ordinary resale registration, shelf offerings, ATM/offering dilution, already-listed issuer resale, post-closing business updates, SPAC redemption, liquidation, or de-SPAC updates as ipo_listing unless the IPO/listing itself is the dominant event.",
  "For 10-K/A, 10-Q/A, and 20-F/A, analyze only the change from the parent filing. Routine exhibit-only, certification-only, signature-only, XBRL-only, or no-other-change amendments should archive as other.",
  "For mechanically clear routine amendment source text, keep the copy brief and source-backed and do not escalate it into a richer investor event.",
  "Write only investor-facing analysis fields and structured report_ui facts. Do not choose or describe an internal UI template.",
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
