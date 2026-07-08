import {
  APPROVED_PROXY_EVENT_TYPES,
  type ProxyEventType,
  type ProxyParserOutput,
} from "./parser.ts";
import type { ProxyDisplayPayload } from "./displayPayload.ts";
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
export const SEC_PROXY_ANALYSIS_PROMPT_VERSION = "proxy-analysis-v2-llm-display-routing";
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
  score_explanation?: {
    summary: string;
  } | null;
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
  const variant = normalizeProxyAnalysisPromptVariant(input.variant);
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
    ...proxyRuntimeHintSections(variant, input.routerDecision),
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
    "Choose event_type, display_payload.display_type, and display_payload.display_version yourself from the source blocks.",
    "Treat router_decision as a non-binding parser hint only. It may be a placeholder and must not control the final UI.",
    "If market context exists, use only the fixture JSON market_context provided below.",
    "Preserve parser warnings when the filing is preliminary, notice-only, supplemental, image-heavy, or filed by a third-party solicitor.",
  ];
}

function proxyDisplayInstructions(): string[] {
  return [
    "Choose exactly one proxy display version and fill only the data fields relevant to that UI.",
    "display_payload.data must contain the visible UI fields for the selected display_version; never return an empty data object.",
    "Required display_payload.data keys by display_version. Required means the key must be present in display_payload.data, not only mentioned in summary, key_evidence, or notes:",
    "- proxy_generic_v1 requires meeting_date, record_date, proposal_count, board_recommendation, proposals.",
    "- proxy_ipo_listing_v1 requires ipo_kind, listing_action, exchange_ticker, meeting_date, record_date, proposals.",
    "- proxy_equity_plan_vote_v1 requires plan_name, shares_requested, percent_of_outstanding, vote_requirement, proposals.",
    "- proxy_transaction_vote_v1 requires transaction_summary, consideration, vote_required, meeting_date, record_date, board_recommendation, closing_conditions, proposals.",
    "- proxy_capital_structure_vote_v1 requires reverse_split, capital_structure_proposals, listing_context, board_recommendation, meeting_date, vote_date, record_date, proposals.",
    "- proxy_governance_vote_v1 requires governance_focus, contested, shareholder_or_governance_proposals, board_recommendation, meeting_date, record_date, proposals.",
    "- proxy_spac_transaction_status_v1 requires current_stage_label, deal_status, target_company, target_company_story, expected_ticker, vote_date, min_cash_condition, min_cash_status, redemption_rate, risk_flags, watch_next.",
    "Before final JSON, compare display_payload.display_version to the required-key list above and add any missing key to display_payload.data. Use Not disclosed or an empty array only when the filing does not state the fact.",
    "Every proxy UI should include display_payload.data.proposals when the filing has proposal text. This is the visible agenda table. Do not omit proposals just because a specialized field exists.",
    "When proposals are required, each item in display_payload.data.proposals must be a visible proposal row with id/proposal number, title, category/type, recommendation, and is_shareholder_proposal when clear. Do not return empty proposal objects like {}.",
    "For proposal category/type, use investor-readable labels such as Director election, Executive pay vote, Auditor approval, Equity plan, Merger vote, Reverse split, Authorized shares, Adjournment, Shareholder proposal, or Other.",
    "For proposal recommendation, use the board recommendation shown by the filing, usually For, Against, Withhold, Mixed, or Not disclosed.",
    "Snapshot fields are compact UI tiles. Keep snapshot-style field values under 40 characters. When a fact needs explanation, put the short value in the field and the explanation in a note field capped at 80 characters.",
    "For proposal_modules, keep label under 24 characters, title under 48 characters, value under 40 characters, and note under 80 characters.",
    "For merger/transaction, capital structure, equity plan, listing/share-issuance, contested, shareholder, or governance proposals, include proposal_modules for the material proposal details. Each proposal_modules[].proposal_id must exactly match the related display_payload.data.proposals[].id so the UI can render the detail under the correct agenda row.",
    "If several proxy themes appear, choose the investor-material main UI in this order: SPAC/de-SPAC transaction status, merger/transaction vote, capital structure vote, equity plan vote, contested/governance proxy, IPO/listing proxy vote, routine annual meeting.",
    "- Routine annual meeting: display_type generic, display_version proxy_generic_v1. Use this for ordinary director election, say-on-pay, say-on-frequency, auditor ratification, and routine annual meeting business. Fill meeting_date, record_date, proposal_count, board_recommendation, and proposals. Use Not disclosed only when the filing does not state the fact.",
    "- IPO or listing-related proxy vote: display_type generic, display_version proxy_ipo_listing_v1. Use ipo_kind, listing_action, exchange_ticker, vote_requirement, meeting_date, record_date, proposals.",
    "- Equity plan vote: display_type offering_terms, display_version proxy_equity_plan_vote_v1. Use plan_name, shares_requested, percent_of_outstanding, vote_requirement, proposals, snapshot_metrics, offering_details.",
    "- Merger or transaction vote: display_type candidate_special, display_version proxy_transaction_vote_v1. Use transaction_summary, consideration, vote_required, meeting_date, record_date, board_recommendation, closing_conditions, appraisal_rights_mentioned, delisting_mentioned, proposals.",
    "  For proxy_transaction_vote_v1, keep transaction_summary, consideration, and vote_required as compact snapshot values under 40 characters. Examples: Berry / CRC merger, CRC common stock, $12.50 per share, Majority outstanding. Put longer explanation in proposals or proposal_modules note, capped at 80 characters.",
    "- Reverse split, authorized shares, or listing-compliance capital vote: display_type candidate_special, display_version proxy_capital_structure_vote_v1. Use reverse_split, capital_structure_proposals, listing_context, board_recommendation, meeting_date, vote_date, record_date, proposals.",
    "  For proxy_capital_structure_vote_v1, capital_structure_proposals must be a non-empty array when the filing has a reverse split, authorized-share, charter amendment, listing-compliance, or adjournment proposal tied to capital structure. If the filing has one reverse split proposal, put that same proposal in both proposals and capital_structure_proposals.",
    "  For proxy_capital_structure_vote_v1, reverse_split must be an object with ratio, ratio_range, implementation_timing, purpose, status, and note when those facts are source-stated.",
    "  For reverse split ratio, use the stated exact ratio if final; otherwise use the stated approved range such as 1-for-5 to 1-for-10 in ratio_range. Do not write Not disclosed when the filing states a ratio range.",
    "  For implementation_timing, use a compact tile value under 40 characters, such as 5:30 p.m. ET, Upon certificate filing, After approval, or No fixed date. Put explanation in reverse_split.note under 80 characters. Do not put a full legal sentence in implementation_timing.",
    "  Use listing_context: Nasdaq/NYSE compliance, minimum bid, financing capacity, or Not disclosed, based only on source text.",
    "- Special governance, contested, supplement, dissident, shareholder proposal, or board-control proxy: display_type candidate_special, display_version proxy_governance_vote_v1. Do not use this for ordinary director elections, say-on-pay, auditor ratification, or routine annual meeting governance. Use governance_focus, contested, supplement, shareholder_or_governance_proposals, board_recommendation, meeting_date, record_date, proposals.",
    "- SPAC or de-SPAC vote/status: display_type spac_transaction_status, display_version proxy_spac_transaction_status_v1. Use current_stage_label, deal_status, target_company, target_company_story, expected_ticker, vote_date, redemption_deadline, min_cash_condition, min_cash_status, redemption_rate, closing_date, ticker_change_date, risk_flags, watch_next.",
    "Do not put UI-specific facts only in summary. If a fact matters to the selected UI, put it in display_payload.data.",
    "display_payload.evidence and display_payload.notes are optional support only. They do not replace display_payload.data and may be empty when visible data is complete.",
    "The UI generates a one-line proxy card intro from display_version and proposal categories. Do not rely on analysis_output.summary to introduce the card. Put concrete proposal facts in display_payload.data.proposals and proposal_modules.",
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
    "- score_explanation is required for the visible score rationale card. Do not omit it and do not return null.",
    "- Only write score_explanation.summary. Do not add base_band, upward_factors, limiting_factors, final_read, or other nested score fields for proxy filings.",
    "- score_explanation.summary is the visible sentence. Write one concise analyst-style conclusion, 12-24 words, explaining why the score is reasonable.",
    "- score_explanation.summary must explain the strongest 1-2 score drivers and one material offset only when it changes the score.",
    "- Do not format score_explanation.summary as bullets, labels, sections, or an internal scoring review.",
    "- Do not start score_explanation.summary with the issuer name, ticker, form type, filed, scheduled, announced, or registered.",
    "- Do not repeat quick_take or summary. Write the score rationale, not another filing summary.",
    "Avoid duplicate wording between quick_take, summary, key_evidence, and what_to_watch_next.",
  ];
}

