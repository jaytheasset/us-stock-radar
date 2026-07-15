import type { SecFilingAnalysisInput } from "@/lib/prompts/secFilingAnalysis";
import {
  buildSec425RouterPromptDraft,
  normalizeSec425RouterResult,
  SEC_425_ROUTER_PROMPT_KEY,
  SEC_425_ROUTER_PROMPT_VERSION,
} from "@/lib/sources/sec/forms/425/routerPrompt";
import type { Sec425ParserOutput } from "@/lib/sources/sec/forms/425/types";

export {
  SEC_425_ROUTER_PROMPT_KEY,
  SEC_425_ROUTER_PROMPT_VERSION,
};

export function isSec425FilingInput(input: SecFilingAnalysisInput) {
  const parserOutput = readSec425ParserOutput(input);
  return Boolean(parserOutput);
}

export function buildSec425RouterPromptForInput(input: SecFilingAnalysisInput) {
  const parserOutput = readSec425ParserOutput(input);
  if (!parserOutput) {
    throw new Error("SEC 425 parser output is missing from filing package");
  }

  return buildSec425RouterPromptDraft({
    filing_package: readFilingPackage(input),
    parser_output: parserOutput,
    filing_excerpt: null,
    market_context: null,
  });
}

export function normalizeSec425RouterResultForInput(
  value: Record<string, unknown>,
  input: SecFilingAnalysisInput,
) {
  const parserOutput = readSec425ParserOutput(input);
  if (!parserOutput) {
    throw new Error("SEC 425 parser output is missing from filing package");
  }
  return normalizeSec425RouterResult(value, parserOutput);
}

export function readSec425ParserOutput(input: SecFilingAnalysisInput): Sec425ParserOutput | null {
  const filingPackage = readFilingPackage(input);
  const hardParsers = readRecord(filingPackage.hard_parsers);
  return readRecord(hardParsers?.["425"]) as unknown as Sec425ParserOutput | null;
}

function readFilingPackage(input: SecFilingAnalysisInput) {
  return readRecord(input.filing_package) || {};
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
