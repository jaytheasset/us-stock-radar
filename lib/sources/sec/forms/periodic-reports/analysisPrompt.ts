import {
  APPROVED_SEC_EVENT_TYPES,
  PERIODIC_REPORTS_FORM_SCOPE,
} from "./types.ts";
import { buildSecPeriodicReportsSourceBlockPromptInput, type SecPeriodicReportsPromptInput } from "./sourceBlockPromptInput.ts";

export const SEC_PERIODIC_REPORTS_ANALYSIS_PROMPT_KEY = "sec_periodic_reports_analysis";
export const SEC_PERIODIC_REPORTS_ANALYSIS_PROMPT_VERSION = "v13-40f";
export const SEC_PERIODIC_REPORTS_AMENDMENT_ANALYSIS_PROMPT_KEY = "sec_periodic_reports_amendment_analysis";
export const SEC_PERIODIC_REPORTS_AMENDMENT_ANALYSIS_PROMPT_VERSION = "v4-40f";

export type SecPeriodicReportsAnalysisPromptInput = SecPeriodicReportsPromptInput;

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
    "resolved_market_cap",
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
    resolved_market_cap: {
      type: "object",
      additionalProperties: false,
      required: ["value", "source", "filing_evidence"],
      properties: {
        value: { type: ["number", "null"], minimum: 0 },
        source: { type: "string", enum: ["filing", "fmp", "unavailable"] },
        filing_evidence: { type: ["string", "null"], maxLength: 260 },
      },
    },
    scoring_assessment: {
      type: "object",
      additionalProperties: false,
      required: [
        "primary_change_severity",
        "operating_direction",
        "cash_flow_direction",
        "guidance_direction",
        "earnings_quality",
        "material_offsets",
        "alert_driver",
      ],
      properties: {
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

const amendmentSharedProperties = Object.fromEntries(
  Object.entries(analysisOutputSchema.properties).filter(([field]) => field !== "report_ui"),
);

export const secPeriodicReportsAmendmentAnalysisResponseSchema = {
  ...analysisOutputSchema,
  required: [
    ...analysisOutputSchema.required.filter((field) => field !== "report_ui"),
    "amendment_ui",
  ],
  properties: {
    ...amendmentSharedProperties,
    amendment_ui: {
      type: "object",
      additionalProperties: false,
      required: [
        "amendment_type",
        "parent_accession_number",
        "affected_period",
        "snapshot_intro",
        "snapshot_metrics",
        "amended_items",
        "financial_statements_changed",
        "changed_metrics",
        "change_details",
        "accounting_or_control_impact",
        "investor_impact",
      ],
      properties: {
        amendment_type: {
          type: "string",
          enum: ["administrative_correction", "disclosure_update", "material_restatement"],
        },
        parent_accession_number: { type: ["string", "null"], maxLength: 32 },
        affected_period: { type: ["string", "null"], maxLength: 40 },
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
        amended_items: {
          type: "array",
          maxItems: 6,
          items: { type: "string", maxLength: 80 },
        },
        financial_statements_changed: { type: "boolean" },
        changed_metrics: {
          type: "array",
          maxItems: 3,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["label", "previous_value", "amended_value", "change_summary"],
            properties: {
              label: { type: "string", maxLength: 48 },
              previous_value: { type: ["string", "null"], maxLength: 40 },
              amended_value: { type: ["string", "null"], maxLength: 40 },
              change_summary: { type: "string", maxLength: 140 },
            },
          },
        },
        change_details: {
          type: "array",
          maxItems: 4,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["title", "value", "note"],
            properties: {
              title: { type: "string", maxLength: 64 },
              value: { type: ["string", "null"], maxLength: 80 },
              note: { type: "string", maxLength: 180 },
            },
          },
        },
        accounting_or_control_impact: { type: ["string", "null"], maxLength: 220 },
        investor_impact: { type: "string", maxLength: 260 },
      },
    },
  },
} as const;

