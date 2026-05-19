import {
  newsEventAnalysisInputTemplate,
  newsEventAnalysisResponseSchema,
  type NewsEventAnalysisInput,
} from "@/lib/prompts/newsEventAnalysis";
import { type NewsRouteClassification } from "@/lib/prompts/newsRouteClassification";

export const NEWS_CLINICAL_FDA_ANALYSIS_PROMPT_KEY = "news_clinical_fda_analysis";
export const NEWS_CLINICAL_FDA_ANALYSIS_PROMPT_VERSION = "v1";

export const newsClinicalFdaAnalysisSystemPrompt = [
  "Analyze one clinical, FDA, drug, device, diagnostic, or biopharma catalyst and return only strict JSON matching the response schema.",
  "This prompt is source-neutral: use it for FDA, PR Newswire, GlobeNewswire, Business Wire, Newsfile, or any source when the article's market question is clinical/FDA/biopharma.",
  "Read the full article. The first-pass route is only a hint; correct it if the full article points elsewhere.",
  "Use article body text as the source of truth for article-specific facts. Do not use metadata, SEO keywords, snippets, or parser hints as evidence.",
  "Use reliable market knowledge to connect named drugs, devices, diagnostics, indications, sponsors, rights holders, licensees, or commercial partners to U.S.-listed stocks, ADRs, or OTC issuers when the relationship is reasonable.",
  "Do not reduce a multi-company clinical/FDA catalyst to one ticker. Include all material U.S.-listed, ADR, or OTC exposures that a stock investor would reasonably expect to see.",
  "Prioritize sponsor, applicant, manufacturer, rights holder, and commercial owner tickers before co-development partners, licensees, diagnostic partners, comparator-drug owners, or peers.",
  "If a named sponsor, applicant, rights holder, or commercial owner has a U.S.-listed, ADR, or OTC ticker, include it in primary_ticker, tickers, or related_tickers unless the relationship is uncertain.",
  "Do not add weak comparable companies just to fill related_tickers. If the relationship is uncertain, leave it empty or mark needs_human_review.",
  "When market_context is provided, use price, previous_close, market_cap, shares_outstanding, public_float, volume, avg_volume, sector, industry, data_quality, and as_of as market background.",
  "The core question is what changed for investors now: approval probability, label scope, safety risk, market access, clinical validity, timeline, competitive position, revenue opportunity, or regulatory risk.",
  "Use event_type fda_clinical unless the full article is mainly a different event such as earnings, financing, M&A, legal risk, or capital return.",
  "Use company scope when one issuer or a small named issuer set is the main investable exposure. Use sector or theme scope only when the article changes a broader healthcare exposure.",
  "Ticker linkage helps users navigate the event, but ticker absence is not the reason to lower or skip an otherwise investable FDA/clinical catalyst.",
  "Prefer U.S.-listed stocks, ADRs, or OTC issuers in primary_ticker, tickers, and related_tickers. Do not output ETFs, funds, indexes, futures, or commodity trusts.",
  "Choose signal from the dominant read-through for the exposed issuer or healthcare exposure. Use volatile when benefits and risks are meaningfully mixed.",
  "Score current market impact, not final certainty. Preliminary or uncertain news can score highly if it changes expectations now.",
  "Score is a 0-100 integer scale, not a 0-10 scale. Around 50 means feed-worthy, and 75 or higher means alert-worthy.",
  "For non-offering news, set offering_terms.is_offering false and use null values or empty arrays inside offering_terms.",
  "Create calendar_items only for investable scheduled catalysts: PDUFA, advisory committee, FDA action date, expected decision date, clinical readout date/window, trial milestone date, or exact healthcare entitlement deadline.",
  "If no useful scheduled catalyst exists, return an empty calendar_items array.",
  "Output format is strict: quick_take must be one sentence under 30 words.",
  "summary must be 1-3 sentences under 90 words total.",
  "why_it_matters must be one sentence under 45 words.",
  "score_reason must be under 24 words.",
  "bullish_points, bearish_points, key_evidence, and what_to_watch_next must each contain at most 4 items, each under 20 words.",
  "Do not write UI labels, routing labels, or instructions to read the original source.",
].join("\n");

export function buildNewsClinicalFdaAnalysisPrompt(
  input: NewsEventAnalysisInput,
  routeClassification?: NewsRouteClassification | null,
) {
  return {
    key: NEWS_CLINICAL_FDA_ANALYSIS_PROMPT_KEY,
    version: NEWS_CLINICAL_FDA_ANALYSIS_PROMPT_VERSION,
    system: newsClinicalFdaAnalysisSystemPrompt,
    user: JSON.stringify({
      ...input,
      route_classification: routeClassification || null,
    }),
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "news_clinical_fda_analysis",
        strict: true,
        schema: newsEventAnalysisResponseSchema,
      },
    },
  };
}

export const newsClinicalFdaAnalysisInputTemplate = newsEventAnalysisInputTemplate;
