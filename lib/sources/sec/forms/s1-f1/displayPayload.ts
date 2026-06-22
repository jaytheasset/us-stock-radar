import type { S1F1DisplayPayload, S1F1ParserOutput, S1F1RouterDecision } from "./types.ts";

export function buildS1F1DisplayPayload(
  parserOutput: S1F1ParserOutput,
  routerDecision: S1F1RouterDecision,
): S1F1DisplayPayload {
  const displayType = routerDecision.display_type ?? (parserOutput.facts.offering.kind === "unknown" ? "generic" : "offering_terms");
  const displayVersion = routerDecision.display_version ?? "s1-f1-display-v1";
  const evidence = parserOutput.signals.flatMap((signal) => signal.evidence.map((item) => item.excerpt)).slice(0, 12);
  const baseData = {
    filing: parserOutput.facts.filing,
    company_name: parserOutput.facts.company_name,
    ticker: parserOutput.facts.ticker,
    exchange: parserOutput.facts.exchange,
    registration_kind: parserOutput.facts.registration_kind,
    source_inventory: {
      sourceTextLength: parserOutput.raw.sourceTextLength,
      attachmentNames: parserOutput.raw.attachmentNames,
      mainDocument: parserOutput.raw.documentFilter?.mainDocument ?? null,
      importantExhibitCount: parserOutput.raw.documentFilter?.importantExhibitCount ?? 0,
    },
  };

  if (displayType === "offering_terms") {
    return {
      display_type: "offering_terms",
      display_version: displayVersion,
      data: {
        ...baseData,
        ...(routerDecision.event_type === "ipo_listing" ? { ipo_kind: parserOutput.facts.offering.ipo_kind ?? "traditional" } : {}),
        offering: parserOutput.facts.offering,
        offering_terms: parserOutput.raw.sectionExtractions?.offeringTerms ?? null,
        use_of_proceeds: parserOutput.raw.sectionExtractions?.useOfProceeds ?? null,
        capitalization: parserOutput.raw.sectionExtractions?.capitalization ?? null,
        dilution: parserOutput.raw.sectionExtractions?.dilution ?? null,
        exhibit_summary: {
          exhibitIndexItems: parserOutput.raw.exhibitExtractions?.exhibitIndex.items.length ?? 0,
          attachedExhibits: parserOutput.raw.exhibitExtractions?.attachedExhibits.length ?? 0,
          consistencyHints: parserOutput.raw.exhibitExtractions?.consistencyHints ?? [],
        },
      },
      evidence,
      notes: parserOutput.warnings.slice(0, 12),
    };
  }

  if (displayType === "candidate_special") {
    return {
      display_type: "candidate_special",
      display_version: displayVersion,
      data: {
        ...baseData,
        risks: parserOutput.facts.risks,
        risk_factors: parserOutput.raw.riskFactors ?? null,
        selected_sections: parserOutput.raw.sectionDetection?.sections.map((section) => section.key) ?? [],
      },
      evidence,
      notes: parserOutput.warnings.slice(0, 12),
    };
  }

  if (displayType === "spac_transaction_status") {
    const spac = parserOutput.raw.spacTransactionStatus;
    return {
      display_type: "spac_transaction_status",
      display_version: displayVersion,
      data: {
        ...baseData,
        current_stage: spac?.current_stage ?? null,
        current_stage_label: spac?.current_stage_label ?? null,
        deal_status: spac?.deal_status ?? null,
        stage_summary: spac?.stage_summary ?? null,
        stages: spac?.stages ?? [],
        target_company: spac?.target_company ?? null,
        target_summary: spac?.target_summary ?? null,
        expected_ticker: spac?.expected_ticker ?? null,
        deal_value: spac?.deal_value ?? null,
        announced_date: spac?.announced_date ?? null,
        sponsor: spac?.sponsor ?? null,
        ipo_date: spac?.ipo_date ?? null,
        ipo_year: spac?.ipo_year ?? null,
        unit_right_warrant_terms: spac?.unit_right_warrant_terms ?? null,
        redemption_rate: spac?.redemption_rate ?? null,
        trust_cash_before: spac?.trust_cash_before ?? null,
        trust_cash_after: spac?.trust_cash_after ?? null,
        redemption_price: spac?.redemption_price ?? null,
        public_shares_remaining: spac?.public_shares_remaining ?? null,
        min_cash_condition: spac?.min_cash_condition ?? null,
        min_cash_status: spac?.min_cash_status ?? null,
        float_impact: spac?.float_impact ?? null,
        closing_date: spac?.closing_date ?? null,
        ticker_change_date: spac?.ticker_change_date ?? null,
        risk_flags: spac?.risk_flags ?? [],
        watch_next: spac?.watch_next ?? [],
        sources: spac?.sources ?? [],
        event_history: spac?.event_history ?? [],
      },
      evidence: [...evidence, ...(spac?.sources.map((item) => item.excerpt) ?? [])].slice(0, 16),
      notes: [...parserOutput.warnings, ...(spac?.warnings ?? [])].slice(0, 12),
    };
  }

  return {
    display_type: "generic",
    display_version: displayVersion,
    data: {
      ...baseData,
      signals: parserOutput.signals.map((signal) => ({
        event_type: signal.event_type,
        label: signal.label,
        severity: signal.severity,
        signal: signal.signal,
      })),
      deterministic: parserOutput.raw.deterministic ?? null,
    },
    evidence,
    notes: parserOutput.warnings.slice(0, 12),
  };
}
