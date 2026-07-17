import {
  buildCurrentFilingIdentity,
  type SecCurrentFilingIdentity,
} from "../common/currentFilingIdentity.ts";
import type { PeriodicParserOutput, PeriodicReportSection } from "./types.ts";

const PERIODIC_REPORTS_FORM_SCOPE = "10-K / 10-Q / 20-F, 10-K/A / 10-Q/A / 20-F/A";
const MAX_ANALYSIS_BLOCKS = 24;
const MAX_ANALYSIS_CHARS = 48_000;
const MAX_BLOCK_CHARS = 4_000;
const MAX_SECTION_BLOCKS = 14;
const MAX_TABLE_BLOCKS = 6;
const MAX_XBRL_BLOCKS = 4;
const MAX_ATTACHMENT_BLOCKS = 3;

export type SecPeriodicReportsPromptInput = {
  filing_package?: Record<string, unknown>;
  parser_output: PeriodicParserOutput;
  filing_excerpt?: string | null;
  market_context?: Record<string, unknown> | null;
  parent_filing_context?: Record<string, unknown> | null;
};

export type SecPeriodicReportsSourceBlock = {
  block_id: string;
  block_type: string;
  label: string | null;
  source: string | null;
  origin: "filing" | "xbrl" | "attachment" | "parent_context" | "market_context";
  priority: number;
  item_number: string | null;
  section_key: string | null;
  document_type: string | null;
  text: string;
};

export type SecPeriodicReportsSourceBlockPromptInput = {
  current_filing: SecCurrentFilingIdentity;
  source_bundle: {
    selection_method: "periodic_report_structure";
    selected_block_count: number;
    selected_text_chars: number;
    omitted_block_count: number;
  };
  cleaned_source_blocks: SecPeriodicReportsSourceBlock[];
};

export function buildSecPeriodicReportsSourceBlockPromptInput(
  input: SecPeriodicReportsPromptInput,
): SecPeriodicReportsSourceBlockPromptInput {
  const parserOutput = input.parser_output;
  const facts = parserOutput.facts;
  const raw = parserOutput.raw || {};
  const normalized = toRecord(raw.normalized_primary_document) || {};
  const currentFiling = buildCurrentFilingIdentity({
    filingPackage: input.filing_package,
    parserOutput: parserOutput as unknown as Record<string, unknown>,
    formFamily: PERIODIC_REPORTS_FORM_SCOPE,
  });
  const candidates: SecPeriodicReportsSourceBlock[] = [];

  addBlock(candidates, {
    block_id: "periodic-report-context",
    block_type: "report_context",
    label: "Periodic report context",
    source: "filing_package",
    origin: "filing",
    priority: 0,
    item_number: null,
    section_key: null,
    document_type: parserOutput.formType,
    text: compactJson({
      form_type: currentFiling.form_type,
      accession_number: parserOutput.accessionNumber,
      company_name: facts.companyName,
      ticker: facts.primaryTicker,
      exchange: facts.exchange,
      reporting_period: facts.reportingPeriod,
      fiscal_year: facts.fiscalYear,
      fiscal_quarter: facts.fiscalQuarter,
      is_amendment: facts.isAmendment,
      source_url: nullableString(raw.source_url),
      published_at: nullableString(raw.published_at),
    }),
  });

  addAmendmentBlock(candidates, parserOutput);
  addContextSnippetBlocks(candidates, parserOutput);
  addSectionBlocks(candidates, facts.sections);
  addTableBlocks(candidates, normalized);
  addXbrlBlocks(candidates, parserOutput);
  addAttachmentBlocks(candidates, input.filing_package);

  if (!hasSubstantiveSourceBlock(candidates)) {
    addFallbackBlocks(candidates, normalized, input.filing_excerpt);
  }

  if (input.parent_filing_context) {
    addBlock(candidates, {
      block_id: "periodic-parent-filing-context",
      block_type: "parent_filing_context",
      label: "Parent filing context",
      source: "integration",
      origin: "parent_context",
      priority: facts.isAmendment ? 2 : 30,
      item_number: null,
      section_key: null,
      document_type: null,
      text: compactJson(input.parent_filing_context),
    });
  }

  if (input.market_context) {
    addBlock(candidates, {
      block_id: "periodic-market-context",
      block_type: "site_market_context",
      label: "Site-provided market context",
      source: "integration",
      origin: "market_context",
      priority: 35,
      item_number: null,
      section_key: null,
      document_type: null,
      text: compactJson(input.market_context),
    });
  }

  const deduped = dedupeBlocks(candidates).sort(compareBlocks);
  const selected = selectWithinBudget(deduped);

  return {
    current_filing: currentFiling,
    source_bundle: {
      selection_method: "periodic_report_structure",
      selected_block_count: selected.length,
      selected_text_chars: selected.reduce((total, block) => total + block.text.length, 0),
      omitted_block_count: Math.max(0, deduped.length - selected.length),
    },
    cleaned_source_blocks: selected,
  };
}

