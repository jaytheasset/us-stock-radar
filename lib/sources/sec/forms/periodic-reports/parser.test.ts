import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { SecPeriodicReportParseInput } from "./parser.ts";
import { parseSecPeriodicReport } from "./parser.ts";
import { PERIODIC_REPORTS_PARSER_GROUP } from "./types.ts";

const originalFetch = globalThis.fetch;
globalThis.fetch = (() => {
  throw new Error("Parser fixture tests must not call live network");
}) as typeof fetch;

type Fixture = {
  filing: SecPeriodicReportParseInput;
};

type ParserExpected = {
  parser_output: {
    parserVersion: string;
    parserGroup: string;
    formType: string;
    accessionNumber: string | null;
    isSupported: boolean;
    facts: {
      companyName?: string | null;
      primaryTicker?: string | null;
      exchange?: string | null;
      reportingPeriod?: string | null;
      fiscalYear?: string | null;
      fiscalQuarter?: string | null;
      isAmendment?: boolean;
    };
  };
  expected_raw_extraction: {
    missing_critical_raw_data: boolean;
    has_noise_candidates: boolean;
    min_section_count: number;
    min_financial_statement_lines: number;
    min_document_count?: number;
    min_attachment_text_count?: number;
    min_xbrl_fact_count?: number;
    max_xbrl_fact_count?: number;
    section_keys_present: string[];
    coverage_ids_present: string[];
    evidence_categories_present: string[];
    evidence_labels_present: string[];
    noise_categories_present: string[];
    warnings_include?: string[];
    warnings_exclude?: string[];
    missing_source_ids_present?: string[];
    xbrl_fact_names_present?: string[];
    document_filenames_present?: string[];
    attachment_filenames_present?: string[];
  };
};

type SelectorFixture = {
  cases: Array<{
    name: string;
    filing: SecPeriodicReportParseInput;
  }>;
};

type SelectorExpected = {
  cases: Array<{
    name: string;
    primary: {
      type: string;
      filename?: string | null;
    };
    formType: string;
    isAmendment?: boolean;
    min_section_count?: number;
    not_primary_filenames?: string[];
    warnings_include?: string[];
    warnings_exclude?: string[];
  }>;
};

type NormalizerFixture = {
  cases: Array<{
    name: string;
    filing: SecPeriodicReportParseInput;
  }>;
};

type NormalizerExpected = {
  cases: Array<{
    name: string;
    visible_contains?: string[];
    visible_order?: string[];
    visible_excludes?: string[];
    block_kinds_present?: string[];
    inline_xbrl_mentions?: Array<{
      name: string;
      visibleText: string;
    }>;
    inline_xbrl_names_exclude?: string[];
    min_table_blocks?: number;
    min_layout_table_blocks?: number;
    max_visible_chars?: number;
    warnings_include?: string[];
    warnings_exclude?: string[];
  }>;
};

type TableExtractorFixture = {
  cases: Array<{
    name: string;
    filing: SecPeriodicReportParseInput;
  }>;
};

type TableExtractorExpected = {
  cases: Array<{
    name: string;
    min_tables?: number;
    warnings_include?: string[];
    table: {
      classification?: string;
      type_hints_include?: string[];
      min_row_count?: number;
      min_column_count?: number;
      max_column_count?: number;
      header_like_rows_min?: number;
      numeric_cell_min?: number;
      empty_cell_min?: number;
      cell_texts_include?: string[];
      cell_spans_include?: Array<{
        text: string;
        rowSpan: number;
        colSpan: number;
      }>;
      inline_xbrl_mentions?: Array<{
        name: string;
        visibleText: string;
      }>;
      caption_contains?: string;
      unit_hint_contains?: string;
      footnotes_include?: string[];
      warnings_include?: string[];
    };
  }>;
};

const roomDir = join(process.cwd(), "lib", "sources", "sec", "forms", "periodic-reports");

const cases = [
  "parser-10q-standard",
  "parser-10qa-xbrl-only-amendment",
  "parser-20f-fpi",
  "parser-risk-heavy-10k",
  "parser-sec-html-inline-xbrl",
  "parser-real-aapl-10q-source-package",
  "parser-real-wit-20f-source-package",
  "parser-real-neom-10qa-amendment-source-package",
  "parser-incomplete-missing-xbrl",
];

