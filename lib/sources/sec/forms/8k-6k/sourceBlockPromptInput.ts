import {
  buildCurrentFilingIdentity,
  currentFilingIdentityText,
  type SecCurrentFilingIdentity,
} from "../common/currentFilingIdentity.ts";
import { normalizeSecTextEncoding } from "../../htmlEntities.ts";
import {
  contextPreservingChunks,
  stableSourceHash as stableHash,
} from "../common/contextPreservingChunks.ts";

export type SecCleanedSourceBlock = {
  block_id: string;
  block_type: string;
  text: string;
  label: string | null;
  source: string | null;
  source_ref: string | null;
  origin: string;
  priority: number;
  item_number?: string | null;
  exhibit_number?: string | null;
  document_type?: string | null;
  document_reference?: string | null;
  chunk_index?: number | null;
  chunk_count?: number | null;
};

export type SecSourceBlockPromptInput = {
  current_filing: SecCurrentFilingIdentity;
  cleaned_source_blocks: SecCleanedSourceBlock[];
  source_block_bundle: {
    mode: "analysis_deep";
    included_source_block_ids: string[];
    total_available_blocks: number;
    returned_blocks: number;
  };
  source_block_manifest: Array<{
    block_id: string;
    block_type: string;
    label: string | null;
    source_ref: string | null;
    origin: string;
    priority: number;
    item_number?: string | null;
    exhibit_number?: string | null;
    document_type?: string | null;
    document_reference?: string | null;
    chunk_index?: number | null;
    chunk_count?: number | null;
  }>;
};

type SourceBlockDraft = {
  block_type?: string;
  text: string;
  label?: string | null;
  source?: string | null;
  source_ref?: string | null;
  origin?: string;
  priority?: number;
  item_number?: string | null;
  exhibit_number?: string | null;
  document_type?: string | null;
  document_reference?: string | null;
  chunk_index?: number | null;
  chunk_count?: number | null;
};

const DEFAULT_BLOCK_CHAR_LIMIT = 5_000;

const JUDGMENT_KEY_PATTERN =
  /(?:^|_)(?:facts?|signals?|signal|event_type|display_type|route_hint|routing|classification|classifier|score|delivery|impact|bullish|bearish|suggested|candidate|deterministic|analysis_case)(?:$|_)/i;

export function buildSecSourceBlockPromptInput({
  filingPackage,
  parserOutput,
  fallbackText,
  parentFilingContext,
  relatedFilingContexts,
  marketContext,
  includeAmendmentHistoricalSourceBlocks = true,
  maxBlockChars = DEFAULT_BLOCK_CHAR_LIMIT,
}: {
  filingPackage?: Record<string, unknown> | null;
  parserOutput?: Record<string, unknown> | null;
  fallbackText?: string | null;
  parentFilingContext?: Record<string, unknown> | null;
  relatedFilingContexts?: Array<Record<string, unknown>> | null;
  marketContext?: Record<string, unknown> | null;
  includeAmendmentHistoricalSourceBlocks?: boolean;
  maxBlockChars?: number;
}): SecSourceBlockPromptInput {
  const blocks: SecCleanedSourceBlock[] = [];
  const filing = toRecord(filingPackage);
  const parser = toRecord(parserOutput);
  const raw = toRecord(parser.raw);
  const rawPayload = firstObject(filing.rawPayload, filing.raw_payload, raw.rawPayload, raw.raw_payload) || {};
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
  collectParserEvidenceBlocks(parser, blocks, maxBlockChars);
  collectParserUnnumberedSectionBlocks(parser, blocks, maxBlockChars);
  collectDocumentSectionBlocks(fallbackText, blocks, maxBlockChars);
  collectAttachmentTextBlocks(rawPayload.attachment_texts, blocks, maxBlockChars);
  collectAttachmentTextBlocks(rawPayload.attachmentTexts, blocks, maxBlockChars);
  collectAttachmentTextBlocks(rawPayload.attachments, blocks, maxBlockChars);

  if (!hasSourceContentBlock(blocks)) {
    collectSourceTextCandidate(raw.source_excerpt, blocks, "source_excerpt", "raw.source_excerpt", maxBlockChars);
    collectSourceTextCandidate(raw.source_text, blocks, "source_text", "raw.source_text", maxBlockChars);
    collectSourceTextCandidate(toRecord(raw.source_package).text, blocks, "source_text", "raw.source_package.text", maxBlockChars);
    collectSourceTextCandidate(fallbackText, blocks, "source_excerpt", "filing_package.llm_text", Math.min(maxBlockChars, 2_000));
  }

  collectTableBlocks(parser, blocks, maxBlockChars);
  collectContextBlocks({
    parentFilingContext,
    relatedFilingContexts,
    marketContext,
    includeAmendmentHistoricalSourceBlocks,
    blocks,
    maxBlockChars,
  });

  if (!hasSourceContentBlock(blocks)) {
    collectSourceTextCandidate(fallbackText, blocks, "source_excerpt", "filing_package.llm_text", maxBlockChars);
  }

  const deduped = finalizeBlocks(
    removeRedundantSourceBlocks(
      dedupeBlocks(blocks).filter((block) => !isExtractedEvidenceBlock(block.block_type)),
    ),
  );
  const bundled = deduped;

  return {
    current_filing: currentFiling,
    cleaned_source_blocks: bundled,
    source_block_bundle: {
      mode: "analysis_deep",
      included_source_block_ids: bundled.map((block) => block.block_id),
      total_available_blocks: deduped.length,
      returned_blocks: bundled.length,
    },
    source_block_manifest: deduped.map((block) => sourceBlockManifestEntry(block)),
  };
}

