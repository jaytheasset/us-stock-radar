import type { PeriodicDisplayPayload, PeriodicParserOutput, PeriodicReportDisplayType } from "./types";

export const SEC_PERIODIC_REPORTS_DISPLAY_PAYLOAD_VERSION = "periodic_report_display_v1";
const PERIODIC_REPORT_DISPLAY_TYPES = ["generic", "offering_terms", "candidate_special"] as const;
const IPO_KIND_VALUES = ["traditional", "spac"] as const;

export type SecPeriodicReportsDisplayPayloadInput = {
  parser_output: PeriodicParserOutput;
  router_result?: Record<string, unknown> | null;
};

export function buildSecPeriodicReportsDisplayPayload(input: SecPeriodicReportsDisplayPayloadInput): PeriodicDisplayPayload {
  const parserOutput = input.parser_output;
  const routerResult = toRecord(input.router_result) || {};
  const deterministic = toRecord(parserOutput.raw.deterministic_classification) || {};
  const facts = parserOutput.facts;
  const displayType = readDisplayType(routerResult.display_type) || readDisplayType(deterministic.display_type) || "generic";
  const displayVersion = nullableString(routerResult.display_version) || nullableString(deterministic.display_version) || SEC_PERIODIC_REPORTS_DISPLAY_PAYLOAD_VERSION;
  const selectedEventType = nullableString(routerResult.event_type) || nullableString(deterministic.event_type);
  const ipoKind = selectedEventType === "ipo_listing" ? readIpoKind(routerResult.ipo_kind) : null;
  const sourcePackage = facts.sourcePackage;
  const normalizedPrimary = toRecord(parserOutput.raw.normalized_primary_document) || {};
  const normalizedDiagnostics = toRecord(normalizedPrimary.diagnostics) || {};
  const tables = recordArray(normalizedPrimary.tables);

  return {
    display_type: displayType,
    data: {
      version: displayVersion,
      event_type: selectedEventType,
      ipo_kind: ipoKind,
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
      routing: {
        route_case: nullableString(routerResult.route_case),
        confidence: nullableString(routerResult.confidence),
        analysis_llm_needed: booleanOrNull(routerResult.analysis_llm_needed) ?? booleanOrNull(deterministic.analysis_llm_needed),
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
    },
    evidence: collectDisplayEvidence(parserOutput),
    notes: buildDisplayNotes(parserOutput, routerResult, deterministic),
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

function buildDisplayNotes(parserOutput: PeriodicParserOutput, routerResult: Record<string, unknown>, deterministic: Record<string, unknown>) {
  const notes: string[] = [];
  notes.push("Display payload built from source-backed fields and classifier output; analysis LLM should not invent UI fields.");
  const deterministicReason = nullableString(deterministic.reason);
  if (deterministicReason) notes.push(deterministicReason);
  const routingReason = nullableString(routerResult.routing_reason);
  if (routingReason) notes.push(`Router: ${routingReason}`);
  if (parserOutput.warnings.length) notes.push(`Parser warnings: ${parserOutput.warnings.slice(0, 6).join("; ")}`);
  return notes;
}

function readDisplayType(value: unknown): PeriodicReportDisplayType | null {
  const text = nullableString(value);
  return text && PERIODIC_REPORT_DISPLAY_TYPES.includes(text as PeriodicReportDisplayType) ? (text as PeriodicReportDisplayType) : null;
}

function readIpoKind(value: unknown) {
  const text = nullableString(value);
  return text && IPO_KIND_VALUES.includes(text as (typeof IPO_KIND_VALUES)[number]) ? text : null;
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

function booleanOrNull(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
