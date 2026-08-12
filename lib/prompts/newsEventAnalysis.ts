import { CALENDAR_EVENT_TYPE_VALUES } from "@/lib/calendarEventRegistry";
import { NEWS_EVENT_TYPE_VALUES } from "@/lib/eventTypeRegistry";
import {
  LISTING_RISK_MONITOR_ROUTING_PROMPT_INSTRUCTIONS,
  MONITOR_ROUTING_RESULT_JSON_SCHEMA,
} from "@/lib/monitor/monitorRouting";
export { NEWS_EVENT_TYPE_VALUES } from "@/lib/eventTypeRegistry";

export const NEWS_EVENT_ANALYSIS_PROMPT_KEY = "news_event_analysis";
export const NEWS_EVENT_ANALYSIS_PROMPT_VERSION = "v27-monitor-routing";

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
  market_context: NewsPromptMarketContext | null;
};

export type NewsPromptMarketContext = {
  available: boolean;
  symbols: string[];
  items: Array<{
    symbol: string;
    name: string | null;
    exchange: string | null;
    asset_type: string | null;
    sector: string | null;
    industry: string | null;
    price: number | null;
    previous_close: number | null;
    market_cap: number | null;
    shares_outstanding: number | null;
    public_float: number | null;
    volume: number | null;
    avg_volume: number | null;
    as_of: string | null;
    data_quality: "complete" | "partial" | "missing";
    field_sources: Record<string, string | null>;
  }>;
  notes: string[];
};

export const newsEventAnalysisInputTemplate = `{
  "source_code": "{{source_code}}",
  "source_name": "{{source_name}}",
  "source_url": "{{source_url}}",
  "published_at": "{{published_at}}",
  "title": "{{title}}",
  "body_text": "{{body_text}}",
  "body_tickers": {{body_tickers_json}},
  "metadata_tickers_debug_only": {{metadata_tickers_json}},
  "market_context": {{market_context_json}}
}`;