function collectParserEvidenceBlocks(parser: Record<string, unknown>, blocks: SecCleanedSourceBlock[], maxBlockChars: number) {
  const facts = toRecord(parser.facts);

  for (const item of arrayRecords(facts.items)) {
    const evidence = firstString(item.evidence, item.text, item.snippet);
    if (!evidence) continue;
    const itemNumber = firstString(item.item, item.itemNumber, item.number);
    const label = [itemNumber ? `Item ${itemNumber}` : "", firstString(item.label, item.title)].filter(Boolean).join(" - ");
    addContextPreservingBlocks(blocks, {
      block_type: "item_section",
      label: label || "8-K item section",
      item_number: itemNumber || null,
      origin: "parser.item_section",
      priority: priorityForItemNumber(itemNumber),
      source: "source_backed_item_sections",
      source_ref: itemNumber ? `Item ${itemNumber}` : null,
      text: evidence,
    }, maxCharsForItemSection(itemNumber, maxBlockChars));
  }
}

function collectParserUnnumberedSectionBlocks(
  parser: Record<string, unknown>,
  blocks: SecCleanedSourceBlock[],
  maxBlockChars: number,
) {
  const facts = toRecord(parser.facts);

  for (const section of arrayRecords(facts.unnumberedSections)) {
    const heading = firstString(section.heading, section.label, section.title);
    const evidence = firstString(section.evidence, section.text, section.snippet);
    if (!heading || !evidence) continue;
    addContextPreservingBlocks(blocks, {
      block_type: "unnumbered_section",
      label: heading,
      origin: "parser.unnumbered_section",
      priority: /introductory\s+note/i.test(heading) ? 96 : 90,
      source: "source_backed_unnumbered_sections",
      source_ref: heading,
      text: evidence,
    }, Math.max(maxBlockChars, 8_000));
  }
}

