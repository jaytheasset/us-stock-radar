import type { SecFormCleanedSourceBlock } from "./parserContract";
import {
  buildCurrentFilingIdentity,
  currentFilingIdentityText,
  type SecCurrentFilingIdentity,
} from "./currentFilingIdentity.ts";

export type SecCleanedSourceBlock = SecFormCleanedSourceBlock & {
  label: string | null;
  source: string | null;
};

export type SecSourceBlockPromptInput = {
  current_filing: SecCurrentFilingIdentity;
  cleaned_source_blocks: SecCleanedSourceBlock[];
};

const DEFAULT_BLOCK_LIMIT = 60;
const DEFAULT_BLOCK_CHAR_LIMIT = 5_000;

const JUDGMENT_KEY_PATTERN =
  /(?:^|_)(?:facts?|signals?|signal|event_type|display_type|route_hint|routing|classification|classifier|score|delivery|impact|bullish|bearish|suggested|candidate|deterministic|analysis_case)(?:$|_)/i;

export function buildSecSourceBlockPromptInput({
  filingPackage,
  parserOutput,
  fallbackText,
  parentFilingContext,
  marketContext,
  maxBlocks = DEFAULT_BLOCK_LIMIT,
  maxBlockChars = DEFAULT_BLOCK_CHAR_LIMIT,
}: {
  filingPackage?: Record<string, unknown> | null;
  parserOutput?: Record<string, unknown> | null;
  fallbackText?: string | null;
  parentFilingContext?: Record<string, unknown> | null;
  marketContext?: Record<string, unknown> | null;
  maxBlocks?: number;
  maxBlockChars?: number;
}): SecSourceBlockPromptInput {
  const blocks: SecCleanedSourceBlock[] = [];
  const filing = toRecord(filingPackage);
  const parser = toRecord(parserOutput);
  const raw = toRecord(parser.raw);
  const currentFiling = buildCurrentFilingIdentity({
    filingPackage: filing,
    parserOutput: parser,
    formFamily: firstString(parser.formType),
  });

  addBlock(blocks, {
    block_type: "current_filing",
    label: "Current SEC filing identity",
    source: "filing_package",
    text: currentFilingIdentityText(currentFiling),
  });

  addBlock(blocks, {
    block_type: "filing_metadata",
    label: "SEC filing metadata",
    source: "filing_package",
    text: compactJson(
      removeJudgmentKeys({
        form_type: currentFiling.form_type,
        form_family: currentFiling.form_family,
        accession_number: firstString(
          parser.accessionNumber,
          filing.accession_number,
          filing.accessionNumber,
          toRecord(filing.rawPayload).accession_number,
        ),
        company_name: firstString(filing.company_name, filing.companyName, toRecord(filing.rawPayload).company_name),
        ticker: firstString(filing.ticker, toRecord(filing.primary_ticker).ticker),
        exchange: firstString(filing.exchange, toRecord(filing.primary_ticker).exchange),
        filed_at: firstString(filing.filed_at, filing.filedAt, filing.publishedAt, toRecord(filing.rawPayload).filing_date),
        source_url: firstString(filing.source_url, filing.sourceUrl, toRecord(filing.rawPayload).source_url),
        primary_document_url: firstString(
          filing.primary_document_url,
          filing.primaryDocumentUrl,
          toRecord(filing.rawPayload).primary_document_url,
        ),
      }),
    ),
  });

  collectExistingSourceBlocks(raw.cleanedSourceBlocks, blocks, "cleaned_source_block", maxBlockChars);
  collectExistingSourceBlocks(raw.cleaned_source_blocks, blocks, "cleaned_source_block", maxBlockChars);
  collectExistingSourceBlocks(parser.cleaned_source_blocks, blocks, "cleaned_source_block", maxBlockChars);
  collectExistingSourceBlocks(raw.importantBlocks, blocks, "source_block", maxBlockChars);
  collectExistingSourceBlocks(raw.selected_evidence, blocks, "source_evidence", maxBlockChars);
  collectExistingSourceBlocks(raw.selectedEvidenceSnippets, blocks, "source_evidence", maxBlockChars);

  if (!hasSourceContentBlock(blocks)) {
    collectSourceTextCandidate(raw.source_excerpt, blocks, "source_excerpt", "raw.source_excerpt", maxBlockChars);
    collectSourceTextCandidate(raw.source_text, blocks, "source_text", "raw.source_text", maxBlockChars);
    collectSourceTextCandidate(toRecord(raw.source_package).text, blocks, "source_text", "raw.source_package.text", maxBlockChars);
  }

  collectTableBlocks(parser, blocks, maxBlockChars);
  collectInventoryBlocks({ filing, parser, raw, parentFilingContext, marketContext, blocks, maxBlockChars });

  if (!hasSourceContentBlock(blocks)) {
    collectSourceTextCandidate(fallbackText, blocks, "source_excerpt", "filing_package.llm_text", maxBlockChars);
  }

  return {
    current_filing: currentFiling,
    cleaned_source_blocks: dedupeBlocks(blocks).slice(0, maxBlocks),
  };
}

