import {
  SEC_425_APPROVED_EVENT_TYPES,
  SEC_425_PARSER_VERSION,
  deliveryLevelFromScore,
  type Sec425ApprovedEventType,
  type Sec425Confidence,
  type Sec425DeliveryLevel,
  type Sec425DisplayType,
  type Sec425ParserOutput,
} from "./types";
import { buildSecSourceBlockPromptInput } from "../common/sourceBlockPromptInput";

export const SEC_425_ROUTER_PROMPT_KEY = "sec_425_router_draft";
export const SEC_425_ROUTER_PROMPT_VERSION = "v1";
export const SEC_425_DISPLAY_PAYLOAD_VERSION = "sec_425_display_v1";

export const SEC_425_ROUTER_ACTION_VALUES = ["archive", "feed", "alert"] as const;
export const SEC_425_ROUTER_CASE_VALUES = [
  "merger_or_acquisition_terms",
  "spac_business_combination_terms",
  "tender_or_exchange_offer",
  "agreement_amendment",
  "shareholder_vote_solicitation",
  "shareholder_vote_results",
  "shareholder_meeting_adjournment",
  "deal_litigation_or_regulatory_risk",
  "financing_or_liquidity_risk",
  "investor_day_notice",
  "routine_repetition",
  "unclear_425_communication",
] as const;

export type Sec425RouterAction = (typeof SEC_425_ROUTER_ACTION_VALUES)[number];
export type Sec425RouterCase = (typeof SEC_425_ROUTER_CASE_VALUES)[number];

export type Sec425RouterPromptInput = {
  filing_package: Record<string, unknown>;
  parser_output: Sec425ParserOutput;
  filing_excerpt?: string | null;
  market_context?: Record<string, unknown> | null;
};

export type Sec425RouterDecision = {
  source_group: "filings";
  source_form_type: "425";
  parser_group: "425";
  event_type: Sec425ApprovedEventType;
  score: number;
  expected_delivery_level: Sec425DeliveryLevel;
  action: Sec425RouterAction;
  route_case: Sec425RouterCase;
  display_type: Sec425DisplayType;
  display_version: typeof SEC_425_DISPLAY_PAYLOAD_VERSION;
  confidence: Sec425Confidence;
  needs_analysis_llm: boolean;
  deterministic_stage: "parser" | "router" | null;
  routing_reason: string;
  evidence: string[];
  source_blocks_used: string[];
  needs_human_review: boolean;
  debug: {
    parser_version: typeof SEC_425_PARSER_VERSION;
    router_prompt_key: typeof SEC_425_ROUTER_PROMPT_KEY;
    router_prompt_version: typeof SEC_425_ROUTER_PROMPT_VERSION;
  };
};

