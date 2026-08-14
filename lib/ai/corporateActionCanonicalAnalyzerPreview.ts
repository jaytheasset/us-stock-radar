import { getServerEnv } from "../env.ts";
import {
  runStructuredGeminiJson,
  type GeminiStructuredJsonRun,
} from "./geminiStructuredJson.ts";
import {
  canonicalizeCorporateActionAnalyzerResult,
  parseCorporateActionAnalyzerTransportJson,
  type CorporateActionAnalyzerInput,
  type CorporateActionAnalyzerResult,
  validateCorporateActionAnalyzerInput,
} from "../monitor/corporateActionCanonicalFacts.ts";
import {
  buildCorporateActionCanonicalAnalysisPrompt,
  CORPORATE_ACTION_CANONICAL_RESPONSE_SCHEMA,
} from "../prompts/corporateActionCanonicalAnalysis.ts";

export type CorporateActionCanonicalAnalyzerPreviewResult =
  | {
      stage: "complete";
      result: CorporateActionAnalyzerResult;
      run: GeminiStructuredJsonRun;
      repair: null;
    }
  | {
      stage: "configuration_error" | "input_error" | "provider_error" | "validation_error";
      result: null;
      run: GeminiStructuredJsonRun | null;
      error: string;
      validation_errors?: string[];
    };

export async function runCorporateActionCanonicalAnalyzerPreview(
  input: CorporateActionAnalyzerInput,
  options: {
    apiKey?: string;
    model?: string;
    maxOutputTokens?: number;
    runPrompt?: typeof runStructuredGeminiJson;
  } = {},
): Promise<CorporateActionCanonicalAnalyzerPreviewResult> {
  const inputErrors = validateCorporateActionAnalyzerInput(input);
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
      error: "Corporate Action analyzer Gemini API key is unavailable",
    };
  }

  const prompt = buildCorporateActionCanonicalAnalysisPrompt(input);
  const run = await (options.runPrompt || runStructuredGeminiJson)({
    apiKey,
    model,
    prompt,
    maxOutputTokens: options.maxOutputTokens ?? 1_200,
    responseSchema: CORPORATE_ACTION_CANONICAL_RESPONSE_SCHEMA,
  });
  if (!run.responseOk) {
    return {
      stage: "provider_error",
      result: null,
      run,
      error: run.error || "Corporate Action analyzer provider request failed",
    };
  }

  const parsed = parseCorporateActionAnalyzerTransportJson(run.outputText);
  if (!parsed.transport) {
    return {
      stage: "validation_error",
      result: null,
      run,
      error: parsed.errors.join("; "),
      validation_errors: parsed.errors,
    };
  }
  const canonicalized = canonicalizeCorporateActionAnalyzerResult(parsed.transport, input);
  if (!canonicalized.result) {
    return {
      stage: "validation_error",
      result: null,
      run,
      error: canonicalized.errors.join("; "),
      validation_errors: canonicalized.errors,
    };
  }
  return { stage: "complete", result: canonicalized.result, run, repair: null };
}
