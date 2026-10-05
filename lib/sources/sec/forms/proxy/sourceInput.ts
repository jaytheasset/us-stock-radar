import type { ProxyParserOutput } from "./parser.ts";
import { buildCurrentFilingIdentity, currentFilingIdentityText } from "../common/currentFilingIdentity.ts";

export function buildProxySourceBlockPromptInput(
  parserOutput: ProxyParserOutput,
  marketContext?: Record<string, unknown> | null,
): Record<string, unknown> {
  return buildSourceInput(parserOutput, marketContext, buildPrimarySourceBlocks(parserOutput));
}

/** Keep the legacy Structured v1 source/fingerprint contract isolated from Primary. */
export function buildProxyLegacySourceBlockPromptInput(
  parserOutput: ProxyParserOutput,
  marketContext?: Record<string, unknown> | null,
): Record<string, unknown> {
  return buildSourceInput(parserOutput, marketContext, buildProxyCleanedSourceBlocks(parserOutput));
}

function buildSourceInput(
  parserOutput: ProxyParserOutput,
  marketContext: Record<string, unknown> | null | undefined,
  sourceBlocks: Array<Record<string, unknown>>,
): Record<string, unknown> {
  const currentFiling = buildCurrentFilingIdentity({
    parserOutput: parserOutput as unknown as Record<string, unknown>,
    formFamily: "Proxy",
  });
  const input: Record<string, unknown> = {
    current_filing: currentFiling,
    parserVersion: parserOutput.parserVersion,
    parserGroup: parserOutput.parserGroup,
    accessionNumber: parserOutput.accessionNumber,
    source_inventory: {
      secFormType: parserOutput.raw.secFormType,
      primaryTextChars: parserOutput.raw.primaryTextChars,
      combinedTextChars: parserOutput.raw.combinedTextChars,
      attachmentNames: parserOutput.raw.attachmentNames,
      textCoverage: parserOutput.raw.textCoverage,
    },
    attachment_inventory: parserOutput.raw.attachmentInventory,
    document_inventory: parserOutput.raw.documentInventory,
    cleaned_source_blocks: [
      {
        block_type: "current_filing",
        label: "Current SEC filing identity",
        text: currentFilingIdentityText(currentFiling),
      },
      ...sourceBlocks,
    ],
    parser_warnings: parserOutput.warnings,
  };

  if (marketContext) input.market_context = marketContext;
  if (parserOutput.facts.deterministic.canFinishWithoutLlm) {
    input.deterministic_archive = {
      can_finish_without_llm: true,
      reason: parserOutput.facts.deterministic.reason,
    };
  }

  return input;
}

const normalized = (text: string) => text.replace(/\s+/g, " ").trim();

function buildPrimarySourceBlocks(parserOutput: ProxyParserOutput): Array<Record<string, unknown>> {
  const raw = parserOutput.raw;
  // The parser owns source selection. Preserve its order and every chunk,
  // including overlaps and noise, without reselecting, sorting or merging.
  // Merging hides late text from consumers that clip each block (such as repair).
  const ranges: Array<{ documentIndex: number; start: number; end: number; text: string; ids: string[] }> = [];
  for (const block of raw.discoveryBlocks ?? []) {
    const document = raw.documentInventory[block.sourceDocumentIndex];
    if (!document || !Number.isInteger(block.sourceDocumentIndex)
      || !Number.isInteger(block.startChar) || !Number.isInteger(block.endChar)
      || block.startChar < 0 || block.endChar > document.textChars
      || block.endChar <= block.startChar || block.endChar - block.startChar !== block.text.length) {
      throw new Error(`Invalid Proxy Primary source coordinates: ${block.id}`);
    }
    ranges.push({ documentIndex: block.sourceDocumentIndex, start: block.startChar,
      end: block.endChar, text: block.text, ids: [block.id] });
  }
  const blocks: Array<Record<string, unknown>> = ranges.map(range => {
    const document = raw.documentInventory[range.documentIndex];
    return {
      block_type: "proxy_source_block",
      label: `Document ${range.documentIndex + 1}, source chars ${range.start}-${range.end}`,
      text: range.text,
      source: {
        accession_number: parserOutput.accessionNumber,
        documentIndex: range.documentIndex, documentSequence: document.sequence,
        documentType: document.type, documentFilename: document.filename,
        documentDescription: document.description, origin: document.source,
        isPrimary: document.isPrimary, startChar: range.start, endChar: range.end,
        offsetCoordinate: "normalized_document_text", discoveryBlockIds: range.ids,
      },
    };
  });
  const covered = ranges.map(range => normalized(range.text));
  const retained = new Set<string>();
  const addUncovered = (blockType: string, text: string, origin: string, index: number, label = "Additional source excerpt") => {
    const key = normalized(text);
    if (!key || covered.some(source => source.includes(key)) || retained.has(key)) return;
    retained.add(key);
    blocks.push({ block_type: blockType, label, text,
      source: { origin, index, offsetCoordinate: null } });
  };
  raw.importantBlocks.forEach((block, index) =>
    addUncovered("proxy_source_block", block.text, "importantBlocks", index,
      block.kind === "preliminary_placeholder" ? "Parser placeholder inventory" : "Additional source excerpt"));

  // These remain explicitly partial table extracts. Full rows/footnotes inside
  // selected body/appendix ranges are sent verbatim above, without a row cap.
  raw.keyTableExtraction.tables.forEach(table => {
    blocks.push({
      block_type: "table_source_block", label: "Table sample (not complete table)",
      source: { documentIndex: table.sourceDocumentIndex, tableId: table.id },
      text: JSON.stringify({ caption: table.caption, heading: table.heading,
        headers: table.headers, sampleRows: table.sampleRows, rowCount: table.rowCount,
        warnings: table.warnings }, null, 2),
    });
  });
  raw.supplementalAnalysis.parentReferences.forEach((reference, index) =>
    addUncovered("proxy_parent_reference_source", reference.evidence, "supplementalAnalysis.parentReferences", index));
  raw.supplementalAnalysis.changeSignals.forEach((signal, index) =>
    addUncovered("proxy_supplement_source_block", signal.sourceText, "supplementalAnalysis.changeSignals", index));
  // No global block-count slice: it could remove a late appendix or supplement.
  return blocks;
}

function buildProxyCleanedSourceBlocks(parserOutput: ProxyParserOutput) {
  const blocks: Array<Record<string, unknown>> = [];

  for (const block of parserOutput.raw.importantBlocks) {
    blocks.push({
      block_type: "proxy_source_block",
      label: block.label,
      text: block.text,
    });
  }

  for (const table of parserOutput.raw.keyTableExtraction.tables) {
    blocks.push({
      block_type: "table_source_block",
      label: table.heading || table.caption || table.id,
      text: JSON.stringify(
        {
          caption: table.caption,
          heading: table.heading,
          headers: table.headers,
          sampleRows: table.sampleRows,
          warnings: table.warnings,
        },
        null,
        2,
      ),
    });
  }

  for (const reference of parserOutput.raw.supplementalAnalysis.parentReferences) {
    blocks.push({
      block_type: "proxy_parent_reference_source",
      label: "Parent proxy reference",
      text: reference.evidence,
    });
  }

  for (const signal of parserOutput.raw.supplementalAnalysis.changeSignals) {
    blocks.push({
      block_type: "proxy_supplement_source_block",
      label: signal.label,
      text: signal.sourceText,
    });
  }

  return blocks.slice(0, 60);
}
