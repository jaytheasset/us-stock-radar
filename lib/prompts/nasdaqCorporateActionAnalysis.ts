import {
  newsEventAnalysisResponseSchema,
  type NewsEventAnalysisInput,
  type NewsPromptMarketContext,
} from "@/lib/prompts/newsEventAnalysis";
import { LISTING_RISK_MONITOR_ROUTING_PROMPT_INSTRUCTIONS } from "@/lib/monitor/monitorRouting";

export const NASDAQ_CORPORATE_ACTION_ANALYSIS_PROMPT_KEY = "nasdaq_corporate_action_analysis";
export const NASDAQ_CORPORATE_ACTION_ANALYSIS_PROMPT_VERSION = "v7-monitor-routing";

export type NasdaqCorporateActionAnalysisInput = NewsEventAnalysisInput & {
  corporate_action: Record<string, unknown> | null;
  corporate_action_event_family: string | null;
  market_context: NewsPromptMarketContext | null;
};

const systemPrompt = [
  "Analyze one Nasdaq Trader Equity Corporate Actions Alert for U.S. stock investors. Return only strict JSON matching the schema.",
  "This source is an exchange notice. Do not summarize the notice itself; analyze the investor consequence of the corporate action.",
  "The central question is: what materially changes for current or near-term holders of the security?",
  "Focus on changes to tradability, listing status, liquidity, share count, ownership, economic rights, consideration, dilution, timing, or forced action by holders.",
  "Administrative implementation details are not investor-facing analysis unless they change economics or trading behavior. Omit alert numbers, UPDATED labels, bulletin labels, CUSIP changes, contact text, and market-maker instructions unless they are the actual material event.",
  "Set source_group to news and market_scope to company unless the alert truly affects a broad market group.",
  "Use listing_risk for reverse splits, listing mechanics, trading suspensions, non-compliance mechanics, or actions that materially affect listing/trading status.",
  LISTING_RISK_MONITOR_ROUTING_PROMPT_INSTRUCTIONS,
  "Keep the existing corporate-action event_type classification independent from monitor_routes. In particular, a simple reverse split may retain its existing event_type while monitor_routes is [] unless the notice explicitly connects it to listing compliance or another material listing-status action.",
  "Use strategic_transaction for mergers, tender offers, business combinations, spin-offs, distributions, and plan-of-arrangement events.",
  "Use dilution_risk for rights offerings or corporate actions that directly create shareholder dilution.",
  "Use financial_risk or other for redemptions and administrative actions when no cleaner event_type fits.",
  "Do not treat every corporate action as bullish or bearish. Direction depends on the likely effect on current holders. If the effect is mixed, conditional, mechanical, or mainly volatility-driven, use volatile.",
  "Do not infer direction from the exchange mechanic itself. Halts, suspensions, delistings, symbol changes, CUSIP changes, and final trading dates can raise impact because they affect liquidity or settlement, but they do not prove bullish or bearish economics.",
  "Assign signal from the investor economics created by the action: consideration versus relevant market or reference price, dilution or ownership change, rights gained or lost, forced sale, redemption, conversion, exchange terms, regulatory weakness versus normal completion, and payment or settlement uncertainty.",
  "For fixed-cash consideration events such as cash mergers, tender offers, cash redemptions, and forced cash-outs, compare the cash price with the most relevant available market or reference price. If the cash price is within plus or minus 5%, use neutral and feed-level materiality unless another risk is clearly present. If the cash price is 5% or more above the reference price, use bullish and treat it as an alert candidate. If the cash price is 5% or more below the reference price, use bearish and treat it as an alert candidate.",
  "Use the current or last reliable trading price when the event is newly disclosed or still tradable. If the stock has already converged near a previously announced deal price, use the pre-announcement price when available and explain that the current price already reflects the deal. If no reliable reference price is available, do not force bullish or bearish direction from the exchange notice alone.",
  "A completed merger, tender offer, redemption, spin-off, or reorganization with defined consideration should usually be volatile or neutral unless the terms are clearly favorable or unfavorable to current holders.",
  "Use bearish only when the economic terms are adverse, uncertain in a harmful way, or caused by distress or compliance weakness. Use bullish only when the economic terms create clear upside, premium, improved rights, or favorable ownership or liquidity outcome.",
  "Bullish and bearish points should only explain real investor tradeoffs. Do not manufacture both sides for purely administrative notices.",
  "Score by practical investor relevance, not by how many details the notice contains. Higher scores require a meaningful change to trading, dilution, listing risk, ownership rights, merger economics, redemption terms, or near-term volatility.",
  "Score is a 0-100 integer scale. Around 50 means feed-worthy, and 75 or higher means alert-worthy.",
  "A feed-worthy item should help an investor decide whether to monitor, trade, verify filings, or reassess risk. Pure recordkeeping changes should stay low score.",
  "Write in natural investor language. Do not copy parser fields, table labels, slash-formatted values, or internal schema wording into user-facing prose.",
  "Calendar items should usually be empty for now unless the schema has a matching investor entitlement type.",
  "quick_take must be one sentence under 30 words. summary must be 1-3 natural sentences under 90 words. why_it_matters must be one sentence under 45 words.",
  "score_reason must be under 24 words. bullish_points, bearish_points, key_evidence, and what_to_watch_next must each have at most 4 items under 20 words each.",
].join("\n");

export function buildNasdaqCorporateActionAnalysisPrompt(input: NasdaqCorporateActionAnalysisInput) {
  return {
    key: NASDAQ_CORPORATE_ACTION_ANALYSIS_PROMPT_KEY,
    version: NASDAQ_CORPORATE_ACTION_ANALYSIS_PROMPT_VERSION,
    system: systemPrompt,
    user: JSON.stringify({
      ...input,
      output_contract: newsEventAnalysisResponseSchema,
    }),
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "nasdaq_corporate_action_analysis",
        strict: true,
        schema: newsEventAnalysisResponseSchema,
      },
    },
  };
}
