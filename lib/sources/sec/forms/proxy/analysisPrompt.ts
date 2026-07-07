import {
  APPROVED_PROXY_EVENT_TYPES,
  type ProxyEventType,
  type ProxyParserOutput,
} from "./parser.ts";
import { buildProxyDisplayPayload, type ProxyDisplayPayload } from "./displayPayload.ts";
import type { ProxyRouterDecision } from "./routerPrompt.ts";
import { buildProxySourceBlockPromptInput } from "./routerPrompt.ts";

export interface ProxyAnalysisPromptInput {
  parserOutput: ProxyParserOutput;
  routerDecision: ProxyRouterDecision;
  displayPayload?: ProxyDisplayPayload;
  marketContext?: Record<string, unknown> | null;
  variant?: ProxyAnalysisPromptVariant | string;
}

export type ProxyAnalysisPromptVariant = "default" | "proxy_routine_annual_test";

export const SEC_PROXY_ANALYSIS_PROMPT_KEY = "sec_proxy_analysis";
export const SEC_PROXY_ANALYSIS_PROMPT_VERSION = "proxy-analysis-v1";
export const SEC_PROXY_ROUTINE_ANNUAL_TEST_PROMPT_VERSION = "proxy-analysis-v1-routine-annual-test";

export function normalizeProxyAnalysisPromptVariant(value: unknown): ProxyAnalysisPromptVariant {
  return value === "proxy_routine_annual_test" ? "proxy_routine_annual_test" : "default";
}

export interface ProxyAnalysisOutput {
  source_group: "filings";
  market_scope: "company" | "sector" | "theme" | "macro";
  event_type: ProxyEventType;
  event_title: string;
  primary_ticker: {
    ticker: string | null;
    exchange: string | null;
  };
  tickers: Array<{
    ticker: string | null;
    exchange: string | null;
  }>;
  sector: string | null;
  industry_group: string | null;
  theme_group: string | null;
  sub_theme: string | null;
  score: number;
  score_reason: string;
  signal: "bullish" | "bearish" | "volatile" | "neutral";
  quick_take: string;
  summary: string;
  why_it_matters: string;
  bullish_points: string[];
  bearish_points: string[];
  key_evidence: string[];
  what_to_watch_next: string[];
  related_tickers: Array<{
    ticker: string | null;
    exchange: string | null;
  }>;
  calendar_items: ProxyParserOutput["calendarItems"];
  confidence: "high" | "medium" | "low";
  needs_human_review: boolean;
}

export interface ProxyRequiredOutput {
  parser_output: ProxyParserOutput;
  analysis_output: ProxyAnalysisOutput;
  display_payload: ProxyDisplayPayload;
  fixture_expected: {
    expected_delivery_level: "archive" | "feed" | "alert";
    expected_impact: "low" | "medium" | "high";
    market_context_needed: boolean;
    market_context_reason: string | null;
    market_context_fields: string[];
    special_ui_needed: boolean;
    special_ui_reason: string | null;
    integration_notes: string[];
  };
}