export const newsEventAnalysisSystemPrompt = [
  "Analyze one U.S. stock-market news item and return one complete strict JSON object matching output_contract.",
  "Use article body text as the source of truth for article-specific facts. Do not use metadata, SEO keywords, snippets, or parser hints as evidence.",
  "Separate boilerplate from evidence. Ignore legal disclaimers and safe-harbor language, but use concrete business facts that appear near them.",
  "Decide the core market event by asking what changed for investors now: value, risk, liquidity, timing, rights, probability, or attention.",
  "A company item can be uncertain or preliminary and still matter if it changes investor expectations now.",
  "Do not overfit to the headline. If several facts appear, classify and score the development most likely to move investor attention.",
  "Use company scope when the investable question is about one issuer or a small named issuer set, even if customers, suppliers, or counterparties are named.",
  "Use broad sector/theme/macro scope only if the full article is mainly about a wider market exposure rather than an issuer development.",
  "A broad-market item matters when it changes expectations for a sector, theme, policy exposure, macro condition, supply chain, commodity, public-health risk, geopolitical risk, or shock transmission path.",
  "Do not treat a generic industry mention as a broad-market event; it must change a tradable U.S. stock exposure.",
  "For broad-market items, identify sector, industry_group, theme_group, and sub_theme. Put directly affected U.S.-listed stocks or ADRs in related_tickers, not tickers, unless the issuer is explicitly identified in the article.",
  "Do not output ETFs, funds, indexes, futures, or commodity trusts in tickers or related_tickers.",
  "When the article's primary issuer is clear, actively identify its ticker and exchange for primary_ticker even if body_tickers is empty.",
  "When market_context is provided, use price, previous_close, market_cap, shares_outstanding, public_float, volume, avg_volume, sector, industry, data_quality, and as_of as market background.",
  "For related_tickers, you may use reliable market knowledge to connect named products, drugs, assets, owners, licensees, co-commercialization partners, customers, suppliers, counterparties, or directly exposed U.S.-listed/ADR issuers.",
  "Do not add weak comparable tickers just to fill related_tickers; if a relationship is uncertain, leave it empty or mark needs_human_review.",
  "Choose event_type from the core development, not from the release format.",
  LISTING_RISK_MONITOR_ROUTING_PROMPT_INSTRUCTIONS,
  "Use fda_clinical for FDA approvals, clearances, CRLs, safety-label changes, clinical results, PDUFA dates, or advisory committee catalysts.",
  "For clinical, FDA, drug, device, diagnostic, or biopharma news, identify material sponsors, applicants, rights holders, licensees, manufacturers, and commercial partners with U.S.-listed, ADR, or OTC exposure.",
  "Do not reduce a multi-company clinical/FDA catalyst to one ticker, and do not lower an otherwise investable catalyst only because the article omits a ticker.",
  "For clinical/FDA events, judge what changed in approval probability, label scope, safety risk, market access, clinical validity, timeline, competitive position, revenue opportunity, or regulatory risk.",
  "Use capital_return only when the core development is an actual share repurchase, buyback authorization, repurchase allocation increase, or announced capital return program centered on repurchases.",
  "Do not use capital_return for financing, capital markets activity, capital allocation commentary, strategy updates, liquidity improvement, or transformation plans unless the article discloses a concrete repurchase/buyback action.",
  "For dividends use dividends. If buybacks and dividends both appear, follow the core development.",
  "Use ipo_listing for traditional IPOs, SPAC IPOs, direct listings, IPO pricing, first trading/listing dates, or registration effectiveness tied to a new public listing.",
  "For IPO/SPAC listing details, keep event_type ipo_listing and separate the subtype as traditional or spac in downstream display metadata when available.",
  "For fixed-cash consideration events such as cash mergers, tender offers, cash redemptions, and forced cash-outs, compare the cash price with the most relevant available market or reference price. If the cash price is within plus or minus 5%, use neutral and feed-level materiality unless another risk is clearly present. If the cash price is 5% or more above the reference price, use bullish and treat it as an alert candidate. If the cash price is 5% or more below the reference price, use bearish and treat it as an alert candidate.",
  "Use the current or last reliable trading price when the event is newly disclosed or still tradable. If the stock has already converged near a previously announced deal price, use the pre-announcement price when available and explain that the current price already reflects the deal. If no reliable reference price is available, do not force bullish or bearish direction from transaction mechanics alone.",
  "For dilution_risk, registered direct, public offering, PIPE, ATM, convertible, warrant, pre-funded warrant, or shelf takedown news, fill offering_terms with only the disclosed terms.",
  "For dilution_risk, separate common shares, pre-funded warrants, ordinary/common warrants, and convertible securities. Do not collapse pre-funded warrants into ordinary warrants.",
  "For pre-funded warrants, treat the share count as near-immediate share exposure when disclosed because the exercise price is usually nominal.",
  "For ordinary/common warrants and convertible securities, treat disclosed share coverage as future overhang, not immediate issued shares.",
  "Set total_potential_share_exposure to the disclosed total if the article gives one; otherwise use the disclosed component counts you can identify without inventing missing numbers.",
  "For non-offering news, set offering_terms.is_offering false and use null values or empty arrays inside offering_terms.",
  "Do not calculate dilution percentages, discount to market, or market-cap percentages in offering_terms; code will calculate those from market_context.",
  "For dilution_risk analysis, do not merely summarize the financing. Interpret the pressure by comparing disclosed offering price, warrant exercise price, note conversion price, or other exercise/conversion terms against market_context price or previous_close when available.",
  "For dilution_risk analysis, compare disclosed share issuance, warrant share coverage, convertible share exposure, or offering amount against market_context shares_outstanding, public_float, and market_cap when available.",
  "In quick_take, why_it_matters, bearish_points, score_reason, and what_to_watch_next, explain the practical market read-through: near-market vs discounted pricing, immediate dilution, future warrant/convertible overhang, and whether the size is small, moderate, or large relative to the issuer.",
  "If market_context is missing or partial, say which comparison is unavailable instead of pretending precision.",
  "Score by materiality, price sensitivity, specificity, source strength, timeliness, and market interest.",
  "Score is a 0-100 integer scale, not a 0-10 scale. Around 50 means feed-worthy, and 75 or higher means alert-worthy.",
  "Choose signal from the likely stock read-through for the primary ticker. Use volatile or neutral when direction is mixed.",
  "Use bullish_points and bearish_points only for distinct directional facts explicitly source-backed by the article body.",
  "If source-backed directional facts are insufficient, use fewer items or an empty array []. Empty arrays are normal and expected.",
  "Do not manufacture both bullish_points and bearish_points merely to fill the JSON schema.",
  "For a bullish signal, include bearish_points only when the article explicitly states an important counter-risk or condition; otherwise use bearish_points: [].",
  "For a bearish signal, include bullish_points only when the article explicitly states an important offsetting factor or catalyst; otherwise use bullish_points: [].",
  "For volatile or mixed developments, use both arrays only when the article actually provides distinct source-backed facts on both sides.",
  "For neutral, administrative, or mechanical news, one or both directional arrays may naturally be empty.",
  "Do not unnecessarily repeat the same fact across bullish_points, bearish_points, summary, why_it_matters, and key_evidence.",
  "Create calendar_items only when the date itself is an investable catalyst or shareholder entitlement: earnings/results call, dividend ex/record/payment, or FDA/clinical scheduled milestone.",
  "If no useful scheduled catalyst exists, return an empty calendar_items array.",
  "Output format is strict: quick_take must be one sentence under 30 words.",
  "summary must be 1-3 sentences under 90 words total.",
  "For dilution_risk only, summary may be 2-4 sentences under 150 words total so it can explain offering structure, immediate dilution, future warrant/convertible overhang, and market-context comparisons.",
  "why_it_matters must be one sentence under 45 words.",
  "score_reason must be under 24 words.",
  "bullish_points, bearish_points, key_evidence, and what_to_watch_next must each contain at most 4 items, each under 20 words.",
  "Do not copy raw parser, formatter, schema, or structured-field wording into user-facing analysis.",
  "Use the underlying values only as evidence, then rewrite them in natural investor-facing language that explains what happened and why it matters.",
  "Do not write UI labels, routing labels, or instructions to read the original source.",
].join("\n");

