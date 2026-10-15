import { SEC_425_DISPLAY_PAYLOAD_VERSION, resolveSec425RouterEvidence, type Sec425RouterDecision } from "./routerPrompt";
import type { Sec425DisplayPayload, Sec425ParserOutput } from "./types";
import { inspectSec425Identity, type Sec425IdentityEvidence } from "./verification.ts";

export function buildSec425DisplayPayload(
  parserOutput: Sec425ParserOutput,
  routerDecision: Sec425RouterDecision,
  identityEvidence?: Sec425IdentityEvidence,
): Sec425DisplayPayload {
  const facts = parserOutput.facts;
  const identity = inspectSec425Identity({ key: "primary", name: facts.company_name, ticker: facts.primary_ticker, exchange: facts.exchange }, parserOutput.raw.cleaned_source_blocks, identityEvidence);
  const sourceEvidence = resolveSec425RouterEvidence(routerDecision.selected_source_block_ids || [], parserOutput);
  const evidence = uniqueStrings([
    ...sourceEvidence.map(block => [block.heading, block.text].filter(Boolean).join("\n")),
    ...facts.deal.evidence,
    ...facts.vote.evidence,
    ...facts.offer.evidence,
    ...facts.spac.evidence,
    ...facts.amendment.evidence,
    ...facts.legal.litigation_or_claims,
    ...facts.legal.regulatory_risk,
    ...facts.legal.injunction_or_delay_risk,
    ...facts.financing.financing_risk,
    ...facts.financing.going_concern_or_liquidity_risk,
    ...facts.raw_data.signal_candidates.map((candidate) => candidate.context),
  ]).slice(0, 12);

  return {
    display_type: routerDecision.display_type,
    data: {
      display_version: SEC_425_DISPLAY_PAYLOAD_VERSION,
      route_case: routerDecision.route_case,
      transaction_stage: routerDecision.transaction_stage,
      event_type: routerDecision.event_type,
      score_hint: routerDecision.score,
      routing_reason: routerDecision.routing_reason,
      router_source_evidence: sourceEvidence,
      company_name: facts.company_name,
      primary_ticker: identity.verifiedTicker,
      exchange: identity.verifiedExchange,
      identity_verification: identity,
      filed_by: facts.filed_by,
      subject_company: facts.subject_company,
      content_types: facts.raw_data.content_types,
      communication_types: facts.communication_types,
      parser_only_case: facts.raw_data.parser_only_case,
      extraction_quality: facts.raw_data.extraction_quality,
      documents: facts.documents,
      deal: facts.deal,
      vote: facts.vote,
      offer: facts.offer,
      spac: facts.spac,
      spac_transaction_status: buildSpacTransactionStatusData(parserOutput, routerDecision),
      amendment: facts.amendment,
      legal: facts.legal,
      financing: facts.financing,
      calendar_items: parserOutput.calendarItems,
      warnings: parserOutput.warnings,
      source_url: parserOutput.raw.sourceUrl,
      source_excerpts: facts.source_excerpts.slice(0, 8),
      candidate_text_excerpt: facts.raw_data.candidate_text ? facts.raw_data.candidate_text.slice(0, 2400) : "",
    },
    evidence,
    notes: buildDisplayNotes(parserOutput, routerDecision),
  };
}

function buildDisplayNotes(parserOutput: Sec425ParserOutput, routerDecision: Sec425RouterDecision) {
  const notes = [
    "Display payload built from source-backed fields before analysis LLM; analysis must not invent UI fields.",
  ];
  if (routerDecision.display_type === "candidate_special") {
    notes.push("Candidate special detail data is source-backed and should be reviewed by the detail UI room before a dedicated template is approved.");
  }
  if (routerDecision.display_type === "spac_transaction_status") {
    notes.push("SPAC transaction status payload is for de-SPAC status, vote, redemption, closing condition, ticker, or related transaction updates; it is not for plain blank-check IPO registration.");
  }
  if (parserOutput.warnings.includes("extraction_failure_route_to_ocr_or_vision")) {
    notes.push("Source extraction appears image-heavy or sparse; OCR/vision handling may be needed for complete display.");
  }
  if (parserOutput.facts.raw_data.parser_only_case) {
    notes.push(`Parser-only case: ${parserOutput.facts.raw_data.parser_only_case}.`);
  }
  return notes;
}

function buildSpacTransactionStatusData(parserOutput: Sec425ParserOutput, routerDecision: Sec425RouterDecision) {
  if (routerDecision.display_type !== "spac_transaction_status") return null;
  const facts = parserOutput.facts;
  return {
    spac_name: facts.spac.spac_name,
    target_name: facts.spac.target_name,
    combined_company_name: facts.spac.combined_company_name,
    expected_ticker: facts.spac.expected_ticker,
    pipe_amount: facts.spac.pipe_amount,
    pre_money_valuation: facts.spac.pre_money_valuation,
    equity_value: facts.spac.equity_value,
    enterprise_value: facts.spac.enterprise_value,
    trust_cash: facts.spac.trust_cash,
    redemption_risk: facts.spac.redemption_risk,
    earnout_shares: facts.spac.earnout_shares,
    warrant_terms: facts.spac.warrant_terms,
    sponsor_transfer: facts.spac.sponsor_transfer,
    meeting_date: facts.vote.meeting_date,
    record_date: facts.vote.record_date,
    reconvened_date: facts.vote.reconvened_date,
    vote_results: facts.vote.vote_results,
    expected_close: facts.deal.expected_close,
    transaction_status: facts.deal.transaction_status,
    source_evidence: [
      ...facts.spac.evidence,
      ...facts.vote.evidence,
      ...facts.deal.evidence,
    ].slice(0, 8),
  };
}

function uniqueStrings(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const text = (value || "").trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    unique.push(text);
  }
  return unique;
}
