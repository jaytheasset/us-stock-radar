import type { ProxyEventType, ProxyParserOutput } from "./parser.ts";

export type ProxyDisplayType = "generic" | "offering_terms" | "candidate_special" | "spac_transaction_status";

export interface ProxyDisplayPayload {
  display_type: ProxyDisplayType;
  display_version: string;
  data: Record<string, unknown>;
  evidence: string[];
  notes: string[];
}

export interface ProxyDisplaySpec {
  display_type: ProxyDisplayType;
  display_version: string;
}

export function selectProxyDisplaySpec(
  parserOutput: ProxyParserOutput,
  eventType: ProxyEventType,
): ProxyDisplaySpec {
  if (eventType === "ipo_listing") {
    return { display_type: "generic", display_version: "proxy_ipo_listing_v1" };
  }
  if (hasSpacTransactionStatusFacts(parserOutput)) {
    return { display_type: "spac_transaction_status", display_version: "proxy_spac_transaction_status_v1" };
  }
  if (eventType === "strategic_transaction" || parserOutput.facts.transaction.hasTransactionVote) {
    return { display_type: "candidate_special", display_version: "proxy_transaction_vote_v1" };
  }
  if (
    eventType === "dilution_risk" &&
    (parserOutput.facts.dilution.hasEquityPlanVote || parserOutput.facts.dilution.sharesRequested !== null)
  ) {
    return { display_type: "offering_terms", display_version: "proxy_equity_plan_vote_v1" };
  }
  if (
    eventType === "dilution_risk" ||
    eventType === "listing_risk" ||
    parserOutput.facts.reverseSplit?.hasReverseSplitProposal ||
    parserOutput.raw.proposalExtraction.candidates.some((candidate) =>
      candidate.detailedCategory === "authorized_share_increase" ||
      candidate.detailedCategory === "charter_amendment" ||
      candidate.detailedCategory === "bylaw_amendment"
    )
  ) {
    return { display_type: "candidate_special", display_version: "proxy_capital_structure_vote_v1" };
  }
  if (
    eventType === "leadership_governance" ||
    eventType === "legal_risk" ||
    parserOutput.facts.contested ||
    parserOutput.facts.supplement ||
    parserOutput.raw.supplementalAnalysis.isSupplementalOrAmended
  ) {
    return { display_type: "candidate_special", display_version: "proxy_governance_vote_v1" };
  }
  return { display_type: "generic", display_version: "proxy_generic_v1" };
}