function addContextSnippetBlocks(
  blocks: SecPeriodicReportsSourceBlock[],
  parserOutput: PeriodicParserOutput,
) {
  for (const [index, snippet] of parserOutput.facts.contextSnippets.entries()) {
    addBlock(blocks, {
      block_id: snippet.id,
      block_type: "context_preserving_snippet",
      label: snippet.topic.replace(/_/g, " "),
      source: snippet.source,
      origin: "filing",
      priority: contextSnippetPriority(snippet.topic) + index / 100,
      item_number: snippet.item,
      section_key: snippet.sectionKey,
      document_type: parserOutput.formType,
      text: snippet.text,
    });
  }
}

function contextSnippetPriority(topic: string) {
  if (topic === "company_value_context") return 4;
  if (topic === "financial_results") return 5;
  if (topic === "period_comparison") return 6;
  if (topic === "outlook_and_guidance") return 7;
  if (topic === "liquidity_and_debt") return 8;
  if (topic === "segments_and_drivers") return 9;
  if (topic === "controls_and_accounting") return 11;
  if (topic === "legal_and_regulatory") return 12;
  if (topic === "capital_allocation") return 13;
  return 20;
}

function addAmendmentBlock(blocks: SecPeriodicReportsSourceBlock[], parserOutput: PeriodicParserOutput) {
  const amendment = parserOutput.facts.amendment;
  if (!amendment.isAmendment) return;
  const text = [
    amendment.explanatoryNote,
    ...amendment.sourceEvidence,
  ]
    .filter(Boolean)
    .join("\n\n");
  addBlock(blocks, {
    block_id: "periodic-amendment-scope",
    block_type: "amendment_scope",
    label: "Amendment scope",
    source: "filing_text",
    origin: "filing",
    priority: 1,
    item_number: null,
    section_key: "amendment_scope",
    document_type: parserOutput.formType,
    text,
  });
}

function addSectionBlocks(blocks: SecPeriodicReportsSourceBlock[], sections: PeriodicReportSection[]) {
  const selected = sections
    .map((section, order) => ({ section, order, priority: sectionPriority(section) }))
    .sort((left, right) => left.priority - right.priority || left.order - right.order)
    .slice(0, MAX_SECTION_BLOCKS);

  for (const { section, order, priority } of selected) {
    addBlock(blocks, {
      block_id: stableBlockId("periodic-section", section.key || `${section.item}-${order + 1}`),
      block_type: "periodic_report_section",
      label: [section.part, `Item ${section.item}`, section.title].filter(Boolean).join(" - "),
      source: section.source,
      origin: "filing",
      priority,
      item_number: section.item,
      section_key: section.key,
      document_type: null,
      text: section.excerpt,
    });
  }
}

