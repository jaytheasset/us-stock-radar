import { type S1F1CleanedSourceBlock, type S1F1ParserOutput } from "./types.ts";
import {
  buildCurrentFilingIdentity,
  currentFilingIdentityText,
} from "../common/currentFilingIdentity.ts";

export function buildS1F1LlmSourceInput(parserOutput: S1F1ParserOutput): Record<string, unknown> {
  const currentFiling = buildCurrentFilingIdentity({
    parserOutput: parserOutput as unknown as Record<string, unknown>,
    formFamily: parserOutput.formType,
  });
  const cleanedSourceBlocks = buildLlmCleanedSourceBlocks(parserOutput.raw.cleanedSourceBlocks ?? []);
  return {
    current_filing: currentFiling,
    parserVersion: parserOutput.parserVersion,
    parserGroup: parserOutput.parserGroup,
    accessionNumber: parserOutput.accessionNumber,
    source_inventory: {
      sourceTextLength: parserOutput.raw.sourceTextLength,
      attachmentNames: parserOutput.raw.attachmentNames,
      documentCounts: parserOutput.raw.documentFilter
        ? {
            documentCount: parserOutput.raw.documentFilter.documentCount,
            bodyCount: parserOutput.raw.documentFilter.bodyCount,
            importantExhibitCount: parserOutput.raw.documentFilter.importantExhibitCount,
            noiseCount: parserOutput.raw.documentFilter.noiseCount,
            mainDocument: parserOutput.raw.documentFilter.mainDocument ?? null,
          }
        : null,
      sourceBlockBudget: cleanedSourceBlocks.budget,
    },
    attachment_inventory: parserOutput.raw.exhibitExtractions?.attachedExhibits.map((item) => ({
      type: item.type,
      filename: item.filename,
      description: item.description,
      sourceTextAvailable: item.sourceTextAvailable,
      textLength: item.textLength,
    })) ?? [],
    market_context: parserOutput.raw.marketContext ?? null,
    parent_filing_context: parserOutput.raw.parentFilingContext ?? null,
    current_filing_source_block: {
      block_type: "current_filing",
      label: "Current SEC filing identity",
      source: "parser_identity",
      text: currentFilingIdentityText(currentFiling),
    },
    cleaned_source_blocks: cleanedSourceBlocks.blocks,
    parser_warnings: parserOutput.warnings,
  };
}

const MAX_LLM_SOURCE_BLOCKS = 32;
const MAX_LLM_SOURCE_BLOCK_TEXT_CHARS = 5_000;
const MAX_LLM_SOURCE_TOTAL_TEXT_CHARS = 90_000;

function buildLlmCleanedSourceBlocks(blocks: S1F1CleanedSourceBlock[]) {
  const output: Array<Record<string, unknown>> = [];
  let totalChars = 0;
  let truncatedBlocks = 0;

  for (const block of blocks) {
    if (output.length >= MAX_LLM_SOURCE_BLOCKS) break;
    const remaining = MAX_LLM_SOURCE_TOTAL_TEXT_CHARS - totalChars;
    if (remaining <= 0) break;

    const maxTextChars = Math.min(MAX_LLM_SOURCE_BLOCK_TEXT_CHARS, remaining);
    const text = clipPromptText(block.text, maxTextChars);
    if (!text) continue;

    if (text.length < block.text.trim().length) truncatedBlocks += 1;
    totalChars += text.length;
    output.push({
      source: block.source,
      sectionKey: block.sectionKey,
      sectionTitle: block.sectionTitle,
      documentName: block.documentName,
      text,
      tables: block.tables.map((table) => clipPromptText(table, 2_000)).filter(Boolean),
    });
  }

  return {
    blocks: output,
    budget: {
      originalBlockCount: blocks.length,
      includedBlockCount: output.length,
      maxBlocks: MAX_LLM_SOURCE_BLOCKS,
      maxBlockTextChars: MAX_LLM_SOURCE_BLOCK_TEXT_CHARS,
      maxTotalTextChars: MAX_LLM_SOURCE_TOTAL_TEXT_CHARS,
      includedTextChars: totalChars,
      truncatedBlocks,
    },
  };
}

function clipPromptText(value: string, maxLength: number) {
  const text = value.trim();
  if (!text || maxLength <= 0) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}