export function buildProxyDisplayPayload(
  parserOutput: ProxyParserOutput,
  eventType: ProxyEventType,
): ProxyDisplayPayload {
  const spec = selectProxyDisplaySpec(parserOutput, eventType);
  const baseData: Record<string, unknown> = {
    company_name: parserOutput.facts.companyName,
    sec_form_type: parserOutput.facts.secFormType,
    proxy_type: parserOutput.facts.proxyType,
    proposal_count: parserOutput.facts.proposalCount,
    meeting_date: parserOutput.facts.meetingDate,
    record_date: parserOutput.facts.recordDate,
    proposals: parserOutput.facts.proposals.map((proposal) => ({
      id: proposal.id,
      title: proposal.title,
      category: proposal.category,
      recommendation: proposal.recommendation,
      is_shareholder_proposal: proposal.isShareholderProposal,
    })),
    warnings: parserOutput.warnings,
  };

  if (spec.display_version === "proxy_transaction_vote_v1") {
    Object.assign(baseData, {
      consideration: parserOutput.facts.transaction.consideration,
      vote_required: parserOutput.facts.transaction.voteRequired,
      proposal_ids: parserOutput.facts.transaction.proposalIds,
      agreement_date: parserOutput.facts.transaction.agreementDate ?? null,
      merger_parties: parserOutput.facts.transaction.mergerParties ?? [],
      appraisal_rights_mentioned: parserOutput.facts.transaction.appraisalRightsMentioned ?? false,
      delisting_mentioned: parserOutput.facts.transaction.delistingMentioned ?? false,
    });
  }

  if (spec.display_version === "proxy_spac_transaction_status_v1") {
    Object.assign(baseData, {
      spac_transaction_kind: inferSpacTransactionKind(parserOutput),
      redemption_mentioned: hasProxyText(parserOutput, /\bredemption\b|\bredeem\b|\bpublic\s+shares\b/i),
      trust_account_mentioned: hasProxyText(parserOutput, /\btrust\s+account\b/i),
      minimum_cash_condition_mentioned: hasProxyText(parserOutput, /\bminimum\s+cash\b|\bcash\s+condition\b/i),
      closing_condition_mentioned: hasProxyText(parserOutput, /\bclosing\s+condition\b|\bcondition\s+to\s+closing\b/i),
      ticker_change_mentioned: hasProxyText(parserOutput, /\bticker\s+(?:symbol\s+)?(?:change|will\s+change|to\s+trade)\b|\bnew\s+ticker\b/i),
      vote_required: parserOutput.facts.transaction.voteRequired,
      proposal_ids: parserOutput.facts.transaction.proposalIds,
    });
  }

  if (spec.display_version === "proxy_ipo_listing_v1") {
    Object.assign(baseData, {
      ipo_kind: inferIpoKind(parserOutput),
      listing_action: inferListingAction(parserOutput),
      exchange_ticker: formatProxyTicker(parserOutput),
      vote_requirement: parserOutput.facts.transaction.voteRequired ?? null,
      listing_evidence: parserOutput.signals
        .filter((signal) => signal.eventType === "ipo_listing")
        .map((signal) => signal.evidence),
    });
  }

  if (spec.display_version === "proxy_equity_plan_vote_v1") {
    Object.assign(baseData, {
      shares_requested: parserOutput.facts.dilution.sharesRequested,
      percent_of_outstanding: parserOutput.facts.dilution.percentOfOutstanding,
      proposal_ids: parserOutput.facts.dilution.proposalIds,
      key_tables: parserOutput.raw.keyTableExtraction.tables
        .filter((table) =>
          table.tableType === "equity_compensation_plan_information" ||
          table.tableType === "new_plan_benefits"
        )
        .map(compactTable),
    });
  }

  if (spec.display_version === "proxy_capital_structure_vote_v1") {
    Object.assign(baseData, {
      reverse_split: parserOutput.facts.reverseSplit ?? null,
      dilution: parserOutput.facts.dilution,
      capital_structure_proposals: parserOutput.raw.proposalExtraction.candidates
        .filter((candidate) =>
          candidate.detailedCategory === "reverse_stock_split" ||
          candidate.detailedCategory === "authorized_share_increase" ||
          candidate.detailedCategory === "charter_amendment" ||
          candidate.detailedCategory === "bylaw_amendment"
        )
        .map((candidate) => ({
          id: candidate.id,
          title: candidate.title,
          category: candidate.detailedCategory,
          source_area: candidate.sourceArea,
          board_recommendation: candidate.boardRecommendation,
        })),
    });
  }

  if (spec.display_version === "proxy_governance_vote_v1") {
    Object.assign(baseData, {
      contested: parserOutput.facts.contested ?? null,
      supplement: parserOutput.facts.supplement ?? null,
      supplemental_analysis: {
        material_type: parserOutput.raw.supplementalAnalysis.materialType,
        parent_references: parserOutput.raw.supplementalAnalysis.parentReferences,
        change_signals: parserOutput.raw.supplementalAnalysis.changeSignals,
        reconciliation: parserOutput.raw.supplementalAnalysis.reconciliation,
      },
      shareholder_or_governance_proposals: parserOutput.raw.proposalExtraction.candidates
        .filter((candidate) =>
          candidate.sponsor !== "management" ||
          candidate.category === "governance" ||
          candidate.detailedCategory === "shareholder_proposal"
        )
        .map((candidate) => ({
          id: candidate.id,
          title: candidate.title,
          sponsor: candidate.sponsor,
          board_recommendation: candidate.boardRecommendation,
          shareholder_recommendation: candidate.shareholderRecommendation,
          source_area: candidate.sourceArea,
        })),
    });
  }

  return {
    ...spec,
    data: pruneEmptyDisplayFields(baseData),
    evidence: buildDisplayEvidence(parserOutput),
    notes: buildDisplayNotes(parserOutput, spec),
  };
}

function compactTable(table: ProxyParserOutput["raw"]["keyTableExtraction"]["tables"][number]): Record<string, unknown> {
  return {
    id: table.id,
    table_type: table.tableType,
    heading: table.heading,
    caption: table.caption,
    proposal_id: table.proposalId,
    row_count: table.rowCount,
    column_count: table.columnCount,
    headers: table.headers,
    sample_rows: table.sampleRows,
    warnings: table.warnings,
  };
}

function buildDisplayEvidence(parserOutput: ProxyParserOutput): string[] {
  return uniqueStrings([
    ...parserOutput.signals.map((signal) => signal.evidence),
    ...parserOutput.facts.proposals.map((proposal) => proposal.sourceText),
    parserOutput.facts.transaction.voteRequired ? `Vote required: ${parserOutput.facts.transaction.voteRequired}` : null,
    parserOutput.facts.ownership.sourceText,
    parserOutput.facts.supplement?.sourceText,
    parserOutput.facts.contested?.sourceText,
    parserOutput.facts.reverseSplit?.sourceText,
  ].filter((value): value is string => Boolean(value))).slice(0, 12);
}