export const sec425RouterSystemPrompt = [
  "Route one SEC Form 425 filing from cleaned source blocks.",
  "Return only strict JSON matching the schema. Do not invent fields, event types, dates, tickers, deal terms, or market data.",
  `Use only these approved event types: ${SEC_425_APPROVED_EVENT_TYPES.join(", ")}.`,
  "This form family requires routing/classification because Form 425 can map to strategic_transaction, shareholder_vote, legal_risk, financial_risk, dilution_risk, ipo_listing, or other.",
  "Use only cleaned_source_blocks. Do not require full raw filing text.",
  "Do not use parser-generated facts, signals, route hints, extraction summaries, event labels, display labels, or investment labels as classification authority.",
  "If filing_excerpt is supplied, treat it as selected source snippets only, not as a full raw filing dump.",
  "Form 425 usually involves merger, acquisition, exchange offer, tender offer, proxy solicitation, or other deal-related communications.",
  "Classify by investor-relevant content, not by form number alone.",
  "Use strategic_transaction for material merger, acquisition, business-combination, consideration, closing, or deal-status communications.",
  "Use strategic_transaction for tender offers, exchange offers, hostile offers, SPAC business-combination terms, agreement amendments with changed economics, or concrete transaction security terms.",
  "Use shareholder_vote when the communication mainly solicits votes, announces a special meeting, updates record dates, reports vote results, or announces an adjourned or reconvened meeting.",
  "Use legal_risk when litigation, injunction, regulatory approval, second request, antitrust, settlement, or claims could affect the deal or investor outcome.",
  "Use financial_risk when the communication highlights financing availability, financing conditions, liquidity, going-concern, cash runway, or failure-to-close funding consequences.",
  "Use dilution_risk only when cleaned source blocks show transaction financing, PIPE, share issuance, warrants, redemptions, or pro forma ownership terms where dilution is the main event.",
  "Use ipo_listing only when the main event is a traditional IPO, SPAC IPO, direct listing, IPO pricing, first trading/listing date, or registration effectiveness tied to a new public listing.",
  "Do not use ipo_listing for ordinary resale registration, shelf offering, ATM/offering dilution, already-listed issuer resale, post-closing business update, or SPAC redemption/liquidation/de-SPAC cases unless the IPO/listing itself is the main event.",
  "For IPO/listing display data, do not split event_type; use event_type ipo_listing and display_payload.data.ipo_kind traditional or spac when source-backed.",
  "Use other only for routine, unclear, educational, or no-new-material-information communications.",
  "Choose display_type and display_version for the UI payload builder.",
  "Use display_type spac_transaction_status when a 425 is about SPAC/de-SPAC business-combination status, merger vote, redemption result, closing condition, ticker change, minimum cash condition, or de-SPAC closing update and cleaned source blocks are sufficient to populate that page.",
  "Do not use spac_transaction_status for a plain blank-check IPO registration with no target or deal status; those remain generic/archive unless there is a material transaction update.",
  "Use candidate_special only when source-backed deal, tender, financing, dilution, or complex vote fields need a future dedicated filing detail treatment and no scheduled/special display type fits; otherwise use generic. Do not create new display types.",
  "Deterministic archives are allowed only when the filing expressly repeats prior materials and states there is no change to material terms, timeline, vote date, consideration, or conditions, or when cleaned source blocks show cover-only or boilerplate-only content with no deal-specific risk language.",
  "Use score bands exactly: below 50 archive, 50 to 74 feed, 75 or above alert.",
  "expected_delivery_level and action must be derived from score; they are not free choices.",
  "Return whether analysis LLM is needed. Analysis writes investor-facing copy only and must use the selected event_type, display_type, and display payload.",
  "If the filing needs market context, use only market_context supplied in the fixture JSON. Do not request or assume live market data.",
].join("\n");

export const sec425RouterResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "source_group",
    "source_form_type",
    "parser_group",
    "event_type",
    "score",
    "expected_delivery_level",
    "action",
    "route_case",
    "display_type",
    "display_version",
    "confidence",
    "needs_analysis_llm",
    "deterministic_stage",
    "routing_reason",
    "evidence",
    "source_blocks_used",
    "needs_human_review",
    "debug",
  ],
  properties: {
    source_group: { type: "string", enum: ["filings"] },
    source_form_type: { type: "string", enum: ["425"] },
    parser_group: { type: "string", enum: ["425"] },
    event_type: { type: "string", enum: SEC_425_APPROVED_EVENT_TYPES },
    score: { type: "integer", minimum: 0, maximum: 100 },
    expected_delivery_level: { type: "string", enum: ["archive", "feed", "alert"] },
    action: { type: "string", enum: SEC_425_ROUTER_ACTION_VALUES },
    route_case: { type: "string", enum: SEC_425_ROUTER_CASE_VALUES },
    display_type: { type: "string", enum: ["generic", "offering_terms", "candidate_special", "spac_transaction_status"] },
    display_version: { type: "string", enum: [SEC_425_DISPLAY_PAYLOAD_VERSION] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    needs_analysis_llm: { type: "boolean" },
    deterministic_stage: { type: ["string", "null"], enum: ["parser", "router", null] },
    routing_reason: { type: "string" },
    evidence: { type: "array", items: { type: "string" } },
    source_blocks_used: { type: "array", items: { type: "string" } },
    needs_human_review: { type: "boolean" },
    debug: {
      type: "object",
      additionalProperties: false,
      required: ["parser_version", "router_prompt_key", "router_prompt_version"],
      properties: {
        parser_version: { type: "string", enum: [SEC_425_PARSER_VERSION] },
        router_prompt_key: { type: "string", enum: [SEC_425_ROUTER_PROMPT_KEY] },
        router_prompt_version: { type: "string", enum: [SEC_425_ROUTER_PROMPT_VERSION] },
      },
    },
  },
} as const;

