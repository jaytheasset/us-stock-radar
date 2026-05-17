import { CALENDAR_EVENT_TYPE_VALUES } from "@/lib/calendarEventRegistry";
import {
  CONFIDENCE_VALUES,
  DATE_PRECISION_VALUES,
  MARKET_SCOPE_VALUES,
  SIGNAL_VALUES,
  THEME_GROUP_VALUES,
  TICKER_ROLE_VALUES,
} from "@/lib/prompts/newsEventAnalysis";

export const SEC_FILING_ANALYSIS_PROMPT_KEY = "sec_filing_analysis";
export const SEC_FILING_ANALYSIS_PROMPT_VERSION = "v1";

export const SEC_EVENT_TYPE_VALUES = [
  "listing_risk",
  "dilution_risk",
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
  "fda_clinical",
  "other",
] as const;

export type SecFilingAnalysisInput = {
  filing_package: Record<string, unknown>;
};

export const secFilingAnalysisInputTemplate = `{
  "filing_package": {{sec_filing_package_json}}
}`;

export const secFilingAnalysisSystemPrompt = [
  "Analyze one SEC filing package and return only strict JSON matching the provided response schema.",
  "Use the filing text as the source of truth. Do not invent facts, dates, tickers, exchanges, terms, or schedules.",
  "Classify by disclosure content, not by filing form alone. A Form 8-K can be earnings, dilution risk, listing risk, strategic transaction, legal risk, or other.",
  "Keep the router simple: event_type, score, signal, market_scope, analysis fields, tickers, and calendar_items are the output contract.",
  "For primary_ticker, prefer the U.S.-listed common stock or ADR from the filing package. Do not use warrants, units, rights, or non-common classes as primary unless no common/ADR ticker exists.",
  "Classify sector, industry_group, theme_group, and sub_theme by judgment from the filing content. Use null when the filing does not support a theme.",
  "Do not infer market_scope from ticker count alone. A merger, financing, contract, or litigation filing with multiple tickers can still be company-scoped.",
  "Set related_tickers only when the filing clearly names affected peers, customers, suppliers, counterparties, acquirers, targets, or financing parties.",
  "Do not generate related news. Related news is resolved later from the database.",
  "Extract calendar_items only for scheduled investor-relevant dates or deadlines stated in the filing.",
  "Use calendar_items for earnings releases/calls, shareholder meetings/votes, dividend dates, reverse split effective dates, listing/deal deadlines, tender/rights/warrant expirations, offering closings, merger votes/closings, FDA/clinical dates, investor events, court hearings, and policy/effective dates.",
  "A webcast, conference call, or audio call tied to financial results must be earnings_call, not investor_day or conference_presentation.",
  "A shareholder meeting record date must be shareholder_record_date, not shareholder_vote.",
  "A dividend, distribution, interest-on-capital, or capital-return record date must be dividend_record_date, not shareholder_record_date.",
  "For shareholder meetings, extract the meeting date and record/vote deadline; skip proxy mailing/distribution mechanics.",
  "Warrant exercise, redemption, or expiration deadlines must be warrant_redemption_deadline.",
  "An expected Form 10-K, Form 10-Q, amended report, restatement, or other SEC filing date must be sec_filing_due_date.",
  "Do not add calendar_items for the filing date itself unless the filing explicitly says the event occurs on that date.",
  "Do not add calendar_items for generic contract payment terms, ordinary fee payment mechanics, or legal boilerplate dates.",
  "Never add calendar_items for tax-status, tax-exemption, withholding documentation, proxy mailing/distribution dates, board response deadlines, or legal position-statement deadlines.",
  "Exact dates from SEC filings are filing-confirmed schedules. Use date_precision exact, is_estimated false, confidence high when the date is explicit.",
  "If the filing gives only a vague month, quarter, year, or target window, set is_estimated true, date_precision accordingly, and use estimated_start_date/estimated_end_date when possible.",
  "If no useful scheduled event exists, return an empty calendar_items array.",
  "Score 0-49 archive-level, 50-74 feed-level, 75-89 alert-level, 90-100 urgent-level.",
  "Score by materiality, price sensitivity, specificity, source strength, timeliness, and market interest.",
  "Keep output short: event_title under 90 characters; quick_take one sentence under 22 words; summary 1-3 sentences under 65 words total; why_it_matters one sentence under 35 words.",
  "Keep score_reason under 18 words.",
  "Keep bullish_points, bearish_points, key_evidence, and what_to_watch_next to at most 3 items each, and each item under 16 words.",
  "Use compact phrases, not full article-style paragraphs.",
].join("\n");

