import {
  NT_APPROVED_EVENT_TYPES,
  deriveNtDeliveryLevel,
  isNtApprovedEventType,
  type NtParserOutput,
  type NtDisplayPayload,
  type NtRequiredOutputJson,
  type NtRouterDecision,
} from "./types";
import { buildSecSourceBlockPromptInput } from "../common/sourceBlockPromptInput";

const REQUIRED_OUTPUT_SHAPE = {
  parser_output: {
    parserVersion: "string",
    parserGroup: "nt",
    formType: "NT 10-K | NT 10-Q | NT 20-F",
    accessionNumber: "string | null",
    isSupported: true,
    summary: "string | null",
    facts: {},
    signals: [],
    calendarItems: [],
    warnings: [],
    raw: {},
  },
  analysis_output: {
    source_group: "filings",
    market_scope: "company | sector | theme | macro",
    event_type: "one of the approved 16 event types",
    event_title: "string",
    primary_ticker: { ticker: "string | null", exchange: "string | null" },
    tickers: [],
    sector: "string | null",
    industry_group: "string | null",
    theme_group: "string | null",
    sub_theme: "string | null",
    score: 0,
    score_reason: "string",
    signal: "bullish | bearish | volatile | neutral",
    quick_take: "string",
    summary: "string",
    why_it_matters: "string",
    bullish_points: [],
    bearish_points: [],
    key_evidence: [],
    what_to_watch_next: [],
    related_tickers: [],
    calendar_items: [],
    confidence: "high | medium | low",
    needs_human_review: false,
  },
  display_payload: {
    display_type: "generic | offering_terms | candidate_special",
    display_version: "string",
    data: {},
    evidence: [],
    notes: [],
  },
  fixture_expected: {
    expected_delivery_level: "archive | feed | alert",
    expected_impact: "low | medium | high",
    market_context_needed: false,
    market_context_reason: "string | null",
    market_context_fields: [],
    special_ui_needed: false,
    special_ui_reason: "string | null",
    integration_notes: [],
  },
};

export function buildNtAnalysisPrompt(args: {
  parserOutput: NtParserOutput;
  routerDecision: NtRouterDecision;
  displayPayload: NtDisplayPayload;
  marketContext?: Record<string, unknown> | null;
}): string {
  const { parserOutput, routerDecision, displayPayload, marketContext = null } = args;

  return [
    "You are writing investor-facing analysis for an SEC NT 10-K, NT 10-Q, or NT 20-F late-filing notice.",
    "Use only parser_output, router_decision, display_payload, and optional fixture market_context supplied below.",
    "Do not call live APIs, FMP, SEC, databases, app/UI code, alert delivery, or external market data.",
    `Allowed event_type values are exactly: ${NT_APPROVED_EVENT_TYPES.join(", ")}.`,
    "Use router_decision.event_type exactly. Do not invent event types and do not change the selected event_type.",
    "Use router_decision.display_type and router_decision.display_version exactly. Do not choose UI templates, create display types, or alter display_payload structure.",
    "Score bands are fixed: below 50 archive, 50 to 74 feed, 75 or above alert. Do not emit delivery_level as a separate model decision.",
    "For routine NT filings with no significant results change and expected filing inside the extension window, keep score below 50 unless another source-backed risk is present.",
    "Do not use parser-generated facts, signals, route hints, extraction summaries, event labels, display labels, or investment labels as analysis authority.",
    "Treat amendments and follow-up NT filings as updates unless cleaned_source_blocks show a new or materially changed source-backed issue.",
    "For transition reports, preserve transition report type and transition period only if cleaned_source_blocks include them; if missing, note uncertainty rather than inferring it.",
    "Use accountant statements and Rule 12b-25(c) source text as evidence only; do not claim an exhibit was reviewed unless cleaned_source_blocks include the statement text.",
    "For accounting, audit, restatement, material weakness, going-concern, or unresolved financial-statement issues, usually use financial_risk and explain why the late filing may matter.",
    "For sales, revenue, customer-order, or margin changes, use sales_performance. For broader net-income/EPS/loss changes, use earnings.",
    "Write investor-facing copy only: title, quick take, summary, score reason, why it matters, evidence, and watch-next text.",
    "Return only valid JSON in this exact required output shape:",
    JSON.stringify(REQUIRED_OUTPUT_SHAPE, null, 2),
    "cleaned_source_blocks:",
    JSON.stringify(
      buildSecSourceBlockPromptInput({
        parserOutput: parserOutput as unknown as Record<string, unknown>,
        marketContext: marketContext as unknown as Record<string, unknown> | null | undefined,
      }),
      null,
      2,
    ),
    "router_decision:",
    JSON.stringify(routerDecision, null, 2),
    "display_payload:",
    JSON.stringify(displayPayload, null, 2),
    "market_context:",
    JSON.stringify(marketContext, null, 2),
  ].join("\n");
}

export function validateNtRequiredOutputJson(
  value: NtRequiredOutputJson,
): string[] {
  const errors: string[] = [];

  if (value.parser_output.parserGroup !== "nt") {
    errors.push("parser_output.parserGroup must be nt.");
  }

  if (!isNtApprovedEventType(value.analysis_output.event_type)) {
    errors.push("analysis_output.event_type must be one of the approved 16 event types.");
  }

  const derivedDelivery = deriveNtDeliveryLevel(value.analysis_output.score);
  if (value.fixture_expected.expected_delivery_level !== derivedDelivery) {
    errors.push(
      `fixture_expected.expected_delivery_level must match score band ${derivedDelivery}.`,
    );
  }

  if (
    !["generic", "offering_terms", "candidate_special"].includes(
      value.display_payload.display_type,
    )
  ) {
    errors.push("display_payload.display_type must be generic, offering_terms, or candidate_special.");
  }

  if (!value.display_payload.display_version) {
    errors.push("display_payload.display_version is required.");
  }

  if (value.display_payload.display_type === "candidate_special") {
    if (!value.fixture_expected.special_ui_needed) {
      errors.push("candidate_special display requires fixture_expected.special_ui_needed true.");
    }
    if (!value.fixture_expected.special_ui_reason) {
      errors.push("candidate_special display requires fixture_expected.special_ui_reason.");
    }
  }

  return errors;
}
