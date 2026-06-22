import {
  APPROVED_EVENT_TYPES,
  type Sc13MarketContext,
  type Sc13ParserOutput,
  type Sc13RouteDecision,
} from "./types";

export const SC13_ROUTER_PROMPT_VERSION = "sc13-router-v1";
export const SC13_OWNERSHIP_DISPLAY_VERSION = "sc13-ownership-v1";

export function getSc13DeterministicRoute(parserOutput: Sc13ParserOutput): Sc13RouteDecision | null {
  void parserOutput;
  return null;
}

export function buildSc13RouterPrompt(
  parserOutput: Sc13ParserOutput,
  options: { marketContext?: Sc13MarketContext | null } = {},
): string {
  const routerInput = buildCompactRouterInput(parserOutput, options.marketContext ?? null);

  return [
    `Prompt version: ${SC13_ROUTER_PROMPT_VERSION}`,
    "Deprecated compatibility prompt: SC13 no longer uses a router LLM in the live flow.",
    "If this prompt is invoked by a legacy test harness, classify only from cleaned_source_blocks below.",
    "Do not use parser facts, parser signals, classification handoff, route hints, event_type hints, or display hints as authority.",
    "Do not request or use full raw filing text unless the cleaned source blocks are insufficient.",
    "Do not call live market data, live DB, ingest, alerts, or UI code.",
    `Approved event_type values: ${APPROVED_EVENT_TYPES.join(", ")}.`,
    "Choose exactly one event_type and one display_type/display_version. Delivery is always derived from analysis score later: score < 50 archive, 50-74 feed, 75+ alert.",
    "",
    "Routing guidance:",
    "- SC13 does not finish as parser archive in the live flow; send cleaned_source_blocks to analysis LLM.",
    "- Use router classification when Item 4 purpose text, governance keywords, transaction keywords, litigation/regulatory keywords, financing keywords, or agreement-like exhibits make event_type/display_type ambiguous.",
    "- Governance or board-related source keywords generally route to leadership_governance unless transaction keywords are the better source-backed fit.",
    "- Merger, sale, support agreement, voting agreement, tender offer, or transaction-related source keywords generally route to strategic_transaction.",
    "- Convertible financing, backstop, warrant, bridge financing, or financing-related source keywords generally route to dilution_risk.",
    "- Litigation, investigation, standstill dispute, or regulatory source keywords generally route to legal_risk.",
    "- Use ipo_listing only when the main event is a traditional IPO, SPAC IPO, direct listing, IPO pricing, first trading/listing date, or registration effectiveness tied to a new public listing.",
    "- Do not use ipo_listing for ordinary resale registration, shelf offerings, ATM/offering dilution, already-listed issuer resale, post-closing business updates, or SPAC redemption/liquidation/de-SPAC events unless the main event is the IPO/listing itself.",
    "- Use other only when none of the approved event types fit.",
    "",
    "Return only JSON:",
    JSON.stringify(
      {
        event_type: "one approved event_type",
        preliminary_action: "archive | feed | alert | needs_analysis",
        display_type: "generic | offering_terms | candidate_special",
        display_version: SC13_OWNERSHIP_DISPLAY_VERSION,
        requires_analysis_llm: true,
        reason: "short source-backed routing reason",
        confidence: "high | medium | low",
        deterministic: false,
      },
      null,
      2,
    ),
    "",
    "No deterministic route is available for SC13; route to analysis LLM.",
    "",
    "cleaned_source_blocks_input:",
    JSON.stringify(routerInput, null, 2),
  ].join("\n");
}

function buildCompactRouterInput(parserOutput: Sc13ParserOutput, marketContext: Sc13MarketContext | null) {
  return {
    cleaned_source_blocks: parserOutput.cleaned_source_blocks,
    fixtureMarketContext: marketContext,
  };
}
