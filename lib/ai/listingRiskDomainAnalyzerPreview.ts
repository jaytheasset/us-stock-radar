import { getServerEnv } from "../env.ts";
import {
  runStructuredGeminiJson,
  type GeminiStructuredJsonRun,
} from "./geminiStructuredJson.ts";
import {
  LISTING_RISK_ANALYZER_PROVIDER_SCHEMA,
  normalizeListingRiskAnalyzerProviderResult,
  type ListingRiskAnalyzerInput,
  type ListingRiskAnalyzerResult,
  validateListingRiskAnalyzerInput,
  validateListingRiskAnalyzerProviderResult,
} from "../monitor/listingRiskAnalyzer.ts";
import { buildListingRiskDomainAnalysisPrompt } from "../prompts/listingRiskDomainAnalysis.ts";

export type ListingRiskDomainAnalyzerPreviewResult =
  | {
      stage: "complete";
      result: ListingRiskAnalyzerResult;
      run: GeminiStructuredJsonRun;
    }
  | {
      stage: "configuration_error" | "input_error" | "provider_error" | "validation_error";
      result: null;
      run: GeminiStructuredJsonRun | null;
      error: string;
      validation_errors?: string[];
    };

export async function runListingRiskDomainAnalyzerPreview(
  input: ListingRiskAnalyzerInput,
  options: {
    apiKey?: string;
    model?: string;
    maxOutputTokens?: number;
    runPrompt?: typeof runStructuredGeminiJson;
  } = {},
): Promise<ListingRiskDomainAnalyzerPreviewResult> {
  const inputErrors = validateListingRiskAnalyzerInput(input);
  if (inputErrors.length) {
    return {
      stage: "input_error",
      result: null,
      run: null,
      error: inputErrors.join("; "),
      validation_errors: inputErrors,
    };
  }

  const env = getServerEnv();
  const apiKey = options.apiKey ?? env.geminiApiKey;
  const model = options.model ?? env.geminiModel;
  if (!apiKey && !options.runPrompt) {
    return {
      stage: "configuration_error",
      result: null,
      run: null,
      error: "Listing Risk analyzer Gemini API key is unavailable",
    };
  }

  const prompt = buildListingRiskDomainAnalysisPrompt(input);
  const run = await (options.runPrompt || runStructuredGeminiJson)({
    apiKey,
    model,
    prompt,
    maxOutputTokens: options.maxOutputTokens ?? 4_000,
    responseSchema: LISTING_RISK_ANALYZER_PROVIDER_SCHEMA as unknown as Record<string, unknown>,
  });
  if (!run.responseOk || !run.parsed) {
    return {
      stage: "provider_error",
      result: null,
      run,
      error: run.error || "Listing Risk analyzer provider request failed",
    };
  }

  const validationErrors = validateListingRiskAnalyzerProviderResult(run.parsed, input);
  const result = normalizeListingRiskAnalyzerProviderResult(run.parsed, input);
  if (validationErrors.length || !result) {
    return {
      stage: "validation_error",
      result: null,
      run,
      error: validationErrors.join("; ") || "Listing Risk analyzer result is invalid",
      validation_errors: validationErrors,
    };
  }
  return { stage: "complete", result, run };
}