export const secPeriodicReportsAnalysisSystemPrompt = [
  `Analyze one SEC periodic report filing in scope: ${PERIODIC_REPORTS_FORM_SCOPE}.`,
  "Return only the strict investor-analysis JSON object matching the response schema.",
  "Do not return parser_output, display_payload, fixture_expected, source_bundle, or cleaned_source_blocks. Runtime preserves parser and UI data separately.",
  "Use cleaned_source_blocks as the evidence base. Do not invent source links, accession numbers, tickers, dates, or evidence.",
  "The source bundle is selected from periodic-report structure, not from an event router. Review all supplied material sections before choosing the representative event_type.",
  "Document inventory, attachment inventory, and parser warnings are not evidence and are intentionally excluded from cleaned_source_blocks.",
  "XBRL statement facts are filing-source data. Use their period and statement context, and never compare values from incompatible periods or units.",
  "An XBRL fact with has_dimensions=true is a segment, product, geography, counterparty, or other subset fact. Never present it as a consolidated company total. If no non-dimensional consolidated total is supplied, omit that total rather than substituting a dimensional value.",
  "A product, segment, geography, target, or regulatory-program paragraph must not substitute for consolidated revenue, operating profit, net income, or operating cash flow. Identify its scope explicitly and omit unavailable consolidated metrics.",
  "A source block marked source_scope=segment_or_subset is valid only for that segment or subset. Never relabel its metrics as consolidated company totals. Prefer non-dimensional XBRL or clearly consolidated financial-statement evidence for company-wide performance comparisons.",
  "Treat the resolved report_context fiscal_year and fiscal_quarter as authoritative. The parser may replace an internally inconsistent annual DocumentFiscalYearFocus with the year supported by the XBRL reporting-period context; use fiscal_period_resolution rather than the rejected raw focus value. Do not infer a fiscal quarter from the calendar month of the reporting-period end date.",
  "If fiscal_quarter is unresolved, describe the reporting period by its disclosed end date and do not invent a Q1/Q2/Q3 label.",
  "Do not use parser-generated facts, route hints, deterministic classification, extraction summaries, event labels, display labels, or investment labels as analysis authority.",
  "Choose event_type directly from the approved event types based on the dominant investor-relevant conclusion supported by the original source blocks.",
  "Periodic reports may contain several material subjects. Select one representative event_type for feed filtering, but preserve other material findings in the investor-facing analysis instead of discarding them.",
  "For a substantive non-amendment 10-K, 20-F, or 40-F, annual operating performance is the primary analytical frame. Review current-year and immediately preceding-year revenue or sales, operating income or loss, GAAP/IFRS net income or loss, and operating cash flow before considering dividends, buybacks, or other capital-return items.",
  "A routine dividend, buyback, or capital-allocation disclosure must not displace material annual operating performance as the representative event or as the focus of report_ui, quick_take, summary, and score_reason. Treat capital returns as secondary unless the filing is genuinely dominated by a new extraordinary capital-return event.",
  "Score measures investor attention and urgency, not bullishness or bearishness. Signal expresses direction. A large positive or negative surprise can both receive a high score.",
  "Complete report_ui performance comparisons and scoring_assessment before assigning score, signal, score_reason, quick_take, or summary.",
  "Use only these scoring_assessment values: primary_change_severity routine/meaningful/strong/major/critical; operating_direction and cash_flow_direction positive/negative/mixed/neutral/unknown; guidance_direction positive/negative/mixed/neutral/absent; earnings_quality high/mixed/low/unknown.",
  "Populate resolved_market_cap by this absolute source priority: if current-filing original source blocks explicitly state the issuer's total market capitalization, return that exact numeric USD value with source filing and a short verbatim filing_evidence excerpt; otherwise return site-provided market_context.market_cap unchanged with source fmp and filing_evidence null; otherwise return value null, source unavailable, and filing_evidence null. Never replace a filing-stated total market capitalization with market context.",
  "The filing phrase aggregate market value held by non-affiliates is public float value, not total market capitalization. Do not use it as resolved_market_cap. A filing-derived shares-outstanding-times-price value is Market Value at Last Sale Price, not total market capitalization.",
  "Do not return a market-cap tier, size grade, or Mega/Large/Mid/Small/Micro label in resolved_market_cap or scoring_assessment. Use the resolved numeric value internally only to choose thresholds from the fixed table below.",
  "Market capitalization changes percentage thresholds only; never add or subtract score points merely because a company is larger or smaller.",
  "Market-cap tiers are fixed: micro below $100M; small $100M to below $500M; mid $500M to below $2B; large $2B to below $10B; mega $10B or more. Use unknown when market cap is absent or unusable.",
  "For revenue or sales changes, meaningful / strong / major percentage thresholds are: micro 25% / 50% / 100%; small 15% / 30% / 60%; mid 10% / 20% / 40%; large 7% / 15% / 30%; mega 5% / 10% / 20%. If market capitalization is unavailable, use mid thresholds conservatively.",
  "For operating income, net income, or EPS changes, meaningful / strong / major thresholds are: micro 50% / 100% / 200%; small 30% / 60% / 120%; mid 20% / 40% / 80%; large 15% / 30% / 60%; mega 10% / 20% / 40%. Apply these percentages only when both periods are positive, comparable, and use the same accounting basis.",
  "Do not calculate or score a profit percentage when the comparison crosses zero or the prior-period denominator is near zero. Label negative-to-positive as turned profitable, positive-to-negative as turned unprofitable, and two negative periods as loss narrowed or loss widened using absolute loss amounts.",
  "Assess earnings quality before direction. Material tax benefits, fair-value gains, asset-sale gains, warrant or derivative remeasurement, impairment reversals, or other non-operating and non-cash items must not be presented as pure operating improvement.",
  "Treat cash flow, free cash flow, capital spending, liquidity, debt, and guidance as material offsets when they contradict headline revenue or profit. A major offset may keep impact high while changing signal to volatile.",
  "Score bands are fixed: below 50 is archive; 50 to 59 is routine or limited change; 60 to 64 is one meaningful change; 65 to 74 is a strong change or several aligned changes; 75 to 84 requires a major inflection, guidance shock, or material mixed shock; 85 to 94 is reserved for severe accounting reliability, liquidity, or business-continuity risk; 95 or above is reserved for bankruptcy or similarly existential events.",
  "Neutral signal must have score below 75. A score of 75 or above requires a concise, source-backed alert_driver. When major positive and negative developments coexist, prefer volatile over forcing bullish or bearish.",
  "Write score_reason as one concise analyst-style conclusion of roughly 18 to 32 words. Explain why the impact level is reasonable without saying 'the score', repeating the summary, or describing filing mechanics.",
  "Write quick_take as one self-contained investor-facing sentence of roughly 18 to 32 words. State the most material change and the practical investor read-through.",
  "Quick take must use an event verb and, when the filing provides one, at least one exact core metric such as a percentage, amount, margin, profit or loss, cash-flow figure, or guidance range. Never output only the issuer name, form type, filing label, or a generic disclosure description.",
  "Do not copy event_title or the opening of summary into quick_take. Express the same evidence as a distinct concise conclusion rather than a shortened duplicate.",
  "Write complete narrative sentences within the response-schema limits: event_title 140 characters, score_reason 220, quick_take 220, summary 900, why_it_matters 500, each key_evidence item 260, and each what_to_watch_next item 180. Never end a field with an ellipsis or a cut-off sentence.",
  "For material filings, write two or three concise key_evidence points chosen by importance. For routine archive filings, key_evidence may be empty.",
  "Use market context only when supplied in the site_market_context source block and only after checking current-filing original source blocks for an explicit total market capitalization. Do not call or ask for live market data.",
  "For earnings and sales_performance, emphasize period-over-period revenue, profit/loss, margins, demand metrics, and management context only when source-backed.",
  "For quarterly reports, use the dedicated quarterly_core_performance_facts and quarterly_core_statement blocks before generic XBRL or dimensional facts. Use consolidated total revenue rather than clinic, product, segment, or other subset revenue.",
  "When discontinued operations materially change the comparison base, do not describe an improvement in total net income or loss as operating improvement. Prefer a like-for-like continuing-operations comparison and explain the discontinued-operations effect separately.",
  "Populate report_ui for substantive periodic reports. The application chooses the template; do not name or choose a UI display type.",
  "For a substantive report, write a one-sentence snapshot_intro and up to four source-backed snapshot_metrics. Prefer reporting period, revenue or sales, GAAP/IFRS net income or loss, and cash, free cash flow, debt, or another material balance-sheet measure. Omit unavailable metrics; never write Not disclosed placeholders.",
  "Write at most three performance_comparisons. Each comparison must use the same metric definition, unit, and period length. For annual reports, compare the current fiscal year with the immediately preceding fiscal year. For quarterly reports, use the same fiscal quarter in the immediately preceding year. Use quarter-over-quarter only when no comparable year-over-year value is supplied, and label it qoq.",
  "When a performance_comparison supplies current_numeric and comparison_numeric, use the exact rounded percentage change in event_title, quick_take, summary, score_reason, and snapshot_intro. Do not replace a calculable percentage with imprecise multiplier wording such as doubled, more than doubled, tripled, or halved.",
  "The period labels must visibly support comparison_basis: annual yoy requires adjacent fiscal years, such as FY2026 versus FY2025; quarterly yoy requires the same quarter in adjacent years; qoq requires consecutive quarters. A two-year or longer annual span is not YoY. If the labels do not establish the required relationship, use other and do not describe the result as YoY or QoQ.",
  "current_numeric and comparison_numeric must be raw signed numbers in the displayed unit. A loss or negative cash flow must be negative. current_value and comparison_value must retain the filing currency and clearly show negative values with parentheses or a minus sign.",
  "Set change_tone from investor meaning, not arithmetic direction alone. Higher revenue or profit is usually improvement; higher losses, expenses, cash burn, or debt can be deterioration.",
  "Choose the three comparisons that best explain investor impact. Normally include revenue or sales and GAAP/IFRS net income or loss when available. Do not let adjusted metrics hide a material deterioration in GAAP/IFRS results.",
  "For a substantive non-amendment 10-K, 20-F, or 40-F, performance_comparisons must normally include current-year versus immediately preceding-year revenue or sales and GAAP/IFRS net income or loss when both are disclosed. Use operating income or loss or operating cash flow as the third comparison when material. Do not use dividend comparisons in place of these core annual metrics.",
  "Put forward guidance in guidance_metrics, not in performance_comparisons. Link guidance to a performance metric only when it is the same measure and accounting basis. Use related_different_basis for adjusted guidance next to a GAAP/IFRS actual, and standalone when no matching comparison exists.",
  "Write at most three key_business_updates for material business drivers, segment trends, operating milestones, risks, or offsets not already obvious from the comparison graph. Do not repeat the summary or merely restate a graphed number.",
  "For a routine amendment that should archive, report_ui arrays may be empty and snapshot_intro may be brief. Do not reconstruct the entire parent report.",
  "For financial_risk, emphasize going-concern language, liquidity runway, debt maturity, covenant or default risk, and whether market context is needed to size the issue.",
  "For legal_risk, use only disclosed proceedings, investigations, enforcement actions, or loss contingencies. Do not infer guilt or liability beyond the filing.",
  "For dividends and capital_return, include exact dividend, record/payable dates, buyback authorization, or repurchase activity only when source-backed.",
  "For ipo_listing, discuss only source-backed IPO/listing facts such as traditional IPO, SPAC IPO, direct listing, IPO pricing, first trading/listing date, or registration effectiveness tied to a new public listing.",
  "Do not treat ordinary resale registration, shelf offerings, ATM/offering dilution, already-listed issuer resale, post-closing business updates, SPAC redemption, liquidation, or de-SPAC updates as ipo_listing unless the IPO/listing itself is the dominant event.",
  "For 10-K/A, 10-Q/A, 20-F/A, and 40-F/A, analyze only the change from the parent filing. Routine exhibit-only, certification-only, signature-only, XBRL-only, or no-other-change amendments should archive as other.",
  "For mechanically clear routine amendment source text, keep the copy brief and source-backed and do not escalate it into a richer investor event.",
  "Write only investor-facing analysis fields and structured report_ui facts. Do not choose or describe an internal UI template.",
].join("\n");

