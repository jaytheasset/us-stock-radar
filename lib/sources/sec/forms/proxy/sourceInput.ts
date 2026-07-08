import type { ProxyParserOutput } from "./parser.ts";
import { buildCurrentFilingIdentity, currentFilingIdentityText } from "../common/currentFilingIdentity.ts";

export function buildProxySourceBlockPromptInput(
  parserOutput: ProxyParserOutput,
  marketContext?: Record<string, unknown> | null,
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
      ...buildProxyCleanedSourceBlocks(parserOutput),
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
