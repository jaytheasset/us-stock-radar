import { buildSecSourceBlockPromptInput } from "../common/sourceBlockPromptInput";
import type { SecForm25ParserOutput } from "./parser";

export type SecForm25SourceBlockInput = {
  parser_output: SecForm25ParserOutput;
  fixture_context?: Record<string, unknown> | null;
};

export function buildSecForm25SourceBlockInput(input: SecForm25SourceBlockInput) {
  return buildSecSourceBlockPromptInput({
    parserOutput: input.parser_output as unknown as Record<string, unknown>,
    marketContext: input.fixture_context,
  });
}
