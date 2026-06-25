import { type S1F1ParserOutput } from "./types.ts";
import {
  buildCurrentFilingIdentity,
  currentFilingIdentityText,
} from "../common/currentFilingIdentity.ts";

export function buildS1F1LlmSourceInput(parserOutput: S1F1ParserOutput): Record<string, unknown> {
  const currentFiling = buildCurrentFilingIdentity({
    parserOutput: parserOutput as unknown as Record<string, unknown>,
    formFamily: parserOutput.formType,
  });
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
    cleaned_source_blocks: parserOutput.raw.cleanedSourceBlocks ?? [],
    parser_warnings: parserOutput.warnings,
  };
}
