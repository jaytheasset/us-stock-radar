import {
  NT_APPROVED_EVENT_TYPES,
  type NtApprovedEventType,
  type NtParserOutput,
  type NtRouterDecision,
} from "./types";
import { buildSecSourceBlockPromptInput } from "../common/sourceBlockPromptInput";

const ROUTER_OUTPUT_SCHEMA = {
  event_type: "one of the approved 16 event types",
  display_type: "generic | offering_terms | candidate_special",
  display_version: "string",
  preliminary_action: "archive | feed | alert_candidate",
  analysis_needed: "boolean",
  deterministic: "boolean",
  score_band: "below_50 | 50_to_74 | 75_or_above",
  reason: "short source-backed reason",
  evidence: ["short source-backed excerpts from cleaned_source_blocks"],
};

export function buildNtRouterPrompt(parserOutput: NtParserOutput): string {
  const routerInput = buildSecSourceBlockPromptInput({ parserOutput: parserOutput as unknown as Record<string, unknown> });
  return [
    "You are routing SEC NT 10-K, NT 10-Q, and NT 20-F late-filing notices.",
    "Use only cleaned_source_blocks supplied below.",
    "Use current_filing.form_type exactly when naming the SEC form. Do not substitute another NT form from the same family.",
    "Do not use parser-generated facts, signals, route hints, extraction summaries, event labels, display labels, or investment labels as classification authority.",
    "Do not call live APIs, databases, market-data services, or external filings.",
    "Do not request or rely on full raw filing text.",
    `Allowed event_type values are exactly: ${NT_APPROVED_EVENT_TYPES.join(", ")}.`,
    "Choose exactly one approved event_type.",
    "Do not invent event types.",
    "Choose display_type and display_version for the detail UI from cleaned_source_blocks.",
    "Do not invent display types. Use display_type generic and display_version nt_late_filing_v1 unless cleaned_source_blocks prove another approved display type is needed.",
    "Do not change score bands: below 50 archive, 50 to 74 feed, 75 or above alert.",
    "This router only proposes an analysis route. Every supported NT filing must continue to the analysis LLM.",
    "Always return analysis_needed true and deterministic false.",
    "Routing guidance:",
    "- Use router/classifier judgment from cleaned_source_blocks; parser metadata is not a final classification.",
    "- Routine late-filing notice, expected filing inside Rule 12b-25 extension, and no significant results change: event_type other and preliminary_action archive, but analysis_needed remains true.",
    "- Amendments and follow-up NT filings are updates, not automatically new events. Use amendment purpose and amended sections from cleaned_source_blocks.",
    "- Transition reports should preserve the checked transition report type and transition period facts; do not infer a missing transition period.",
    "- Accountant statements or Rule 12b-25(c) exhibits are evidence. They do not decide event_type by themselves.",
    "- Accounting, audit, internal-control, valuation, restatement, going-concern, or inability-to-complete-financials issue: financial_risk.",
    "- Significant sales, revenue, customer-order, or gross-margin change: sales_performance.",
    "- Significant EPS, net-income, loss, or broad results change without sales-specific evidence: earnings.",
    "- Exchange compliance, Nasdaq/NYSE, minimum-bid, or delisting language: listing_risk.",
    "- Investigation, litigation, subpoena, enforcement, or regulatory-review language: legal_risk.",
    "- CEO/CFO, board, disclosure-control, or governance disruption: leadership_governance.",
    "- Merger, acquisition, divestiture, subsidiary consolidation, or transaction-accounting driver: strategic_transaction unless accounting risk is dominant.",
    "Return only valid JSON in this router schema:",
    JSON.stringify(ROUTER_OUTPUT_SCHEMA, null, 2),
    "router_input:",
    JSON.stringify(routerInput, null, 2),
  ].join("\n");
}

export function routeNtParserOutput(
  parserOutput: NtParserOutput,
): NtRouterDecision {
  const facts = parserOutput.facts;
  const flags = new Set(facts.sourceTextFlags);
  const evidence = buildRouterEvidence(parserOutput);

  if (flags.has("exchange_listing_terms")) {
    return decision("listing_risk", "alert_candidate", "75_or_above", true, false, evidence);
  }

  if (flags.has("legal_regulatory_terms")) {
    return decision("legal_risk", "feed", "50_to_74", true, false, evidence);
  }

  if (flags.has("leadership_governance_terms")) {
    return decision("leadership_governance", "feed", "50_to_74", true, false, evidence);
  }

  if (
    flags.has("accounting_audit_terms") ||
    flags.has("no_reliance_or_restatement_terms")
  ) {
    const scoreBand =
      facts.significantChangeExpected === true ||
      flags.has("no_reliance_or_restatement_terms") ||
      /internal control|material weakness|restatement|going concern/i.test(
        facts.lateFilingReason ?? "",
      )
        ? "75_or_above"
        : "50_to_74";
    return decision(
      "financial_risk",
      scoreBand === "75_or_above" ? "alert_candidate" : "feed",
      scoreBand,
      true,
      false,
      evidence,
    );
  }

  if (flags.has("sales_revenue_terms")) {
    return decision("sales_performance", "alert_candidate", "75_or_above", true, false, evidence);
  }

  if (facts.significantChangeExpected === true) {
    return decision("earnings", "alert_candidate", "75_or_above", true, false, evidence);
  }

  if (flags.has("strategic_transaction_terms")) {
    return decision("strategic_transaction", "feed", "50_to_74", true, false, evidence);
  }

  return {
    event_type: "other",
    display_type: "generic",
    display_version: "nt_late_filing_v1",
    preliminary_action: "archive",
    analysis_needed: true,
    deterministic: false,
    score_band: "below_50",
    reason:
      "The NT filing requires LLM analysis from source-backed late-filing context.",
    evidence,
  };
}

function decision(
  eventType: NtApprovedEventType,
  preliminaryAction: NtRouterDecision["preliminary_action"],
  scoreBand: NtRouterDecision["score_band"],
  analysisNeeded: boolean,
  deterministic: boolean,
  evidence: string[],
): NtRouterDecision {
  return {
    event_type: eventType,
    display_type: "generic",
    display_version: "nt_late_filing_v1",
    preliminary_action: preliminaryAction,
    analysis_needed: analysisNeeded,
    deterministic,
    score_band: scoreBand,
    reason: routeReason(eventType),
    evidence,
  };
}

function buildRouterEvidence(parserOutput: NtParserOutput): string[] {
  return parserOutput.facts.sourceExcerpts
    .map((excerpt) => excerpt.text)
    .filter(Boolean)
    .map((item) => item.slice(0, 360));
}

function routeReason(eventType: NtApprovedEventType): string {
  switch (eventType) {
    case "listing_risk":
      return "The NT filing contains exchange-listing or delisting-risk language.";
    case "legal_risk":
      return "The NT filing contains litigation, investigation, enforcement, or regulatory-risk language.";
    case "leadership_governance":
      return "The NT filing contains leadership, board, governance, or disclosure-control disruption language.";
    case "financial_risk":
      return "The NT filing contains accounting, audit, internal-control, or financial-statement completion risk.";
    case "sales_performance":
      return "The NT filing discloses a significant sales, revenue, customer-order, or margin change.";
    case "earnings":
      return "The NT filing discloses a significant change in results without a more specific sales driver.";
    case "strategic_transaction":
      return "The NT filing delay is tied to a merger, acquisition, divestiture, or consolidation matter.";
    default:
      return "The NT filing should be routed to the closest approved event type based on source-backed facts.";
  }
}
