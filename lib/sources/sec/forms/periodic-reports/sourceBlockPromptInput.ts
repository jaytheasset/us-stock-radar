import {
  buildCurrentFilingIdentity,
  currentFilingIdentityText,
  type SecCurrentFilingIdentity,
} from "../common/currentFilingIdentity.ts";
import type { PeriodicParserOutput } from "./types.ts";

const PERIODIC_REPORTS_FORM_SCOPE = "10-K / 10-Q / 20-F, 10-K/A / 10-Q/A / 20-F/A";

export type SecPeriodicReportsPromptInput = {
  filing_package?: Record<string, unknown>;
  parser_output: PeriodicParserOutput;
  filing_excerpt?: string | null;
  market_context?: Record<string, unknown> | null;
  parent_filing_context?: Record<string, unknown> | null;
};

export type SecPeriodicReportsSourceBlock = {
  block_type: string;
  label: string | null;
  source: string | null;
  text: string;
};

export type SecPeriodicReportsSourceBlockPromptInput = {
  current_filing: SecCurrentFilingIdentity;
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
  const blocks: SecPeriodicReportsSourceBlock[] = [];

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
    text: compactJson({
      parserVersion: parserOutput.parserVersion,
      parserGroup: parserOutput.parserGroup,
      formType: currentFiling.form_type,
      formFamily: currentFiling.form_family,
      accessionNumber: parserOutput.accessionNumber,
      isSupported: parserOutput.isSupported,
      companyName: facts.companyName,
      primaryTicker: facts.primaryTicker,
      exchange: facts.exchange,
      reportingPeriod: facts.reportingPeriod,
      fiscalYear: facts.fiscalYear,
      fiscalQuarter: facts.fiscalQuarter,
      source_url: nullableString(raw.source_url),
      published_at: nullableString(raw.published_at),
      primary_document_url: nullableString(toRecord(input.filing_package)?.primary_document_url),
    }),
  });

  addInventoryBlocks(blocks, parserOutput);
  addPrimaryDocumentBlocks(blocks, normalized);
  addTableBlocks(blocks, normalized);
  addXbrlBlocks(blocks, parserOutput);
  addWarningBlocks(blocks, parserOutput.warnings);

  if (input.parent_filing_context) {
    addBlock(blocks, {
      block_type: "parent_filing_context",
      label: "Site-provided parent filing context",
      source: "integration",
      text: compactJson(input.parent_filing_context),
    });
  }

  if (input.market_context) {
    addBlock(blocks, {
      block_type: "site_market_context",
      label: "Site-provided market context",
      source: "integration",
      text: compactJson(input.market_context),
    });
  }

  if (!hasSourceTextBlock(blocks)) {
    addBlock(blocks, {
      block_type: "source_excerpt",
      label: "Fallback filing excerpt",
      source: "filing_excerpt",
      text: nullableString(input.filing_excerpt),
    });
  }

  return {
    current_filing: currentFiling,
    cleaned_source_blocks: dedupeBlocks(blocks).slice(0, 60),
  };
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function recordArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

function addInventoryBlocks(blocks: SecPeriodicReportsSourceBlock[], parserOutput: PeriodicParserOutput) {
  const sourcePackage = parserOutput.facts.sourcePackage;

  addBlock(blocks, {
    block_type: "document_inventory",
    label: "Document inventory",
    source: "parser_source_inventory",
    text: compactJson(
      sourcePackage.documents.slice(0, 40).map((document) => ({
        sequence: document.sequence,
        type: document.type,
        description: document.description,
        filename: document.filename,
        url: document.url,
        isPrimary: document.isPrimary,
        hasText: document.hasText,
        textCharCount: document.textCharCount,
        textTruncated: document.textTruncated,
        isInlineXbrl: document.isInlineXbrl,
        isMachineReadableXbrl: document.isMachineReadableXbrl,
      })),
    ),
  });

  addBlock(blocks, {
    block_type: "attachment_inventory",
    label: "Attachment inventory",
    source: "parser_source_inventory",
    text: compactJson(
      sourcePackage.attachmentTexts.slice(0, 30).map((attachment) => ({
        sequence: attachment.sequence,
        type: attachment.type,
        description: attachment.description,
        filename: attachment.filename,
        url: attachment.url,
        textCharCount: attachment.textCharCount,
        textTruncated: attachment.textTruncated,
        includedInSourceText: attachment.includedInSourceText,
      })),
    ),
  });
}