function sectionPriority(section: PeriodicReportSection) {
  const value = `${section.key} ${section.title}`.toLowerCase();
  if (/financial statements|operating and financial review|management.s discussion|results of operations/.test(value)) return 10;
  if (/liquidity|capital resources|going concern|defaults|delinquencies/.test(value)) return 12;
  if (/controls and procedures|internal control|certifying accountant/.test(value)) return 14;
  if (/legal proceedings|financial information/.test(value)) return 16;
  if (/risk factors|key information/.test(value)) return 18;
  if (/business|information on the company|properties/.test(value)) return 20;
  if (/market risk|share repurchase|equity securities|major shareholders|related party/.test(value)) return 22;
  if (/unregistered sales|use of proceeds|material modifications/.test(value)) return 24;
  return 40;
}

function addTableBlocks(blocks: SecPeriodicReportsSourceBlock[], normalized: Record<string, unknown>) {
  const tables = recordArray(normalized.tables)
    .filter((table) => !["layout", "toc", "exhibit_index"].includes(nullableString(table.classification).toLowerCase()))
    .filter((table) => numberValue(table.numericCellCount) > 0)
    .map((table, order) => ({ table, order, priority: tablePriority(table) }))
    .sort((left, right) => left.priority - right.priority || left.order - right.order)
    .slice(0, MAX_TABLE_BLOCKS);

  for (const { table, order, priority } of tables) {
    const rows = recordArray(table.rows)
      .slice(0, 18)
      .map((row) => nullableString(row.text))
      .filter(Boolean);
    const label = nullableString(table.caption) || stringArray(table.typeHints).join(" / ") || `Financial table ${order + 1}`;
    addBlock(blocks, {
      block_id: stableBlockId("periodic-table", `${label}-${order + 1}`),
      block_type: "financial_table",
      label,
      source: "normalized_primary_document.tables",
      origin: "filing",
      priority,
      item_number: null,
      section_key: null,
      document_type: null,
      text: [
        nullableString(table.caption),
        nullableString(table.unitHint) ? `Unit: ${nullableString(table.unitHint)}` : "",
        rows.length ? rows.join("\n") : nullableString(table.text),
        ...stringArray(table.footnotes).slice(0, 4),
      ]
        .filter(Boolean)
        .join("\n"),
    });
  }
}

function tablePriority(table: Record<string, unknown>) {
  const value = [nullableString(table.caption), ...stringArray(table.typeHints), nullableString(table.text).slice(0, 300)]
    .join(" ")
    .toLowerCase();
  if (/statement.*(?:operations|income|earnings)|results of operations/.test(value)) return 8;
  if (/balance sheet|financial position/.test(value)) return 9;
  if (/cash flow/.test(value)) return 10;
  if (/stockholders. equity|shareholders. equity/.test(value)) return 11;
  return 28;
}

function addXbrlBlocks(blocks: SecPeriodicReportsSourceBlock[], parserOutput: PeriodicParserOutput) {
  const grouped = new Map<string, typeof parserOutput.facts.sourcePackage.xbrlFacts>();
  for (const fact of parserOutput.facts.sourcePackage.xbrlFacts) {
    const group = fact.statement || "Other reported XBRL facts";
    const values = grouped.get(group) || [];
    values.push(fact);
    grouped.set(group, values);
  }

  const selectedGroups = Array.from(grouped.entries())
    .map(([statement, facts], order) => ({ statement, facts, order, priority: xbrlPriority(statement) }))
    .sort((left, right) => left.priority - right.priority || left.order - right.order)
    .slice(0, MAX_XBRL_BLOCKS);

  for (const { statement, facts, order, priority } of selectedGroups) {
    const selectedFacts = selectXbrlFactsForPrompt(facts);
    addBlock(blocks, {
      block_id: stableBlockId("periodic-xbrl", `${statement}-${order + 1}`),
      block_type: "xbrl_statement_facts",
      label: statement,
      source: "source_package.xbrlFacts",
      origin: "xbrl",
      priority,
      item_number: null,
      section_key: null,
      document_type: "XBRL",
      text: compactJson(
        selectedFacts.map((fact) => ({
          name: fact.name,
          label: fact.label,
          value: fact.value,
          unit: fact.unitRef,
          period: fact.period,
          statement: fact.statement,
          source_document: fact.sourceDocument,
        })),
      ),
    });
  }
}

