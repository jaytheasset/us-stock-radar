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

export type ProxyAnalysisPromptVariant = "default" | "proxy_sectioned_test";

export const SEC_PROXY_ANALYSIS_PROMPT_KEY = "sec_proxy_analysis";
export const SEC_PROXY_ANALYSIS_PROMPT_VERSION = "proxy-analysis-v1";
export const SEC_PROXY_SECTIONED_TEST_PROMPT_VERSION = "proxy-analysis-v2-sectioned-test";

export function normalizeProxyAnalysisPromptVariant(value: unknown): ProxyAnalysisPromptVariant {
  return value === "proxy_sectioned_test" ? "proxy_sectioned_test" : "default";
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
  if (variant === "default") {
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

  return [
    ...proxyOpeningInstructions(),
    "",
    "Allowed event_type values:",
    ...APPROVED_PROXY_EVENT_TYPES.map((eventType) => `- ${eventType}`),
    "",
    ...proxyDisplayInstructions(),
    "",
    ...proxyWritingInstructions(),
    "",
    ...proxyScoringInstructions(),
    "",
    "Return JSON only in this exact top-level shape:",
    JSON.stringify(requiredOutputSkeleton(), null, 2),
    ...proxyRuntimeHintSections(variant, input.routerDecision, displayPayload),
    "",
    "cleaned_source_blocks:",
    JSON.stringify(buildProxySourceBlockPromptInput(input.parserOutput, input.marketContext ?? null), null, 2),
    "",
    "market_context_fixture:",
    JSON.stringify(input.marketContext ?? null, null, 2),
  ].join("\n");
}

function proxyOpeningInstructions(): string[] {
  return [
    "You are writing investor-facing analysis for an SEC Proxy filing.",
    "",
    "Use cleaned_source_blocks as source-backed evidence. Do not call live market data, live FMP, live DB, alerts, ingest, or app/UI systems.",
    "Use the filing text as source of truth. If a fact is not stated, write Not disclosed or use an empty array.",
    "Do not copy parser labels or SEC boilerplate as prose. Rewrite source-backed facts in clear investor language.",
    "For this test variant, choose event_type, display_payload.display_type, and display_payload.display_version yourself from the source blocks.",
    "Treat router_decision as a non-binding parser hint only. It may be a placeholder.",
    "If market context exists, use only the fixture JSON market_context provided below.",
    "Preserve parser warnings when the filing is preliminary, notice-only, supplemental, image-heavy, or filed by a third-party solicitor.",
  ];
}

function proxyDisplayInstructions(): string[] {
  return [
    "Choose exactly one proxy display version and fill only the data fields relevant to that UI.",
    "- Routine annual meeting: display_type generic, display_version proxy_generic_v1. Use meeting_date, record_date, proposal_count, proposals, board_recommendation when stated.",
    "- IPO or listing-related proxy vote: display_type generic, display_version proxy_ipo_listing_v1. Use ipo_kind, listing_action, exchange_ticker, vote_requirement, meeting_date, record_date, proposals.",
    "- Equity plan vote: display_type offering_terms, display_version proxy_equity_plan_vote_v1. Use plan_name, shares_requested, percent_of_outstanding, vote_requirement, proposals, snapshot_metrics, offering_details.",
    "- Merger or transaction vote: display_type candidate_special, display_version proxy_transaction_vote_v1. Use transaction_summary, consideration, vote_required, meeting_date, record_date, board_recommendation, closing_conditions, appraisal_rights_mentioned, delisting_mentioned, proposals.",
    "- Reverse split, authorized shares, or listing-compliance capital vote: display_type candidate_special, display_version proxy_capital_structure_vote_v1. Use reverse_split, capital_structure_proposals, listing_context, board_recommendation, meeting_date, record_date, proposals.",
    "- Governance, contested, supplement, dissident, or board-control proxy: display_type candidate_special, display_version proxy_governance_vote_v1. Use governance_focus, contested, supplement, shareholder_or_governance_proposals, board_recommendation, meeting_date, record_date, proposals.",
    "- SPAC or de-SPAC vote/status: display_type spac_transaction_status, display_version proxy_spac_transaction_status_v1. Use current_stage_label, deal_status, target_company, target_company_story, expected_ticker, vote_date, redemption_deadline, min_cash_condition, min_cash_status, redemption_rate, closing_date, ticker_change_date, risk_flags, watch_next.",
    "Do not put UI-specific facts only in summary. If a fact matters to the selected UI, put it in display_payload.data.",
  ];
}

function proxyWritingInstructions(): string[] {
  return [
    "Common investor output:",
    "- event_title: investor-facing headline under 90 characters.",
    "- quick_take: one sentence under 22 words. Make it an investor message, not a filing restatement.",
    "- summary: one or two concise sentences. Do not repeat quick_take.",
    "- why_it_matters: one sentence under 35 words, or a concise reason the vote can matter.",
    "- key_evidence: at most three compact source-backed items.",
    "- what_to_watch_next: at most three concrete follow-up items.",
    "- score_reason: under 18 words.",
    "- score_explanation is not in this schema; keep score_reason and summary clear enough for the score card.",
    "Avoid duplicate wording between quick_take, summary, key_evidence, and what_to_watch_next.",
  ];
}

function proxyScoringInstructions(): string[] {
  return [
    "Score bands are fixed:",
    "- score below 50: archive",
    "- score 50 to 74: feed",
    "- score 75 or above: alert",
    "Proxy scoring guidance:",
    "- Routine annual meeting with directors, say-on-pay, and auditor ratification only: usually 25-49.",
    "- Simple vote schedule disclosure without unusual proposal: usually cap at 72.",
    "- Equity plan share reserve increase: usually 50-68, higher only if clearly large vs outstanding or tied to dilution pressure.",
    "- Reverse split or authorized-share vote: usually 52-68; 75-82 if tied to Nasdaq/NYSE compliance, financing, or clear dilution capacity.",
    "- Merger, acquisition, sale, or business-combination vote: usually 58-74; higher if vote failure, delay, redemption, minimum-cash, or closing risk is source-backed.",
    "- SPAC/de-SPAC vote/status: usually 55-74; 75-88 for high redemptions, minimum cash risk, waiver/backstop need, or imminent closing/ticker change.",
    "- Contested proxy, dissident slate, or board-control fight: usually 65-84 depending on board-control stakes and recommendation changes.",
    "- Legal, regulatory, investigation, sanctions, antitrust, or compliance shareholder proposal: score by severity and source-backed company exposure.",
    "- Do not mark a proxy as alert just because it is a shareholder vote.",
    "- Avoid 90+ unless the source shows an extreme outcome: deal break, failed vote, immediate delisting risk, financing failure, or actual control change.",
  ];
}

function proxyRuntimeHintSections(
  variant: ProxyAnalysisPromptVariant,
  routerDecision: ProxyRouterDecision,
  displayPayload: ProxyDisplayPayload,
): string[] {
  if (variant === "proxy_sectioned_test") {
    return [
      "",
      "router_decision_hint_non_binding:",
      JSON.stringify(routerDecision, null, 2),
    ];
  }
  return [
    "",
    "router_decision:",
    JSON.stringify(routerDecision, null, 2),
    "",
    "display_payload_return_contract:",
    JSON.stringify(displayPayloadReturnContract(displayPayload), null, 2),
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