for (const caseName of cases) {
  const fixture = readJson<Fixture>(join(roomDir, "fixtures", `${caseName}.json`));
  const expected = readJson<ParserExpected>(join(roomDir, "expected", `${caseName}.expected.json`));
  const parsed = parseSecPeriodicReport(fixture.filing);

  assert.equal(parsed.parserVersion, expected.parser_output.parserVersion, `${caseName}: parser version`);
  assert.equal(parsed.parserGroup, PERIODIC_REPORTS_PARSER_GROUP, `${caseName}: parser group constant`);
  assert.equal(parsed.parserGroup, expected.parser_output.parserGroup, `${caseName}: expected parser group`);
  assert.equal(parsed.formType, expected.parser_output.formType, `${caseName}: form type`);
  assert.equal(parsed.accessionNumber, expected.parser_output.accessionNumber, `${caseName}: accession`);
  assert.equal(parsed.isSupported, expected.parser_output.isSupported, `${caseName}: supported form`);
  assert.equal(parsed.raw.market_context_used, false, `${caseName}: parser must not use live or fixture market context`);
  assert.equal(parsed.raw.parser_assigns_event_type, false, `${caseName}: parser never assigns event type`);
  assert.equal(parsed.raw.parser_assigns_score_or_delivery, false, `${caseName}: parser never assigns score or delivery`);
  assert.equal(parsed.raw.processing_path, "parser_analysis", `${caseName}: parser always hands off to analysis`);
  assert.equal(hasOwn(parsed.raw, "deterministic_classification"), false, `${caseName}: no deterministic parser classification`);
  assert.equal(hasOwn(parsed, "signals"), false, `${caseName}: parser omits legacy event signals`);
  assert.equal(hasOwn(parsed, "summary"), false, `${caseName}: parser omits legacy extraction summary`);
  assert.equal(hasOwn(parsed, "calendarItems"), false, `${caseName}: parser leaves calendar output to analysis`);
  assert.equal(hasOwn(parsed.facts, "dominantParserEventType"), false, `${caseName}: no parser event ranking`);
  assert.equal(hasOwn(parsed.facts, "deterministicConclusion"), false, `${caseName}: no parser score conclusion`);
  assert.equal(JSON.stringify(parsed).includes('"event_type"'), false, `${caseName}: no event_type field in parser output`);

  assertExpectedFact(parsed.facts.companyName, expected.parser_output.facts.companyName, `${caseName}: company`);
  assertExpectedFact(parsed.facts.primaryTicker, expected.parser_output.facts.primaryTicker, `${caseName}: ticker`);
  assertExpectedFact(parsed.facts.exchange, expected.parser_output.facts.exchange, `${caseName}: exchange`);
  assertExpectedFact(parsed.facts.reportingPeriod, expected.parser_output.facts.reportingPeriod, `${caseName}: reporting period`);
  assertExpectedFact(parsed.facts.fiscalYear, expected.parser_output.facts.fiscalYear, `${caseName}: fiscal year`);
  assertExpectedFact(parsed.facts.fiscalQuarter, expected.parser_output.facts.fiscalQuarter, `${caseName}: fiscal quarter`);
  assertExpectedFact(parsed.facts.isAmendment, expected.parser_output.facts.isAmendment, `${caseName}: amendment`);

  assert.equal(parsed.facts.rawDataAudit.missingCriticalRawData, expected.expected_raw_extraction.missing_critical_raw_data, `${caseName}: critical raw-data completeness`);
  assert.equal(parsed.facts.rawDataAudit.hasPotentiallyUselessRawData, expected.expected_raw_extraction.has_noise_candidates, `${caseName}: noise candidate flag`);
  assert.ok(parsed.facts.sections.length >= expected.expected_raw_extraction.min_section_count, `${caseName}: section count`);
  assert.ok(parsed.facts.financialStatementLines.length >= expected.expected_raw_extraction.min_financial_statement_lines, `${caseName}: financial line count`);
  if (expected.expected_raw_extraction.min_document_count !== undefined) {
    assert.ok(parsed.facts.sourcePackage.documentCount >= expected.expected_raw_extraction.min_document_count, `${caseName}: source document count`);
  }
  if (expected.expected_raw_extraction.min_attachment_text_count !== undefined) {
    assert.ok(parsed.facts.sourcePackage.attachmentTextCount >= expected.expected_raw_extraction.min_attachment_text_count, `${caseName}: attachment text count`);
  }
  if (expected.expected_raw_extraction.min_xbrl_fact_count !== undefined) {
    assert.ok(parsed.facts.sourcePackage.retainedXbrlFactCount >= expected.expected_raw_extraction.min_xbrl_fact_count, `${caseName}: XBRL fact count`);
    assert.ok(Number(parsed.raw.xbrl_fact_count) >= expected.expected_raw_extraction.min_xbrl_fact_count, `${caseName}: raw XBRL fact count`);
  }
  if (expected.expected_raw_extraction.max_xbrl_fact_count !== undefined) {
    assert.ok(parsed.facts.sourcePackage.retainedXbrlFactCount <= expected.expected_raw_extraction.max_xbrl_fact_count, `${caseName}: max XBRL fact count`);
    assert.ok(Number(parsed.raw.xbrl_fact_count) <= expected.expected_raw_extraction.max_xbrl_fact_count, `${caseName}: raw max XBRL fact count`);
  }

  const sectionKeys = new Set(parsed.facts.sections.map((section) => section.key));
  for (const key of expected.expected_raw_extraction.section_keys_present) {
    assert.ok(sectionKeys.has(key), `${caseName}: section key ${key}`);
  }

  const coverageIds = new Set(parsed.facts.rawDataAudit.mustHaveChecks.map((check) => check.id));
  for (const id of expected.expected_raw_extraction.coverage_ids_present) {
    assert.ok(coverageIds.has(id), `${caseName}: coverage id ${id}`);
  }

  const evidenceCategories = new Set(parsed.facts.highValueEvidence.map((item) => item.category));
  for (const category of expected.expected_raw_extraction.evidence_categories_present) {
    assert.ok(evidenceCategories.has(category), `${caseName}: evidence category ${category}`);
  }

  const evidenceLabels = new Set(parsed.facts.highValueEvidence.map((item) => item.label));
  for (const label of expected.expected_raw_extraction.evidence_labels_present) {
    assert.ok(evidenceLabels.has(label), `${caseName}: evidence label ${label}`);
  }

  const noiseCategories = new Set(parsed.facts.rawDataAudit.noiseCandidates.map((item) => item.category));
  for (const category of expected.expected_raw_extraction.noise_categories_present) {
    assert.ok(noiseCategories.has(category), `${caseName}: noise category ${category}`);
  }

  for (const warning of expected.expected_raw_extraction.warnings_include || []) {
    assert.ok(parsed.warnings.includes(warning), `${caseName}: warning ${warning}`);
  }

  for (const warning of expected.expected_raw_extraction.warnings_exclude || []) {
    assert.equal(parsed.warnings.includes(warning), false, `${caseName}: excluded warning ${warning}`);
  }

  const missingSourceIds = new Set(rawRecordArray(parsed.raw.missing_source).map((item) => String(item.id || "")));
  for (const id of expected.expected_raw_extraction.missing_source_ids_present || []) {
    assert.ok(missingSourceIds.has(id), `${caseName}: missing source id ${id}`);
    assert.ok(parsed.warnings.includes(`missing_source:${id}`) || parsed.warnings.includes(`ambiguous_source:${id}`), `${caseName}: missing source warning ${id}`);
  }

  const xbrlFactNames = new Set(parsed.facts.sourcePackage.xbrlFacts.map((fact) => fact.name));
  for (const name of expected.expected_raw_extraction.xbrl_fact_names_present || []) {
    assert.ok(xbrlFactNames.has(name), `${caseName}: XBRL fact ${name}`);
  }

  const documentFilenames = new Set(parsed.facts.sourcePackage.documents.map((document) => document.filename).filter(Boolean));
  for (const filename of expected.expected_raw_extraction.document_filenames_present || []) {
    assert.ok(documentFilenames.has(filename), `${caseName}: source document ${filename}`);
  }

  const attachmentFilenames = new Set(parsed.facts.sourcePackage.attachmentTexts.map((attachment) => attachment.filename).filter(Boolean));
  for (const filename of expected.expected_raw_extraction.attachment_filenames_present || []) {
    assert.ok(attachmentFilenames.has(filename), `${caseName}: attachment text ${filename}`);
  }
}