function selectXbrlFactsForPrompt(
  facts: PeriodicParserOutput["facts"]["sourcePackage"]["xbrlFacts"],
) {
  const byConcept = new Map<string, typeof facts>();
  for (const fact of facts) {
    const concept = fact.name.split(":").pop()?.toLowerCase() || fact.name.toLowerCase();
    const values = byConcept.get(concept) || [];
    if (!values.some((item) => item.period === fact.period && item.value === fact.value && item.unitRef === fact.unitRef)) {
      values.push(fact);
    }
    byConcept.set(concept, values);
  }

  return Array.from(byConcept.entries())
    .sort(([left], [right]) => xbrlConceptPriority(left) - xbrlConceptPriority(right) || left.localeCompare(right))
    .flatMap(([, values]) =>
      [...values]
        .sort((left, right) => (right.period || "").localeCompare(left.period || ""))
        .slice(0, 2),
    )
    .slice(0, 20);
}

function xbrlConceptPriority(concept: string) {
  if (/revenue|salesrevenuenet/.test(concept)) return 0;
  if (/grossprofit/.test(concept)) return 1;
  if (/operatingincomeloss/.test(concept)) return 2;
  if (/netincomeloss|profitloss/.test(concept)) return 3;
  if (/earningspershare/.test(concept)) return 4;
  if (/cashandcashequivalents/.test(concept)) return 5;
  if (/assets$|liabilities$|stockholdersequity|shareholdersequity/.test(concept)) return 6;
  if (/longtermdebt|shorttermdebt|borrowings/.test(concept)) return 7;
  if (/netcashprovidedbyusedin/.test(concept)) return 8;
  if (/sharesoutstanding|weightedaveragenumberofshares/.test(concept)) return 9;
  return 20;
}

function xbrlPriority(statement: string) {
  const value = statement.toLowerCase();
  if (/operations|income|earnings|profit or loss/.test(value)) return 6;
  if (/balance sheet|financial position/.test(value)) return 7;
  if (/cash flow/.test(value)) return 8;
  if (/equity/.test(value)) return 9;
  return 30;
}

function addAttachmentBlocks(blocks: SecPeriodicReportsSourceBlock[], filingPackage: Record<string, unknown> | undefined) {
  const filing = toRecord(filingPackage);
  const rawPayload = firstRecord(filing.rawPayload, filing.raw_payload);
  const attachments = [
    ...recordArray(rawPayload.attachment_texts),
    ...recordArray(rawPayload.attachmentTexts),
    ...recordArray(rawPayload.attachments),
  ]
    .filter((attachment) => attachmentIsMaterial(attachment))
    .slice(0, MAX_ATTACHMENT_BLOCKS);

  for (const [index, attachment] of attachments.entries()) {
    const type = nullableString(attachment.type || attachment.document_type);
    const filename = nullableString(attachment.filename || attachment.name);
    addBlock(blocks, {
      block_id: stableBlockId("periodic-attachment", `${type}-${filename}-${index + 1}`),
      block_type: "material_attachment",
      label: nullableString(attachment.description || attachment.title) || type || filename || `Attachment ${index + 1}`,
      source: filename || "filing_package.raw_payload",
      origin: "attachment",
      priority: /EX-99/i.test(type) ? 13 : 26,
      item_number: null,
      section_key: null,
      document_type: type || null,
      text: nullableString(attachment.text || attachment.content || attachment.body_text),
    });
  }
}

function attachmentIsMaterial(attachment: Record<string, unknown>) {
  const type = nullableString(attachment.type || attachment.document_type);
  const description = nullableString(attachment.description || attachment.title);
  const text = nullableString(attachment.text || attachment.content || attachment.body_text);
  if (!text) return false;
  if (/EX-(?:31|32|101)|CERTIFICATION|XBRL/i.test(`${type} ${description}`)) return false;
  return /EX-(?:2|10|99)|earnings|results|presentation|investor|material agreement/i.test(`${type} ${description}`);
}

