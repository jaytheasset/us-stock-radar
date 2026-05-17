import { CALENDAR_EVENT_TYPE_VALUES } from "@/lib/calendarEventRegistry";

export const NEWS_EVENT_ANALYSIS_PROMPT_KEY = "news_event_analysis";
export const NEWS_EVENT_ANALYSIS_PROMPT_VERSION = "v4";

export const SOURCE_GROUP_VALUES = ["news"] as const;
export const MARKET_SCOPE_VALUES = ["company", "sector", "theme", "macro"] as const;
export const SIGNAL_VALUES = ["bullish", "bearish", "volatile", "neutral"] as const;
export const CONFIDENCE_VALUES = ["high", "medium", "low"] as const;
export const DATE_PRECISION_VALUES = ["exact", "month", "quarter", "year", "unknown"] as const;
export const TICKER_ROLE_VALUES = [
  "primary",
  "related",
  "peer",
  "customer",
  "supplier",
  "counterparty",
  "mentioned",
] as const;

export const NEWS_EVENT_TYPE_VALUES = [
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
  "policy_regulation",
  "macro_market",
  "other",
] as const;

export const THEME_GROUP_VALUES = [
  "ai_data_center",
  "crypto_digital_assets",
  "healthcare_momentum",
  "power_energy_resources",
  "defense_geopolitics",
  "rates_credit_banks",
  "retail_momentum_flows",
  "policy_regulation",
] as const;

export type NewsEventAnalysisInput = {
  source_code: string;
  source_name: string;
  source_url: string;
  published_at: string | null;
  title: string;
  body_text: string;
  body_tickers: Array<{
    ticker: string;
    exchange?: string | null;
  }>;
  metadata_tickers_debug_only: Array<{
    ticker: string;
    exchange?: string | null;
  }>;
};

export const newsEventAnalysisInputTemplate = `{
  "source_code": "{{source_code}}",
  "source_name": "{{source_name}}",
  "source_url": "{{source_url}}",
  "published_at": "{{published_at}}",
  "title": "{{title}}",
  "body_text": "{{body_text}}",
  "body_tickers": {{body_tickers_json}},
  "metadata_tickers_debug_only": {{metadata_tickers_json}}
}`;

export const newsEventAnalysisSystemPrompt = [
  "Analyze one U.S. market news item and return only strict JSON matching the provided response schema.",
  "Coverage rule: analyze only news that has a plausible investment impact on U.S.-listed stocks, U.S. equity sectors, U.S. market themes, or U.S. macro/policy conditions.",
  "If the article is only about foreign-listed securities or a foreign stock market with no clear U.S. equity, U.S. sector, U.S. theme, or U.S. macro/policy impact, set event_type to other, score 0-20, signal neutral, confidence low, needs_human_review true, and explain that it is outside U.S. equity relevance.",
  "Use article body text as the source of truth. Do not use metadata, SEO keywords, or snippets to add material facts or tickers.",
  "metadata_tickers_debug_only is for contamination checks only.",
  "Treat legal disclaimer language as non-evidence, including forward-looking statement cautions, safe harbor text, risk-and-uncertainty disclaimers, and no-obligation-to-update language.",
  "Do not copy legal boilerplate phrases into quick_take, summary, why_it_matters, score_reason, key_evidence, bullish_points, bearish_points, or what_to_watch_next.",
  "If a paragraph says forward-looking context and then gives concrete business priorities, dates, financial figures, contracts, products, or operational plans, ignore the disclaimer framing but use the concrete facts.",
  "Do not use a foreign exchange ticker as primary_ticker unless the article also identifies a U.S.-listed share class, ADR, or U.S.-listed company exposure.",
  "Classify sector, industry_group, theme_group, and sub_theme by your judgment from the article, not by parser defaults.",
  "Do not infer market_scope from ticker count alone. A multi-ticker transaction can still be company-scoped.",
  "Choose event_type based on the most market-moving concrete development in the article, not only the headline, release format, or first paragraph.",
  "If an article contains multiple developments, classify by the development most likely to affect investor attention, valuation, liquidity, or near-term trading.",
  "Use earnings only when the main investable content is financial results, guidance, or an earnings/results call. Do not default to earnings when financial results are secondary to a more material contract, financing, regulatory, legal, clinical, listing, dividend, or strategic development.",
  "Keep quick_take and summary centered on the same primary development used for event_type.",
  "Set related_tickers only for sector, theme, or macro events unless the article clearly names affected peers, customers, suppliers, or counterparties.",
  "Do not generate related news. Related news is resolved later from the database.",
  "For news, extract calendar_items only for earnings/results calls, investor days/conferences/presentations with a specific date, dividend ex-date/record date/payment date, and FDA/PDUFA/advisory committee/clinical readout/trial result dates.",
  "This news calendar allowlist is exhaustive. Do not create news calendar_items for filing due dates, management cease trade order dates, listing compliance deadlines, financing or offering closing dates, shareholder vote dates, or other legal/regulatory dates.",
  "Do not create calendar_items for operational or commercial milestones such as contract start dates, deployment targets, expected revenue commencement, product rollout targets, planned commercial launches, planned closings, management priorities, or replay availability.",
  "Do not add calendar_items for ordinary publication dates or past dates unless the article explicitly says the event occurs on that date.",
  "For clinical or conference items, do not create a calendar item when the article is reporting results that were already released or presented; create one only for a future scheduled readout, presentation, regulatory date, or decision date.",
  "Use vague month, quarter, or year windows only for FDA/clinical/regulatory milestone timing; put other vague milestones in what_to_watch_next instead of calendar_items.",
  "If no useful scheduled event exists, return an empty calendar_items array.",
  "Score 0-49 archive-level, 50-74 feed-level, 75-89 alert-level, 90-100 urgent-level.",
  "All text fields must contain only article facts or market analysis. Do not write site routing, UI copy, archive/feed/alert labels, or instructions to read the original source.",
  "For score 0-49 archive-level items, quick_take and summary must still be factual article summaries only. Keep why_it_matters, bullish_points, bearish_points, key_evidence, and what_to_watch_next minimal or empty unless there is specific U.S. market relevance.",
  "Score by materiality, price sensitivity, specificity, source strength, timeliness, and market interest.",
  "Keep output short: quick_take one sentence under 22 words; summary 1-3 sentences under 65 words total; why_it_matters one sentence under 35 words.",
  "Keep score_reason under 18 words.",
  "Keep bullish_points, bearish_points, key_evidence, and what_to_watch_next to at most 3 items each, and each item under 16 words.",
  "Use compact phrases, not full article-style paragraphs.",
].join("\n");

export const newsEventAnalysisResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "source_group",
    "market_scope",
    "event_type",
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
    source_group: { type: "string", enum: SOURCE_GROUP_VALUES },
    market_scope: { type: "string", enum: MARKET_SCOPE_VALUES },
    event_type: { type: "string", enum: NEWS_EVENT_TYPE_VALUES },
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

export function buildNewsEventAnalysisPrompt(input: NewsEventAnalysisInput) {
  return {
    key: NEWS_EVENT_ANALYSIS_PROMPT_KEY,
    version: NEWS_EVENT_ANALYSIS_PROMPT_VERSION,
    system: newsEventAnalysisSystemPrompt,
    user: JSON.stringify(input),
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "news_event_analysis",
        strict: true,
        schema: newsEventAnalysisResponseSchema,
      },
    },
  };
}