const crowdedXbrlFacts: Array<Record<string, unknown>> = Array.from({ length: 220 }, (_, index) => ({
  name: `us-gaap:SyntheticFinancialFact${index + 1}`,
  value: index + 1,
  unitRef: "usd",
  contextRef: `CurrentQuarter${index + 1}`,
  period: "2026-01-01/2026-03-31",
  statement: "Income statement",
}));
crowdedXbrlFacts.push(
  { name: "dei:DocumentFiscalPeriodFocus", value: "Q3", unitRef: null, contextRef: "Document", period: "2026-03-31", statement: "Other reported XBRL facts" },
  { name: "dei:DocumentFiscalYearFocus", value: "2026", unitRef: null, contextRef: "Document", period: "2026-03-31", statement: "Other reported XBRL facts" },
  { name: "dei:DocumentPeriodEndDate", value: "2026-03-31", unitRef: null, contextRef: "Document", period: "2026-03-31", statement: "Other reported XBRL facts" },
  { name: "dei:CurrentFiscalYearEndDate", value: "--06-30", unitRef: null, contextRef: "Document", period: "2026-03-31", statement: "Other reported XBRL facts" },
);
const crowdedXbrlParsed = parseSecPeriodicReport({
  rawItemId: "periodic-crowded-xbrl-period-metadata",
  sourceUniqueId: "0000000000-26-000777",
  title: "Crowded XBRL Corp. Form 10-Q",
  bodyText: "FORM 10-Q For the quarterly period ended March 31, 2026. PART I ITEM 1. Financial Statements. Revenue was $100 million.",
  xbrl_facts: crowdedXbrlFacts,
  rawPayload: { form_type: "10-Q", company_name: "Crowded XBRL Corp." },
});
assert.equal(crowdedXbrlParsed.facts.sourcePackage.retainedXbrlFactCount, 200, "core DEI facts fit within XBRL cap");
assert.equal(crowdedXbrlParsed.facts.fiscalYear, "2026", "DEI fiscal year survives XBRL cap");
assert.equal(crowdedXbrlParsed.facts.fiscalQuarter, "third quarter", "DEI fiscal quarter survives XBRL cap");
for (const concept of ["DocumentFiscalPeriodFocus", "DocumentFiscalYearFocus", "DocumentPeriodEndDate", "CurrentFiscalYearEndDate"]) {
  assert.ok(crowdedXbrlParsed.facts.sourcePackage.xbrlFacts.some((fact) => fact.name.endsWith(concept)), `core DEI fact retained: ${concept}`);
}