function addFallbackBlocks(
  blocks: SecPeriodicReportsSourceBlock[],
  normalized: Record<string, unknown>,
  filingExcerpt: string | null | undefined,
) {
  const originals = recordArray(normalized.blocks)
    .filter((block) => !["empty_decorative", "signature", "exhibit_index"].includes(nullableString(block.kind)))
    .filter((block) => Boolean(nullableString(block.text)))
    .slice(0, 8);

  for (const [index, block] of originals.entries()) {
    addBlock(blocks, {
      block_id: `periodic-fallback-${index + 1}`,
      block_type: nullableString(block.kind) === "table" ? "financial_table" : "source_excerpt",
      label: `Fallback source block ${index + 1}`,
      source: "normalized_primary_document.blocks",
      origin: "filing",
      priority: 60 + index,
      item_number: null,
      section_key: null,
      document_type: null,
      text: nullableString(block.text),
    });
  }

  if (!originals.length) {
    addBlock(blocks, {
      block_id: "periodic-fallback-excerpt",
      block_type: "source_excerpt",
      label: "Fallback filing excerpt",
      source: "filing_excerpt",
      origin: "filing",
      priority: 70,
      item_number: null,
      section_key: null,
      document_type: null,
      text: nullableString(filingExcerpt),
    });
  }
}

function hasSubstantiveSourceBlock(blocks: SecPeriodicReportsSourceBlock[]) {
  return blocks.some((block) => [
    "context_preserving_snippet",
    "periodic_report_section",
    "financial_table",
    "xbrl_statement_facts",
    "material_attachment",
    "amendment_scope",
  ].includes(block.block_type));
}

function addBlock(blocks: SecPeriodicReportsSourceBlock[], block: SecPeriodicReportsSourceBlock) {
  const text = truncateAtBoundary(normalizeSourceText(block.text), MAX_BLOCK_CHARS);
  if (!text || text === "[]" || text === "{}") return;
  blocks.push({ ...block, text });
}

function selectWithinBudget(blocks: SecPeriodicReportsSourceBlock[]) {
  const selected: SecPeriodicReportsSourceBlock[] = [];
  let chars = 0;
  for (const block of blocks) {
    if (selected.length >= MAX_ANALYSIS_BLOCKS) break;
    if (chars + block.text.length > MAX_ANALYSIS_CHARS && selected.length > 0) continue;
    selected.push(block);
    chars += block.text.length;
  }
  return selected;
}

function compareBlocks(left: SecPeriodicReportsSourceBlock, right: SecPeriodicReportsSourceBlock) {
  return left.priority - right.priority || left.block_id.localeCompare(right.block_id);
}

function dedupeBlocks(blocks: SecPeriodicReportsSourceBlock[]) {
  const seenIds = new Set<string>();
  const seenText = new Set<string>();
  const result: SecPeriodicReportsSourceBlock[] = [];
  for (const block of blocks) {
    const textKey = block.text.slice(0, 500).toLowerCase();
    if (seenIds.has(block.block_id) || seenText.has(textKey)) continue;
    seenIds.add(block.block_id);
    seenText.add(textKey);
    result.push(block);
  }
  return result;
}

function stableBlockId(prefix: string, value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${prefix}-${slug || "source"}`;
}

function normalizeSourceText(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncateAtBoundary(value: string, maxChars: number) {
  if (value.length <= maxChars) return value;
  const window = value.slice(0, maxChars + 1);
  const paragraph = window.lastIndexOf("\n");
  const sentence = Math.max(window.lastIndexOf(". "), window.lastIndexOf("; "));
  const boundary = Math.max(paragraph, sentence);
  const cut = boundary >= maxChars * 0.6 ? boundary + 1 : window.lastIndexOf(" ");
  return `${window.slice(0, Math.max(1, cut)).trim()}...`;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function firstRecord(...values: unknown[]) {
  for (const value of values) {
    const record = toRecord(value);
    if (Object.keys(record).length) return record;
  }
  return {};
}

function recordArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(nullableString).filter(Boolean) : [];
}

function nullableString(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return "";
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && Number.isFinite(Number(value))) return Number(value);
  return 0;
}

function compactJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}