export function buildProxyAnalysisPrompt(input: ProxyAnalysisPromptInput): string {
  const displayPayload = input.displayPayload ?? buildProxyDisplayPayload(input.parserOutput, input.routerDecision.event_type);
  const variant = normalizeProxyAnalysisPromptVariant(input.variant);
  return [
    "You are writing investor-facing analysis for an SEC Proxy filing.",
    "",
    "Use cleaned_source_blocks as source-backed evidence. Do not call live market data, live FMP, live DB, alerts, ingest, or app/UI systems.",
    "Do not use parser-generated facts, signals, route hints, extraction summaries, event labels, display labels, or investment labels as analysis authority.",
    "Do not choose event_type, display_type, display_version, or UI template. Those are selected by the router step.",
    "Use router_decision.event_type exactly. Return display_payload with the same display_type/display_version contract; integration/UI can rebuild display data from parser output after analysis.",
    "If market context exists, use only the fixture JSON market_context provided below.",
    "Preserve parser warnings, especially when the filing is preliminary, notice-only, a supplement needing parent proxy context, or filed by a soliciting party other than the registrant.",
    "For ipo_listing, do not split event_type by IPO type. If the router/display contract later carries ipo_kind, keep it in display_payload metadata rather than changing event_type.",
    "Do not use ipo_listing for ordinary resale registration, shelf offering, ATM/offering dilution, already-listed issuer resale, post-closing business update, or SPAC redemption/liquidation/de-SPAC unless the selected router event_type is ipo_listing.",
    "For display_type spac_transaction_status, explain SPAC/de-SPAC transaction status facts from cleaned_source_blocks; do not use that display for a plain blank-check IPO registration.",
    "When cleaned_source_blocks show a third-party solicitation, clearly attribute recommendations to the soliciting party and do not describe them as board recommendations unless the source says so.",
    "If cleaned_source_blocks show an authorized-share increase, share-authorization proposal, or articles/certificate amendment to increase authorized shares, use event_type dilution_risk rather than generic shareholder_vote.",
    "For authorized-share increases, explain future issuance capacity without claiming a priced offering unless the source text states one.",
    "Do not downgrade a router_decision.event_type of dilution_risk to shareholder_vote just because the source is proxy soliciting material.",
    "",
    "Allowed event_type values:",
    ...APPROVED_PROXY_EVENT_TYPES.map((eventType) => `- ${eventType}`),
    "",
    "Score bands are fixed:",
    "- score below 50: archive",
    "- score 50 to 74: feed",
    "- score 75 or above: alert",
    ...proxyVariantInstructions(variant),
    "",
    "Return JSON only in this exact top-level shape:",
    JSON.stringify(requiredOutputSkeleton(), null, 2),
    "",
    "display_payload return contract. Return this display_type/display_version; do not invent UI fields or display types.",
    "",
    "router_decision:",
    JSON.stringify(input.routerDecision, null, 2),
    "",
    "display_payload_return_contract:",
    JSON.stringify(displayPayloadReturnContract(displayPayload), null, 2),
    "",
    "cleaned_source_blocks:",
    JSON.stringify(buildProxySourceBlockPromptInput(input.parserOutput, input.marketContext ?? null), null, 2),
    "",
    "market_context_fixture:",
    JSON.stringify(input.marketContext ?? null, null, 2),
  ].join("\n");
}

function proxyVariantInstructions(variant: ProxyAnalysisPromptVariant): string[] {
  if (variant !== "proxy_routine_annual_test") return [];
  return [
    "",
    "TEST VARIANT: routine annual proxy wording.",
    "Use this guidance only for routine annual meeting proxies with ordinary director election, say-on-pay, auditor ratification, or routine meeting proposals.",
    "Do not make routine annual proxy items sound like a market catalyst unless the source text includes a distinct non-routine proposal or adverse fact.",
    "For ordinary annual meeting proxies, score normally belongs below 50 unless a non-routine proposal, failed vote risk, activist contest, merger, dilution, listing, or legal-risk fact is source-backed.",
    "quick_take must be an investor message, not a filing restatement. One short sentence.",
    "summary must be one or two concise sentences. Include meeting date, record date, and proposal count only when source-backed.",
    "key_evidence should have at most three compact items: meeting date, record date, and main proposal groups.",
    "what_to_watch_next should have at most two compact items. Prefer final vote results and any non-routine proposal outcome.",
  ];
}