const partialDeiDateParsed = parseSecPeriodicReport({
  rawItemId: "periodic-partial-dei-date",
  sourceUniqueId: "0000000000-26-000779",
  title: "Partial DEI Date Ltd. Form 20-F",
  bodyText: "FORM 20-F. A historical disclosure refers to the fiscal year ended December 31, 2021.",
  xbrl_facts: [
    { name: "dei:DocumentFiscalPeriodFocus", value: "FY", contextRef: "Document", period: "2025-01-01/2025-12-31" },
    { name: "dei:DocumentFiscalYearFocus", value: "2025", contextRef: "Document", period: "2025-01-01/2025-12-31" },
    { name: "dei:DocumentPeriodEndDate", value: "December 31", contextRef: "Document", period: "2025-01-01/2025-12-31" },
  ],
  rawPayload: { form_type: "20-F", company_name: "Partial DEI Date Ltd." },
});
assert.equal(
  partialDeiDateParsed.facts.reportingPeriod,
  "December 31, 2025",
  "DEI period context supplies the year when the visible period-end value omits it",
);
assert.equal(
  toRecord(partialDeiDateParsed.raw.fiscal_period_resolution)?.reporting_period_source,
  "xbrl_dei_document_period_end_date",
  "DEI period context remains the authoritative reporting-period source",
);

const unresolvedCalendarQuarter = parseSecPeriodicReport({
  rawItemId: "periodic-no-calendar-quarter-guess",
  sourceUniqueId: "0000000000-26-000778",
  title: "Noncalendar Corp. Form 10-Q",
  bodyText: "FORM 10-Q For the quarterly period ended March 31, 2026. PART I ITEM 1. Financial Statements. Revenue was $100 million.",
  rawPayload: { form_type: "10-Q", company_name: "Noncalendar Corp.", reporting_period: "March 31, 2026" },
});
assert.equal(unresolvedCalendarQuarter.facts.fiscalQuarter, null, "calendar month does not determine fiscal quarter");