export const newsEventAnalysisResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "source_group",
    "market_scope",
    "event_type",
    "monitor_routes",
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
    "offering_terms",
    "confidence",
    "needs_human_review",
  ],
  properties: {
    source_group: { type: "string", enum: SOURCE_GROUP_VALUES },
    market_scope: { type: "string", enum: MARKET_SCOPE_VALUES },
    event_type: { type: "string", enum: NEWS_EVENT_TYPE_VALUES },
    monitor_routes: MONITOR_ROUTING_RESULT_JSON_SCHEMA.properties.monitor_routes,
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
    bullish_points: {
      type: "array",
      description: "Required key; use an empty array when no source-backed bullish fact exists.",
      items: { type: "string" },
    },
    bearish_points: {
      type: "array",
      description: "Required key; use an empty array when no source-backed bearish fact exists.",
      items: { type: "string" },
    },
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
    offering_terms: {
      type: "object",
      additionalProperties: false,
      required: [
        "is_offering",
        "offering_type",
        "security_type",
        "primary_or_resale",
        "offering_amount",
        "shares_offered",
        "offering_price",
        "common_shares",
        "prefunded_warrants",
        "common_warrants",
        "convertible_securities",
        "total_potential_share_exposure",
        "warrants",
        "use_of_proceeds",
        "closing_date",
        "evidence",
        "needs_human_review",
      ],
      properties: {
        is_offering: { type: "boolean" },
        offering_type: {
          type: ["string", "null"],
          enum: [
            "registered_direct",
            "public_offering",
            "private_placement",
            "atm",
            "shelf_takedown",
            "convertible_financing",
            "warrant_exercise",
            "rights_offering",
            "mixed",
            "other",
            null,
          ],
        },
        security_type: {
          type: ["string", "null"],
          enum: [
            "common_stock",
            "common_shares",
            "ordinary_shares",
            "ads",
            "units",
            "warrants",
            "prefunded_warrants",
            "convertible_notes",
            "mixed",
            "other",
            null,
          ],
        },
        primary_or_resale: {
          type: ["string", "null"],
          enum: ["primary", "resale", "mixed", "not_disclosed", null],
        },
        offering_amount: {
          type: "object",
          additionalProperties: false,
          required: ["value_text", "amount", "currency", "evidence"],
          properties: {
            value_text: { type: ["string", "null"] },
            amount: { type: ["number", "null"] },
            currency: { type: ["string", "null"] },
            evidence: { type: ["string", "null"] },
          },
        },
        shares_offered: {
          type: "object",
          additionalProperties: false,
          required: ["value_text", "count", "evidence"],
          properties: {
            value_text: { type: ["string", "null"] },
            count: { type: ["number", "null"] },
            evidence: { type: ["string", "null"] },
          },
        },
        offering_price: {
          type: "object",
          additionalProperties: false,
          required: ["value_text", "price", "currency", "evidence"],
          properties: {
            value_text: { type: ["string", "null"] },
            price: { type: ["number", "null"] },
            currency: { type: ["string", "null"] },
            evidence: { type: ["string", "null"] },
          },
        },
        common_shares: {
          type: "object",
          additionalProperties: false,
          required: ["value_text", "count", "evidence"],
          properties: {
            value_text: { type: ["string", "null"] },
            count: { type: ["number", "null"] },
            evidence: { type: ["string", "null"] },
          },
        },
        prefunded_warrants: {
          type: "object",
          additionalProperties: false,
          required: ["included", "shares", "exercise_price", "evidence"],
          properties: {
            included: { type: "boolean" },
            shares: {
              type: "object",
              additionalProperties: false,
              required: ["value_text", "count", "evidence"],
              properties: {
                value_text: { type: ["string", "null"] },
                count: { type: ["number", "null"] },
                evidence: { type: ["string", "null"] },
              },
            },
            exercise_price: {
              type: "object",
              additionalProperties: false,
              required: ["value_text", "price", "currency", "evidence"],
              properties: {
                value_text: { type: ["string", "null"] },
                price: { type: ["number", "null"] },
                currency: { type: ["string", "null"] },
                evidence: { type: ["string", "null"] },
              },
            },
            evidence: { type: ["string", "null"] },
          },
        },
        common_warrants: {
          type: "object",
          additionalProperties: false,
          required: ["included", "shares", "exercise_price", "expiration_text", "evidence"],
          properties: {
            included: { type: "boolean" },
            shares: {
              type: "object",
              additionalProperties: false,
              required: ["value_text", "count", "evidence"],
              properties: {
                value_text: { type: ["string", "null"] },
                count: { type: ["number", "null"] },
                evidence: { type: ["string", "null"] },
              },
            },
            exercise_price: {
              type: "object",
              additionalProperties: false,
              required: ["value_text", "price", "currency", "evidence"],
              properties: {
                value_text: { type: ["string", "null"] },
                price: { type: ["number", "null"] },
                currency: { type: ["string", "null"] },
                evidence: { type: ["string", "null"] },
              },
            },
            expiration_text: { type: ["string", "null"] },
            evidence: { type: ["string", "null"] },
          },
        },
        convertible_securities: {
          type: "object",
          additionalProperties: false,
          required: ["included", "principal_amount", "conversion_price", "share_exposure", "evidence"],
          properties: {
            included: { type: "boolean" },
            principal_amount: {
              type: "object",
              additionalProperties: false,
              required: ["value_text", "amount", "currency", "evidence"],
              properties: {
                value_text: { type: ["string", "null"] },
                amount: { type: ["number", "null"] },
                currency: { type: ["string", "null"] },
                evidence: { type: ["string", "null"] },
              },
            },
            conversion_price: {
              type: "object",
              additionalProperties: false,
              required: ["value_text", "price", "currency", "evidence"],
              properties: {
                value_text: { type: ["string", "null"] },
                price: { type: ["number", "null"] },
                currency: { type: ["string", "null"] },
                evidence: { type: ["string", "null"] },
              },
            },
            share_exposure: {
              type: "object",
              additionalProperties: false,
              required: ["value_text", "count", "evidence"],
              properties: {
                value_text: { type: ["string", "null"] },
                count: { type: ["number", "null"] },
                evidence: { type: ["string", "null"] },
              },
            },
            evidence: { type: ["string", "null"] },
          },
        },
        total_potential_share_exposure: {
          type: "object",
          additionalProperties: false,
          required: ["value_text", "count", "evidence"],
          properties: {
            value_text: { type: ["string", "null"] },
            count: { type: ["number", "null"] },
            evidence: { type: ["string", "null"] },
          },
        },
        warrants: {
          type: "object",
          additionalProperties: false,
          required: ["included", "coverage_text", "exercise_price", "expiration_text", "evidence"],
          properties: {
            included: { type: "boolean" },
            coverage_text: { type: ["string", "null"] },
            exercise_price: {
              type: "object",
              additionalProperties: false,
              required: ["value_text", "price", "currency", "evidence"],
              properties: {
                value_text: { type: ["string", "null"] },
                price: { type: ["number", "null"] },
                currency: { type: ["string", "null"] },
                evidence: { type: ["string", "null"] },
              },
            },
            expiration_text: { type: ["string", "null"] },
            evidence: { type: ["string", "null"] },
          },
        },
        use_of_proceeds: {
          type: "object",
          additionalProperties: false,
          required: ["value_text", "evidence"],
          properties: {
            value_text: { type: ["string", "null"] },
            evidence: { type: ["string", "null"] },
          },
        },
        closing_date: {
          type: "object",
          additionalProperties: false,
          required: ["value", "date_precision", "evidence"],
          properties: {
            value: { type: ["string", "null"] },
            date_precision: { type: "string", enum: DATE_PRECISION_VALUES },
            evidence: { type: ["string", "null"] },
          },
        },
        evidence: { type: "array", items: { type: "string" } },
        needs_human_review: { type: "boolean" },
      },
    },
    confidence: { type: "string", enum: CONFIDENCE_VALUES },
    needs_human_review: { type: "boolean" },
  },
} as const;

export function buildNewsEventAnalysisPrompt(
  input: NewsEventAnalysisInput,
) {
  return {
    key: NEWS_EVENT_ANALYSIS_PROMPT_KEY,
    version: NEWS_EVENT_ANALYSIS_PROMPT_VERSION,
    system: newsEventAnalysisSystemPrompt,
    user: JSON.stringify({
      ...input,
      output_contract: newsEventAnalysisResponseSchema,
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