export function buildSec425RouterPromptDraft(input: Sec425RouterPromptInput) {
  return {
    key: SEC_425_ROUTER_PROMPT_KEY,
    version: SEC_425_ROUTER_PROMPT_VERSION,
    system: sec425RouterSystemPrompt,
    user: JSON.stringify(
      buildSecSourceBlockPromptInput({
        filingPackage: input.filing_package,
        parserOutput: input.parser_output as unknown as Record<string, unknown>,
        fallbackText: input.filing_excerpt,
        marketContext: input.market_context,
      }),
    ),
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "sec_425_router",
        strict: true,
        schema: sec425RouterResponseSchema,
      },
    },
  };
}

export function routeSec425ParserOutput(parserOutput: Sec425ParserOutput): Sec425RouterDecision {
  const facts = parserOutput.facts;

  if (facts.deterministic_archive_reason) {
    return buildDecision({
      parserOutput,
      eventType: "other",
      score: 35,
      action: "archive",
      routeCase: "routine_repetition",
      displayType: "generic",
      confidence: "high",
      needsAnalysisLlm: false,
      deterministicStage: "parser",
      reason: facts.deterministic_archive_reason,
      evidence: [facts.deterministic_archive_reason],
      parserFactsUsed: ["facts.no_new_material_info", "facts.deterministic_archive_reason"],
      needsHumanReview: false,
    });
  }

  const highRiskRegulatoryEvidence = facts.legal.regulatory_risk.filter((evidence) =>
    /\b(?:FTC|DOJ|antitrust|HSR Act|Hart-Scott-Rodino|second request)\b/i.test(evidence),
  );
  if (facts.legal.litigation_or_claims.length || highRiskRegulatoryEvidence.length || facts.legal.injunction_or_delay_risk.length) {
    return buildDecision({
      parserOutput,
      eventType: "legal_risk",
      score: 70,
      action: "feed",
      routeCase: "deal_litigation_or_regulatory_risk",
      displayType: "generic",
      confidence: "medium",
      needsAnalysisLlm: true,
      deterministicStage: null,
      reason: "Form 425 communication includes litigation, regulatory, injunction, or delay language that can affect deal certainty.",
      evidence: [...facts.legal.litigation_or_claims, ...highRiskRegulatoryEvidence, ...facts.legal.injunction_or_delay_risk].slice(0, 4),
      parserFactsUsed: ["facts.legal", "facts.deal.transaction_type"],
      needsHumanReview: false,
    });
  }

  if (facts.financing.financing_risk.length || facts.financing.going_concern_or_liquidity_risk.length) {
    return buildDecision({
      parserOutput,
      eventType: "financial_risk",
      score: 68,
      action: "feed",
      routeCase: "financing_or_liquidity_risk",
      displayType: "candidate_special",
      confidence: "medium",
      needsAnalysisLlm: true,
      deterministicStage: null,
      reason: "Form 425 communication discusses financing, liquidity, or going-concern consequences tied to the transaction.",
      evidence: [...facts.financing.financing_risk, ...facts.financing.going_concern_or_liquidity_risk].slice(0, 4),
      parserFactsUsed: ["facts.financing", "facts.deal.transaction_type"],
      needsHumanReview: false,
    });
  }

  if (facts.offer.offer_type) {
    return buildDecision({
      parserOutput,
      eventType: "strategic_transaction",
      score: facts.offer.is_hostile_or_unsolicited ? 78 : 70,
      action: facts.offer.is_hostile_or_unsolicited ? "alert" : "feed",
      routeCase: "tender_or_exchange_offer",
      displayType: "candidate_special",
      confidence: "high",
      needsAnalysisLlm: true,
      deterministicStage: null,
      reason: "Form 425 communication contains tender, exchange-offer, or consent-solicitation mechanics tied to a transaction.",
      evidence: facts.offer.evidence.slice(0, 4),
      parserFactsUsed: ["facts.offer", "facts.subject_company"],
      needsHumanReview: facts.offer.evidence.length === 0,
    });
  }

  if (facts.vote.vote_results.length) {
    return buildDecision({
      parserOutput,
      eventType: "shareholder_vote",
      score: 66,
      action: "feed",
      routeCase: "shareholder_vote_results",
      displayType: "generic",
      confidence: "high",
      needsAnalysisLlm: true,
      deterministicStage: null,
      reason: "Form 425 communication reports proposal-level shareholder vote results for the transaction.",
      evidence: facts.vote.vote_results.map((result) => result.evidence).slice(0, 4),
      parserFactsUsed: ["facts.vote.vote_results", "facts.vote.quorum"],
      needsHumanReview: false,
    });
  }

  if (facts.vote.adjourned || facts.vote.no_vote_conducted || facts.vote.reconvened_date) {
    return buildDecision({
      parserOutput,
      eventType: "shareholder_vote",
      score: 62,
      action: "feed",
      routeCase: "shareholder_meeting_adjournment",
      displayType: "generic",
      confidence: facts.vote.reconvened_date ? "high" : "medium",
      needsAnalysisLlm: true,
      deterministicStage: null,
      reason: "Form 425 communication announces an adjourned or reconvened shareholder meeting or states that no vote was conducted.",
      evidence: facts.vote.evidence.slice(0, 4),
      parserFactsUsed: ["facts.vote.adjourned", "facts.vote.reconvened_date", "facts.vote.no_vote_conducted"],
      needsHumanReview: !facts.vote.reconvened_date && !facts.vote.no_vote_conducted,
    });
  }

  if (facts.vote.solicitation_present || facts.vote.meeting_date) {
    return buildDecision({
      parserOutput,
      eventType: "shareholder_vote",
      score: 64,
      action: "feed",
      routeCase: "shareholder_vote_solicitation",
      displayType: "generic",
      confidence: facts.vote.meeting_date ? "high" : "medium",
      needsAnalysisLlm: true,
      deterministicStage: null,
      reason: "Form 425 communication solicits shareholder votes or gives a special meeting date for the transaction.",
      evidence: facts.vote.evidence.slice(0, 4),
      parserFactsUsed: ["facts.vote"],
      needsHumanReview: false,
    });
  }

  if (facts.amendment.is_amendment_or_follow_up && facts.material_change) {
    return buildDecision({
      parserOutput,
      eventType: "strategic_transaction",
      score: 68,
      action: "feed",
      routeCase: "agreement_amendment",
      displayType: "candidate_special",
      confidence: "medium",
      needsAnalysisLlm: true,
      deterministicStage: null,
      reason: "Form 425 communication contains an amendment or follow-up filing with changed transaction terms or mechanics.",
      evidence: facts.amendment.evidence.slice(0, 4),
      parserFactsUsed: ["facts.amendment", "facts.material_change"],
      needsHumanReview: facts.amendment.amended_sections.length === 0,
    });
  }

  if (facts.spac.is_spac_business_combination && (facts.spac.pipe_amount || facts.spac.pre_money_valuation || facts.spac.earnout_shares || facts.spac.warrant_terms)) {
    return buildDecision({
      parserOutput,
      eventType: "strategic_transaction",
      score: 76,
      action: "alert",
      routeCase: "spac_business_combination_terms",
      displayType: "spac_transaction_status",
      confidence: facts.spac.pipe_amount || facts.spac.pre_money_valuation ? "high" : "medium",
      needsAnalysisLlm: true,
      deterministicStage: null,
      reason: "Form 425 SPAC business-combination communication includes enough de-SPAC transaction status, financing, valuation, earnout, warrant, or ownership facts for the SPAC transaction status display.",
      evidence: facts.spac.evidence.slice(0, 4),
      parserFactsUsed: ["facts.spac", "facts.deal.transaction_type"],
      needsHumanReview: false,
    });
  }

  if (facts.communication_types.includes("investor_day_notice")) {
    return buildDecision({
      parserOutput,
      eventType: "other",
      score: 42,
      action: "archive",
      routeCase: "investor_day_notice",
      displayType: "generic",
      confidence: "high",
      needsAnalysisLlm: true,
      deterministicStage: null,
      reason: "Form 425 communication gives an investor-day or webcast notice tied to a proposed transaction, without changed transaction terms in the source blocks.",
      evidence: parserOutput.facts.source_excerpts.slice(0, 4),
      parserFactsUsed: ["facts.communication_types", "calendarItems"],
      needsHumanReview: false,
    });
  }

  if (facts.deal.transaction_type || facts.deal.consideration_text || facts.deal.transaction_value) {
    const alertLevel = Boolean(facts.deal.consideration_text && (facts.deal.transaction_value || facts.deal.exchange_ratio));
    return buildDecision({
      parserOutput,
      eventType: "strategic_transaction",
      score: alertLevel ? 78 : 66,
      action: alertLevel ? "alert" : "feed",
      routeCase: "merger_or_acquisition_terms",
      displayType: "candidate_special",
      confidence: facts.deal.consideration_text ? "high" : "medium",
      needsAnalysisLlm: true,
      deterministicStage: null,
      reason: "Form 425 communication contains material merger, acquisition, business-combination, or consideration terms.",
      evidence: facts.deal.evidence.slice(0, 4),
      parserFactsUsed: ["facts.deal", "facts.transaction_parties"],
      needsHumanReview: false,
    });
  }

  return buildDecision({
    parserOutput,
    eventType: "other",
    score: 30,
    action: "archive",
    routeCase: "unclear_425_communication",
    displayType: "generic",
    confidence: "low",
    needsAnalysisLlm: true,
    deterministicStage: null,
    reason: "The Form 425 communication did not expose enough source-backed facts to classify into a more specific approved event type.",
    evidence: parserOutput.facts.source_excerpts.slice(0, 3),
    parserFactsUsed: ["facts.source_excerpts", "warnings"],
    needsHumanReview: true,
  });
}