const selectorFixture = readJson<SelectorFixture>(join(roomDir, "fixtures", "parser-primary-document-selector.json"));
const selectorExpected = readJson<SelectorExpected>(join(roomDir, "expected", "parser-primary-document-selector.expected.json"));
const selectorExpectedByName = new Map(selectorExpected.cases.map((item) => [item.name, item]));

for (const selectorCase of selectorFixture.cases) {
  const expected = selectorExpectedByName.get(selectorCase.name);
  assert.ok(expected, `${selectorCase.name}: expected selector case`);

  const parsed = parseSecPeriodicReport(selectorCase.filing);
  const primaryDocuments = parsed.facts.sourcePackage.documents.filter((document) => document.isPrimary);

  assert.equal(parsed.formType, expected.formType, `${selectorCase.name}: form type`);
  assert.equal(primaryDocuments.length, 1, `${selectorCase.name}: exactly one primary document`);
  assert.equal(primaryDocuments[0]?.type, expected.primary.type, `${selectorCase.name}: primary type`);
  if (expected.primary.filename !== undefined) {
    assert.equal(primaryDocuments[0]?.filename, expected.primary.filename, `${selectorCase.name}: primary filename`);
  }
  if (expected.isAmendment !== undefined) {
    assert.equal(parsed.facts.isAmendment, expected.isAmendment, `${selectorCase.name}: amendment mode`);
  }
  if (expected.min_section_count !== undefined) {
    assert.ok(parsed.facts.sections.length >= expected.min_section_count, `${selectorCase.name}: selected primary text feeds section parsing`);
  }

  const primaryFilenames = new Set(primaryDocuments.map((document) => document.filename).filter(Boolean));
  for (const filename of expected.not_primary_filenames || []) {
    assert.equal(primaryFilenames.has(filename), false, `${selectorCase.name}: excluded primary filename ${filename}`);
  }
  for (const warning of expected.warnings_include || []) {
    assert.ok(parsed.warnings.includes(warning), `${selectorCase.name}: selector warning ${warning}`);
  }
  for (const warning of expected.warnings_exclude || []) {
    assert.equal(parsed.warnings.includes(warning), false, `${selectorCase.name}: excluded selector warning ${warning}`);
  }
  assert.equal(parsed.raw.parser_assigns_event_type, false, `${selectorCase.name}: selector never assigns event type`);
  assert.equal(parsed.raw.parser_assigns_score_or_delivery, false, `${selectorCase.name}: selector never assigns score or delivery`);
  assert.equal(parsed.raw.processing_path, "parser_analysis", `${selectorCase.name}: selector hands off to analysis`);
  assert.equal(hasOwn(parsed.raw, "deterministic_classification"), false, `${selectorCase.name}: no deterministic selector classification`);
}

const normalizerFixture = readJson<NormalizerFixture>(join(roomDir, "fixtures", "parser-html-normalizer.json"));
const normalizerExpected = readJson<NormalizerExpected>(join(roomDir, "expected", "parser-html-normalizer.expected.json"));
const normalizerExpectedByName = new Map(normalizerExpected.cases.map((item) => [item.name, item]));