export function buildDeterministicProxyAnalysis(
  parserOutput: ProxyParserOutput,
): ProxyAnalysisOutput | null {
  const deterministic = parserOutput.facts.deterministic;
  if (!deterministic.canFinishWithoutLlm || deterministic.eventType !== "shareholder_vote") {
    return null;
  }

  const company = parserOutput.facts.companyName ?? "The company";

  return {
    source_group: "filings",
    market_scope: "company",
    event_type: "shareholder_vote",
    event_title: "Routine annual shareholder vote",
    primary_ticker: parserOutput.facts.primaryTicker,
    tickers: [parserOutput.facts.primaryTicker],
    sector: null,
    industry_group: null,
    theme_group: null,
    sub_theme: null,
    score: deterministic.suggestedScore ?? 25,
    score_reason:
      "Routine annual governance vote with no extracted merger, dilution, ownership-control, legal, or financial-risk signal.",
    signal: "neutral",
    quick_take: "Routine annual proxy items; no new material market catalyst was extracted.",
    summary: `${company} filed a routine annual proxy covering director elections, auditor ratification, and advisory compensation approval.`,
    why_it_matters:
      "The filing sets the voting agenda and meeting calendar, but the extracted proposals are ordinary annual-meeting matters.",
    bullish_points: [],
    bearish_points: [],
    key_evidence: parserOutput.facts.proposals.map((proposal) => proposal.sourceText),
    what_to_watch_next: ["Final voting results after the annual meeting."],
    related_tickers: [],
    calendar_items: parserOutput.calendarItems,
    confidence: "high",
    needs_human_review: false,
  };
}

function displayPayloadReturnContract(displayPayload: ProxyDisplayPayload): ProxyDisplayPayload {
  return {
    display_type: displayPayload.display_type,
    display_version: displayPayload.display_version,
    data: {},
    evidence: [],
    notes: [],
  };
}

export function deriveDeliveryLevel(score: number): "archive" | "feed" | "alert" {
  if (score < 50) {
    return "archive";
  }
  if (score < 75) {
    return "feed";
  }
  return "alert";
}

export function assertRequiredProxyOutputShape(output: ProxyRequiredOutput): void {
  if (output.parser_output.parserGroup !== "proxy") {
    throw new Error("parser_output.parserGroup must be proxy.");
  }
  if (output.parser_output.formType !== "Proxy") {
    throw new Error("parser_output.formType must be Proxy.");
  }
  if (!APPROVED_PROXY_EVENT_TYPES.includes(output.analysis_output.event_type)) {
    throw new Error(`Unapproved event_type: ${output.analysis_output.event_type}`);
  }
  if (deriveDeliveryLevel(output.analysis_output.score) !== output.fixture_expected.expected_delivery_level) {
    throw new Error("fixture_expected.expected_delivery_level does not match score band.");
  }
  if (!["generic", "offering_terms", "candidate_special", "spac_transaction_status"].includes(output.display_payload.display_type)) {
    throw new Error(`Unsupported display_type: ${output.display_payload.display_type}`);
  }
  if ("display_version" in output.display_payload && typeof output.display_payload.display_version !== "string") {
    throw new Error("display_payload.display_version must be a string when present.");
  }
}

function requiredOutputSkeleton(): ProxyRequiredOutput {
  return {
    parser_output: {
      parserVersion: "string",
      parserGroup: "proxy",
      formType: "Proxy",
      accessionNumber: "string | null",
      isSupported: true,
      summary: "string | null",
      facts: {} as ProxyParserOutput["facts"],
      signals: [],
      calendarItems: [],
      warnings: [],
      raw: {} as ProxyParserOutput["raw"],
    },
    analysis_output: {
      source_group: "filings",
      market_scope: "company",
      event_type: "other",
      event_title: "string",
      primary_ticker: { ticker: "string | null", exchange: "string | null" },
      tickers: [],
      sector: "string | null",
      industry_group: "string | null",
      theme_group: "string | null",
      sub_theme: "string | null",
      score: 0,
      score_reason: "string",
      signal: "neutral",
      quick_take: "string",
      summary: "string",
      why_it_matters: "string",
      bullish_points: [],
      bearish_points: [],
      key_evidence: [],
      what_to_watch_next: [],
      related_tickers: [],
      calendar_items: [],
      confidence: "medium",
      needs_human_review: false,
    },
    display_payload: {
      display_type: "generic",
      display_version: "proxy_generic_v1",
      data: {},
      evidence: [],
      notes: [],
    },
    fixture_expected: {
      expected_delivery_level: "archive",
      expected_impact: "low",
      market_context_needed: false,
      market_context_reason: "string | null",
      market_context_fields: [],
      special_ui_needed: false,
      special_ui_reason: "string | null",
      integration_notes: [],
    },
  };
}
