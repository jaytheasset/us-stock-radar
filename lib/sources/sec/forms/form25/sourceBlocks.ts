import {
  buildCurrentFilingIdentity,
  currentFilingIdentityText,
} from "../common/currentFilingIdentity";
import type { SecCleanedSourceBlock, SecSourceBlockPromptInput } from "../common/sourceBlockPromptInput";
import type { SecForm25ParserOutput } from "./parser";

export type SecForm25SourceBlockInput = {
  parser_output: SecForm25ParserOutput;
  fixture_context?: Record<string, unknown> | null;
  related_filing_context?: Record<string, unknown> | null;
};

export function buildSecForm25SourceBlockInput(input: SecForm25SourceBlockInput): SecSourceBlockPromptInput {
  const parser = input.parser_output;
  const currentFiling = buildCurrentFilingIdentity({
    parserOutput: parser as unknown as Record<string, unknown>,
    formFamily: parser.formType,
  });

  const blocks: SecCleanedSourceBlock[] = [
    {
      block_type: "current_filing",
      label: "Current SEC filing identity",
      source: "filing_package",
      text: currentFilingIdentityText(currentFiling),
    },
  ];

  for (const sourceBlock of parser.raw.directSourceBlocks || []) {
    blocks.push({
      block_type: sourceBlock.block_type,
      label: sourceBlock.label,
      source: `${sourceBlock.source_ref}#${sourceBlock.block_id}`,
      text: sourceBlock.text,
    });
  }

  if (input.related_filing_context) {
    blocks.push({
      block_type: "related_filing_context",
      label: "Issuer-related filing context",
      source: "persisted_raw_items_events",
      text: compactJson(input.related_filing_context),
    });
  }

  if (parser.raw.sourceInventory) {
    blocks.push({
      block_type: "source_inventory",
      label: "Source inventory",
      source: "parser/raw",
      text: compactJson(parser.raw.sourceInventory),
    });
  }

  if (parser.warnings.length) {
    blocks.push({
      block_type: "parser_warnings",
      label: "Parser warnings",
      source: "parser",
      text: parser.warnings.join(", "),
    });
  }

  return {
    current_filing: currentFiling,
    cleaned_source_blocks: dedupeBlocks(blocks),
  };
}

function compactJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function dedupeBlocks(blocks: SecCleanedSourceBlock[]) {
  const seen = new Set<string>();
  const result: SecCleanedSourceBlock[] = [];
  for (const block of blocks) {
    const key = `${block.block_type}\n${block.label || ""}\n${block.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(block);
  }
  return result;
}