for (const normalizerCase of normalizerFixture.cases) {
  const expected = normalizerExpectedByName.get(normalizerCase.name);
  assert.ok(expected, `${normalizerCase.name}: expected normalizer case`);

  const parsed = parseSecPeriodicReport(normalizerCase.filing);
  const normalizedDocument = toRecord(parsed.raw.normalized_primary_document) || {};
  const diagnostics = toRecord(normalizedDocument.diagnostics) || {};
  const blocks = rawRecordArray(normalizedDocument.blocks);
  const inlineMentions = rawRecordArray(normalizedDocument.inline_xbrl_mentions);
  const visibleText = blocks.map((block) => String(block.text || "")).filter(Boolean).join("\n");

  assert.equal(diagnostics.parser, "sec_visible_dom_stream_v1", `${normalizerCase.name}: visible DOM stream parser`);
  assert.ok(blocks.length >= 0, `${normalizerCase.name}: block stream is present`);

  for (const snippet of expected.visible_contains || []) {
    assert.ok(visibleText.includes(snippet), `${normalizerCase.name}: visible text contains ${snippet}`);
  }
  for (const snippet of expected.visible_excludes || []) {
    assert.equal(visibleText.includes(snippet), false, `${normalizerCase.name}: visible text excludes ${snippet}`);
  }
  let lastIndex = -1;
  for (const snippet of expected.visible_order || []) {
    const index = visibleText.indexOf(snippet);
    assert.ok(index >= 0, `${normalizerCase.name}: ordered visible text contains ${snippet}`);
    assert.ok(index > lastIndex, `${normalizerCase.name}: visible text order ${snippet}`);
    lastIndex = index;
  }

  const blockKinds = new Set(blocks.map((block) => String(block.kind || "")));
  for (const kind of expected.block_kinds_present || []) {
    assert.ok(blockKinds.has(kind), `${normalizerCase.name}: block kind ${kind}`);
  }
  if (expected.min_table_blocks !== undefined) {
    assert.ok(blocks.filter((block) => Boolean(block.tableLike)).length >= expected.min_table_blocks, `${normalizerCase.name}: table block count`);
  }
  if (expected.min_layout_table_blocks !== undefined) {
    assert.ok(blocks.filter((block) => Boolean(block.layoutTableLike)).length >= expected.min_layout_table_blocks, `${normalizerCase.name}: layout table block count`);
  }
  if (expected.max_visible_chars !== undefined) {
    assert.ok(Number(diagnostics.visibleChars || 0) <= expected.max_visible_chars, `${normalizerCase.name}: max visible chars`);
  }

  for (const mention of expected.inline_xbrl_mentions || []) {
    assert.ok(
      inlineMentions.some((item) => item.name === mention.name && item.visibleText === mention.visibleText),
      `${normalizerCase.name}: inline XBRL mention ${mention.name}`,
    );
  }
  const inlineNames = new Set(inlineMentions.map((item) => String(item.name || "")));
  for (const name of expected.inline_xbrl_names_exclude || []) {
    assert.equal(inlineNames.has(name), false, `${normalizerCase.name}: hidden inline XBRL name ${name}`);
  }
  for (const warning of expected.warnings_include || []) {
    assert.ok(parsed.warnings.includes(warning), `${normalizerCase.name}: normalizer warning ${warning}`);
  }
  for (const warning of expected.warnings_exclude || []) {
    assert.equal(parsed.warnings.includes(warning), false, `${normalizerCase.name}: excluded normalizer warning ${warning}`);
  }
}

const tableFixture = readJson<TableExtractorFixture>(join(roomDir, "fixtures", "parser-table-extractor.json"));
const tableExpected = readJson<TableExtractorExpected>(join(roomDir, "expected", "parser-table-extractor.expected.json"));
const tableExpectedByName = new Map(tableExpected.cases.map((item) => [item.name, item]));

