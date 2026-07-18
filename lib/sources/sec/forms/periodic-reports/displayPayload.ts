import type { PeriodicDisplayPayload, PeriodicParserOutput } from "./types.ts";
import { clipPeriodicDisplayText, fitPeriodicNarrativeText } from "./uiNormalization.ts";

export const SEC_PERIODIC_REPORTS_DISPLAY_PAYLOAD_VERSION = "periodic_report_display_v2";

export type SecPeriodicReportsDisplayPayloadInput = {
  parser_output: PeriodicParserOutput;
  analysis_output?: Record<string, unknown> | null;
};

export function buildSecPeriodicReportsDisplayPayload(input: SecPeriodicReportsDisplayPayloadInput): PeriodicDisplayPayload {
  const parserOutput = input.parser_output;
  const analysisOutput = toRecord(input.analysis_output) || {};
  const reportUi = toRecord(analysisOutput.report_ui);
  const amendmentUi = toRecord(analysisOutput.amendment_ui);
  const facts = parserOutput.facts;
  const displayType = amendmentUi && hasPeriodicAmendmentUiContent(amendmentUi)
    ? "periodic_amendment"
    : reportUi && hasPeriodicReportUiContent(reportUi)
      ? "periodic_report"
      : "generic";
  const displayVersion = SEC_PERIODIC_REPORTS_DISPLAY_PAYLOAD_VERSION;
  const selectedEventType = nullableString(analysisOutput.event_type);
  const sourcePackage = facts.sourcePackage;
  const normalizedPrimary = toRecord(parserOutput.raw.normalized_primary_document) || {};
  const normalizedDiagnostics = toRecord(normalizedPrimary.diagnostics) || {};
  const tables = recordArray(normalizedPrimary.tables);

  return {
    display_type: displayType,
    data: {
      version: displayVersion,
      event_type: selectedEventType,
      ipo_kind: null,
      form_type: parserOutput.formType,
      accession_number: parserOutput.accessionNumber,
      company_name: facts.companyName,
      primary_ticker: {
        ticker: facts.primaryTicker,
        exchange: facts.exchange,
      },
      reporting_period: facts.reportingPeriod,
      fiscal_year: facts.fiscalYear,
      fiscal_quarter: facts.fiscalQuarter,
      is_amendment: facts.isAmendment,
      amendment: {
        number: facts.amendment.amendmentNumber,
        explanatory_note: facts.amendment.explanatoryNote,
        amended_items: facts.amendment.amendedItems,
        parent_accession_number: facts.amendment.parentAccessionNumber,
        original_filing_date: facts.amendment.originalFilingDate,
      },
      analysis: {
        analysis_llm_needed: true,
      },
      source_inventory: {
        document_count: sourcePackage.documentCount,
        attachment_text_count: sourcePackage.attachmentTextCount,
        xbrl_fact_count: sourcePackage.xbrlFactCount,
        retained_xbrl_fact_count: sourcePackage.retainedXbrlFactCount,
        has_primary_document: sourcePackage.hasPrimaryDocument,
        has_inline_xbrl_document: sourcePackage.hasInlineXbrlDocument,
        has_machine_readable_xbrl_document: sourcePackage.hasMachineReadableXbrlDocument,
        has_truncated_source: sourcePackage.hasTruncatedSource,
      },
      normalized_primary_document: {
        parser: nullableString(normalizedDiagnostics.parser),
        visible_chars: numberOrNull(normalizedDiagnostics.visibleChars),
        block_count: numberOrNull(normalizedDiagnostics.blockCount),
        table_block_count: numberOrNull(normalizedDiagnostics.tableBlockCount),
        extracted_table_count: numberOrNull(normalizedDiagnostics.extractedTableCount),
        inline_xbrl_visible_mention_count: numberOrNull(normalizedDiagnostics.inlineXbrlVisibleMentionCount),
      },
      table_summary: tables.slice(0, 20).map((table) => ({
        classification: nullableString(table.classification),
        confidence: nullableString(table.confidence),
        type_hints: stringArray(table.typeHints),
        caption: nullableString(table.caption),
        unit_hint: nullableString(table.unitHint),
        row_count: numberOrNull(table.rowCount),
        column_count: numberOrNull(table.columnCount),
        numeric_cell_count: numberOrNull(table.numericCellCount),
      })),
      parser_warnings: parserOutput.warnings,
      ...(reportUi ? normalizeReportUiForDisplay(reportUi) : {}),
      ...(amendmentUi ? normalizeAmendmentUiForDisplay(amendmentUi) : {}),
    },
    evidence: collectDisplayEvidence(parserOutput),
    notes: buildDisplayNotes(parserOutput),
  };
}

function hasPeriodicReportUiContent(reportUi: Record<string, unknown>) {
  return Boolean(
    nullableString(reportUi.snapshot_intro) ||
      recordArray(reportUi.snapshot_metrics).length ||
      recordArray(reportUi.performance_comparisons).length ||
      recordArray(reportUi.key_business_updates).length,
  );
}

