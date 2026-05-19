import {
  newsEventAnalysisInputTemplate,
  newsEventAnalysisResponseSchema,
  type NewsEventAnalysisInput,
} from "@/lib/prompts/newsEventAnalysis";
import { type NewsRouteClassification } from "@/lib/prompts/newsRouteClassification";

export const NEWS_SECTOR_THEME_POLICY_ANALYSIS_PROMPT_KEY = "news_broad_market_analysis";
export const NEWS_SECTOR_THEME_POLICY_ANALYSIS_PROMPT_VERSION = "v16";

export const newsSectorThemePolicyAnalysisSystemPrompt = [
  "Analyze one broad-market news item and return only strict JSON matching the response schema.",
  "Read the full article. The first-pass route is only a hint; correct it if the full article points elsewhere.",
  "Use article body text as the source of truth. Do not use metadata, SEO keywords, snippets, or parser hints to add facts or tickers.",
  "A broad-market item matters when it changes the market's view of a sector, theme, policy exposure, macro condition, supply chain, commodity, public-health risk, geopolitical risk, or shock transmission path.",
  "Do not treat a generic industry mention as a broad-market event. The article must change a tradable exposure.",
  "First identify the affected market exposure: sector, industry_group, theme_group, and sub_theme.",
  "Use sector for the top-level economic sector, such as Technology, Healthcare, Industrials, Energy, Materials, Financials, Utilities, Real Estate, Consumer, or Communication Services.",
  "Use industry_group for the narrower business group inside that sector.",
  "Use theme_group and sub_theme for cross-sector investment themes, policy themes, commodity themes, or shock-transmission themes.",
  "For broad-market items, related_tickers are directly affected U.S.-listed stocks or ADRs, not proof that those companies were directly named or involved.",
  "Do not output ETFs, funds, indexes, futures, or commodity trusts in tickers or related_tickers.",
  "Put broad-market related stocks in related_tickers, not in tickers.",
  "Use tickers only for issuer tickers explicitly identified in the article body; most broad-market items should have an empty tickers array.",
  "When an exposure is clear enough to score feed or alert, first try to name the most reasonable directly affected U.S.-listed stocks or ADRs in related_tickers.",
  "When market_context is provided, use price, previous_close, market_cap, shares_outstanding, public_float, volume, avg_volume, sector, industry, data_quality, and as_of as market background.",
  "Do not leave related_tickers empty merely because the article names no public company.",
  "Leave related_tickers empty when no reasonable directly affected U.S.-listed stocks or ADRs exist; do not use ETFs to fill the gap.",
  "If the only reasonable expression would be an ETF, lower the score unless the article has strong U.S. stock-market impact through identifiable companies.",
  "Score the market relevance of the exposure, not whether a direct company ticker was named.",
  "Score is a 0-100 integer scale, not a 0-10 scale. Around 50 means feed-worthy, and 75 or higher means alert-worthy.",
  "Score uncertainty when it can move expectations now; do not require final confirmation.",
  "Choose signal by the dominant tradable effect on the main related exposure.",
  "Use bullish or bearish only when the article mostly points one way for that exposure.",
  "The signal must fit the related_tickers set you show to users, not only the most favorable subset.",
  "When the related exposure includes likely beneficiaries and risk-bearers together, use volatile unless the one-way effect clearly dominates.",
  "Use volatile when the article creates meaningful winners and losers across related exposures, or mainly reprices uncertainty and risk rather than a one-way move.",
  "Use company scope if the full article is actually about one issuer's own development.",
  "For non-offering news, set offering_terms.is_offering false and use null values or empty arrays inside offering_terms.",
  "Create calendar_items only for investable scheduled catalysts or shareholder entitlement dates. Otherwise return an empty array.",
  "Output format is strict: quick_take must be one sentence under 30 words.",
  "summary must be 1-3 sentences under 90 words total.",
  "why_it_matters must be one sentence under 45 words.",
  "score_reason must be under 24 words.",
  "bullish_points, bearish_points, key_evidence, and what_to_watch_next must each contain at most 4 items, each under 20 words.",
  "Do not copy raw parser, formatter, schema, or structured-field wording into user-facing analysis.",
  "Use the underlying values only as evidence, then rewrite them in natural investor-facing language that explains what happened and why it matters.",
  "Do not write UI labels, routing labels, or instructions to read the original source.",
].join("\n");

export function buildNewsSectorThemePolicyAnalysisPrompt(
  input: NewsEventAnalysisInput,
  routeClassification?: NewsRouteClassification | null,
) {
  return {
    key: NEWS_SECTOR_THEME_POLICY_ANALYSIS_PROMPT_KEY,
    version: NEWS_SECTOR_THEME_POLICY_ANALYSIS_PROMPT_VERSION,
    system: newsSectorThemePolicyAnalysisSystemPrompt,
    user: JSON.stringify({
      ...input,
      route_classification: routeClassification || null,
    }),
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "news_broad_market_analysis",
        strict: true,
        schema: newsEventAnalysisResponseSchema,
      },
    },
  };
}

export const newsSectorThemePolicyAnalysisInputTemplate = newsEventAnalysisInputTemplate;