function buildDecision({
  parserOutput,
  eventType,
  score,
  action,
  routeCase,
  displayType,
  confidence,
  needsAnalysisLlm,
  deterministicStage,
  reason,
  evidence,
  parserFactsUsed,
  needsHumanReview,
}: {
  parserOutput: Sec425ParserOutput;
  eventType: Sec425ApprovedEventType;
  score: number;
  action: Sec425RouterAction;
  routeCase: Sec425RouterCase;
  displayType: Sec425DisplayType;
  confidence: Sec425Confidence;
  needsAnalysisLlm: boolean;
  deterministicStage: Sec425RouterDecision["deterministic_stage"];
  reason: string;
  evidence: string[];
  parserFactsUsed: string[];
  needsHumanReview: boolean;
}): Sec425RouterDecision {
  const derivedAction = deliveryLevelFromScore(score);
  return {
    source_group: "filings",
    source_form_type: "425",
    parser_group: "425",
    event_type: eventType,
    score,
    expected_delivery_level: derivedAction,
    action: derivedAction,
    route_case: routeCase,
    display_type: displayType,
    display_version: SEC_425_DISPLAY_PAYLOAD_VERSION,
    confidence,
    needs_analysis_llm: needsAnalysisLlm,
    deterministic_stage: deterministicStage,
    routing_reason: reason,
    evidence,
    source_blocks_used: parserFactsUsed,
    needs_human_review: needsHumanReview,
    debug: {
      parser_version: parserOutput.parserVersion,
      router_prompt_key: SEC_425_ROUTER_PROMPT_KEY,
      router_prompt_version: SEC_425_ROUTER_PROMPT_VERSION,
    },
  };
}