export function removeJudgmentKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(removeJudgmentKeys);
  if (!value || typeof value !== "object") return value;

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (JUDGMENT_KEY_PATTERN.test(key)) continue;
    result[key] = removeJudgmentKeys(item);
  }
  return result;
}

function collectExistingSourceBlocks(
  value: unknown,
  blocks: SecCleanedSourceBlock[],
  defaultType: string,
  maxBlockChars: number,
) {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (typeof item === "string") {
      addBlock(blocks, {
        block_type: defaultType,
        label: null,
        source: null,
        text: item,
      }, maxBlockChars);
      continue;
    }
    const record = toRecord(item);
    const text = firstString(record.text, record.sourceText, record.evidence, record.snippet, record.content);
    if (!text) continue;
    addBlock(blocks, {
      block_type: firstString(record.block_type, record.kind, record.type) || defaultType,
      label: firstString(record.label, record.heading, record.caption, record.title) || null,
      source: firstString(record.source, record.filename, record.documentType, record.document_type) || null,
      text,
    }, maxBlockChars);
  }
}

function hasSourceContentBlock(blocks: SecCleanedSourceBlock[]): boolean {
  return blocks.some((block) => {
    return ![
      "filing_metadata",
      "current_filing",
      "source_inventory",
      "attachment_inventory",
      "document_inventory",
      "parser_warnings",
      "parent_filing_context",
      "site_market_context",
    ].includes(block.block_type);
  });
}

function collectSourceTextCandidate(
  value: unknown,
  blocks: SecCleanedSourceBlock[],
  blockType: string,
  source: string,
  maxBlockChars: number,
) {
  const text = stringValue(value);
  if (!text) return;
  addBlock(blocks, {
    block_type: blockType,
    label: source,
    source,
    text,
  }, maxBlockChars);
}

function collectTableBlocks(parser: Record<string, unknown>, blocks: SecCleanedSourceBlock[], maxBlockChars: number) {
  const raw = toRecord(parser.raw);
  collectExistingSourceBlocks(raw.tableBlocks, blocks, "table_source_block", maxBlockChars);
  collectExistingSourceBlocks(raw.table_blocks, blocks, "table_source_block", maxBlockChars);
  collectExistingSourceBlocks(raw.selectedTableSnippets, blocks, "table_source_block", maxBlockChars);
  collectExistingSourceBlocks(raw.selected_table_snippets, blocks, "table_source_block", maxBlockChars);

  const proxyTables = arrayRecords(toRecord(raw.keyTableExtraction).tables);
  for (const table of proxyTables) {
    addBlock(blocks, {
      block_type: "table_source_block",
      label: firstString(table.heading, table.caption, table.id) || "table",
      source: firstString(table.tableType, table.proposalId) || null,
      text: compactJson(removeJudgmentKeys(table)),
    }, maxBlockChars);
  }

  const normalizedTables = arrayRecords(toRecord(raw.normalized_primary_document).tables);
  for (const table of normalizedTables) {
    addBlock(blocks, {
      block_type: "table_source_block",
      label: firstString(table.caption, table.heading, table.classification) || "table",
      source: "raw.normalized_primary_document.tables",
      text: compactJson(removeJudgmentKeys(table)),
    }, maxBlockChars);
  }
}

