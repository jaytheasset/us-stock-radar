import type {
  NtDisplayPayload,
  NtParserOutput,
  NtRouterDecision,
} from "./types";

export function buildNtDisplayPayload(args: {
  parserOutput: NtParserOutput;
  routerDecision: NtRouterDecision;
}): NtDisplayPayload {
  const { parserOutput, routerDecision } = args;
  const facts = parserOutput.facts;

  return {
    display_type: routerDecision.display_type,
    display_version: routerDecision.display_version,
    data: {
      form_family: "nt",
      source_form_type: facts.sourceFormType,
      body_form_type: facts.bodyFormType,
      delayed_report: facts.delayedReport,
      period_of_report: facts.periodOfReport,
      filed_at: facts.filedAt,
      company_name: facts.companyName,
      ticker: facts.ticker,
      exchange: facts.exchange,
      selected_event_type: routerDecision.event_type,
      is_amendment: facts.isAmendment,
      amendment_purpose: facts.amendmentPurpose,
      is_transition_report: facts.isTransitionReport,
      transition_report_type: facts.transitionReportType,
      transition_period_ended: facts.transitionPeriodEnded,
      late_filing_reason: facts.lateFilingReason,
      anticipated_within_extension: facts.anticipatedWithinExtension,
      unable_without_unreasonable_effort: facts.unableWithoutUnreasonableEffort,
      significant_change_expected: facts.significantChangeExpected,
      significant_change_explanation: facts.partIv.significantChange.explanation,
      significant_change_quantitative_disclosure:
        facts.partIv.significantChange.quantitativeDisclosurePresent,
      other_periodic_reports_filed: facts.otherPeriodicReportsFiled,
      missing_report_explanation: facts.partIv.otherPeriodicReports.explanation,
      missing_report_hints: facts.partIv.otherPeriodicReports.missingReportHints,
      contact: facts.partIv.contact,
      accountant_statement_attached: facts.accountantStatementAttached,
      accountant_statement_text: facts.accountantStatementText,
      portion_only: facts.portionOnly,
      electronic_filing_difficulty: facts.electronicFilingDifficulty,
      parser_warnings: parserOutput.warnings,
      raw_data_quality: facts.rawDataQuality,
      source_url: null,
    },
    evidence: facts.sourceExcerpts.map((excerpt) => excerpt.text),
    notes: [
      "Display payload was built from source-backed fields and router/classifier output, not analysis LLM output.",
    ],
  };
}