function buildDisplayNotes(parserOutput: ProxyParserOutput, spec: ProxyDisplaySpec): string[] {
  const notes: string[] = [`Display payload built by proxy parser room as ${spec.display_version}.`];
  if (parserOutput.facts.deterministic.canFinishWithoutLlm) {
    notes.push("Deterministic parser-stage archive candidate; analysis LLM is not needed.");
  }
  if (parserOutput.raw.supplementalAnalysis.isSupplementalOrAmended) {
    notes.push("Supplement/amendment evidence is parser-extracted; parent proxy text may be unavailable.");
  }
  if (parserOutput.raw.textCoverage.hasImageHeavyDocument) {
    notes.push("One or more source documents appear image-heavy or low-text.");
  }
  return notes;
}

function hasSpacTransactionStatusFacts(parserOutput: ProxyParserOutput): boolean {
  if (parserOutput.facts.transaction.hasTransactionVote && hasProxyText(parserOutput, /\bSPAC\b|\bde-?SPAC\b|\bspecial\s+purpose\s+acquisition\s+company\b|\bblank[- ]check\b|\btrust\s+account\b|\bredemption\b/i)) {
    return true;
  }
  return hasProxyText(
    parserOutput,
    /\b(?:SPAC|de-?SPAC|special\s+purpose\s+acquisition\s+company|blank[- ]check)\b[^.\n]{0,240}\b(?:business\s+combination|redemption|minimum\s+cash|closing\s+condition|ticker\s+change|closing\s+update|consummation)\b|\b(?:business\s+combination|redemption|minimum\s+cash|closing\s+condition|ticker\s+change|closing\s+update|consummation)\b[^.\n]{0,240}\b(?:SPAC|de-?SPAC|special\s+purpose\s+acquisition\s+company|blank[- ]check|trust\s+account)\b/i,
  );
}

function inferSpacTransactionKind(parserOutput: ProxyParserOutput): string {
  if (hasProxyText(parserOutput, /\bredemption\s+result\b|\bredeemed\b/i)) return "redemption_result";
  if (hasProxyText(parserOutput, /\bminimum\s+cash\b|\bcash\s+condition\b/i)) return "minimum_cash_condition";
  if (hasProxyText(parserOutput, /\bticker\s+(?:symbol\s+)?(?:change|will\s+change|to\s+trade)\b|\bnew\s+ticker\b/i)) return "ticker_change";
  if (hasProxyText(parserOutput, /\bclosing\s+condition\b|\bcondition\s+to\s+closing\b/i)) return "closing_condition";
  if (hasProxyText(parserOutput, /\bclosed\b|\bclosing\s+update\b|\bconsummation\b/i)) return "closing_update";
  return "business_combination_status";
}

function inferIpoKind(parserOutput: ProxyParserOutput): "traditional" | "spac" {
  const text = [
    parserOutput.summary,
    ...parserOutput.signals.map((signal) => signal.evidence),
    ...parserOutput.facts.proposals.map((proposal) => `${proposal.title} ${proposal.sourceText}`),
  ].filter(Boolean).join(" ");
  return /\bSPAC\b|\bspecial\s+purpose\s+acquisition\s+company\b/i.test(text) ? "spac" : "traditional";
}

function inferListingAction(parserOutput: ProxyParserOutput): string | null {
  const proposal = parserOutput.facts.proposals.find((item) =>
    /\b(?:listing|ipo|initial public|exchange|nasdaq|nyse|nyse american)\b/i.test(
      [item.title, item.category, item.sourceText].filter(Boolean).join(" "),
    ),
  );
  return proposal?.title ?? null;
}

function formatProxyTicker(parserOutput: ProxyParserOutput): string | null {
  const ticker = parserOutput.facts.primaryTicker.ticker;
  const exchange = parserOutput.facts.primaryTicker.exchange;
  if (exchange && ticker) return `${exchange} / ${ticker}`;
  return exchange ?? ticker ?? null;
}

function hasProxyText(parserOutput: ProxyParserOutput, pattern: RegExp): boolean {
  const text = [
    parserOutput.summary,
    ...parserOutput.signals.map((signal) => signal.evidence),
    ...parserOutput.facts.proposals.map((proposal) => `${proposal.title} ${proposal.sourceText}`),
    parserOutput.facts.transaction.voteRequired,
    ...parserOutput.raw.importantBlocks.map((block) => block.text),
  ].filter(Boolean).join(" ");
  return pattern.test(text);
}

function pruneEmptyDisplayFields(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, field]) => {
      if (field === null || field === undefined) return false;
      if (Array.isArray(field) && field.length === 0) return false;
      return true;
    }),
  );
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