for (const tableCase of tableFixture.cases) {
  const expected = tableExpectedByName.get(tableCase.name);
  assert.ok(expected, `${tableCase.name}: expected table case`);

  const parsed = parseSecPeriodicReport(tableCase.filing);
  const normalizedDocument = toRecord(parsed.raw.normalized_primary_document) || {};
  const tables = rawRecordArray(normalizedDocument.tables);

  if (expected.min_tables !== undefined) {
    assert.ok(tables.length >= expected.min_tables, `${tableCase.name}: table count`);
  }
  for (const warning of expected.warnings_include || []) {
    assert.ok(parsed.warnings.includes(warning), `${tableCase.name}: parser warning ${warning}`);
  }

  const table = tables[0] || {};
  if (expected.table.classification !== undefined) {
    assert.equal(table.classification, expected.table.classification, `${tableCase.name}: table classification`);
  }
  const typeHints = new Set((Array.isArray(table.typeHints) ? table.typeHints : []).map(String));
  for (const hint of expected.table.type_hints_include || []) {
    assert.ok(typeHints.has(hint), `${tableCase.name}: table type hint ${hint}`);
  }
  if (expected.table.min_row_count !== undefined) assert.ok(Number(table.rowCount || 0) >= expected.table.min_row_count, `${tableCase.name}: row count`);
  if (expected.table.min_column_count !== undefined) assert.ok(Number(table.columnCount || 0) >= expected.table.min_column_count, `${tableCase.name}: column count`);
  if (expected.table.max_column_count !== undefined) assert.ok(Number(table.columnCount || 0) <= expected.table.max_column_count, `${tableCase.name}: max column count`);
  if (expected.table.numeric_cell_min !== undefined) assert.ok(Number(table.numericCellCount || 0) >= expected.table.numeric_cell_min, `${tableCase.name}: numeric cell count`);
  if (expected.table.caption_contains !== undefined) assert.ok(String(table.caption || "").includes(expected.table.caption_contains), `${tableCase.name}: caption`);
  if (expected.table.unit_hint_contains !== undefined) assert.ok(String(table.unitHint || "").toLowerCase().includes(expected.table.unit_hint_contains.toLowerCase()), `${tableCase.name}: unit hint`);

  const rows = rawRecordArray(table.rows);
  const cells = rows.flatMap((row) => rawRecordArray(row.cells));
  const cellTexts = cells.map((cell) => String(cell.text ?? ""));
  const joinedCellText = cellTexts.join("\n");
  for (const snippet of expected.table.cell_texts_include || []) {
    assert.ok(joinedCellText.includes(snippet), `${tableCase.name}: cell text ${snippet}`);
  }
  if (expected.table.empty_cell_min !== undefined) {
    assert.ok(cells.filter((cell) => Boolean(cell.empty)).length >= expected.table.empty_cell_min, `${tableCase.name}: empty cell count`);
  }
  if (expected.table.header_like_rows_min !== undefined) {
    assert.ok(rows.filter((row) => Boolean(row.headerLike)).length >= expected.table.header_like_rows_min, `${tableCase.name}: header-like row count`);
  }
  for (const span of expected.table.cell_spans_include || []) {
    assert.ok(
      cells.some((cell) => cell.text === span.text && Number(cell.rowSpan) === span.rowSpan && Number(cell.colSpan) === span.colSpan),
      `${tableCase.name}: span ${span.text}`,
    );
  }

  const inlineMentions = cells.flatMap((cell) => rawRecordArray(cell.inlineXbrlMentions));
  for (const mention of expected.table.inline_xbrl_mentions || []) {
    assert.ok(
      inlineMentions.some((item) => item.name === mention.name && item.visibleText === mention.visibleText),
      `${tableCase.name}: inline XBRL table mention ${mention.name}`,
    );
  }
  const footnotes = Array.isArray(table.footnotes) ? table.footnotes.map(String) : [];
  for (const footnote of expected.table.footnotes_include || []) {
    assert.ok(footnotes.some((item) => item.includes(footnote)), `${tableCase.name}: footnote ${footnote}`);
  }
  const tableWarnings = Array.isArray(table.warnings) ? table.warnings.map(String) : [];
  for (const warning of expected.table.warnings_include || []) {
    assert.ok(tableWarnings.includes(warning), `${tableCase.name}: table warning ${warning}`);
  }
}

const preservedPrimaryHtml = `
<html><body>
  <div>FORM 10-K</div>
  <div>For the fiscal year ended December 31, 2026</div>
  <div>Parser Regression Corp. (Exact name of registrant as specified in its charter)</div>
  <div>TABLE OF CONTENTS</div>
  <p>ITEM 7. Management's Discussion and Analysis of Financial Condition and Results of Operations</p>
  <p>ITEM 8. Financial Statements and Supplementary Data</p>
  <p>ITEM 1. Business</p>
  <p>The company develops parser regression products.</p>
  <p>ITEM 7. Management's Discussion and Analysis of Financial Condition and Results of Operations</p>
  <p>Revenue increased 65% to $215.9 billion from $130.5 billion, led by Data Center demand.</p>
  <p>Gross margin declined to 71.1% from 75.0% after a $4.5 billion charge.</p>
  <p>ITEM 8. Financial Statements and Supplementary Data</p>
  <p>CONSOLIDATED STATEMENTS OF OPERATIONS</p>
  <table>
    <tr><th>Year ended December 31</th><th>2026</th><th>2025</th></tr>
    <tr><td>Revenue</td><td>215,938</td><td>130,497</td></tr>
    <tr><td>Operating income</td><td>130,387</td><td>81,453</td></tr>
    <tr><td>Net income</td><td>120,067</td><td>72,880</td></tr>
    <tr><td>Diluted earnings per share</td><td>4.90</td><td>2.94</td></tr>
  </table>
  <p>ITEM 9A. Controls and Procedures</p>
  <p>Disclosure controls and procedures were effective.</p>
</body></html>`;

