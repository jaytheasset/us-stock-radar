import { type NewsEventAnalysisInput } from "@/lib/prompts/newsEventAnalysis";

export const NEWS_ROUTE_CLASSIFICATION_PROMPT_KEY = "news_route_classification";
export const NEWS_ROUTE_CLASSIFICATION_PROMPT_VERSION = "v8";

export const NEWS_ROUTE_VALUES = [
  "company",
  "offering_dilution",
  "insider_ownership",
  "clinical_fda",
  "broad_market",
  "skip",
] as const;
export const NEWS_ROUTE_CONFIDENCE_VALUES = ["high", "medium", "low"] as const;

export type NewsRouteClassificationRoute = (typeof NEWS_ROUTE_VALUES)[number];

export type NewsRouteClassification = {
  route: NewsRouteClassificationRoute;
  confidence: (typeof NEWS_ROUTE_CONFIDENCE_VALUES)[number];
  reason: string;
  candidate_tickers: Array<{
    ticker: string;
    exchange: string | null;
    reason: string;
  }>;
};

export const newsRouteClassificationSystemPrompt = [
  "Classify the market question of one news item. Return only strict JSON matching the response schema.",
  "This is a lightweight first pass. Use the title, source, body excerpt, and visible body tickers only.",
  "The top-level question is whether a U.S. stock investor should see this now.",
  "Choose skip when the item does not change current expectations for U.S.-listed stocks, ADRs, or the U.S. stock market.",
  "Skip foreign local promotion, private-company product marketing, tourism promotion, generic market research, whitepapers, awards, routine events, and long-range industry content unless the article changes current U.S. stock-market expectations.",
  "Do not keep an item only because public companies are comparable vendors, peers, platforms, generic beneficiaries, or possible related tickers.",
  "Choose offering_dilution when the core market question is shareholder dilution from an offering, financing, convertible security, warrant, pre-funded warrant, PIPE, ATM takedown, registered direct, or shelf takedown.",
  "Choose insider_ownership when the core market question is insider buying or selling, officer/director ownership, beneficial ownership, activist ownership, or a material holder stake change.",
  "Choose company when the main question is which U.S.-listed issuer, ADR, OTC issuer, or clearly named issuer set changed.",
  "Choose clinical_fda when the market question is a current FDA, clinical, drug, device, diagnostic, label, safety, advisory-committee, PDUFA, trial, approval, clearance, CRL, recall, or biopharma catalyst.",
  "Use clinical_fda even when the article does not print a ticker, if the product, therapy, device, indication, sponsor, rights holder, or affected market can matter to U.S. stock investors.",
  "Do not route clinical_fda items to broad_market merely because ticker linkage is missing or requires second-pass market knowledge.",
  "Do not choose clinical_fda for routine static FDA pages, generic safety education, database notices, conferences, speeches, or administrative updates unless they disclose a current investable catalyst.",
  "Choose broad_market when a current event changes U.S. stock-market expectations through policy, sanctions, trade controls, commodities, supply chains, public health, infrastructure, labor disruption, geopolitical/security risk, regulation, or macro conditions.",
  "Official sanctions, trade controls, export controls, tariff actions, and agency enforcement can be broad_market even without named public issuers when they affect energy, commodities, shipping, banks, critical minerals, defense, healthcare regulation, or other U.S. stock-market exposures.",
  "Do not skip OFAC, DOJ, SEC, White House, or agency actions merely because no issuer ticker is named; ask whether the action changes U.S. stock-market risk or expectations.",
  "Official government or agency actions are broad_market only when they matter to U.S. stocks or U.S. market expectations; otherwise choose skip.",
  "Do not analyze score, signal, or related tickers here. Only choose the better second-pass route.",
  "Return candidate_tickers for market context before second-pass analysis: clear body tickers, active tickers for clear primary issuers, and obvious sponsor/right-holder tickers.",
  "Keep candidate_tickers short and only include symbols useful for price, float, market cap, or volume context.",
  "Do not copy raw parser, formatter, schema, or structured-field wording into user-facing analysis.",
  "Use the underlying values only as evidence, then rewrite them in natural investor-facing language that explains what happened and why it matters.",
  "When unsure, ask whether this belongs on a U.S. stock investor's screen today. If not, choose skip.",
  "Keep reason under 20 words.",
].join("\n");

export const newsRouteClassificationResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["route", "confidence", "reason", "candidate_tickers"],
  properties: {
    route: { type: "string", enum: NEWS_ROUTE_VALUES },
    confidence: { type: "string", enum: NEWS_ROUTE_CONFIDENCE_VALUES },
    reason: { type: "string" },
    candidate_tickers: {
      type: "array",
      maxItems: 6,
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
  },
} as const;

export function buildNewsRouteClassificationPrompt(input: NewsEventAnalysisInput) {
  return {
    key: NEWS_ROUTE_CLASSIFICATION_PROMPT_KEY,
    version: NEWS_ROUTE_CLASSIFICATION_PROMPT_VERSION,
    system: newsRouteClassificationSystemPrompt,
    user: JSON.stringify(buildRouteClassificationInput(input)),
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "news_route_classification",
        strict: true,
        schema: newsRouteClassificationResponseSchema,
      },
    },
  };
}

function buildRouteClassificationInput(input: NewsEventAnalysisInput) {
  return {
    source_code: input.source_code,
    source_name: input.source_name,
    published_at: input.published_at,
    title: input.title,
    body_excerpt: trimRouteBody(input.body_text),
    body_tickers: input.body_tickers,
  };
}

function trimRouteBody(value: string) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return normalized.length > 2200 ? `${normalized.slice(0, 2200)} [TRUNCATED]` : normalized;
}
