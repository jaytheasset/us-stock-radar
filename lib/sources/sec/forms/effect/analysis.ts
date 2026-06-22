import { buildEffectDisplayPayload } from "./displayPayload";
import { parseEffectFiling } from "./parser";
import { routeEffectFiling } from "./router";
import {
  deliveryLevelForScore,
  type AnalysisOutput,
  type EffectParseInput,
  type EffectParserOutput,
  type EffectRequiredOutput,
  type EffectRouterDecision,
  type FixtureExpected,
} from "./types";

export function analyzeEffectFiling(input: EffectParseInput): EffectRequiredOutput {
  const parserOutput = parseEffectFiling(input);
  const routeDecision = routeEffectFiling(parserOutput);

  return buildEffectResult(parserOutput, routeDecision);
}

export function buildEffectResult(parserOutput: EffectParserOutput, routeDecision: EffectRouterDecision): EffectRequiredOutput {
  const analysisOutput = buildAnalysisOutput(parserOutput, routeDecision);

  return {
    parser_output: parserOutput,
    analysis_output: analysisOutput,
    display_payload: buildEffectDisplayPayload(parserOutput, routeDecision),
    fixture_expected: buildFixtureExpected(parserOutput, routeDecision),
  };
}

function buildAnalysisOutput(parserOutput: EffectParserOutput, routeDecision: EffectRouterDecision): AnalysisOutput {
  const facts = parserOutput.facts;
  const company = facts.companyName ?? "Issuer";
  const form = facts.effectiveFilingForm ?? "registration statement";
  const primaryTicker = {
    ticker: facts.ticker,
    exchange: facts.exchange,
  };

  return {
    source_group: "filings",
    market_scope: "company",
    event_type: routeDecision.eventType,
    event_title: buildEventTitle(company, form, routeDecision.eventType),
    primary_ticker: primaryTicker,
    tickers: facts.ticker === null ? [] : [primaryTicker],
    sector: null,
    industry_group: null,
    theme_group: null,
    sub_theme: null,
    score: routeDecision.preliminaryScore,
    score_reason: routeDecision.routeReason,
    signal: routeDecision.preliminarySignal,
    quick_take: buildQuickTake(company, form, routeDecision),
    summary: parserOutput.summary ?? buildFallbackSummary(company, form),
    why_it_matters: buildWhyItMatters(routeDecision, form),
    bullish_points: buildBullishPoints(routeDecision, form),
    bearish_points: buildBearishPoints(routeDecision, form),
    key_evidence: parserOutput.facts.sourceExcerpts,
    what_to_watch_next: buildWatchItems(routeDecision, parserOutput),
    related_tickers: [],
    calendar_items: parserOutput.calendarItems,
    confidence: routeDecision.preliminaryConfidence,
    needs_human_review: routeDecision.needsHumanReview,
  };
}

function buildEventTitle(company: string, form: string, eventType: string): string {
  if (eventType === "strategic_transaction") {
    return `${company} ${form} registration statement declared effective`;
  }

  if (eventType === "dilution_risk") {
    return `${company} ${form} registration statement effective`;
  }

  return `${company} EFFECT notice needs registration context`;
}

function buildQuickTake(company: string, form: string, routeDecision: EffectRouterDecision): string {
  if (routeDecision.eventType === "other") {
    return `${company} filed an EFFECT notice, but the fixture does not identify enough related registration context for a stronger deterministic call.`;
  }

  return `${company}'s ${form} registration statement became effective; investors should review the original registration filing for securities, holders, and transaction terms.`;
}

function buildFallbackSummary(company: string, form: string): string {
  return `${company}'s ${form} registration statement became effective.`;
}

function buildWhyItMatters(routeDecision: EffectRouterDecision, form: string): string {
  if (routeDecision.eventType === "strategic_transaction") {
    return `Effectiveness of a ${form} registration statement can remove an SEC registration gating item for a merger, exchange, or acquisition-related issuance.`;
  }

  if (routeDecision.eventType === "dilution_risk") {
    return `Effectiveness of a ${form} registration statement can allow registered issuance or resale activity under the related registration filing.`;
  }

  return "An EFFECT notice confirms SEC effectiveness, but the investor impact depends on the related registration statement.";
}

function buildBullishPoints(routeDecision: EffectRouterDecision, form: string): string[] {
  if (routeDecision.eventType === "strategic_transaction") {
    return [`The ${form} effectiveness step can help the related transaction move toward completion.`];
  }

  if (routeDecision.eventType === "dilution_risk") {
    return [`The effective registration statement may improve financing flexibility or resale liquidity.`];
  }

  return [];
}

function buildBearishPoints(routeDecision: EffectRouterDecision, form: string): string[] {
  if (routeDecision.eventType === "dilution_risk") {
    return [`The ${form} effectiveness may permit registered share issuance or resale pressure if the original filing includes equity securities.`];
  }

  if (routeDecision.eventType === "other") {
    return ["The fixture lacks the related registration filing, so investors cannot assess the specific securities or transaction terms from this EFFECT notice alone."];
  }

  return [];
}

function buildWatchItems(routeDecision: EffectRouterDecision, parserOutput: EffectParserOutput): string[] {
  const items = ["Original registration filing terms", "Any prospectus supplement or related 424B filing"];

  if (parserOutput.facts.hasSeriesClassContractData) {
    items.unshift("Series and class/contract covered by the EFFECT notice");
  }

  if (parserOutput.facts.originalAnalysisShouldBeShown) {
    items.unshift("Linked analysis for the original registration filing");
  }

  if (parserOutput.facts.hasMultipleFilers) {
    items.push("Each filer and Securities Act file number in the EFFECT notice");
  }

  if (routeDecision.eventType === "strategic_transaction") {
    items.push("Transaction closing conditions and shareholder timing");
  }

  if (routeDecision.needsHumanReview) {
    items.push("Parent registration filing context supplied by integration");
  }

  return items;
}

function buildFixtureExpected(parserOutput: EffectParserOutput, routeDecision: EffectRouterDecision): FixtureExpected {
  return {
    expected_delivery_level: deliveryLevelForScore(routeDecision.preliminaryScore),
    expected_impact: routeDecision.expectedImpact,
    market_context_needed: routeDecision.marketContextNeeded,
    market_context_reason: routeDecision.marketContextReason,
    market_context_fields: routeDecision.marketContextFields,
    special_ui_needed: false,
    special_ui_reason: null,
    integration_notes: buildIntegrationNotes(parserOutput, routeDecision),
  };
}

function buildIntegrationNotes(parserOutput: EffectParserOutput, routeDecision: EffectRouterDecision): string[] {
  const notes = [
    "Link EFFECT filing to the related registration filing during integration; do not resolve that link from this form room.",
    "Delivery level is derived from score using shared score bands.",
  ];

  if (routeDecision.requiresLlm) {
    notes.push("Router or analysis LLM would be needed for this case.");
  } else {
    notes.push("Fixture proves deterministic handling; no router or analysis LLM is needed.");
  }

  if (parserOutput.facts.originalAnalysisShouldBeShown) {
    notes.push("Show the original registration filing analysis when available.");
  }

  return notes;
}