function collectDocumentSectionBlocks(value: unknown, blocks: SecCleanedSourceBlock[], maxBlockChars: number) {
  const text = stringValue(value);
  if (!/^###\s+/m.test(text)) return;

  const headings: Array<{ title: string; index: number; end: number }> = [];
  const pattern = /^###\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    headings.push({ title: match[1].trim(), index: match.index, end: pattern.lastIndex });
  }

  for (let index = 0; index < Math.min(headings.length, 10); index += 1) {
    const current = headings[index];
    const next = headings[index + 1];
    const body = text.slice(current.end, next ? next.index : undefined).trim();
    if (!body || /^Instrument Term Excerpts$/i.test(current.title)) continue;
    addContextPreservingBlocks(blocks, {
      block_type: "source_document_section",
      label: current.title,
      document_reference: current.title,
      source: "filing_package.llm_text",
      text: `${current.title}\n${body}`,
    }, maxBlockChars);
  }
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
      addContextPreservingBlocks(blocks, {
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
    addContextPreservingBlocks(blocks, {
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

function collectAttachmentTextBlocks(value: unknown, blocks: SecCleanedSourceBlock[], maxBlockChars: number) {
  for (const attachment of arrayRecords(value)) {
    const text = firstString(attachment.text, attachment.sourceText, attachment.rawText);
    if (!text) continue;
    const type = firstString(attachment.type, attachment.documentType);
    const description = firstString(attachment.description, attachment.filename, attachment.name);
    const filename = firstString(attachment.filename, attachment.url, type);
    const label = [type, description].filter(Boolean).join(" - ") || "attachment";
    const exhibitNumber = inferExhibitNumber(`${type} ${description} ${filename}`);
    const documentType = inferDocumentType(`${type} ${description} ${filename}`);
    const roleLabel = attachmentRoleLabel(`${type} ${description} ${filename} ${text.slice(0, 1_000)}`);
    const priority = attachmentPriority({ documentType, exhibitNumber, roleLabel, text });
    const headline = firstMeaningfulLines(text, 4);
    if (headline && comparableSourceText(headline) !== comparableSourceText(text)) {
      addBlock(blocks, {
        block_type: "attachment_headline",
        document_reference: filename || label,
        document_type: documentType,
        exhibit_number: exhibitNumber,
        label: roleLabel ? `${label} - ${roleLabel}` : label,
        origin: "filing_package.attachment",
        priority: Math.max(priority, 82),
        source: filename || type || "attachment",
        source_ref: exhibitNumber ? `Exhibit ${exhibitNumber} headline/source lines` : `${label} headline/source lines`,
        text: headline,
      }, 900);
    }
    addContextPreservingBlocks(blocks, {
      block_type: "attachment_source_block",
      document_reference: filename || label,
      document_type: documentType,
      exhibit_number: exhibitNumber,
      label: roleLabel ? `${label} - ${roleLabel}` : label,
      origin: "filing_package.attachment",
      priority,
      source: filename || type || "attachment",
      source_ref: exhibitNumber ? `Exhibit ${exhibitNumber}` : label,
      text,
    }, maxBlockChars);
  }
}

function collectTableBlocks(parser: Record<string, unknown>, blocks: SecCleanedSourceBlock[], maxBlockChars: number) {
  const raw = toRecord(parser.raw);
  const facts = toRecord(parser.facts);
  const extracted = toRecord(facts.extracted);
  const tableFacts = toRecord(extracted.tableFacts);
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

  const sourceBackedTables = [
    ...arrayRecords(tableFacts.tableLikeBlocks),
    ...arrayRecords(tableFacts.structuredTables),
  ].slice(0, 12);
  for (const table of sourceBackedTables) {
    const text = tableBlockText(table) || compactJson(removeJudgmentKeys(table));
    addBlock(blocks, {
      block_type: "table_source_block",
      label: firstString(table.label, table.tableType) || "table-like source block",
      source: "source_backed_table_samples",
      text,
    }, maxBlockChars);
  }
}

function tableBlockText(table: Record<string, unknown>) {
  const rows = arrayRows(table.rows);
  if (rows.length) {
    return rows
      .slice(0, 10)
      .map((row) => row.map((cell) => stringValue(cell)).filter(Boolean).join(" | "))
      .filter(Boolean)
      .join("\n");
  }

  const lines = stringArray(table.lines);
  if (lines.length) return lines.slice(0, 12).join("\n");

  const directText = firstString(table.text, table.snippet, table.evidence);
  if (directText) return directText;

  return "";
}

function collectContextBlocks({
  parentFilingContext,
  relatedFilingContexts,
  marketContext,
  includeAmendmentHistoricalSourceBlocks,
  blocks,
  maxBlockChars,
}: {
  parentFilingContext?: Record<string, unknown> | null;
  relatedFilingContexts?: Array<Record<string, unknown>> | null;
  marketContext?: Record<string, unknown> | null;
  includeAmendmentHistoricalSourceBlocks: boolean;
  blocks: SecCleanedSourceBlock[];
  maxBlockChars: number;
}) {
  if (parentFilingContext) {
    const accession = firstString(parentFilingContext.accession_number, parentFilingContext.accessionNumber);
    const formType = firstString(parentFilingContext.form_type, parentFilingContext.formType) || "parent filing";
    const filedAt = firstString(parentFilingContext.filed_at, parentFilingContext.filedAt);
    const sourceBlocks = firstArray(parentFilingContext.source_blocks, parentFilingContext.sourceBlocks);
    const compactContext = { ...parentFilingContext };
    delete compactContext.source_blocks;
    delete compactContext.sourceBlocks;
    delete compactContext.display_payload;
    if (firstString(parentFilingContext.context_kind, parentFilingContext.contextKind) === "current_report_parent_filing") {
      delete compactContext.selected_source_snippets;
      delete compactContext.selectedSourceSnippets;
      delete compactContext.selected_tables;
      delete compactContext.selectedTables;
      delete compactContext.attachment_inventory;
      delete compactContext.attachmentInventory;
      delete compactContext.source_availability_note;
    }
    addBlock(blocks, {
      block_type: "parent_filing_context",
      label: "Parent filing compact context",
      source: "integration",
      source_ref: accession ? `${formType} ${accession}` : `${formType}${filedAt ? ` ${filedAt}` : ""}`,
      origin: "integration.parent_filing_context",
      priority: 84,
      document_type: formType,
      document_reference: accession || filedAt || formType,
      text: compactJson(removeJudgmentKeys(compactContext)),
    }, maxBlockChars);
    const includeParentSourceBlocks =
      includeAmendmentHistoricalSourceBlocks ||
      firstString(parentFilingContext.context_kind, parentFilingContext.contextKind) !== "current_report_parent_filing";
    for (const [index, sourceBlock] of (includeParentSourceBlocks ? sourceBlocks : []).slice(0, 6).entries()) {
      const sourceText = firstString(sourceBlock.text, sourceBlock.source_text, sourceBlock.sourceText);
      if (!sourceText) continue;
      addBlock(blocks, {
        block_type: "parent_filing_source_block",
        label: firstString(sourceBlock.label) || `${formType} original source ${index + 1}`,
        source: accession ? `parent_filing:${accession}` : "parent_filing",
        source_ref: firstString(sourceBlock.source_ref, sourceBlock.sourceRef) ||
          (accession ? `${formType} ${accession}` : `${formType}${filedAt ? ` ${filedAt}` : ""}`),
        origin: firstString(sourceBlock.origin) || "integration.parent_filing_source",
        priority: 90,
        item_number: firstString(sourceBlock.item_number, sourceBlock.itemNumber) || null,
        exhibit_number: firstString(sourceBlock.exhibit_number, sourceBlock.exhibitNumber) || null,
        document_type: firstString(sourceBlock.document_type, sourceBlock.documentType) || formType,
        document_reference: firstString(sourceBlock.document_reference, sourceBlock.documentReference) ||
          accession || filedAt || formType,
        text: sourceText,
      }, maxBlockChars);
    }
  }
  for (const context of (relatedFilingContexts || []).slice(0, 4)) {
    const accession = firstString(context.accession_number, context.accessionNumber);
    const formType = firstString(context.form_type, context.formType) || "related filing";
    const filedAt = firstString(context.filed_at, context.filedAt);
    const sourceBlocks = firstArray(context.source_blocks, context.sourceBlocks);
    const compactContext = { ...context };
    delete compactContext.source_blocks;
    delete compactContext.sourceBlocks;
    delete compactContext.display_payload;
    addBlock(blocks, {
      block_type: "related_filing_context",
      label: `${formType}${filedAt ? ` filed ${filedAt}` : ""}`,
      source: accession ? `related_filing:${accession}` : "related_filing",
      source_ref: accession ? `${formType} ${accession}` : `${formType}${filedAt ? ` ${filedAt}` : ""}`,
      origin: "integration.related_filing_context",
      priority: 82,
      document_type: formType,
      document_reference: accession || filedAt || formType,
      text: compactJson(removeJudgmentKeys(compactContext)),
    }, maxBlockChars);
    const includeRelatedSourceBlocks =
      includeAmendmentHistoricalSourceBlocks ||
      firstString(context.context_kind, context.contextKind) !== "current_report_amendment_lifecycle";
    for (const [index, sourceBlock] of (includeRelatedSourceBlocks ? sourceBlocks : []).slice(0, 4).entries()) {
      const sourceText = firstString(sourceBlock.text, sourceBlock.source_text, sourceBlock.sourceText);
      if (!sourceText) continue;
      const sourceLabel = firstString(sourceBlock.label) || `${formType} related source ${index + 1}`;
      addBlock(blocks, {
        block_type: "related_filing_source_block",
        label: sourceLabel,
        source: accession ? `related_filing:${accession}` : "related_filing",
        source_ref: firstString(sourceBlock.source_ref, sourceBlock.sourceRef) ||
          (accession ? `${formType} ${accession}` : `${formType}${filedAt ? ` ${filedAt}` : ""}`),
        origin: firstString(sourceBlock.origin) || "integration.related_filing_source",
        priority: 88,
        item_number: firstString(sourceBlock.item_number, sourceBlock.itemNumber) || null,
        exhibit_number: firstString(sourceBlock.exhibit_number, sourceBlock.exhibitNumber) || null,
        document_type: formType,
        document_reference: accession || filedAt || formType,
        text: sourceText,
      }, maxBlockChars);
    }
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

function addBlock(blocks: SecCleanedSourceBlock[], block: SourceBlockDraft, maxBlockChars = DEFAULT_BLOCK_CHAR_LIMIT) {
  if (isLowQualitySourceText(block.text)) return;
  const text = compactText(block.text, maxBlockChars);
  if (!text) return;
  const blockType = block.block_type || "source_block";
  const label = block.label || null;
  const source = block.source || null;
  const itemNumber = block.item_number ?? inferItemNumber(`${label || ""} ${source || ""} ${text}`);
  const exhibitNumber = block.exhibit_number ?? inferExhibitNumber(`${label || ""} ${source || ""}`);
  const documentType = block.document_type ?? inferDocumentType(`${label || ""} ${source || ""}`);
  const origin = block.origin || inferOrigin(blockType, source);
  const sourceRef = block.source_ref || buildSourceRef({ blockType, label, source, itemNumber, exhibitNumber, documentType });
  const priority = block.priority ?? priorityForBlock({ blockType, label, source, text, itemNumber, exhibitNumber, documentType });
  blocks.push({
    block_id: buildStableBlockId({
      blockType,
      documentType,
      exhibitNumber,
      itemNumber,
      label,
      origin,
      source,
      text,
      chunkIndex: block.chunk_index,
    }),
    block_type: blockType,
    document_reference: block.document_reference ?? sourceRef,
    document_type: documentType,
    exhibit_number: exhibitNumber,
    item_number: itemNumber,
    label,
    origin,
    priority,
    source,
    source_ref: sourceRef,
    text,
    chunk_index: block.chunk_index ?? null,
    chunk_count: block.chunk_count ?? null,
  });
}

function compactDocumentInventory(value: unknown[]) {
  return value.map((item) => {
    const record = toRecord(item);
    return removeJudgmentKeys({
      type: firstString(record.type, record.documentType, record.document_type),
      description: firstString(record.description, record.name, record.title),
      filename: firstString(record.filename, record.fileName),
      url: firstString(record.url, record.sourceUrl, record.source_url),
      is_primary: record.isPrimary ?? record.is_primary ?? null,
      text_char_count: record.textCharCount ?? record.text_char_count ?? null,
      included_text_char_count: record.includedTextCharCount ?? record.included_text_char_count ?? null,
      text_extraction_status: firstString(record.textExtractionStatus, record.text_extraction_status),
      fetch_status: record.fetchStatus ?? record.fetch_status ?? null,
      fetch_error: firstString(record.fetchError, record.fetch_error),
    });
  });
}

function addContextPreservingBlocks(
  blocks: SecCleanedSourceBlock[],
  block: SourceBlockDraft,
  maxBlockChars = DEFAULT_BLOCK_CHAR_LIMIT,
) {
  const chunks = contextPreservingChunks(block.text, maxBlockChars);
  if (!chunks.length) return;
  for (const [index, chunk] of chunks.entries()) {
    addBlock(blocks, {
      ...block,
      text: chunk,
      chunk_index: index + 1,
      chunk_count: chunks.length,
    }, maxBlockChars);
  }
}

function dedupeBlocks(blocks: SecCleanedSourceBlock[]) {
  const seen = new Set<string>();
  const exactTextIndexes = new Map<string, number>();
  const result: SecCleanedSourceBlock[] = [];
  for (const block of blocks) {
    const normalizedText = block.text.replace(/\s+/g, " ").trim();
    const exactTextKey = normalizedText.length >= 240 ? stableHash(normalizedText) : null;
    if (exactTextKey) {
      const existingIndex = exactTextIndexes.get(exactTextKey);
      if (existingIndex !== undefined) {
        if (block.priority > result[existingIndex].priority) result[existingIndex] = block;
        continue;
      }
    }
    const textKey = block.block_type === "table_source_block"
      ? stableHash(block.text)
      : block.text.slice(0, 240);
    const key = `${block.block_type}:${block.label || ""}:${textKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (exactTextKey) exactTextIndexes.set(exactTextKey, result.length);
    result.push(block);
  }
  return result;
}

function removeRedundantSourceBlocks(blocks: SecCleanedSourceBlock[]) {
  const ranked = blocks
    .map((block, index) => ({ block, index }))
    .sort((left, right) =>
      right.block.priority - left.block.priority ||
      right.block.text.length - left.block.text.length ||
      left.index - right.index
    );
  const retained: Array<{ block: SecCleanedSourceBlock; index: number }> = [];

  for (const candidate of ranked) {
    const candidateText = comparableSourceText(candidate.block.text);
    const redundant = retained.some(({ block }) => {
      if (!isComparableEvidenceBlock(candidate.block) || !isComparableEvidenceBlock(block)) return false;
      if (!sameSourceScope(candidate.block, block) && candidateText.length < 480) return false;
      const retainedText = comparableSourceText(block.text);
      if (
        candidate.block.block_type === "attachment_headline" &&
        block.block_type === "attachment_source_block" &&
        sameSourceScope(candidate.block, block)
      ) {
        return retainedText.includes(candidateText);
      }
      return candidateText.length >= 180 && retainedText.includes(candidateText);
    });
    if (!redundant) retained.push(candidate);
  }

  return retained.sort((left, right) => left.index - right.index).map(({ block }) => block);
}

function isComparableEvidenceBlock(block: SecCleanedSourceBlock) {
  return ![
    "current_filing",
    "filing_metadata",
    "parent_filing_context",
    "related_filing_context",
    "site_market_context",
  ].includes(block.block_type);
}

function sameSourceScope(left: SecCleanedSourceBlock, right: SecCleanedSourceBlock) {
  if (left.exhibit_number && right.exhibit_number && left.exhibit_number === right.exhibit_number) return true;
  if (left.item_number && right.item_number && left.item_number === right.item_number) return true;
  if (left.document_reference && right.document_reference && left.document_reference === right.document_reference) return true;
  return Boolean(left.source && right.source && left.source === right.source);
}

function comparableSourceText(value: string) {
  return normalizeSecTextEncoding(value)
    .toLowerCase()
    .replace(/[^a-z0-9$%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isLowQualitySourceText(value: string) {
  const text = String(value || "");
  if (!text.trim()) return false;
  const replacementCount = (text.match(/\uFFFD/g) || []).length + (text.match(/ï¿½/g) || []).length;
  const controlCount = (text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g) || []).length;
  const suspiciousCount = replacementCount + controlCount;
  if (suspiciousCount >= 4 && suspiciousCount / text.length >= 0.005) return true;

  const longBinaryRuns = text.match(/[^\p{L}\p{N}\p{P}\p{S}\s]{12,}/gu) || [];
  return longBinaryRuns.some((run) => run.length >= 24);
}

function finalizeBlocks(blocks: SecCleanedSourceBlock[]) {
  return blocks.map((block) => ({
    ...block,
    priority: Number.isFinite(block.priority) ? block.priority : priorityForBlock({
      blockType: block.block_type,
      documentType: block.document_type,
      exhibitNumber: block.exhibit_number,
      itemNumber: block.item_number,
      label: block.label,
      source: block.source,
      text: block.text,
    }),
  }));
}

function sourceBlockManifestEntry(block: SecCleanedSourceBlock) {
  return {
    block_id: block.block_id,
    block_type: block.block_type,
    document_reference: block.document_reference ?? null,
    document_type: block.document_type ?? null,
    exhibit_number: block.exhibit_number ?? null,
    item_number: block.item_number ?? null,
    label: block.label,
    origin: block.origin,
    priority: block.priority,
    source_ref: block.source_ref,
    chunk_index: block.chunk_index ?? null,
    chunk_count: block.chunk_count ?? null,
  };
}

function priorityForBlock({
  blockType,
  documentType,
  exhibitNumber,
  itemNumber,
  label,
  source,
  text,
}: {
  blockType?: string | null;
  documentType?: string | null;
  exhibitNumber?: string | null;
  itemNumber?: string | null;
  label?: string | null;
  source?: string | null;
  text?: string | null;
}) {
  const haystack = `${blockType || ""} ${documentType || ""} ${exhibitNumber || ""} ${itemNumber || ""} ${label || ""} ${source || ""} ${text || ""}`;
  if (itemNumber && ["3.01", "2.01", "5.07", "5.02", "8.01"].includes(itemNumber)) return 95;
  if (itemNumber === "9.01") return 72;
  if (/\bEX[-\s]?99(?:\.1)?\b/i.test(haystack) && /\b(?:press release|results|business update|corporate update|shareholder|transaction|listing)\b/i.test(haystack)) return 92;
  if (/\b(?:merger agreement|business combination agreement|agreement and plan of merger)\b/i.test(haystack)) return 94;
  if (/\b(?:material definitive agreement|purchase agreement|securities purchase agreement|financing agreement|credit agreement|indenture|warrant agreement|registration rights agreement)\b/i.test(haystack)) return 90;
  if (/\b(?:auditor|accountant).{0,40}\bletter\b/i.test(haystack) || /\bEX[-\s]?16\b/i.test(haystack)) return 88;
  if (blockType === "table_source_block") return 80;
  if (blockType === "attachment_source_block" || blockType === "attachment_headline") return 78;
  if (blockType === "item_section") return 76;
  if (blockType === "current_filing" || blockType === "filing_metadata") return 65;
  if (blockType === "parent_filing_context") return 84;
  if (blockType === "parent_filing_source_block") return 90;
  if (blockType === "related_filing_context") return 82;
  if (blockType === "related_filing_source_block") return 88;
  if (blockType === "parser_warnings") return 50;
  if (blockType?.includes("inventory")) return 35;
  return 60;
}

function priorityForItemNumber(itemNumber: string | null | undefined) {
  if (itemNumber && ["3.01", "2.01", "5.07", "5.02", "8.01"].includes(itemNumber)) return 95;
  if (itemNumber === "1.01" || itemNumber === "3.02" || itemNumber === "4.01") return 90;
  if (itemNumber === "2.02" || itemNumber === "7.01") return 86;
  if (itemNumber === "9.01") return 72;
  return 76;
}

function attachmentPriority({
  documentType,
  exhibitNumber,
  roleLabel,
  text,
}: {
  documentType: string | null;
  exhibitNumber: string | null;
  roleLabel: string | null;
  text: string;
}) {
  const haystack = `${documentType || ""} ${exhibitNumber || ""} ${roleLabel || ""} ${text.slice(0, 1_000)}`;
  if (/\b(?:merger agreement|business combination agreement|agreement and plan of merger)\b/i.test(haystack)) return 94;
  if (/\b(?:financing agreement|credit agreement|securities purchase agreement|indenture|warrant agreement|registration rights agreement)\b/i.test(haystack)) return 92;
  if (/\bEX[-\s]?99(?:\.1)?\b/i.test(haystack) || exhibitNumber?.startsWith("99")) return 90;
  if (/\b(?:auditor|accountant).{0,40}\bletter\b/i.test(haystack) || /\bEX[-\s]?16\b/i.test(haystack)) return 88;
  if (roleLabel) return 84;
  return 78;
}

function attachmentRoleLabel(value: string) {
  const roles: Array<[string, RegExp]> = [
    ["press release", /\bpress release\b/i],
    ["merger agreement", /\b(?:merger agreement|business combination agreement|agreement and plan of merger)\b/i],
    ["material agreement", /\b(?:material definitive agreement|purchase agreement|credit agreement|loan agreement)\b/i],
    ["financing agreement", /\b(?:financing agreement|securities purchase agreement|indenture|warrant agreement|registration rights agreement)\b/i],
    ["auditor letter", /\b(?:auditor|accountant).{0,40}\bletter\b/i],
    ["shareholder vote result", /\b(?:shareholder meeting|stockholder meeting|votes for|votes against|broker non-votes)\b/i],
    ["financial results", /\b(?:financial results|earnings|results of operations|revenue|net income|eps)\b/i],
  ];
  return roles.find(([, pattern]) => pattern.test(value))?.[0] || null;
}

function firstMeaningfulLines(value: string, maxLines: number) {
  return value
    .split(/\r?\n/)
    .map((line) => compactText(line, 260))
    .filter((line) => line && !/^(?:table of contents|signature|exhibit index)$/i.test(line))
    .slice(0, maxLines)
    .join("\n");
}

function buildStableBlockId({
  blockType,
  documentType,
  exhibitNumber,
  itemNumber,
  label,
  origin,
  source,
  text,
  chunkIndex,
}: {
  blockType: string;
  documentType?: string | null;
  exhibitNumber?: string | null;
  itemNumber?: string | null;
  label?: string | null;
  origin?: string | null;
  source?: string | null;
  text: string;
  chunkIndex?: number | null;
}) {
  const scope = [
    blockType,
    origin || "",
    itemNumber || "",
    exhibitNumber || "",
    documentType || "",
    label || "",
    source || "",
    chunkIndex || "",
    text.slice(0, 360),
  ].join("|");
  return `secblk_${slugify(blockType)}_${stableHash(scope)}`;
}

function buildSourceRef({
  blockType,
  documentType,
  exhibitNumber,
  itemNumber,
  label,
  source,
}: {
  blockType: string;
  documentType?: string | null;
  exhibitNumber?: string | null;
  itemNumber?: string | null;
  label?: string | null;
  source?: string | null;
}) {
  if (itemNumber) return `Item ${itemNumber}${label ? ` - ${label.replace(/^Item\s+\d\.\d{2}\s*-\s*/i, "")}` : ""}`;
  if (exhibitNumber) return `Exhibit ${exhibitNumber}${label ? ` - ${label.replace(/^EX[-\s]?\d+(?:\.\d+)?\s*-\s*/i, "")}` : ""}`;
  if (documentType) return `${documentType}${label ? ` - ${label}` : ""}`;
  if (source) return source;
  return blockType;
}

function inferOrigin(blockType: string, source: string | null) {
  if (blockType === "item_section") return "parser.item_section";
  if (blockType === "source_document_section") return "filing_package.document_section";
  if (blockType === "attachment_source_block" || blockType === "attachment_headline") return "filing_package.attachment";
  if (blockType === "table_source_block") return "parser.table";
  if (blockType.includes("inventory")) return "parser.inventory";
  if (source?.startsWith("parent")) return "integration.parent_context";
  if (source?.startsWith("related_filing")) return "integration.related_filing_context";
  if (source?.includes("market")) return "integration.market_context";
  return "parser.source_bundle";
}

function maxCharsForItemSection(itemNumber: string | null | undefined, defaultMax: number) {
  return itemNumber && ["1.01", "2.01", "3.01", "3.02", "5.02", "5.03", "5.07", "8.01"].includes(itemNumber)
    ? Math.max(defaultMax, 6_000)
    : defaultMax;
}

function isExtractedEvidenceBlock(blockType: string | null | undefined) {
  return [
    "source_value_evidence",
    "source_evidence",
    "date_evidence",
    "money_evidence",
    "share_count_evidence",
    "keyword_evidence",
  ].includes(blockType || "");
}

function inferItemNumber(value: string) {
  return value.match(/\bItem\s+([0-9]\.[0-9]{2})\b/i)?.[1] || null;
}

function inferExhibitNumber(value: string) {
  return value.match(/\b(?:EXHIBIT|EX)[-\s]?([0-9]{1,3}(?:\.[0-9A-Z]+)?)\b/i)?.[1]?.toUpperCase() || null;
}

function inferDocumentType(value: string) {
  return value.match(/\b(?:EX[-\s]?[0-9]{1,3}(?:\.[0-9A-Z]+)?|8-K\/A|8-K|6-K\/A|6-K)\b/i)?.[0]?.toUpperCase().replace(/\s+/g, "-") || null;
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "source";
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
  const text = normalizeSecTextEncoding(value).replace(/\s+/g, " ").trim();
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
