import { CALENDAR_EVENT_TYPE_VALUES } from "@/lib/calendarEventRegistry";

export const NEWS_EVENT_ANALYSIS_PROMPT_KEY = "news_event_analysis";
export const NEWS_EVENT_ANALYSIS_PROMPT_VERSION = "v17";

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
  "capital_return",
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
  "Analyze one U.S. market company news item and return only strict JSON matching the response schema.",
  "Read the full article. The first-pass route is only a hint; correct it if the full article points elsewhere.",
  "Use article body text as the source of truth. Do not use metadata, SEO keywords, snippets, or parser hints to add facts or tickers.",
  "Separate boilerplate from evidence. Ignore legal disclaimers and safe-harbor language, but use concrete business facts that appear near them.",
  "Decide the core market event by asking what changed for investors now: value, risk, liquidity, timing, rights, probability, or attention.",
  "A company item can be uncertain or preliminary and still matter if it changes investor expectations now.",
  "Do not overfit to the headline. If several facts appear, classify and score the development most likely to move investor attention.",
  "Use company scope when the investable question is about one issuer or a small named issuer set, even if customers, suppliers, or counterparties are named.",
  "Use broad sector/theme/macro scope only if the full article is mainly about a wider market exposure rather than an issuer development.",
  "Choose primary_ticker from the body text. Use a U.S.-listed ticker, ADR, or OTC symbol when available; do not invent one from metadata.",
  "Use related_tickers only for named peers, customers, suppliers, counterparties, owners, or directly affected issuers supported by the article.",
  "Choose event_type from the core development, not from the release format.",
  "Use fda_clinical for FDA approvals, clearances, CRLs, safety-label changes, clinical results, PDUFA dates, or advisory committee catalysts.",
  "Use capital_return only when the core development is an actual share repurchase, buyback authorization, repurchase allocation increase, or announced capital return program centered on repurchases.",
  "Do not use capital_return for financing, capital markets activity, capital allocation commentary, strategy updates, liquidity improvement, or transformation plans unless the article discloses a concrete repurchase/buyback action.",
  "For dividends use dividends. If buybacks and dividends both appear, follow the core development.",
  "Score by materiality, price sensitivity, specificity, source strength, timeliness, and market interest.",
  "Score is a 0-100 integer scale, not a 0-10 scale. Around 50 means feed-worthy, and 75 or higher means alert-worthy.",
  "Choose signal from the likely stock read-through for the primary ticker. Use volatile or neutral when direction is mixed.",
  "Create calendar_items only when the date itself is an investable catalyst or shareholder entitlement: earnings/results call, dividend ex/record/payment, or FDA/clinical scheduled milestone.",
  "If no useful scheduled catalyst exists, return an empty calendar_items array.",
  "Output format is strict: quick_take must be one sentence under 30 words.",
  "summary must be 1-3 sentences under 90 words total.",
  "why_it_matters must be one sentence under 45 words.",
  "score_reason must be under 24 words.",
  "bullish_points, bearish_points, key_evidence, and what_to_watch_next must each contain at most 4 items, each under 20 words.",
  "Do not write UI labels, routing labels, or instructions to read the original source.",
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

export function buildNewsEventAnalysisPrompt(
  input: NewsEventAnalysisInput,
  routeClassification?: Record<string, unknown> | null,
) {
  return {
    key: NEWS_EVENT_ANALYSIS_PROMPT_KEY,
    version: NEWS_EVENT_ANALYSIS_PROMPT_VERSION,
    system: newsEventAnalysisSystemPrompt,
    user: JSON.stringify({
      ...input,
      route_classification: routeClassification || null,
    }),
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