export const secPeriodicReportsAmendmentAnalysisSystemPrompt = [
  "Analyze one SEC periodic-report amendment: 10-K/A, 10-Q/A, 20-F/A, or 40-F/A.",
  "Return only the strict investor-analysis JSON object matching the response schema.",
  "Use cleaned_source_blocks as evidence. The current amendment blocks are primary evidence; parent_filing_context is comparison context, not proof of a new change by itself.",
  "Populate resolved_market_cap by this absolute source priority: if current-filing original source blocks explicitly state the issuer's total market capitalization, return that exact numeric USD value with source filing and a short verbatim filing_evidence excerpt; otherwise return site-provided market_context.market_cap unchanged with source fmp and filing_evidence null; otherwise return value null, source unavailable, and filing_evidence null.",
  "Aggregate market value held by non-affiliates, public float value, and shares-outstanding-times-price are not total market capitalization. Do not return a market-cap tier, size grade, or Mega/Large/Mid/Small/Micro label in resolved_market_cap or scoring_assessment.",
  "Analyze only what the amendment changes. Do not reconstruct or resummarize the full parent annual or quarterly report.",
  "Classify amendment_type as administrative_correction for exhibit, certification, signature, XBRL, typo, or other non-substantive corrections; disclosure_update for a substantive narrative or disclosure change without restated financial statements; material_restatement when financial statements, material accounting amounts, non-reliance, or material controls are changed.",
  "If the parent filing is not matched with high confidence, do not invent previous values or claim that a field changed. Set unknown comparison values to null and explain the limitation briefly.",
  "Populate amendment_ui only with source-backed changed facts. Omit placeholders such as Not disclosed and do not add ordinary parent-report performance graphs or guidance.",
  "Use snapshot_metrics for two to four concise amendment facts when available: amendment type, affected period, amended item, financial-statement impact, filing status, or a material corrected value.",
  "Use changed_metrics only when both the prior and amended values are source-backed. Otherwise put the source-backed change in change_details.",
  "Rank amendment changes by investor relevance and quantitative materiality before writing event_title, quick_take, and summary. Lead with the largest meaningful revenue, profit, cash-flow, balance-sheet, or reliability correction; do not foreground a tiny rounding-level change while larger corrected metrics are disclosed.",
  "For loss metrics, compare absolute loss amounts: a smaller absolute loss is loss narrowing or decreasing, while a larger absolute loss is loss widening or increasing. Apply the same direction consistently in changed_metrics, event_title, quick_take, summary, and score_reason.",
  "For administrative corrections, normally use event_type other, neutral signal, score below 50, archive-style concise copy, and no what_to_watch_next unless a concrete next event is stated.",
  "For disclosure updates and material restatements, score investor attention and urgency based on the actual changed disclosure, not the importance of the original report as a whole.",
  "Write score_reason as one concise analyst-style conclusion explaining why the score is reasonable. Do not begin with 'The score is'.",
  "Write quick_take as one self-contained investor-facing sentence of roughly 14 to 28 words. State exactly what the amendment changes and how investors should read that change.",
  "Quick take must use an event verb and include the most material corrected metric when one exists. For an administrative amendment with no financial metric, name the exact amended item or exhibit instead of inventing a number.",
  "Never output only the issuer name, form type, filing label, or a generic amendment description in quick_take. Do not copy event_title or the opening of summary; write a distinct concise conclusion.",
  "Write complete narrative sentences within the response-schema limits and never end a field with an ellipsis or a cut-off sentence.",
  "Write plain investor English and preserve exact dates, amounts, periods, and accounting direction from the source.",
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

export function buildSecPeriodicReportsAmendmentAnalysisPromptDraft(input: SecPeriodicReportsAnalysisPromptInput) {
  return {
    key: SEC_PERIODIC_REPORTS_AMENDMENT_ANALYSIS_PROMPT_KEY,
    version: SEC_PERIODIC_REPORTS_AMENDMENT_ANALYSIS_PROMPT_VERSION,
    system: secPeriodicReportsAmendmentAnalysisSystemPrompt,
    user: JSON.stringify({
      ...buildSecPeriodicReportsSourceBlockPromptInput(input),
    }),
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "sec_periodic_reports_amendment_analysis",
        strict: true,
        schema: secPeriodicReportsAmendmentAnalysisResponseSchema,
      },
    },
  };
}