function addPrimaryDocumentBlocks(blocks: SecPeriodicReportsSourceBlock[], normalized: Record<string, unknown> | null) {
  recordArray(normalized?.blocks)
    .filter((block) => !["empty_decorative", "signature"].includes(nullableString(block.kind)))
    .filter((block) => Boolean(nullableString(block.text)))
    .slice(0, 28)
    .forEach((block, index) => {
      addBlock(blocks, {
        block_type: nullableString(block.kind) === "table" ? "table_source_block" : "cleaned_source_block",
        label: `Primary document block ${index + 1}`,
        source: "normalized_primary_document.blocks",
        text: nullableString(block.text),
      });
    });
}

function addTableBlocks(blocks: SecPeriodicReportsSourceBlock[], normalized: Record<string, unknown> | null) {
  for (const [index, table] of recordArray(normalized?.tables).slice(0, 12).entries()) {
    const rows = recordArray(table.rows)
      .slice(0, 12)
      .map((row) => nullableString(row.text))
      .filter(Boolean);
    addBlock(blocks, {
      block_type: "table_source_block",
      label: nullableString(table.caption) || `Extracted table ${index + 1}`,
      source: "normalized_primary_document.tables",
      text: [
        nullableString(table.caption),
        nullableString(table.unitHint) ? `Unit: ${nullableString(table.unitHint)}` : "",
        nullableString(table.text),
        rows.length ? rows.join("\n") : "",
        ...stringArray(table.footnotes).slice(0, 4),
      ]
        .filter(Boolean)
        .join("\n"),
    });
  }
}

function addXbrlBlocks(blocks: SecPeriodicReportsSourceBlock[], parserOutput: PeriodicParserOutput) {
  addBlock(blocks, {
    block_type: "xbrl_source_data",
    label: "Selected XBRL source data",
    source: "source_package.xbrlFacts",
    text: compactJson(
      parserOutput.facts.sourcePackage.xbrlFacts.slice(0, 60).map((fact) => ({
        name: fact.name,
        label: fact.label,
        value: fact.value,
        unitRef: fact.unitRef,
        period: fact.period,
        statement: fact.statement,
        sourceDocument: fact.sourceDocument,
      })),
    ),
  });
}

function addWarningBlocks(blocks: SecPeriodicReportsSourceBlock[], warnings: string[]) {
  addBlock(blocks, {
    block_type: "parser_warnings",
    label: "Parser warnings",
    source: "parser",
    text: warnings.join("\n"),
  });
}

function hasSourceTextBlock(blocks: SecPeriodicReportsSourceBlock[]) {
  return blocks.some((block) => ["cleaned_source_block", "table_source_block", "xbrl_source_data", "source_excerpt"].includes(block.block_type));
}

function addBlock(blocks: SecPeriodicReportsSourceBlock[], block: SecPeriodicReportsSourceBlock) {
  const text = compactText(block.text, 5000);
  if (!text || text === "[]" || text === "{}") return;
  blocks.push({
    block_type: block.block_type,
    label: block.label,
    source: block.source,
    text,
  });
}

function dedupeBlocks(blocks: SecPeriodicReportsSourceBlock[]) {
  const seen = new Set<string>();
  const deduped: SecPeriodicReportsSourceBlock[] = [];
  for (const block of blocks) {
    const key = `${block.block_type}:${block.label || ""}:${block.text.slice(0, 240)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(block);
  }
  return deduped;
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

function compactJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function compactText(value: string, max: number) {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 3).trim()}...` : text;
}
