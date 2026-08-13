import { getServerEnv } from "../env.ts";
import {
  runStructuredGeminiJson,
  type GeminiStructuredJsonRun,
} from "./geminiStructuredJson.ts";
import {
  LISTING_RISK_ANALYZER_PROVIDER_SCHEMA,
  normalizeListingRiskAnalyzerFactEligibleProviderResult,
  normalizeListingRiskAnalyzerProviderResult,
  type ListingRiskAnalyzerInput,
  type ListingRiskAnalyzerProviderResult,
  type ListingRiskAnalyzerResult,
  validateListingRiskAnalyzerInput,
  validateListingRiskAnalyzerProviderFactEligibility,
  validateListingRiskAnalyzerProviderResult,
} from "../monitor/listingRiskAnalyzer.ts";
import { buildListingRiskDomainAnalysisPrompt } from "../prompts/listingRiskDomainAnalysis.ts";
import { buildListingRiskEvidenceRepairPrompt } from "../prompts/listingRiskEvidenceRepair.ts";
import {
  applyListingRiskEvidenceRepair,
  applyListingRiskEvidenceUnavailable,
  buildListingRiskEvidenceRepairPlan,
  LISTING_RISK_EVIDENCE_REPAIR_SCHEMA,
  readListingRiskEvidenceRepairOutput,
} from "../monitor/listingRiskEvidenceRepair.ts";

export type ListingRiskEvidenceRepairAttempt = {
  invoked: true;
  max_attempts: 1;
  initial_validation_errors: string[];
  initial_evidence_lengths: Array<{ source_ref: string; length: number }>;
  repaired_evidence_lengths: Array<{ source_ref: string; length: number }>;
  semantic_facts_changed: false;
  evidence_unavailable_source_refs: string[];
  evidence_format_errors: string[];
  final_validation_errors: string[];
  run: GeminiStructuredJsonRun;
};

export type ListingRiskDomainAnalyzerPreviewResult =
  | {
      stage: "complete";
      result: ListingRiskAnalyzerResult;
      run: GeminiStructuredJsonRun;
      repair: ListingRiskEvidenceRepairAttempt | null;
    }
  | {
      stage: "configuration_error" | "input_error" | "provider_error" | "validation_error" | "repair_error";
      result: null;
      run: GeminiStructuredJsonRun | null;
      error: string;
      validation_errors?: string[];
      repair?: ListingRiskEvidenceRepairAttempt;
    };

export async function runListingRiskDomainAnalyzerPreview(
  input: ListingRiskAnalyzerInput,
  options: {
    apiKey?: string;
    model?: string;
    maxOutputTokens?: number;
    runPrompt?: typeof runStructuredGeminiJson;
    runRepairPrompt?: typeof runStructuredGeminiJson;
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
  let providerResult = run.parsed;
  let repair: ListingRiskEvidenceRepairAttempt | null = null;
  if (validationErrors.length) {
    const repairPlan = buildListingRiskEvidenceRepairPlan(run.parsed, input);
    if (!repairPlan) {
      return {
        stage: "validation_error",
        result: null,
        run,
        error: validationErrors.join("; "),
        validation_errors: validationErrors,
      };
    }

    const repairPrompt = buildListingRiskEvidenceRepairPrompt(repairPlan);
    const repairRun = await (options.runRepairPrompt || options.runPrompt || runStructuredGeminiJson)({
      apiKey,
      model,
      prompt: repairPrompt,
      maxOutputTokens: 1_000,
      responseSchema: LISTING_RISK_EVIDENCE_REPAIR_SCHEMA as unknown as Record<string, unknown>,
    });
    const repairOutput = repairRun.parsed
      ? readListingRiskEvidenceRepairOutput(repairRun.parsed, repairPlan)
      : { output: null, errors: [repairRun.error || "Listing Risk evidence repair provider request failed"] };
    const evidenceUnavailableResult = repairRun.ok && repairRun.responseOk && repairRun.parsed && !repairOutput.output
      ? applyListingRiskEvidenceUnavailable(repairPlan, repairRun.parsed, repairOutput.errors)
      : null;
    if (!repairRun.ok || !repairRun.responseOk || (!repairOutput.output && !evidenceUnavailableResult)) {
      repair = {
        invoked: true,
        max_attempts: 1,
        initial_validation_errors: validationErrors,
        initial_evidence_lengths: repairPlan.targets.map((target) => ({
          source_ref: target.source_ref,
          length: target.original_length,
        })),
        repaired_evidence_lengths: [],
        semantic_facts_changed: false,
        evidence_unavailable_source_refs: [],
        evidence_format_errors: [],
        final_validation_errors: repairOutput.errors,
        run: repairRun,
      };
      return {
        stage: "repair_error",
        result: null,
        run,
        repair,
        error: repairOutput.errors.join("; "),
        validation_errors: repairOutput.errors,
      };
    }

    providerResult = repairOutput.output
      ? applyListingRiskEvidenceRepair(repairPlan, repairOutput.output)
      : evidenceUnavailableResult as ListingRiskAnalyzerProviderResult;
    const finalValidationErrors = evidenceUnavailableResult
      ? validateListingRiskAnalyzerProviderFactEligibility(providerResult, input)
      : validateListingRiskAnalyzerProviderResult(providerResult, input);
    repair = {
      invoked: true,
      max_attempts: 1,
      initial_validation_errors: validationErrors,
      initial_evidence_lengths: repairPlan.targets.map((target) => ({
        source_ref: target.source_ref,
        length: target.original_length,
      })),
      repaired_evidence_lengths: (repairOutput.output?.evidence_repairs || []).map((item) => ({
        source_ref: item.source_ref,
        length: Array.from(item.evidence).length,
      })),
      semantic_facts_changed: false,
      evidence_unavailable_source_refs: evidenceUnavailableResult
        ? repairPlan.targets.map((target) => target.source_ref)
        : [],
      evidence_format_errors: evidenceUnavailableResult ? repairOutput.errors : [],
      final_validation_errors: finalValidationErrors,
      run: repairRun,
    };
    if (finalValidationErrors.length) {
      return {
        stage: "repair_error",
        result: null,
        run,
        repair,
        error: finalValidationErrors.join("; "),
        validation_errors: finalValidationErrors,
      };
    }
  }

  const result = repair?.evidence_unavailable_source_refs.length
    ? normalizeListingRiskAnalyzerFactEligibleProviderResult(providerResult, input)
    : normalizeListingRiskAnalyzerProviderResult(providerResult, input);
  if (!result) {
    return {
      stage: "validation_error",
      result: null,
      run,
      error: "Listing Risk analyzer result is invalid",
      validation_errors: validateListingRiskAnalyzerProviderResult(providerResult, input),
      ...(repair ? { repair } : {}),
    };
  }
  return { stage: "complete", result, run, repair };
}