function collectInventoryBlocks({
  filing,
  parser,
  raw,
  parentFilingContext,
  marketContext,
  blocks,
  maxBlockChars,
}: {
  filing: Record<string, unknown>;
  parser: Record<string, unknown>;
  raw: Record<string, unknown>;
  parentFilingContext?: Record<string, unknown> | null;
  marketContext?: Record<string, unknown> | null;
  blocks: SecCleanedSourceBlock[];
  maxBlockChars: number;
}) {
  const sourceInventory = firstObject(
    raw.source_inventory,
    raw.sourceInventory,
    toRecord(raw.source_package).raw_data_audit,
  );
  const attachmentInventory = firstArray(
    filing.attachment_inventory,
    filing.attachments,
    raw.attachment_inventory,
    raw.attachmentInventory,
    toRecord(raw.source_package).attachments,
  );
  const documents = firstArray(
    filing.documents,
    toRecord(raw.source_package).documents,
  );
  const warnings = stringArray(parser.warnings);

  if (sourceInventory) {
    addBlock(blocks, {
      block_type: "source_inventory",
      label: "Source inventory",
      source: "parser/raw",
      text: compactJson(removeJudgmentKeys(sourceInventory)),
    }, maxBlockChars);
  }
  if (attachmentInventory.length) {
    addBlock(blocks, {
      block_type: "attachment_inventory",
      label: "Attachment inventory",
      source: "parser/raw",
      text: compactJson(removeJudgmentKeys(attachmentInventory)),
    }, maxBlockChars);
  }
  if (documents.length) {
    addBlock(blocks, {
      block_type: "document_inventory",
      label: "Document inventory",
      source: "parser/raw",
      text: compactJson(removeJudgmentKeys(documents)),
    }, maxBlockChars);
  }
  if (warnings.length) {
    addBlock(blocks, {
      block_type: "parser_warnings",
      label: "Parser warnings",
      source: "parser",
      text: warnings.join("\n"),
    }, maxBlockChars);
  }
  if (parentFilingContext) {
    addBlock(blocks, {
      block_type: "parent_filing_context",
      label: "Parent filing compact context",
      source: "integration",
      text: compactJson(removeJudgmentKeys(parentFilingContext)),
    }, maxBlockChars);
  }
  if (marketContext) {
    addBlock(blocks, {
      block_type: "site_market_context",
      label: "Site-provided market context",
      source: "integration",
      text: compactJson(removeJudgmentKeys(marketContext)),
    }, maxBlockChars);
  }
}

function addBlock(blocks: SecCleanedSourceBlock[], block: SecCleanedSourceBlock, maxBlockChars = DEFAULT_BLOCK_CHAR_LIMIT) {
  const text = compactText(block.text, maxBlockChars);
  if (!text) return;
  blocks.push({
    block_type: block.block_type || "source_block",
    label: block.label || null,
    source: block.source || null,
    text,
  });
}

function dedupeBlocks(blocks: SecCleanedSourceBlock[]) {
  const seen = new Set<string>();
  const result: SecCleanedSourceBlock[] = [];
  for (const block of blocks) {
    const key = `${block.block_type}:${block.label || ""}:${block.text.slice(0, 240)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(block);
  }
  return result;
}

function firstObject(...values: unknown[]) {
  for (const value of values) {
    const record = toRecord(value);
    if (Object.keys(record).length) return record;
  }
  return null;
}

function firstArray(...values: unknown[]) {
  for (const value of values) {
    if (Array.isArray(value) && value.length) return value;
  }
  return [];
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    const text = stringValue(value);
    if (text) return text;
  }
  return "";
}

function compactJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function compactText(value: string, maxChars: number) {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || text === "{}" || text === "[]") return "";
  return text.length > maxChars ? `${text.slice(0, maxChars - 3).trim()}...` : text;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(stringValue).filter(Boolean) : [];
}

function arrayRecords(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function arrayRows(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is unknown[] => Array.isArray(item)) : [];
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return "";
}