function proxyScoringInstructions(): string[] {
  return [
    "Score bands are fixed:",
    "- score below 50: archive",
    "- score 50 to 74: feed",
    "- score 75 or above: alert",
    "Proxy scoring guide:",
    "- Core rule: score only what this proxy filing asks shareholders to vote on or materially updates. Do not score up merely because the form is DEF 14A, PRE 14A, DEFM14A, or DEFA14A.",
    "- Routine annual meeting: director elections, say-on-pay, say-on-frequency, and auditor ratification only should be 25-49. Use 50+ only with a source-backed contested item, shareholder proposal, weak governance issue, compensation issue, transaction, listing, legal, or control-change driver.",
    "- Equity plan vote: score by requested shares or dilution scale when stated. Under 5% of outstanding usually 35-49; 5-10% usually 50-59; 10-20% usually 60-69; over 20% usually 70-79. Use 75+ only when large reserve plus microcap, listing, financing, or dilution pressure is source-backed.",
    "- Reverse split or listing capital vote: routine reverse split usually 52-68. Use 70-82 when tied to Nasdaq/NYSE minimum bid, delisting deadline, or listing compliance. Use 75+ only when active delisting or compliance loss is central. Authorized-share increase is 45-64 routine, 65-79 when it creates large future issuance capacity or is tied to financing/dilution pressure.",
    "- Merger, acquisition, sale, or business-combination vote: usually 58-74. Use 75-88 when vote failure risk, appraisal risk, closing-condition risk, minimum-cash risk, regulatory issue, deal break risk, delisting, ticker transition, or changed holder economics is source-backed.",
    "- SPAC or de-SPAC vote/status: proxy filed or vote pending usually 55-74. Use 75-88 for high redemptions, minimum cash risk, waiver/backstop need, redemption deadline, closing uncertainty, or imminent closing/ticker change. Score from closing/redemption/cash risk, not from the SPAC label alone.",
    "- Contested proxy or governance fight: routine shareholder proposal usually 35-59. Dissident slate, third-party solicitation, recommendation change, or board-control fight usually 65-84; use 75+ when board control or strategic direction could change.",
    "- IPO or listing proxy: ordinary listing approval usually 45-64. Use 65-79 when the vote gates listing, reverse split/listing compliance, financing timing, or ticker transition.",
    "- Legal, regulatory, investigation, sanctions, antitrust, or compliance shareholder proposal: score by severity and direct company exposure.",
    "- Preliminary proxy: do not cap solely because it is preliminary if the proposal terms are material, but mention that final proxy or vote result is pending.",
    "- Alert gate: 75+ requires a source-backed near-term investor decision driver: listing compliance or delisting risk, major dilution authorization, merger/de-SPAC closing condition, board-control contest, failed vote/deal break risk, legal/regulatory block, or imminent listing/ticker change.",
    "- Do not copy the skeleton score value. For a routine annual proxy with analyzable meeting/proposal facts, choose a real score in the 25-49 range.",
    "- Do not mark a proxy as alert just because it is a shareholder vote.",
    "- Avoid 90+ unless the source shows an extreme outcome: deal break, failed vote, immediate delisting risk, financing failure, regulatory block, or actual control change.",
    "- score_explanation.summary must match the chosen score band and visible UI. It should not introduce a new fact that is absent from display_payload.data, key_evidence, or the source blocks.",
  ];
}