export const secFilingAnalysisResponseSchema = {
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
    market_scope: { type: "string", enum: MARKET_SCOPE_VALUES },
    event_type: { type: "string", enum: SEC_EVENT_TYPE_VALUES },
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
    tickers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ticker", "exchange", "role"],
        properties: {
          ticker: { type: "string" },
          exchange: { type: "string" },
          role: { type: "string", enum: TICKER_ROLE_VALUES },
        },
      },
    },
    sector: { type: ["string", "null"] },
    industry_group: { type: ["string", "null"] },
    theme_group: { type: ["string", "null"], enum: [...THEME_GROUP_VALUES, null] },
    sub_theme: { type: ["string", "null"] },
    score: { type: "integer", minimum: 0, maximum: 100 },
    score_reason: { type: "string" },
    signal: { type: "string", enum: SIGNAL_VALUES },
    quick_take: { type: "string" },
    summary: { type: "string" },
    why_it_matters: { type: "string" },
    bullish_points: { type: "array", items: { type: "string" } },
    bearish_points: { type: "array", items: { type: "string" } },
    key_evidence: { type: "array", items: { type: "string" } },
    what_to_watch_next: { type: "array", items: { type: "string" } },
    related_tickers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ticker", "exchange", "reason"],
        properties: {
          ticker: { type: "string" },
          exchange: { type: ["string", "null"] },
          reason: { type: "string" },
        },
      },
    },
    calendar_items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "calendar_event_type",
          "calendar_title",
          "event_date",
          "event_time",
          "event_timezone",
          "date_precision",
          "estimated_start_date",
          "estimated_end_date",
          "is_estimated",
          "confidence",
          "evidence",
        ],
        properties: {
          calendar_event_type: { type: "string", enum: CALENDAR_EVENT_TYPE_VALUES },
          calendar_title: { type: "string" },
          event_date: { type: ["string", "null"], description: "YYYY-MM-DD when exact date is known." },
          event_time: { type: ["string", "null"], description: "HH:MM 24-hour local time when known." },
          event_timezone: { type: ["string", "null"], description: "IANA timezone or market timezone label when known." },
          date_precision: { type: "string", enum: DATE_PRECISION_VALUES },
          estimated_start_date: { type: ["string", "null"], description: "YYYY-MM-DD start for approximate ranges." },
          estimated_end_date: { type: ["string", "null"], description: "YYYY-MM-DD end for approximate ranges." },
          is_estimated: { type: "boolean" },
          confidence: { type: "string", enum: CONFIDENCE_VALUES },
          evidence: { type: "string" },
        },
      },
    },
    confidence: { type: "string", enum: CONFIDENCE_VALUES },
    needs_human_review: { type: "boolean" },
  },
} as const;

export function buildSecFilingAnalysisPrompt(input: SecFilingAnalysisInput) {
  return {
    key: SEC_FILING_ANALYSIS_PROMPT_KEY,
    version: SEC_FILING_ANALYSIS_PROMPT_VERSION,
    system: secFilingAnalysisSystemPrompt,
    user: JSON.stringify(input),
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "sec_filing_analysis",
        strict: true,
        schema: secFilingAnalysisResponseSchema,
      },
    },
  };
}
