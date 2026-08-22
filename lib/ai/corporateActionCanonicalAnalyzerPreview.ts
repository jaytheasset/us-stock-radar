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
  type CorporateActionEffectiveTimingTransportDiagnostic,
  validateCorporateActionAnalyzerInput,
} from "../monitor/corporateActionCanonicalFacts.ts";
import {
  buildCorporateActionCanonicalAnalysisPrompt,
  buildCorporateActionCanonicalResponseSchema,
} from "../prompts/corporateActionCanonicalAnalysis.ts";
import {
  extractLevel2ShareCountSidecar,
  type Level2ShareCountValidatedCandidate,
} from "../sec-structured-data/level2ShareCountObservation.ts";
import { parseJsonWithoutDuplicateKeys } from "../minimalOfferingMonitor.ts";

export type CorporateActionCanonicalAnalyzerPreviewResult =
  | {
      stage: "complete";
      result: CorporateActionAnalyzerResult;
      shareCountObservation: Level2ShareCountValidatedCandidate | null;
      shareCountObservationErrors: string[];
      run: GeminiStructuredJsonRun;
      repair: null;
    }
  | {
      stage: "configuration_error" | "input_error" | "provider_error" | "validation_error";
      result: null;
      run: GeminiStructuredJsonRun | null;
      error: string;
      validation_errors?: string[];
      timing_diagnostic?: CorporateActionEffectiveTimingTransportDiagnostic | null;
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
  const responseSchema = buildCorporateActionCanonicalResponseSchema(input);
  const run = await (options.runPrompt || runStructuredGeminiJson)({
    apiKey,
    model,
    prompt,
    maxOutputTokens: options.maxOutputTokens ?? 2_400,
    responseSchema,
  });
  if (!run.ok) {
    return {
      stage: "provider_error",
      result: null,
      run,
      error: run.error || "Corporate Action analyzer provider request failed",
    };
  }

  let providerPayload: Record<string, unknown> | null = null;
  try {
    const parsedJson = parseJsonWithoutDuplicateKeys(run.outputText);
    providerPayload = parsedJson && typeof parsedJson === "object" && !Array.isArray(parsedJson)
      ? parsedJson as Record<string, unknown>
      : null;
  } catch {
    providerPayload = null;
  }
  if (!providerPayload) {
    const parsed = parseCorporateActionAnalyzerTransportJson(run.outputText);
    return {
      stage: "validation_error",
      result: null,
      run,
      error: validationErrorMessage(parsed.errors, parsed.effectiveTimingDiagnostic),
      validation_errors: parsed.errors,
      timing_diagnostic: parsed.effectiveTimingDiagnostic,
    };
  }
  const sidecar = extractLevel2ShareCountSidecar({
    payload: providerPayload,
    accessionNumber: input.source_family === "sec" ? input.source_id : null,
    sourceDocumentUrl: input.source_family === "sec" ? input.source_url : null,
    sourceDocuments: input.source_documents,
  });
  const parsed = parseCorporateActionAnalyzerTransportJson(JSON.stringify(sidecar.domainPayload));
  if (!parsed.transport) {
    return {
      stage: "validation_error",
      result: null,
      run,
      error: validationErrorMessage(parsed.errors, parsed.effectiveTimingDiagnostic),
      validation_errors: parsed.errors,
      timing_diagnostic: parsed.effectiveTimingDiagnostic,
    };
  }
  const canonicalized = canonicalizeCorporateActionAnalyzerResult(parsed.transport, input, {
    effectiveTimingDiagnostic: parsed.effectiveTimingDiagnostic,
  });
  if (!canonicalized.result) {
    return {
      stage: "validation_error",
      result: null,
      run,
      error: validationErrorMessage(canonicalized.errors, parsed.effectiveTimingDiagnostic),
      validation_errors: canonicalized.errors,
      timing_diagnostic: parsed.effectiveTimingDiagnostic,
    };
  }
  return {
    stage: "complete",
    result: canonicalized.result,
    shareCountObservation: sidecar.candidate,
    shareCountObservationErrors: sidecar.errors,
    run,
    repair: null,
  };
}

function validationErrorMessage(
  errors: readonly string[],
  diagnostic: CorporateActionEffectiveTimingTransportDiagnostic | null,
) {
  const base = errors.join("; ");
  return diagnostic
    ? `${base}; effective_timing_diagnostic=${JSON.stringify(diagnostic)}`
    : base;
}
