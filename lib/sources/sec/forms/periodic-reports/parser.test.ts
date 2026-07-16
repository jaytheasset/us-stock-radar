import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { SecPeriodicReportParseInput } from "./parser";
import { parseSecPeriodicReport } from "./parser";
import { APPROVED_SEC_EVENT_TYPES, PERIODIC_REPORTS_PARSER_GROUP } from "./types";

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
  const deterministicClassification = toRecord(parsed.raw.deterministic_classification);
  const deterministicParserPath = Boolean(deterministicClassification?.can_finish_without_llm);
  assert.equal(parsed.raw.parser_assigns_event_type, deterministicParserPath, `${caseName}: parser assigns event type only for deterministic-safe cases`);
  assert.equal(parsed.raw.parser_assigns_score_or_delivery, deterministicParserPath, `${caseName}: parser assigns score/delivery only for deterministic-safe cases`);
  if (deterministicParserPath) {
    assert.equal(deterministicClassification?.event_type, "other", `${caseName}: deterministic parser event type`);
    assert.ok(APPROVED_SEC_EVENT_TYPES.includes(String(deterministicClassification?.event_type) as (typeof APPROVED_SEC_EVENT_TYPES)[number]), `${caseName}: deterministic approved event type`);
    assert.equal(deterministicClassification?.display_type, "generic", `${caseName}: deterministic display type`);
    assert.equal(deterministicClassification?.derived_delivery_level, "archive", `${caseName}: deterministic delivery`);
    assert.equal(deterministicClassification?.analysis_llm_needed, false, `${caseName}: deterministic skips analysis LLM`);
  }
  assert.deepEqual(parsed.signals, [], `${caseName}: parser leaves event signals for analysis`);
  assert.equal(hasOwn(parsed.facts, "dominantParserEventType"), false, `${caseName}: no parser event ranking`);
  assert.equal(hasOwn(parsed.facts, "deterministicConclusion"), false, `${caseName}: no parser score conclusion`);
  if (!deterministicParserPath) assert.equal(JSON.stringify(parsed).includes('"event_type"'), false, `${caseName}: no event_type field in non-deterministic parser output`);

  assertExpectedFact(parsed.facts.companyName, expected.parser_output.facts.companyName, `${caseName}: company`);
  assertExpectedFact(parsed.facts.primaryTicker, expected.parser_output.facts.primaryTicker, `${caseName}: ticker`);
  assertExpectedFact(parsed.facts.exchange, expected.parser_output.facts.exchange, `${caseName}: exchange`);
  assertExpectedFact(parsed.facts.reportingPeriod, expected.parser_output.facts.reportingPeriod, `${caseName}: reporting period`);
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
  const deterministicClassification = toRecord(parsed.raw.deterministic_classification);
  const deterministicParserPath = Boolean(deterministicClassification?.can_finish_without_llm);
  assert.equal(parsed.raw.parser_assigns_event_type, deterministicParserPath, `${selectorCase.name}: selector only allows parser event type in deterministic-safe cases`);
  assert.equal(parsed.raw.parser_assigns_score_or_delivery, deterministicParserPath, `${selectorCase.name}: selector only allows parser score/delivery in deterministic-safe cases`);
  if (deterministicParserPath) {
    assert.equal(deterministicClassification?.event_type, "other", `${selectorCase.name}: deterministic selector event type`);
    assert.equal(deterministicClassification?.display_type, "generic", `${selectorCase.name}: deterministic selector display type`);
    assert.equal(deterministicClassification?.derived_delivery_level, "archive", `${selectorCase.name}: deterministic selector delivery`);
    assert.equal(deterministicClassification?.analysis_llm_needed, false, `${selectorCase.name}: deterministic selector skips analysis LLM`);
  }
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