const preservedSourceParsed = parseSecPeriodicReport({
  rawItemId: "periodic-preserved-primary-html",
  sourceUniqueId: "0000000000-26-000001",
  title: "Parser Regression Corp. Form 10-K",
  bodyText: "FORM 10-K\nTABLE OF CONTENTS\nITEM 1. Business\nTruncated before Item 7 and Item 8.",
  rawPayload: {
    form_type: "10-K",
    accession_number: "0000000000-26-000001",
    company_name: "Parser Regression Corp.",
    primary_document_html: preservedPrimaryHtml,
    primary_document_url: "https://www.sec.gov/example.htm",
    documents: [
      {
        sequence: "1",
        type: "10-K",
        description: "Annual report",
        filename: "example.htm",
        isPrimary: true,
        textCharCount: preservedPrimaryHtml.length,
        textTruncated: true,
      },
    ],
  },
});

const preservedStats = toRecord(preservedSourceParsed.raw.source_text_stats) || {};
assert.equal(preservedStats.primary_document_source, "preserved_primary_html", "preserved primary HTML is the parser source");
assert.ok(preservedSourceParsed.facts.sections.some((section) => section.item === "7" && section.excerpt.includes("Revenue increased 65%")), "actual Item 7 beats TOC occurrence");
assert.ok(preservedSourceParsed.facts.sections.some((section) => section.item === "8" && section.charCount > 200), "actual Item 8 is retained");
assert.ok(preservedSourceParsed.facts.contextSnippets.some((snippet) => snippet.text.includes("Gross margin declined")), "context snippets retain surrounding MD&A paragraphs");
assert.ok(preservedSourceParsed.facts.financialStatementLines.some((line) => line.label === "revenue_or_net_sales" && line.evidence.includes("215,938")), "financial statement table rows are extracted");
assert.equal(preservedSourceParsed.facts.financialStatementLines.some((line) => /employee|certification/i.test(line.evidence)), false, "financial lines exclude unrelated numeric prose");

const companyValueParsed = parseSecPeriodicReport({
  rawItemId: "periodic-company-value-context",
  sourceUniqueId: "0000000000-26-000002",
  title: "Company Value Context Corp. Form 10-K",
  bodyText: `
    <html><body>
      <p>FORM 10-K</p>
      <p>Company Value Context Corp.</p>
      <p>As of December 31, 2025, our total market capitalization was approximately $350 million.</p>
      <p>The aggregate market value of common stock held by non-affiliates was approximately $140 million.</p>
      <h1>ITEM 1. BUSINESS</h1>
      <p>We provide software services to enterprise customers.</p>
    </body></html>
  `,
  rawPayload: {
    form_type: "10-K",
    accession_number: "0000000000-26-000002",
    company_name: "Company Value Context Corp.",
  },
});
const companyValueSnippet = companyValueParsed.facts.contextSnippets.find((snippet) => snippet.topic === "company_value_context");
assert.ok(companyValueSnippet?.text.includes("market capitalization was approximately $350 million"), "parser retains explicit filing market cap with context");

const publicFloatOnlyParsed = parseSecPeriodicReport({
  rawItemId: "periodic-public-float-only",
  sourceUniqueId: "0000000000-26-000003",
  title: "Public Float Corp. Form 10-K",
  bodyText: `
    <html><body>
      <p>FORM 10-K</p>
      <p>Public Float Corp.</p>
      <p>The aggregate market value of common stock held by non-affiliates was approximately $350 million.</p>
      <h1>ITEM 1. BUSINESS</h1>
      <p>We provide software services to enterprise customers.</p>
    </body></html>
  `,
  rawPayload: {
    form_type: "10-K",
    accession_number: "0000000000-26-000003",
    company_name: "Public Float Corp.",
  },
});
assert.equal(publicFloatOnlyParsed.facts.contextSnippets.some((snippet) => snippet.topic === "company_value_context"), false, "public float value is not extracted as market cap context");

globalThis.fetch = originalFetch;

console.log("sec periodic reports raw parser fixtures passed");

function assertExpectedFact(actual: unknown, expected: unknown, message: string) {
  if (expected === undefined) return;
  assert.deepEqual(actual, expected, message);
}

function hasOwn(target: object, key: PropertyKey) {
  return Object.prototype.hasOwnProperty.call(target, key);
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function rawRecordArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function toRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