function proxyRuntimeHintSections(
  variant: ProxyAnalysisPromptVariant,
  routerDecision: ProxyRouterDecision,
): string[] {
  return [
    "",
    variant === "proxy_sectioned_test"
      ? "router_decision_hint_non_binding:"
      : "parser_route_hint_non_binding:",
    JSON.stringify(routerDecision, null, 2),
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

export function buildProxyLlmRouterPlaceholder(): ProxyRouterDecision {
  return {
    stage: "router",
    usesLlm: true,
    analysis_needed: true,
    event_type: "other",
    display_type: "generic",
    display_version: "proxy_generic_v1",
    preliminary_action: "analyze",
    preliminary_score: 50,
    rationale: "Placeholder only. The analysis prompt must choose proxy event and UI from cleaned source blocks.",
    analysis_focus: ["Classify proxy event", "Choose display UI", "Fill selected visible UI fields"],
  };
}

export function buildProxyLlmDisplayPayloadPlaceholder(): ProxyDisplayPayload {
  return {
    display_type: "generic",
    display_version: "proxy_generic_v1",
    data: {},
    evidence: [],
    notes: ["Placeholder only. LLM must select and fill the final proxy display payload."],
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
      score_explanation: {
        summary: "one short investor-facing sentence explaining the score",
      },
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
      data: {
        meeting_date: "string | Not disclosed",
        record_date: "string | Not disclosed",
        proposal_count: "number | Not disclosed",
        board_recommendation: "string | Not disclosed",
        proposals: [
          {
            id: "string",
            title: "string",
            category: "string",
            recommendation: "For | Against | Mixed | Not disclosed",
            is_shareholder_proposal: false,
          },
        ],
      },
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