function hasPeriodicAmendmentUiContent(amendmentUi: Record<string, unknown>) {
  return Boolean(
    nullableString(amendmentUi.snapshot_intro) ||
      recordArray(amendmentUi.snapshot_metrics).length ||
      recordArray(amendmentUi.changed_metrics).length ||
      recordArray(amendmentUi.change_details).length,
  );
}

function normalizeReportUiForDisplay(reportUi: Record<string, unknown>) {
  return {
    snapshot_intro: clipPeriodicDisplayText(reportUi.snapshot_intro, 200) || null,
    snapshot_metrics: recordArray(reportUi.snapshot_metrics).slice(0, 4).map((item) => ({
      ...item,
      label: clipPeriodicDisplayText(item.label, 36),
      value: clipPeriodicDisplayText(item.value, 64),
      note: clipPeriodicDisplayText(item.note, 80) || null,
    })),
    performance_comparisons: recordArray(reportUi.performance_comparisons).slice(0, 3).map((item) => ({
      ...item,
      label: clipPeriodicDisplayText(item.label, 48),
      current_label: clipPeriodicDisplayText(item.current_label, 24),
      current_value: clipPeriodicDisplayText(item.current_value, 32),
      comparison_label: clipPeriodicDisplayText(item.comparison_label, 24),
      comparison_value: clipPeriodicDisplayText(item.comparison_value, 32),
      change_note: clipPeriodicDisplayText(item.change_note, 64) || null,
    })),
    guidance_metrics: recordArray(reportUi.guidance_metrics).slice(0, 3).map((item) => ({
      ...item,
      label: clipPeriodicDisplayText(item.label, 48),
      guidance_label: clipPeriodicDisplayText(item.guidance_label, 32),
      guidance_value: clipPeriodicDisplayText(item.guidance_value, 48),
      performance_label: clipPeriodicDisplayText(item.performance_label, 48) || null,
      note: clipPeriodicDisplayText(item.note, 80) || null,
    })),
    key_business_updates: recordArray(reportUi.key_business_updates).slice(0, 3).map((item) => ({
      ...item,
      title: clipPeriodicDisplayText(item.title, 64),
      value: clipPeriodicDisplayText(item.value, 64) || null,
      summary: fitPeriodicNarrativeText(item.summary, 180),
    })),
  };
}

function normalizeAmendmentUiForDisplay(amendmentUi: Record<string, unknown>) {
  return {
    amendment_type: nullableString(amendmentUi.amendment_type),
    parent_accession_number: nullableString(amendmentUi.parent_accession_number),
    affected_period: nullableString(amendmentUi.affected_period),
    snapshot_intro: clipPeriodicDisplayText(amendmentUi.snapshot_intro, 200) || null,
    snapshot_metrics: recordArray(amendmentUi.snapshot_metrics).slice(0, 4).map((item) => ({
      label: clipPeriodicDisplayText(item.label, 36),
      value: clipPeriodicDisplayText(item.value, 64),
      note: clipPeriodicDisplayText(item.note, 80) || null,
    })),
    amended_items: stringArray(amendmentUi.amended_items).slice(0, 6),
    financial_statements_changed: amendmentUi.financial_statements_changed === true,
    changed_metrics: recordArray(amendmentUi.changed_metrics).slice(0, 3).map((item) => ({
      label: clipPeriodicDisplayText(item.label, 48),
      previous_value: clipPeriodicDisplayText(item.previous_value, 40) || null,
      amended_value: clipPeriodicDisplayText(item.amended_value, 40) || null,
      change_summary: clipPeriodicDisplayText(item.change_summary, 140),
    })),
    change_details: recordArray(amendmentUi.change_details).slice(0, 4).map((item) => ({
      title: clipPeriodicDisplayText(item.title, 64),
      value: clipPeriodicDisplayText(item.value, 80) || null,
      note: clipPeriodicDisplayText(item.note, 180),
    })),
    accounting_or_control_impact: clipPeriodicDisplayText(amendmentUi.accounting_or_control_impact, 220) || null,
    investor_impact: clipPeriodicDisplayText(amendmentUi.investor_impact, 260) || null,
  };
}

function collectDisplayEvidence(parserOutput: PeriodicParserOutput) {
  const facts = parserOutput.facts;
  return uniqueStrings([
    ...facts.highValueEvidence.map((item) => item.evidence),
    ...facts.amendment.sourceEvidence,
    ...facts.rawDataAudit.mustHaveChecks.map((check) => check.evidence || ""),
  ]).slice(0, 12);
}

function buildDisplayNotes(parserOutput: PeriodicParserOutput) {
  const notes: string[] = [];
  notes.push("Display payload built from source-backed parser fields; analysis LLM should not invent UI fields.");
  if (parserOutput.warnings.length) notes.push(`Parser warnings: ${parserOutput.warnings.slice(0, 6).join("; ")}`);
  return notes;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function recordArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

function nullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberOrNull(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
