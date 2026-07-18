import { getServerEnv } from "@/lib/env";
import {
  SEC_424B_ANALYSIS_PROMPT_KEY,
  SEC_424B_ANALYSIS_PROMPT_VERSION,
  SEC_424B_VALIDATION_REPAIR_PROMPT_KEY,
  SEC_8K_6K_VALIDATION_REPAIR_PROMPT_KEY,
  SEC_8K_6K_ROUTER_PROMPT_KEY,
  SEC_8K_6K_ROUTER_PROMPT_VERSION,
  SEC_425_ANALYSIS_PROMPT_KEY,
  SEC_425_ANALYSIS_PROMPT_VERSION,
  SEC_425_ROUTER_PROMPT_KEY,
  SEC_425_ROUTER_PROMPT_VERSION,
  SEC_OWNERSHIP_ANALYSIS_PROMPT_KEY,
  SEC_OWNERSHIP_ANALYSIS_PROMPT_VERSION,
  SEC_OWNERSHIP_VALIDATION_REPAIR_PROMPT_KEY,
  SEC_NT_ANALYSIS_PROMPT_KEY,
  SEC_NT_ANALYSIS_PROMPT_VERSION,
  SEC_S3_AMENDMENT_TRIAGE_PROMPT_KEY,
  SEC_S3_AMENDMENT_TRIAGE_PROMPT_VERSION,
  SEC_S3_OFFERING_ANALYSIS_PROMPT_KEY,
  SEC_S3_VALIDATION_REPAIR_PROMPT_KEY,
  SEC_S1_F1_ANALYSIS_PROMPT_KEY,
  SEC_S1_F1_ANALYSIS_PROMPT_VERSION,
  SEC_S1_F1_VALIDATION_REPAIR_PROMPT_KEY,
  SEC_PROXY_VALIDATION_REPAIR_PROMPT_KEY,
  SEC_TENDER_ANALYSIS_PROMPT_KEY,
  SEC_SC13_ANALYSIS_PROMPT_KEY,
  SEC_SC13_ANALYSIS_PROMPT_VERSION,
  SEC_SC13_VALIDATION_REPAIR_PROMPT_KEY,
  SEC_S4_F4_VALIDATION_REPAIR_PROMPT_KEY,
  SEC_S8_ANALYSIS_PROMPT_KEY,
  SEC_S8_ANALYSIS_PROMPT_VERSION,
  SEC_S8_VALIDATION_REPAIR_PROMPT_KEY,
  adaptSec424bAnalysisPromptResultForAnalysis,
  applySec424bValidationRepairPatches,
  adaptSec8k6kAnalysisPromptResultForAnalysis,
  applySec8k6kArchiveSafetyGate,
  applySec8k6kReverseSplitRouteGuard,
  applySec8k6kValidationRepairPatches,
  adaptSec425AnalysisPromptResultForAnalysis,
  adaptOwnershipPromptResultForAnalysis,
  adaptSecNtAnalysisPromptResultForAnalysis,
  applySecNtValidationRepairPatches,
  adaptSecPeriodicReportsAnalysisPromptResultForAnalysis,
  applySecPeriodicReportsValidationRepairPatches,
  applySecOwnershipValidationRepairPatches,
  adaptSecTenderAnalysisPromptResultForAnalysis,
  adaptSecSc13AnalysisPromptResultForAnalysis,
  applySecSc13ValidationRepairPatches,
  adaptSecS4F4AnalysisPromptResultForAnalysis,
  applySecS4F4ValidationRepairPatches,
  adaptSecS8AnalysisPromptResultForAnalysis,
  applySecS8ValidationRepairPatches,
  adaptSecS3AnalysisPromptResultForAnalysis,
  applySecS3ValidationRepairPatches,
  adaptSecS1F1AnalysisPromptResultForAnalysis,
  applySecS1F1ValidationRepairPatches,
  applySecProxyValidationRepairPatches,
  buildDeterministicSc13Analysis,
  buildDeterministicOwnershipAnalysis,
  buildDeterministicS8ArchiveAnalysis,
  buildSec424bAnalysisPromptForInput,
  buildSec424bValidationRepairPlan,
  buildSec8k6kAnalysisPromptForInput,
  buildSec8k6kArchiveAnalysis,
  buildSec8k6kPreviewDebug,
  buildSec8k6kRouterPromptForInput,
  buildSec8k6kValidationRepairPlan,
  buildSec425AnalysisPromptForInput,
  buildSec425DeterministicAnalysisForInput,
  buildSec425RouterPromptForInput,
  buildSecOwnershipAnalysisPrompt,
  buildSecNtAnalysisPromptForInput,
  buildSecNtValidationRepairPlan,
  enforceSecNtPostRepairInvariants,
  buildSecOwnershipValidationRepairPlan,
  buildSecPeriodicReportsAnalysisPromptForInput,
  buildSecPeriodicReportsValidationRepairPlan,
  buildSecSc13AnalysisPromptForInput,
  buildSecSc13ValidationRepairPlan,
  buildSecS4F4AnalysisPromptForInput,
  buildSecS4F4ValidationRepairPlan,
  buildSecS8AnalysisPromptForInput,
  buildSecS8ValidationRepairPlan,
  buildSecS3AnalysisPrompt,
  buildSecS3TriagePrompt,
  buildSecS3ValidationRepairPlan,
  buildSecS1F1AnalysisPromptForInput,
  buildSecS1F1ValidationRepairPlan,
  buildSecProxyValidationRepairPlan,
  buildSecTenderAnalysisPromptForInput,
  is424bFilingInput,
  isSec8k6kAnalysisPromptKey,
  isSec8k6kFilingInput,
  isSec425FilingInput,
  isOwnershipFilingInput,
  isSecNtFilingInput,
  isSecPeriodicReportsFilingInput,
  isSc13FilingInput,
  isS4F4FilingInput,
  isS8FilingInput,
  isS3AmendmentInput,
  isS3FilingInput,
  isS1F1FilingInput,
  isTenderFilingInput,
  normalizeSec8k6kRouterResult,
  normalizeSec425RouterResultForInput,
  shouldRunSec8k6kAnalysis,
  shouldRunSec425Analysis,
} from "@/lib/ai/secFormAnalysisAdapterRegistry";
import {
  appendSecProxyDisplayWarnings,
  validateSecProxyDisplayPayload,
} from "@/lib/ai/secProxyAnalysisAdapter";
import { buildSecFilingAnalysisPackage } from "@/lib/prompts/secFilingAnalysisPackage";
import {
  buildSecFilingAnalysisPrompt,
  secFilingAnalysisResponseSchema,
  type SecFilingAnalysisInput,
} from "@/lib/prompts/secFilingAnalysis";
import {
  applySecOfferingScorePolicy,
  buildSecOfferingDilutionMetrics,
  resolveSecOfferingMarketContext,
} from "@/lib/secOfferingMarketContext";
import {
  buildSecInvestableUniverseSkipAnalysis,
  evaluateSecInvestableUniverse,
  type SecInvestableUniverseGateResult,
} from "@/lib/ai/secInvestableUniverseGate";
import { analyzeEffectFiling } from "@/lib/sources/sec/forms/effect/analysis";
import type {
  EffectFilingInput,
  EffectParentFilingContext,
} from "@/lib/sources/sec/forms/effect/types";
import { buildS1F1LlmSourceInput } from "@/lib/sources/sec/forms/s1-f1/sourceInput";
import type { S1F1ParserOutput } from "@/lib/sources/sec/forms/s1-f1/types";
import {
  attachSecParentContexts,
  prepareSecRawItemWithParentContextForParser,
} from "@/lib/secStores/parentContextResolver";
import { parseSecS3Filing, type SecS3FilingFacts } from "@/lib/sources/sec/forms/s3-f3/parser";
import { parseSc13Filing } from "@/lib/sources/sec/forms/sc13/parser";
import type { Sc13ParserOutput } from "@/lib/sources/sec/forms/sc13/types";
import {
  buildProxyAnalysisPrompt,
  SEC_PROXY_ANALYSIS_PROMPT_KEY,
  SEC_PROXY_ANALYSIS_PROMPT_VERSION,
} from "@/lib/sources/sec/forms/proxy/analysisPrompt";
import type { ProxyParserOutput } from "@/lib/sources/sec/forms/proxy/parser";
import { buildProxySourceBlockPromptInput } from "@/lib/sources/sec/forms/proxy/sourceInput";
import { buildSecSourceBlockPromptInput } from "@/lib/sources/sec/forms/8k-6k/sourceBlockPromptInput";
import { applySecForm25PostAnalysisGuards } from "@/lib/sources/sec/forms/form25/analysisGuards";
import { buildSecForm25AnalysisPromptDraft } from "@/lib/sources/sec/forms/form25/analysisPrompt";
import { scoreSecForm25RelatedFormType } from "@/lib/sources/sec/forms/form25/lifecyclePolicy";
import type { SecForm25ParserOutput } from "@/lib/sources/sec/forms/form25/parser";
import {
  applySecForm25ValidationRepairPatches,
  buildSecForm25ValidationRepairPlan,
  inspectSecForm25ValidationRepairIssues,
} from "@/lib/sources/sec/forms/form25/validationRepair";
import { supabaseSelect } from "@/lib/supabase";

type PreviewOptions = {
  dryRun?: boolean;
  rawItemId?: string;
  accessionNumber?: string;
  ticker?: string;
  calendarCandidate?: boolean;
} & SecLlmOptions;

type RawItemRow = Record<string, unknown>;

type OpenAIResponseBody = {
  id?: string;
  status?: string;
  output_text?: string;
  usage?: OpenAIUsage;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  error?: {
    message?: string;
  };
};

type GeminiResponseBody = {
  responseId?: string;
  modelVersion?: string;
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
    [key: string]: unknown;
  };
  error?: {
    message?: string;
  };
};

type OpenAIUsage = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  input_tokens_details?: {
    cached_tokens?: number;
  };
  output_tokens_details?: {
    reasoning_tokens?: number;
  };
  [key: string]: unknown;
};

type SecLlmProvider = "openai" | "gemini";

type SecLlmOptions = {
  llmProvider?: string;
  llmModel?: string;
  secPromptVariant?: string;
};

type SecLlmConfig = {
  provider: SecLlmProvider;
  model: string;
  fallbackModel?: string;
  apiKey: string;
  apiKeyEnvName: "OPENAI_API_KEY" | "GEMINI_API_KEY";
};

type Sec425AnalysisModelPlan = {
  selectedBlockCount: number;
  sourceDocumentCount: number;
  selectedTextChars: number;
  hasComplexDocument: boolean;
  selectedModel: "gemini-2.5-flash-lite" | "gemini-2.5-flash";
  reason: string;
};

const SEC_425_GEMINI_LITE_MODEL = "gemini-2.5-flash-lite";
const SEC_425_GEMINI_FLASH_MODEL = "gemini-2.5-flash";
const SEC_425_COMPLEX_DOCUMENT_ROLES = new Set([
  "investor_presentation",
  "transaction_agreement",
  "agreement_amendment",
  "stockholder_agreement",
  "employment_agreement",
]);

type CostEstimate = {
  model: string;
  currency: "USD";
  estimatedUsd: number;
  inputTokens: number;
  cachedInputTokens: number;
  billedInputTokens: number;
  outputTokens: number;
  inputUsdPerMillion: number;
  cachedInputUsdPerMillion: number;
  outputUsdPerMillion: number;
  pricing: string;
};

export type OpenAiPrompt = {
  key: string;
  version: string;
  system: string;
  user: string;
  responseFormat: {
    json_schema: Record<string, unknown>;
  };
};

type OpenAiPromptRun = {
  ok: boolean;
  status: number;
  provider: SecLlmProvider;
  model: string;
  openAiResponseId: string | null;
  outputText: string;
  parsed: Record<string, unknown> | null;
  usage: OpenAIUsage | null;
  attempts: number;
  error?: string;
  rawOpenAIResponse?: OpenAIResponseBody | GeminiResponseBody | null;
};

const SEC_LLM_MAX_ATTEMPTS = 3;
const SEC_S1_F1_ROUTE_ONLY_PROMPT_KEY = "sec_s1_f1_route_only";
const SEC_S1_F1_ROUTE_ONLY_PROMPT_VERSION = "s1-f1-route-only-v2-amendment-gate";
const SEC_LLM_RUNAWAY_OUTPUT_CHARS = 30_000;

export type SecFilingAnalysisRunResult = {
  ok: boolean;
  stage: "raw_item" | "openai" | "complete";
  status: number;
  model?: string;
  routerModel?: string;
  analysisModel?: string | null;
  analysisModelPlan?: Sec425AnalysisModelPlan;
  openAiResponseId?: string | null;
  auditOpenAiResponseId?: string | null;
  repairOpenAiResponseId?: string | null;
  sourceItem?: ReturnType<typeof summarizeRawRow>;
  input?: SecFilingAnalysisInput;
  triage?: Record<string, unknown> | null;
  audit?: Record<string, unknown> | null;
  analysis?: Record<string, unknown> | null;
  triageOutputText?: string;
  auditOutputText?: string;
  repairOutputText?: string;
  outputText?: string;
  triageUsage?: OpenAIUsage | null;
  auditUsage?: OpenAIUsage | null;
  repairUsage?: OpenAIUsage | null;
  usage?: OpenAIUsage | null;
  costEstimate?: CostEstimate | null;
  prompt?: {
    key: string;
    version: string;
    provider?: SecLlmProvider;
    model?: string;
    system?: string;
    responseFormat?: unknown;
    triage?: {
      key: string;
      version: string;
      system?: string;
      responseFormat?: unknown;
    };
    audit?: {
      key: string;
      version: string;
      system?: string;
      responseFormat?: unknown;
    };
    repair?: {
      key: string;
      version: string;
      system?: string;
      responseFormat?: unknown;
    };
  };
  error?: string;
  rawOpenAIResponse?: OpenAIResponseBody | GeminiResponseBody | null;
  validationRepair?: Record<string, unknown> | null;
  sec8k6kDebug?: Record<string, unknown> | null;
  form25ValidationRepair?: Record<string, unknown> | null;
};

export async function runSecFilingAnalysisPreview(options: PreviewOptions = {}) {
  const rawResult = await findSecRawItem(options);
  if (!rawResult.ok || !rawResult.rawItem) {
    return {
      ok: false,
      stage: "raw_item",
      status: rawResult.status,
      error: rawResult.error || "SEC raw item not found",
    };
  }

  const input = await buildInputFromSecRawRowWithContext(rawResult.rawItem);
  const prompt = buildSecFilingPromptForInput(input, options);
  const triagePrompt = isS3AmendmentInput(input) ? buildSecS3TriagePrompt(input) : null;

  const investableUniverseGate = evaluateSecInvestableUniverse(input);
  if (investableUniverseGate) {
    return buildSecInvestableUniverseSkipRun(
      rawResult.rawItem,
      input,
      buildSecInvestableUniverseSkipAnalysis(input, investableUniverseGate),
      investableUniverseGate,
    );
  }

  if (options.dryRun) {
    return {
      ok: true,
      stage: "dry_run",
      sourceItem: summarizeRawRow(rawResult.rawItem),
      input,
      prompt: {
        key: prompt.key,
        version: prompt.version,
        system: prompt.system,
        responseFormat: prompt.responseFormat,
        triage: triagePrompt
          ? {
              key: triagePrompt.key,
              version: triagePrompt.version,
              system: triagePrompt.system,
              responseFormat: triagePrompt.responseFormat,
            }
          : undefined,
      },
      audit: null,
      analysis: null,
    };
  }

  const analysisResult = await runSecFilingAnalysisForRawRow(rawResult.rawItem, options);

  return {
    ...analysisResult,
    stage: analysisResult.ok ? "complete" : analysisResult.stage,
  };
}

export async function runSecFilingAnalysisPreviewForRawItem(
  rawItem: RawItemRow,
  options: ({ dryRun?: boolean; allowLlm?: boolean } & SecLlmOptions) = {},
) {
  const input = await buildInputFromSecRawRowWithContext(rawItem);
  const prompt = buildSecFilingPromptForInput(input, options);
  const triagePrompt = isS3AmendmentInput(input) ? buildSecS3TriagePrompt(input) : null;

  const investableUniverseGate = evaluateSecInvestableUniverse(input);
  if (investableUniverseGate) {
    return buildSecInvestableUniverseSkipRun(
      rawItem,
      input,
      buildSecInvestableUniverseSkipAnalysis(input, investableUniverseGate),
      investableUniverseGate,
    );
  }

  if (options.dryRun !== false) {
    return {
      ok: true,
      stage: "dry_run",
      sourceItem: summarizeRawRow(rawItem),
      input,
      prompt: {
        key: prompt.key,
        version: prompt.version,
        system: prompt.system,
        responseFormat: prompt.responseFormat,
        triage: triagePrompt
          ? {
              key: triagePrompt.key,
              version: triagePrompt.version,
              system: triagePrompt.system,
              responseFormat: triagePrompt.responseFormat,
            }
          : undefined,
      },
      audit: null,
      analysis: null,
    };
  }

  if (options.allowLlm === false) {
    return runSecFilingAnalysisWithoutLlmForRawRow(rawItem, input, options);
  }

  const analysisResult = await runSecFilingAnalysisForRawRow(rawItem, options);
  return {
    ...analysisResult,
    stage: analysisResult.ok ? "complete" : analysisResult.stage,
  };
}

export async function runSecS1F1RouteOnlyPreviewForRawItem(rawItem: RawItemRow, options: SecLlmOptions = {}) {
  const input = await buildInputFromSecRawRowWithContext(rawItem);
  const parserOutput = readS1F1ParserOutputForRoute(input);
  if (!parserOutput) {
    return {
      ok: false,
      stage: "route_only",
      status: 400,
      sourceItem: summarizeRawRow(rawItem),
      error: "S-1/F-1 parser output is missing from filing package.",
    };
  }

  const env = getServerEnv();
  const llmConfig = resolveSecLlmConfig(env, options);
  const prompt = buildS1F1RouteOnlyPrompt(parserOutput);
  const run = await runOpenAiJsonPrompt(env, prompt, llmConfig);

  return {
    ok: run.ok,
    stage: "route_only",
    status: run.status,
    model: run.model,
    openAiResponseId: run.openAiResponseId,
    sourceItem: summarizeRawRow(rawItem),
    input: buildS1F1RouteOnlyInput(parserOutput),
    route: run.parsed,
    outputText: run.outputText,
    usage: run.usage,
    costEstimate: estimateCost(run.model, run.usage),
    rawOpenAIResponse: run.rawOpenAIResponse,
    prompt: {
      key: prompt.key,
      version: prompt.version,
      provider: run.provider,
      model: run.model,
      system: prompt.system,
      responseFormat: prompt.responseFormat,
    },
    error: run.ok ? undefined : run.error || "S-1/F-1 route-only prompt failed.",
  };
}

export async function runSec8k6kRouteOnlyPreviewForRawItem(rawItem: RawItemRow, options: SecLlmOptions = {}) {
  const input = await buildInputFromSecRawRowWithContext(rawItem);
  if (!isSec8k6kFilingInput(input)) {
    return {
      ok: false,
      stage: "route_only",
      status: 400,
      sourceItem: summarizeRawRow(rawItem),
      error: "8-K/6-K parser output is missing from filing package.",
    };
  }

  const env = getServerEnv();
  const llmConfig = resolveSecLlmConfig(env, options, input);
  const prompt = buildSec8k6kRouterPromptForInput(input);
  const run = await runSec8k6kRouterPrompt(env, prompt, llmConfig);
  const route = run.parsed
    ? applySec8k6kArchiveSafetyGate(
        applySec8k6kReverseSplitRouteGuard(
          normalizeSec8k6kRouterResult(run.parsed),
          input,
          prompt.user,
        ),
        input,
      )
    : null;

  return {
    ok: run.ok && Boolean(route),
    stage: "route_only",
    status: run.status,
    model: run.model,
    openAiResponseId: run.openAiResponseId,
    sourceItem: summarizeRawRow(rawItem),
    input,
    route,
    sec8k6kDebug: route
      ? buildSec8k6kPreviewDebug({
          routerResult: route,
          routerPromptUser: prompt.user,
          analysisSkipped: true,
        })
      : null,
    outputText: run.outputText,
    usage: run.usage,
    costEstimate: estimateCost(run.model, run.usage),
    rawOpenAIResponse: run.rawOpenAIResponse,
    prompt: {
      key: prompt.key,
      version: prompt.version,
      provider: run.provider,
      model: run.model,
      system: prompt.system,
      responseFormat: prompt.responseFormat,
    },
    error: run.ok && route ? undefined : run.error || "8-K/6-K route-only prompt failed.",
  };
}

export async function runSec425RouteOnlyPreviewForRawItem(rawItem: RawItemRow, options: SecLlmOptions = {}) {
  const input = await buildInputFromSecRawRowWithContext(rawItem);
  if (!isSec425FilingInput(input)) {
    return {
      ok: false,
      stage: "route_only",
      status: 400,
      sourceItem: summarizeRawRow(rawItem),
      error: "SEC 425 parser output is missing from filing package.",
    };
  }

  const env = getServerEnv();
  const llmConfig = resolveSecLlmConfig(env, options);
  const prompt = buildSec425RouterPromptForInput(input);
  const run = await runOpenAiJsonPrompt(env, prompt, llmConfig);
  const route = run.ok && run.parsed
    ? normalizeSec425RouterResultForInput(run.parsed, input)
    : null;

  return {
    ok: Boolean(run.ok && route),
    stage: "route_only",
    status: run.status,
    model: run.model,
    openAiResponseId: run.openAiResponseId,
    sourceItem: summarizeRawRow(rawItem),
    input: JSON.parse(prompt.user) as Record<string, unknown>,
    relatedTransactionContext:
      readRecord(readRecord(readRecord(input.filing_package)?.filing_context)?.related_transaction) || null,
    route,
    outputText: run.outputText,
    usage: run.usage,
    costEstimate: estimateCost(run.model, run.usage),
    rawOpenAIResponse: run.rawOpenAIResponse,
    prompt: {
      key: SEC_425_ROUTER_PROMPT_KEY,
      version: SEC_425_ROUTER_PROMPT_VERSION,
      provider: run.provider,
      model: run.model,
      system: prompt.system,
      responseFormat: prompt.responseFormat,
    },
    error: run.ok && route ? undefined : run.error || "SEC 425 route-only prompt failed.",
  };
}

async function runSecFilingAnalysisWithoutLlmForRawRow(
  rawItem: RawItemRow,
  input: SecFilingAnalysisInput,
  options: { secPromptVariant?: string } = {},
): Promise<SecFilingAnalysisRunResult> {
  if (isS3AmendmentInput(input)) {
    return {
      ok: false,
      stage: "openai",
      status: 0,
      error: "SEC S-3/A amendment triage requires LLM review.",
      model: getServerEnv().openAiModel,
      sourceItem: summarizeRawRow(rawItem),
      input,
      prompt: {
        key: SEC_S3_AMENDMENT_TRIAGE_PROMPT_KEY,
        version: SEC_S3_AMENDMENT_TRIAGE_PROMPT_VERSION,
      },
    };
  }

  const deterministicEffect = buildDeterministicEffectAnalysis(input, rawItem);
  if (deterministicEffect) {
    return buildDeterministicEffectRun(rawItem, input, deterministicEffect);
  }

  const deterministicOwnership = buildDeterministicOwnershipAnalysis(input);
  if (deterministicOwnership) {
    if (!deterministicOwnership.ok) {
      return {
        ok: false,
        stage: "openai",
        status: 0,
        error: deterministicOwnership.error,
        sourceItem: summarizeRawRow(rawItem),
        input,
        prompt: {
          key: SEC_OWNERSHIP_ANALYSIS_PROMPT_KEY,
          version: SEC_OWNERSHIP_ANALYSIS_PROMPT_VERSION,
        },
      };
    }

    const archiveGuard = evaluateOwnershipArchiveContextGuard(input);
    attachOwnershipArchiveContextGuard(input, archiveGuard);
    if (!archiveGuard.analysis_needed) {
      return {
        ok: true,
        stage: "complete",
        status: 200,
        model: getServerEnv().openAiModel,
        openAiResponseId: null,
        sourceItem: summarizeRawRow(rawItem),
        input,
        analysis: deterministicOwnership.analysis,
        usage: null,
        costEstimate: null,
        prompt: {
          key: SEC_OWNERSHIP_ANALYSIS_PROMPT_KEY,
          version: SEC_OWNERSHIP_ANALYSIS_PROMPT_VERSION,
        },
      };
    }
  }

  const deterministicSc13 = buildDeterministicSc13Analysis(input);
  if (deterministicSc13) {
    if (!deterministicSc13.ok) {
      return {
        ok: false,
        stage: "openai",
        status: 0,
        error: deterministicSc13.error,
        sourceItem: summarizeRawRow(rawItem),
        input,
        prompt: {
          key: SEC_SC13_ANALYSIS_PROMPT_KEY,
          version: SEC_SC13_ANALYSIS_PROMPT_VERSION,
        },
      };
    }

    return {
      ok: true,
      stage: "complete",
      status: 200,
      model: getServerEnv().openAiModel,
      openAiResponseId: null,
      sourceItem: summarizeRawRow(rawItem),
      input,
      analysis: deterministicSc13.analysis,
      usage: null,
      costEstimate: null,
      prompt: {
        key: SEC_SC13_ANALYSIS_PROMPT_KEY,
        version: SEC_SC13_ANALYSIS_PROMPT_VERSION,
      },
    };
  }

  const deterministicS8 = buildDeterministicS8ArchiveAnalysis(input);
  if (deterministicS8) {
    if (!deterministicS8.ok) {
      return {
        ok: false,
        stage: "openai",
        status: 0,
        error: deterministicS8.error,
        sourceItem: summarizeRawRow(rawItem),
        input,
        prompt: {
          key: SEC_S8_ANALYSIS_PROMPT_KEY,
          version: SEC_S8_ANALYSIS_PROMPT_VERSION,
        },
      };
    }

    return {
      ok: true,
      stage: "complete",
      status: 200,
      model: getServerEnv().openAiModel,
      openAiResponseId: null,
      sourceItem: summarizeRawRow(rawItem),
      input,
      analysis: deterministicS8.analysis,
      usage: null,
      costEstimate: null,
      prompt: {
        key: SEC_S8_ANALYSIS_PROMPT_KEY,
        version: SEC_S8_ANALYSIS_PROMPT_VERSION,
      },
    };
  }

  const prompt = buildSecFilingPromptForInput(input, options);
  return {
    ok: false,
    stage: "openai",
    status: 0,
    error: "LLM required but disabled for SEC analysis dry-run",
    sourceItem: summarizeRawRow(rawItem),
    input,
    prompt: {
      key: prompt.key,
      version: prompt.version,
    },
  };
}

export async function runSecFilingAnalysisForRawRow(
  rawItem: RawItemRow,
  options: SecLlmOptions = {},
): Promise<SecFilingAnalysisRunResult> {
  const input = await buildInputFromSecRawRowWithParentContext(rawItem);
  await attachSecMarketContext(input);
  await attachOwnershipFilingContext(input, rawItem);

  const deterministicEffect = buildDeterministicEffectAnalysis(input, rawItem);
  if (deterministicEffect) {
    return buildDeterministicEffectRun(rawItem, input, deterministicEffect);
  }

  const investableUniverseGate = evaluateSecInvestableUniverse(input);
  if (investableUniverseGate) {
    return buildSecInvestableUniverseSkipRun(
      rawItem,
      input,
      buildSecInvestableUniverseSkipAnalysis(input, investableUniverseGate),
      investableUniverseGate,
    );
  }

  const deterministicOwnership = buildDeterministicOwnershipAnalysis(input);
  if (deterministicOwnership) {
    if (!deterministicOwnership.ok) {
      return {
        ok: false,
        stage: "openai",
        status: 0,
        error: deterministicOwnership.error,
        sourceItem: summarizeRawRow(rawItem),
        input,
      };
    }

    const archiveGuard = evaluateOwnershipArchiveContextGuard(input);
    attachOwnershipArchiveContextGuard(input, archiveGuard);
    if (archiveGuard.analysis_needed) {
      // Keep going into the normal ownership LLM path below. The parser archive
      // result is still available through deterministic_parser_archive.
    } else {
      return {
        ok: true,
        stage: "complete",
        status: 200,
        model: getServerEnv().openAiModel,
        openAiResponseId: null,
        sourceItem: summarizeRawRow(rawItem),
        input,
        analysis: deterministicOwnership.analysis,
        usage: null,
        costEstimate: null,
        prompt: {
          key: SEC_OWNERSHIP_ANALYSIS_PROMPT_KEY,
          version: SEC_OWNERSHIP_ANALYSIS_PROMPT_VERSION,
        },
      };
    }
  }

  const deterministicSc13 = buildDeterministicSc13Analysis(input);
  if (deterministicSc13) {
    if (!deterministicSc13.ok) {
      return {
        ok: false,
        stage: "openai",
        status: 0,
        error: deterministicSc13.error,
        sourceItem: summarizeRawRow(rawItem),
        input,
      };
    }

    return {
      ok: true,
      stage: "complete",
      status: 200,
      model: getServerEnv().openAiModel,
      openAiResponseId: null,
      sourceItem: summarizeRawRow(rawItem),
      input,
      analysis: deterministicSc13.analysis,
      usage: null,
      costEstimate: null,
      prompt: {
        key: SEC_SC13_ANALYSIS_PROMPT_KEY,
        version: SEC_SC13_ANALYSIS_PROMPT_VERSION,
      },
    };
  }

  const deterministicS8 = buildDeterministicS8ArchiveAnalysis(input);
  if (deterministicS8) {
    if (!deterministicS8.ok) {
      return {
        ok: false,
        stage: "openai",
        status: 0,
        error: deterministicS8.error,
        sourceItem: summarizeRawRow(rawItem),
        input,
      };
    }

    return {
      ok: true,
      stage: "complete",
      status: 200,
      model: getServerEnv().openAiModel,
      openAiResponseId: null,
      sourceItem: summarizeRawRow(rawItem),
      input,
      analysis: deterministicS8.analysis,
      usage: null,
      costEstimate: null,
      prompt: {
        key: SEC_S8_ANALYSIS_PROMPT_KEY,
        version: SEC_S8_ANALYSIS_PROMPT_VERSION,
      },
    };
  }

  const env = getServerEnv();
  const llmConfig = resolveSecLlmConfig(env, options, input);

  if (!llmConfig.apiKey) {
    return {
      ok: false,
      stage: "openai",
      status: 0,
      error: `${llmConfig.apiKeyEnvName} is missing`,
      sourceItem: summarizeRawRow(rawItem),
      input,
    };
  }

  let triage: Record<string, unknown> | null = null;
  let triageRun: OpenAiPromptRun | null = null;
  if (isS3AmendmentInput(input)) {
    const triagePrompt = buildSecS3TriagePrompt(input);
    triageRun = await runOpenAiJsonPrompt(env, triagePrompt, llmConfig);
    if (!triageRun.ok || !triageRun.parsed) {
      return {
        ok: false,
        stage: "openai",
        status: triageRun.status,
        error: `SEC S-3/A triage failed after ${triageRun.attempts} attempt(s): ${triageRun.error || "no parseable JSON"}`,
        sourceItem: summarizeRawRow(rawItem),
        input,
        triageOutputText: triageRun.outputText,
        triageUsage: triageRun.usage,
        rawOpenAIResponse: triageRun.rawOpenAIResponse,
        prompt: {
          key: triagePrompt.key,
          version: triagePrompt.version,
        },
      };
    }

    triage = triageRun.parsed;
    if (!triage) {
      return {
        ok: false,
        stage: "openai",
        status: 0,
        error: "SEC S-3/A triage did not produce a decision",
        sourceItem: summarizeRawRow(rawItem),
        input,
        triage: null,
      };
    }
    if (shouldForceS3AmendmentAudit(input, triage)) {
      triage = {
        ...triage,
        triage_action: "needs_offering_audit",
        material_change: true,
        material_change_reasons: [
          ...readStringArray(triage.material_change_reasons),
          "Concrete S-3/A offering or resale terms present without parent registration context",
        ].slice(0, 4),
        needs_human_review: true,
      };
    }
    attachS3AmendmentTriage(input, triage);

    if (stringValue(triage.triage_action) === "skip_analysis") {
      const usage = combineUsage(triageRun?.usage || null);
      const analysis = buildS3AmendmentSkipAnalysis(input, triage);
      return {
        ok: true,
        stage: "complete",
        status: triageRun?.status || 200,
        model: llmConfig.model,
        openAiResponseId: triageRun?.openAiResponseId || null,
        sourceItem: summarizeRawRow(rawItem),
        input,
        triage,
        audit: null,
        analysis,
        triageOutputText: triageRun?.outputText,
        triageUsage: triageRun?.usage || null,
        usage,
        costEstimate: estimateCost(llmConfig.model, usage),
        prompt: {
          key: SEC_S3_AMENDMENT_TRIAGE_PROMPT_KEY,
          version: SEC_S3_AMENDMENT_TRIAGE_PROMPT_VERSION,
          triage: {
            key: SEC_S3_AMENDMENT_TRIAGE_PROMPT_KEY,
            version: SEC_S3_AMENDMENT_TRIAGE_PROMPT_VERSION,
          },
        },
      };
    }
  }

  if (isOwnershipFilingInput(input)) {
    const prompt = buildSecOwnershipAnalysisPrompt(input);
    const analysisRun = await runOpenAiJsonPrompt(env, prompt, llmConfig);
    if (!analysisRun.ok || !analysisRun.parsed) {
      return {
        ok: false,
        stage: "openai",
        status: analysisRun.status,
        error: `SEC ownership analysis failed after ${analysisRun.attempts} attempt(s): ${analysisRun.error || "no parseable JSON"}`,
        sourceItem: summarizeRawRow(rawItem),
        input,
        outputText: analysisRun.outputText,
        usage: analysisRun.usage,
        rawOpenAIResponse: analysisRun.rawOpenAIResponse,
        prompt: {
          key: prompt.key,
          version: prompt.version,
        },
      };
    }

    const repairPlan = buildSecOwnershipValidationRepairPlan({
      analysisResult: analysisRun.parsed,
      input,
    });
    let repairedValue = analysisRun.parsed;
    let repairRun: OpenAiPromptRun | null = null;
    let repairAppliedPaths: string[] = [];
    let repairIgnoredPaths: string[] = [];
    let repairUnresolved: unknown[] = [];
    if (repairPlan) {
      repairRun = await runOpenAiJsonPrompt(env, repairPlan.prompt, llmConfig, {
        maxAttempts: 1,
        disableFallback: true,
      });
      if (repairRun.ok && repairRun.parsed) {
        const repairApplication = applySecOwnershipValidationRepairPatches({
          analysisResult: analysisRun.parsed,
          repairResult: repairRun.parsed,
          allowedPatchPaths: repairPlan.allowedPatchPaths,
        });
        repairedValue = repairApplication.value;
        repairAppliedPaths = repairApplication.appliedPaths;
        repairIgnoredPaths = repairApplication.ignoredPaths;
        repairUnresolved = repairApplication.unresolved;
      }
    }
    const usage = combineUsage(analysisRun.usage, repairRun?.usage);
    const validationRepair = repairPlan
      ? {
          attempted: true,
          succeeded: Boolean(repairRun?.ok && repairRun.parsed),
          issue_codes: repairPlan.issues.map((issue) => issue.code),
          source_block_ids: repairPlan.sourceBlockIds,
          allowed_patch_paths: repairPlan.allowedPatchPaths,
          applied_patch_paths: repairAppliedPaths,
          ignored_patch_paths: repairIgnoredPaths,
          unresolved: repairUnresolved,
          error: repairRun?.error || null,
        }
      : { attempted: false };
    const ownershipAnalysis = adaptOwnershipPromptResultForAnalysis(repairedValue, input);
    if (!ownershipAnalysis.ok) {
      return {
        ok: false,
        stage: "openai",
        status: analysisRun.status,
        error: ownershipAnalysis.error,
        sourceItem: summarizeRawRow(rawItem),
        input,
        outputText: analysisRun.outputText,
        repairOutputText: repairRun?.outputText,
        usage,
        repairUsage: repairRun?.usage,
        rawOpenAIResponse: analysisRun.rawOpenAIResponse,
        validationRepair,
        prompt: {
          key: prompt.key,
          version: prompt.version,
          repair: repairPlan
            ? {
                key: repairPlan.prompt.key,
                version: repairPlan.prompt.version,
                system: repairPlan.prompt.system,
                responseFormat: repairPlan.prompt.responseFormat,
              }
            : undefined,
        },
      };
    }

    return {
      ok: true,
      stage: "complete",
      status: analysisRun.status,
      model: llmConfig.model,
      openAiResponseId: analysisRun.openAiResponseId,
      repairOpenAiResponseId: repairRun?.openAiResponseId || null,
      sourceItem: summarizeRawRow(rawItem),
      input,
      analysis: ownershipAnalysis.analysis,
      outputText: analysisRun.outputText,
      repairOutputText: repairRun?.outputText,
      usage,
      repairUsage: repairRun?.usage,
      costEstimate: estimateCost(llmConfig.model, usage),
      validationRepair,
      prompt: {
        key: prompt.key,
        version: prompt.version,
        repair: repairPlan
          ? {
              key: repairPlan.prompt.key,
              version: repairPlan.prompt.version,
              system: repairPlan.prompt.system,
              responseFormat: repairPlan.prompt.responseFormat,
            }
          : undefined,
      },
    };
  }

  if (isSec425FilingInput(input)) {
    const routerPrompt = buildSec425RouterPromptForInput(input);
    const routerLlmConfig = resolveSec425RouterLlmConfig(llmConfig, options);
    const routerRun = await runOpenAiJsonPrompt(env, routerPrompt, routerLlmConfig);
    if (!routerRun.ok || !routerRun.parsed) {
      return {
        ok: false,
        stage: "openai",
        status: routerRun.status,
        error: `SEC 425 router failed after ${routerRun.attempts} attempt(s): ${routerRun.error || "no parseable JSON"}`,
        sourceItem: summarizeRawRow(rawItem),
        input,
        triageOutputText: routerRun.outputText,
        triageUsage: routerRun.usage,
        rawOpenAIResponse: routerRun.rawOpenAIResponse,
        prompt: {
          key: SEC_425_ROUTER_PROMPT_KEY,
          version: SEC_425_ROUTER_PROMPT_VERSION,
        },
      };
    }
    const routerResult = normalizeSec425RouterResultForInput(routerRun.parsed, input);

    if (!shouldRunSec425Analysis(routerResult)) {
      const archiveAnalysis = buildSec425DeterministicAnalysisForInput(input, routerResult);
      if (!archiveAnalysis?.ok) {
        return {
          ok: false,
          stage: "openai",
          status: routerRun.status,
          error: archiveAnalysis?.error || "SEC 425 router skipped analysis without a deterministic archive result.",
          sourceItem: summarizeRawRow(rawItem),
          input,
          triage: routerResult,
          triageOutputText: routerRun.outputText,
          triageUsage: routerRun.usage,
          rawOpenAIResponse: routerRun.rawOpenAIResponse,
          prompt: {
            key: SEC_425_ROUTER_PROMPT_KEY,
            version: SEC_425_ROUTER_PROMPT_VERSION,
          },
        };
      }

      const usage = combineUsage(routerRun.usage);
      return {
        ok: true,
        stage: "complete",
        status: routerRun.status,
        model: routerRun.model,
        routerModel: routerRun.model,
        analysisModel: null,
        openAiResponseId: routerRun.openAiResponseId,
        sourceItem: summarizeRawRow(rawItem),
        input,
        triage: routerResult,
        analysis: archiveAnalysis.analysis,
        triageOutputText: routerRun.outputText,
        triageUsage: routerRun.usage,
        usage,
        costEstimate: estimateCost(routerRun.model, usage),
        prompt: {
          key: SEC_425_ROUTER_PROMPT_KEY,
          version: SEC_425_ROUTER_PROMPT_VERSION,
          triage: {
            key: SEC_425_ROUTER_PROMPT_KEY,
            version: SEC_425_ROUTER_PROMPT_VERSION,
          },
        },
      };
    }

    const prompt = buildSec425AnalysisPromptForInput(input, routerResult);
    const analysisModelPlan = buildSec425AnalysisModelPlan(prompt, llmConfig);
    const analysisLlmConfig = resolveSec425AnalysisLlmConfig(llmConfig, options, analysisModelPlan);
    const analysisRun = await runOpenAiJsonPrompt(env, prompt, analysisLlmConfig, {
      retryRunawayOnce: true,
    });
    if (!analysisRun.ok || !analysisRun.parsed) {
      return {
        ok: false,
        stage: "openai",
        status: analysisRun.status,
        error: `SEC 425 analysis failed after ${analysisRun.attempts} attempt(s): ${analysisRun.error || "no parseable JSON"}`,
        sourceItem: summarizeRawRow(rawItem),
        input,
        triage: routerResult,
        triageOutputText: routerRun.outputText,
        triageUsage: routerRun.usage,
        outputText: analysisRun.outputText,
        routerModel: routerRun.model,
        analysisModel: analysisRun.model,
        analysisModelPlan,
        usage: combineUsage(routerRun.usage, analysisRun.usage),
        rawOpenAIResponse: analysisRun.rawOpenAIResponse,
        prompt: {
          key: SEC_425_ANALYSIS_PROMPT_KEY,
          version: SEC_425_ANALYSIS_PROMPT_VERSION,
          triage: {
            key: SEC_425_ROUTER_PROMPT_KEY,
            version: SEC_425_ROUTER_PROMPT_VERSION,
          },
        },
      };
    }

    let finalSec425Value = analysisRun.parsed;
    let sec425Analysis = adaptSec425AnalysisPromptResultForAnalysis(
      analysisRun.parsed,
      input,
      routerResult,
    );
    if (!sec425Analysis.ok) {
      return {
        ok: false,
        stage: "openai",
        status: analysisRun.status,
        error: sec425Analysis.error,
        sourceItem: summarizeRawRow(rawItem),
        input,
        triage: routerResult,
        triageOutputText: routerRun.outputText,
        triageUsage: routerRun.usage,
        outputText: analysisRun.outputText,
        routerModel: routerRun.model,
        analysisModel: analysisRun.model,
        analysisModelPlan,
        usage: combineUsage(routerRun.usage, analysisRun.usage),
        rawOpenAIResponse: analysisRun.rawOpenAIResponse,
        prompt: {
          key: SEC_425_ANALYSIS_PROMPT_KEY,
          version: SEC_425_ANALYSIS_PROMPT_VERSION,
          triage: {
            key: SEC_425_ROUTER_PROMPT_KEY,
            version: SEC_425_ROUTER_PROMPT_VERSION,
          },
        },
      };
    }

    const sec425ValidationWarnings = readStringArray(
      sec425Analysis.analysis.sec_425_validation_warnings,
    );
    const sec425RepairWarnings = sec425ValidationWarnings.filter((warning) =>
      /(?:key_evidence|current_changes|snapshot)/i.test(warning),
    );
    const validationRepairPrompt = sec425RepairWarnings.length > 0
      ? buildSec425ValidationRepairPrompt(prompt, analysisRun.parsed, sec425RepairWarnings)
      : null;
    const validationRepairRun = validationRepairPrompt
      ? await runOpenAiJsonPrompt(env, validationRepairPrompt, analysisLlmConfig, {
          maxAttempts: 1,
          disableFallback: true,
        })
      : null;
    let validationRepairApplied = false;

    if (validationRepairRun?.ok && validationRepairRun.parsed) {
      const repairedValue = applySec425ValidationRepair(
        analysisRun.parsed,
        validationRepairRun.parsed,
        sec425RepairWarnings,
      );
      const repairedAnalysis = adaptSec425AnalysisPromptResultForAnalysis(
        repairedValue,
        input,
        routerResult,
      );
      if (repairedAnalysis.ok) {
        finalSec425Value = repairedValue;
        sec425Analysis = repairedAnalysis;
        validationRepairApplied = true;
      }
    }

    const usage = combineUsage(routerRun.usage, analysisRun.usage, validationRepairRun?.usage);
    return {
      ok: true,
      stage: "complete",
      status: analysisRun.status,
      model: analysisRun.model,
      routerModel: routerRun.model,
      analysisModel: analysisRun.model,
      analysisModelPlan,
      openAiResponseId: analysisRun.openAiResponseId,
      sourceItem: summarizeRawRow(rawItem),
      input,
      triage: routerResult,
      analysis: sec425Analysis.analysis,
      triageOutputText: routerRun.outputText,
      outputText: analysisRun.outputText,
      repairOutputText: validationRepairRun?.outputText,
      triageUsage: routerRun.usage,
      repairUsage: validationRepairRun?.usage,
      usage,
      costEstimate: estimateCost(analysisRun.model, usage),
      repairOpenAiResponseId: validationRepairRun?.openAiResponseId || null,
      validationRepair: validationRepairPrompt
        ? {
            attempted: true,
            succeeded: validationRepairApplied,
            issue_codes: buildSec425RepairIssueCodes(sec425RepairWarnings),
            error: validationRepairRun?.error || null,
          }
        : null,
      prompt: {
        key: SEC_425_ANALYSIS_PROMPT_KEY,
        version: SEC_425_ANALYSIS_PROMPT_VERSION,
        triage: {
            key: SEC_425_ROUTER_PROMPT_KEY,
            version: SEC_425_ROUTER_PROMPT_VERSION,
          },
        repair: validationRepairPrompt
          ? {
              key: validationRepairPrompt.key,
              version: validationRepairPrompt.version,
              system: validationRepairPrompt.system,
              responseFormat: validationRepairPrompt.responseFormat,
            }
          : undefined,
      },
    };
  }

  if (isSec8k6kFilingInput(input)) {
    const routerPrompt = buildSec8k6kRouterPromptForInput(input);
    const routerRun = await runSec8k6kRouterPrompt(env, routerPrompt, llmConfig);
    if (!routerRun.ok || !routerRun.parsed) {
      return {
        ok: false,
        stage: "openai",
        status: routerRun.status,
        error: `SEC 8-K/6-K router failed after ${routerRun.attempts} attempt(s): ${routerRun.error || "no parseable JSON"}`,
        sourceItem: summarizeRawRow(rawItem),
        input,
        triageOutputText: routerRun.outputText,
        triageUsage: routerRun.usage,
        rawOpenAIResponse: routerRun.rawOpenAIResponse,
        prompt: {
          key: routerPrompt.key,
          version: routerPrompt.version,
        },
      };
    }
    const routerResult = applySec8k6kArchiveSafetyGate(
      applySec8k6kReverseSplitRouteGuard(
        normalizeSec8k6kRouterResult(routerRun.parsed),
        input,
        routerPrompt.user,
      ),
      input,
    );

    if (!shouldRunSec8k6kAnalysis(routerResult)) {
      const archiveAnalysis = buildSec8k6kArchiveAnalysis(input, routerResult);
      const sec8k6kDebug = {
        ...buildSec8k6kPreviewDebug({
          routerResult,
          routerPromptUser: routerPrompt.user,
          analysisSkipped: true,
        }),
        router_llm: summarizeSecLlmRun(routerRun),
      };
      if (!archiveAnalysis.ok) {
        return {
          ok: false,
          stage: "openai",
          status: routerRun.status,
          error: archiveAnalysis.error,
          sourceItem: summarizeRawRow(rawItem),
          input,
          triage: routerResult,
          sec8k6kDebug,
          triageOutputText: routerRun.outputText,
          triageUsage: routerRun.usage,
          rawOpenAIResponse: routerRun.rawOpenAIResponse,
          prompt: {
            key: SEC_8K_6K_ROUTER_PROMPT_KEY,
            version: SEC_8K_6K_ROUTER_PROMPT_VERSION,
          },
        };
      }

      const usage = combineUsage(routerRun.usage);
      return {
        ok: true,
        stage: "complete",
        status: routerRun.status,
        model: llmConfig.model,
        openAiResponseId: routerRun.openAiResponseId,
        sourceItem: summarizeRawRow(rawItem),
        input,
        triage: routerResult,
        sec8k6kDebug,
        analysis: archiveAnalysis.analysis,
        triageOutputText: routerRun.outputText,
        triageUsage: routerRun.usage,
        usage,
        costEstimate: estimateCost(llmConfig.model, usage),
        prompt: {
          key: SEC_8K_6K_ROUTER_PROMPT_KEY,
          version: SEC_8K_6K_ROUTER_PROMPT_VERSION,
          triage: {
            key: SEC_8K_6K_ROUTER_PROMPT_KEY,
            version: SEC_8K_6K_ROUTER_PROMPT_VERSION,
          },
        },
      };
    }

    const prompt = buildSec8k6kAnalysisPromptForInput(input, routerResult);
    let sec8k6kDebug: Record<string, unknown> = {
      ...buildSec8k6kPreviewDebug({
        routerResult,
        routerPromptUser: routerPrompt.user,
        analysisPromptUser: prompt.user,
        analysisSkipped: false,
      }),
      router_llm: summarizeSecLlmRun(routerRun),
    };
    const analysisRun = await runOpenAiJsonPrompt(env, prompt, llmConfig);
    sec8k6kDebug = {
      ...sec8k6kDebug,
      analysis_llm: summarizeSecLlmRun(analysisRun),
    };
    if (!analysisRun.ok || !analysisRun.parsed) {
      return {
        ok: false,
        stage: "openai",
        status: analysisRun.status,
        error: `SEC 8-K/6-K analysis failed after ${analysisRun.attempts} attempt(s): ${analysisRun.error || "no parseable JSON"}`,
        sourceItem: summarizeRawRow(rawItem),
        input,
        triage: routerResult,
        sec8k6kDebug,
        triageOutputText: routerRun.outputText,
        triageUsage: routerRun.usage,
        outputText: analysisRun.outputText,
        usage: combineUsage(routerRun.usage, analysisRun.usage),
        rawOpenAIResponse: analysisRun.rawOpenAIResponse,
        prompt: {
          key: prompt.key,
          version: prompt.version,
          triage: {
            key: SEC_8K_6K_ROUTER_PROMPT_KEY,
            version: SEC_8K_6K_ROUTER_PROMPT_VERSION,
          },
        },
      };
    }

    let sec8k6kAnalysis = adaptSec8k6kAnalysisPromptResultForAnalysis(analysisRun.parsed, input, routerResult);
    if (!sec8k6kAnalysis.ok) {
      return {
        ok: false,
        stage: "openai",
        status: analysisRun.status,
        error: sec8k6kAnalysis.error,
        sourceItem: summarizeRawRow(rawItem),
        input,
        triage: routerResult,
        sec8k6kDebug,
        triageOutputText: routerRun.outputText,
        triageUsage: routerRun.usage,
        outputText: analysisRun.outputText,
        usage: combineUsage(routerRun.usage, analysisRun.usage),
        rawOpenAIResponse: analysisRun.rawOpenAIResponse,
        prompt: {
          key: prompt.key,
          version: prompt.version,
          triage: {
            key: SEC_8K_6K_ROUTER_PROMPT_KEY,
            version: SEC_8K_6K_ROUTER_PROMPT_VERSION,
          },
        },
      };
    }

    const repairPlan = buildSec8k6kValidationRepairPlan({
      analysisResult: analysisRun.parsed,
      analysisPromptUser: prompt.user,
      additionalSourceBlocks: () => buildCurrentReportAmendmentRepairSourceBlocks(input),
    });
    let repairRun: OpenAiPromptRun | null = null;
    let appliedPatchPaths: string[] = [];
    let ignoredPatchPaths: string[] = [];
    let rationaleFallbackPaths: string[] = [];
    let unresolvedWarningCodes: string[] = [];
    let repairAdaptationError: string | null = null;

    if (repairPlan) {
      repairRun = await runOpenAiJsonPrompt(env, repairPlan.prompt, llmConfig, {
        maxAttempts: 1,
        disableFallback: true,
      });
      if (repairRun.ok && repairRun.parsed) {
        const repaired = applySec8k6kValidationRepairPatches({
          analysisResult: analysisRun.parsed,
          repairResult: repairRun.parsed,
          allowedPatchPaths: repairPlan.allowedPatchPaths,
        });
        appliedPatchPaths = repaired.appliedPatchPaths;
        ignoredPatchPaths = repaired.ignoredPatchPaths;
        rationaleFallbackPaths = repaired.rationaleFallbackPaths;
        unresolvedWarningCodes = repaired.unresolvedWarningCodes;
        if (appliedPatchPaths.length) {
          const repairedAnalysis = adaptSec8k6kAnalysisPromptResultForAnalysis(
            repaired.analysisResult,
            input,
            routerResult,
          );
          if (repairedAnalysis.ok) sec8k6kAnalysis = repairedAnalysis;
          else repairAdaptationError = repairedAnalysis.error;
        }
      }

      sec8k6kDebug = {
        ...sec8k6kDebug,
        validation_repair: {
          attempted: true,
          max_attempts: 1,
          run_ok: repairRun.ok,
          run_error: repairRun.error || null,
          llm_run: summarizeSecLlmRun(repairRun),
          issue_codes: repairPlan.issues.map((issue) => issue.code),
          source_block_ids: repairPlan.sourceBlockIds,
          allowed_patch_paths: repairPlan.allowedPatchPaths,
          applied_patch_paths: appliedPatchPaths,
          ignored_patch_paths: ignoredPatchPaths,
          rationale_fallback_paths: rationaleFallbackPaths,
          unresolved_warning_codes: unresolvedWarningCodes,
          adaptation_error: repairAdaptationError,
          remaining_display_warnings: sec8k6kAnalysis.ok
            ? readSec8k6kDisplayWarnings(sec8k6kAnalysis.analysis)
            : [],
        },
      };
    }

    const usage = combineUsage(routerRun.usage, analysisRun.usage, repairRun?.usage);
    return {
      ok: true,
      stage: "complete",
      status: analysisRun.status,
      model: llmConfig.model,
      openAiResponseId: analysisRun.openAiResponseId,
      repairOpenAiResponseId: repairRun?.openAiResponseId || null,
      sourceItem: summarizeRawRow(rawItem),
      input,
      triage: routerResult,
      sec8k6kDebug,
      analysis: sec8k6kAnalysis.analysis,
      triageOutputText: routerRun.outputText,
      outputText: analysisRun.outputText,
      repairOutputText: repairRun?.outputText,
      triageUsage: routerRun.usage,
      repairUsage: repairRun?.usage,
      usage,
      costEstimate: estimateCost(llmConfig.model, usage),
      prompt: {
        key: prompt.key,
        version: prompt.version,
        triage: {
          key: SEC_8K_6K_ROUTER_PROMPT_KEY,
          version: SEC_8K_6K_ROUTER_PROMPT_VERSION,
        },
      },
    };
  }

  if (isTenderFilingInput(input)) {
    const prompt = buildSecTenderAnalysisPromptForInput(input);
    const analysisRun = await runOpenAiJsonPrompt(env, prompt, llmConfig);
    if (!analysisRun.ok || !analysisRun.parsed) {
      return {
        ok: false,
        stage: "openai",
        status: analysisRun.status,
        error: `SEC tender analysis failed after ${analysisRun.attempts} attempt(s): ${analysisRun.error || "no parseable JSON"}`,
        sourceItem: summarizeRawRow(rawItem),
        input,
        outputText: analysisRun.outputText,
        usage: analysisRun.usage,
        rawOpenAIResponse: analysisRun.rawOpenAIResponse,
        prompt: {
          key: prompt.key,
          version: prompt.version,
        },
      };
    }

    const tenderAnalysis = adaptSecTenderAnalysisPromptResultForAnalysis(analysisRun.parsed, input);
    if (!tenderAnalysis.ok) {
      return {
        ok: false,
        stage: "openai",
        status: analysisRun.status,
        error: tenderAnalysis.error,
        sourceItem: summarizeRawRow(rawItem),
        input,
        outputText: analysisRun.outputText,
        usage: analysisRun.usage,
        rawOpenAIResponse: analysisRun.rawOpenAIResponse,
        prompt: {
          key: prompt.key,
          version: prompt.version,
        },
      };
    }

    return {
      ok: true,
      stage: "complete",
      status: analysisRun.status,
      model: llmConfig.model,
      openAiResponseId: analysisRun.openAiResponseId,
      sourceItem: summarizeRawRow(rawItem),
      input,
      analysis: tenderAnalysis.analysis,
      outputText: analysisRun.outputText,
      usage: analysisRun.usage,
      costEstimate: estimateCost(llmConfig.model, analysisRun.usage),
      prompt: {
        key: prompt.key,
        version: prompt.version,
      },
    };
  }

  if (isSc13FilingInput(input)) {
    const prompt = buildSecSc13AnalysisPromptForInput(input);
    const analysisRun = await runOpenAiJsonPrompt(env, prompt, llmConfig);
    if (!analysisRun.ok || !analysisRun.parsed) {
      return {
        ok: false,
        stage: "openai",
        status: analysisRun.status,
        error: `SEC SC13 analysis failed after ${analysisRun.attempts} attempt(s): ${analysisRun.error || "no parseable JSON"}`,
        sourceItem: summarizeRawRow(rawItem),
        input,
        outputText: analysisRun.outputText,
        usage: analysisRun.usage,
        rawOpenAIResponse: analysisRun.rawOpenAIResponse,
        prompt: {
          key: prompt.key,
          version: prompt.version,
        },
      };
    }

    const repairPlan = buildSecSc13ValidationRepairPlan({
      analysisResult: analysisRun.parsed,
      input,
    });
    let repairedValue = analysisRun.parsed;
    let repairRun: OpenAiPromptRun | null = null;
    let repairAppliedPaths: string[] = [];
    let repairIgnoredPaths: string[] = [];
    let repairUnresolved: unknown[] = [];
    if (repairPlan) {
      repairRun = await runOpenAiJsonPrompt(env, repairPlan.prompt, llmConfig, {
        maxAttempts: 1,
        disableFallback: true,
      });
      if (repairRun.ok && repairRun.parsed) {
        const repairApplication = applySecSc13ValidationRepairPatches({
          analysisResult: analysisRun.parsed,
          repairResult: repairRun.parsed,
          allowedPatchPaths: repairPlan.allowedPatchPaths,
        });
        repairedValue = repairApplication.value;
        repairAppliedPaths = repairApplication.appliedPaths;
        repairIgnoredPaths = repairApplication.ignoredPaths;
        repairUnresolved = repairApplication.unresolved;
      }
    }
    const usage = combineUsage(analysisRun.usage, repairRun?.usage);
    const validationRepair = repairPlan
      ? {
          attempted: true,
          succeeded: Boolean(repairRun?.ok && repairRun.parsed),
          issue_codes: repairPlan.issues.map((issue) => issue.code),
          source_block_ids: repairPlan.sourceBlockIds,
          allowed_patch_paths: repairPlan.allowedPatchPaths,
          applied_patch_paths: repairAppliedPaths,
          ignored_patch_paths: repairIgnoredPaths,
          unresolved: repairUnresolved,
          error: repairRun?.error || null,
        }
      : { attempted: false };
    const sc13Analysis = adaptSecSc13AnalysisPromptResultForAnalysis(repairedValue, input);
    if (!sc13Analysis.ok) {
      return {
        ok: false,
        stage: "openai",
        status: analysisRun.status,
        error: sc13Analysis.error,
        sourceItem: summarizeRawRow(rawItem),
        input,
        outputText: analysisRun.outputText,
        repairOutputText: repairRun?.outputText,
        usage,
        repairUsage: repairRun?.usage,
        rawOpenAIResponse: analysisRun.rawOpenAIResponse,
        validationRepair,
        prompt: {
          key: prompt.key,
          version: prompt.version,
          repair: repairPlan
            ? {
                key: repairPlan.prompt.key,
                version: repairPlan.prompt.version,
                system: repairPlan.prompt.system,
                responseFormat: repairPlan.prompt.responseFormat,
              }
            : undefined,
        },
      };
    }

    return {
      ok: true,
      stage: "complete",
      status: analysisRun.status,
      model: llmConfig.model,
      openAiResponseId: analysisRun.openAiResponseId,
      repairOpenAiResponseId: repairRun?.openAiResponseId || null,
      sourceItem: summarizeRawRow(rawItem),
      input,
      analysis: sc13Analysis.analysis,
      outputText: analysisRun.outputText,
      repairOutputText: repairRun?.outputText,
      usage,
      repairUsage: repairRun?.usage,
      costEstimate: estimateCost(llmConfig.model, usage),
      validationRepair,
      prompt: {
        key: prompt.key,
        version: prompt.version,
        repair: repairPlan
          ? {
              key: repairPlan.prompt.key,
              version: repairPlan.prompt.version,
              system: repairPlan.prompt.system,
              responseFormat: repairPlan.prompt.responseFormat,
            }
          : undefined,
      },
    };
  }

  if (isS4F4FilingInput(input)) {
    const prompt = buildSecS4F4AnalysisPromptForInput(input);
    const analysisRun = await runOpenAiJsonPrompt(env, prompt, llmConfig);
    if (!analysisRun.ok || !analysisRun.parsed) {
      return {
        ok: false,
        stage: "openai",
        status: analysisRun.status,
        error: `SEC S-4/F-4 analysis failed after ${analysisRun.attempts} attempt(s): ${analysisRun.error || "no parseable JSON"}`,
        sourceItem: summarizeRawRow(rawItem),
        input,
        outputText: analysisRun.outputText,
        usage: analysisRun.usage,
        rawOpenAIResponse: analysisRun.rawOpenAIResponse,
        prompt: {
          key: prompt.key,
          version: prompt.version,
        },
      };
    }

    const repairPlan = buildSecS4F4ValidationRepairPlan({
      analysisResult: analysisRun.parsed,
      input,
    });
    let repairedValue = analysisRun.parsed;
    let repairRun: OpenAiPromptRun | null = null;
    let repairAppliedPaths: string[] = [];
    let repairIgnoredPaths: string[] = [];
    let repairUnresolved: unknown[] = [];
    if (repairPlan) {
      repairRun = await runOpenAiJsonPrompt(env, repairPlan.prompt, llmConfig, {
        maxAttempts: 1,
        disableFallback: true,
      });
      if (repairRun.ok && repairRun.parsed) {
        const repairApplication = applySecS4F4ValidationRepairPatches({
          analysisResult: analysisRun.parsed,
          repairResult: repairRun.parsed,
          allowedPatchPaths: repairPlan.allowedPatchPaths,
        });
        repairedValue = repairApplication.value;
        repairAppliedPaths = repairApplication.appliedPaths;
        repairIgnoredPaths = repairApplication.ignoredPaths;
        repairUnresolved = repairApplication.unresolved;
      }
    }
    const usage = combineUsage(analysisRun.usage, repairRun?.usage);
    const validationRepair = repairPlan
      ? {
          attempted: true,
          succeeded: Boolean(repairRun?.ok && repairRun.parsed),
          issue_codes: repairPlan.issues.map((issue) => issue.code),
          source_block_ids: repairPlan.sourceBlockIds,
          allowed_patch_paths: repairPlan.allowedPatchPaths,
          applied_patch_paths: repairAppliedPaths,
          ignored_patch_paths: repairIgnoredPaths,
          unresolved: repairUnresolved,
          error: repairRun?.error || null,
        }
      : { attempted: false };
    const s4F4Analysis = adaptSecS4F4AnalysisPromptResultForAnalysis(repairedValue, input);
    if (!s4F4Analysis.ok) {
      return {
        ok: false,
        stage: "openai",
        status: analysisRun.status,
        error: s4F4Analysis.error,
        sourceItem: summarizeRawRow(rawItem),
        input,
        outputText: analysisRun.outputText,
        repairOutputText: repairRun?.outputText,
        usage,
        repairUsage: repairRun?.usage,
        rawOpenAIResponse: analysisRun.rawOpenAIResponse,
        validationRepair,
        prompt: {
          key: prompt.key,
          version: prompt.version,
          repair: repairPlan
            ? {
                key: repairPlan.prompt.key,
                version: repairPlan.prompt.version,
                system: repairPlan.prompt.system,
                responseFormat: repairPlan.prompt.responseFormat,
              }
            : undefined,
        },
      };
    }

    return {
      ok: true,
      stage: "complete",
      status: analysisRun.status,
      model: llmConfig.model,
      openAiResponseId: analysisRun.openAiResponseId,
      repairOpenAiResponseId: repairRun?.openAiResponseId || null,
      sourceItem: summarizeRawRow(rawItem),
      input,
      analysis: s4F4Analysis.analysis,
      outputText: analysisRun.outputText,
      repairOutputText: repairRun?.outputText,
      usage,
      repairUsage: repairRun?.usage,
      costEstimate: estimateCost(llmConfig.model, usage),
      validationRepair,
      prompt: {
        key: prompt.key,
        version: prompt.version,
        repair: repairPlan
          ? {
              key: repairPlan.prompt.key,
              version: repairPlan.prompt.version,
              system: repairPlan.prompt.system,
              responseFormat: repairPlan.prompt.responseFormat,
            }
          : undefined,
      },
    };
  }

  if (isS8FilingInput(input)) {
    const prompt = buildSecS8AnalysisPromptForInput(input);
    const analysisRun = await runOpenAiJsonPrompt(env, prompt, llmConfig);
    if (!analysisRun.ok || !analysisRun.parsed) {
      return {
        ok: false,
        stage: "openai",
        status: analysisRun.status,
        error: `SEC S-8 analysis failed after ${analysisRun.attempts} attempt(s): ${analysisRun.error || "no parseable JSON"}`,
        sourceItem: summarizeRawRow(rawItem),
        input,
        outputText: analysisRun.outputText,
        usage: analysisRun.usage,
        rawOpenAIResponse: analysisRun.rawOpenAIResponse,
        prompt: {
          key: prompt.key,
          version: prompt.version,
        },
      };
    }

    const repairPlan = buildSecS8ValidationRepairPlan({
      analysisResult: analysisRun.parsed,
      input,
    });
    let repairedValue = analysisRun.parsed;
    let repairRun: OpenAiPromptRun | null = null;
    let repairAppliedPaths: string[] = [];
    let repairIgnoredPaths: string[] = [];
    let repairUnresolved: unknown[] = [];
    if (repairPlan) {
      repairRun = await runOpenAiJsonPrompt(env, repairPlan.prompt, llmConfig, {
        maxAttempts: 1,
        disableFallback: true,
      });
      if (repairRun.ok && repairRun.parsed) {
        const repairApplication = applySecS8ValidationRepairPatches({
          analysisResult: analysisRun.parsed,
          repairResult: repairRun.parsed,
          allowedPatchPaths: repairPlan.allowedPatchPaths,
        });
        repairedValue = repairApplication.value;
        repairAppliedPaths = repairApplication.appliedPaths;
        repairIgnoredPaths = repairApplication.ignoredPaths;
        repairUnresolved = repairApplication.unresolved;
      }
    }
    const usage = combineUsage(analysisRun.usage, repairRun?.usage);
    const validationRepair = repairPlan
      ? {
          attempted: true,
          succeeded: Boolean(repairRun?.ok && repairRun.parsed),
          issue_codes: repairPlan.issues.map((issue) => issue.code),
          source_block_ids: repairPlan.sourceBlockIds,
          allowed_patch_paths: repairPlan.allowedPatchPaths,
          applied_patch_paths: repairAppliedPaths,
          ignored_patch_paths: repairIgnoredPaths,
          unresolved: repairUnresolved,
          error: repairRun?.error || null,
        }
      : { attempted: false };
    const s8Analysis = adaptSecS8AnalysisPromptResultForAnalysis(repairedValue, input);
    if (!s8Analysis.ok) {
      return {
        ok: false,
        stage: "openai",
        status: analysisRun.status,
        error: s8Analysis.error,
        sourceItem: summarizeRawRow(rawItem),
        input,
        outputText: analysisRun.outputText,
        repairOutputText: repairRun?.outputText,
        usage,
        repairUsage: repairRun?.usage,
        rawOpenAIResponse: analysisRun.rawOpenAIResponse,
        validationRepair,
        prompt: {
          key: prompt.key,
          version: prompt.version,
          repair: repairPlan
            ? {
                key: repairPlan.prompt.key,
                version: repairPlan.prompt.version,
                system: repairPlan.prompt.system,
                responseFormat: repairPlan.prompt.responseFormat,
              }
            : undefined,
        },
      };
    }

    return {
      ok: true,
      stage: "complete",
      status: analysisRun.status,
      model: llmConfig.model,
      openAiResponseId: analysisRun.openAiResponseId,
      repairOpenAiResponseId: repairRun?.openAiResponseId || null,
      sourceItem: summarizeRawRow(rawItem),
      input,
      analysis: s8Analysis.analysis,
      outputText: analysisRun.outputText,
      repairOutputText: repairRun?.outputText,
      usage,
      repairUsage: repairRun?.usage,
      costEstimate: estimateCost(llmConfig.model, usage),
      validationRepair,
      prompt: {
        key: prompt.key,
        version: prompt.version,
        repair: repairPlan
          ? {
              key: repairPlan.prompt.key,
              version: repairPlan.prompt.version,
              system: repairPlan.prompt.system,
              responseFormat: repairPlan.prompt.responseFormat,
            }
          : undefined,
      },
    };
  }

  if (is424bFilingInput(input)) {
    const prompt = buildSec424bAnalysisPromptForInput(input, { promptVariant: options.secPromptVariant });
    const analysisRun = await runOpenAiJsonPrompt(env, prompt, llmConfig);
    if (!analysisRun.ok || !analysisRun.parsed) {
      return {
        ok: false,
        stage: "openai",
        status: analysisRun.status,
        error: `SEC 424B analysis failed after ${analysisRun.attempts} attempt(s): ${analysisRun.error || "no parseable JSON"}`,
        sourceItem: summarizeRawRow(rawItem),
        input,
        outputText: analysisRun.outputText,
        usage: analysisRun.usage,
        rawOpenAIResponse: analysisRun.rawOpenAIResponse,
        prompt: {
          key: prompt.key,
          version: prompt.version,
        },
      };
    }

    const repairPlan = buildSec424bValidationRepairPlan({ analysisResult: analysisRun.parsed, input });
    let repairedValue = analysisRun.parsed;
    let repairRun: OpenAiPromptRun | null = null;
    let repairAppliedPaths: string[] = [];
    let repairIgnoredPaths: string[] = [];
    let repairUnresolved: unknown[] = [];
    if (repairPlan) {
      repairRun = await runOpenAiJsonPrompt(env, repairPlan.prompt, llmConfig, {
        maxAttempts: 1,
        disableFallback: true,
      });
      if (repairRun.ok && repairRun.parsed) {
        const repairApplication = applySec424bValidationRepairPatches({
          analysisResult: analysisRun.parsed,
          repairResult: repairRun.parsed,
          allowedPatchPaths: repairPlan.allowedPatchPaths,
        });
        repairedValue = repairApplication.value;
        repairAppliedPaths = repairApplication.appliedPaths;
        repairIgnoredPaths = repairApplication.ignoredPaths;
        repairUnresolved = repairApplication.unresolved;
      }
    }
    const usage = combineUsage(analysisRun.usage, repairRun?.usage);
    const validationRepair = repairPlan
      ? {
          attempted: true,
          succeeded: Boolean(repairRun?.ok && repairRun.parsed),
          issue_codes: repairPlan.issues.map((issue) => issue.code),
          source_block_ids: repairPlan.sourceBlockIds,
          allowed_patch_paths: repairPlan.allowedPatchPaths,
          applied_patch_paths: repairAppliedPaths,
          ignored_patch_paths: repairIgnoredPaths,
          unresolved: repairUnresolved,
          error: repairRun?.error || null,
        }
      : { attempted: false };
    const sec424bAnalysis = adaptSec424bAnalysisPromptResultForAnalysis(repairedValue, input);
    if (!sec424bAnalysis.ok) {
      return {
        ok: false,
        stage: "openai",
        status: analysisRun.status,
        error: sec424bAnalysis.error,
        sourceItem: summarizeRawRow(rawItem),
        input,
        outputText: analysisRun.outputText,
        repairOutputText: repairRun?.outputText,
        usage,
        repairUsage: repairRun?.usage,
        rawOpenAIResponse: analysisRun.rawOpenAIResponse,
        validationRepair,
        prompt: {
          key: prompt.key,
          version: prompt.version,
          repair: repairPlan
            ? {
                key: repairPlan.prompt.key,
                version: repairPlan.prompt.version,
                system: repairPlan.prompt.system,
                responseFormat: repairPlan.prompt.responseFormat,
              }
            : undefined,
        },
      };
    }

    return {
      ok: true,
      stage: "complete",
      status: analysisRun.status,
      model: llmConfig.model,
      openAiResponseId: analysisRun.openAiResponseId,
      repairOpenAiResponseId: repairRun?.openAiResponseId || null,
      sourceItem: summarizeRawRow(rawItem),
      input,
      analysis: sec424bAnalysis.analysis,
      outputText: analysisRun.outputText,
      repairOutputText: repairRun?.outputText,
      usage,
      repairUsage: repairRun?.usage,
      costEstimate: estimateCost(llmConfig.model, usage),
      validationRepair,
      prompt: {
        key: prompt.key,
        version: prompt.version,
        repair: repairPlan
          ? {
              key: repairPlan.prompt.key,
              version: repairPlan.prompt.version,
              system: repairPlan.prompt.system,
              responseFormat: repairPlan.prompt.responseFormat,
            }
          : undefined,
      },
    };
  }

  if (isS1F1FilingInput(input)) {
    const prompt = buildSecS1F1AnalysisPromptForInput(input, { promptVariant: options.secPromptVariant });
    const analysisRun = await runOpenAiJsonPrompt(env, prompt, llmConfig);
    if (!analysisRun.ok || !analysisRun.parsed) {
      return {
        ok: false,
        stage: "openai",
        status: analysisRun.status,
        error: `SEC S-1/F-1 analysis failed after ${analysisRun.attempts} attempt(s): ${analysisRun.error || "no parseable JSON"}`,
        sourceItem: summarizeRawRow(rawItem),
        input,
        outputText: analysisRun.outputText,
        usage: analysisRun.usage,
        rawOpenAIResponse: analysisRun.rawOpenAIResponse,
        prompt: {
          key: prompt.key,
          version: prompt.version,
        },
      };
    }

    const repairPlan = buildSecS1F1ValidationRepairPlan({
      analysisResult: analysisRun.parsed,
      input,
    });
    let repairedValue = analysisRun.parsed;
    let repairRun: OpenAiPromptRun | null = null;
    let repairAppliedPaths: string[] = [];
    let repairIgnoredPaths: string[] = [];
    let repairUnresolved: unknown[] = [];
    if (repairPlan) {
      repairRun = await runOpenAiJsonPrompt(env, repairPlan.prompt, llmConfig, {
        maxAttempts: 1,
        disableFallback: true,
      });
      if (repairRun.ok && repairRun.parsed) {
        const repairApplication = applySecS1F1ValidationRepairPatches({
          analysisResult: analysisRun.parsed,
          repairResult: repairRun.parsed,
          allowedPatchPaths: repairPlan.allowedPatchPaths,
        });
        repairedValue = repairApplication.value;
        repairAppliedPaths = repairApplication.appliedPaths;
        repairIgnoredPaths = repairApplication.ignoredPaths;
        repairUnresolved = repairApplication.unresolved;
      }
    }
    const usage = combineUsage(analysisRun.usage, repairRun?.usage);
    const secS1F1Analysis = adaptSecS1F1AnalysisPromptResultForAnalysis(repairedValue, input);
    if (!secS1F1Analysis.ok) {
      return {
        ok: false,
        stage: "openai",
        status: analysisRun.status,
        error: secS1F1Analysis.error,
        sourceItem: summarizeRawRow(rawItem),
        input,
        outputText: analysisRun.outputText,
        repairOutputText: repairRun?.outputText,
        usage,
        repairUsage: repairRun?.usage,
        rawOpenAIResponse: analysisRun.rawOpenAIResponse,
        validationRepair: repairPlan
          ? {
              attempted: true,
              succeeded: Boolean(repairRun?.ok && repairRun.parsed),
              issue_codes: repairPlan.issues.map((issue) => issue.code),
              source_block_ids: repairPlan.sourceBlockIds,
              allowed_patch_paths: repairPlan.allowedPatchPaths,
              applied_patch_paths: repairAppliedPaths,
              ignored_patch_paths: repairIgnoredPaths,
              unresolved: repairUnresolved,
              error: repairRun?.error || null,
            }
          : { attempted: false },
        prompt: {
          key: prompt.key,
          version: prompt.version,
          repair: repairPlan
            ? {
                key: repairPlan.prompt.key,
                version: repairPlan.prompt.version,
                system: repairPlan.prompt.system,
                responseFormat: repairPlan.prompt.responseFormat,
              }
            : undefined,
        },
      };
    }

    return {
      ok: true,
      stage: "complete",
      status: analysisRun.status,
      model: llmConfig.model,
      openAiResponseId: analysisRun.openAiResponseId,
      repairOpenAiResponseId: repairRun?.openAiResponseId || null,
      sourceItem: summarizeRawRow(rawItem),
      input,
      analysis: secS1F1Analysis.analysis,
      outputText: analysisRun.outputText,
      repairOutputText: repairRun?.outputText,
      usage,
      repairUsage: repairRun?.usage,
      costEstimate: estimateCost(llmConfig.model, usage),
      validationRepair: repairPlan
        ? {
            attempted: true,
            succeeded: Boolean(repairRun?.ok && repairRun.parsed),
            issue_codes: repairPlan.issues.map((issue) => issue.code),
            source_block_ids: repairPlan.sourceBlockIds,
            allowed_patch_paths: repairPlan.allowedPatchPaths,
            applied_patch_paths: repairAppliedPaths,
            ignored_patch_paths: repairIgnoredPaths,
            unresolved: repairUnresolved,
            error: repairRun?.error || null,
          }
        : { attempted: false },
      prompt: {
        key: prompt.key,
        version: prompt.version,
        repair: repairPlan
          ? {
              key: repairPlan.prompt.key,
              version: repairPlan.prompt.version,
              system: repairPlan.prompt.system,
              responseFormat: repairPlan.prompt.responseFormat,
            }
          : undefined,
      },
    };
  }

  if (isS3FilingInput(input)) {
    await attachSecMarketContext(input);
    const prompt = buildSecS3AnalysisPrompt(input);
    const analysisRun = await runOpenAiJsonPrompt(env, prompt, llmConfig);
    if (!analysisRun.ok || !analysisRun.parsed) {
      return {
        ok: false,
        stage: "openai",
        status: analysisRun.status,
        error: `SEC S3 analysis failed after ${analysisRun.attempts} attempt(s): ${analysisRun.error || "no parseable JSON"}`,
        sourceItem: summarizeRawRow(rawItem),
        input,
        outputText: analysisRun.outputText,
        usage: analysisRun.usage,
        rawOpenAIResponse: analysisRun.rawOpenAIResponse,
        prompt: {
          key: prompt.key,
          version: prompt.version,
        },
      };
    }

    const repairPlan = buildSecS3ValidationRepairPlan({
      analysisResult: analysisRun.parsed,
      input,
    });
    let repairedValue = analysisRun.parsed;
    let repairRun: OpenAiPromptRun | null = null;
    let repairAppliedPaths: string[] = [];
    let repairIgnoredPaths: string[] = [];
    let repairUnresolved: unknown[] = [];
    if (repairPlan) {
      repairRun = await runOpenAiJsonPrompt(env, repairPlan.prompt, llmConfig, {
        maxAttempts: 1,
        disableFallback: true,
      });
      if (repairRun.ok && repairRun.parsed) {
        const repairApplication = applySecS3ValidationRepairPatches({
          analysisResult: analysisRun.parsed,
          repairResult: repairRun.parsed,
          allowedPatchPaths: repairPlan.allowedPatchPaths,
        });
        repairedValue = repairApplication.value;
        repairAppliedPaths = repairApplication.appliedPaths;
        repairIgnoredPaths = repairApplication.ignoredPaths;
        repairUnresolved = repairApplication.unresolved;
      }
    }
    const usage = combineUsage(analysisRun.usage, repairRun?.usage);
    const validationRepair = repairPlan
      ? {
          attempted: true,
          succeeded: Boolean(repairRun?.ok && repairRun.parsed),
          issue_codes: repairPlan.issues.map((issue) => issue.code),
          source_block_ids: repairPlan.sourceBlockIds,
          allowed_patch_paths: repairPlan.allowedPatchPaths,
          applied_patch_paths: repairAppliedPaths,
          ignored_patch_paths: repairIgnoredPaths,
          unresolved: repairUnresolved,
          error: repairRun?.error || null,
        }
      : { attempted: false };
    const secS3Analysis = adaptSecS3AnalysisPromptResultForAnalysis(repairedValue, input);
    if (!secS3Analysis.ok) {
      return {
        ok: false,
        stage: "openai",
        status: analysisRun.status,
        error: secS3Analysis.error,
        sourceItem: summarizeRawRow(rawItem),
        input,
        outputText: analysisRun.outputText,
        repairOutputText: repairRun?.outputText,
        usage,
        repairUsage: repairRun?.usage,
        rawOpenAIResponse: analysisRun.rawOpenAIResponse,
        validationRepair,
        prompt: {
          key: prompt.key,
          version: prompt.version,
          repair: repairPlan
            ? {
                key: repairPlan.prompt.key,
                version: repairPlan.prompt.version,
                system: repairPlan.prompt.system,
                responseFormat: repairPlan.prompt.responseFormat,
              }
            : undefined,
        },
      };
    }

    return {
      ok: true,
      stage: "complete",
      status: analysisRun.status,
      model: llmConfig.model,
      openAiResponseId: analysisRun.openAiResponseId,
      repairOpenAiResponseId: repairRun?.openAiResponseId || null,
      sourceItem: summarizeRawRow(rawItem),
      input,
      analysis: secS3Analysis.analysis,
      outputText: analysisRun.outputText,
      repairOutputText: repairRun?.outputText,
      usage,
      repairUsage: repairRun?.usage,
      costEstimate: estimateCost(llmConfig.model, usage),
      validationRepair,
      prompt: {
        key: prompt.key,
        version: prompt.version,
        repair: repairPlan
          ? {
              key: repairPlan.prompt.key,
              version: repairPlan.prompt.version,
              system: repairPlan.prompt.system,
              responseFormat: repairPlan.prompt.responseFormat,
            }
          : undefined,
      },
    };
  }

  if (isSecNtFilingInput(input)) {
    const prompt = buildSecNtAnalysisPromptForInput(input);
    const analysisRun = await runOpenAiJsonPrompt(env, prompt, llmConfig);
    if (!analysisRun.ok || !analysisRun.parsed) {
      return {
        ok: false,
        stage: "openai",
        status: analysisRun.status,
        model: analysisRun.model,
        error: `SEC NT analysis failed after ${analysisRun.attempts} attempt(s): ${analysisRun.error || "no parseable JSON"}`,
        sourceItem: summarizeRawRow(rawItem),
        input,
        outputText: analysisRun.outputText,
        usage: analysisRun.usage,
        rawOpenAIResponse: analysisRun.rawOpenAIResponse,
        prompt: {
          key: prompt.key,
          version: prompt.version,
        },
      };
    }

    const repairPlan = buildSecNtValidationRepairPlan({
      analysisResult: analysisRun.parsed,
      input,
    });
    let repairedValue = analysisRun.parsed;
    let repairRun: OpenAiPromptRun | null = null;
    let repairAppliedPaths: string[] = [];
    let repairIgnoredPaths: string[] = [];
    let repairUnresolved: unknown[] = [];
    if (repairPlan) {
      const ntRepairLlmConfig =
        llmConfig.provider === "gemini" && llmConfig.model === "gemini-2.5-flash-lite"
          ? { ...llmConfig, model: "gemini-2.5-flash", fallbackModel: undefined }
          : llmConfig;
      repairRun = await runOpenAiJsonPrompt(env, repairPlan.prompt, ntRepairLlmConfig, {
        maxAttempts: 1,
        disableFallback: true,
      });
      if (repairRun.ok && repairRun.parsed) {
        const repairApplication = applySecNtValidationRepairPatches({
          analysisResult: analysisRun.parsed,
          repairResult: repairRun.parsed,
          allowedPatchPaths: repairPlan.allowedPatchPaths,
        });
        repairedValue = repairApplication.value;
        repairAppliedPaths = repairApplication.appliedPaths;
        repairIgnoredPaths = repairApplication.ignoredPaths;
        repairUnresolved = repairApplication.unresolved;
      }
    }
    const postRepairEnforcement = enforceSecNtPostRepairInvariants({
      analysisResult: repairedValue,
      input,
    });
    repairedValue = postRepairEnforcement.value;
    const usage = combineUsage(analysisRun.usage, repairRun?.usage);
    const validationRepair = repairPlan
      ? {
          attempted: true,
          succeeded: Boolean(repairRun?.ok && repairRun.parsed),
          issue_codes: repairPlan.issues.map((issue) => issue.code),
          source_block_ids: repairPlan.sourceBlockIds,
          allowed_patch_paths: repairPlan.allowedPatchPaths,
          applied_patch_paths: repairAppliedPaths,
          ignored_patch_paths: repairIgnoredPaths,
          unresolved: repairUnresolved,
          error: repairRun?.error || null,
          repair_model: repairRun?.model || null,
          post_repair_guard_applied: postRepairEnforcement.applied,
          post_repair_guard_paths: postRepairEnforcement.appliedPaths,
          post_repair_guard_reason: postRepairEnforcement.reason,
          remaining_issue_codes: postRepairEnforcement.remainingWarnings.map((warning) => warning.code),
        }
      : {
          attempted: false,
          post_repair_guard_applied: postRepairEnforcement.applied,
          post_repair_guard_paths: postRepairEnforcement.appliedPaths,
          post_repair_guard_reason: postRepairEnforcement.reason,
          remaining_issue_codes: postRepairEnforcement.remainingWarnings.map((warning) => warning.code),
        };
    const ntAnalysis = adaptSecNtAnalysisPromptResultForAnalysis(repairedValue, input);
    if (!ntAnalysis.ok) {
      return {
        ok: false,
        stage: "openai",
        status: analysisRun.status,
        model: analysisRun.model,
        error: ntAnalysis.error,
        sourceItem: summarizeRawRow(rawItem),
        input,
        outputText: analysisRun.outputText,
        repairOutputText: repairRun?.outputText,
        usage,
        repairUsage: repairRun?.usage,
        rawOpenAIResponse: analysisRun.rawOpenAIResponse,
        validationRepair,
        prompt: {
          key: prompt.key,
          version: prompt.version,
          repair: repairPlan
            ? {
                key: repairPlan.prompt.key,
                version: repairPlan.prompt.version,
                system: repairPlan.prompt.system,
                responseFormat: repairPlan.prompt.responseFormat,
              }
            : undefined,
        },
      };
    }

    return {
      ok: true,
      stage: "complete",
      status: analysisRun.status,
      model: analysisRun.model,
      openAiResponseId: analysisRun.openAiResponseId,
      sourceItem: summarizeRawRow(rawItem),
      input,
      analysis: {
        ...ntAnalysis.analysis,
        nt_validation_repair: validationRepair,
        nt_post_repair_enforcement: {
          applied: postRepairEnforcement.applied,
          applied_paths: postRepairEnforcement.appliedPaths,
          reason: postRepairEnforcement.reason,
          remaining_issue_codes: postRepairEnforcement.remainingWarnings.map((warning) => warning.code),
        },
      },
      outputText: analysisRun.outputText,
      repairOutputText: repairRun?.outputText,
      usage,
      repairUsage: repairRun?.usage,
      costEstimate: estimateCost(analysisRun.model, usage),
      validationRepair,
      prompt: {
        key: SEC_NT_ANALYSIS_PROMPT_KEY,
        version: SEC_NT_ANALYSIS_PROMPT_VERSION,
        repair: repairPlan
          ? {
              key: repairPlan.prompt.key,
              version: repairPlan.prompt.version,
              system: repairPlan.prompt.system,
              responseFormat: repairPlan.prompt.responseFormat,
            }
          : undefined,
      },
    };
  }

if (isForm25FilingInput(input)) {
    await attachSecMarketContext(input);
    await attachForm25IssuerRelatedContext(input, rawItem);
    const prompt = buildSecForm25AnalysisPromptForInput(input);
    const analysisRun = await runOpenAiJsonPrompt(env, prompt, llmConfig);
    if (!analysisRun.ok || !analysisRun.parsed) {
      return {
        ok: false,
        stage: "openai",
        status: analysisRun.status,
        model: analysisRun.model,
        error: `SEC Form 25 analysis failed after ${analysisRun.attempts} attempt(s): ${analysisRun.error || "no parseable JSON"}`,
        sourceItem: summarizeRawRow(rawItem),
        input,
        outputText: analysisRun.outputText,
        usage: analysisRun.usage,
        rawOpenAIResponse: analysisRun.rawOpenAIResponse,
        prompt: {
          key: prompt.key,
          version: prompt.version,
        },
      };
    }

    const relatedFilingContext = readRecord(readRecord(input.filing_package)?.form25_related_filing_context);
    const parserOutput = readForm25ParserOutput(input) as SecForm25ParserOutput | null;
    let analysisResult = analysisRun.parsed;
    const validationIssues = parserOutput
      ? inspectSecForm25ValidationRepairIssues({
          analysisResult,
          parserOutput,
          relatedFilingContext,
        })
      : [];
    const repairPlan = parserOutput
      ? buildSecForm25ValidationRepairPlan({
          analysisResult,
          parserOutput,
          relatedFilingContext,
        })
      : null;
    let repairRun: OpenAiPromptRun | null = null;
    let appliedPatchPaths: string[] = [];
    let ignoredPatchPaths: string[] = [];
    let unresolvedWarningCodes: string[] = [];

    if (repairPlan) {
      repairRun = await runOpenAiJsonPrompt(env, repairPlan.prompt, llmConfig, {
        maxAttempts: 1,
        disableFallback: true,
      });
      if (repairRun.ok && repairRun.parsed) {
        const repaired = applySecForm25ValidationRepairPatches({
          analysisResult,
          repairResult: repairRun.parsed,
          allowedPatchPaths: repairPlan.allowedPatchPaths,
        });
        analysisResult = repaired.analysisResult;
        appliedPatchPaths = repaired.appliedPatchPaths;
        ignoredPatchPaths = repaired.ignoredPatchPaths;
        unresolvedWarningCodes = repaired.unresolvedWarningCodes;
      }
    }

    let effectiveAnalysisResult = analysisResult;
    let form25Analysis = adaptSecForm25AnalysisPromptResultForAnalysis(
      effectiveAnalysisResult,
      parserOutput,
      relatedFilingContext,
    );
    let repairAdaptationError: string | null = null;
    if (!form25Analysis.ok && analysisResult !== analysisRun.parsed) {
      repairAdaptationError = form25Analysis.error;
      effectiveAnalysisResult = analysisRun.parsed;
      form25Analysis = adaptSecForm25AnalysisPromptResultForAnalysis(
        effectiveAnalysisResult,
        parserOutput,
        relatedFilingContext,
      );
    }
    if (!form25Analysis.ok) {
      return {
        ok: false,
        stage: "openai",
        status: analysisRun.status,
        model: analysisRun.model,
        error: form25Analysis.error,
        sourceItem: summarizeRawRow(rawItem),
        input,
        outputText: analysisRun.outputText,
        usage: combineUsage(analysisRun.usage, repairRun?.usage),
        rawOpenAIResponse: analysisRun.rawOpenAIResponse,
        prompt: {
          key: prompt.key,
          version: prompt.version,
        },
      };
    }
    unresolvedWarningCodes = parserOutput
      ? inspectSecForm25ValidationRepairIssues({
          analysisResult: effectiveAnalysisResult,
          parserOutput,
          relatedFilingContext,
        }).map((issue) => issue.code)
      : [];
    attachForm25LifecycleFilingContext(input, form25Analysis.analysis, relatedFilingContext);

    const usage = combineUsage(analysisRun.usage, repairRun?.usage);
    const form25ValidationRepair = validationIssues.length
      ? {
          attempted: Boolean(repairPlan),
          max_attempts: 1,
          run_ok: repairRun?.ok === true,
          run_error: repairRun?.error || (repairPlan ? null : "No original source blocks available for repair."),
          issue_codes: validationIssues.map((issue) => issue.code),
          source_block_ids: repairPlan?.sourceBlockIds || [],
          allowed_patch_paths: repairPlan?.allowedPatchPaths || [],
          applied_patch_paths: appliedPatchPaths,
          ignored_patch_paths: ignoredPatchPaths,
          unresolved_warning_codes: unresolvedWarningCodes,
          adaptation_error: repairAdaptationError,
        }
      : null;

    return {
      ok: true,
      stage: "complete",
      status: analysisRun.status,
      model: analysisRun.model,
      openAiResponseId: analysisRun.openAiResponseId,
      sourceItem: summarizeRawRow(rawItem),
      input,
      analysis: form25Analysis.analysis,
      form25ValidationRepair,
      outputText: analysisRun.outputText,
      usage,
      costEstimate: estimateCost(analysisRun.model, usage),
      prompt: {
        key: prompt.key,
        version: prompt.version,
      },
    };
  }

  if (isSecPeriodicReportsFilingInput(input)) {
    const prompt = buildSecPeriodicReportsAnalysisPromptForInput(input);
    const analysisRun = await runOpenAiJsonPrompt(env, prompt, llmConfig);
    if (!analysisRun.ok || !analysisRun.parsed) {
      return {
        ok: false,
        stage: "openai",
        status: analysisRun.status,
        model: analysisRun.model,
        error: `SEC periodic-report analysis failed after ${analysisRun.attempts} attempt(s): ${analysisRun.error || "no parseable JSON"}`,
        sourceItem: summarizeRawRow(rawItem),
        input,
        outputText: analysisRun.outputText,
        usage: analysisRun.usage,
        rawOpenAIResponse: analysisRun.rawOpenAIResponse,
        prompt: {
          key: prompt.key,
          version: prompt.version,
        },
      };
    }

    const repairPlan = buildSecPeriodicReportsValidationRepairPlan({
      analysisResult: analysisRun.parsed,
      input,
    });
    let repairedValue = analysisRun.parsed;
    let repairRun: OpenAiPromptRun | null = null;
    let repairAppliedPaths: string[] = [];
    let repairIgnoredPaths: string[] = [];
    let repairUnresolved: unknown[] = [];
    if (repairPlan) {
      repairRun = await runOpenAiJsonPrompt(env, repairPlan.prompt, llmConfig, {
        maxAttempts: 1,
        disableFallback: true,
      });
      if (repairRun.ok && repairRun.parsed) {
        const repairApplication = applySecPeriodicReportsValidationRepairPatches({
          analysisResult: analysisRun.parsed,
          repairResult: repairRun.parsed,
          allowedPatchPaths: repairPlan.allowedPatchPaths,
        });
        repairedValue = repairApplication.value;
        repairAppliedPaths = repairApplication.appliedPaths;
        repairIgnoredPaths = repairApplication.ignoredPaths;
        repairUnresolved = repairApplication.unresolved;
      }
    }
    const usage = combineUsage(analysisRun.usage, repairRun?.usage);
    const validationRepair = repairPlan
      ? {
          attempted: true,
          succeeded: Boolean(repairRun?.ok && repairRun.parsed),
          issue_codes: repairPlan.issues.map((issue) => issue.code),
          source_block_ids: repairPlan.sourceBlockIds,
          allowed_patch_paths: repairPlan.allowedPatchPaths,
          applied_patch_paths: repairAppliedPaths,
          ignored_patch_paths: repairIgnoredPaths,
          unresolved: repairUnresolved,
          error: repairRun?.error || null,
        }
      : { attempted: false };
    const periodicAnalysis = adaptSecPeriodicReportsAnalysisPromptResultForAnalysis(
      repairedValue,
      input,
    );
    if (!periodicAnalysis.ok) {
      return {
        ok: false,
        stage: "openai",
        status: analysisRun.status,
        model: analysisRun.model,
        error: periodicAnalysis.error,
        sourceItem: summarizeRawRow(rawItem),
        input,
        outputText: analysisRun.outputText,
        repairOutputText: repairRun?.outputText,
        usage,
        repairUsage: repairRun?.usage,
        rawOpenAIResponse: analysisRun.rawOpenAIResponse,
        validationRepair,
        prompt: {
          key: prompt.key,
          version: prompt.version,
          repair: repairPlan
            ? {
                key: repairPlan.prompt.key,
                version: repairPlan.prompt.version,
                system: repairPlan.prompt.system,
                responseFormat: repairPlan.prompt.responseFormat,
              }
            : undefined,
        },
      };
    }

    return {
      ok: true,
      stage: "complete",
      status: analysisRun.status,
      model: analysisRun.model,
      openAiResponseId: analysisRun.openAiResponseId,
      repairOpenAiResponseId: repairRun?.openAiResponseId || null,
      sourceItem: summarizeRawRow(rawItem),
      input,
      analysis: periodicAnalysis.analysis,
      outputText: analysisRun.outputText,
      repairOutputText: repairRun?.outputText,
      usage,
      repairUsage: repairRun?.usage,
      costEstimate: estimateCost(analysisRun.model, usage),
      validationRepair,
      prompt: {
        key: prompt.key,
        version: prompt.version,
        repair: repairPlan
          ? {
              key: repairPlan.prompt.key,
              version: repairPlan.prompt.version,
              system: repairPlan.prompt.system,
              responseFormat: repairPlan.prompt.responseFormat,
            }
          : undefined,
      },
    };
  }

  if (isProxyFilingInput(input)) {
    await attachSecMarketContext(input);
    const prompt = buildSecProxyAnalysisPromptForInput(input);
    const analysisRun = await runOpenAiJsonPrompt(env, prompt, llmConfig);
    if (!analysisRun.ok || !analysisRun.parsed) {
      return {
        ok: false,
        stage: "openai",
        status: analysisRun.status,
        model: analysisRun.model,
        error: `SEC proxy analysis failed after ${analysisRun.attempts} attempt(s): ${analysisRun.error || "no parseable JSON"}`,
        sourceItem: summarizeRawRow(rawItem),
        input,
        outputText: analysisRun.outputText,
        usage: analysisRun.usage,
        rawOpenAIResponse: analysisRun.rawOpenAIResponse,
        prompt: {
          key: prompt.key,
          version: prompt.version,
        },
      };
    }

    const repairPlan = buildSecProxyValidationRepairPlan({
      analysisResult: analysisRun.parsed,
      input,
    });
    let repairedValue = analysisRun.parsed;
    let repairRun: OpenAiPromptRun | null = null;
    let repairAppliedPaths: string[] = [];
    let repairIgnoredPaths: string[] = [];
    let repairUnresolved: unknown[] = [];
    if (repairPlan) {
      repairRun = await runOpenAiJsonPrompt(env, repairPlan.prompt, llmConfig, {
        maxAttempts: 1,
        disableFallback: true,
      });
      if (repairRun.ok && repairRun.parsed) {
        const repairApplication = applySecProxyValidationRepairPatches({
          analysisResult: analysisRun.parsed,
          repairResult: repairRun.parsed,
          allowedPatchPaths: repairPlan.allowedPatchPaths,
        });
        repairedValue = repairApplication.value;
        repairAppliedPaths = repairApplication.appliedPaths;
        repairIgnoredPaths = repairApplication.ignoredPaths;
        repairUnresolved = repairApplication.unresolved;
      }
    }
    const usage = combineUsage(analysisRun.usage, repairRun?.usage);
    const validationRepair = repairPlan
      ? {
          attempted: true,
          succeeded: Boolean(repairRun?.ok && repairRun.parsed),
          issue_codes: repairPlan.issues.map((issue) => issue.code),
          source_block_ids: repairPlan.sourceBlockIds,
          allowed_patch_paths: repairPlan.allowedPatchPaths,
          applied_patch_paths: repairAppliedPaths,
          ignored_patch_paths: repairIgnoredPaths,
          unresolved: repairUnresolved,
          error: repairRun?.error || null,
        }
      : { attempted: false };
    const proxyAnalysis = adaptSecProxyAnalysisPromptResultForAnalysis(repairedValue);
    if (!proxyAnalysis.ok) {
      return {
        ok: false,
        stage: "openai",
        status: analysisRun.status,
        model: analysisRun.model,
        error: proxyAnalysis.error,
        sourceItem: summarizeRawRow(rawItem),
        input,
        outputText: analysisRun.outputText,
        repairOutputText: repairRun?.outputText,
        usage,
        repairUsage: repairRun?.usage,
        rawOpenAIResponse: analysisRun.rawOpenAIResponse,
        validationRepair,
        prompt: {
          key: prompt.key,
          version: prompt.version,
          repair: repairPlan
            ? {
                key: repairPlan.prompt.key,
                version: repairPlan.prompt.version,
                system: repairPlan.prompt.system,
                responseFormat: repairPlan.prompt.responseFormat,
              }
            : undefined,
        },
      };
    }

    return {
      ok: true,
      stage: "complete",
      status: analysisRun.status,
      model: analysisRun.model,
      openAiResponseId: analysisRun.openAiResponseId,
      repairOpenAiResponseId: repairRun?.openAiResponseId || null,
      sourceItem: summarizeRawRow(rawItem),
      input,
      analysis: proxyAnalysis.analysis,
      outputText: analysisRun.outputText,
      repairOutputText: repairRun?.outputText,
      usage,
      repairUsage: repairRun?.usage,
      costEstimate: estimateCost(analysisRun.model, usage),
      validationRepair,
      prompt: {
        key: prompt.key,
        version: prompt.version,
        repair: repairPlan
          ? {
              key: repairPlan.prompt.key,
              version: repairPlan.prompt.version,
              system: repairPlan.prompt.system,
              responseFormat: repairPlan.prompt.responseFormat,
            }
          : undefined,
      },
    };
  }

  await attachSecMarketContext(input);

  const prompt = buildSecFilingPromptForInput(input, options);
  const analysisRun = await runOpenAiJsonPrompt(env, prompt, llmConfig);
  if (!analysisRun.ok) {
    return {
      ok: false,
      stage: "openai",
      status: analysisRun.status,
      error: `SEC filing analysis failed after ${analysisRun.attempts} attempt(s): ${analysisRun.error || "unknown LLM error"}`,
      sourceItem: summarizeRawRow(rawItem),
      input,
      triage,
      audit: null,
      auditOpenAiResponseId: null,
      triageOutputText: triageRun?.outputText,
      triageUsage: triageRun?.usage || null,
      auditOutputText: undefined,
      auditUsage: null,
      rawOpenAIResponse: analysisRun.rawOpenAIResponse,
    };
  }

  const parsedAnalysis = analysisRun.parsed;
  const analysis = parsedAnalysis ? applySecOfferingScorePolicy(readRecord(input.filing_package) || {}, parsedAnalysis) : null;
  const usage = combineUsage(triageRun?.usage || null, null, analysisRun.usage);
  return {
    ok: Boolean(analysis),
    stage: "complete",
    status: analysisRun.status,
    model: llmConfig.model,
    openAiResponseId: analysisRun.openAiResponseId,
    auditOpenAiResponseId: null,
    sourceItem: summarizeRawRow(rawItem),
    input,
    triage,
    audit: null,
    analysis,
    triageOutputText: triageRun?.outputText,
    auditOutputText: undefined,
    outputText: analysisRun.outputText,
    triageUsage: triageRun?.usage || null,
    auditUsage: null,
    usage,
    costEstimate: estimateCost(llmConfig.model, usage),
    prompt: {
      key: prompt.key,
      version: prompt.version,
      triage: triageRun
        ? {
            key: SEC_S3_AMENDMENT_TRIAGE_PROMPT_KEY,
            version: SEC_S3_AMENDMENT_TRIAGE_PROMPT_VERSION,
          }
        : undefined,
    },
    error: analysis ? undefined : "LLM response did not contain parseable JSON",
  };
}

function resolveSecLlmConfig(
  env: ReturnType<typeof getServerEnv>,
  options: SecLlmOptions = {},
  input?: SecFilingAnalysisInput,
): SecLlmConfig {
  const provider = normalizeSecLlmProvider(
    options.llmProvider || env.secAnalysisLlmProvider,
    env.secAnalysisAllowOpenAi,
  );
  if (provider === "gemini") {
    const model = (
      options.llmModel ||
      resolveGeminiModelForSecInput(env, input) ||
      env.geminiModel ||
      "gemini-2.5-flash"
    ).trim();
    const shouldUseFlashFallback = Boolean(
      input && (isProxyFilingInput(input) || isSec8k6kFilingInput(input)),
    );
    const fallbackModel =
      shouldUseFlashFallback && model !== "gemini-2.5-flash"
        ? "gemini-2.5-flash"
        : undefined;
    return {
      provider,
      model,
      fallbackModel,
      apiKey: env.geminiApiKey,
      apiKeyEnvName: "GEMINI_API_KEY",
    };
  }

  return {
    provider: "openai",
    model: (options.llmModel || env.openAiModel || "gpt-5-mini").trim(),
    apiKey: env.openAiApiKey,
    apiKeyEnvName: "OPENAI_API_KEY",
  };
}

function resolveSec425RouterLlmConfig(
  baseConfig: SecLlmConfig,
  options: SecLlmOptions,
): SecLlmConfig {
  if (baseConfig.provider !== "gemini" || options.llmModel?.trim()) return baseConfig;

  return withGeminiFallback(
    baseConfig,
    SEC_425_GEMINI_LITE_MODEL,
    SEC_425_GEMINI_FLASH_MODEL,
  );
}

function resolveSec425AnalysisLlmConfig(
  baseConfig: SecLlmConfig,
  options: SecLlmOptions,
  plan: Sec425AnalysisModelPlan,
): SecLlmConfig {
  if (baseConfig.provider !== "gemini" || options.llmModel?.trim()) return baseConfig;

  return plan.selectedModel === SEC_425_GEMINI_LITE_MODEL
    ? withGeminiFallback(
      baseConfig,
      SEC_425_GEMINI_LITE_MODEL,
      SEC_425_GEMINI_FLASH_MODEL,
    )
    : { ...baseConfig, model: SEC_425_GEMINI_FLASH_MODEL, fallbackModel: undefined };
}

function withGeminiFallback(
  baseConfig: SecLlmConfig,
  model: string,
  fallbackModel: string,
): SecLlmConfig {
  return {
    ...baseConfig,
    model,
    fallbackModel: fallbackModel !== model ? fallbackModel : undefined,
  };
}

function buildSec425AnalysisModelPlan(
  prompt: OpenAiPrompt,
  baseConfig: SecLlmConfig,
): Sec425AnalysisModelPlan {
  const payload = parseAnalysisJson(prompt.user);
  const sourceBlocks = readRecordArray(payload?.cleaned_source_blocks);
  const sourceRefs = new Set<string>();
  let selectedTextChars = 0;
  let hasComplexDocument = false;

  for (const [index, block] of sourceBlocks.entries()) {
    const sourceRef = stringValue(block.source_ref) || `selected-block-${index}`;
    sourceRefs.add(sourceRef);
    selectedTextChars += stringValue(block.text).length;
    if (SEC_425_COMPLEX_DOCUMENT_ROLES.has(stringValue(block.document_role))) {
      hasComplexDocument = true;
    }
  }

  const selectedBlockCount = sourceBlocks.length;
  const sourceDocumentCount = sourceRefs.size;
  const useFlash =
    selectedBlockCount > 6 ||
    sourceDocumentCount > 1 ||
    selectedTextChars > 18_000 ||
    (hasComplexDocument && selectedBlockCount > 3);
  const selectedModel = useFlash || baseConfig.provider !== "gemini"
    ? SEC_425_GEMINI_FLASH_MODEL
    : SEC_425_GEMINI_LITE_MODEL;
  const reason = useFlash
    ? "Selected 425 analysis evidence spans a large or multi-document transaction bundle."
    : "Selected 425 analysis evidence is a compact single-document bundle."

  return {
    selectedBlockCount,
    sourceDocumentCount,
    selectedTextChars,
    hasComplexDocument,
    selectedModel,
    reason,
  };
}

function buildSec425ValidationRepairPrompt(
  analysisPrompt: OpenAiPrompt,
  analysisResult: Record<string, unknown>,
  validationWarnings: string[],
): OpenAiPrompt {
  const analysisOutput = readRecord(analysisResult.analysis_output) || {};
  const promptPayload = parseAnalysisJson(analysisPrompt.user);
  const sourceBlocks = readRecordArray(promptPayload?.cleaned_source_blocks);
  const currentChanges = readRecordArray(analysisOutput.current_changes);
  const usedBlockIds = new Set([
    ...readStringArray(analysisResult.source_blocks_used),
    ...currentChanges.map((item) => stringValue(item.source_block_id)).filter(Boolean),
  ]);
  const matchingBlocks = usedBlockIds.size > 0
    ? sourceBlocks.filter((block) => usedBlockIds.has(stringValue(block.block_id)))
    : [];
  const selectedSourceBlocks = (matchingBlocks.length > 0 ? matchingBlocks : sourceBlocks)
    .slice(0, 3)
    .map((block) => ({
      block_id: stringValue(block.block_id),
      source_ref: stringValue(block.source_ref),
      heading: stringValue(block.heading),
      text: stringValue(block.text),
    }));

  return {
    key: "sec_425_validation_repair",
    version: "v1",
    system: [
      "Repair one SEC Form 425 analysis after validation and return strict JSON.",
      "Use only the supplied original source blocks as factual authority.",
      "Address only the validator warnings. Preserve unrelated analysis content and do not change event type, score, signal, or delivery.",
      "current_changes must list up to 4 explicit actions, decisions, status changes, changed dates, or changed binding terms announced by this filing, each citing an exact supplied source_block_id.",
      "Collapse one decision and its supporting rationale into one current change. A best-interests conclusion is not separate from the board position it explains.",
      "Snapshot and Summary must collectively state every current change before unchanged transaction background.",
      "When a snapshot warning is present, return exactly 4 useful source-backed snapshot items with event-specific labels. Never use missing-value placeholders or parser-generated fragments.",
      "Return no more than 3 Key Evidence items. Each must cover a different objective decision, changed term, amount, deadline, approval, vote result, or condition.",
      "Map Key Evidence one-to-one to different current_changes items and use at most one evidence sentence per current change.",
      "A rationale or best-interests conclusion for the same board decision is not a separate evidence item. Preserve a distinct competing-offer rejection or other separate current change when supported.",
      "When a duplicate-evidence warning is present, delete the weaker duplicate rather than paraphrasing it. If only two distinct facts exist, return two items.",
      "Exclude slogans, aspirations, expected benefits, and promotional claims from Key Evidence.",
      "Each Key Evidence item must be a complete sentence under 28 words and 180 characters.",
      "This is one repair attempt. Return only the requested JSON object.",
    ].join("\n"),
    user: JSON.stringify({
      validator_warnings: validationWarnings,
      current_analysis: {
        summary: stringValue(analysisOutput.summary),
        current_changes: currentChanges,
        snapshot_title: stringValue(analysisOutput.snapshot_title),
        snapshot_summary: stringValue(analysisOutput.snapshot_summary),
        snapshot_items: readRecordArray(analysisOutput.snapshot_items),
        key_evidence: readStringArray(analysisOutput.key_evidence),
      },
      selected_original_source_blocks: selectedSourceBlocks,
    }),
    responseFormat: {
      json_schema: {
        name: "sec_425_validation_repair",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: [
            "summary",
            "current_changes",
            "snapshot_title",
            "snapshot_summary",
            "snapshot_items",
            "key_evidence",
          ],
          properties: {
            summary: {
              type: "string",
              description: "The repaired investor summary, no more than 100 words.",
            },
            current_changes: {
              type: "array",
              maxItems: 4,
              description: "Return only distinct current-filing changes. Never return more than four items.",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["topic", "change", "result", "priority", "source_block_id"],
                properties: {
                  topic: { type: "string" },
                  change: { type: "string" },
                  result: { type: "string" },
                  priority: { type: "string", enum: ["primary", "secondary"] },
                  source_block_id: { type: "string" },
                },
              },
            },
            snapshot_title: { type: "string" },
            snapshot_summary: { type: "string" },
            snapshot_items: {
              type: "array",
              maxItems: 4,
              description: "Return exactly four useful source-backed snapshot items. Never return more than four items.",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["label", "value", "note"],
                properties: {
                  label: { type: "string" },
                  value: { type: "string" },
                  note: { type: "string" },
                },
              },
            },
            key_evidence: {
              type: "array",
              maxItems: 3,
              description: "Return only the strongest distinct evidence. Never return more than three items.",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["topic", "fact"],
                properties: {
                  topic: {
                    type: "string",
                    description: "A concise decision, term, deadline, approval, vote, or condition topic not used by another item.",
                  },
                  fact: {
                    type: "string",
                    maxLength: 180,
                    description: "One complete source-backed sentence under 28 words.",
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

function applySec425ValidationRepair(
  analysisResult: Record<string, unknown>,
  repairResult: Record<string, unknown>,
  validationWarnings: string[],
): Record<string, unknown> {
  const analysisOutput = readRecord(analysisResult.analysis_output) || {};
  const repairCurrentChanges = validationWarnings.some((warning) => /current_changes/i.test(warning));
  const repairKeyEvidence = validationWarnings.some((warning) => /key_evidence/i.test(warning));
  const repairSnapshot = validationWarnings.some((warning) => /snapshot/i.test(warning));
  return {
    ...analysisResult,
    analysis_output: {
      ...analysisOutput,
      ...(repairCurrentChanges
        ? {
            summary: stringValue(repairResult.summary) || stringValue(analysisOutput.summary),
            current_changes: readRecordArray(repairResult.current_changes),
            snapshot_title: stringValue(repairResult.snapshot_title),
            snapshot_summary: stringValue(repairResult.snapshot_summary),
            snapshot_items: readRecordArray(repairResult.snapshot_items),
          }
        : {}),
      ...(repairKeyEvidence
        ? {
            key_evidence: readRecordArray(repairResult.key_evidence)
              .map((item) => stringValue(item.fact))
              .filter(Boolean),
          }
        : {}),
      ...(repairSnapshot
        ? {
            snapshot_title: stringValue(repairResult.snapshot_title),
            snapshot_summary: stringValue(repairResult.snapshot_summary),
            snapshot_items: readRecordArray(repairResult.snapshot_items),
          }
        : {}),
    },
  };
}

function buildSec425RepairIssueCodes(validationWarnings: string[]) {
  const codes: string[] = [];
  if (validationWarnings.some((warning) => /current_changes/i.test(warning))) {
    codes.push("current_change_coverage");
  }
  if (validationWarnings.some((warning) => /key_evidence/i.test(warning))) {
    codes.push("key_evidence_quality");
  }
  if (validationWarnings.some((warning) => /snapshot/i.test(warning))) {
    codes.push("snapshot_quality");
  }
  return codes;
}

function resolveGeminiModelForSecInput(env: ReturnType<typeof getServerEnv>, input?: SecFilingAnalysisInput) {
  if (input && isOwnershipFilingInput(input)) {
    return env.secOwnershipGeminiModel || "gemini-2.5-flash-lite";
  }
  if (input && isProxyFilingInput(input)) {
    return env.secProxyRoutineGeminiModel || "gemini-2.5-flash-lite";
  }
  if (input && isSec8k6kFilingInput(input)) {
    return "gemini-2.5-flash-lite";
  }
  if (input && isSecNtFilingInput(input)) {
    return env.secNtGeminiModel || "gemini-2.5-flash-lite";
  }
  if (input && isForm25FilingInput(input)) {
    return env.secForm25GeminiModel || "gemini-2.5-flash-lite";
  }
  return "";
}

function normalizeSecLlmProvider(value: string | undefined, allowOpenAi = false): SecLlmProvider {
  if (value?.trim().toLowerCase() === "openai" && allowOpenAi) {
    return "openai";
  }
  return "gemini";
}

function readS1F1ParserOutputForRoute(input: SecFilingAnalysisInput): S1F1ParserOutput | null {
  const filingPackage = readRecord(input.filing_package);
  const hardParsers = readRecord(filingPackage?.hard_parsers);
  return (readRecord(hardParsers?.["s1-f1"]) || readRecord(hardParsers?.s1_f1)) as S1F1ParserOutput | null;
}

function buildS1F1RouteOnlyPrompt(parserOutput: S1F1ParserOutput): OpenAiPrompt {
  return {
    key: SEC_S1_F1_ROUTE_ONLY_PROMPT_KEY,
    version: SEC_S1_F1_ROUTE_ONLY_PROMPT_VERSION,
    system: [
      "Route one SEC S-1/F-1 registration filing to the best detail UI mode.",
      "Do not write a full filing analysis. Do not calculate final dilution. Return only route metadata.",
      "Use source text and filing structure, not parser-generated labels, as authority.",
      "Pick one display_mode. If uncertain, choose the closest mode and set confidence below 0.70.",
    ].join("\n"),
    user: JSON.stringify(
      {
        task:
          "Choose the display_mode for the S-1/F-1 detail UI before the full analysis prompt is used. This is a route-only test.",
        routing_order: [
          "For S-1/A or F-1/A, first decide what the amendment itself changes before reading instrument names as the main event.",
          "If the amendment is exhibit-only, consent-only, fee-table-only, signature/correction-only, or explicitly says it does not amend prospectus/offering terms, choose routine_amendment.",
          "If the amendment updates IPO price range, shares offered, exchange/ticker, underwriters, or IPO timing, choose ipo_amendment.",
          "Only route an amendment to mixed_offering, resale_registration, warrant_convertible, primary_offering, or pending_primary_offering when the amendment itself changes or actively presents those sale terms, securities covered, pricing, proceeds, share counts, or instrument terms.",
          "Do not choose mixed_offering or warrant_convertible solely because the source mentions prior financings, prior ELOCs, prior warrants, prior notes, capitalization assumptions, or historical instruments.",
        ],
        display_modes: [
          {
            mode: "pending_primary_offering",
            use_when:
              "Active primary common/share/ADS or pre-funded offering exists, but share count, price, or proceeds are blank/pending/assumed so a dilution ratio is not source-backed.",
            avoid_when: "Source-backed share count and denominator allow a normal primary_offering dilution chart.",
          },
          {
            mode: "primary_offering",
            use_when:
              "Active primary sale of common shares/ADSs has source-backed share count or calculable share-equivalent supply.",
            avoid_when: "Material attached warrants, resale, ATM, shelf, or blank/pending size dominates.",
          },
          {
            mode: "registered_direct",
            use_when: "Registered direct or private-placement style sale to named investors with current sale terms.",
          },
          {
            mode: "mixed_offering",
            use_when:
              "Current prospectus combines multiple material active components, such as shares plus warrants, resale plus primary, ATM plus shelf, or instruments requiring a shared supply view.",
          },
          {
            mode: "resale_registration",
            use_when: "Selling stockholder resale registration dominates, with no primary sale as the main event.",
          },
          {
            mode: "warrant_convertible",
            use_when:
              "Warrants, convertibles, preferred conversion, rights, or other share-linked instruments dominate the investor read.",
          },
          {
            mode: "shelf_capacity",
            use_when: "Base/universal shelf capacity or future offering registration with no active sale terms.",
          },
          { mode: "atm", use_when: "At-the-market sales agreement or active ATM program capacity dominates." },
          {
            mode: "ipo_registration",
            use_when: "Initial traditional IPO/F-1/S-1 listing registration with key price/share terms pending.",
          },
          {
            mode: "ipo_amendment",
            use_when: "IPO amendment updates price range, share count, exchange/ticker, underwriters, or terms.",
          },
          { mode: "spac_ipo", use_when: "Blank-check/SPAC IPO registration without a target or de-SPAC transaction." },
          {
            mode: "rule_462b_mef",
            use_when: "Rule 462(b), S-1MEF/F-1MEF, or added registration amount for an effective prior registration.",
          },
          { mode: "post_effective_amendment", use_when: "POS AM or post-effective amendment, especially deregistration or limited update." },
          { mode: "routine_amendment", use_when: "Administrative/exhibit-only/no economic change amendment." },
          { mode: "rights_offering", use_when: "Rights offering or subscription rights are the main sale mechanism." },
          { mode: "generic", use_when: "Source blocks are too weak or no specialized UI fits." },
        ],
        source_input: buildS1F1RouteOnlyInput(parserOutput),
      },
      null,
      2,
    ),
    responseFormat: {
      json_schema: {
        name: "sec_s1_f1_route_only",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["display_mode", "confidence", "route_reason", "required_surfaces", "rejected_modes"],
          properties: {
            display_mode: {
              type: "string",
              enum: [
                "pending_primary_offering",
                "ipo_registration",
                "ipo_amendment",
                "routine_amendment",
                "resale_registration",
                "atm",
                "primary_offering",
                "registered_direct",
                "warrant_convertible",
                "rights_offering",
                "shelf_capacity",
                "mixed_offering",
                "spac_ipo",
                "rule_462b_mef",
                "post_effective_amendment",
                "generic",
              ],
            },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            route_reason: { type: "string", maxLength: 320 },
            required_surfaces: {
              type: "array",
              maxItems: 6,
              items: {
                type: "string",
                enum: [
                  "snapshot_metrics",
                  "share_overhang",
                  "offering_details",
                  "instrument_details",
                  "watch_next",
                  "amendment_changes",
                  "company_overview",
                  "registration_details",
                ],
              },
            },
            rejected_modes: {
              type: "array",
              maxItems: 5,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["display_mode", "reason"],
                properties: {
                  display_mode: { type: "string" },
                  reason: { type: "string", maxLength: 180 },
                },
              },
            },
          },
        },
      },
    },
  };
}

function buildS1F1RouteOnlyInput(parserOutput: S1F1ParserOutput) {
  const sourceInput = buildS1F1LlmSourceInput(parserOutput);
  const sourceBlocks = Array.isArray(sourceInput.cleaned_source_blocks) ? sourceInput.cleaned_source_blocks : [];
  return {
    current_filing: sourceInput.current_filing,
    source_inventory: sourceInput.source_inventory,
    market_context: sourceInput.market_context,
    parent_filing_context: sourceInput.parent_filing_context,
    current_filing_source_block: sourceInput.current_filing_source_block,
    cleaned_source_blocks: sourceBlocks.slice(0, 18).map((block) => {
      const record = readRecord(block) || {};
      return {
        source: stringValue(record.source),
        sectionKey: stringValue(record.sectionKey),
        sectionTitle: stringValue(record.sectionTitle),
        documentName: stringValue(record.documentName),
        text: clipRouteOnlyText(stringValue(record.text), 2200),
        tables: Array.isArray(record.tables)
          ? record.tables.map((table) => clipRouteOnlyText(stringValue(table), 1000)).filter(Boolean).slice(0, 2)
          : [],
      };
    }),
    parser_warnings: sourceInput.parser_warnings,
  };
}

function clipRouteOnlyText(value: string, maxLength: number) {
  const text = value.trim();
  if (!text || text.length <= maxLength) return text;
  return text.slice(0, maxLength).trim();
}

async function runSec8k6kRouterPrompt(
  env: ReturnType<typeof getServerEnv>,
  prompt: OpenAiPrompt,
  llmConfig: SecLlmConfig,
): Promise<OpenAiPromptRun> {
  const firstRun = await runOpenAiJsonPrompt(env, prompt, llmConfig);
  if (
    llmConfig.provider !== "gemini" ||
    llmConfig.model !== "gemini-2.5-flash-lite" ||
    !firstRun.ok ||
    !firstRun.parsed ||
    !isLowQualitySec8k6kArchiveRoute(firstRun.parsed)
  ) {
    return firstRun;
  }

  const flashRun = await runOpenAiJsonPrompt(
    env,
    prompt,
    {
      ...llmConfig,
      model: "gemini-2.5-flash",
      fallbackModel: undefined,
    },
    { maxAttempts: 1, disableFallback: true },
  );
  if (!flashRun.ok || !flashRun.parsed) return firstRun;

  return {
    ...flashRun,
    attempts: firstRun.attempts + flashRun.attempts,
    usage: combineUsage(firstRun.usage, flashRun.usage),
  };
}

function isLowQualitySec8k6kArchiveRoute(value: Record<string, unknown>) {
  const normalized = normalizeSec8k6kRouterResult(value);
  const primaryCandidate = readRecord(normalized.primary_route_candidate);
  const eventType = stringValue(primaryCandidate?.route_type || normalized.event_type).toLowerCase();
  const confidence = stringValue(primaryCandidate?.confidence).toLowerCase();
  return eventType === "other" && (confidence === "low" || normalized.analysis_needed !== true);
}

async function runOpenAiJsonPrompt(
  env: ReturnType<typeof getServerEnv>,
  prompt: OpenAiPrompt,
  llmConfig: SecLlmConfig = resolveSecLlmConfig(env),
  options: { maxAttempts?: number; disableFallback?: boolean; retryRunawayOnce?: boolean } = {},
): Promise<OpenAiPromptRun> {
  if (llmConfig.provider === "gemini") {
    if (options.retryRunawayOnce) {
      const firstRun = await runGeminiJsonPrompt(prompt, llmConfig);
      if (firstRun.ok || !isSecLlmRunawayError(firstRun.error)) return firstRun;

      await waitForRetry(1);
      const retryRun = await runGeminiJsonPromptAttempts(
        prompt,
        {
          ...llmConfig,
          model: firstRun.model || llmConfig.model,
          fallbackModel: undefined,
        },
        1,
        firstRun.attempts,
      );
      return {
        ...retryRun,
        usage: combineUsage(firstRun.usage, retryRun.usage),
      };
    }
    if (options.maxAttempts || options.disableFallback) {
      return runGeminiJsonPromptAttempts(
        prompt,
        {
          ...llmConfig,
          fallbackModel: options.disableFallback ? undefined : llmConfig.fallbackModel,
        },
        options.maxAttempts || 1,
      );
    }
    return runGeminiJsonPrompt(prompt, llmConfig);
  }

  const maxAttempts = options.maxAttempts || SEC_LLM_MAX_ATTEMPTS;
  let lastRun: OpenAiPromptRun | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${llmConfig.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: llmConfig.model,
          instructions: prompt.system,
          input: prompt.user,
          max_output_tokens: readMaxOutputTokens(prompt.key),
          text: {
            format: {
              ...prompt.responseFormat.json_schema,
              type: "json_schema",
            },
          },
        }),
      });

      const responseBody = (await response.json().catch(() => null)) as OpenAIResponseBody | null;
      const outputText = readResponseOutputText(responseBody);
      const safetyStopReason = readSecLlmSafetyStopReason({
        outputText,
        finishReason: null,
        error: responseBody?.error?.message || response.statusText || "",
      });
      const parsed = response.ok && !safetyStopReason ? parseAnalysisJson(outputText) : null;
      lastRun = {
        ok: response.ok && !safetyStopReason && Boolean(parsed),
        status: response.status,
        provider: llmConfig.provider,
        model: llmConfig.model,
        openAiResponseId: responseBody?.id || null,
        outputText,
        parsed,
        usage: responseBody?.usage || null,
        attempts: attempt,
        error:
          safetyStopReason ||
          (response.ok
            ? parsed
              ? undefined
              : "OpenAI response did not contain parseable JSON"
            : responseBody?.error?.message || response.statusText || `<HTTP ${response.status}>`),
        rawOpenAIResponse: responseBody,
      };

      if (lastRun.ok || !shouldRetryOpenAiRun(lastRun.status, lastRun.error)) return lastRun;
    } catch (error) {
      lastRun = {
        ok: false,
        status: 0,
        provider: llmConfig.provider,
        model: llmConfig.model,
        openAiResponseId: null,
        outputText: "",
        parsed: null,
        usage: null,
        attempts: attempt,
        error: error instanceof Error ? error.message : String(error),
        rawOpenAIResponse: null,
      };
    }

    if (attempt < maxAttempts) {
      await waitForRetry(attempt);
    }
  }

  return lastRun || {
    ok: false,
    status: 0,
    provider: llmConfig.provider,
    model: llmConfig.model,
    openAiResponseId: null,
    outputText: "",
    parsed: null,
    usage: null,
    attempts: maxAttempts,
    error: "OpenAI request failed before response",
    rawOpenAIResponse: null,
  };
}

function shouldRetryOpenAiRun(status: number, error: string | undefined) {
  if (isNonRetryableSecLlmError(error)) return false;
  if (status === 0) return true;
  if (status === 408 || status === 409 || status === 425 || status === 429) return true;
  if (status >= 500 && status <= 599) return true;
  return /\b(?:timeout|temporarily|rate limit|overloaded|upstream|gateway|socket|network)\b/i.test(error || "");
}

function isNonRetryableSecLlmError(error: string | undefined) {
  const text = error || "";
  return /\b(?:MAX_TOKENS|parseable JSON|too many states|response schema|runaway output|repeated output|output too long)\b/i.test(text);
}

function isSecLlmRunawayError(error: string | undefined) {
  return /\b(?:MAX_TOKENS|runaway output|repeated output|output too long)\b/i.test(error || "");
}

function readSecLlmSafetyStopReason({
  outputText,
  finishReason,
  error,
}: {
  outputText: string;
  finishReason: string | null;
  error: string;
}) {
  if (/\bMAX_TOKENS\b/i.test(finishReason || "")) {
    return "SEC LLM stopped at MAX_TOKENS; retry disabled to prevent runaway cost.";
  }
  if (/\btoo many states for serving\b/i.test(error)) {
    return "SEC LLM response schema rejected before generation; retry disabled.";
  }
  if (outputText.length > SEC_LLM_RUNAWAY_OUTPUT_CHARS) {
    return `SEC LLM output too long (${outputText.length} chars); retry disabled to prevent runaway cost.`;
  }
  if (hasRepeatedSecLlmOutput(outputText)) {
    return "SEC LLM repeated output patterns; retry disabled to prevent runaway cost.";
  }
  return "";
}

function hasRepeatedSecLlmOutput(outputText: string) {
  if (outputText.length < 12_000) return false;
  const patterns = [
    /Score reason:/gi,
    /Quick take:/gi,
    /Key evidence:/gi,
    /What to watch next:/gi,
    /Source:/gi,
    /bullish_points/gi,
    /bearish_points/gi,
  ];
  if (patterns.some((pattern) => (outputText.match(pattern) || []).length >= 4)) return true;

  const sentenceCounts = new Map<string, number>();
  const sentences = outputText.match(/[^.!?\n]{40,320}[.!?]/g) || [];
  for (const sentence of sentences) {
    const normalized = sentence.toLowerCase().replace(/\s+/g, " ").trim();
    if (!normalized) continue;
    const count = (sentenceCounts.get(normalized) || 0) + 1;
    if (count >= 4) return true;
    sentenceCounts.set(normalized, count);
  }
  return false;
}

function waitForRetry(attempt: number) {
  const delayMs = attempt === 1 ? 1_000 : 3_000;
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function attachOfferingSecurityAudit(input: SecFilingAnalysisInput, audit: Record<string, unknown>) {
  const filingPackage = readRecord(input.filing_package);
  if (!filingPackage) return;

  const normalizedAudit = normalizeOfferingSecurityAuditForS3Package(filingPackage, audit);
  filingPackage.offering_security_audit = normalizedAudit;
  const marketContext = readRecord(filingPackage.market_context) as Parameters<typeof buildSecOfferingDilutionMetrics>[1];
  filingPackage.dilution_metrics = buildSecOfferingDilutionMetrics(filingPackage, marketContext);
}

function normalizeOfferingSecurityAuditForS3Package(
  filingPackage: Record<string, unknown>,
  audit: Record<string, unknown>,
) {
  const hardParsers = readRecord(filingPackage.hard_parsers);
  const s3 = readRecord(hardParsers?.s3);
  if (!s3) return audit;

  const offeringTerms = readRecord(s3.offering_terms);
  const feeTable = readRecord(s3.fee_table);
  const auditProceedsStack = readRecord(audit.proceeds_stack);
  const sellingStockholders = readRecord(s3.selling_stockholders);
  const sellingHolderCount = Number(sellingStockholders?.count || 0);
  const registrationKind = stringValue(s3.registration_statement_kind || offeringTerms?.registration_statement_kind).toLowerCase();
  const offeringType = stringValue(offeringTerms?.offering_type).toLowerCase();
  const primaryOrResale = stringValue(s3.primary_or_resale || offeringTerms?.primary_or_resale).toLowerCase();
  const hasParserResaleShareSupply = Boolean(
    primaryOrResale === "resale" &&
      (stringValue(s3.resale_share_count) || stringValue(offeringTerms?.resale_share_count)),
  );
  const hasDollarShelfCapacity = Boolean(
    stringValue(offeringTerms?.shelf_capacity) ||
      stringValue(offeringTerms?.offering_amount) ||
      stringValue(feeTable?.total_offering_amount) ||
      stringValue(auditProceedsStack?.company_gross_proceeds) ||
      stringValue(auditProceedsStack?.company_net_proceeds) ||
      stringValue(auditProceedsStack?.fee_table_amount_only),
  );
  const auditOfferingType = stringValue(audit.offering_type).toLowerCase();
  const isShelfLike =
    registrationKind.includes("shelf") ||
    offeringType.includes("shelf") ||
    auditOfferingType === "shelf" ||
    stringValue(filingPackage.form_type).toUpperCase().startsWith("S-3");
  const hasCurrentIssuerSaleTerms = Boolean(
    stringValue(offeringTerms?.offering_price) ||
      stringValue(offeringTerms?.closing_date) ||
      (offeringType === "atm" && stringValue(offeringTerms?.sales_agent)),
  );

  const normalized = JSON.parse(JSON.stringify(audit)) as Record<string, unknown>;
  let normalizedChanged = false;
  if (
    normalizeFeeTableProceeds({
      normalized,
      proceedsStack: readRecord(normalized.proceeds_stack),
      feeTable,
    })
  ) {
    normalizedChanged = true;
  }

  if (isShelfLike && hasDollarShelfCapacity && primaryOrResale !== "resale" && sellingHolderCount === 0 && !hasCurrentIssuerSaleTerms) {
    normalizeShelfCapacityProceeds({
      normalized,
      proceedsStack: readRecord(normalized.proceeds_stack),
      offeringTerms,
      feeTable,
    });
    normalizedChanged = true;
  }

  if (!isShelfLike || !hasDollarShelfCapacity || hasParserResaleShareSupply || primaryOrResale === "resale" || sellingHolderCount > 0) {
    return normalizedChanged ? normalized : audit;
  }

  const securityStack = readRecord(normalized.security_stack);
  if (!securityStack) return normalized;

  const clearedFact = buildNotDisclosedAuditFact(
    "No source-backed registered share count",
    "Base shelf discloses dollar capacity, not a current registered share-supply count.",
  );
  for (const key of [
    "primary_common_shares_offered",
    "primary_common_shares_registered",
    "resale_selling_stockholder_shares",
    "registered_resale_supply",
    "pre_funded_warrant_underlying_shares",
    "warrant_underlying_shares",
    "common_warrant_max_registered_underlying_shares",
    "convertible_note_underlying_shares",
    "preferred_conversion_shares",
    "equity_line_registered_shares",
    "additional_future_share_overhang",
    "max_registered_stack_share_equivalent",
  ]) {
    securityStack[key] = clearedFact;
  }

  normalized.needs_human_review = true;
  normalized.source_notes = appendUniqueString(
    normalized.source_notes,
    "Base shelf share-supply fields cleared: no parser-backed share count; authorized capital stock counts are excluded.",
  );
  normalized.review_reasons = appendUniqueString(
    normalized.review_reasons,
    "No source-backed share-count supply was found for this base shelf.",
  );
  return normalized;
}

function normalizeFeeTableProceeds({
  normalized,
  proceedsStack,
  feeTable,
}: {
  normalized: Record<string, unknown>;
  proceedsStack: Record<string, unknown> | null;
  feeTable: Record<string, unknown> | null;
}) {
  if (!proceedsStack) return false;

  const feeTableFact = readRecord(proceedsStack.fee_table_amount_only);
  const feeTableText =
    factText(feeTableFact) ||
    stringValue(feeTable?.total_offering_amount) ||
    stringValue(feeTable?.maximum_aggregate_offering_price);
  const feeTableAmount = factMoneyValue(feeTableFact) || parseMoneyLike(feeTableText);
  if (!feeTableAmount && !feeTableText) return false;

  let changed = false;
  if (!feeTableFact && feeTableText) {
    proceedsStack.fee_table_amount_only = buildFeeTableOnlyAuditFact(feeTableText, feeTableAmount);
    changed = true;
  }
  if (!readRecord(proceedsStack.sec_registration_value) && feeTableText) {
    proceedsStack.sec_registration_value = buildFeeTableOnlyAuditFact(feeTableText, feeTableAmount);
    changed = true;
  }

  for (const key of [
    "company_gross_proceeds",
    "company_net_proceeds",
    "resale_proceeds_to_company",
    "primary_offering_proceeds",
    "private_placement_proceeds",
    "possible_warrant_exercise_proceeds",
    "prefunded_warrant_exercise_proceeds",
    "common_warrant_cash_exercise_proceeds",
  ]) {
    const fact = readRecord(proceedsStack[key]);
    if (isSameMoneyFact(fact, feeTableAmount, feeTableText)) {
      proceedsStack[key] = buildNotDisclosedMoneyAuditFact(
        key === "resale_proceeds_to_company" ? "Resale proceeds to company not disclosed" : "Company proceeds not disclosed",
        "Fee-table amount is registration math, not issuer cash proceeds.",
      );
      changed = true;
    }
  }

  const sellingHolderFact = readRecord(proceedsStack.selling_stockholder_proceeds);
  if (isSameMoneyFact(sellingHolderFact, feeTableAmount, feeTableText) && isFeeTableBackedFact(sellingHolderFact)) {
    proceedsStack.selling_stockholder_proceeds = buildNotDisclosedMoneyAuditFact(
      "Selling-holder proceeds not separately disclosed",
      "Fee-table maximum aggregate amount is not separately stated selling-holder proceeds.",
    );
    normalized.source_notes = appendUniqueString(
      normalized.source_notes,
      "Fee-table maximum amount preserved separately; not treated as company or selling-holder proceeds.",
    );
    changed = true;
  }

  const resaleToCompanyFact = readRecord(proceedsStack.resale_proceeds_to_company);
  if (stringValue(normalized.offering_type).toLowerCase() === "resale" && factMoneyValue(resaleToCompanyFact) === 0) {
    const zeroCompanyProceedsFact = buildZeroCompanyProceedsAuditFact(
      factText(resaleToCompanyFact) || "$0",
      "Resale registration states issuer receives no resale proceeds.",
    );
    for (const key of ["company_gross_proceeds", "company_net_proceeds"]) {
      const fact = readRecord(proceedsStack[key]);
      if (!isDisclosedFact(fact)) {
        proceedsStack[key] = zeroCompanyProceedsFact;
        changed = true;
      }
    }
  }

  const sanityChecks = readRecord(normalized.sanity_checks);
  if (sanityChecks) {
    const stillUsesFeeTableAsProceeds = [
      proceedsStack.company_gross_proceeds,
      proceedsStack.company_net_proceeds,
      proceedsStack.resale_proceeds_to_company,
      proceedsStack.primary_offering_proceeds,
      proceedsStack.private_placement_proceeds,
      proceedsStack.possible_warrant_exercise_proceeds,
      proceedsStack.prefunded_warrant_exercise_proceeds,
      proceedsStack.common_warrant_cash_exercise_proceeds,
      proceedsStack.selling_stockholder_proceeds,
    ].some((fact) => isSameMoneyFact(readRecord(fact), feeTableAmount, feeTableText) && isFeeTableBackedFact(readRecord(fact)));
    const nextValue = !stillUsesFeeTableAsProceeds;
    if (sanityChecks.no_fee_table_amount_as_proceeds !== nextValue) {
      sanityChecks.no_fee_table_amount_as_proceeds = nextValue;
      changed = true;
    }
  }

  return changed;
}

function normalizeShelfCapacityProceeds({
  normalized,
  proceedsStack,
  offeringTerms,
  feeTable,
}: {
  normalized: Record<string, unknown>;
  proceedsStack: Record<string, unknown> | null;
  offeringTerms: Record<string, unknown> | null;
  feeTable: Record<string, unknown> | null;
}) {
  if (!proceedsStack) return;
  const shelfCapacityText = firstFactText([
    proceedsStack.fee_table_amount_only,
    proceedsStack.shelf_capacity,
    proceedsStack.company_gross_proceeds,
    proceedsStack.company_net_proceeds,
    offeringTerms?.shelf_capacity,
    offeringTerms?.offering_amount,
    feeTable?.total_offering_amount,
  ]);
  if (!proceedsStack.fee_table_amount_only && shelfCapacityText) {
    proceedsStack.fee_table_amount_only = {
      label: "Shelf dollar capacity",
      value_text: shelfCapacityText,
      numeric_value: null,
      unit: "usd",
      relationship: "shelf_capacity_not_current_proceeds",
      source: null,
      evidence: "Base shelf capacity is not current issuer cash proceeds.",
      confidence: "medium",
    };
  }
  if (!proceedsStack.shelf_capacity && shelfCapacityText) {
    proceedsStack.shelf_capacity = {
      label: "Shelf capacity",
      value_text: shelfCapacityText,
      numeric_value: null,
      unit: "usd",
      relationship: "shelf_capacity_not_current_proceeds",
      source: "Shelf registration",
      evidence: "Shelf capacity is not current issuer cash proceeds.",
      confidence: "medium",
    };
  }
  const clearedCashFact = buildNotCurrentCashAuditFact(
    "No current issuer proceeds disclosed",
    "Shelf capacity becomes issuer cash only if a later takedown, ATM sale, or prospectus supplement sells securities.",
  );
  proceedsStack.company_gross_proceeds = clearedCashFact;
  proceedsStack.company_net_proceeds = clearedCashFact;
  normalized.source_notes = appendUniqueString(
    normalized.source_notes,
    "Shelf dollar capacity preserved as capacity, not current issuer proceeds.",
  );
}

function buildNotDisclosedAuditFact(label: string, evidence: string) {
  return {
    label,
    value_text: null,
    numeric_value: null,
    unit: "shares",
    relationship: "not_disclosed",
    source: null,
    evidence,
    confidence: "unknown",
  };
}

function buildNotCurrentCashAuditFact(label: string, evidence: string) {
  return {
    label,
    value_text: null,
    numeric_value: null,
    unit: "usd",
    relationship: "not_current_proceeds",
    source: null,
    evidence,
    confidence: "unknown",
  };
}

function buildNotDisclosedMoneyAuditFact(label: string, evidence: string) {
  return {
    label,
    value_text: null,
    numeric_value: null,
    unit: "usd",
    relationship: "not_disclosed",
    source: null,
    evidence,
    confidence: "unknown",
  };
}

function buildFeeTableOnlyAuditFact(valueText: string, numericValue: number | null) {
  return {
    label: "SEC fee-table maximum amount",
    value_text: valueText,
    numeric_value: numericValue,
    unit: "usd",
    relationship: "fee_table_only",
    source: "Fee table",
    evidence: "SEC fee table maximum aggregate amount.",
    confidence: "high",
  };
}

function buildZeroCompanyProceedsAuditFact(valueText: string, evidence: string) {
  return {
    label: "Company proceeds from resale",
    value_text: valueText,
    numeric_value: 0,
    unit: "usd",
    relationship: "company_cash",
    source: "Prospectus proceeds disclosure",
    evidence,
    confidence: "high",
  };
}

function factText(fact: Record<string, unknown> | null) {
  return stringValue(fact?.value_text || fact?.text || fact?.value || fact?.amount);
}

function factMoneyValue(fact: Record<string, unknown> | null) {
  return numberValue(fact?.numeric_value) || parseMoneyLike(factText(fact));
}

function isDisclosedFact(fact: Record<string, unknown> | null) {
  return Boolean(factText(fact) || numberValue(fact?.numeric_value) !== null);
}

function parseMoneyLike(value: unknown) {
  const text = stringValue(value).toLowerCase();
  if (!text) return null;
  const match = text.match(/\$?\s*([\d,.]+)\s*(billion|million|bn|m)?\b/i);
  if (!match) return null;
  const base = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(base)) return null;
  const suffix = match[2] || "";
  if (suffix === "billion" || suffix === "bn") return base * 1_000_000_000;
  if (suffix === "million" || suffix === "m") return base * 1_000_000;
  return base;
}

function isSameMoneyFact(fact: Record<string, unknown> | null, amount: number | null, text: string | null) {
  if (!fact) return false;
  const factAmount = factMoneyValue(fact);
  if (amount && factAmount && Math.abs(factAmount - amount) <= Math.max(1, amount * 0.0001)) return true;
  const factTextValue = factText(fact);
  return Boolean(text && factTextValue && normalizeMoneyText(factTextValue) === normalizeMoneyText(text));
}

function normalizeMoneyText(value: string) {
  return value.toLowerCase().replace(/\s+/g, "").replace(/[,$]/g, "");
}

function isFeeTableBackedFact(fact: Record<string, unknown> | null) {
  if (!fact) return false;
  const text = [
    fact.label,
    fact.source,
    fact.evidence,
    fact.relationship,
    fact.value_text,
  ]
    .map(stringValue)
    .join(" ")
    .toLowerCase();

  return /\bfee[-\s]?table\b|maximum aggregate offering|proposed maximum offering|fee_table_only/.test(text);
}

function appendUniqueString(value: unknown, item: string) {
  const list = Array.isArray(value) ? value.map((entry) => stringValue(entry)).filter(Boolean) : [];
  if (!list.includes(item)) list.push(item);
  return list;
}

function firstFactText(values: unknown[]) {
  for (const value of values) {
    const record = readRecord(value);
    const text = record
      ? stringValue(record.value_text || record.text || record.value || record.amount || record.label)
      : stringValue(value);
    if (text) return text;
  }
  return null;
}

function attachS3AmendmentTriage(input: SecFilingAnalysisInput, triage: Record<string, unknown>) {
  const filingPackage = readRecord(input.filing_package);
  if (!filingPackage) return;
  filingPackage.s3_amendment_triage = triage;
}

function readMaxOutputTokens(promptKey: string) {
  if (promptKey === SEC_8K_6K_ROUTER_PROMPT_KEY) return 3000;
  if (promptKey === SEC_8K_6K_VALIDATION_REPAIR_PROMPT_KEY) return 1800;
  if (isSec8k6kAnalysisPromptKey(promptKey)) return 8000;
  if (promptKey === SEC_TENDER_ANALYSIS_PROMPT_KEY) return 8000;
  if (promptKey === SEC_424B_ANALYSIS_PROMPT_KEY) return 8000;
  if (promptKey === SEC_424B_VALIDATION_REPAIR_PROMPT_KEY) return 1800;
  if (promptKey === SEC_S1_F1_ANALYSIS_PROMPT_KEY) return 8000;
  if (promptKey === SEC_PROXY_ANALYSIS_PROMPT_KEY) return 3500;
  if (promptKey === SEC_PROXY_VALIDATION_REPAIR_PROMPT_KEY) return 1800;
  if (promptKey === SEC_S4_F4_VALIDATION_REPAIR_PROMPT_KEY) return 1800;
  if (promptKey === SEC_S8_VALIDATION_REPAIR_PROMPT_KEY) return 1800;
  if (promptKey === SEC_OWNERSHIP_VALIDATION_REPAIR_PROMPT_KEY) return 1800;
  if (promptKey === SEC_SC13_VALIDATION_REPAIR_PROMPT_KEY) return 1800;
  if (promptKey === SEC_S1_F1_VALIDATION_REPAIR_PROMPT_KEY) return 1800;
  if (promptKey === SEC_S3_VALIDATION_REPAIR_PROMPT_KEY) return 1800;
  if (promptKey === SEC_S1_F1_ROUTE_ONLY_PROMPT_KEY) return 1200;
  if (promptKey === SEC_S3_AMENDMENT_TRIAGE_PROMPT_KEY) return 2500;
  if (promptKey === SEC_OWNERSHIP_ANALYSIS_PROMPT_KEY) return 7000;
  return promptKey === SEC_S3_OFFERING_ANALYSIS_PROMPT_KEY ? 8000 : 5000;
}

function isProxyFilingInput(input: SecFilingAnalysisInput) {
  return Boolean(readProxyParserOutput(input));
}

function buildSecProxyAnalysisPromptForInput(
  input: SecFilingAnalysisInput,
): OpenAiPrompt {
  const parserOutput = readProxyParserOutput(input);
  if (!parserOutput) {
    throw new Error("SEC proxy parser output is missing from filing package");
  }
  const marketContext = readRecord(readRecord(input.filing_package)?.market_context);

  return {
    key: SEC_PROXY_ANALYSIS_PROMPT_KEY,
    version: SEC_PROXY_ANALYSIS_PROMPT_VERSION,
    system: [
      "Analyze one SEC proxy filing from cleaned source blocks.",
      "Return the full proxy Required Output JSON shape.",
      "Choose the proxy event type and display payload from source blocks; parser hints are non-binding.",
      "Score means investor attention and urgency. Delivery is derived later from score only.",
    ].join("\n"),
    user: buildProxyAnalysisPrompt({
      parserOutput,
      marketContext,
    }),
    responseFormat: {
      json_schema: {
        name: "sec_proxy_required_output",
        strict: false,
        schema: secProxyRequiredOutputSchema,
      },
    },
  };
}

function adaptSecProxyAnalysisPromptResultForAnalysis(root: Record<string, unknown>) {
  const analysisOutput = readRecord(root.analysis_output);
  const displayPayload = readRecord(root.display_payload);
  if (!analysisOutput) {
    return { ok: false as const, error: "SEC proxy result did not contain analysis_output" };
  }
  if (!displayPayload) {
    return { ok: false as const, error: "SEC proxy result did not contain display_payload" };
  }
  appendSecProxyDisplayWarnings(displayPayload, validateSecProxyDisplayPayload(displayPayload));
  return {
    ok: true as const,
    analysis: {
      ...analysisOutput,
      display_payload: displayPayload,
    },
  };
}

function readProxyParserOutput(input: SecFilingAnalysisInput): ProxyParserOutput | null {
  const filingPackage = readRecord(input.filing_package);
  const hardParsers = readRecord(filingPackage?.hard_parsers);
  const proxy = readRecord(hardParsers?.proxy);
  if (!proxy || stringValue(proxy.parserGroup) !== "proxy") return null;
  return proxy as unknown as ProxyParserOutput;
}

const secProxyRequiredOutputSchema = {
  type: "object",
  additionalProperties: true,
  required: ["parser_output", "analysis_output", "display_payload"],
  properties: {
    parser_output: {
      type: "object",
      additionalProperties: true,
    },
    analysis_output: secFilingAnalysisResponseSchema,
    display_payload: {
      type: "object",
      additionalProperties: true,
      required: ["display_type", "display_version", "data", "evidence", "notes"],
      properties: {
        display_type: {
          type: "string",
          enum: ["proxy_vote"],
        },
        display_version: {
          type: "string",
          enum: ["proxy_vote_v1"],
        },
        data: {
          type: "object",
          additionalProperties: true,
          required: ["summary_title", "summary_sentence", "snapshot", "proposals"],
          minProperties: 1,
          description: "Unified proxy vote UI payload. Missing or inconsistent fields are recorded as display_warnings, not persistence errors.",
          properties: {
            summary_title: { type: "string", minLength: 1, maxLength: 48 },
            summary_sentence: { type: "string", minLength: 1, maxLength: 160 },
            snapshot: {
              type: "array",
              minItems: 0,
              maxItems: 4,
              items: {
                type: "object",
                additionalProperties: true,
                required: ["label", "value"],
                properties: {
                  label: { type: "string", minLength: 1, maxLength: 24 },
                  value: { type: "string", minLength: 1, maxLength: 40 },
                  note: { type: ["string", "null"], maxLength: 80 },
                },
              },
            },
            expected_followup_forms: {
              type: "array",
              maxItems: 6,
              items: { type: "string", minLength: 1, maxLength: 72 },
              description:
                "Internal reference only. Likely follow-up forms such as 8-K Item 5.07, 8-K/A, 6-K for FPI, S-8 if additional plan shares are registered. Do not use this as visible UI what_to_watch_next copy.",
            },
            proposals: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: true,
                required: ["id", "title", "type", "board_recommendation", "is_shareholder_proposal", "explanation", "details"],
                properties: {
                  id: { type: "string", minLength: 1, maxLength: 24 },
                  title: { type: "string", minLength: 1, maxLength: 160 },
                  type: { type: "string", minLength: 1, maxLength: 40 },
                  board_recommendation: { type: "string", minLength: 1, maxLength: 32 },
                  is_shareholder_proposal: { type: "boolean" },
                  explanation: { type: "string", minLength: 1, maxLength: 120 },
                  details: {
                    type: "array",
                    maxItems: 4,
                    items: {
                      type: "object",
                      additionalProperties: true,
                      required: ["label", "value"],
                      properties: {
                        label: { type: "string", minLength: 1, maxLength: 24 },
                        value: { type: "string", minLength: 1, maxLength: 40 },
                        note: { type: ["string", "null"], maxLength: 80 },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        evidence: {
          type: "array",
          items: { type: "string" },
        },
        notes: {
          type: "array",
          items: { type: "string" },
        },
      },
    },
  },
} as const;

export async function findSecRawItem(options: PreviewOptions = {}) {
  if (options.rawItemId) {
    const result = await supabaseSelect("raw_items", {
      select: "*",
      id: `eq.${options.rawItemId}`,
      source_code: "eq.sec_edgar",
      limit: "1",
    });
    return readRawItemResult(result, `raw item id ${options.rawItemId}`);
  }

  if (options.accessionNumber) {
    const result = await supabaseSelect("raw_items", {
      select: "*",
      source_code: "eq.sec_edgar",
      source_unique_id: `eq.${options.accessionNumber}`,
      limit: "1",
    });
    return readRawItemResult(result, `accession ${options.accessionNumber}`);
  }

  const result = await supabaseSelect("raw_items", {
    select: "*",
    source_code: "eq.sec_edgar",
    order: "published_at.desc",
    limit: "100",
  });
  if (!result.ok) return { ok: false, status: result.status, error: result.error, rawItem: null };

  const rows = Array.isArray(result.data) ? (result.data as RawItemRow[]) : [];
  const ticker = stringValue(options.ticker).toUpperCase();
  const candidates = ticker ? rows.filter((row) => readRawTicker(row) === ticker) : rows;
  const rawItem = options.calendarCandidate ? candidates.find(hasCalendarCandidateText) : candidates[0];

  return {
    ok: Boolean(rawItem),
    status: result.status,
    rawItem: rawItem || null,
    error: rawItem ? undefined : "SEC raw item not found",
  };
}

export function buildInputFromSecRawRow(rawItem: RawItemRow): SecFilingAnalysisInput {
  const filingPackage = buildSecFilingAnalysisPackage(rawItem, {
    maxChars: 50_000,
    maxDocumentChars: 24_000,
  }) as Record<string, unknown>;

  return {
    filing_package: filingPackage,
  };
}

function buildSecFilingPromptForInput(input: SecFilingAnalysisInput, options: { secPromptVariant?: string } = {}) {
  if (is424bFilingInput(input)) return buildSec424bAnalysisPromptForInput(input, { promptVariant: options.secPromptVariant });
  if (isOwnershipFilingInput(input)) return buildSecOwnershipAnalysisPrompt(input);
  if (isSec425FilingInput(input)) return buildSec425RouterPromptForInput(input);
  if (isSec8k6kFilingInput(input)) return buildSec8k6kRouterPromptForInput(input);
  if (isTenderFilingInput(input)) return buildSecTenderAnalysisPromptForInput(input);
  if (isSc13FilingInput(input)) return buildSecSc13AnalysisPromptForInput(input);
  if (isS4F4FilingInput(input)) return buildSecS4F4AnalysisPromptForInput(input);
  if (isS8FilingInput(input)) return buildSecS8AnalysisPromptForInput(input);
  if (isS1F1FilingInput(input)) return buildSecS1F1AnalysisPromptForInput(input, { promptVariant: options.secPromptVariant });
  if (isSecNtFilingInput(input)) return buildSecNtAnalysisPromptForInput(input);
  if (isForm25FilingInput(input)) return buildSecForm25AnalysisPromptForInput(input);
  if (isSecPeriodicReportsFilingInput(input)) return buildSecPeriodicReportsAnalysisPromptForInput(input);
  return isS3FilingInput(input) ? buildSecS3AnalysisPrompt(input) : buildSecFilingAnalysisPrompt(input);
}

function shouldForceS3AmendmentAudit(input: SecFilingAnalysisInput, triage: Record<string, unknown>) {
  if (stringValue(triage.triage_action) !== "skip_analysis") return false;

  const filingPackage = readRecord(input.filing_package);
  if (!filingPackage || readRecord(filingPackage.parent_registration_context)) return false;

  const hardParsers = readRecord(filingPackage.hard_parsers);
  const s3 = readRecord(hardParsers?.s3);
  const amendment = readRecord(s3?.amendment);
  const formType = stringValue(filingPackage.form_type || amendment?.form_type)
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!s3 || (amendment?.is_amendment !== true && formType !== "S-3/A")) return false;

  const offeringTerms = readRecord(s3.offering_terms);
  const feeTable = readRecord(s3.fee_table);
  const sellingStockholders = readRecord(s3.selling_stockholders);
  const addedExhibits = Array.isArray(amendment?.added_exhibits) ? amendment.added_exhibits.map(stringValue) : [];
  const onlyConsentOrExhibitUpdate =
    addedExhibits.length > 0 &&
    addedExhibits.every((item) => /(?:ex-?23\.1|consent|auditor)/i.test(item)) &&
    !stringValue(offeringTerms?.resale_share_count) &&
    !stringValue(s3.resale_share_count) &&
    !stringValue(offeringTerms?.offering_amount) &&
    !stringValue(offeringTerms?.atm_program_size);

  if (onlyConsentOrExhibitUpdate) return false;

  return Boolean(
    stringValue(offeringTerms?.resale_share_count) ||
      stringValue(s3.resale_share_count) ||
      stringValue(offeringTerms?.offering_amount) ||
      stringValue(offeringTerms?.atm_program_size) ||
      stringValue(offeringTerms?.conversion_price) ||
      finiteNumber(feeTable?.row_count) ||
      finiteNumber(sellingStockholders?.count),
  );
}

function buildS3AmendmentSkipAnalysis(input: SecFilingAnalysisInput, triage: Record<string, unknown>) {
  const filingPackage = readRecord(input.filing_package) || {};
  const primaryTicker = readRecord(filingPackage.primary_ticker);
  const archiveSummary =
    stringValue(triage.archive_summary) ||
    "Routine S-3/A amendment with no changed offering economics or dilution terms.";
  const routineReasons = readStringArray(triage.routine_reasons).slice(0, 3);
  const materialReasons = readStringArray(triage.material_change_reasons).slice(0, 3);
  const keyEvidence = routineReasons.length ? routineReasons : ["No material offering-term change identified"];
  const confidence = normalizeTriageConfidence(stringValue(triage.confidence));
  const ticker = stringValue(primaryTicker?.ticker);
  const exchange = stringValue(primaryTicker?.exchange);
  const tickers = normalizeAnalysisTickers(filingPackage.tickers);

  return {
    analysis_action: "routine_archive",
    s3_case: "amendment",
    archive_summary: archiveSummary,
    offering_display_model: null,
    source_group: "filings",
    market_scope: "company",
    event_type: "other",
    event_title: "Routine S-3/A amendment",
    primary_ticker: {
      ticker: ticker || null,
      exchange: exchange || null,
    },
    tickers,
    sector: null,
    industry_group: null,
    theme_group: null,
    sub_theme: null,
    score: 10,
    score_reason: "routine s-3/a archive",
    signal: "neutral",
    quick_take: archiveSummary,
    summary: archiveSummary,
    why_it_matters: "No new offering economics or dilution mechanics were identified.",
    bullish_points: [],
    bearish_points: [],
    key_evidence: keyEvidence,
    what_to_watch_next: materialReasons,
    related_tickers: [],
    calendar_items: [],
    confidence,
    needs_human_review: Boolean(triage.needs_human_review),
  };
}

function buildSecInvestableUniverseSkipRun(
  rawItem: RawItemRow,
  input: SecFilingAnalysisInput,
  analysis: Record<string, unknown>,
  gate: SecInvestableUniverseGateResult,
): SecFilingAnalysisRunResult {
  const filingPackage = readRecord(input.filing_package);
  if (filingPackage) {
    filingPackage.investable_universe_gate = {
      action: gate.action,
      gate: gate.gate,
      reason: gate.reason,
      evidence: gate.evidence,
      confidence: gate.confidence,
    };
  }

  return {
    ok: true,
    stage: "complete",
    status: 200,
    model: getServerEnv().openAiModel,
    openAiResponseId: null,
    sourceItem: summarizeRawRow(rawItem),
    input,
    analysis,
    usage: null,
    costEstimate: null,
    prompt: {
      key: "sec_investable_universe_gate",
      version: "v1",
    },
  };
}

type DeterministicEffectAnalysis =
  | { ok: true; analysis: Record<string, unknown> }
  | { ok: false; error: string };

function buildDeterministicEffectAnalysis(
  input: SecFilingAnalysisInput,
  rawItem: RawItemRow,
): DeterministicEffectAnalysis | null {
  const filingPackage = readRecord(input.filing_package);
  if (!filingPackage) return null;

  const formType = stringValue(filingPackage.form_type) || readRawFormType(rawItem);
  if (normalizeRawRowFormType(formType) !== "EFFECT") return null;

  try {
    const hardParsers = readRecord(filingPackage.hard_parsers);
    const effectParser = readRecord(hardParsers?.effect);
    const facts = readRecord(effectParser?.facts);
    const rawPayload = readRecord(rawItem.raw_payload) || {};
    const metadata = readRecord(rawItem.metadata) || {};
    const parentContext = buildEffectParentFilingContextFromPackage(filingPackage, facts);
    const text = [
      stringValue(filingPackage.llm_text),
      stringValue(rawItem.body_text),
      stringValue(rawItem.analysis_text),
      stringValue(rawPayload.primary_document_html),
    ]
      .filter(Boolean)
      .join("\n\n");
    const documents = readRecordArray(rawPayload.documents).map((document) => ({
      type: stringValue(document.type) || null,
      filename: stringValue(document.filename) || stringValue(document.name) || null,
      description: stringValue(document.description) || null,
      url: stringValue(document.url) || null,
      text: stringValue(document.text) || null,
      html: stringValue(document.html) || null,
    }));

    const effectInput: EffectFilingInput = {
      formType: "EFFECT",
      accessionNumber:
        stringValue(filingPackage.accession_number) ||
        stringValue(rawPayload.accession_number) ||
        readRawAccession(rawItem),
      companyName:
        stringValue(facts?.companyName) ||
        stringValue(facts?.company_name) ||
        parentContext?.companyName ||
        readRawCompanyName(rawItem),
      ticker:
        stringValue(facts?.ticker) ||
        parentContext?.ticker ||
        stringValue(rawPayload.ticker) ||
        stringValue(metadata.ticker) ||
        null,
      exchange:
        stringValue(facts?.exchange) ||
        parentContext?.exchange ||
        stringValue(rawPayload.exchange) ||
        stringValue(metadata.exchange) ||
        null,
      cik:
        stringValue(facts?.cik) ||
        stringValue(rawPayload.cik) ||
        stringValue(metadata.cik) ||
        readRawCik(rawItem) ||
        null,
      filingDate:
        stringValue(filingPackage.filing_date) ||
        stringValue(rawPayload.filing_date) ||
        readRawFiledDate(rawItem) ||
        null,
      effectiveDate: stringValue(facts?.effectiveDate) || stringValue(facts?.effective_date) || null,
      effectiveTime: stringValue(facts?.effectiveTime) || stringValue(facts?.effective_time) || null,
      registrationNumber:
        stringValue(facts?.registrationNumber) ||
        stringValue(facts?.registration_number) ||
        parentContext?.registrationNumber ||
        null,
      effectiveFilingForm:
        stringValue(facts?.effectiveFilingForm) ||
        stringValue(facts?.effective_filing_form) ||
        parentContext?.formType ||
        null,
      relatedSubmissionType: stringValue(facts?.relatedSubmissionType) || stringValue(facts?.related_submission_type) || null,
      referenceAccessionNumber:
        stringValue(facts?.referenceAccessionNumber) || stringValue(facts?.reference_accession_number) || null,
      originalFilingReference:
        stringValue(facts?.originalFilingReference) ||
        stringValue(facts?.original_filing_reference) ||
        parentContext?.originalFilingReference ||
        null,
      text,
      html: stringValue(rawPayload.primary_document_html) || null,
      documents,
      parentFilingContext: parentContext,
      marketContext: readRecord(filingPackage.market_context) || readRecord(filingPackage.marketContext) || null,
    };

    const output = analyzeEffectFiling(effectInput);
    return {
      ok: true,
      analysis: {
        ...output.analysis_output,
        display_payload: output.display_payload,
        parser_output: output.parser_output,
        fixture_expected: output.fixture_expected,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "EFFECT deterministic analysis failed",
    };
  }
}

function buildDeterministicEffectRun(
  rawItem: RawItemRow,
  input: SecFilingAnalysisInput,
  deterministicEffect: DeterministicEffectAnalysis,
): SecFilingAnalysisRunResult {
  if (!deterministicEffect.ok) {
    return {
      ok: false,
      stage: "openai",
      status: 0,
      error: deterministicEffect.error,
      sourceItem: summarizeRawRow(rawItem),
      input,
      prompt: {
        key: "sec_effect_deterministic",
        version: "v1",
      },
    };
  }

  return {
    ok: true,
    stage: "complete",
    status: 200,
    model: getServerEnv().openAiModel,
    openAiResponseId: null,
    sourceItem: summarizeRawRow(rawItem),
    input,
    analysis: deterministicEffect.analysis,
    usage: null,
    costEstimate: null,
    prompt: {
      key: "sec_effect_deterministic",
      version: "v1",
    },
  };
}

function buildEffectParentFilingContextFromPackage(
  filingPackage: Record<string, unknown>,
  facts: Record<string, unknown> | null,
): EffectParentFilingContext | null {
  const parentContext = readRecord(filingPackage.parent_filing_context);
  const parent = readRecord(parentContext?.parent);
  if (!parent) return null;

  const displayPayload = readRecord(parent.display_payload);
  const displayData = readRecord(displayPayload?.data);
  return {
    formType: stringValue(parent.form_type) || null,
    accessionNumber: stringValue(parent.accession_number) || null,
    registrationNumber: stringValue(facts?.registrationNumber) || stringValue(facts?.registration_number) || null,
    filingDate: stringValue(parent.filed_at) || null,
    companyName: stringValue(parent.company_name) || null,
    ticker: stringValue(parent.ticker) || null,
    exchange: stringValue(parent.exchange) || stringValue(displayData?.exchange) || null,
    eventType: stringValue(parent.event_type) || null,
    eventTitle: stringValue(parent.event_title) || null,
    ipoKind: stringValue(displayData?.ipo_kind) || stringValue(displayData?.ipoKind) || null,
    score: numberValue(parent.score),
    analysisReference: stringValue(parent.event_id) || null,
    originalFilingReference: stringValue(parent.accession_number) || null,
    summary: stringValue(parent.quick_take) || stringValue(parent.summary) || null,
    shouldShowOriginalAnalysis: Boolean(stringValue(parent.event_id)),
  };
}

async function runGeminiJsonPrompt(prompt: OpenAiPrompt, llmConfig: SecLlmConfig): Promise<OpenAiPromptRun> {
  if (llmConfig.fallbackModel && llmConfig.fallbackModel !== llmConfig.model) {
    return runGeminiJsonPromptModelSequence(prompt, llmConfig, [
      llmConfig.model,
      llmConfig.model,
      llmConfig.fallbackModel,
    ]);
  }

  return runGeminiJsonPromptAttempts(prompt, llmConfig);
}

async function runGeminiJsonPromptModelSequence(
  prompt: OpenAiPrompt,
  llmConfig: SecLlmConfig,
  models: string[],
): Promise<OpenAiPromptRun> {
  let lastRun: OpenAiPromptRun | null = null;

  for (let index = 0; index < models.length; index += 1) {
    const run = await runGeminiJsonPromptAttempts(
      prompt,
      {
        ...llmConfig,
        model: models[index],
        fallbackModel: undefined,
      },
      1,
      index,
    );
    lastRun = run;

    if (run.ok || !shouldRetryOpenAiRun(run.status, run.error)) return run;
    if (index < models.length - 1) await waitForRetry(index + 1);
  }

  return lastRun || {
    ok: false,
    status: 0,
    provider: llmConfig.provider,
    model: models[models.length - 1] || llmConfig.model,
    openAiResponseId: null,
    outputText: "",
    parsed: null,
    usage: null,
    attempts: models.length,
    error: "Gemini request failed before response",
    rawOpenAIResponse: null,
  };
}

async function runGeminiJsonPromptAttempts(
  prompt: OpenAiPrompt,
  llmConfig: SecLlmConfig,
  maxAttempts = SEC_LLM_MAX_ATTEMPTS,
  attemptOffset = 0,
): Promise<OpenAiPromptRun> {
  let lastRun: OpenAiPromptRun | null = null;
  const url = buildGeminiGenerateContentUrl(llmConfig);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const attemptNumber = attemptOffset + attempt;
    try {
      const response = await fetch(url, {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: prompt.system }],
          },
          contents: [
            {
              role: "user",
              parts: [{ text: prompt.user }],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: readGeminiResponseSchema(prompt),
            maxOutputTokens: readMaxOutputTokens(prompt.key),
            temperature: 0,
            ...readGeminiThinkingConfig(llmConfig.model),
          },
        }),
      });

      const responseBody = (await response.json().catch(() => null)) as GeminiResponseBody | null;
      const outputText = readGeminiResponseOutputText(responseBody);
      const finishReason = readGeminiFinishReason(responseBody);
      const safetyStopReason = readSecLlmSafetyStopReason({
        outputText,
        finishReason,
        error: responseBody?.error?.message || response.statusText || "",
      });
      const parsed = response.ok && !safetyStopReason ? parseAnalysisJson(outputText) : null;
      lastRun = {
        ok: response.ok && !safetyStopReason && Boolean(parsed),
        status: response.status,
        provider: llmConfig.provider,
        model: llmConfig.model,
        openAiResponseId: responseBody?.responseId || null,
        outputText,
        parsed,
        usage: normalizeGeminiUsage(responseBody),
        attempts: attemptNumber,
        error:
          safetyStopReason ||
          (response.ok
            ? parsed
              ? undefined
              : "Gemini response did not contain parseable JSON"
            : responseBody?.error?.message || response.statusText || `<HTTP ${response.status}>`),
        rawOpenAIResponse: responseBody,
      };

      if (lastRun.ok || !shouldRetryOpenAiRun(lastRun.status, lastRun.error)) return lastRun;
    } catch (error) {
      lastRun = {
        ok: false,
        status: 0,
        provider: llmConfig.provider,
        model: llmConfig.model,
        openAiResponseId: null,
        outputText: "",
        parsed: null,
        usage: null,
        attempts: attemptNumber,
        error: error instanceof Error ? error.message : String(error),
        rawOpenAIResponse: null,
      };
    }

    if (attempt < maxAttempts) {
      await waitForRetry(attemptNumber);
    }
  }

  return lastRun || {
    ok: false,
    status: 0,
    provider: llmConfig.provider,
    model: llmConfig.model,
    openAiResponseId: null,
    outputText: "",
    parsed: null,
    usage: null,
    attempts: attemptOffset + maxAttempts,
    error: "Gemini request failed before response",
    rawOpenAIResponse: null,
  };
}

function readGeminiResponseSchema(prompt: OpenAiPrompt) {
  const schema = readRecord(prompt.responseFormat?.json_schema?.schema);
  return schema ? toGeminiResponseSchema(schema) : undefined;
}

function readGeminiThinkingConfig(model: string) {
  const normalized = model.trim().toLowerCase();
  if (!/^gemini-2\.5-flash/.test(normalized)) return {};
  return {
    thinkingConfig: {
      thinkingBudget: 0,
    },
  };
}

function toGeminiResponseSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => toGeminiResponseSchema(item));
  const record = readRecord(value);
  if (!record) return value;

  const output: Record<string, unknown> = {};
  for (const [key, childValue] of Object.entries(record)) {
    if (key === "additionalProperties") continue;
    if (key === "maxLength") continue;
    if (key === "maxItems") {
      // Gemini rejects deeply nested schemas when every internal array carries a
      // provider-side cap. Preserve only explicit small visible-list limits.
      if (isGeminiProviderBoundedArraySchema(record)) output[key] = childValue;
      continue;
    }
    if (key === "type" && Array.isArray(childValue)) {
      const nonNullType = childValue.find((item) => item !== "null");
      if (typeof nonNullType === "string") {
        output.type = nonNullType;
        if (childValue.includes("null")) output.nullable = true;
      }
      continue;
    }
    output[key] = toGeminiResponseSchema(childValue);
  }

  const maxLength = numberValue(record.maxLength);
  if (maxLength !== null && maxLength > 0) {
    const existingDescription = stringValue(output.description);
    const lengthGuidance = `Keep this string within ${maxLength} characters.`;
    output.description = existingDescription
      ? `${existingDescription} ${lengthGuidance}`
      : lengthGuidance;
  }

  return output;
}

function isGeminiProviderBoundedArraySchema(record: Record<string, unknown>) {
  if (record.type !== "array") return false;

  const description = stringValue(record.description);
  const limits = new Map<number, RegExp>([
    [1, /never return more than one item/i],
    [2, /never return more than two items/i],
    [3, /never return more than three items/i],
    [4, /never return more than four items/i],
  ]);
  const maxItems = finiteNumber(record.maxItems);
  return maxItems !== null && Boolean(limits.get(maxItems)?.test(description));
}

function buildGeminiGenerateContentUrl(llmConfig: SecLlmConfig) {
  const modelPath = llmConfig.model.startsWith("models/") ? llmConfig.model : `models/${llmConfig.model}`;
  const url = new URL(`https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent`);
  url.searchParams.set("key", llmConfig.apiKey);
  return url.toString();
}

function readGeminiResponseOutputText(body: GeminiResponseBody | null) {
  if (!body?.candidates?.length) return "";
  return body.candidates
    .flatMap((candidate) => candidate.content?.parts || [])
    .map((part) => part.text || "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

function readGeminiFinishReason(body: GeminiResponseBody | null) {
  return body?.candidates?.map((candidate) => candidate.finishReason).find(Boolean) || null;
}

function normalizeGeminiUsage(body: GeminiResponseBody | null): OpenAIUsage | null {
  const usage = body?.usageMetadata;
  if (!usage) return null;
  return {
    input_tokens: usage.promptTokenCount,
    output_tokens: usage.candidatesTokenCount,
    total_tokens: usage.totalTokenCount,
    ...usage,
  };
}

function normalizeAnalysisTickers(value: unknown) {
  const items = Array.isArray(value) ? value : [];
  return items
    .map((item) => {
      const record = readRecord(item);
      const ticker = stringValue(record?.ticker);
      if (!ticker) return null;
      return {
        ticker,
        exchange: stringValue(record?.exchange) || null,
        role: stringValue(record?.role) || "issuer",
      };
    })
    .filter(Boolean);
}

function normalizeTriageConfidence(value: string) {
  const normalized = value.toLowerCase();
  return normalized === "high" || normalized === "low" ? normalized : "medium";
}

async function buildInputFromSecRawRowWithContext(rawItem: RawItemRow): Promise<SecFilingAnalysisInput> {
  const input = await buildInputFromSecRawRowWithParentContext(rawItem);
  await attachSecMarketContext(input);
  await attachOwnershipFilingContext(input, rawItem);
  attachOwnershipArchiveContextGuardPreview(input);
  return input;
}

async function buildInputFromSecRawRowWithParentContext(rawItem: RawItemRow): Promise<SecFilingAnalysisInput> {
  const inputRawItem = await prepareSecRawItemWithParentContextForParser(rawItem);
  const input = buildInputFromSecRawRow(inputRawItem);
  await attachSecParentContexts(input, rawItem);
  await attachCurrentReportParentFilingContext(input, rawItem);
  await attachCurrentReportRelatedFilingContexts(input, rawItem);
  await attachCurrentReportAmendmentLifecycleContexts(input, rawItem);
  await attachTenderFilingContext(input, rawItem);
  return input;
}

async function attachSecMarketContext(input: SecFilingAnalysisInput) {
  const filingPackage = readRecord(input.filing_package);
  if (!filingPackage) return;

  await attachSc13IssuerTicker(input, filingPackage);

  const existingMarketContext = (readRecord(filingPackage.market_context) || readRecord(filingPackage.marketContext)) as
    | Awaited<ReturnType<typeof resolveSecOfferingMarketContext>>
    | null;
  const symbol = resolveSecMarketContextSymbol(filingPackage);
  const marketContext = existingMarketContext || (symbol ? await resolveSecOfferingMarketContext(symbol) : null);
  if (marketContext) {
    filingPackage.market_context = marketContext;
  }
  if (symbol) {
    const primaryTicker = readRecord(filingPackage.primary_ticker) || {};
    filingPackage.primary_ticker = {
      ...primaryTicker,
      ticker: stringValue(primaryTicker.ticker) || symbol,
    };
  }
  if (isS3FilingInput(input)) {
    filingPackage.dilution_metrics = buildSecOfferingDilutionMetrics(filingPackage, marketContext);
  }
}

type Sc13SecTickerRow = {
  cik: string;
  name: string;
  ticker: string;
  exchange: string | null;
};

let sc13SecTickerRowsPromise: Promise<Sc13SecTickerRow[]> | null = null;

async function attachSc13IssuerTicker(
  input: SecFilingAnalysisInput,
  filingPackage: Record<string, unknown>,
) {
  if (!isSc13FilingInput(input) || resolveSecMarketContextSymbol(filingPackage)) return;

  const hardParsers = readRecord(filingPackage.hard_parsers);
  const parserOutput = readRecord(hardParsers?.sc13);
  const facts = readRecord(parserOutput?.facts);
  const issuerName = stringValue(facts?.issuerName);
  if (!issuerName) return;

  const packageCik = normalizeCik(stringValue(filingPackage.cik));
  const rows = await fetchSc13SecTickerRows();
  const normalizedIssuerName = normalizeSc13IssuerName(issuerName);
  const exactNameRows = rows.filter((row) => normalizeSc13IssuerName(row.name) === normalizedIssuerName);
  const cikAndNameRows = packageCik
    ? exactNameRows.filter((row) => row.cik === packageCik)
    : [];
  const candidates = cikAndNameRows.length ? cikAndNameRows : exactNameRows;
  const selected = [...candidates].sort((left, right) => sc13TickerQualityScore(right.ticker) - sc13TickerQualityScore(left.ticker))[0];
  if (!selected) return;

  filingPackage.cik = selected.cik;
  filingPackage.primary_ticker = {
    ticker: selected.ticker,
    exchange: selected.exchange,
  };
  filingPackage.tickers = [{ ticker: selected.ticker, exchange: selected.exchange, role: "issuer" }];
  filingPackage.sc13_ticker_resolution = {
    source: cikAndNameRows.length ? "sec_cik_and_issuer_name" : "sec_exact_issuer_name",
    issuer_name: issuerName,
    cik: selected.cik,
  };

  const parserPrimaryTicker = readRecord(facts?.primaryTicker);
  if (parserPrimaryTicker) {
    facts!.primaryTicker = {
      ...parserPrimaryTicker,
      ticker: selected.ticker,
      exchange: selected.exchange,
    };
  }
}

async function fetchSc13SecTickerRows() {
  if (!sc13SecTickerRowsPromise) {
    sc13SecTickerRowsPromise = fetch("https://www.sec.gov/files/company_tickers_exchange.json", {
      cache: "no-store",
      headers: {
        "User-Agent": getServerEnv().secUserAgent || "US-Stock-Radar/0.1 contact@example.com",
        Accept: "application/json",
      },
    })
      .then(async (response) => {
        if (!response.ok) return [];
        const payload = await response.json().catch(() => null);
        const fields = Array.isArray(payload?.fields) ? payload.fields.map(stringValue) : [];
        const cikIndex = fields.indexOf("cik");
        const nameIndex = fields.indexOf("name");
        const tickerIndex = fields.indexOf("ticker");
        const exchangeIndex = fields.indexOf("exchange");
        if (cikIndex < 0 || nameIndex < 0 || tickerIndex < 0) return [];

        const dataRows: unknown[] = Array.isArray(payload?.data) ? payload.data : [];
        return dataRows
          .filter((row): row is unknown[] => Array.isArray(row))
          .map((row): Sc13SecTickerRow | null => {
            const cik = normalizeCik(stringValue(row[cikIndex]));
            const name = stringValue(row[nameIndex]);
            const ticker = normalizeMarketContextTicker(stringValue(row[tickerIndex]));
            if (!cik || !name || !ticker) return null;
            return {
              cik,
              name,
              ticker,
              exchange: stringValue(row[exchangeIndex]) || null,
            };
          })
          .filter((row): row is Sc13SecTickerRow => Boolean(row));
      })
      .catch(() => []);
  }

  return sc13SecTickerRowsPromise;
}

function normalizeSc13IssuerName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^A-Z0-9]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function sc13TickerQualityScore(ticker: string) {
  const value = ticker.toUpperCase();
  let score = 100;
  if (value.endsWith("W") || value.endsWith("WS") || value.endsWith("WT")) score -= 40;
  if (value.endsWith("U") || value.endsWith("UN")) score -= 25;
  if (value.endsWith("R") || value.endsWith("RT")) score -= 20;
  if (value.includes(".")) score -= 5;
  return score - Math.max(0, value.length - 4) * 3;
}

function resolveSecMarketContextSymbol(filingPackage: Record<string, unknown>) {
  const tenderSubjectTicker = resolveTenderSubjectMarketContextSymbol(filingPackage);
  if (tenderSubjectTicker) return tenderSubjectTicker;

  const primaryTicker = readRecord(filingPackage.primary_ticker);
  const direct = normalizeMarketContextTicker(
    stringValue(primaryTicker?.ticker) ||
      stringValue(filingPackage.ticker) ||
      firstTickerFromArray(filingPackage.tickers),
  );
  if (direct) return direct;

  const hardParsers = readRecord(filingPackage.hard_parsers);
  for (const parserOutput of Object.values(hardParsers || {})) {
    const parserRecord = readRecord(parserOutput);
    const facts = readRecord(parserRecord?.facts);
    const candidates = [
      stringValue(facts?.ticker),
      stringValue(facts?.symbol),
      stringValue(readRecord(facts?.issuer)?.ticker),
      stringValue(readRecord(facts?.issuer)?.symbol),
      stringValue(readRecord(facts?.company)?.ticker),
      stringValue(readRecord(facts?.company)?.symbol),
      stringValue(readRecord(facts?.filing)?.ticker),
      stringValue(readRecord(facts?.filing)?.symbol),
      stringValue(readRecord(facts?.filing)?.issuer_ticker),
      stringValue(readRecord(facts?.primaryTicker)?.ticker),
      stringValue(readRecord(facts?.primaryTicker)?.symbol),
      stringValue(readRecord(facts?.primary_ticker)?.ticker),
      stringValue(readRecord(facts?.primary_ticker)?.symbol),
      stringValue(readRecord(parserRecord?.primaryTicker)?.ticker),
      stringValue(readRecord(parserRecord?.primaryTicker)?.symbol),
      stringValue(readRecord(parserRecord?.primary_ticker)?.ticker),
      stringValue(readRecord(parserRecord?.primary_ticker)?.symbol),
      firstTickerFromArray(parserRecord?.tickers),
      firstTickerFromArray(facts?.tickers),
      firstTickerFromArray(facts?.related_tickers),
      firstTickerFromArray(parserRecord?.related_tickers),
    ];
    for (const candidate of candidates) {
      const normalized = normalizeMarketContextTicker(candidate);
      if (normalized) return normalized;
    }
  }

  return null;
}

function resolveTenderSubjectMarketContextSymbol(filingPackage: Record<string, unknown>) {
  const adapter = readRecord(filingPackage.form_adapter);
  if (stringValue(adapter?.parserGroup) !== "tender") return null;

  const hardParsers = readRecord(filingPackage.hard_parsers);
  const tenderParser = readRecord(hardParsers?.tender);
  const facts = readRecord(tenderParser?.facts);
  if (!facts) return null;

  const tenderCase = stringValue(facts.tender_case);
  const secFormType = stringValue(facts.sec_form_type);
  if (Boolean(facts.issuer_tender) || /issuer[_\s-]?tender|issuer[_\s-]?repurchase/i.test(tenderCase)) {
    return null;
  }
  if (
    !/third[_\s-]?party|going[_\s-]?private|13e-?3|cash[_\s-]?out|merger/i.test(tenderCase) &&
    !/^SC\s+TO-T/i.test(secFormType) &&
    !/^SC\s+13E3/i.test(secFormType)
  ) {
    return null;
  }

  const subjectCompany = resolveTenderSubjectCompanyName(filingPackage);
  const sourceText = [
    filingPackage.llm_text,
    readRecord(readRecord(tenderParser?.raw)?.source_package)?.text,
    facts.source_text,
  ]
    .map((item) => (typeof item === "object" && item !== null ? JSON.stringify(item) : stringValue(item)))
    .filter(Boolean)
    .join("\n");

  return extractExchangeTickerNearCompany(sourceText, subjectCompany);
}

function resolveTenderSubjectCompanyName(filingPackage: Record<string, unknown>) {
  const adapter = readRecord(filingPackage.form_adapter);
  if (stringValue(adapter?.parserGroup) !== "tender") return "";

  const hardParsers = readRecord(filingPackage.hard_parsers);
  const tenderParser = readRecord(hardParsers?.tender);
  const facts = readRecord(tenderParser?.facts);
  if (!facts) return "";

  const coverPage = readRecord(facts.cover_page);
  return (
    stringValue(readRecord(coverPage?.subject_company)?.value) ||
    stringValue(readRecord(facts.subject_company)?.value) ||
    stringValue(facts.subject_company) ||
    stringValue(facts.target_company)
  );
}

function resolveTenderSecurityCusip(filingPackage: Record<string, unknown>) {
  const adapter = readRecord(filingPackage.form_adapter);
  if (stringValue(adapter?.parserGroup) !== "tender") return "";

  const hardParsers = readRecord(filingPackage.hard_parsers);
  const tenderParser = readRecord(hardParsers?.tender);
  const facts = readRecord(tenderParser?.facts);
  if (!facts) return "";

  const securityIdentifiers = readRecord(facts.security_identifiers);
  const coverPage = readRecord(facts.cover_page);
  const candidates = [
    readRecord(securityIdentifiers?.cusip)?.value,
    securityIdentifiers?.cusip,
    readRecord(coverPage?.cusip)?.value,
    coverPage?.cusip,
  ];
  for (const candidate of candidates) {
    const normalized = stringValue(candidate).toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (/^[A-Z0-9]{9}$/.test(normalized)) return normalized;
  }
  return "";
}

type TenderTargetTickerCandidate = {
  ticker: string;
  exchange: string | null;
  company_name: string | null;
  cusip: string;
  source: string;
};

async function resolveTenderTargetTickerCandidateByCusip(
  filingPackage: Record<string, unknown>,
): Promise<TenderTargetTickerCandidate | null> {
  const cusip = resolveTenderSecurityCusip(filingPackage);
  if (!cusip) return null;

  const apiKey = getServerEnv().fmpApiKey;
  if (!apiKey) return null;

  const searchUrl = new URL("https://financialmodelingprep.com/stable/search-cusip");
  searchUrl.searchParams.set("cusip", cusip);
  searchUrl.searchParams.set("apikey", apiKey);

  try {
    const searchResponse = await fetch(searchUrl);
    if (!searchResponse.ok) return null;
    const searchJson: unknown = await searchResponse.json();
    const searchRows = Array.isArray(searchJson) ? searchJson.filter((row) => readRecord(row)) : [];

    for (const rowValue of searchRows.slice(0, 5)) {
      const row = readRecord(rowValue) || {};
      const ticker = normalizeMarketContextTicker(stringValue(row.symbol) || stringValue(row.ticker));
      if (!ticker) continue;

      const rowCusip = normalizeCusipValue(stringValue(row.cusip));
      const profile = await fetchFmpTickerProfileForCusipCheck(ticker, apiKey);
      const profileCusip = normalizeCusipValue(stringValue(profile?.cusip));
      const verifiedBySearch = rowCusip === cusip;
      const verifiedByProfile = profileCusip === cusip;
      if (!verifiedBySearch && !verifiedByProfile) continue;

      return {
        ticker,
        exchange: stringValue(row.exchangeShortName) || stringValue(profile?.exchangeShortName) || stringValue(profile?.exchange) || null,
        company_name: stringValue(row.companyName) || stringValue(row.name) || stringValue(profile?.companyName) || null,
        cusip,
        source: verifiedByProfile ? "fmp_search_cusip_profile_verified" : "fmp_search_cusip_verified",
      };
    }
  } catch {
    return null;
  }

  return null;
}

async function fetchFmpTickerProfileForCusipCheck(ticker: string, apiKey: string) {
  const profileUrl = new URL("https://financialmodelingprep.com/stable/profile");
  profileUrl.searchParams.set("symbol", ticker);
  profileUrl.searchParams.set("apikey", apiKey);

  try {
    const response = await fetch(profileUrl);
    if (!response.ok) return null;
    const json: unknown = await response.json();
    const rows = Array.isArray(json) ? json : [];
    return readRecord(rows[0]);
  } catch {
    return null;
  }
}

function normalizeCusipValue(value: string) {
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z0-9]{9}$/.test(normalized) ? normalized : "";
}

function extractExchangeTickerNearCompany(sourceText: string, companyName: string) {
  const text = sourceText.replace(/\s+/g, " ").trim();
  if (!text || !companyName) return null;
  const companyPattern = escapeRegExp(companyName).replace(/\\\s+/g, "\\s+");
  const exchangeTickerPattern = String.raw`(?:NYSE(?:\s+American|\s+Arca)?|Nasdaq|NASDAQ|OTC(?:QB|QX)?|Cboe)\s*:\s*([A-Z][A-Z0-9.\-]{0,9})`;
  const afterCompany = new RegExp(`${companyPattern}.{0,180}${exchangeTickerPattern}`, "i").exec(text);
  const afterTicker = afterCompany?.[1] ? normalizeMarketContextTicker(afterCompany[1]) : null;
  if (afterTicker) return afterTicker;

  const beforeCompany = new RegExp(`${exchangeTickerPattern}.{0,180}${companyPattern}`, "i").exec(text);
  const beforeTicker = beforeCompany?.[1] ? normalizeMarketContextTicker(beforeCompany[1]) : null;
  return beforeTicker;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function firstTickerFromArray(value: unknown) {
  if (!Array.isArray(value)) return "";
  for (const item of value) {
    const record = readRecord(item);
    const ticker = record ? stringValue(record.ticker) || stringValue(record.symbol) : stringValue(item);
    if (ticker) return ticker;
  }
  return "";
}

function normalizeMarketContextTicker(value: string) {
  const ticker = value.trim().toUpperCase();
  if (!ticker || ticker === "N/A" || ticker === "NONE" || ticker === "NULL") return null;
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(ticker)) return null;
  return ticker;
}

type OwnershipPreParserParent = {
  parent_filing_context: Record<string, unknown>;
  original_filing?: Record<string, unknown> | null;
};

type OwnershipParentSearchHints = {
  companyCiks: string[];
  ownerCiks: string[];
  ownerNames: string[];
  reportDates: string[];
  referencedDates: string[];
  filedDate: string;
  formType: string;
};

function readOwnershipParentSearchHints(row: RawItemRow): OwnershipParentSearchHints {
  const rawPayload = readRecord(row.raw_payload) || {};
  const metadata = readRecord(row.metadata) || {};
  const sourceText = readOwnershipParentSearchText(row);
  const ownerCiks = uniqueStrings(readOwnershipXmlValues(sourceText, "rptOwnerCik").map(normalizeCik).filter(Boolean));
  const ownerNames = uniqueStrings(readOwnershipXmlValues(sourceText, "rptOwnerName").map(normalizePersonName).filter(Boolean));
  const companyCiks = uniqueStrings(
    [
      readRawCik(row),
      stringValue(rawPayload.ownership_issuer_cik),
      stringValue(rawPayload.issuer_cik),
      stringValue(metadata.ownership_issuer_cik),
      ...readOwnershipXmlValues(sourceText, "issuerCik"),
    ]
      .map(normalizeCik)
      .filter(Boolean),
  );
  const reportDates = uniqueStrings(
    [
      ...readOwnershipXmlValues(sourceText, "periodOfReport"),
      ...readOwnershipNestedXmlValues(sourceText, "transactionDate", "value"),
      ...readOwnershipNestedXmlValues(sourceText, "deemedExecutionDate", "value"),
    ]
      .map(normalizeDateOnly)
      .filter(Boolean),
  );

  return {
    companyCiks,
    ownerCiks,
    ownerNames,
    reportDates,
    referencedDates: extractOwnershipReferencedDates(sourceText),
    filedDate: normalizeDateOnly(stringValue(row.published_at) || stringValue(rawPayload.filing_date)),
    formType: readRawFormType(row),
  };
}

function readOwnershipParentSearchText(row: RawItemRow) {
  const rawPayload = readRecord(row.raw_payload) || {};
  const metadata = readRecord(row.metadata) || {};
  const attachmentText = readRecordArray(rawPayload.attachment_texts)
    .map((attachment) => stringValue(attachment.text))
    .filter(Boolean)
    .join("\n");
  return [
    row.title,
    rawPayload.ownership_source_text,
    metadata.ownership_source_text,
    row.body_text,
    row.analysis_text,
    attachmentText,
  ]
    .map(stringValue)
    .filter(Boolean)
    .join("\n")
    .slice(0, 500_000);
}

function readOwnershipXmlValues(text: string, tag: string) {
  return Array.from(text.matchAll(new RegExp(`<(?:[A-Za-z0-9_]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_]+:)?${tag}>`, "gi")))
    .map((match) => stripSearchTags(match[1]))
    .filter(Boolean);
}

function readOwnershipNestedXmlValues(text: string, parentTag: string, childTag: string) {
  return Array.from(text.matchAll(new RegExp(`<(?:[A-Za-z0-9_]+:)?${parentTag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_]+:)?${parentTag}>`, "gi")))
    .flatMap((match) => readOwnershipXmlValues(match[1], childTag))
    .filter(Boolean);
}

function extractOwnershipReferencedDates(text: string) {
  const dates = [
    ...Array.from(text.matchAll(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/g)).map(
      (match) => `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`,
    ),
    ...Array.from(
      text.matchAll(
        /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(20\d{2})\b/gi,
      ),
    ).map((match) => normalizeDateOnly(`${match[1]} ${match[2]}, ${match[3]}`)),
  ];
  return uniqueStrings(dates.map(normalizeDateOnly).filter(Boolean));
}

function stripSearchTags(value: string) {
  return stringValue(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function intersects(left: string[], right: string[]) {
  const rightSet = new Set(right.filter(Boolean));
  return left.some((value) => rightSet.has(value));
}

async function findOwnershipAmendmentParentBeforeParser(rawItem: RawItemRow): Promise<OwnershipPreParserParent | null> {
  const formType = readRawFormType(rawItem);
  if (!isOwnershipAmendmentFormForParentParser(formType)) return null;

  const currentAccession = readRawAccession(rawItem);
  const currentHints = readOwnershipParentSearchHints(rawItem);
  const explicitParentAccession = extractExplicitParentAccessionFromRawItem(rawItem);
  if (explicitParentAccession) {
    const row = await fetchSecRawItemByAccession(explicitParentAccession);
    if (row && readRawAccession(row) !== currentAccession && isOwnershipParentFamilyMatch(formType, readRawFormType(row))) {
      const context = await buildGenericAmendmentParentContext({
        status: "found",
        confidence: "high",
        matchMethod: "explicit_parent_accession",
        matchScore: 1000,
        matchReasons: ["explicit_parent_accession"],
        rawItem,
        parentRow: row,
        candidateRows: [row],
      });
      return {
        parent_filing_context: context,
        original_filing: buildOwnershipOriginalFilingInput(row),
      };
    }
  }

  const candidateRows = await fetchGenericAmendmentParentCandidateRows(rawItem, currentHints);
  const currentFiledAt = Date.parse(stringValue(rawItem.published_at));
  const currentTicker = readRawTicker(rawItem);
  const currentCik = normalizeCik(readRawCik(rawItem));
  const scored = candidateRows
    .filter((row) => readRawAccession(row) !== currentAccession)
    .filter((row) => isOwnershipParentFamilyMatch(formType, readRawFormType(row)))
    .map((row) => {
      const rowFiledAt = Date.parse(stringValue(row.published_at));
      if (Number.isFinite(currentFiledAt) && Number.isFinite(rowFiledAt) && rowFiledAt >= currentFiledAt) return null;

      const rowAgeDays =
        Number.isFinite(currentFiledAt) && Number.isFinite(rowFiledAt)
          ? Math.max(0, Math.round((currentFiledAt - rowFiledAt) / (24 * 60 * 60 * 1000)))
          : null;
      if (rowAgeDays !== null && rowAgeDays > 365) return null;

      const rowTicker = readRawTicker(row);
      const rowCik = normalizeCik(readRawCik(row));
      const rowHints = readOwnershipParentSearchHints(row);
      const sameOwnerCik = intersects(currentHints.ownerCiks, rowHints.ownerCiks);
      const sameOwnerName = intersects(currentHints.ownerNames, rowHints.ownerNames);
      const targetDates = uniqueStrings([...currentHints.reportDates, ...currentHints.referencedDates]);
      const candidateDates = uniqueStrings([...rowHints.reportDates, rowHints.filedDate]);
      const matchReasons: string[] = ["ownership_amendment_parent_candidate"];
      let score = 90;

      if (currentCik && rowCik && currentCik === rowCik) {
        score += 90;
        matchReasons.push("same_cik");
      }
      if (currentTicker && rowTicker && currentTicker === rowTicker) {
        score += 45;
        matchReasons.push("same_ticker");
      }
      if (sameOwnerCik) {
        score += 180;
        matchReasons.push("same_reporting_owner_cik");
      } else if (sameOwnerName) {
        score += 90;
        matchReasons.push("same_reporting_owner_name");
      } else if (currentHints.ownerCiks.length || currentHints.ownerNames.length) {
        score -= 60;
        matchReasons.push("reporting_owner_not_matched");
      }
      if (intersects(targetDates, candidateDates)) {
        score += 160;
        matchReasons.push("report_or_referenced_date_match");
      }
      if (!isOwnershipAmendmentFormForParentParser(readRawFormType(row))) {
        score += 80;
        matchReasons.push("non_amendment_parent_preferred");
      }
      if (rowAgeDays !== null) {
        if (rowAgeDays <= 30) score += 40;
        else if (rowAgeDays <= 180) score += 20;
        else score += 5;
        matchReasons.push(`filed_${rowAgeDays}_days_before`);
      }

      return {
        row,
        score,
        matchReasons,
        matchMethod:
          sameOwnerCik && intersects(targetDates, candidateDates)
            ? "ownership_owner_cik_report_date_parent"
            : sameOwnerCik || sameOwnerName
            ? "ownership_reporting_owner_recent_parent"
            : "ownership_same_issuer_recent_parent",
      };
    })
    .filter((item): item is { row: RawItemRow; score: number; matchReasons: string[]; matchMethod: string } => Boolean(item))
    .filter((item) => item.score >= 150)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return Date.parse(stringValue(right.row.published_at)) - Date.parse(stringValue(left.row.published_at));
    });

  const best = scored[0];
  const second = scored[1];
  if (!best) {
    const context = await buildGenericAmendmentParentContext({
      status: "not_found",
      confidence: "low",
      matchMethod: "none",
      matchScore: 0,
      matchReasons: ["no_ownership_parent_candidate_found_before_parser"],
      rawItem,
      parentRow: null,
      candidateRows: [],
    });
    return {
      parent_filing_context: context,
      original_filing: null,
    };
  }

  const ambiguous = second && best.score - second.score < 20;
  const context = await buildGenericAmendmentParentContext({
    status: ambiguous ? "multiple_candidates" : "found",
    confidence: ambiguous ? "medium" : best.score >= 220 ? "high" : "medium",
    matchMethod: best.matchMethod,
    matchScore: best.score,
    matchReasons: best.matchReasons,
    rawItem,
    parentRow: ambiguous ? null : best.row,
    candidateRows: scored.slice(0, 5).map((item) => item.row),
  });

  return {
    parent_filing_context: context,
    original_filing: ambiguous ? null : buildOwnershipOriginalFilingInput(best.row),
  };
}

function addParentContextToRawItemForParser(rawItem: RawItemRow, parent: OwnershipPreParserParent): RawItemRow {
  const rawPayload = readRecord(rawItem.raw_payload) || {};
  const metadata = readRecord(rawItem.metadata) || {};
  return {
    ...rawItem,
    raw_payload: {
      ...rawPayload,
      parent_filing_context: parent.parent_filing_context,
      ...(parent.original_filing ? { ownership_original_filing: parent.original_filing } : {}),
    },
    metadata: {
      ...metadata,
      parent_filing_context: parent.parent_filing_context,
    },
  };
}

function buildOwnershipOriginalFilingInput(row: RawItemRow) {
  const rawPayload = readRecord(row.raw_payload) || {};
  const metadata = readRecord(row.metadata) || {};
  const attachmentTexts = readRecordArray(rawPayload.attachment_texts);
  return {
    id: stringValue(row.id) || stringValue(row.source_unique_id) || "ownership-parent",
    formType: readRawFormType(row) || "4",
    accessionNumber: readRawAccession(row) || null,
    filingText: [
      stringValue(row.body_text),
      stringValue(row.analysis_text),
      ...attachmentTexts.map((attachment) => stringValue(attachment.text)),
    ]
      .filter(Boolean)
      .join("\n\n"),
    attachments: attachmentTexts.map((attachment) => ({
      type: stringValue(attachment.type) || stringValue(attachment.documentType) || null,
      description: stringValue(attachment.description) || null,
      filename: stringValue(attachment.filename) || stringValue(attachment.name) || null,
      url: stringValue(attachment.url) || null,
      text: stringValue(attachment.text) || null,
    })),
    rawPayload,
    metadata,
    issuer: {
      name: readRawCompanyName(row) || null,
      ticker: readRawTicker(row) || null,
      exchange: stringValue(rawPayload.exchange) || stringValue(metadata.exchange) || null,
      cik: readRawCik(row) || null,
    },
    source: {
      url: stringValue(row.source_url) || stringValue(rawPayload.source_url) || stringValue(rawPayload.detail_url) || null,
    },
  };
}

function isOwnershipAmendmentFormForParentParser(formType: string) {
  const normalized = normalizeSecFormForParentContext(formType);
  return normalized === "4/A" || normalized === "144/A";
}

function isOwnershipParentFamilyMatch(currentFormType: string, parentFormType: string) {
  const current = normalizeGenericParentFormFamily(currentFormType);
  const parent = normalizeGenericParentFormFamily(parentFormType);
  return (current === "4" && parent === "4") || (current === "144" && parent === "144");
}

async function attachOwnershipFilingContext(input: SecFilingAnalysisInput, rawItem: RawItemRow) {
  if (!isOwnershipFilingInput(input)) return;

  const filingPackage = readRecord(input.filing_package);
  if (!filingPackage) return;

  const existingContext = readRecord(filingPackage.filing_context);
  if (readRecord(existingContext?.ownership)) return;

  const parserOutput = readOwnershipParserOutputForContext(input);
  if (!parserOutput) return;

  const context = await buildOwnershipFilingContext({
    input,
    parserOutput,
    rawItem,
  });

  filingPackage.filing_context = {
    ...(existingContext || {}),
    ownership: context.ownership,
    context_as_of: context.context_as_of,
    source_notes: context.source_notes,
  };
}

async function attachTenderFilingContext(input: SecFilingAnalysisInput, rawItem: RawItemRow) {
  if (!isTenderFilingInput(input)) return;

  const filingPackage = readRecord(input.filing_package);
  if (!filingPackage) return;

  const existingContext = readRecord(filingPackage.filing_context);
  if (readRecord(existingContext?.transaction_history)) return;

  const transactionHistory = await buildTenderTransactionHistoryContext(input, rawItem);
  if (!transactionHistory) return;

  filingPackage.filing_context = {
    ...(existingContext || {}),
    transaction_history: transactionHistory,
    context_as_of: stringValue(existingContext?.context_as_of) || new Date().toISOString(),
    source_notes: uniqueStrings([
      ...readStringArray(existingContext?.source_notes),
      "Tender transaction_history is built by integration from persisted SEC raw_items, events, event_analysis, and transaction_fingerprint metadata.",
      "Historical full raw filing text is excluded; use compact prior analysis, key evidence, display payload, transaction_fingerprint, snippets, and inventory only.",
      "Prior tender history helps distinguish first definitive disclosures from repeated amendments or follow-up filings.",
    ]),
  };
}

async function buildTenderTransactionHistoryContext(input: SecFilingAnalysisInput, rawItem: RawItemRow) {
  const filingPackage = readRecord(input.filing_package);
  if (!filingPackage) return null;

  const currentAccession = readRawAccession(rawItem);
  const currentFiledAt = Date.parse(stringValue(rawItem.published_at));
  const currentFormType = stringValue(filingPackage.form_type) || readRawFormType(rawItem);
  const currentFamily = normalizeGenericParentFormFamily(currentFormType);
  const targetTickerCandidate = await resolveTenderTargetTickerCandidateByCusip(filingPackage);
  const subjectTicker =
    targetTickerCandidate?.ticker ||
    resolveTenderSubjectMarketContextSymbol(filingPackage) ||
    normalizeMarketContextTicker(stringValue(readRecord(filingPackage.primary_ticker)?.ticker)) ||
    readRawTicker(rawItem) ||
    "";
  const subjectCompany = resolveTenderSubjectCompanyName(filingPackage);
  const companySearchTerm = tenderCompanyHistorySearchTerm(subjectCompany || readRawCompanyName(rawItem));
  const securityCusip = resolveTenderSecurityCusip(filingPackage);
  const currentMatchFacts = buildCurrentTenderTransactionMatchFacts(filingPackage, rawItem, targetTickerCandidate?.ticker || "");
  const currentCik = normalizeCik(readRawCik(rawItem));
  const candidateEvents = await fetchTenderTransactionHistoryEventRows(rawItem, subjectTicker, subjectCompany);
  const candidateRawRows = await fetchTenderTransactionHistoryRawRows(rawItem, companySearchTerm, securityCusip);
  const analysisByEventId = await fetchOwnershipContextAnalysisRows(candidateEvents.map((event) => stringValue(event.id)));

  const priorEvents = dedupeEventRows(candidateEvents)
    .filter((event) => {
      const metadata = readRecord(event.metadata) || {};
      const accession = stringValue(metadata.accession_number) || stringValue(metadata.accessionNumber);
      return !currentAccession || accession !== currentAccession;
    })
    .filter((event) => {
      const formFamily = readTenderEventFormFamily(event);
      return isTenderParentContextFamily(formFamily) || Boolean(readRecord(readRecord(event.metadata)?.transaction_fingerprint));
    })
    .filter((event) => {
      const eventFiledAt = Date.parse(stringValue(event.published_at) || stringValue(event.detected_at));
      if (!Number.isFinite(currentFiledAt) || !Number.isFinite(eventFiledAt)) return true;
      if (eventFiledAt > currentFiledAt && !isSameUtcCalendarDay(eventFiledAt, currentFiledAt)) return false;
      const ageDays = Math.max(0, Math.round((currentFiledAt - eventFiledAt) / (24 * 60 * 60 * 1000)));
      return ageDays <= 1095;
    })
    .map((event) => ({
      event,
      match: scoreTenderTransactionHistoryEventMatch(currentMatchFacts, event),
    }))
    .filter((item) => item.match.match_score >= 60)
    .sort(
      (left, right) =>
        right.match.match_score - left.match.match_score ||
        Date.parse(stringValue(right.event.published_at) || stringValue(right.event.detected_at)) -
          Date.parse(stringValue(left.event.published_at) || stringValue(left.event.detected_at)),
    )
    .slice(0, 20);
  const priorRawRows = dedupeRawRows(candidateRawRows)
    .filter((row) => readRawAccession(row) !== currentAccession)
    .filter((row) => isTenderParentContextFamily(normalizeGenericParentFormFamily(readRawFormType(row))))
    .filter((row) => {
      const rowFiledAt = Date.parse(stringValue(row.published_at));
      if (!Number.isFinite(currentFiledAt) || !Number.isFinite(rowFiledAt)) return true;
      if (rowFiledAt > currentFiledAt && !isSameUtcCalendarDay(rowFiledAt, currentFiledAt)) return false;
      const ageDays = Math.max(0, Math.round((currentFiledAt - rowFiledAt) / (24 * 60 * 60 * 1000)));
      return ageDays <= 1095;
    })
    .sort((left, right) => Date.parse(stringValue(right.published_at)) - Date.parse(stringValue(left.published_at)))
    .slice(0, 12);

  const eventPriorFilings = priorEvents
    .map(({ event, match }) => compactTenderTransactionHistoryEvent(event, analysisByEventId.get(stringValue(event.id)), match))
    .slice(0, 12);
  const rawPriorFilings = (await Promise.all(priorRawRows.map(compactTenderTransactionHistoryRawRow)))
    .filter(Boolean)
    .slice(0, 12);
  const parentHistory = compactTenderParentContextAsHistoryEvent(readRecord(filingPackage.parent_filing_context));
  const priorFilings = dedupeTenderHistoryRecords([parentHistory, ...eventPriorFilings, ...rawPriorFilings]).slice(0, 12);

  if (!priorFilings.length) {
    return {
      source: "raw_items_events_transaction_fingerprint_compact",
      context_kind: "tender_transaction_history",
      current_filing: {
        accession_number: currentAccession || null,
        form_type: currentFormType || null,
        form_family: currentFamily || null,
        filed_at: stringValue(rawItem.published_at) || readRawFiledDate(rawItem) || null,
        ticker: subjectTicker || null,
        target_ticker: targetTickerCandidate?.ticker || null,
        target_exchange: targetTickerCandidate?.exchange || null,
        target_ticker_source: targetTickerCandidate?.source || null,
        target_ticker_cusip: targetTickerCandidate?.cusip || null,
        company_name: subjectCompany || readRawCompanyName(rawItem) || null,
        company_search_term: companySearchTerm || null,
        cusip: securityCusip || null,
        cik: currentCik || null,
      },
      prior_count: 0,
      prior_filings: [],
      source_notes: [
        "No prior compact tender transaction history was found for the current ticker/CIK search window.",
        "Do not infer first-disclosure status solely from missing context; use current source blocks and parent_filing_context when available.",
      ],
    };
  }

  return {
    source: "raw_items_events_transaction_fingerprint_compact",
    context_kind: "tender_transaction_history",
    current_filing: {
      accession_number: currentAccession || null,
      form_type: currentFormType || null,
      form_family: currentFamily || null,
      filed_at: stringValue(rawItem.published_at) || readRawFiledDate(rawItem) || null,
      ticker: subjectTicker || null,
      target_ticker: targetTickerCandidate?.ticker || null,
      target_exchange: targetTickerCandidate?.exchange || null,
      target_ticker_source: targetTickerCandidate?.source || null,
      target_ticker_cusip: targetTickerCandidate?.cusip || null,
      company_name: subjectCompany || readRawCompanyName(rawItem) || null,
      company_search_term: companySearchTerm || null,
      cusip: securityCusip || null,
      cik: currentCik || null,
    },
    prior_count: priorFilings.length,
    prior_filings: priorFilings,
    prior_fingerprint_count: priorFilings.filter((item) => readRecord(item.transaction_fingerprint)).length,
    source_notes: [
      "Prior filings are compact context only and may include parent filings, prior amendments, or related tender/13E-3/CB filings.",
      "Use transaction_fingerprint and parent_filing_context to compare economics, deadlines, financing, conditions, results, and closing status.",
      "Do not treat a prior filing as the same transaction unless the compact context supports the link.",
    ],
  };
}

async function buildOwnershipFilingContext({
  input,
  parserOutput,
  rawItem,
}: {
  input: SecFilingAnalysisInput;
  parserOutput: Record<string, unknown>;
  rawItem: RawItemRow;
}) {
  const identity = extractOwnershipCurrentIdentity(input, parserOutput, rawItem);
  const candidates = await fetchOwnershipContextEventCandidates(identity, rawItem);
  const currentAccession = identity.accessionNumber;
  const currentRawItemId = stringValue(rawItem.id);
  const currentDate = parseContextDate(identity.filedAt) || new Date();
  const analysisByEventId = await fetchOwnershipContextAnalysisRows(candidates.map((event) => stringValue(event.id)));
  const currentEvent = compactCurrentOwnershipContextEvent(identity, parserOutput, rawItem);
  const packageParentCandidate = buildOwnershipPackageParentCandidate(input);

  const compactEvents = candidates
    .filter((event) => {
      if (currentRawItemId && stringValue(event.raw_item_id) === currentRawItemId) return false;
      const metadata = readRecord(event.metadata) || {};
      const eventAccession = stringValue(metadata.accession_number) || stringValue(metadata.accessionNumber);
      return !currentAccession || eventAccession !== currentAccession;
    })
    .map((event) => compactOwnershipContextEvent(event, analysisByEventId.get(stringValue(event.id))))
    .filter((event) => sameOwnershipCompany(identity, event));

  const sameInsider12m = compactEvents
    .filter((event) => isWithinDays(event.filed_at, currentDate, 365))
    .filter((event) => sameOwnershipInsider(identity, event))
    .slice(0, 30);

  const company90dEvents = compactEvents
    .filter((event) => isWithinDays(event.filed_at, currentDate, 90))
    .slice(0, 80);
  const company30dEvents = compactEvents
    .filter((event) => isWithinDays(event.filed_at, currentDate, 30))
    .slice(0, 60);

  return {
    ownership: {
      same_insider_12m_trades: sameInsider12m,
      company_90d_insider_flow: buildOwnershipCompanyFlow(company90dEvents),
      recent_30d_cluster: buildOwnershipRecentCluster(company30dEvents),
      related_form144_candidates: buildRelatedForm144Candidates(identity, currentEvent, compactEvents, currentDate),
      related_form4_execution_candidates: buildRelatedForm4ExecutionCandidates(identity, currentEvent, compactEvents, currentDate),
      amendment_parent_candidate:
        buildOwnershipAmendmentParentCandidate(identity, currentEvent, compactEvents, currentDate) || packageParentCandidate,
    },
    context_as_of: new Date().toISOString(),
    source_notes: [
      "Ownership filing_context is built by integration from persisted SEC filing events and event_analysis, not by the parser.",
      "Historical full raw filing text is excluded; only compact prior analysis, display payload facts, and key evidence are included.",
      "Form 144/Form 4 execution links and 4/A parent comparison are candidate matches, not definitive conclusions.",
    ],
  };
}

type OwnershipArchiveContextGuard = {
  analysis_needed: boolean;
  context_signal_level: "none" | "low" | "material";
  reasons: string[];
  metrics: Record<string, unknown>;
};

function evaluateOwnershipArchiveContextGuard(input: SecFilingAnalysisInput): OwnershipArchiveContextGuard {
  const filingPackage = readRecord(input.filing_package);
  const filingContext = readRecord(filingPackage?.filing_context);
  const ownership = readRecord(filingContext?.ownership);
  const parserOutput = readOwnershipParserOutputForContext(input);
  const currentMetrics = readCurrentOwnershipContextMetrics(parserOutput);

  if (!ownership) {
    return {
      analysis_needed: false,
      context_signal_level: "none",
      reasons: ["no_ownership_context"],
      metrics: currentMetrics,
    };
  }

  const sameInsider = readRecordArray(ownership.same_insider_12m_trades);
  const companyFlow = readRecord(ownership.company_90d_insider_flow);
  const cluster = readRecord(ownership.recent_30d_cluster);
  const related144 = readRecordArray(ownership.related_form144_candidates);
  const relatedForm4 = readRecordArray(ownership.related_form4_execution_candidates);
  const amendmentParent = readRecord(ownership.amendment_parent_candidate);

  const sameInsiderSellCount =
    sameInsider.reduce((sum, event) => sum + Math.max(0, numberValue(event.sell_transaction_count) ?? 0), 0) +
    currentMetrics.sell_transaction_count;
  const sameInsiderBuyCount =
    sameInsider.reduce((sum, event) => sum + Math.max(0, numberValue(event.buy_transaction_count) ?? 0), 0) +
    currentMetrics.buy_transaction_count;
  const sameInsiderSellValue =
    sameInsider.reduce((sum, event) => sum + Math.max(0, numberValue(event.sell_value) ?? 0), 0) +
    currentMetrics.sell_value;
  const sameInsiderBuyValue =
    sameInsider.reduce((sum, event) => sum + Math.max(0, numberValue(event.buy_value) ?? 0), 0) +
    currentMetrics.buy_value;
  const companySellInsiderCount = Math.max(0, numberValue(companyFlow?.sell_insider_count) ?? 0);
  const companyBuyInsiderCount = Math.max(0, numberValue(companyFlow?.buy_insider_count) ?? 0);
  const companySellValue = Math.max(0, numberValue(companyFlow?.total_sell_value) ?? 0);
  const companyBuyValue = Math.max(0, numberValue(companyFlow?.total_buy_value) ?? 0);
  const clusterInsiderCount = Math.max(0, numberValue(cluster?.insider_count) ?? 0);
  const clusterValue = Math.max(0, numberValue(cluster?.total_value) ?? 0);
  const ceoOrCfoIncluded = companyFlow?.ceo_included === true || companyFlow?.cfo_included === true || currentMetrics.ceo_or_cfo;

  const reasons: string[] = [];

  if (sameInsiderSellCount >= 3 && sameInsiderSellValue >= 500_000) {
    reasons.push("same_insider_repeated_sales_material_value");
  }
  if (sameInsiderSellValue >= 1_000_000) {
    reasons.push("same_insider_cumulative_sales_over_1m");
  }
  if (sameInsiderBuyCount >= 2 && sameInsiderBuyValue >= 250_000 && ceoOrCfoIncluded) {
    reasons.push("ceo_cfo_repeated_open_market_buy_context");
  }
  if (companySellInsiderCount >= 3 && companySellValue >= 1_000_000) {
    reasons.push("company_90d_multi_insider_material_selling");
  }
  if (companyBuyInsiderCount >= 3 && companyBuyValue >= 500_000 && ceoOrCfoIncluded) {
    reasons.push("company_90d_officer_buying_context");
  }
  if (clusterInsiderCount >= 2 && clusterValue >= 500_000) {
    reasons.push("recent_30d_material_cluster");
  }
  if ((related144.length > 0 || relatedForm4.length > 0) && currentMetrics.sell_value >= 250_000) {
    reasons.push("form144_form4_execution_candidate_material_value");
  }
  if (amendmentParent && !isClearlyAdministrativeOwnershipParent(amendmentParent)) {
    reasons.push("amendment_parent_candidate_requires_comparison");
  }

  const anyContext =
    sameInsider.length > 0 ||
    Boolean(companyFlow) ||
    Boolean(cluster) ||
    related144.length > 0 ||
    relatedForm4.length > 0 ||
    Boolean(amendmentParent);

  const contextSignalLevel = reasons.length > 0 ? "material" : anyContext ? "low" : "none";

  return {
    analysis_needed: reasons.length > 0,
    context_signal_level: contextSignalLevel,
    reasons: reasons.length ? reasons : [anyContext ? "context_present_below_material_threshold" : "no_prior_context"],
    metrics: {
      current: currentMetrics,
      same_insider_12m_trade_count: sameInsider.length,
      same_insider_sell_transaction_count: sameInsiderSellCount,
      same_insider_buy_transaction_count: sameInsiderBuyCount,
      same_insider_sell_value: sameInsiderSellValue || null,
      same_insider_buy_value: sameInsiderBuyValue || null,
      company_90d_sell_insider_count: companySellInsiderCount,
      company_90d_buy_insider_count: companyBuyInsiderCount,
      company_90d_sell_value: companySellValue || null,
      company_90d_buy_value: companyBuyValue || null,
      recent_30d_cluster_insider_count: clusterInsiderCount,
      recent_30d_cluster_value: clusterValue || null,
      related_form144_candidate_count: related144.length,
      related_form4_execution_candidate_count: relatedForm4.length,
      amendment_parent_candidate_present: Boolean(amendmentParent),
    },
  };
}

function attachOwnershipArchiveContextGuard(input: SecFilingAnalysisInput, guard: OwnershipArchiveContextGuard) {
  const filingPackage = readRecord(input.filing_package);
  const filingContext = readRecord(filingPackage?.filing_context);
  const ownership = readRecord(filingContext?.ownership);
  if (!ownership) return;

  ownership.archive_context_guard = guard;
}

function attachOwnershipArchiveContextGuardPreview(input: SecFilingAnalysisInput) {
  if (!isOwnershipFilingInput(input)) return null;

  const deterministicOwnership = buildDeterministicOwnershipAnalysis(input);
  if (!deterministicOwnership?.ok) return null;

  const guard = evaluateOwnershipArchiveContextGuard(input);
  attachOwnershipArchiveContextGuard(input, guard);
  return guard;
}

function readCurrentOwnershipContextMetrics(parserOutput: Record<string, unknown> | null) {
  const facts = readRecord(parserOutput?.facts) || {};
  const reportingOwner = readRecord(facts.reporting_owner) || {};
  const reportingOwners = readRecordArray(facts.reporting_owners);
  const ownerRoles = [
    ...readOwnershipOwnerRoles(reportingOwner),
    ...reportingOwners.flatMap(readOwnershipOwnerRoles),
  ].join(" ").toLowerCase();
  const form4 = readRecord(facts.form4);
  const form144 = readRecord(facts.form144);
  const transactions = [
    ...readRecordArray(form4?.transactions),
    ...readRecordArray(form4?.non_derivative_transactions),
    ...readRecordArray(form4?.derivative_transactions),
    ...readRecordArray(form144?.proposed_sale_rows),
  ];
  const rollup = rollupOwnershipTransactions(transactions);
  const form144Value = numberValue(form144?.aggregate_market_value) ?? 0;
  const form144Shares = numberValue(form144?.securities_to_be_sold) ?? 0;

  return {
    buy_transaction_count: rollup.buyCount,
    sell_transaction_count: rollup.sellCount,
    buy_value: rollup.buyValue || 0,
    sell_value: Math.max(rollup.sellValue || 0, form144Value),
    form144_value: form144Value || null,
    form144_shares: form144Shares || null,
    ceo_or_cfo: /\bchief executive officer\b|\bceo\b|\bchief financial officer\b|\bcfo\b/.test(ownerRoles),
  };
}

function isClearlyAdministrativeOwnershipParent(value: Record<string, unknown>) {
  const status = stringValue(value.status || value.match_status || value.comparison_status).toLowerCase();
  const kind = stringValue(value.kind || value.change_kind || value.amendment_kind).toLowerCase();
  const text = `${status} ${kind}`.trim();
  return /clearly_admin|administrative|metadata_only|footnote_only|no_material_change/.test(text);
}

type OwnershipCurrentIdentity = {
  companyCik: string;
  ticker: string;
  ownerCik: string;
  ownerName: string;
  accessionNumber: string;
  formType: string;
  filedAt: string;
};

type OwnershipContextEvent = {
  event_id: string | null;
  raw_item_id: string | null;
  accession_number: string | null;
  form_type: string | null;
  filed_at: string | null;
  source_url: string | null;
  ticker: string | null;
  company_cik: string | null;
  owner_ciks: string[];
  owner_names: string[];
  owner_roles: string[];
  event_type: string | null;
  score: number | null;
  delivery_level: string | null;
  signal: string | null;
  quick_take: string | null;
  summary: string | null;
  key_evidence: string[];
  direction: "buy" | "sell" | "mixed" | "other";
  buy_transaction_count: number;
  sell_transaction_count: number;
  buy_value: number | null;
  sell_value: number | null;
  actual_buy_shares: number | null;
  actual_sell_shares: number | null;
  proposed_sale_shares: number | null;
  proposed_sale_value: number | null;
  has_10b5_1: boolean;
  transaction_dates: string[];
  transaction_codes: string[];
  security_titles: string[];
  display_payload: Record<string, unknown> | null;
};

function readOwnershipParserOutputForContext(input: SecFilingAnalysisInput) {
  const filingPackage = readRecord(input.filing_package);
  const hardParsers = readRecord(filingPackage?.hard_parsers);
  return readRecord(hardParsers?.ownership);
}

function extractOwnershipCurrentIdentity(
  input: SecFilingAnalysisInput,
  parserOutput: Record<string, unknown>,
  rawItem: RawItemRow,
): OwnershipCurrentIdentity {
  const filingPackage = readRecord(input.filing_package);
  const facts = readRecord(parserOutput.facts) || {};
  const issuer = readRecord(facts.issuer) || {};
  const reportingOwner = readRecord(facts.reporting_owner) || {};
  const reportingOwners = readRecordArray(facts.reporting_owners);
  const primaryOwner = reportingOwners[0] || reportingOwner;
  const filing = readRecord(facts.filing) || {};
  const rawPayload = readRecord(rawItem.raw_payload) || {};
  const metadata = readRecord(rawItem.metadata) || {};
  const primaryTicker = readRecord(filingPackage?.primary_ticker) || {};

  return {
    companyCik:
      normalizeCik(stringValue(issuer.cik) || stringValue(rawPayload.cik) || stringValue(metadata.cik) || readRawCik(rawItem)),
    ticker: (
      stringValue(issuer.ticker) ||
      stringValue(primaryTicker.ticker) ||
      stringValue(rawPayload.ticker) ||
      readRawTicker(rawItem)
    ).toUpperCase(),
    ownerCik: normalizeCik(stringValue(primaryOwner.cik) || stringValue(reportingOwner.cik)),
    ownerName: normalizePersonName(stringValue(primaryOwner.name) || stringValue(reportingOwner.name)),
    accessionNumber:
      stringValue(parserOutput.accessionNumber) ||
      stringValue(filing.accession_number) ||
      readRawAccession(rawItem),
    formType: stringValue(filing.form_type) || readRawFormType(rawItem),
    filedAt: stringValue(rawItem.published_at) || stringValue(rawPayload.filing_date),
  };
}

async function fetchOwnershipContextEventCandidates(identity: OwnershipCurrentIdentity, rawItem: RawItemRow) {
  const select =
    "id,raw_item_id,source_url,published_at,ticker,event_type,score,delivery_level,signal,title,quick_take,summary,reason,metadata";
  const rows: RawItemRow[] = [];

  if (identity.companyCik) {
    const result = await supabaseSelect("events", {
      select,
      source_group: "eq.filings",
      source_code: "eq.sec_edgar",
      event_type: "eq.insider_ownership",
      "metadata->>cik": `eq.${identity.companyCik}`,
      order: "published_at.desc",
      limit: "200",
    });
    if (result.ok && Array.isArray(result.data)) rows.push(...(result.data as RawItemRow[]));
  }

  if (identity.ticker) {
    const result = await supabaseSelect("events", {
      select,
      source_group: "eq.filings",
      source_code: "eq.sec_edgar",
      event_type: "eq.insider_ownership",
      ticker: `eq.${identity.ticker}`,
      order: "published_at.desc",
      limit: "200",
    });
    if (result.ok && Array.isArray(result.data)) rows.push(...(result.data as RawItemRow[]));
  }

  if (!rows.length) {
    const rawTicker = readRawTicker(rawItem);
    if (rawTicker) {
      const result = await supabaseSelect("events", {
        select,
        source_group: "eq.filings",
        source_code: "eq.sec_edgar",
        event_type: "eq.insider_ownership",
        ticker: `eq.${rawTicker}`,
        order: "published_at.desc",
        limit: "200",
      });
      if (result.ok && Array.isArray(result.data)) rows.push(...(result.data as RawItemRow[]));
    }
  }

  return dedupeEventRows(rows);
}

async function fetchOwnershipContextAnalysisRows(eventIds: string[]) {
  const result = new Map<string, Record<string, unknown>>();
  const ids = uniqueStrings(eventIds).filter(Boolean).slice(0, 200);
  if (!ids.length) return result;

  const response = await supabaseSelect("event_analysis", {
    select: "event_id,key_evidence,what_to_watch_next,why_it_matters",
    event_id: `in.(${ids.join(",")})`,
    limit: String(ids.length),
  });
  if (!response.ok || !Array.isArray(response.data)) return result;

  for (const row of response.data) {
    const record = readRecord(row);
    const eventId = stringValue(record?.event_id);
    if (eventId && record) result.set(eventId, record);
  }
  return result;
}

function compactOwnershipContextEvent(
  event: RawItemRow,
  analysis: Record<string, unknown> | undefined,
): OwnershipContextEvent {
  const metadata = readRecord(event.metadata) || {};
  const displayPayload = readRecord(metadata.display_payload);
  const displayData = readRecord(displayPayload?.data) || {};
  const issuer = readRecord(displayData.issuer) || {};
  const filing = readRecord(displayData.filing) || {};
  const form4 = readRecord(displayData.form4);
  const form144 = readRecord(displayData.form144);
  const owners = [
    ...readRecordArray(displayData.reporting_owners),
    readRecord(displayData.reporting_owner),
  ].filter((owner): owner is Record<string, unknown> => Boolean(owner));
  const transactions = readOwnershipDisplayTransactions(form4, form144);
  const rollup = rollupOwnershipTransactions(transactions);
  const transactionDetails = summarizeOwnershipTransactionDetails(transactions);

  return {
    event_id: stringValue(event.id) || null,
    raw_item_id: stringValue(event.raw_item_id) || null,
    accession_number:
      stringValue(metadata.accession_number) ||
      stringValue(filing.accession_number) ||
      null,
    form_type: stringValue(metadata.form_type) || stringValue(filing.form_type) || null,
    filed_at: stringValue(event.published_at) || null,
    source_url: stringValue(event.source_url) || null,
    ticker: (stringValue(event.ticker) || stringValue(issuer.ticker)).toUpperCase() || null,
    company_cik: normalizeCik(stringValue(metadata.cik) || stringValue(issuer.cik)) || null,
    owner_ciks: uniqueStrings(owners.map((owner) => normalizeCik(stringValue(owner.cik))).filter(Boolean)),
    owner_names: uniqueStrings(owners.map((owner) => normalizePersonName(stringValue(owner.name))).filter(Boolean)),
    owner_roles: uniqueStrings(owners.flatMap(readOwnershipOwnerRoles).filter(Boolean)),
    event_type: stringValue(event.event_type) || null,
    score: numberValue(event.score),
    delivery_level: stringValue(event.delivery_level) || null,
    signal: stringValue(event.signal) || null,
    quick_take: stringValue(event.quick_take) || null,
    summary: stringValue(event.summary) || null,
    key_evidence: readStringArray(analysis?.key_evidence).slice(0, 4),
    direction: rollup.direction,
    buy_transaction_count: rollup.buyCount,
    sell_transaction_count: rollup.sellCount,
    buy_value: rollup.buyValue,
    sell_value: rollup.sellValue,
    actual_buy_shares: transactionDetails.actualBuyShares,
    actual_sell_shares: transactionDetails.actualSellShares,
    proposed_sale_shares: transactionDetails.proposedSaleShares,
    proposed_sale_value: transactionDetails.proposedSaleValue,
    has_10b5_1: ownershipDisplayHas10b51(displayData),
    transaction_dates: readOwnershipTransactionDates(transactions).slice(0, 6),
    transaction_codes: uniqueStrings(transactions.map((item) => stringValue(item.transaction_code)).filter(Boolean)).slice(0, 8),
    security_titles: uniqueStrings(transactions.map((item) => stringValue(item.security_title)).filter(Boolean)).slice(0, 6),
    display_payload: compactOwnershipDisplayPayload(displayPayload),
  };
}

function compactCurrentOwnershipContextEvent(
  identity: OwnershipCurrentIdentity,
  parserOutput: Record<string, unknown>,
  rawItem: RawItemRow,
): OwnershipContextEvent {
  const facts = readRecord(parserOutput.facts) || {};
  const issuer = readRecord(facts.issuer) || {};
  const reportingOwner = readRecord(facts.reporting_owner) || {};
  const reportingOwners = readRecordArray(facts.reporting_owners);
  const owners = [
    ...reportingOwners,
    reportingOwner,
  ].filter((owner): owner is Record<string, unknown> => Boolean(owner));
  const filing = readRecord(facts.filing) || {};
  const form4 = readRecord(facts.form4);
  const form144 = readRecord(facts.form144);
  const transactions = readOwnershipDisplayTransactions(form4, form144);
  const rollup = rollupOwnershipTransactions(transactions);
  const transactionDetails = summarizeOwnershipTransactionDetails(transactions);

  return {
    event_id: null,
    raw_item_id: stringValue(rawItem.id) || null,
    accession_number: identity.accessionNumber || null,
    form_type: identity.formType || stringValue(filing.form_type) || readRawFormType(rawItem) || null,
    filed_at: identity.filedAt || stringValue(rawItem.published_at) || null,
    source_url: stringValue(rawItem.source_url) || null,
    ticker: identity.ticker || stringValue(issuer.ticker).toUpperCase() || null,
    company_cik: identity.companyCik || normalizeCik(stringValue(issuer.cik)) || null,
    owner_ciks: uniqueStrings(owners.map((owner) => normalizeCik(stringValue(owner.cik))).filter(Boolean)),
    owner_names: uniqueStrings(owners.map((owner) => normalizePersonName(stringValue(owner.name))).filter(Boolean)),
    owner_roles: uniqueStrings(owners.flatMap(readOwnershipOwnerRoles).filter(Boolean)),
    event_type: "insider_ownership",
    score: null,
    delivery_level: null,
    signal: null,
    quick_take: null,
    summary: null,
    key_evidence: readRecordArray(readRecord(parserOutput.raw)?.selected_evidence)
      .map((item) => stringValue(item.value) || stringValue(item.label))
      .filter(Boolean)
      .slice(0, 4),
    direction: rollup.direction,
    buy_transaction_count: rollup.buyCount,
    sell_transaction_count: rollup.sellCount,
    buy_value: rollup.buyValue,
    sell_value: rollup.sellValue,
    actual_buy_shares: transactionDetails.actualBuyShares,
    actual_sell_shares: transactionDetails.actualSellShares,
    proposed_sale_shares: transactionDetails.proposedSaleShares,
    proposed_sale_value: transactionDetails.proposedSaleValue,
    has_10b5_1: ownershipDisplayHas10b51({
      filing,
      form4,
      form144,
      footnotes: readRecordArray(facts.footnotes),
      remarks: facts.remarks,
    }),
    transaction_dates: readOwnershipTransactionDates(transactions).slice(0, 6),
    transaction_codes: uniqueStrings(transactions.map((item) => stringValue(item.transaction_code)).filter(Boolean)).slice(0, 8),
    security_titles: uniqueStrings(transactions.map((item) => stringValue(item.security_title)).filter(Boolean)).slice(0, 6),
    display_payload: null,
  };
}

function readOwnershipDisplayTransactions(
  form4: Record<string, unknown> | null,
  form144: Record<string, unknown> | null,
) {
  return [
    ...readRecordArray(form4?.non_derivative_transactions),
    ...readRecordArray(form4?.derivative_transactions),
    ...readRecordArray(form144?.proposed_sale_rows),
  ];
}

function summarizeOwnershipTransactionDetails(transactions: Record<string, unknown>[]) {
  let actualBuyShares = 0;
  let actualSellShares = 0;
  let proposedSaleShares = 0;
  let proposedSaleValue = 0;

  for (const transaction of transactions) {
    const direction = classifyOwnershipTransactionDirection(transaction);
    const shares = ownershipTransactionShares(transaction);
    if (direction === "buy") actualBuyShares += shares;
    if (direction === "sell") actualSellShares += shares;

    const proposedShares = numberValue(transaction.securities_to_be_sold) ?? 0;
    const proposedValue = numberValue(transaction.aggregate_market_value) ?? 0;
    proposedSaleShares += proposedShares;
    proposedSaleValue += proposedValue;
  }

  return {
    actualBuyShares: actualBuyShares > 0 ? Number(actualBuyShares.toFixed(4)) : null,
    actualSellShares: actualSellShares > 0 ? Number(actualSellShares.toFixed(4)) : null,
    proposedSaleShares: proposedSaleShares > 0 ? Number(proposedSaleShares.toFixed(4)) : null,
    proposedSaleValue: proposedSaleValue > 0 ? Number(proposedSaleValue.toFixed(2)) : null,
  };
}

function ownershipTransactionShares(transaction: Record<string, unknown>) {
  return (
    numberValue(transaction.shares) ??
    numberValue(transaction.transaction_shares) ??
    numberValue(transaction.securities_to_be_sold) ??
    numberValue(transaction.amount_of_securities_sold) ??
    0
  );
}

function readOwnershipTransactionDates(transactions: Record<string, unknown>[]) {
  return uniqueStrings(
    transactions
      .flatMap((item) => [
        stringValue(item.transaction_date),
        stringValue(item.approximate_sale_date),
        stringValue(item.sale_date),
      ])
      .map(normalizeOwnershipContextDate)
      .filter(Boolean),
  );
}

function normalizeOwnershipContextDate(value: string) {
  const text = stringValue(value);
  if (!text) return "";
  const normalized = normalizeDateOnly(text);
  if (normalized) return normalized;
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return text;
  return new Date(parsed).toISOString().slice(0, 10);
}

function rollupOwnershipTransactions(transactions: Record<string, unknown>[]) {
  let buyCount = 0;
  let sellCount = 0;
  let buyValue = 0;
  let sellValue = 0;

  for (const transaction of transactions) {
    const direction = classifyOwnershipTransactionDirection(transaction);
    const value = numberValue(transaction.transaction_value) ?? numberValue(transaction.aggregate_market_value) ?? 0;
    if (direction === "buy") {
      buyCount += 1;
      buyValue += value;
    }
    if (direction === "sell") {
      sellCount += 1;
      sellValue += value;
    }
  }

  const direction: OwnershipContextEvent["direction"] =
    buyCount > 0 && sellCount > 0 ? "mixed" : sellCount > 0 ? "sell" : buyCount > 0 ? "buy" : "other";

  return {
    direction,
    buyCount,
    sellCount,
    buyValue: buyValue > 0 ? Number(buyValue.toFixed(2)) : null,
    sellValue: sellValue > 0 ? Number(sellValue.toFixed(2)) : null,
  };
}

function classifyOwnershipTransactionDirection(transaction: Record<string, unknown>) {
  const code = stringValue(transaction.transaction_code).toUpperCase();
  if (code === "P") return "buy";
  if (code === "S") return "sell";
  return "other";
}

function buildOwnershipCompanyFlow(events: OwnershipContextEvent[]) {
  if (!events.length) return null;

  const buyInsiders = new Set<string>();
  const sellInsiders = new Set<string>();
  let buyEvents = 0;
  let sellEvents = 0;
  let buyValue = 0;
  let sellValue = 0;
  let ceoIncluded = false;
  let cfoIncluded = false;
  let directorIncluded = false;

  for (const event of events) {
    const primaryName = event.owner_names[0] || event.owner_ciks[0] || event.event_id || "";
    if (event.direction === "buy" || event.direction === "mixed") {
      buyEvents += event.buy_transaction_count || 1;
      if (primaryName) buyInsiders.add(primaryName);
      buyValue += event.buy_value || 0;
    }
    if (event.direction === "sell" || event.direction === "mixed") {
      sellEvents += event.sell_transaction_count || 1;
      if (primaryName) sellInsiders.add(primaryName);
      sellValue += event.sell_value || 0;
    }
    const roles = event.owner_roles.join(" ").toLowerCase();
    ceoIncluded = ceoIncluded || /\bchief executive officer\b|\bceo\b/.test(roles);
    cfoIncluded = cfoIncluded || /\bchief financial officer\b|\bcfo\b/.test(roles);
    directorIncluded = directorIncluded || /\bdirector\b/.test(roles);
  }

  return {
    lookback_days: 90,
    event_count: events.length,
    buy_transaction_count: buyEvents,
    sell_transaction_count: sellEvents,
    total_buy_value: buyValue > 0 ? Number(buyValue.toFixed(2)) : null,
    total_sell_value: sellValue > 0 ? Number(sellValue.toFixed(2)) : null,
    buy_insider_count: buyInsiders.size,
    sell_insider_count: sellInsiders.size,
    ceo_included: ceoIncluded,
    cfo_included: cfoIncluded,
    director_included: directorIncluded,
    recent_events: events.slice(0, 12),
  };
}

function buildOwnershipRecentCluster(events: OwnershipContextEvent[]) {
  if (!events.length) return null;

  const buyEvents = events.filter((event) => event.direction === "buy" || event.direction === "mixed");
  const sellEvents = events.filter((event) => event.direction === "sell" || event.direction === "mixed");
  const buyInsiders = uniqueOwnershipInsiders(buyEvents);
  const sellInsiders = uniqueOwnershipInsiders(sellEvents);

  const direction =
    sellInsiders.length >= 2 && sellInsiders.length >= buyInsiders.length
      ? "sell"
      : buyInsiders.length >= 2
        ? "buy"
        : null;
  if (!direction) return null;

  const selected = direction === "sell" ? sellEvents : buyEvents;
  const selectedInsiders = direction === "sell" ? sellInsiders : buyInsiders;
  const totalValue = selected.reduce((sum, event) => sum + (direction === "sell" ? event.sell_value || 0 : event.buy_value || 0), 0);

  return {
    lookback_days: 30,
    direction,
    insider_count: selectedInsiders.length,
    event_count: selected.length,
    total_value: totalValue > 0 ? Number(totalValue.toFixed(2)) : null,
    insiders: selectedInsiders.slice(0, 12),
    events: selected.slice(0, 12),
  };
}

function buildRelatedForm144Candidates(
  identity: OwnershipCurrentIdentity,
  current: OwnershipContextEvent,
  events: OwnershipContextEvent[],
  currentDate: Date,
) {
  if (ownershipFormFamily(identity.formType) !== "4") return [];
  if (!(current.sell_transaction_count > 0 || current.direction === "sell" || current.direction === "mixed")) return [];

  return events
    .filter((event) => ownershipFormFamily(event.form_type) === "144")
    .filter((event) => sameOwnershipInsider(identity, event))
    .filter((event) => isWithinDays(event.filed_at, currentDate, 180))
    .map((event) => scoreOwnershipRelationCandidate("related_form144_candidate", current, event))
    .filter((candidate) => candidate.match_score >= 95)
    .sort((left, right) => right.match_score - left.match_score)
    .slice(0, 5);
}

function buildRelatedForm4ExecutionCandidates(
  identity: OwnershipCurrentIdentity,
  current: OwnershipContextEvent,
  events: OwnershipContextEvent[],
  currentDate: Date,
) {
  if (ownershipFormFamily(identity.formType) !== "144") return [];

  return events
    .filter((event) => ownershipFormFamily(event.form_type) === "4")
    .filter((event) => sameOwnershipInsider(identity, event))
    .filter((event) => event.sell_transaction_count > 0 || event.direction === "sell" || event.direction === "mixed")
    .filter((event) => isNearOwnershipContextWindow(event, currentDate, 30, 120))
    .map((event) => scoreOwnershipRelationCandidate("related_form4_execution_candidate", current, event))
    .filter((candidate) => candidate.match_score >= 95)
    .sort((left, right) => right.match_score - left.match_score)
    .slice(0, 5);
}

function buildOwnershipAmendmentParentCandidate(
  identity: OwnershipCurrentIdentity,
  current: OwnershipContextEvent,
  events: OwnershipContextEvent[],
  currentDate: Date,
) {
  if (!isOwnershipAmendmentFormForContext(identity.formType)) return null;
  const currentFamily = ownershipFormFamily(identity.formType);
  if (!currentFamily) return null;

  const scored = events
    .filter((event) => ownershipFormFamily(event.form_type) === currentFamily)
    .filter((event) => sameOwnershipInsider(identity, event))
    .filter((event) => isBeforeOrSameOwnershipContextDate(event.filed_at, currentDate))
    .map((event) => scoreOwnershipParentCandidate(current, event))
    .filter((candidate) => candidate.match_score >= 110)
    .sort((left, right) => {
      if (right.match_score !== left.match_score) return right.match_score - left.match_score;
      return Date.parse(stringValue(right.filed_at)) - Date.parse(stringValue(left.filed_at));
    });

  const best = scored[0];
  if (!best) return null;

  return {
    ...best,
    status: scored.length > 1 && scored[1].match_score >= best.match_score - 10 ? "multiple_candidates" : "found",
    candidate_count: scored.length,
    candidates: scored.slice(0, 5),
  };
}

function buildOwnershipPackageParentCandidate(input: SecFilingAnalysisInput) {
  const filingPackage = readRecord(input.filing_package);
  const parentContext = readRecord(filingPackage?.parent_filing_context);
  const parent = readRecord(parentContext?.parent);
  if (!parent) return null;
  const matchMethod = stringValue(parentContext?.match_method) || "parent_filing_context";
  const parentFormType = stringValue(parent.form_type) || null;
  if (parentFormType && isOwnershipAmendmentFormForContext(parentFormType) && matchMethod !== "explicit_parent_accession") {
    return null;
  }

  return {
    status: stringValue(parentContext?.status) || "found",
    match_kind: "amendment_parent_candidate",
    match_method: matchMethod,
    match_score: numberValue(parentContext?.match_score) ?? null,
    match_reasons: readStringArray(parentContext?.match_reasons),
    confidence: stringValue(parentContext?.confidence) || null,
    source: stringValue(parentContext?.source) || "raw_items_events_compact",
    context_kind: stringValue(parentContext?.context_kind) || "amendment_parent_filing",
    event_id: stringValue(parent.event_id) || null,
    raw_item_id: stringValue(parent.raw_item_id) || null,
    accession_number: stringValue(parent.accession_number) || null,
    form_type: parentFormType,
    filed_at: stringValue(parent.filed_at) || null,
    source_url: stringValue(parent.source_url) || null,
    ticker: stringValue(parent.ticker).toUpperCase() || null,
    company_name: stringValue(parent.company_name) || null,
    cik: normalizeCik(stringValue(parent.cik)) || null,
    event_type: stringValue(parent.event_type) || null,
    score: numberValue(parent.score),
    delivery_level: stringValue(parent.delivery_level) || null,
    signal: stringValue(parent.signal) || null,
    event_title: stringValue(parent.event_title) || null,
    quick_take: stringValue(parent.quick_take) || null,
    summary: stringValue(parent.summary) || null,
    key_evidence: readStringArray(parent.key_evidence).slice(0, 4),
    what_to_watch_next: readStringArray(parent.what_to_watch_next).slice(0, 4),
    display_payload: compactOwnershipDisplayPayload(readRecord(parent.display_payload)),
    source_availability_note:
      stringValue(parent.source_availability_note) || "Parent context excludes full raw filing text.",
  };
}

function scoreOwnershipRelationCandidate(kind: string, current: OwnershipContextEvent, candidate: OwnershipContextEvent) {
  const matchReasons: string[] = [kind, "same_company", "same_reporting_owner"];
  let score = 90;

  const dateDistance = minOwnershipDateDistanceDays(current.transaction_dates, candidate.transaction_dates);
  if (dateDistance !== null && dateDistance <= 7) {
    score += 35;
    matchReasons.push("transaction_or_proposed_sale_date_within_7d");
  } else if (dateDistance !== null && dateDistance <= 30) {
    score += 20;
    matchReasons.push("transaction_or_proposed_sale_date_within_30d");
  }

  if (ownershipSecurityTitleOverlap(current, candidate)) {
    score += 20;
    matchReasons.push("same_security_title");
  }

  if (ownershipSharesClose(current.proposed_sale_shares, candidate.actual_sell_shares)) {
    score += 45;
    matchReasons.push("proposed_and_actual_shares_close");
  } else if (ownershipSharesClose(current.actual_sell_shares, candidate.proposed_sale_shares)) {
    score += 45;
    matchReasons.push("actual_and_proposed_shares_close");
  }

  const currentValue = current.proposed_sale_value || current.sell_value;
  const candidateValue = candidate.proposed_sale_value || candidate.sell_value;
  if (ownershipValuesClose(currentValue, candidateValue)) {
    score += 20;
    matchReasons.push("value_close");
  }

  return {
    ...compactOwnershipContextCandidate(candidate),
    match_kind: kind,
    match_score: score,
    match_reasons: matchReasons,
  };
}

function scoreOwnershipParentCandidate(current: OwnershipContextEvent, candidate: OwnershipContextEvent) {
  const matchReasons: string[] = ["ownership_amendment_parent_candidate", "same_company", "same_reporting_owner"];
  let score = 90;

  if (!isOwnershipAmendmentFormForContext(candidate.form_type || "")) {
    score += 35;
    matchReasons.push("non_amendment_parent_preferred");
  }

  if (ownershipDateOverlap(current.transaction_dates, candidate.transaction_dates)) {
    score += 35;
    matchReasons.push("same_transaction_or_sale_date");
  }

  if (ownershipSecurityTitleOverlap(current, candidate)) {
    score += 25;
    matchReasons.push("same_security_title");
  }

  if (ownershipCodeOverlap(current, candidate)) {
    score += 25;
    matchReasons.push("same_transaction_code");
  }

  if (
    ownershipSharesClose(current.actual_sell_shares, candidate.actual_sell_shares) ||
    ownershipSharesClose(current.actual_buy_shares, candidate.actual_buy_shares) ||
    ownershipSharesClose(current.proposed_sale_shares, candidate.proposed_sale_shares)
  ) {
    score += 35;
    matchReasons.push("share_amount_close");
  }

  if (
    ownershipValuesClose(current.sell_value, candidate.sell_value) ||
    ownershipValuesClose(current.buy_value, candidate.buy_value) ||
    ownershipValuesClose(current.proposed_sale_value, candidate.proposed_sale_value)
  ) {
    score += 20;
    matchReasons.push("value_close");
  }

  return {
    ...compactOwnershipContextCandidate(candidate),
    match_kind: "amendment_parent_candidate",
    match_score: score,
    match_reasons: matchReasons,
  };
}

function compactOwnershipContextCandidate(event: OwnershipContextEvent) {
  return {
    event_id: event.event_id,
    raw_item_id: event.raw_item_id,
    accession_number: event.accession_number,
    form_type: event.form_type,
    filed_at: event.filed_at,
    source_url: event.source_url,
    ticker: event.ticker,
    owner_names: event.owner_names,
    owner_ciks: event.owner_ciks,
    direction: event.direction,
    buy_transaction_count: event.buy_transaction_count,
    sell_transaction_count: event.sell_transaction_count,
    buy_value: event.buy_value,
    sell_value: event.sell_value,
    actual_buy_shares: event.actual_buy_shares,
    actual_sell_shares: event.actual_sell_shares,
    proposed_sale_shares: event.proposed_sale_shares,
    proposed_sale_value: event.proposed_sale_value,
    transaction_dates: event.transaction_dates,
    transaction_codes: event.transaction_codes,
    security_titles: event.security_titles,
    score: event.score,
    delivery_level: event.delivery_level,
    summary: event.summary,
    key_evidence: event.key_evidence,
    display_payload: event.display_payload,
  };
}

function ownershipFormFamily(formType: string | null) {
  const form = normalizeSecFormForParentContext(formType || "");
  if (form === "4" || form === "4/A") return "4";
  if (form === "144" || form === "144/A") return "144";
  return "";
}

function isOwnershipAmendmentFormForContext(formType: string) {
  const form = normalizeSecFormForParentContext(formType);
  return form === "4/A" || form === "144/A";
}

function isNearOwnershipContextWindow(event: OwnershipContextEvent, currentDate: Date, daysBefore: number, daysAfter: number) {
  const date = parseContextDate(event.filed_at || "");
  if (!date) return false;
  const diffDays = (date.getTime() - currentDate.getTime()) / (24 * 60 * 60 * 1000);
  return diffDays >= -daysBefore && diffDays <= daysAfter;
}

function isBeforeOrSameOwnershipContextDate(value: string | null, currentDate: Date) {
  const date = parseContextDate(value || "");
  return Boolean(date && date.getTime() <= currentDate.getTime());
}

function ownershipDateOverlap(left: string[], right: string[]) {
  const rightSet = new Set(right.filter(Boolean));
  return left.some((date) => rightSet.has(date));
}

function minOwnershipDateDistanceDays(left: string[], right: string[]) {
  let best: number | null = null;
  for (const leftDate of left) {
    const leftParsed = Date.parse(leftDate);
    if (!Number.isFinite(leftParsed)) continue;
    for (const rightDate of right) {
      const rightParsed = Date.parse(rightDate);
      if (!Number.isFinite(rightParsed)) continue;
      const diff = Math.abs(leftParsed - rightParsed) / (24 * 60 * 60 * 1000);
      best = best === null ? diff : Math.min(best, diff);
    }
  }
  return best;
}

function ownershipSecurityTitleOverlap(left: OwnershipContextEvent, right: OwnershipContextEvent) {
  const rightTitles = new Set(right.security_titles.map(normalizeOwnershipComparableText).filter(Boolean));
  return left.security_titles.map(normalizeOwnershipComparableText).some((title) => title && rightTitles.has(title));
}

function ownershipCodeOverlap(left: OwnershipContextEvent, right: OwnershipContextEvent) {
  const rightCodes = new Set(right.transaction_codes.map((code) => code.toUpperCase()).filter(Boolean));
  return left.transaction_codes.map((code) => code.toUpperCase()).some((code) => code && rightCodes.has(code));
}

function ownershipSharesClose(left: number | null, right: number | null) {
  if (!left || !right) return false;
  const min = Math.min(Math.abs(left), Math.abs(right));
  const max = Math.max(Math.abs(left), Math.abs(right));
  return max > 0 && min / max >= 0.75;
}

function ownershipValuesClose(left: number | null, right: number | null) {
  if (!left || !right) return false;
  const min = Math.min(Math.abs(left), Math.abs(right));
  const max = Math.max(Math.abs(left), Math.abs(right));
  return max > 0 && min / max >= 0.7;
}

function normalizeOwnershipComparableText(value: string) {
  return stringValue(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function uniqueOwnershipInsiders(events: OwnershipContextEvent[]) {
  return uniqueStrings(events.map((event) => event.owner_names[0] || event.owner_ciks[0]).filter(Boolean));
}

function sameOwnershipCompany(identity: OwnershipCurrentIdentity, event: OwnershipContextEvent) {
  if (identity.companyCik && event.company_cik) return identity.companyCik === event.company_cik;
  if (identity.ticker && event.ticker) return identity.ticker === event.ticker;
  return false;
}

function sameOwnershipInsider(identity: OwnershipCurrentIdentity, event: OwnershipContextEvent) {
  if (identity.ownerCik && event.owner_ciks.includes(identity.ownerCik)) return true;
  return Boolean(identity.ownerName && event.owner_names.some((name) => ownershipOwnerNamesLikelyMatch(identity.ownerName, name)));
}

function isWithinDays(value: string | null, currentDate: Date, days: number) {
  const date = parseContextDate(value || "");
  if (!date) return false;
  const diff = currentDate.getTime() - date.getTime();
  return diff >= 0 && diff <= days * 24 * 60 * 60 * 1000;
}

function parseContextDate(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}

function compactOwnershipDisplayPayload(value: Record<string, unknown> | null) {
  if (!value) return null;
  const data = readRecord(value.data) || {};
  return {
    display_type: stringValue(value.display_type) || null,
    data: {
      issuer: data.issuer || null,
      reporting_owner: data.reporting_owner || null,
      filing: data.filing || null,
      form4: data.form4 || null,
      form144: data.form144 || null,
      amendment: data.amendment || null,
    },
    evidence: readStringArray(value.evidence).slice(0, 4),
  };
}

function ownershipDisplayHas10b51(displayData: Record<string, unknown>) {
  const text = JSON.stringify({
    filing: displayData.filing,
    form4: displayData.form4,
    form144: displayData.form144,
    footnotes: displayData.footnotes,
    remarks: displayData.remarks,
  }).toLowerCase();
  return text.includes("10b5-1") || text.includes("10b5 one");
}

function readOwnershipOwnerRoles(owner: Record<string, unknown> | null) {
  if (!owner) return [];
  const roles = [
    owner.title,
    owner.officer_title,
    owner.relationship,
    owner.owner_relationship,
    owner.is_director === true ? "director" : "",
    owner.is_officer === true ? "officer" : "",
    owner.is_ten_percent_owner === true ? "10% owner" : "",
  ];
  return roles.map(stringValue).filter(Boolean);
}

function normalizeCik(value: string) {
  const digits = stringValue(value).replace(/\D/g, "");
  return digits ? digits.replace(/^0+/, "") || "0" : "";
}

function normalizePersonName(value: string) {
  return stringValue(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function ownershipOwnerNamesLikelyMatch(left: string, right: string) {
  const leftName = normalizePersonName(left);
  const rightName = normalizePersonName(right);
  if (!leftName || !rightName) return false;
  if (leftName === rightName || leftName.includes(rightName) || rightName.includes(leftName)) return true;

  const leftTokens = ownershipOwnerNameTokens(leftName);
  const rightTokens = ownershipOwnerNameTokens(rightName);
  if (leftTokens.length < 2 || rightTokens.length < 2) return false;

  const leftSet = new Set(leftTokens);
  const overlap = rightTokens.filter((token) => leftSet.has(token));
  if (overlap.length >= Math.min(2, leftTokens.length, rightTokens.length)) return true;

  const leftLast = leftTokens[leftTokens.length - 1];
  const rightLast = rightTokens[rightTokens.length - 1];
  const leftFirst = leftTokens[0];
  const rightFirst = rightTokens[0];
  return Boolean(leftFirst && leftLast && leftFirst === rightLast && leftLast === rightFirst);
}

function ownershipOwnerNameTokens(value: string) {
  return normalizePersonName(value)
    .split(" ")
    .filter((token) => token.length > 1)
    .filter((token) => !OWNERSHIP_NAME_STOP_WORDS.has(token));
}

const OWNERSHIP_NAME_STOP_WORDS = new Set([
  "the",
  "inc",
  "corp",
  "corporation",
  "company",
  "co",
  "llc",
  "ltd",
  "limited",
  "lp",
  "trust",
  "trustee",
  "as",
  "cik",
]);

function dedupeEventRows(rows: RawItemRow[]) {
  const seen = new Set<string>();
  const result: RawItemRow[] = [];
  for (const row of rows) {
    const key = stringValue(row.id) || `${stringValue(row.raw_item_id)}:${stringValue(row.published_at)}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }
  return result;
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = stringValue(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

async function attachParentRegistrationContext(input: SecFilingAnalysisInput, rawItem: RawItemRow) {
  const filingPackage = readRecord(input.filing_package);
  const hardParsers = readRecord(filingPackage?.hard_parsers);
  const s3 = readRecord(hardParsers?.s3);
  const amendment = readRecord(s3?.amendment);
  const amendmentFormType = stringValue(amendment?.form_type) || stringValue(filingPackage?.form_type);
  const amendmentNumber = numberValue(amendment?.amendment_number) || 0;
  const isAmendment =
    isS3F3RegistrationAmendmentForm(amendmentFormType) ||
    amendmentNumber > 0 ||
    amendment?.is_amendment === true ||
    amendment?.isAmendment === true;
  if (!filingPackage || !s3 || !amendment || !isAmendment) return;

  const registrationNumber =
    stringValue(readRecord(amendment.registration_number)?.value) || stringValue(amendment.registration_number);
  if (!registrationNumber) {
    filingPackage.parent_registration_context = buildMissingParentS3Context("missing_registration_number");
    return;
  }

  const parentContext = await findParentS3RegistrationContext({
    currentAccession: stringValue(filingPackage.accession_number) || stringValue(rawItem.source_unique_id),
    rawItem,
    registrationNumber,
  });

  filingPackage.parent_registration_context = parentContext;
}

async function attachCurrentReportParentFilingContext(input: SecFilingAnalysisInput, rawItem: RawItemRow) {
  if (!isSec8k6kFilingInput(input)) return;

  const filingPackage = readRecord(input.filing_package);
  if (!filingPackage) return;
  const existingParentContext = readRecord(filingPackage.parent_filing_context);
  if (stringValue(existingParentContext?.context_kind) === "current_report_parent_filing") return;

  const parserOutput = readCurrentReportParserOutput(input);
  const facts = readRecord(parserOutput?.facts);
  const amendment = readRecord(facts?.amendment);
  if (!parserOutput || amendment?.isAmendment !== true) return;

  const parentContext = await findCurrentReportParentFilingContext({
    amendment,
    parserOutput,
    rawItem,
  });
  if (!parentContext) return;

  // Preserve the matched prior analysis; raw historical blocks are reserved for warning repair.
  filingPackage.parent_filing_context = parentContext;
}

async function attachTenderParentFilingContext(input: SecFilingAnalysisInput, rawItem: RawItemRow) {
  if (!isTenderFilingInput(input)) return;

  const filingPackage = readRecord(input.filing_package);
  if (!filingPackage || readRecord(filingPackage.parent_filing_context)) return;

  const formType = stringValue(filingPackage.form_type) || readRawFormType(rawItem);
  if (!isSecAmendmentFormForParentContext(formType)) return;

  const parentContext = await findTenderAmendmentParentFilingContext({
    input,
    rawItem,
    formType,
  });
  if (!parentContext) return;

  filingPackage.parent_filing_context = parentContext;
}

async function attachGenericAmendmentParentFilingContext(input: SecFilingAnalysisInput, rawItem: RawItemRow) {
  const filingPackage = readRecord(input.filing_package);
  if (!filingPackage || readRecord(filingPackage.parent_filing_context)) return;

  const formType = stringValue(filingPackage.form_type) || readRawFormType(rawItem);
  if (!isSecAmendmentFormForParentContext(formType)) return;
  if (isS3F3RegistrationAmendmentForm(formType)) return;

  filingPackage.parent_filing_context = await findGenericAmendmentParentFilingContext({
    input,
    rawItem,
    formType,
  });
}

async function findTenderAmendmentParentFilingContext({
  input,
  rawItem,
  formType,
}: {
  input: SecFilingAnalysisInput;
  rawItem: RawItemRow;
  formType: string;
}) {
  const currentFamily = normalizeGenericParentFormFamily(formType);
  if (!isTenderParentContextFamily(currentFamily)) return null;

  const currentAccession = readRawAccession(rawItem);
  const explicitParentAccession = extractExplicitParentAccessionForAmendment(input, rawItem);
  if (explicitParentAccession) {
    const row = await fetchSecRawItemByAccession(explicitParentAccession);
    if (row && readRawAccession(row) !== currentAccession) {
      return buildGenericAmendmentParentContext({
        status: "found",
        confidence: "high",
        matchMethod: "explicit_parent_accession",
        matchScore: 1000,
        matchReasons: ["explicit_parent_accession"],
        rawItem,
        parentRow: row,
        candidateRows: [row],
      });
    }
  }

  const candidateRows = await fetchTenderParentCandidateRows(input, rawItem);
  const currentFiledAt = Date.parse(stringValue(rawItem.published_at));
  const currentTicker = readRawTicker(rawItem);
  const currentCik = normalizeCik(readRawCik(rawItem));

  const scored = candidateRows
    .filter((row) => readRawAccession(row) !== currentAccession)
    .map((row) => {
      const rowFamily = normalizeGenericParentFormFamily(readRawFormType(row));
      if (!isTenderParentContextFamily(rowFamily)) return null;

      const rowFiledAt = Date.parse(stringValue(row.published_at));
      if (Number.isFinite(currentFiledAt) && Number.isFinite(rowFiledAt) && rowFiledAt >= currentFiledAt) return null;

      const rowAgeDays =
        Number.isFinite(currentFiledAt) && Number.isFinite(rowFiledAt)
          ? Math.max(0, Math.round((currentFiledAt - rowFiledAt) / (24 * 60 * 60 * 1000)))
          : null;
      if (rowAgeDays !== null && rowAgeDays > 1095) return null;

      const rowTicker = readRawTicker(row);
      const rowCik = normalizeCik(readRawCik(row));
      const matchReasons: string[] = [];
      let score = 0;

      if (rowFamily === currentFamily) {
        score += 100;
        matchReasons.push("same_tender_form_family");
      } else if (isTenderParentContextFamily(rowFamily)) {
        score += 45;
        matchReasons.push("same_tender_context_family");
      }
      if (currentCik && rowCik && currentCik === rowCik) {
        score += 90;
        matchReasons.push("same_cik");
      }
      if (currentTicker && rowTicker && currentTicker === rowTicker) {
        score += 45;
        matchReasons.push("same_ticker");
      }
      if (!isSecAmendmentFormForParentContext(readRawFormType(row))) {
        score += 40;
        matchReasons.push("non_amendment_parent_preferred");
      } else {
        score += 10;
        matchReasons.push("prior_amendment_candidate");
      }
      if (rowAgeDays !== null) {
        if (rowAgeDays <= 30) score += 35;
        else if (rowAgeDays <= 180) score += 20;
        else if (rowAgeDays <= 365) score += 10;
        matchReasons.push(`filed_${rowAgeDays}_days_before`);
      }

      return {
        row,
        score,
        matchReasons,
        matchMethod: "tender_same_issuer_form_family_recent",
      };
    })
    .filter((item): item is { row: RawItemRow; score: number; matchReasons: string[]; matchMethod: string } => Boolean(item))
    .filter((item) => item.score >= 120)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return Date.parse(stringValue(right.row.published_at)) - Date.parse(stringValue(left.row.published_at));
    });

  const best = scored[0];
  if (!best) {
    return buildGenericAmendmentParentContext({
      status: "not_found",
      confidence: "low",
      matchMethod: "tender_same_issuer_form_family_recent",
      matchScore: 0,
      matchReasons: ["no_prior_tender_parent_candidate_found"],
      rawItem,
      parentRow: null,
      candidateRows: [],
    });
  }

  const second = scored[1];
  const ambiguous = second && best.score - second.score < 20;
  return buildGenericAmendmentParentContext({
    status: ambiguous ? "multiple_candidates" : "found",
    confidence: ambiguous ? "medium" : best.score >= 200 ? "high" : "medium",
    matchMethod: best.matchMethod,
    matchScore: best.score,
    matchReasons: best.matchReasons,
    rawItem,
    parentRow: ambiguous ? null : best.row,
    candidateRows: scored.slice(0, 5).map((item) => item.row),
  });
}

async function findGenericAmendmentParentFilingContext({
  input,
  rawItem,
  formType,
}: {
  input: SecFilingAnalysisInput;
  rawItem: RawItemRow;
  formType: string;
}) {
  const currentAccession = readRawAccession(rawItem);
  const currentFiledAt = Date.parse(stringValue(rawItem.published_at));
  const explicitParentAccession = extractExplicitParentAccessionForAmendment(input, rawItem);
  const currentFamily = normalizeGenericParentFormFamily(formType);
  const currentTicker = readRawTicker(rawItem);
  const currentCik = normalizeCik(readRawCik(rawItem));
  const currentSc13Facts = isSc13ParentContextFamily(currentFamily) ? readSc13ParentMatchFactsFromInput(input) : null;

  if (currentFamily === "S-8") {
    const s8RegistrationParent = await findS8RegistrationParentFilingContext({
      input,
      rawItem,
      formType,
    });
    if (s8RegistrationParent) return s8RegistrationParent;
  }

  if (explicitParentAccession) {
    const row = await fetchSecRawItemByAccession(explicitParentAccession);
    if (row && readRawAccession(row) !== currentAccession) {
      return buildGenericAmendmentParentContext({
        status: "found",
        confidence: "high",
        matchMethod: "explicit_parent_accession",
        matchScore: 1000,
        matchReasons: ["explicit_parent_accession"],
        rawItem,
        parentRow: row,
        candidateRows: [row],
      });
    }
  }

  const candidateRows = dedupeRawRows([
    ...(await fetchGenericAmendmentParentCandidateRows(rawItem)),
    ...(currentSc13Facts ? await fetchSc13ParentCandidateRows(currentSc13Facts) : []),
  ]);
  const scored = candidateRows
    .filter((row) => readRawAccession(row) !== currentAccession)
    .map((row) => {
      const rowFiledAt = Date.parse(stringValue(row.published_at));
      if (Number.isFinite(currentFiledAt) && Number.isFinite(rowFiledAt) && rowFiledAt >= currentFiledAt) return null;

      const rowAgeDays =
        Number.isFinite(currentFiledAt) && Number.isFinite(rowFiledAt)
          ? Math.max(0, Math.round((currentFiledAt - rowFiledAt) / (24 * 60 * 60 * 1000)))
          : null;
      if (rowAgeDays !== null && rowAgeDays > 1095) return null;

      const rowFamily = normalizeGenericParentFormFamily(readRawFormType(row));
      const rowTicker = readRawTicker(row);
      const rowCik = normalizeCik(readRawCik(row));
      const matchReasons: string[] = [];
      let score = 0;

      if (currentSc13Facts) {
        if (!isSc13ParentContextFamily(rowFamily)) return null;
        if (rowFamily !== currentFamily) return null;
      }

      if (currentFamily && rowFamily && currentFamily === rowFamily) {
        score += 80;
        matchReasons.push("same_form_family");
      }
      if (currentCik && rowCik && currentCik === rowCik) {
        score += 80;
        matchReasons.push("same_cik");
      }
      if (currentTicker && rowTicker && currentTicker === rowTicker) {
        score += 40;
        matchReasons.push("same_ticker");
      }
      if (currentSc13Facts) {
        const rowSc13Facts = readSc13ParentMatchFactsFromRawRow(row);
        if (!rowSc13Facts) return null;

        if (currentSc13Facts.cusip && rowSc13Facts.cusip) {
          if (currentSc13Facts.cusip !== rowSc13Facts.cusip) return null;
          score += 50;
          matchReasons.push("same_cusip");
        }

        const sharedReporters = intersectStrings(currentSc13Facts.reportingPersons, rowSc13Facts.reportingPersons);
        if (currentSc13Facts.reportingPersons.length && rowSc13Facts.reportingPersons.length) {
          if (!sharedReporters.length) return null;
          score += 90 + Math.min(30, sharedReporters.length * 10);
          matchReasons.push("same_reporting_person");
        }

        if (
          currentSc13Facts.securityClass &&
          rowSc13Facts.securityClass &&
          normalizeComparableName(currentSc13Facts.securityClass) === normalizeComparableName(rowSc13Facts.securityClass)
        ) {
          score += 20;
          matchReasons.push("same_security_class");
        }

        if (currentSc13Facts.scheduleType && rowSc13Facts.scheduleType && currentSc13Facts.scheduleType === rowSc13Facts.scheduleType) {
          score += 30;
          matchReasons.push("same_schedule_type");
        }
      }
      if (!isSecAmendmentFormForParentContext(readRawFormType(row))) {
        score += 25;
        matchReasons.push("non_amendment_parent_preferred");
      } else {
        matchReasons.push("prior_amendment_candidate");
      }
      if (rowAgeDays !== null) {
        if (rowAgeDays <= 30) score += 35;
        else if (rowAgeDays <= 180) score += 20;
        else if (rowAgeDays <= 365) score += 10;
        matchReasons.push(`filed_${rowAgeDays}_days_before`);
      }
      if (stringValue(row.raw_item_id) || stringValue(row.id)) {
        score += 5;
      }

      return {
        row,
        score,
        matchReasons,
        matchMethod: currentSc13Facts ? "sc13_same_issuer_reporter_security_recent" : "same_issuer_form_family_recent",
      };
    })
    .filter((item): item is { row: RawItemRow; score: number; matchReasons: string[]; matchMethod: string } => Boolean(item))
    .filter((item) => item.score >= 100)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return Date.parse(stringValue(right.row.published_at)) - Date.parse(stringValue(left.row.published_at));
    });

  const best = scored[0];
  if (!best) {
    return buildGenericAmendmentParentContext({
      status: "not_found",
      confidence: "low",
      matchMethod: "none",
      matchScore: 0,
      matchReasons: ["no_prior_parent_candidate_found"],
      rawItem,
      parentRow: null,
      candidateRows: [],
    });
  }

  const second = scored[1];
  const ambiguous = second && best.score - second.score < 20;

  return buildGenericAmendmentParentContext({
    status: ambiguous ? "multiple_candidates" : "found",
    confidence: ambiguous ? "medium" : best.score >= 180 ? "high" : "medium",
    matchMethod: best.matchMethod,
    matchScore: best.score,
    matchReasons: best.matchReasons,
    rawItem,
    parentRow: ambiguous ? null : best.row,
    candidateRows: scored.slice(0, 5).map((item) => item.row),
  });
}

type Sc13ParentMatchFacts = {
  scheduleType: string;
  reportingPersons: string[];
  cusip: string;
  securityClass: string;
};

function isSc13ParentContextFamily(value: string) {
  return value === "SC 13D" || value === "SC 13G";
}

function isTenderParentContextFamily(value: string) {
  return (
    value === "SC TO-C" ||
    value === "SC TO-I" ||
    value === "SC TO-T" ||
    value === "SC 13E3" ||
    value === "CB" ||
    value === "SC 14D9"
  );
}

function readSc13ParentMatchFactsFromInput(input: SecFilingAnalysisInput): Sc13ParentMatchFacts | null {
  const filingPackage = readRecord(input.filing_package);
  const hardParsers = readRecord(filingPackage?.hard_parsers);
  const parserOutput = readRecord(hardParsers?.sc13) as unknown as Sc13ParserOutput | null;
  return sc13ParentMatchFactsFromParserOutput(parserOutput);
}

function readSc13ParentMatchFactsFromRawRow(row: RawItemRow): Sc13ParentMatchFacts | null {
  try {
    return sc13ParentMatchFactsFromParserOutput(parseSc13Filing(rawRowToSc13ParseInput(row)));
  } catch {
    return null;
  }
}

function sc13ParentMatchFactsFromParserOutput(parserOutput: Sc13ParserOutput | null): Sc13ParentMatchFacts | null {
  const facts = readRecord(parserOutput?.facts);
  if (!facts) return null;
  const scheduleType = stringValue(facts.scheduleType);
  const reportingPersons = uniqueStrings(
    readStringArray(facts.reportingPersons).map(normalizeComparableName).filter(Boolean),
  );
  return {
    scheduleType,
    reportingPersons,
    cusip: stringValue(facts.cusip).toUpperCase(),
    securityClass: normalizeComparableName(stringValue(facts.securityClass)),
  };
}

function rawRowToSc13ParseInput(row: RawItemRow) {
  const rawPayload = readRecord(row.raw_payload) || {};
  const metadata = readRecord(row.metadata) || {};
  const attachmentTexts = readRecordArray(rawPayload.attachment_texts)
    .map((attachment) => ({
      type: stringValue(attachment.type) || null,
      description: stringValue(attachment.description) || null,
      url: stringValue(attachment.url) || null,
      text: stringValue(attachment.text),
    }))
    .filter((attachment) => attachment.text);

  return {
    formType: readRawFormType(row),
    accessionNumber: readRawAccession(row) || null,
    issuerName: readRawCompanyName(row) || null,
    companyName: readRawCompanyName(row) || null,
    primaryTicker: {
      ticker: readRawTicker(row) || null,
      exchange: stringValue(rawPayload.exchange) || stringValue(metadata.exchange) || null,
    },
    filedAt: stringValue(row.published_at) || readRawFiledDate(row) || null,
    text: stringValue(row.analysis_text) || stringValue(row.body_text),
    attachments: attachmentTexts,
  };
}

async function fetchSc13ParentCandidateRows(facts: Sc13ParentMatchFacts) {
  const cusip = normalizeSc13CusipForSearch(facts.cusip);
  if (!cusip) return [];

  const select = "id,source_unique_id,source_url,title,published_at,body_text,analysis_text,raw_payload,metadata";
  const rows: RawItemRow[] = [];
  const bodyResult = await supabaseSelect("raw_items", {
    select,
    source_code: "eq.sec_edgar",
    body_text: `ilike.*${cusip}*`,
    order: "published_at.desc",
    limit: "300",
  });
  if (bodyResult.ok && Array.isArray(bodyResult.data)) rows.push(...(bodyResult.data as RawItemRow[]));

  const analysisResult = await supabaseSelect("raw_items", {
    select,
    source_code: "eq.sec_edgar",
    analysis_text: `ilike.*${cusip}*`,
    order: "published_at.desc",
    limit: "300",
  });
  if (analysisResult.ok && Array.isArray(analysisResult.data)) rows.push(...(analysisResult.data as RawItemRow[]));

  return dedupeRawRows(rows);
}

function normalizeSc13CusipForSearch(value: string) {
  const normalized = stringValue(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z0-9]{9}$/.test(normalized) ? normalized : "";
}

async function findS8RegistrationParentFilingContext({
  input,
  rawItem,
  formType,
}: {
  input: SecFilingAnalysisInput;
  rawItem: RawItemRow;
  formType: string;
}) {
  const normalizedFormType = normalizeSecFormForParentContext(formType);
  if (normalizedFormType !== "S-8 POS") return null;

  const targetFileNumbers = readS8PriorRegistrationFileNumbers(input);
  const currentAccession = readRawAccession(rawItem);
  const directFileNumberRows = targetFileNumbers.length
    ? await fetchS8RegistrationFileNumberCandidateRows(targetFileNumbers)
    : [];
  const candidateRows = dedupeRawRows([
    ...directFileNumberRows,
    ...(await fetchGenericAmendmentParentCandidateRows(rawItem)),
  ]);
  const scored = candidateRows
    .filter((row) => readRawAccession(row) !== currentAccession)
    .filter((row) => normalizeGenericParentFormFamily(readRawFormType(row)) === "S-8")
    .map((row) => {
      if (!targetFileNumbers.length) return null;
      const matchedFileNumbers = intersectStrings(targetFileNumbers, extractS8RegistrationFileNumbersFromRow(row));
      if (!matchedFileNumbers.length) return null;

      const matchReasons = [
        "s8_pos_prior_registration_file_number",
        ...matchedFileNumbers.slice(0, 4).map((fileNumber) => `matches_${fileNumber}`),
      ];
      let score = 220 + matchedFileNumbers.length * 30;
      if (!isSecAmendmentFormForParentContext(readRawFormType(row))) {
        score += 35;
        matchReasons.push("non_amendment_parent_preferred");
      }

      return {
        row,
        score,
        matchReasons,
        matchedFileNumbers,
      };
    })
    .filter(
      (
        item,
      ): item is {
        row: RawItemRow;
        score: number;
        matchReasons: string[];
        matchedFileNumbers: string[];
      } => Boolean(item),
    )
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return Date.parse(stringValue(right.row.published_at)) - Date.parse(stringValue(left.row.published_at));
    });

  const best = scored[0];
  if (!best) {
    const currentFiledAt = Date.parse(stringValue(rawItem.published_at));
    const currentTicker = readRawTicker(rawItem);
    const currentCik = normalizeCik(readRawCik(rawItem));
    const sameIssuerPriorS8Rows = candidateRows
      .filter((row) => readRawAccession(row) !== currentAccession)
      .filter((row) => normalizeGenericParentFormFamily(readRawFormType(row)) === "S-8")
      .filter((row) => !isSecAmendmentFormForParentContext(readRawFormType(row)))
      .filter((row) => {
        const rowFiledAt = Date.parse(stringValue(row.published_at));
        return !Number.isFinite(currentFiledAt) || !Number.isFinite(rowFiledAt) || rowFiledAt < currentFiledAt;
      })
      .filter((row) => {
        const rowTicker = readRawTicker(row);
        const rowCik = normalizeCik(readRawCik(row));
        return Boolean((currentCik && rowCik && currentCik === rowCik) || (currentTicker && rowTicker && currentTicker === rowTicker));
      })
      .sort((left, right) => Date.parse(stringValue(right.published_at)) - Date.parse(stringValue(left.published_at)));

    if (sameIssuerPriorS8Rows.length === 1) {
      return buildGenericAmendmentParentContext({
        status: "found",
        confidence: "medium",
        matchMethod: "same_issuer_prior_s8_single_candidate",
        matchScore: 180,
        matchReasons: [
          targetFileNumbers.length
            ? "s8_pos_prior_registration_file_number_present"
            : "s8_pos_prior_registration_file_number_missing",
          targetFileNumbers.length ? "parent_row_file_number_unavailable" : "same_issuer_fallback_parent",
          "single_same_issuer_prior_non_amendment_s8",
        ],
        rawItem,
        parentRow: sameIssuerPriorS8Rows[0],
        candidateRows: sameIssuerPriorS8Rows,
      });
    }

    if (sameIssuerPriorS8Rows.length > 1) {
      return buildGenericAmendmentParentContext({
        status: "multiple_candidates",
        confidence: "medium",
        matchMethod: "same_issuer_prior_s8_multiple_candidates",
        matchScore: 160,
        matchReasons: [
          targetFileNumbers.length
            ? "s8_pos_prior_registration_file_number_present"
            : "s8_pos_prior_registration_file_number_missing",
          targetFileNumbers.length ? "parent_row_file_number_unavailable" : "same_issuer_fallback_parent",
          "multiple_same_issuer_prior_non_amendment_s8_candidates",
        ],
        rawItem,
        parentRow: null,
        candidateRows: sameIssuerPriorS8Rows.slice(0, 5),
      });
    }

    return null;
  }

  const second = scored[1];
  const ambiguous = second && best.score - second.score < 20;

  return buildGenericAmendmentParentContext({
    status: ambiguous ? "multiple_candidates" : "found",
    confidence: ambiguous ? "medium" : "high",
    matchMethod: ambiguous ? "s8_registration_file_number_multiple_candidates" : "s8_registration_file_number",
    matchScore: best.score,
    matchReasons: ambiguous
      ? [...best.matchReasons, "multiple_prior_s8_candidates_for_registration_file_number"]
      : best.matchReasons,
    rawItem,
    parentRow: ambiguous ? null : best.row,
    candidateRows: scored.slice(0, 5).map((item) => item.row),
  });
}

async function findCurrentReportParentFilingContext({
  amendment,
  parserOutput,
  rawItem,
}: {
  amendment: Record<string, unknown>;
  parserOutput: Record<string, unknown>;
  rawItem: RawItemRow;
}) {
  const currentAccession = readRawAccession(rawItem);
  const currentCik = normalizeCik(readRawCik(rawItem));
  const currentFamily = normalizeCurrentReportFamily(readRawFormType(rawItem));
  if (!currentCik || !currentFamily) return null;

  const explicitParentAccession = stringValue(amendment.parentAccessionNumber || amendment.parent_accession_number);
  if (explicitParentAccession) {
    const row = await fetchSecRawItemByAccession(explicitParentAccession);
    const rowFiledAt = row ? Date.parse(stringValue(row.published_at)) : Number.NaN;
    const currentFiledAt = Date.parse(stringValue(rawItem.published_at));
    const isPriorFiling = !Number.isFinite(currentFiledAt) || !Number.isFinite(rowFiledAt) || rowFiledAt < currentFiledAt;
    if (
      row &&
      readRawAccession(row) !== currentAccession &&
      normalizeCik(readRawCik(row)) === currentCik &&
      normalizeCurrentReportFamily(readRawFormType(row)) === currentFamily &&
      isPriorFiling
    ) {
      return buildCurrentReportParentContext({
        row,
        matchMethod: "explicit_parent_accession",
        matchScore: 1000,
        matchReasons: ["amendment_parent_accession"],
        parserOutput,
      });
    }
    return null;
  }

  const parentFiledDate = normalizeDateOnly(stringValue(amendment.parentFiledDate || amendment.parent_filed_date));
  if (!parentFiledDate) return null;

  const candidates = await fetchCurrentReportParentCandidateRows(rawItem);
  if (!candidates.length) return null;

  const currentFiledAt = Date.parse(stringValue(rawItem.published_at));
  const exactMatches = candidates.filter((row) => {
    if (readRawAccession(row) === currentAccession) return false;
    if (normalizeCik(readRawCik(row)) !== currentCik) return false;
    if (normalizeCurrentReportFamily(readRawFormType(row)) !== currentFamily) return false;
    if (isCurrentReportAmendmentForm(readRawFormType(row))) return false;
    if (normalizeDateOnly(readRawFiledDate(row)) !== parentFiledDate) return false;
    const rowFiledAt = Date.parse(stringValue(row.published_at));
    return !Number.isFinite(currentFiledAt) || !Number.isFinite(rowFiledAt) || rowFiledAt < currentFiledAt;
  });

  if (exactMatches.length !== 1) return null;
  const parentRow = exactMatches[0];

  return buildCurrentReportParentContext({
    row: parentRow,
    matchMethod: "parent_filed_date_unique",
    matchScore: 1000,
    matchReasons: ["same_cik", "same_current_report_family", "parent_filed_date_exact", "unique_non_amendment_candidate"],
    parserOutput,
  });
}

async function findParentS3RegistrationContext({
  currentAccession,
  rawItem,
  registrationNumber,
}: {
  currentAccession: string;
  rawItem: RawItemRow;
  registrationNumber: string;
}) {
  const rawPayload = readRecord(rawItem.raw_payload) || {};
  const metadata = readRecord(rawItem.metadata) || {};
  const ticker = (stringValue(rawPayload.ticker) || stringValue(metadata.ticker)).toUpperCase();
  const rawCik = readRawCik(rawItem);
  const currentCik = normalizeCik(rawCik);
  const currentIssuer = normalizeCompanyNameForParentMatch(readRawCompanyName(rawItem));
  const currentParsed = parseSecS3Filing(rawRowToS3ParseInput(rawItem));
  const rows = await fetchS3ParentCandidateRows({ ticker, cik: currentCik, rawCik });
  if (!rows.length) return buildMissingParentS3Context("no_scoped_candidates");

  const currentFiledAt = Date.parse(stringValue(rawItem.published_at));
  const matches: Array<{
    row: RawItemRow;
    parsed: SecS3FilingFacts;
    score: number;
    filedAt: number;
    matchMethod: string;
    matchReasons: string[];
    registrationNumberMatch: boolean;
  }> = [];

  for (const row of rows) {
    const accession = readRawAccession(row);
    if (currentAccession && accession === currentAccession) continue;

    const formType = readRawFormType(row);
    if (!isS3F3RegistrationFamilyForm(formType)) continue;

    const rowTicker = readRawTicker(row);
    const rowCik = normalizeCik(readRawCik(row));
    const cikMatches = Boolean(currentCik && rowCik && currentCik === rowCik);
    if (!cikMatches && ticker && rowTicker && rowTicker !== ticker) continue;

    const parsed = parseSecS3Filing(rawRowToS3ParseInput(row));
    const registrationNumberMatches = sameRegistrationNumber(parsed.amendment.registration_number?.value, registrationNumber);

    const filedAt = Date.parse(stringValue(row.published_at));
    if (Number.isFinite(currentFiledAt) && (!Number.isFinite(filedAt) || filedAt >= currentFiledAt)) continue;

    const rowIssuer = normalizeCompanyNameForParentMatch(readRawCompanyName(row) || stringValue(parsed.issuer));
    const sameIssuer =
      cikMatches ||
      Boolean(currentIssuer && rowIssuer && currentIssuer === rowIssuer);
    if (!sameIssuer) continue;

    const termMatch = compareS3RegistrationTerms(currentParsed, parsed);
    if (!registrationNumberMatches && !termMatch.confirmed) continue;

    const matchMethod = registrationNumberMatches ? "registration_number" : "same_cik_same_registration_terms";
    const matchReasons = registrationNumberMatches
      ? ["registration_number_match"]
      : termMatch.matchReasons;
    let score = 0;
    if (!parsed.amendment.is_amendment) score += 20;
    if (Number.isFinite(currentFiledAt) && Number.isFinite(filedAt) && filedAt <= currentFiledAt) score += 50;
    if (currentCik && rowCik && currentCik === rowCik) score += 50;
    if (ticker && rowTicker && rowTicker === ticker) score += 15;
    if (parsed.fee_table.present) score += 10;
    if (parsed.selling_stockholders.length) score += 10;
    if (parsed.extracted_field_count) score += Math.min(10, parsed.extracted_field_count);
    if (!registrationNumberMatches) score += termMatch.score;

    matches.push({
      row,
      parsed,
      score,
      filedAt,
      matchMethod,
      matchReasons,
      registrationNumberMatch: registrationNumberMatches,
    });
  }

  matches.sort((left, right) => {
    if (right.filedAt !== left.filedAt) return right.filedAt - left.filedAt;
    return right.score - left.score;
  });

  const best = matches[0];
  if (!best) return buildMissingParentS3Context("no_registration_number_parent_match");

  const ambiguous = matches.length > 1 && best.filedAt === matches[1].filedAt;
  if (ambiguous) {
    return buildAmbiguousParentS3Context({
      candidateCount: matches.length,
      candidates: matches.slice(0, 5).map(({ row, parsed, score }) => buildParentS3CandidateSummary({ parsed, row, score })),
      registrationNumber,
    });
  }

  return buildParentS3Context({
    matchMethod: best.matchMethod,
    matchReasons: best.matchReasons,
    matchCount: matches.length,
    parsed: best.parsed,
    registrationNumberMatch: best.registrationNumberMatch,
    registrationNumber,
    row: best.row,
  });
}

async function fetchS3ParentCandidateRows({ ticker, cik, rawCik }: { ticker: string; cik: string; rawCik: string }) {
  const select = "id,source_unique_id,source_url,title,published_at,body_text,analysis_text,raw_payload,metadata";
  const scoped: RawItemRow[] = [];

  const cikCandidates = uniqueStrings([rawCik, cik].filter(Boolean));
  for (const cikCandidate of cikCandidates) {
    const byPayloadCik = await supabaseSelect("raw_items", {
      select,
      source_code: "eq.sec_edgar",
      "raw_payload->>cik": `eq.${cikCandidate}`,
      order: "published_at.desc",
      limit: "200",
    });
    if (byPayloadCik.ok && Array.isArray(byPayloadCik.data)) scoped.push(...(byPayloadCik.data as RawItemRow[]));

    const byMetadataCik = await supabaseSelect("raw_items", {
      select,
      source_code: "eq.sec_edgar",
      "metadata->>cik": `eq.${cikCandidate}`,
      order: "published_at.desc",
      limit: "200",
    });
    if (byMetadataCik.ok && Array.isArray(byMetadataCik.data)) scoped.push(...(byMetadataCik.data as RawItemRow[]));
  }

  const withTicker = ticker
    ? await supabaseSelect("raw_items", {
        select,
        source_code: "eq.sec_edgar",
        "raw_payload->>ticker": `eq.${ticker}`,
        order: "published_at.desc",
        limit: "200",
      })
    : null;

  if (withTicker?.ok && Array.isArray(withTicker.data)) scoped.push(...(withTicker.data as RawItemRow[]));

  return uniqueRawRows(scoped);
}

async function buildParentS3Context({
  matchMethod,
  matchReasons,
  matchCount,
  parsed,
  registrationNumberMatch,
  registrationNumber,
  row,
}: {
  matchMethod: string;
  matchReasons: string[];
  matchCount: number;
  parsed: SecS3FilingFacts;
  registrationNumberMatch: boolean;
  registrationNumber: string;
  row: RawItemRow;
}) {
  return {
    source: "raw_items",
    status: "found",
    confirmed_parent: true,
    comparison_allowed: true,
    registration_number_match: registrationNumberMatch,
    match_method: matchMethod,
    match_reasons: matchReasons,
    match_count: matchCount,
    registration_number: registrationNumber,
    raw_item_id: stringValue(row.id) || null,
    accession_number: parsed.accession_number,
    form_type: parsed.form_type,
    filed_at: parsed.filed_at,
    source_url: parsed.source_url,
    company_name: parsed.issuer,
    ticker: parsed.ticker,
    registration_statement_kind: parsed.registration_statement_kind?.value || null,
    registration_status: parsed.registration_status?.value || null,
    prospectus_status: parsed.prospectus_status?.value || null,
    primary_or_resale: parsed.primary_or_resale?.value || null,
    securities_registered: parsed.securities_registered.map((item) => item.value),
    shares_registered: parsed.shares_registered?.text || null,
    resale_share_count: parsed.resale_share_count?.text || null,
    current_shares_outstanding: parsed.current_shares_outstanding?.text || null,
    offering_terms: {
      registration_statement_kind: parsed.offering_terms.registration_statement_kind?.value || null,
      offering_type: parsed.offering_terms.offering_type?.value || null,
      security_type: parsed.offering_terms.security_type?.value || null,
      primary_or_resale: parsed.offering_terms.primary_or_resale?.value || null,
      offering_amount: parsed.offering_terms.offering_amount?.text || null,
      shelf_capacity: parsed.offering_terms.shelf_capacity?.text || null,
      atm_program_size: parsed.offering_terms.atm_program_size?.text || null,
      resale_share_count: parsed.offering_terms.resale_share_count?.text || null,
      current_shares_outstanding: parsed.offering_terms.current_shares_outstanding?.text || null,
      warrant_coverage: parsed.offering_terms.warrant_coverage?.value || null,
      conversion_price: parsed.offering_terms.conversion_price?.text || null,
    },
    fee_table: {
      present: parsed.fee_table.present,
      text_available: parsed.fee_table.text_available,
      row_count: parsed.fee_table.rows.length,
      total_offering_amount: parsed.fee_table.totals.total_offering_amount?.text || null,
      net_fee_due: parsed.fee_table.totals.net_fee_due?.text || null,
    },
    selling_stockholders: {
      count: parsed.selling_stockholders.length,
      top_holders: parsed.selling_stockholders.slice(0, 8).map((holder) => ({
        holder_name: holder.holder_name,
        shares_offered_for_resale: holder.shares_offered_for_resale?.text || null,
        beneficially_owned_before: holder.beneficially_owned_before?.text || null,
        beneficially_owned_after: holder.beneficially_owned_after?.text || null,
        percent_after: holder.percent_after?.text || null,
      })),
    },
    source_excerpts: buildParentS3SourceExcerpts(row),
    existing_analysis: await fetchExistingParentAnalysis(stringValue(row.id)),
    needs_human_review: parsed.needs_human_review,
    review_reasons: parsed.review_reasons,
  };
}

function buildMissingParentS3Context(reason: string) {
  return {
    source: "raw_items",
    status: "not_found",
    confirmed_parent: false,
    comparison_allowed: false,
    registration_number_match: false,
    match_method: "registration_number",
    match_count: 0,
    match_reasons: [reason],
    parent: null,
  };
}

function buildAmbiguousParentS3Context({
  candidateCount,
  candidates,
  registrationNumber,
}: {
  candidateCount: number;
  candidates: Array<Record<string, unknown>>;
  registrationNumber: string;
}) {
  return {
    source: "raw_items",
    status: "multiple_candidates",
    confirmed_parent: false,
    comparison_allowed: false,
    registration_number_match: true,
    match_method: "registration_number",
    match_count: candidateCount,
    registration_number: registrationNumber,
    candidates,
    parent: null,
  };
}

function buildParentS3CandidateSummary({
  parsed,
  row,
  score,
}: {
  parsed: SecS3FilingFacts;
  row: RawItemRow;
  score: number;
}) {
  return {
    raw_item_id: stringValue(row.id) || null,
    accession_number: parsed.accession_number,
    form_type: parsed.form_type,
    filed_at: parsed.filed_at,
    ticker: parsed.ticker,
    company_name: parsed.issuer,
    score,
    resale_share_count: parsed.resale_share_count?.text || null,
    current_shares_outstanding: parsed.current_shares_outstanding?.text || null,
    offering_type: parsed.offering_terms.offering_type?.value || null,
    security_type: parsed.offering_terms.security_type?.value || null,
  };
}

function compareS3RegistrationTerms(current: SecS3FilingFacts, candidate: SecS3FilingFacts) {
  const matchReasons: string[] = [];
  let score = 0;

  if (sameS3CountField(current.resale_share_count, candidate.resale_share_count)) {
    score += 90;
    matchReasons.push("same_resale_share_count");
  }
  if (sameS3CountField(current.shares_registered, candidate.shares_registered)) {
    score += 60;
    matchReasons.push("same_registered_share_count");
  }
  if (sameS3MoneyField(current.offering_terms.shelf_capacity, candidate.offering_terms.shelf_capacity)) {
    score += 70;
    matchReasons.push("same_shelf_capacity");
  }
  if (sameS3MoneyField(current.offering_terms.offering_amount, candidate.offering_terms.offering_amount)) {
    score += 55;
    matchReasons.push("same_offering_amount");
  }
  if (sameS3TextField(current.primary_or_resale, candidate.primary_or_resale)) {
    score += 15;
    matchReasons.push("same_primary_or_resale");
  }
  if (sameS3TextField(current.offering_terms.offering_type, candidate.offering_terms.offering_type)) {
    score += 15;
    matchReasons.push("same_offering_type");
  }
  if (sameS3TextField(current.offering_terms.security_type, candidate.offering_terms.security_type)) {
    score += 10;
    matchReasons.push("same_security_type");
  }

  const currentHolderCount = current.selling_stockholders.length;
  if (currentHolderCount > 0 && currentHolderCount === candidate.selling_stockholders.length) {
    score += 15;
    matchReasons.push("same_selling_holder_count");
  }

  return {
    confirmed: score >= 100,
    score,
    matchReasons,
  };
}

function sameS3TextField(left: { value?: string | null } | null, right: { value?: string | null } | null) {
  const leftValue = stringValue(left?.value).toLowerCase();
  const rightValue = stringValue(right?.value).toLowerCase();
  return Boolean(leftValue && rightValue && leftValue === rightValue);
}

function sameS3CountField(left: { value?: number | null; text?: string | null } | null, right: { value?: number | null; text?: string | null } | null) {
  const leftValue = numberValue(left?.value) || parseFirstPositiveNumber(left?.text);
  const rightValue = numberValue(right?.value) || parseFirstPositiveNumber(right?.text);
  return Boolean(leftValue && rightValue && Math.abs(leftValue - rightValue) <= 1);
}

function sameS3MoneyField(
  left: { value?: { amount?: number | null; scale?: string | null } | null; text?: string | null } | null,
  right: { value?: { amount?: number | null; scale?: string | null } | null; text?: string | null } | null,
) {
  const leftValue = normalizeS3MoneyAmount(left);
  const rightValue = normalizeS3MoneyAmount(right);
  if (leftValue && rightValue) return Math.abs(leftValue - rightValue) <= Math.max(1, leftValue * 0.001);

  const leftText = normalizeNumericText(left?.text);
  const rightText = normalizeNumericText(right?.text);
  return Boolean(leftText && rightText && leftText === rightText);
}

function normalizeS3MoneyAmount(field: { value?: { amount?: number | null; scale?: string | null } | null } | null) {
  const amount = numberValue(field?.value?.amount);
  if (!amount) return 0;
  const scale = stringValue(field?.value?.scale).toLowerCase();
  if (scale === "billion") return amount * 1_000_000_000;
  if (scale === "million") return amount * 1_000_000;
  if (scale === "thousand") return amount * 1_000;
  return amount;
}

function normalizeNumericText(value: unknown) {
  return stringValue(value).replace(/[^0-9.]+/g, "");
}

function parseFirstPositiveNumber(value: unknown) {
  const match = stringValue(value).replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  if (!match) return 0;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function uniqueRawRows(rows: RawItemRow[]) {
  const seen = new Set<string>();
  const result: RawItemRow[] = [];
  for (const row of rows) {
    const key = stringValue(row.id) || readRawAccession(row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }
  return result;
}

function buildParentS3SourceExcerpts(row: RawItemRow) {
  const text = truncateCompactContextText(`${stringValue(row.body_text)} ${stringValue(row.analysis_text)}`, 240_000);
  if (!text) return [];

  const specs = [
    {
      label: "Parent registration obligation",
      pattern:
        /\b(?:not already so registered by|register(?:ed)?\s+(?:by|on or before))\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}[\s\S]{0,260}?(?:effective|declared effective)[\s\S]{0,180}?(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}/i,
      bodyPattern: /\b(?:underlying the Investor Warrants|declared effective|cause such filing|effective by|effective no later than)\b/i,
    },
    {
      label: "Parent incorporated documents",
      pattern: /\bDOCUMENTS INCORPORATED BY REFERENCE\b/i,
      bodyPattern: /\b(?:annual report|quarterly report|current report|filed with the SEC|Exchange Act|incorporate by reference)\b/i,
    },
    {
      label: "Parent experts",
      pattern: /\bEXPERTS\b/i,
      bodyPattern: /\b(?:audited by|independent registered public accounting firm|Weaver|Tidwell|MKM Engineering|reserves|Appraisal Report)\b/i,
    },
    {
      label: "Parent selling holder terms",
      pattern: /\bselling stockholder\b/i,
      bodyPattern: /\b(?:shares of common stock|Second Tranche Warrant|Registration Rights Agreement|Waiver|will not receive any proceeds)\b/i,
    },
  ];

  const excerpts: Array<{ label: string; text: string }> = [];
  for (const spec of specs) {
    const excerpt = extractS3ContextExcerpt(text, spec.pattern, spec.bodyPattern);
    if (excerpt) excerpts.push({ label: spec.label, text: excerpt });
  }
  return excerpts;
}

function extractS3ContextExcerpt(text: string, pattern: RegExp, bodyPattern: RegExp) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const globalPattern = new RegExp(pattern.source, flags);
  for (const match of text.matchAll(globalPattern)) {
    const index = match.index ?? -1;
    if (index < 0) continue;
    const start = Math.max(0, index - 180);
    const end = Math.min(text.length, index + 1_500);
    const window = text.slice(start, end);
    if (!bodyPattern.test(window)) continue;
    if (/\bTABLE OF CONTENTS\b/i.test(window.slice(0, 500))) continue;
    return truncateCompactContextText(window, 1_500);
  }
  return "";
}

async function fetchExistingParentAnalysis(rawItemId: string) {
  if (!rawItemId) return null;

  const eventResult = await supabaseSelect("events", {
    select: "*",
    source_group: "eq.filings",
    raw_item_id: `eq.${rawItemId}`,
    order: "detected_at.desc",
    limit: "1",
  });
  const event = eventResult.ok && Array.isArray(eventResult.data) ? readRecord(eventResult.data[0]) : null;
  if (!event) return null;

  const analysisResult = await supabaseSelect("event_analysis", {
    select: "*",
    event_id: `eq.${stringValue(event.id)}`,
    limit: "1",
  });
  const analysis = analysisResult.ok && Array.isArray(analysisResult.data) ? readRecord(analysisResult.data[0]) : null;

  return {
    event_id: stringValue(event.id) || null,
    event_type: stringValue(event.event_type) || null,
    score: numberValue(event.score),
    delivery_level: stringValue(event.delivery_level) || null,
    signal: stringValue(event.signal) || null,
    event_title: stringValue(event.event_title) || stringValue(event.title) || null,
    quick_take: stringValue(event.quick_take) || stringValue(analysis?.quick_take) || null,
    summary: stringValue(event.summary) || stringValue(analysis?.summary) || null,
    key_evidence: readStringArray(analysis?.key_evidence).slice(0, 3),
    what_to_watch_next: readStringArray(analysis?.what_to_watch_next).slice(0, 3),
  };
}

async function fetchSecRawItemByAccession(accession: string) {
  const normalized = stringValue(accession);
  if (!normalized) return null;

  const result = await supabaseSelect("raw_items", {
    select: "id,source_unique_id,source_url,title,published_at,body_text,analysis_text,raw_payload,metadata",
    source_code: "eq.sec_edgar",
    source_unique_id: `eq.${normalized}`,
    limit: "1",
  });
  const row = result.ok && Array.isArray(result.data) ? (result.data[0] as RawItemRow | undefined) : null;
  if (row) return row;

  const payloadResult = await supabaseSelect("raw_items", {
    select: "id,source_unique_id,source_url,title,published_at,body_text,analysis_text,raw_payload,metadata",
    source_code: "eq.sec_edgar",
    "raw_payload->>accession_number": `eq.${normalized}`,
    limit: "1",
  });
  const payloadRow = payloadResult.ok && Array.isArray(payloadResult.data) ? (payloadResult.data[0] as RawItemRow | undefined) : null;
  return payloadRow || null;
}

async function fetchCurrentReportParentCandidateRows(rawItem: RawItemRow) {
  const select = "id,source_unique_id,source_url,title,published_at,body_text,analysis_text,raw_payload,metadata";
  const cik = readRawCik(rawItem);
  const ticker = readRawTicker(rawItem);
  const rows: RawItemRow[] = [];

  if (cik) {
    const result = await supabaseSelect("raw_items", {
      select,
      source_code: "eq.sec_edgar",
      "raw_payload->>cik": `eq.${cik}`,
      order: "published_at.desc",
      limit: "200",
    });
    if (result.ok && Array.isArray(result.data)) rows.push(...(result.data as RawItemRow[]));
  }

  if (ticker) {
    const result = await supabaseSelect("raw_items", {
      select,
      source_code: "eq.sec_edgar",
      "raw_payload->>ticker": `eq.${ticker}`,
      order: "published_at.desc",
      limit: "200",
    });
    if (result.ok && Array.isArray(result.data)) rows.push(...(result.data as RawItemRow[]));
  }

  if (!rows.length) {
    const result = await supabaseSelect("raw_items", {
      select,
      source_code: "eq.sec_edgar",
      order: "published_at.desc",
      limit: "200",
    });
    if (result.ok && Array.isArray(result.data)) rows.push(...(result.data as RawItemRow[]));
  }

  return dedupeRawRows(rows).filter(isCurrentReportParentCandidate);
}

async function fetchGenericAmendmentParentCandidateRows(rawItem: RawItemRow, ownershipHints?: OwnershipParentSearchHints) {
  const select = "id,source_unique_id,source_url,title,published_at,body_text,analysis_text,raw_payload,metadata";
  const rawCik = readRawCik(rawItem);
  const cikValues = uniqueStrings([rawCik, normalizeCik(rawCik), ...(ownershipHints?.companyCiks || [])].filter(Boolean));
  const ticker = readRawTicker(rawItem);
  const rows: RawItemRow[] = [];

  for (const cik of cikValues) {
    const result = await supabaseSelect("raw_items", {
      select,
      source_code: "eq.sec_edgar",
      "raw_payload->>cik": `eq.${cik}`,
      order: "published_at.desc",
      limit: "300",
    });
    if (result.ok && Array.isArray(result.data)) rows.push(...(result.data as RawItemRow[]));
  }

  if (ticker) {
    const result = await supabaseSelect("raw_items", {
      select,
      source_code: "eq.sec_edgar",
      "raw_payload->>ticker": `eq.${ticker}`,
      order: "published_at.desc",
      limit: "300",
    });
    if (result.ok && Array.isArray(result.data)) rows.push(...(result.data as RawItemRow[]));
  }

  for (const ownerCik of (ownershipHints?.ownerCiks || []).slice(0, 2)) {
    const result = await supabaseSelect("raw_items", {
      select,
      source_code: "eq.sec_edgar",
      body_text: `ilike.*${ownerCik}*`,
      order: "published_at.desc",
      limit: "300",
    });
    if (result.ok && Array.isArray(result.data)) rows.push(...(result.data as RawItemRow[]));
  }

  if (!rows.length) {
    const result = await supabaseSelect("raw_items", {
      select,
      source_code: "eq.sec_edgar",
      order: "published_at.desc",
      limit: "300",
    });
    if (result.ok && Array.isArray(result.data)) rows.push(...(result.data as RawItemRow[]));
  }

  return dedupeRawRows(rows);
}

async function fetchTenderParentCandidateRows(input: SecFilingAnalysisInput, rawItem: RawItemRow) {
  const select = "id,source_unique_id,source_url,title,published_at,raw_payload,metadata";
  const filingPackage = readRecord(input.filing_package) || {};
  const subjectTicker = resolveTenderSubjectMarketContextSymbol(filingPackage);
  const rawCik = readRawCik(rawItem);
  const cikValues = uniqueStrings([rawCik, normalizeCik(rawCik)].filter(Boolean));
  const tickerValues = uniqueStrings([readRawTicker(rawItem), subjectTicker || ""].filter(Boolean));
  const rows: RawItemRow[] = [];

  for (const cik of cikValues.slice(0, 3)) {
    const result = await supabaseSelect("raw_items", {
      select,
      source_code: "eq.sec_edgar",
      "raw_payload->>cik": `eq.${cik}`,
      order: "published_at.desc",
      limit: "150",
    });
    if (result.ok && Array.isArray(result.data)) rows.push(...(result.data as RawItemRow[]));
  }

  for (const ticker of tickerValues.slice(0, 3)) {
    const normalizedTicker = normalizeMarketContextTicker(ticker);
    if (!normalizedTicker) continue;
    const result = await supabaseSelect("raw_items", {
      select,
      source_code: "eq.sec_edgar",
      "raw_payload->>ticker": `eq.${normalizedTicker}`,
      order: "published_at.desc",
      limit: "150",
    });
    if (result.ok && Array.isArray(result.data)) rows.push(...(result.data as RawItemRow[]));
  }

  return dedupeRawRows(rows);
}

type TenderTransactionMatchFacts = {
  targetCompany: string;
  targetTicker: string;
  cusip: string;
  cashPrice: number | null;
  buyerNames: string[];
  transactionFamily: string;
  formFamily: string;
};

type TenderTransactionHistoryMatch = {
  match_score: number;
  match_confidence: "high" | "medium" | "low";
  match_reasons: string[];
};

function buildCurrentTenderTransactionMatchFacts(
  filingPackage: Record<string, unknown>,
  rawItem: RawItemRow,
  targetTickerCandidate = "",
): TenderTransactionMatchFacts {
  const hardParsers = readRecord(filingPackage.hard_parsers);
  const tenderParser = readRecord(hardParsers?.tender);
  const facts = readRecord(tenderParser?.facts) || {};
  const coverPage = readRecord(facts.cover_page);
  const cashPrice = firstFiniteNumber([
    readRecord(readRecord(facts.cash_price_per_share)?.value)?.price,
    readRecord(facts.cash_price_per_share)?.price,
    facts.cash_price_per_share,
    facts.offer_price,
    facts.purchase_price,
    facts.consideration_summary,
  ]);
  const offerors = [
    facts.offeror,
    readRecord(facts.offeror)?.value,
    facts.buyer_parent,
    facts.parent,
    ...readRecordArray(facts.offerors).flatMap((item) => [item.value, item.name]),
    ...readRecordArray(coverPage?.offerors).flatMap((item) => [item.value, item.name]),
  ];

  return {
    targetCompany: resolveTenderSubjectCompanyName(filingPackage) || readRawCompanyName(rawItem),
    targetTicker:
      normalizeMarketContextTicker(targetTickerCandidate) ||
      resolveTenderSubjectMarketContextSymbol(filingPackage) ||
      normalizeMarketContextTicker(stringValue(readRecord(filingPackage.primary_ticker)?.ticker)) ||
      readRawTicker(rawItem) ||
      "",
    cusip: resolveTenderSecurityCusip(filingPackage),
    cashPrice,
    buyerNames: uniqueStrings(offerors.map(stringValue).filter(Boolean)).slice(0, 8),
    transactionFamily: stringValue(facts.tender_case) || normalizeGenericParentFormFamily(stringValue(filingPackage.form_type) || readRawFormType(rawItem)),
    formFamily: normalizeGenericParentFormFamily(stringValue(filingPackage.form_type) || readRawFormType(rawItem)),
  };
}

function scoreTenderTransactionHistoryEventMatch(
  current: TenderTransactionMatchFacts,
  event: RawItemRow,
): TenderTransactionHistoryMatch {
  const metadata = readRecord(event.metadata) || {};
  const fingerprint = readRecord(metadata.transaction_fingerprint) || {};
  const reasons: string[] = [];
  let score = 0;

  const fingerprintTarget = stringValue(fingerprint.target_company);
  const targetOverlap = tenderNameOverlapScore(current.targetCompany, fingerprintTarget || stringValue(event.title) || stringValue(event.summary));
  if (targetOverlap >= 2) {
    score += 80;
    reasons.push("same_target_company");
  } else if (targetOverlap === 1) {
    score += 55;
    reasons.push("target_company_token_overlap");
  }

  const currentTicker = normalizeMarketContextTicker(current.targetTicker);
  const candidateTargetTicker = normalizeMarketContextTicker(stringValue(fingerprint.target_ticker));
  const eventTicker = normalizeMarketContextTicker(stringValue(event.ticker));
  if (currentTicker && candidateTargetTicker && currentTicker === candidateTargetTicker) {
    score += 35;
    reasons.push("same_target_ticker");
  } else if (currentTicker && eventTicker && currentTicker === eventTicker) {
    score += 15;
    reasons.push("same_event_ticker");
  }

  const currentPrice = current.cashPrice;
  const candidatePrice = firstFiniteNumber([fingerprint.cash_price, fingerprint.consideration_summary, event.summary, event.quick_take, event.title]);
  if (currentPrice !== null && candidatePrice !== null && Math.abs(currentPrice - candidatePrice) <= 0.02) {
    score += 40;
    reasons.push("same_cash_price");
  }

  const buyerOverlap = tenderPartyOverlapScore(current.buyerNames, [
    fingerprint.buyer_parent,
    fingerprint.offeror,
    ...readStringArray(fingerprint.buyer_group),
    ...readStringArray(fingerprint.filing_persons),
    event.title,
  ]);
  if (buyerOverlap >= 2) {
    score += 30;
    reasons.push("same_buyer_or_offeror");
  } else if (buyerOverlap === 1) {
    score += 15;
    reasons.push("buyer_or_offeror_overlap");
  }

  const candidateFamily = stringValue(fingerprint.transaction_family) || readTenderEventFormFamily(event);
  if (current.transactionFamily && candidateFamily && tenderComparableFamily(current.transactionFamily) === tenderComparableFamily(candidateFamily)) {
    score += 15;
    reasons.push("same_transaction_family");
  }
  if (current.formFamily && readTenderEventFormFamily(event) && current.formFamily === readTenderEventFormFamily(event)) {
    score += 10;
    reasons.push("same_form_family");
  }

  return {
    match_score: score,
    match_confidence: score >= 100 ? "high" : score >= 75 ? "medium" : "low",
    match_reasons: reasons,
  };
}

function tenderComparableFamily(value: string) {
  return normalizeComparableName(value).replace(/\b(?:GENERIC|STATUS|TRANSACTION|OFFER)\b/g, "").trim();
}

function tenderNameOverlapScore(left: string, right: string) {
  const leftTokens = tenderNameTokens(left);
  const rightTokens = tenderNameTokens(right);
  if (!leftTokens.length || !rightTokens.length) return 0;
  return leftTokens.filter((token) => rightTokens.includes(token)).length;
}

function tenderPartyOverlapScore(leftValues: string[], rightValues: unknown[]) {
  const leftTokens = uniqueStrings(leftValues.flatMap(tenderNameTokens));
  const rightTokens = uniqueStrings(rightValues.map(stringValue).flatMap(tenderNameTokens));
  if (!leftTokens.length || !rightTokens.length) return 0;
  return leftTokens.filter((token) => rightTokens.includes(token)).length;
}

function tenderNameTokens(value: string) {
  return normalizeComparableName(value)
    .split(" ")
    .filter((token) => token.length >= 4 && !TENDER_COMPANY_HISTORY_STOP_WORDS.has(token));
}

function firstFiniteNumber(values: unknown[]) {
  for (const value of values) {
    const direct = numberValue(value);
    if (direct !== null) return direct;
    const text = stringValue(value);
    if (!text) continue;
    const match = text.replace(/,/g, "").match(/(?:USD|\$)?\s*(\d+(?:\.\d+)?)/i);
    if (match) {
      const parsed = Number(match[1]);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

async function fetchTenderTransactionHistoryEventRows(rawItem: RawItemRow, subjectTicker: string, subjectCompany: string) {
  const select = "*";
  const rows: RawItemRow[] = [];
  const tickers = uniqueStrings([subjectTicker, readRawTicker(rawItem)].map((value) => normalizeMarketContextTicker(value) || ""));
  const currentPublishedAt = stringValue(rawItem.published_at);

  for (const ticker of tickers.slice(0, 3)) {
    const result = await supabaseSelect("events", {
      select,
      source_group: "eq.filings",
      source_code: "eq.sec_edgar",
      ticker: `eq.${ticker}`,
      order: "published_at.desc",
      limit: "80",
    });
    if (result.ok && Array.isArray(result.data)) rows.push(...(result.data as RawItemRow[]));
  }

  const cik = normalizeCik(readRawCik(rawItem));
  if (cik) {
    const result = await supabaseSelect("events", {
      select,
      source_group: "eq.filings",
      source_code: "eq.sec_edgar",
      "metadata->>cik": `eq.${cik}`,
      order: "published_at.desc",
      limit: "80",
    });
    if (result.ok && Array.isArray(result.data)) rows.push(...(result.data as RawItemRow[]));
  }

  const companySearchTerm = tenderCompanyHistorySearchTerm(subjectCompany || readRawCompanyName(rawItem));
  if (companySearchTerm) {
    const titleResult = await supabaseSelect("events", {
      select,
      source_group: "eq.filings",
      title: `ilike.*${companySearchTerm}*`,
      order: "published_at.desc",
      limit: "80",
    });
    if (titleResult.ok && Array.isArray(titleResult.data)) rows.push(...(titleResult.data as RawItemRow[]));

    const summaryResult = await supabaseSelect("events", {
      select,
      source_group: "eq.filings",
      summary: `ilike.*${companySearchTerm}*`,
      order: "published_at.desc",
      limit: "80",
    });
    if (summaryResult.ok && Array.isArray(summaryResult.data)) rows.push(...(summaryResult.data as RawItemRow[]));

    const fingerprintTargetResult = await supabaseSelect("events", {
      select,
      source_group: "eq.filings",
      "metadata->transaction_fingerprint->>target_company": `ilike.*${companySearchTerm}*`,
      order: "published_at.desc",
      limit: "80",
    });
    if (fingerprintTargetResult.ok && Array.isArray(fingerprintTargetResult.data)) {
      rows.push(...(fingerprintTargetResult.data as RawItemRow[]));
    }

    for (const eventType of ["strategic_transaction", "capital_return"]) {
      const recentResult = await supabaseSelect("events", {
        select,
        source_group: "eq.filings",
        event_type: `eq.${eventType}`,
        ...(currentPublishedAt ? { published_at: `lt.${currentPublishedAt}` } : {}),
        order: "published_at.desc",
        limit: "1000",
      });
      if (recentResult.ok && Array.isArray(recentResult.data)) {
        rows.push(...(recentResult.data as RawItemRow[]).filter((event) => tenderHistoryEventMentionsCompany(event, companySearchTerm)));
      }
    }
  }

  return dedupeEventRows(rows);
}

async function fetchTenderTransactionHistoryRawRows(rawItem: RawItemRow, companySearchTerm: string, securityCusip: string) {
  const term = stringValue(companySearchTerm);
  const cusip = stringValue(securityCusip);
  if (!term && !cusip) return [];

  const select = "id,source_unique_id,source_url,title,published_at,raw_payload,metadata";
  const rows: RawItemRow[] = [];
  const currentCik = normalizeCik(readRawCik(rawItem));
  const currentTicker = readRawTicker(rawItem);

  for (const queryTerm of uniqueStrings([term, cusip].filter(Boolean))) {
    for (const column of ["body_text", "analysis_text"]) {
      const result = await supabaseSelect("raw_items", {
        select,
        source_code: "eq.sec_edgar",
        [column]: `ilike.*${queryTerm}*`,
        order: "published_at.desc",
        limit: "120",
      });
      if (result.ok && Array.isArray(result.data)) rows.push(...(result.data as RawItemRow[]));
    }
  }

  return dedupeRawRows(rows).filter((row) => {
    const formFamily = normalizeGenericParentFormFamily(readRawFormType(row));
    if (!isTenderParentContextFamily(formFamily)) return false;
    const rowCik = normalizeCik(readRawCik(row));
    const rowTicker = readRawTicker(row);
    return Boolean(
      (currentCik && rowCik && currentCik === rowCik) ||
        (currentTicker && rowTicker && currentTicker === rowTicker) ||
        tenderRawRowMentionsCompany(row, term),
    );
  });
}

function tenderRawRowMentionsCompany(row: RawItemRow, searchTerm: string) {
  const term = searchTerm.toUpperCase();
  if (!term) return false;
  const rawPayload = readRecord(row.raw_payload) || {};
  const metadata = readRecord(row.metadata) || {};
  const text = [
    row.title,
    rawPayload.company_name,
    rawPayload.companyName,
    metadata.company_name,
    metadata.companyName,
  ]
    .map(stringValue)
    .join(" ")
    .toUpperCase();
  return text.includes(term);
}

function tenderHistoryEventMentionsCompany(event: RawItemRow, searchTerm: string) {
  const term = searchTerm.toUpperCase();
  if (!term) return false;
  const metadata = readRecord(event.metadata) || {};
  const fingerprint = readRecord(metadata.transaction_fingerprint);
  const text = [
    event.title,
    event.event_title,
    event.quick_take,
    event.summary,
    stringValue(fingerprint?.target_company),
    stringValue(fingerprint?.buyer_parent),
    readStringArray(fingerprint?.filing_persons).join(" "),
  ]
    .map(stringValue)
    .join(" ")
    .toUpperCase();
  return text.includes(term);
}

async function compactTenderTransactionHistoryRawRow(row: RawItemRow) {
  const existing = await fetchExistingGenericParentEventContext(stringValue(row.id));
  if (!existing) return null;

  return {
    match_source: "raw_item_company_history",
    event_id: existing.event_id || null,
    raw_item_id: stringValue(row.id) || null,
    accession_number: readRawAccession(row) || null,
    form_type: readRawFormType(row) || null,
    form_family: normalizeGenericParentFormFamily(readRawFormType(row)) || null,
    filed_at: stringValue(row.published_at) || readRawFiledDate(row) || null,
    source_url: stringValue(row.source_url) || null,
    company_name: readRawCompanyName(row) || null,
    ticker: (readRawTicker(row) || stringValue(existing?.ticker)).toUpperCase() || null,
    exchange: stringValue(existing?.exchange) || null,
    cik: normalizeCik(readRawCik(row)) || null,
    event_type: existing.event_type || null,
    score: existing.score ?? null,
    delivery_level: existing.delivery_level || null,
    signal: existing.signal || null,
    event_title: existing.event_title || null,
    quick_take: existing.quick_take || null,
    summary: existing.summary || null,
    key_evidence: existing.key_evidence || [],
    what_to_watch_next: existing.what_to_watch_next || [],
    display_payload: compactParentDisplayPayload(existing.display_payload),
    transaction_fingerprint: readRecord(existing.transaction_fingerprint),
    source_availability_note: "Prior tender history excludes full raw filing text.",
  };
}

function tenderCompanyHistorySearchTerm(value: string) {
  const words = normalizeComparableName(value)
    .split(" ")
    .filter((word) => word.length >= 4 && !TENDER_COMPANY_HISTORY_STOP_WORDS.has(word));
  return words[0] || "";
}

const TENDER_COMPANY_HISTORY_STOP_WORDS = new Set([
  "SHIPPING",
  "TRADING",
  "HOLDINGS",
  "HOLDING",
  "GROUP",
  "CAPITAL",
  "ACQUISITION",
  "INTERNATIONAL",
  "GLOBAL",
  "SOLICITATION",
  "RECOMMENDATION",
  "STATEMENT",
  "SECTION",
  "UNDER",
  "SECURITIES",
  "EXCHANGE",
  "AMENDMENT",
  "1934",
]);

function compactTenderTransactionHistoryEvent(
  event: RawItemRow,
  analysis: Record<string, unknown> | undefined,
  match: TenderTransactionHistoryMatch,
) {
  const metadata = readRecord(event.metadata) || {};
  const fingerprint = readRecord(metadata.transaction_fingerprint);
  const formType = readTenderEventFormType(event);
  const formFamily = normalizeGenericParentFormFamily(formType);

  return {
    match_source: "event_transaction_fingerprint",
    match_score: match.match_score,
    match_confidence: match.match_confidence,
    match_reasons: match.match_reasons,
    event_id: stringValue(event.id) || null,
    raw_item_id: stringValue(event.raw_item_id) || null,
    accession_number:
      stringValue(metadata.accession_number) ||
      stringValue(metadata.accessionNumber) ||
      stringValue(fingerprint?.source_accession) ||
      null,
    form_type: formType || null,
    form_family: formFamily || null,
    filed_at: stringValue(event.published_at) || stringValue(event.detected_at) || null,
    source_url: stringValue(event.source_url) || null,
    company_name: stringValue(metadata.company_name) || stringValue(metadata.companyName) || null,
    ticker: stringValue(event.ticker).toUpperCase() || null,
    cik: normalizeCik(stringValue(metadata.cik)) || null,
    event_type: stringValue(event.event_type) || null,
    score: numberValue(event.score),
    delivery_level: stringValue(event.delivery_level) || null,
    signal: stringValue(event.signal) || null,
    event_title: stringValue(event.event_title) || stringValue(event.title) || null,
    quick_take: stringValue(event.quick_take) || null,
    summary: stringValue(event.summary) || null,
    key_evidence: readStringArray(analysis?.key_evidence).slice(0, 4),
    what_to_watch_next: readStringArray(analysis?.what_to_watch_next).slice(0, 4),
    display_payload: compactParentDisplayPayload(metadata.display_payload),
    transaction_fingerprint: fingerprint,
    source_availability_note: "Prior tender history excludes full raw filing text.",
  };
}

function compactTenderParentContextAsHistoryEvent(parentContext: Record<string, unknown> | null) {
  const parent = readRecord(parentContext?.parent);
  if (!parent) return null;

  return {
    match_source: "parent_filing_context",
    match_method: stringValue(parentContext?.match_method) || null,
    match_score: numberValue(parentContext?.match_score),
    match_reasons: readStringArray(parentContext?.match_reasons).slice(0, 6),
    event_id: stringValue(parent.event_id) || null,
    raw_item_id: stringValue(parent.raw_item_id) || null,
    accession_number: stringValue(parent.accession_number) || null,
    form_type: stringValue(parent.form_type) || null,
    form_family: normalizeGenericParentFormFamily(stringValue(parent.form_type)) || null,
    filed_at: stringValue(parent.filed_at) || null,
    source_url: stringValue(parent.source_url) || null,
    company_name: stringValue(parent.company_name) || null,
    ticker: stringValue(parent.ticker).toUpperCase() || null,
    cik: normalizeCik(stringValue(parent.cik)) || null,
    event_type: stringValue(parent.event_type) || null,
    score: numberValue(parent.score),
    delivery_level: stringValue(parent.delivery_level) || null,
    signal: stringValue(parent.signal) || null,
    event_title: stringValue(parent.event_title) || null,
    quick_take: stringValue(parent.quick_take) || null,
    summary: stringValue(parent.summary) || null,
    key_evidence: readStringArray(parent.key_evidence).slice(0, 4),
    what_to_watch_next: readStringArray(parent.what_to_watch_next).slice(0, 4),
    display_payload: compactParentDisplayPayload(parent.display_payload),
    transaction_fingerprint: readRecord(parent.transaction_fingerprint),
    source_availability_note:
      stringValue(parent.source_availability_note) || "Prior tender history excludes full raw filing text.",
  };
}

function dedupeTenderHistoryRecords(items: Array<Record<string, unknown> | null>) {
  const seen = new Set<string>();
  const result: Record<string, unknown>[] = [];

  for (const item of items) {
    if (!item) continue;
    const key =
      stringValue(item.accession_number) ||
      stringValue(item.event_id) ||
      stringValue(item.raw_item_id) ||
      `${stringValue(item.form_type)}:${stringValue(item.filed_at)}:${stringValue(item.ticker)}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }

  return result;
}

function readTenderEventFormType(event: RawItemRow) {
  const metadata = readRecord(event.metadata) || {};
  const fingerprint = readRecord(metadata.transaction_fingerprint);
  return (
    stringValue(metadata.form_type) ||
    stringValue(metadata.formType) ||
    readStringArray(fingerprint?.source_forms)[0] ||
    stringValue(fingerprint?.source_form)
  );
}

function readTenderEventFormFamily(event: RawItemRow) {
  return normalizeGenericParentFormFamily(readTenderEventFormType(event));
}

async function fetchS8RegistrationFileNumberCandidateRows(fileNumbers: string[]) {
  const select = "id,source_unique_id,source_url,title,published_at,body_text,analysis_text,raw_payload,metadata";
  const rows: RawItemRow[] = [];

  for (const fileNumber of uniqueStrings(fileNumbers).slice(0, 5)) {
    const rawPayloadResult = await supabaseSelect("raw_items", {
      select,
      source_code: "eq.sec_edgar",
      "raw_payload->>file_number": `eq.${fileNumber}`,
      order: "published_at.desc",
      limit: "100",
    });
    if (rawPayloadResult.ok && Array.isArray(rawPayloadResult.data)) {
      rows.push(...(rawPayloadResult.data as RawItemRow[]));
    }

    const bodyResult = await supabaseSelect("raw_items", {
      select,
      source_code: "eq.sec_edgar",
      body_text: `ilike.*${fileNumber}*`,
      order: "published_at.desc",
      limit: "100",
    });
    if (bodyResult.ok && Array.isArray(bodyResult.data)) {
      rows.push(...(bodyResult.data as RawItemRow[]));
    }

    const analysisResult = await supabaseSelect("raw_items", {
      select,
      source_code: "eq.sec_edgar",
      analysis_text: `ilike.*${fileNumber}*`,
      order: "published_at.desc",
      limit: "100",
    });
    if (analysisResult.ok && Array.isArray(analysisResult.data)) {
      rows.push(...(analysisResult.data as RawItemRow[]));
    }
  }

  return dedupeRawRows(rows);
}

async function buildCurrentReportParentContext({
  matchMethod,
  matchReasons,
  matchScore,
  parserOutput,
  row,
}: {
  matchMethod: string;
  matchReasons: string[];
  matchScore: number;
  parserOutput: Record<string, unknown>;
  row: RawItemRow;
}) {
  const rawPayload = readRecord(row.raw_payload) || {};
  const metadata = readRecord(row.metadata) || {};
  const existing = await fetchExistingCurrentReportEventContext(stringValue(row.id));
  const displayPayload = compactParentDisplayPayload(existing?.display_payload);
  const displayData = readRecord(displayPayload?.data);
  const selectedSourceSnippets = readStringArray(displayData?.selected_source_snippets).slice(0, 8);
  const attachmentInventory = readRecordArray(displayData?.attachment_inventory).slice(0, 12);
  const selectedTables = readRecordArray(displayData?.selected_tables).slice(0, 5);

  return {
    source: "raw_items_events_compact",
    context_kind: "current_report_parent_filing",
    match_method: matchMethod,
    match_score: matchScore,
    match_reasons: matchReasons.slice(0, 8),
    current_amendment: {
      accession_number: readRawAccessionFromParser(parserOutput),
      form_type: stringValue(readRecord(parserOutput.facts)?.secFormType) || null,
    },
    raw_item_id: stringValue(row.id) || null,
    accession_number: readRawAccession(row) || null,
    form_type: readRawFormType(row) || null,
    filed_at: stringValue(row.published_at) || stringValue(rawPayload.filing_date) || null,
    source_url: stringValue(row.source_url) || stringValue(rawPayload.detail_url) || null,
    company_name: stringValue(rawPayload.company_name) || stringValue(metadata.company_name) || null,
    ticker: readRawTicker(row) || null,
    event_id: existing?.event_id || null,
    event_type: existing?.event_type || null,
    score: existing?.score ?? null,
    delivery_level: existing?.delivery_level || null,
    signal: existing?.signal || null,
    event_title: existing?.event_title || null,
    quick_take: existing?.quick_take || null,
    summary: existing?.summary || null,
    key_evidence: existing?.key_evidence || [],
    display_payload: displayPayload,
    selected_source_snippets: selectedSourceSnippets,
    selected_tables: selectedTables,
    attachment_inventory: attachmentInventory.length ? attachmentInventory : compactRawDocumentInventory(rawPayload).slice(0, 12),
    source_blocks: buildCurrentReportLifecycleSourceBlocks(row, parserOutput),
    source_availability_note:
      displayData?.source_availability_note ||
      "Relevant original source blocks are attached separately for amendment comparison.",
  };
}

async function buildGenericAmendmentParentContext({
  status,
  confidence,
  matchMethod,
  matchScore,
  matchReasons,
  rawItem,
  parentRow,
  candidateRows,
}: {
  status: "found" | "not_found" | "multiple_candidates";
  confidence: "high" | "medium" | "low";
  matchMethod: string;
  matchScore: number;
  matchReasons: string[];
  rawItem: RawItemRow;
  parentRow: RawItemRow | null;
  candidateRows: RawItemRow[];
}) {
  const parent = parentRow ? await compactGenericParentRow(parentRow) : null;
  const candidates = await Promise.all(candidateRows.slice(0, 5).map(compactGenericParentCandidateRow));

  return {
    status,
    context_kind: "amendment_parent_filing",
    source: "raw_items_events_compact",
    match_method: matchMethod,
    match_score: matchScore,
    match_reasons: matchReasons.slice(0, 8),
    confidence,
    candidate_count: candidateRows.length,
    parent_selected: Boolean(parent),
    current_amendment: {
      accession_number: readRawAccession(rawItem) || null,
      form_type: readRawFormType(rawItem) || null,
      filed_at: stringValue(rawItem.published_at) || readRawFiledDate(rawItem) || null,
      source_url: stringValue(rawItem.source_url) || null,
      company_name: readRawCompanyName(rawItem) || null,
      ticker: readRawTicker(rawItem) || null,
      cik: normalizeCik(readRawCik(rawItem)) || null,
    },
    parent,
    candidates,
    source_notes: [
      "parent_filing_context is built by integration from persisted raw_items, events, and event_analysis.",
      "Historical full raw filing text is excluded; use compact prior analysis, key evidence, display_payload, transaction_fingerprint, snippets, and inventory only.",
      "If multiple parent candidates exist, integration does not fully analyze every candidate or force-select one.",
      "If status is not_found or multiple_candidates, analysis should treat parent comparison as limited and avoid inventing amendment deltas.",
    ],
  };
}

async function compactGenericParentRow(row: RawItemRow) {
  const rawPayload = readRecord(row.raw_payload) || {};
  const metadata = readRecord(row.metadata) || {};
  const existing = await fetchExistingGenericParentEventContext(stringValue(row.id));
  const displayPayload = compactParentDisplayPayload(existing?.display_payload);
  const displayData = readRecord(displayPayload?.data);
  const selectedSourceSnippets = readStringArray(displayData?.selected_source_snippets).slice(0, 8);
  const attachmentInventory = readRecordArray(displayData?.attachment_inventory).slice(0, 12);
  const selectedTables = readRecordArray(displayData?.selected_tables).slice(0, 5);

  return {
    raw_item_id: stringValue(row.id) || null,
    event_id: existing?.event_id || null,
    accession_number: readRawAccession(row) || null,
    form_type: readRawFormType(row) || null,
    filed_at: stringValue(row.published_at) || stringValue(rawPayload.filing_date) || null,
    source_url: stringValue(row.source_url) || stringValue(rawPayload.detail_url) || null,
    company_name: readRawCompanyName(row) || stringValue(metadata.company_name) || null,
    ticker: readRawTicker(row) || null,
    cik: normalizeCik(readRawCik(row)) || null,
    event_type: existing?.event_type || null,
    score: existing?.score ?? null,
    delivery_level: existing?.delivery_level || null,
    signal: existing?.signal || null,
    event_title: existing?.event_title || null,
    quick_take: existing?.quick_take || null,
    summary: existing?.summary || null,
    key_evidence: existing?.key_evidence || [],
    what_to_watch_next: existing?.what_to_watch_next || [],
    display_payload: displayPayload,
    transaction_fingerprint: existing?.transaction_fingerprint || null,
    sc13_facts: compactSc13ParentFactsFromRawRow(row),
    selected_source_snippets: selectedSourceSnippets,
    selected_tables: selectedTables,
    attachment_inventory: attachmentInventory.length ? attachmentInventory : compactRawDocumentInventory(rawPayload).slice(0, 12),
    source_availability_note: displayData?.source_availability_note || "Parent context excludes full raw filing text.",
  };
}

async function compactGenericParentCandidateRow(row: RawItemRow) {
  const existing = await fetchExistingGenericParentEventContext(stringValue(row.id));
  return {
    raw_item_id: stringValue(row.id) || null,
    event_id: existing?.event_id || null,
    accession_number: readRawAccession(row) || null,
    form_type: readRawFormType(row) || null,
    filed_at: stringValue(row.published_at) || readRawFiledDate(row) || null,
    company_name: readRawCompanyName(row) || null,
    ticker: readRawTicker(row) || null,
    cik: normalizeCik(readRawCik(row)) || null,
    event_type: existing?.event_type || null,
    score: existing?.score ?? null,
    delivery_level: existing?.delivery_level || null,
    quick_take: existing?.quick_take || null,
    transaction_fingerprint: existing?.transaction_fingerprint || null,
    sc13_facts: compactSc13ParentFactsFromRawRow(row),
  };
}

function compactSc13ParentFactsFromRawRow(row: RawItemRow) {
  if (!isSc13ParentContextFamily(normalizeGenericParentFormFamily(readRawFormType(row)))) return null;
  try {
    const parserOutput = parseSc13Filing(rawRowToSc13ParseInput(row));
    const facts = parserOutput.facts;
    return {
      schedule_type: facts.scheduleType,
      is_amendment: facts.isAmendment,
      amendment_number: facts.amendmentNumber,
      event_date: facts.eventDate,
      reporting_persons: facts.reportingPersons.slice(0, 12),
      cusip: facts.cusip,
      security_class: facts.securityClass,
      shares_beneficially_owned: facts.sharesBeneficiallyOwned,
      percent_owned: facts.percentOwned,
      voting_power: facts.votingPower,
      dispositive_power: facts.dispositivePower,
    };
  } catch {
    return null;
  }
}

async function fetchExistingGenericParentEventContext(rawItemId: string) {
  if (!rawItemId) return null;

  const eventResult = await supabaseSelect("events", {
    select: "*",
    source_group: "eq.filings",
    raw_item_id: `eq.${rawItemId}`,
    order: "detected_at.desc",
    limit: "1",
  });
  const event = eventResult.ok && Array.isArray(eventResult.data) ? readRecord(eventResult.data[0]) : null;
  if (!event) return null;

  const analysisResult = await supabaseSelect("event_analysis", {
    select: "*",
    event_id: `eq.${stringValue(event.id)}`,
    limit: "1",
  });
  const analysis = analysisResult.ok && Array.isArray(analysisResult.data) ? readRecord(analysisResult.data[0]) : null;
  const metadata = readRecord(event.metadata) || {};
  const analysisOutput = readRecord(analysis?.analysis_output) || {};
  const primaryTicker = readRecord(analysisOutput.primary_ticker) || readRecord(metadata.primary_ticker) || {};
  const displayPayload = readRecord(metadata.display_payload);
  const displayData = readRecord(displayPayload?.data);
  const marketContext = readRecord(metadata.market_context) || readRecord(analysisOutput.market_context) || {};

  return {
    event_id: stringValue(event.id) || null,
    ticker:
      (
        stringValue(event.ticker) ||
        stringValue(primaryTicker.ticker) ||
        stringValue(primaryTicker.symbol) ||
        stringValue(displayData?.ticker) ||
        stringValue(marketContext.ticker)
      ).toUpperCase() || null,
    exchange:
      stringValue(event.exchange) ||
      stringValue(primaryTicker.exchange) ||
      stringValue(displayData?.exchange) ||
      stringValue(marketContext.exchange) ||
      null,
    event_type: stringValue(event.event_type) || null,
    score: numberValue(event.score),
    delivery_level: stringValue(event.delivery_level) || null,
    signal: stringValue(event.signal) || null,
    event_title: stringValue(event.event_title) || stringValue(event.title) || null,
    quick_take: stringValue(event.quick_take) || stringValue(analysis?.quick_take) || null,
    summary: stringValue(event.summary) || stringValue(analysis?.summary) || null,
    key_evidence: readStringArray(analysis?.key_evidence).slice(0, 6),
    what_to_watch_next: readStringArray(analysis?.what_to_watch_next).slice(0, 6),
    display_payload: displayPayload,
    removal_reason_context: extractRelatedRemovalReasonContext(analysisOutput, metadata, displayPayload),
    transaction_fingerprint: readRecord(metadata.transaction_fingerprint),
  };
}

async function fetchExistingCurrentReportEventContext(rawItemId: string) {
  if (!rawItemId) return null;

  const eventResult = await supabaseSelect("events", {
    select: "*",
    source_group: "eq.filings",
    raw_item_id: `eq.${rawItemId}`,
    order: "detected_at.desc",
    limit: "1",
  });
  const event = eventResult.ok && Array.isArray(eventResult.data) ? readRecord(eventResult.data[0]) : null;
  if (!event) return null;

  const analysisResult = await supabaseSelect("event_analysis", {
    select: "*",
    event_id: `eq.${stringValue(event.id)}`,
    limit: "1",
  });
  const analysis = analysisResult.ok && Array.isArray(analysisResult.data) ? readRecord(analysisResult.data[0]) : null;
  const metadata = readRecord(event.metadata) || {};

  return {
    event_id: stringValue(event.id) || null,
    event_type: stringValue(event.event_type) || null,
    score: numberValue(event.score),
    delivery_level: stringValue(event.delivery_level) || null,
    signal: stringValue(event.signal) || null,
    event_title: stringValue(event.event_title) || stringValue(event.title) || null,
    quick_take: stringValue(event.quick_take) || stringValue(analysis?.quick_take) || null,
    summary: stringValue(event.summary) || stringValue(analysis?.summary) || null,
    key_evidence: readStringArray(analysis?.key_evidence).slice(0, 6),
    display_payload: readRecord(metadata.display_payload),
  };
}

function readCurrentReportParserOutput(input: SecFilingAnalysisInput) {
  const filingPackage = readRecord(input.filing_package);
  const hardParsers = readRecord(filingPackage?.hard_parsers);
  return readRecord(hardParsers?.["8k-6k"]);
}

function isCurrentReportParentCandidate(row: RawItemRow) {
  const formType = readRawFormType(row);
  return normalizeCurrentReportFamily(formType) !== null;
}

function normalizeCurrentReportFamily(formType: string) {
  const normalized = formType.toUpperCase().replace(/\s+/g, "");
  if (normalized === "8-K" || normalized === "8-K/A") return "8-K";
  if (normalized === "6-K" || normalized === "6-K/A") return "6-K";
  return null;
}

function isCurrentReportAmendmentForm(formType: string) {
  const normalized = formType.toUpperCase().replace(/\s+/g, "");
  return normalized === "8-K/A" || normalized === "6-K/A";
}

function isSecAmendmentFormForParentContext(formType: string) {
  const normalized = normalizeSecFormForParentContext(formType);
  return normalized.endsWith("/A") || normalized === "S-8 POS";
}

function isS3F3RegistrationFamilyForm(formType: string) {
  const normalized = normalizeSecFormForParentContext(formType).replace(/\s+/g, "");
  return /^(?:S-3|S-3ASR|S-3MEF|S-3\/A|F-3|F-3ASR|F-3MEF|F-3\/A)$/.test(normalized);
}

function isS3F3RegistrationAmendmentForm(formType: string) {
  const normalized = normalizeSecFormForParentContext(formType).replace(/\s+/g, "");
  return normalized === "S-3/A" || normalized === "F-3/A";
}

function normalizeGenericParentFormFamily(formType: string) {
  const normalized = normalizeSecFormForParentContext(formType);
  if (!normalized) return "";
  if (normalized === "S-8 POS") return "S-8";
  return normalized.replace(/\/A$/, "");
}

function normalizeSecFormForParentContext(formType: string) {
  return stringValue(formType)
    .toUpperCase()
    .replace(/^FORM\s+/, "")
    .replace(/^SCHEDULE\s+/, "SC ")
    .replace(/^SC\s+13E-3/, "SC 13E3")
    .replace(/\s*\/\s*A$/, "/A")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCompanyNameForParentMatch(value: string) {
  return stringValue(value)
    .toUpperCase()
    .replace(/&AMP;/g, "&")
    .replace(/\b(?:INCORPORATED|INC|CORPORATION|CORP|COMPANY|CO|LTD|LIMITED|PLC|S\.?A\.?|N\.?V\.?)\b\.?/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractExplicitParentAccessionForAmendment(input: SecFilingAnalysisInput, rawItem: RawItemRow) {
  const currentAccession = readRawAccession(rawItem);
  const filingPackage = readRecord(input.filing_package) || {};
  const hardParsers = readRecord(filingPackage.hard_parsers) || {};
  const parserText = Object.values(hardParsers)
    .map((item) => JSON.stringify(readRecord(item) || {}))
    .join("\n")
    .slice(0, 80_000);
  const rawPayload = readRecord(rawItem.raw_payload) || {};
  const metadata = readRecord(rawItem.metadata) || {};
  const text = [
    rawItem.title,
    rawItem.analysis_text,
    rawPayload.previous_accession_number,
    rawPayload.parent_accession_number,
    rawPayload.parentAccessionNumber,
    metadata.previous_accession_number,
    metadata.parent_accession_number,
    metadata.parentAccessionNumber,
    parserText,
  ]
    .map(stringValue)
    .filter(Boolean)
    .join("\n")
    .slice(0, 180_000);

  const accessions = uniqueStrings([...text.matchAll(/\b\d{10}-\d{2}-\d{6}\b/g)].map((match) => match[0]));
  return accessions.find((accession) => accession !== currentAccession) || "";
}

function extractExplicitParentAccessionFromRawItem(rawItem: RawItemRow) {
  const currentAccession = readRawAccession(rawItem);
  const rawPayload = readRecord(rawItem.raw_payload) || {};
  const metadata = readRecord(rawItem.metadata) || {};
  const text = [
    rawItem.title,
    rawItem.analysis_text,
    rawPayload.previous_accession_number,
    rawPayload.previousAccessionNumber,
    rawPayload.parent_accession_number,
    rawPayload.parentAccessionNumber,
    metadata.previous_accession_number,
    metadata.previousAccessionNumber,
    metadata.parent_accession_number,
    metadata.parentAccessionNumber,
  ]
    .map(stringValue)
    .filter(Boolean)
    .join("\n")
    .slice(0, 80_000);
  const accessions = uniqueStrings([...text.matchAll(/\b\d{10}-\d{2}-\d{6}\b/g)].map((match) => match[0]));
  return accessions.find((accession) => accession !== currentAccession) || "";
}

function readCurrentReportItemNumbers(parserOutput: Record<string, unknown>) {
  const facts = readRecord(parserOutput.facts);
  return readRecordArray(facts?.items)
    .map((item) => stringValue(item.item))
    .filter(Boolean)
    .slice(0, 12);
}

function readCurrentReportExhibitNumbers(parserOutput: Record<string, unknown>) {
  const facts = readRecord(parserOutput.facts);
  const extracted = readRecord(facts?.extracted);
  const exhibitFacts = readRecord(extracted?.exhibitFacts);
  return [
    ...readRecordArray(exhibitFacts?.referencedExhibits).map((item) => stringValue(item.exhibitNumber)),
    ...readRecordArray(exhibitFacts?.documentExhibits).map((item) => stringValue(item.exhibitNumber)),
  ]
    .filter(Boolean)
    .slice(0, 20);
}

function countCurrentReportTextOverlap(row: RawItemRow, needles: string[]) {
  if (!needles.length) return 0;
  const text = normalizeForCurrentReportMatch(
    [
      row.title,
      row.analysis_text,
      ...readRecordArray(readRecord(row.raw_payload)?.documents).flatMap((document) => [
        document.type,
        document.description,
        document.filename,
      ]),
    ]
      .map(stringValue)
      .filter(Boolean)
      .join(" "),
  );
  return needles.filter((needle) => text.includes(normalizeForCurrentReportMatch(needle))).length;
}

function compactParentDisplayPayload(value: unknown) {
  const displayPayload = readRecord(value);
  if (!displayPayload) return null;

  return {
    display_type: stringValue(displayPayload.display_type) || "generic",
    data: compactParentDisplayPayloadData(readRecord(displayPayload.data) || {}),
    evidence: readStringArray(displayPayload.evidence).slice(0, 6),
    notes: readStringArray(displayPayload.notes).slice(0, 6),
  };
}

function compactParentDisplayPayloadData(data: Record<string, unknown>) {
  const compact: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === "selected_source_snippets") {
      compact[key] = readStringArray(value).slice(0, 8);
    } else if (key === "attachment_inventory") {
      compact[key] = readRecordArray(value).map(compactSourceInventoryRecord).slice(0, 12);
    } else if (key === "selected_tables") {
      compact[key] = readRecordArray(value).slice(0, 5);
    } else if (typeof value === "string") {
      compact[key] = truncateCompactContextText(value, 800);
    } else {
      compact[key] = value;
    }
  }
  return compact;
}

function compactRawDocumentInventory(rawPayload: Record<string, unknown>) {
  return readRecordArray(rawPayload.documents).map(compactSourceInventoryRecord);
}

function compactSourceInventoryRecord(item: Record<string, unknown>) {
  return {
    exhibitNumber: stringValue(item.exhibitNumber) || null,
    type: stringValue(item.type) || null,
    description: truncateCompactContextText(stringValue(item.description), 240) || null,
    filename: stringValue(item.filename) || null,
    textAvailable:
      typeof item.textAvailable === "boolean"
        ? item.textAvailable
        : typeof item.text_char_count === "number" || typeof item.textCharCount === "number",
    textCharCount: numberValue(item.textCharCount) ?? numberValue(item.text_char_count),
    textTruncated: item.textTruncated === true || item.text_truncated === true,
  };
}

function dedupeRawRows(rows: RawItemRow[]) {
  const seen = new Set<string>();
  const deduped: RawItemRow[] = [];
  for (const row of rows) {
    const key = stringValue(row.id) || readRawAccession(row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
}

function readRawAccessionFromParser(parserOutput: Record<string, unknown>) {
  return stringValue(parserOutput.accessionNumber) || stringValue(parserOutput.accession_number);
}

function readS8PriorRegistrationFileNumbers(input: SecFilingAnalysisInput) {
  const filingPackage = readRecord(input.filing_package);
  const hardParsers = readRecord(filingPackage?.hard_parsers);
  const s8 = readRecord(hardParsers?.s8);
  const facts = readRecord(s8?.facts);
  const statements = readRecordArray(facts?.priorRegistrationStatements);
  return uniqueStrings(
    statements
      .map((statement) => normalizeS8RegistrationFileNumber(stringValue(statement.fileNumber)))
      .filter(Boolean),
  );
}

function extractS8RegistrationFileNumbersFromRow(row: RawItemRow) {
  const rawPayload = readRecord(row.raw_payload) || {};
  const text = [
    stringValue(rawPayload.file_number),
    stringValue(rawPayload.fileNumber),
    stringValue(rawPayload.primary_document_html),
    stringValue(row.body_text),
    stringValue(row.analysis_text),
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 250_000);
  const matches = text.match(/\b333-\d{3,}\b/g) || [];
  return uniqueStrings(matches.map(normalizeS8RegistrationFileNumber).filter(Boolean));
}

function intersectStrings(left: string[], right: string[]) {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
}

function normalizeComparableName(value: string) {
  return stringValue(value)
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\b(?:THE|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LLC|L L C|LTD|LIMITED|LP|L P|PLC|AG|SA|N V)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeS8RegistrationFileNumber(value: string) {
  const match = stringValue(value).match(/333-\d+/i);
  return match ? match[0].toUpperCase() : "";
}

function readRawCik(row: RawItemRow) {
  const rawPayload = readRecord(row.raw_payload);
  const metadata = readRecord(row.metadata);
  return stringValue(rawPayload?.cik) || stringValue(metadata?.cik);
}

function readRawFiledDate(row: RawItemRow) {
  const rawPayload = readRecord(row.raw_payload);
  return stringValue(rawPayload?.filing_date) || stringValue(row.published_at);
}

function normalizeDateOnly(value: string) {
  if (!value) return "";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "";
  return new Date(parsed).toISOString().slice(0, 10);
}

function isSameUtcCalendarDay(leftTime: number, rightTime: number) {
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return false;
  return new Date(leftTime).toISOString().slice(0, 10) === new Date(rightTime).toISOString().slice(0, 10);
}

function normalizeForCurrentReportMatch(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function readRecordArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function truncateCompactContextText(value: string, maxChars: number) {
  const text = stringValue(value).replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > maxChars ? `${text.slice(0, maxChars - 3).trim()}...` : text;
}

function rawRowToS3ParseInput(row: RawItemRow) {
  return {
    rawItemId: stringValue(row.id),
    sourceUniqueId: stringValue(row.source_unique_id),
    sourceUrl: stringValue(row.source_url),
    title: stringValue(row.title),
    publishedAt: stringValue(row.published_at),
    bodyText: stringValue(row.body_text),
    analysisText: stringValue(row.analysis_text),
    rawPayload: row.raw_payload,
    metadata: row.metadata,
  };
}

function sameRegistrationNumber(left: string | null | undefined, right: string | null | undefined) {
  const normalize = (value: string | null | undefined) => stringValue(value).replace(/\D/g, "");
  const leftValue = normalize(left);
  const rightValue = normalize(right);
  return Boolean(leftValue && rightValue && leftValue === rightValue);
}

function readRawItemResult(result: { ok: boolean; status: number; error?: string; data: unknown }, lookupLabel = "requested SEC raw item") {
  const row = Array.isArray(result.data) ? (result.data[0] as RawItemRow | undefined) : null;
  const lookupError = stringValue(result.error);
  const usefulLookupError = lookupError && lookupError !== "<none>" ? lookupError : "";
  const error = result.ok
    ? row
      ? undefined
      : `SEC raw item not found for ${lookupLabel}. Ingest raw first, then run this test.`
    : usefulLookupError || `SEC raw item lookup failed for ${lookupLabel} (status ${result.status || "unknown"}).`;
  return {
    ok: result.ok && Boolean(row),
    status: result.status,
    rawItem: row || null,
    error,
  };
}

function summarizeRawRow(row: RawItemRow) {
  const rawPayload = readRecord(row.raw_payload) || {};
  return {
    id: stringValue(row.id),
    source_code: stringValue(row.source_code),
    source_group: stringValue(row.source_group),
    source_url: stringValue(row.source_url),
    source_unique_id: stringValue(row.source_unique_id),
    title: stringValue(row.title),
    published_at: stringValue(row.published_at),
    form_type: stringValue(rawPayload.form_type),
    company_name: stringValue(rawPayload.company_name),
    ticker: stringValue(rawPayload.ticker),
    exchange: stringValue(rawPayload.exchange),
    bodyChars: stringValue(row.body_text).length,
    analysisChars: stringValue(row.analysis_text).length,
  };
}

function hasCalendarCandidateText(row: RawItemRow) {
  const text = `${row.title || ""}\n${row.analysis_text || ""}\n${row.body_text || ""}`.toLowerCase();
  return [
    "earnings call",
    "conference call",
    "webcast",
    "annual meeting",
    "special meeting",
    "record date",
    "payment date",
    "ex-dividend",
    "expiration date",
    "will be held",
    "expected to close",
    "effective date",
    "nasdaq hearing",
    "pdufa",
  ].some((term) => text.includes(term));
}

function readRawTicker(row: RawItemRow) {
  const rawPayload = readRecord(row.raw_payload);
  const metadata = readRecord(row.metadata);
  return (stringValue(rawPayload?.ticker) || stringValue(metadata?.ticker)).toUpperCase();
}

function readRawCompanyName(row: RawItemRow) {
  const rawPayload = readRecord(row.raw_payload);
  const metadata = readRecord(row.metadata);
  return (
    stringValue(rawPayload?.company_name) ||
    stringValue(rawPayload?.companyName) ||
    stringValue(metadata?.company_name) ||
    stringValue(metadata?.companyName) ||
    stringValue(metadata?.issuer)
  );
}

function readRawAccession(row: RawItemRow) {
  const rawPayload = readRecord(row.raw_payload);
  return stringValue(rawPayload?.accession_number) || stringValue(row.source_unique_id);
}

function readRawFormType(row: RawItemRow) {
  const rawPayload = readRecord(row.raw_payload);
  const metadata = readRecord(row.metadata);
  const storedFormType = stringValue(rawPayload?.form_type) || stringValue(metadata?.form_type);
  const documents = readRecordArray(rawPayload?.documents);
  const primaryDocumentType =
    stringValue(documents.find((document) => Boolean(document.isPrimary))?.type) ||
    stringValue(documents[0]?.type);
  return chooseRawRowFormType(storedFormType, primaryDocumentType);
}

function chooseRawRowFormType(storedFormType: string, primaryDocumentType: string) {
  const stored = normalizeRawRowFormType(storedFormType);
  const primary = normalizeRawRowFormType(primaryDocumentType);
  if (!stored) return primary;
  if (!primary) return stored;
  if (stored === primary) return stored;

  const storedBase = stored.replace(/\/A$/, "");
  const primaryBase = primary.replace(/\/A$/, "");
  if (primary.endsWith("/A") && storedBase === primaryBase) {
    return primary;
  }

  return stored;
}

function normalizeRawRowFormType(value: unknown) {
  return stringValue(value).toUpperCase().replace(/\s+/g, " ");
}

function readResponseOutputText(body: OpenAIResponseBody | null) {
  if (!body) return "";
  if (typeof body.output_text === "string") return body.output_text;

  for (const item of body.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") return content.text;
    }
  }

  return "";
}

function combineUsage(...items: Array<OpenAIUsage | null | undefined>): OpenAIUsage | null {
  const usages = items.filter((item): item is OpenAIUsage => Boolean(item));
  if (!usages.length) return null;

  return {
    input_tokens: usages.reduce((sum, item) => sum + finiteNumber(item.input_tokens), 0),
    output_tokens: usages.reduce((sum, item) => sum + finiteNumber(item.output_tokens), 0),
    total_tokens: usages.reduce((sum, item) => sum + finiteNumber(item.total_tokens), 0),
    input_tokens_details: {
      cached_tokens: usages.reduce((sum, item) => sum + finiteNumber(item.input_tokens_details?.cached_tokens), 0),
    },
    output_tokens_details: {
      reasoning_tokens: usages.reduce((sum, item) => sum + finiteNumber(item.output_tokens_details?.reasoning_tokens), 0),
    },
  };
}

function estimateCost(model: string, usage: OpenAIUsage | null): CostEstimate | null {
  const pricing = getPricing(model);
  if (!pricing || !usage) return null;

  const inputTokens = finiteNumber(usage.input_tokens);
  const outputTokens = finiteNumber(usage.output_tokens);
  const cachedInputTokens = Math.min(inputTokens, finiteNumber(usage.input_tokens_details?.cached_tokens));
  const billedInputTokens = Math.max(0, inputTokens - cachedInputTokens);
  const estimatedUsd =
    (billedInputTokens * pricing.inputUsdPerMillion +
      cachedInputTokens * pricing.cachedInputUsdPerMillion +
      outputTokens * pricing.outputUsdPerMillion) /
    1_000_000;

  return {
    model,
    currency: "USD",
    estimatedUsd: Number(estimatedUsd.toFixed(8)),
    inputTokens,
    cachedInputTokens,
    billedInputTokens,
    outputTokens,
    inputUsdPerMillion: pricing.inputUsdPerMillion,
    cachedInputUsdPerMillion: pricing.cachedInputUsdPerMillion,
    outputUsdPerMillion: pricing.outputUsdPerMillion,
    pricing: pricing.label,
  };
}

function getPricing(model: string) {
  const normalized = model.trim().toLowerCase();
  if (normalized === "gpt-5-mini") {
    return {
      inputUsdPerMillion: 0.25,
      cachedInputUsdPerMillion: 0.025,
      outputUsdPerMillion: 2,
      label: "OpenAI API pricing for gpt-5-mini checked 2026-05-17",
    };
  }

  return null;
}

function parseAnalysisJson(value: string) {
  if (!value) return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    const extracted = extractJsonObject(value);
    if (!extracted) return null;
    try {
      return JSON.parse(extracted) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function extractJsonObject(value: string) {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fenced?.startsWith("{") && fenced.endsWith("}")) return fenced;

  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end <= start) return "";
  return value.slice(start, end + 1);
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function summarizeSecLlmRun(run: OpenAiPromptRun) {
  return {
    provider: run.provider,
    final_model: run.model,
    attempts: run.attempts,
    error: run.error || null,
  };
}

function readSec8k6kDisplayWarnings(analysis: Record<string, unknown>) {
  const displayPayload = readRecord(analysis.display_payload);
  const data = readRecord(displayPayload?.data);
  return readStringArray(data?.display_warnings);
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(stringValue).filter(Boolean);
}

function readFieldValueArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const record = readRecord(item);
      return stringValue(record?.value) || stringValue(item);
    })
    .filter(Boolean);
}

/* Form 25 lifecycle analysis helpers integrated from the dedicated SEC room. */
function isForm25FilingInput(input: SecFilingAnalysisInput) {
  return Boolean(readForm25ParserOutput(input));
}

function buildSecForm25AnalysisPromptForInput(input: SecFilingAnalysisInput): OpenAiPrompt {
  const parserOutput = readForm25ParserOutput(input);
  if (!parserOutput) {
    throw new Error("SEC Form 25 parser output is missing from filing package");
  }
  const filingPackage = readRecord(input.filing_package);
  const marketContext = readRecord(filingPackage?.market_context);
  const relatedFilingContext = readRecord(filingPackage?.form25_related_filing_context);

  return buildSecForm25AnalysisPromptDraft({
    parser_output: parserOutput as unknown as SecForm25ParserOutput,
    market_context: marketContext,
    related_filing_context: relatedFilingContext,
  });
}

async function attachForm25IssuerRelatedContext(input: SecFilingAnalysisInput, rawItem: RawItemRow) {
  const filingPackage = readRecord(input.filing_package);
  if (!filingPackage || readRecord(filingPackage.form25_related_filing_context)) return;

  const parserOutput = readForm25ParserOutput(input);
  if (!parserOutput) return;

  const subjectCik = normalizeCik(readForm25FactValue(parserOutput, "subject_company_cik"));
  const issuerName = readForm25FactValue(parserOutput, "issuer_name");
  if (!subjectCik && !issuerName) return;

  const relatedContext = await buildForm25IssuerRelatedContext({
    subjectCik,
    issuerName,
    currentAccession: readRawAccession(rawItem),
    currentRawItemId: stringValue(rawItem.id),
    currentFiledAt: stringValue(rawItem.published_at) || readRawFiledDate(rawItem),
  });

  if (relatedContext) {
    filingPackage.form25_related_filing_context = relatedContext;
  }
}

async function buildForm25IssuerRelatedContext({
  subjectCik,
  issuerName,
  currentAccession,
  currentRawItemId,
  currentFiledAt,
}: {
  subjectCik: string;
  issuerName: string;
  currentAccession: string;
  currentRawItemId: string;
  currentFiledAt: string;
}) {
  const rows = await fetchForm25IssuerRelatedRows(subjectCik, issuerName);
  const currentFiledAtMs = Date.parse(currentFiledAt);
  const scored = uniqueRawRows(rows)
    .filter((row) => readRawAccession(row) !== currentAccession)
    .filter((row) => stringValue(row.id) !== currentRawItemId)
    .map((row) => ({
      row,
      score: scoreForm25RelatedRow(row, currentFiledAtMs, subjectCik, issuerName),
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return Date.parse(stringValue(right.row.published_at)) - Date.parse(stringValue(left.row.published_at));
    });

  const compactedCandidates = await Promise.all(
    scored.slice(0, 24).map(({ row, score }) => compactForm25IssuerRelatedRow(row, score)),
  );
  const selected = compactedCandidates
    .sort((left, right) => {
      const analyzedDifference = Number(Boolean(right.event_id)) - Number(Boolean(left.event_id));
      if (analyzedDifference !== 0) return analyzedDifference;
      return Number(right.match_score || 0) - Number(left.match_score || 0);
    })
    .slice(0, 8);
  if (!selected.length) return null;

  return {
    context_kind: "form25_subject_company_related_filings",
    subject_company_cik: subjectCik || null,
    subject_company_name: issuerName || null,
    source: "persisted_sec_raw_items_and_existing_analysis",
    candidate_count: scored.length,
    selected_filings: selected,
    source_notes: [
      "Related filing context is selected from persisted SEC raw items by subject-company CIK and company-name references.",
      "This context is evidence for the LLM only; code does not classify the Form 25 outcome.",
      "Full raw filing text is excluded; snippets and existing analysis summaries are compacted.",
    ],
  };
}

async function fetchForm25IssuerRelatedRows(subjectCik: string, issuerName: string) {
  const select = "id,source_unique_id,source_url,title,published_at,body_text,analysis_text,raw_payload,metadata";
  const rows: RawItemRow[] = [];
  const cikCandidates = subjectCik ? uniqueStrings([subjectCik, subjectCik.padStart(10, "0")]) : [];

  for (const cik of cikCandidates) {
    const byPayloadCik = await supabaseSelect("raw_items", {
      select,
      "raw_payload->>cik": `eq.${cik}`,
      order: "published_at.desc",
      limit: "200",
    });
    if (byPayloadCik.ok && Array.isArray(byPayloadCik.data)) rows.push(...(byPayloadCik.data as RawItemRow[]));

    const byMetadataCik = await supabaseSelect("raw_items", {
      select,
      "metadata->>cik": `eq.${cik}`,
      order: "published_at.desc",
      limit: "200",
    });
    if (byMetadataCik.ok && Array.isArray(byMetadataCik.data)) rows.push(...(byMetadataCik.data as RawItemRow[]));
  }

  for (const searchTerm of form25RelatedCompanySearchTerms(issuerName)) {
    for (const column of ["body_text", "analysis_text"]) {
      const byCompanyReference = await supabaseSelect("raw_items", {
        select,
        [column]: `ilike.*${searchTerm}*`,
        order: "published_at.desc",
        limit: "120",
      });
      if (byCompanyReference.ok && Array.isArray(byCompanyReference.data)) {
        rows.push(...(byCompanyReference.data as RawItemRow[]));
      }
    }
  }

  return uniqueRawRows(rows);
}

function form25RelatedCompanySearchTerms(issuerName: string) {
  const stopWords = new Set([
    "company",
    "corporation",
    "corp",
    "incorporated",
    "inc",
    "limited",
    "ltd",
    "holdings",
    "holding",
    "group",
    "plc",
    "acquisition",
  ]);
  const words = normalizeComparableName(issuerName)
    .split(" ")
    .filter((word) => word.length >= 4 && !stopWords.has(word));
  if (!words.length) return [];

  const phrase = words.slice(0, 4).join(" ");
  return phrase.length >= 5 ? [phrase] : [];
}

function scoreForm25RelatedRow(
  row: RawItemRow,
  currentFiledAtMs: number,
  subjectCik: string,
  issuerName: string,
) {
  const text = form25RelatedSearchText(row);
  if (!text || !form25RelatedCompanyIdentityMatches(row, subjectCik, issuerName, text)) return 0;

  const rowFiledAtMs = Date.parse(stringValue(row.published_at));
  let score = 0;
  const formType = readRawFormType(row).toUpperCase();

  score += scoreSecForm25RelatedFormType(formType);
  if (/\b(?:merger|merged|acquisition|acquired|business combination|share exchange|cash merger|tender offer|going private)\b/i.test(text)) {
    score += 120;
  }
  if (/\b(?:completed|consummated|closed|became effective|effective time|closing of the transaction)\b/i.test(text)) score += 75;
  if (/\b(?:delist|delisting|deregister|Form 25|trading suspension|suspended from trading)\b/i.test(text)) score += 45;
  if (/\b(?:consideration|per share|cash payment|converted into|right to receive)\b/i.test(text)) score += 30;

  if (Number.isFinite(currentFiledAtMs) && Number.isFinite(rowFiledAtMs)) {
    const ageDays = Math.round((currentFiledAtMs - rowFiledAtMs) / (24 * 60 * 60 * 1000));
    if (ageDays >= -14 && ageDays <= 45) score += 50;
    else if (ageDays >= -30 && ageDays <= 180) score += 20;
    else if (ageDays > 730) score -= 50;
  }

  return score;
}

function form25RelatedCompanyIdentityMatches(
  row: RawItemRow,
  subjectCik: string,
  issuerName: string,
  searchText: string,
) {
  const normalizedSubjectCik = normalizeCik(subjectCik);
  const normalizedRowCik = normalizeCik(readRawCik(row));
  if (normalizedSubjectCik && normalizedRowCik === normalizedSubjectCik) return true;

  const searchTerms = form25RelatedCompanySearchTerms(issuerName);
  if (!searchTerms.length) return false;
  const normalizedText = normalizeComparableName(searchText);
  return searchTerms.some((term) => normalizedText.includes(normalizeComparableName(term)));
}

async function compactForm25IssuerRelatedRow(row: RawItemRow, matchScore: number) {
  const existing = await fetchExistingGenericParentEventContext(stringValue(row.id));
  return {
    raw_item_id: stringValue(row.id) || null,
    event_id: existing?.event_id || null,
    accession_number: readRawAccession(row) || null,
    form_type: readRawFormType(row) || null,
    filed_at: stringValue(row.published_at) || readRawFiledDate(row) || null,
    title: stringValue(row.title) || null,
    ticker: readRawTicker(row) || existing?.ticker || null,
    exchange: existing?.exchange || null,
    company_name: readRawCompanyName(row) || null,
    match_score: matchScore,
    match_confidence: form25RelatedMatchConfidence(matchScore, Boolean(existing?.event_id)),
    source_url: stringValue(row.source_url) || null,
    event_type: existing?.event_type || null,
    score: existing?.score ?? null,
    delivery_level: existing?.delivery_level || null,
    signal: existing?.signal || null,
    event_title: existing?.event_title || null,
    summary: existing?.summary || null,
    quick_take: existing?.quick_take || null,
    key_evidence: existing?.key_evidence || [],
    removal_reason_context: existing?.removal_reason_context || null,
    source_snippets: buildForm25RelatedSourceSnippets(row),
  };
}

function form25RelatedMatchConfidence(matchScore: number, hasExistingEvent: boolean) {
  if (hasExistingEvent && matchScore >= 170) return "high";
  if (hasExistingEvent && matchScore >= 100) return "medium";
  return "low";
}

function form25RelatedSearchText(row: RawItemRow) {
  return truncateCompactContextText(
    [row.title, row.analysis_text, row.body_text].map(stringValue).filter(Boolean).join("\n"),
    180_000,
  );
}

function buildForm25RelatedSourceSnippets(row: RawItemRow) {
  const text = form25RelatedSearchText(row);
  if (!text) return [];

  const patterns = [
    /\b(?:merger|merged|acquisition|acquired|business combination|share exchange|cash merger|tender offer|going private)\b/gi,
    /\b(?:completed|consummated|closed|became effective|effective time|closing of the transaction)\b/gi,
    /\b(?:delist|delisting|deregister|Form 25|trading suspension|suspended from trading)\b/gi,
    /\b(?:consideration|per share|cash payment|converted into|right to receive)\b/gi,
  ];
  const snippets: string[] = [];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const index = match.index ?? 0;
      snippets.push(truncateCompactContextText(text.slice(Math.max(0, index - 280), index + 720), 900));
      if (snippets.length >= 5) return uniqueStrings(snippets).slice(0, 5);
    }
  }

  return uniqueStrings(snippets).slice(0, 5);
}

function readForm25FactValue(parserOutput: Record<string, unknown>, key: string) {
  const facts = readRecord(parserOutput.facts);
  const field = readRecord(facts?.[key]);
  return stringValue(field?.value);
}

function adaptSecForm25AnalysisPromptResultForAnalysis(
  root: Record<string, unknown>,
  parserOutput: SecForm25ParserOutput | null,
  relatedFilingContext: Record<string, unknown> | null,
) {
  const analysisOutput = readRecord(root.analysis_output);
  const displayPayload = readRecord(root.display_payload);
  if (!analysisOutput) {
    return { ok: false as const, error: "SEC Form 25 result did not contain analysis_output" };
  }
  if (!displayPayload) {
    return { ok: false as const, error: "SEC Form 25 result did not contain display_payload" };
  }
  applySecForm25IdentityFacts(displayPayload, parserOutput);
  applySecForm25PostAnalysisGuards(root, parserOutput, relatedFilingContext);
  return {
    ok: true as const,
    analysis: {
      ...analysisOutput,
      display_payload: displayPayload,
    },
  };
}

function applySecForm25IdentityFacts(
  displayPayload: Record<string, unknown>,
  parserOutput: SecForm25ParserOutput | null,
) {
  if (!parserOutput) return;
  const data = readRecord(displayPayload.data);
  if (!data) return;

  for (const key of ["issuer_name", "subject_company_cik", "filed_by_name", "filed_by_cik"] as const) {
    const value = readForm25FactValue(parserOutput as unknown as Record<string, unknown>, key);
    if (value) data[key] = value;
  }
}

function attachForm25LifecycleFilingContext(
  input: SecFilingAnalysisInput,
  analysis: Record<string, unknown>,
  relatedFilingContext: Record<string, unknown> | null,
) {
  const lifecycle = readRecord(analysis.form25_lifecycle);
  const disposition = stringValue(lifecycle?.disposition);
  if (disposition !== "related_event_update" && disposition !== "administrative_cleanup") return;

  const relatedEventId = stringValue(lifecycle?.related_event_id);
  const relatedAccession = normalizeForm25Accession(stringValue(lifecycle?.related_accession_number));
  const matched = readRecordArray(relatedFilingContext?.selected_filings).find((candidate) => {
    const candidateEventId = stringValue(candidate.event_id);
    const candidateAccession = normalizeForm25Accession(stringValue(candidate.accession_number));
    if (!candidateEventId) return false;
    return Boolean(
      (relatedEventId && candidateEventId === relatedEventId) ||
        (relatedAccession && candidateAccession === relatedAccession),
    );
  });
  if (!matched) return;

  const filingPackage = readRecord(input.filing_package);
  if (!filingPackage) return;
  const existingContext = readRecord(filingPackage.filing_context) || {};
  const existingHistory = readRecord(existingContext.transaction_history) || {};
  const priorFiling = {
    event_id: stringValue(matched.event_id) || null,
    raw_item_id: stringValue(matched.raw_item_id) || null,
    accession_number: stringValue(matched.accession_number) || null,
    form_type: stringValue(matched.form_type) || null,
    filed_at: stringValue(matched.filed_at) || null,
    title: stringValue(matched.title) || null,
    event_title: stringValue(matched.event_title) || null,
    event_type: stringValue(matched.event_type) || null,
    ticker: stringValue(matched.ticker) || null,
    exchange: stringValue(matched.exchange) || null,
    score: numberValue(matched.score),
    delivery_level: stringValue(matched.delivery_level) || null,
    signal: stringValue(matched.signal) || null,
    quick_take: stringValue(matched.quick_take) || null,
    summary: stringValue(matched.summary) || null,
    source_url: stringValue(matched.source_url) || null,
    match_source: "form25_related_filing_context",
    match_confidence: stringValue(matched.match_confidence) || null,
    match_score: numberValue(matched.match_score),
    relation: disposition === "administrative_cleanup" ? "Administrative follow-up" : "Listing follow-up",
  };
  const priorFilings = dedupeForm25PriorFilings([
    priorFiling,
    ...readRecordArray(existingHistory.prior_filings),
  ]);

  filingPackage.filing_context = {
    ...existingContext,
    context_kind: stringValue(existingContext.context_kind) || "form25_lifecycle_follow_up",
    transaction_history: {
      ...existingHistory,
      status: "found",
      current_stage: "form25_filed",
      prior_filings: priorFilings,
    },
  };
}

function dedupeForm25PriorFilings(items: Record<string, unknown>[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key =
      stringValue(item.event_id) ||
      normalizeForm25Accession(stringValue(item.accession_number)) ||
      stringValue(item.raw_item_id);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 6);
}

function normalizeForm25Accession(value: string) {
  return value.replace(/[^0-9]/g, "");
}

function readForm25ParserOutput(input: SecFilingAnalysisInput): Record<string, unknown> | null {
  const filingPackage = readRecord(input.filing_package);
  const hardParsers = readRecord(filingPackage?.hard_parsers);
  const form25 = readRecord(hardParsers?.form25);
  if (!form25 || stringValue(form25.parserGroup) !== "form25") return null;
  return form25;
}

function extractRelatedRemovalReasonContext(
  analysisOutput: Record<string, unknown>,
  analysisMetadata: Record<string, unknown>,
  displayPayload: Record<string, unknown> | null,
) {
  const displayData = readRecord(displayPayload?.data) || {};
  const directReason = stringValue(displayData.removal_reason);
  if (directReason && !isUndisclosedContextValue(directReason)) {
    return {
      label: "Removal Reason",
      value: truncateCompactContextText(directReason, 80),
      note: truncateCompactContextText(stringValue(displayData.removal_reason_text), 80) || null,
    };
  }

  const rows = [
    ...readRecordArray(analysisOutput.listing_status_snapshot),
    ...readRecordArray(analysisMetadata.listing_status_snapshot),
    ...readRecordArray(displayData.snapshot_metrics),
  ];
  const preferred = rows.find((row) => {
    const label = stringValue(row.label);
    const value = stringValue(row.value);
    return (
      /(?:delisting|removal) reason|listing issue|compliance issue|primary issue/i.test(label) &&
      Boolean(value) &&
      !isUndisclosedContextValue(value)
    );
  });
  if (!preferred) return null;

  return {
    label: stringValue(preferred.label) || "Removal Reason",
    value: truncateCompactContextText(stringValue(preferred.value), 80),
    note: truncateCompactContextText(stringValue(preferred.note), 80) || null,
  };
}

function isUndisclosedContextValue(value: string) {
  return /^(?:reason\s+)?(?:not disclosed|not stated|unknown|unclear|n\/?a)$/i.test(value.trim());
}

/* Current-report related filing and amendment lifecycle helpers. */
async function attachCurrentReportRelatedFilingContexts(input: SecFilingAnalysisInput, rawItem: RawItemRow) {
  if (!isSec8k6kFilingInput(input)) return;

  const filingPackage = readRecord(input.filing_package);
  if (!filingPackage || readRecordArray(filingPackage.related_filing_contexts).length) return;

  const parserOutput = readCurrentReportParserOutput(input);
  const references = readRecordArray(readRecord(parserOutput?.facts)?.referencedFilings).slice(0, 12);
  if (!references.length) return;

  const currentAccession = readRawAccession(rawItem);
  const currentCik = normalizeCik(readRawCik(rawItem));
  if (!currentCik) return;

  const candidateRows = await fetchExplicitRelatedFilingCandidateRows(rawItem);
  const contexts: Array<Record<string, unknown>> = [];
  const parentRawItemId = stringValue(readRecord(filingPackage.parent_filing_context)?.raw_item_id);
  const usedRawItemIds = new Set<string>(parentRawItemId ? [parentRawItemId] : []);

  for (const reference of references) {
    const explicitAccession = stringValue(reference.accessionNumber);
    let matchedRow = explicitAccession ? await fetchSecRawItemByAccession(explicitAccession) : null;
    if (matchedRow && !matchesExplicitRelatedFilingReference(matchedRow, reference, currentCik, currentAccession)) {
      matchedRow = null;
    }
    matchedRow ||= candidateRows.find((row) =>
      matchesExplicitRelatedFilingReference(row, reference, currentCik, currentAccession),
    ) || null;
    if (!matchedRow) continue;

    const rawItemId = stringValue(matchedRow.id);
    if (!rawItemId || usedRawItemIds.has(rawItemId)) continue;
    const existing = await fetchExistingGenericParentEventContext(rawItemId);
    if (!existing) continue;

    contexts.push(buildExplicitRelatedFilingContext(matchedRow, existing, reference));
    usedRawItemIds.add(rawItemId);
    if (contexts.length >= 4) break;
  }

  if (contexts.length) filingPackage.related_filing_contexts = contexts;
}

async function attachCurrentReportAmendmentLifecycleContexts(
  input: SecFilingAnalysisInput,
  rawItem: RawItemRow,
) {
  if (!isSec8k6kFilingInput(input) || !isCurrentReportAmendmentForm(readRawFormType(rawItem))) return;

  const filingPackage = readRecord(input.filing_package);
  const parserOutput = readCurrentReportParserOutput(input);
  if (!filingPackage || !parserOutput) return;

  const currentAccession = readRawAccession(rawItem);
  const currentCik = normalizeCik(readRawCik(rawItem));
  const currentFamily = normalizeCurrentReportFamily(readRawFormType(rawItem));
  const currentFiledAt = Date.parse(stringValue(rawItem.published_at));
  if (!currentCik || !currentFamily) return;

  const parentRawItemId = stringValue(readRecord(filingPackage.parent_filing_context)?.raw_item_id);
  const existingContexts = readRecordArray(filingPackage.related_filing_contexts);
  const usedRawItemIds = new Set(
    [parentRawItemId, ...existingContexts.map((context) => stringValue(context.raw_item_id))].filter(Boolean),
  );

  const candidateRows = (await fetchCurrentReportParentCandidateRows(rawItem))
    .filter((row) => {
      const rawItemId = stringValue(row.id);
      const filedAt = Date.parse(stringValue(row.published_at));
      return Boolean(
        rawItemId &&
          !usedRawItemIds.has(rawItemId) &&
          readRawAccession(row) !== currentAccession &&
          normalizeCik(readRawCik(row)) === currentCik &&
          normalizeCurrentReportFamily(readRawFormType(row)) === currentFamily &&
          isCurrentReportAmendmentForm(readRawFormType(row)) &&
          (!Number.isFinite(currentFiledAt) || !Number.isFinite(filedAt) || filedAt < currentFiledAt),
      );
    })
    .sort((left, right) => Date.parse(stringValue(right.published_at)) - Date.parse(stringValue(left.published_at)));

  const lifecycleContexts: Array<Record<string, unknown>> = [];
  for (const row of candidateRows) {
    const existing = await fetchExistingCurrentReportEventContext(stringValue(row.id));
    if (!existing) continue;
    lifecycleContexts.push(buildCurrentReportAmendmentLifecycleContext(row, existing, parserOutput));
    if (lifecycleContexts.length >= 2) break;
  }

  if (lifecycleContexts.length) {
    filingPackage.related_filing_contexts = [...existingContexts, ...lifecycleContexts].slice(0, 6);
  }
}

async function fetchExplicitRelatedFilingCandidateRows(rawItem: RawItemRow) {
  const select = "id,source_unique_id,source_url,title,published_at,body_text,analysis_text,raw_payload,metadata";
  const rawCik = readRawCik(rawItem);
  const cikValues = uniqueStrings([rawCik, normalizeCik(rawCik)].filter(Boolean));
  const rows: RawItemRow[] = [];

  for (const cik of cikValues) {
    const rawPayloadResult = await supabaseSelect("raw_items", {
      select,
      source_code: "eq.sec_edgar",
      "raw_payload->>cik": `eq.${cik}`,
      order: "published_at.desc",
      limit: "300",
    });
    if (rawPayloadResult.ok && Array.isArray(rawPayloadResult.data)) rows.push(...(rawPayloadResult.data as RawItemRow[]));

    const metadataResult = await supabaseSelect("raw_items", {
      select,
      source_code: "eq.sec_edgar",
      "metadata->>cik": `eq.${cik}`,
      order: "published_at.desc",
      limit: "300",
    });
    if (metadataResult.ok && Array.isArray(metadataResult.data)) rows.push(...(metadataResult.data as RawItemRow[]));
  }

  return dedupeRawRows(rows);
}

function matchesExplicitRelatedFilingReference(
  row: RawItemRow,
  reference: Record<string, unknown>,
  currentCik: string,
  currentAccession: string,
) {
  if (readRawAccession(row) === currentAccession) return false;
  if (normalizeCik(readRawCik(row)) !== currentCik) return false;
  if (!matchesExplicitRelatedForm(stringValue(reference.formType), readRawFormType(row))) return false;
  const referencedDate = normalizeDateOnly(stringValue(reference.filedDate));
  return Boolean(referencedDate && normalizeDateOnly(readRawFiledDate(row)) === referencedDate);
}

function matchesExplicitRelatedForm(referenceForm: string, candidateForm: string) {
  const reference = normalizeSecFormForParentContext(referenceForm).replace(/\s+/g, "");
  const candidate = normalizeSecFormForParentContext(candidateForm).replace(/\s+/g, "");
  if (!reference || !candidate) return false;
  if (reference === candidate) return true;
  if (reference === "SC14A") return /^(?:DEF14A|PRE14A|DEFA14A|DEFM14A|DEFC14A|PREM14A|PREC14A)$/.test(candidate);
  if (reference === "25") return /^(?:25|25-NSE)(?:\/A)?$/.test(candidate);
  return false;
}

function buildExplicitRelatedFilingContext(
  row: RawItemRow,
  existing: Record<string, unknown>,
  reference: Record<string, unknown>,
) {
  return {
    context_kind: "explicitly_referenced_analyzed_filing",
    match_method: stringValue(reference.accessionNumber) ? "explicit_accession" : "same_cik_form_filed_date",
    confidence: "high",
    reference_evidence: truncateCompactContextText(stringValue(reference.evidence), 520) || null,
    referenced_form_type: stringValue(reference.formType) || null,
    referenced_filed_date: stringValue(reference.filedDate) || null,
    raw_item_id: stringValue(row.id) || null,
    event_id: stringValue(existing.event_id) || null,
    accession_number: readRawAccession(row) || null,
    form_type: readRawFormType(row) || null,
    filed_at: stringValue(row.published_at) || readRawFiledDate(row) || null,
    source_url: stringValue(row.source_url) || null,
    company_name: readRawCompanyName(row) || null,
    ticker: stringValue(existing.ticker) || readRawTicker(row) || null,
    event_type: stringValue(existing.event_type) || null,
    score: numberValue(existing.score),
    delivery_level: stringValue(existing.delivery_level) || null,
    signal: stringValue(existing.signal) || null,
    event_title: stringValue(existing.event_title) || null,
    quick_take: stringValue(existing.quick_take) || null,
    summary: stringValue(existing.summary) || null,
    key_evidence: readStringArray(existing.key_evidence).slice(0, 3),
    display_payload: compactParentDisplayPayload(readRecord(existing.display_payload)),
    source_blocks: buildExplicitRelatedFilingSourceBlocks(row, existing),
  };
}

function buildExplicitRelatedFilingSourceBlocks(
  row: RawItemRow,
  existing: Record<string, unknown>,
) {
  const relatedPackage = readRecord(buildSecFilingAnalysisPackage(row, {
    maxChars: 80_000,
    maxDocumentChars: 48_000,
  }));
  if (!relatedPackage) return [];

  const formType = readRawFormType(row) || stringValue(relatedPackage.form_type) || "SEC filing";
  const accession = readRawAccession(row) || stringValue(relatedPackage.accession_number);
  const hardParsers = readRecord(relatedPackage.hard_parsers);
  const proxyParserOutput = readRecord(hardParsers?.proxy);
  const candidates: Array<Record<string, unknown>> = [];

  if (proxyParserOutput) {
    const proxySourceInput = buildProxySourceBlockPromptInput(
      proxyParserOutput as unknown as ProxyParserOutput,
    );
    for (const block of readRecordArray(proxySourceInput.cleaned_source_blocks)) {
      const blockType = stringValue(block.block_type);
      if (!blockType || blockType === "current_filing") continue;
      const text = stringValue(block.text);
      if (!text) continue;
      candidates.push({
        block_type: blockType,
        label: stringValue(block.label) || `${formType} source`,
        text,
        source_ref: accession ? `${formType} ${accession}` : formType,
        origin: "linked_filing.proxy_parser",
      });
    }
  }

  const llmText = stringValue(relatedPackage.llm_text);
  for (const [index, text] of splitRelatedFilingSourceText(llmText).entries()) {
    candidates.push({
      block_type: "related_filing_section",
      label: `${formType} original section ${index + 1}`,
      text,
      source_ref: accession ? `${formType} ${accession}` : formType,
      origin: "linked_filing.original_text",
    });
  }

  const rankingContext = [
    stringValue(existing.event_title),
    stringValue(existing.quick_take),
    stringValue(existing.summary),
    ...readStringArray(existing.key_evidence),
  ].join(" ");

  return dedupeRelatedFilingSourceBlocks(candidates)
    .map((block, index) => ({
      block,
      index,
      score: scoreRelatedFilingSourceBlock(block, rankingContext),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 4)
    .map(({ block }) => block);
}

function splitRelatedFilingSourceText(value: string, maxChars = 4_500) {
  const text = value.replace(/\r\n/g, "\n").trim();
  if (!text) return [];

  const paragraphs = text
    .split(/\n{2,}|(?=^###\s+)/m)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      flush();
      const sentences = paragraph.match(/[^.!?\n]+(?:[.!?]+|$)/g) || [paragraph];
      for (const sentence of sentences) {
        const next = current ? `${current} ${sentence.trim()}` : sentence.trim();
        if (next.length > maxChars && current) flush();
        current = current ? `${current} ${sentence.trim()}` : sentence.trim();
      }
      flush();
      continue;
    }

    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length > maxChars && current) flush();
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }
  flush();
  return chunks.slice(0, 24);
}

function scoreRelatedFilingSourceBlock(block: Record<string, unknown>, rankingContext: string) {
  const blockType = stringValue(block.block_type);
  const text = `${stringValue(block.label)} ${stringValue(block.text)}`;
  let score = blockType === "proxy_source_block" ? 40 : blockType === "table_source_block" ? 36 : 20;
  if (/\b(?:proposal|shareholder approval|vote required)\b/i.test(text)) score += 18;
  if (/\b(?:warrant|convertible|preferred stock|common stock|underlying shares?|share issuance)\b/i.test(text)) score += 24;
  if (/\b(?:Series\s+[A-Z0-9-]+|pre-funded|cashless exercise|exercise price|conversion price)\b/i.test(text)) score += 22;
  if (/\b\d{1,3}(?:,\d{3})+\s+(?:shares?|warrants?|securities)\b/i.test(text)) score += 28;
  if (/\b(?:merger|business combination|acquisition|consideration|closing)\b/i.test(text)) score += 20;
  if (/\b(?:delist|listing|trading suspension|Form 25|exchange)\b/i.test(text)) score += 18;
  if (/\b(?:reverse split|authorized shares?|equity plan)\b/i.test(text)) score += 16;
  if (/\b(?:record date|proxy card|only stockholders of record|TABLE OF CONTENTS)\b/i.test(text)) score -= 18;

  const rankingTerms = uniqueStrings(
    rankingContext
      .toLowerCase()
      .match(/[a-z][a-z0-9-]{5,}/g) || [],
  ).filter((term) => !RELATED_FILING_COMMON_TERMS.has(term));
  const haystack = text.toLowerCase();
  score += rankingTerms.slice(0, 40).filter((term) => haystack.includes(term)).length * 2;
  return score;
}

const RELATED_FILING_COMMON_TERMS = new Set([
  "company",
  "filing",
  "shares",
  "stockholders",
  "shareholders",
  "proposal",
  "approved",
  "approval",
  "common",
  "current",
  "related",
]);

function dedupeRelatedFilingSourceBlocks(blocks: Array<Record<string, unknown>>) {
  const seen = new Set<string>();
  return blocks.filter((block) => {
    const text = stringValue(block.text).replace(/\s+/g, " ").trim();
    if (!text) return false;
    const key = text.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildCurrentReportAmendmentLifecycleContext(
  row: RawItemRow,
  existing: Record<string, unknown>,
  currentParserOutput: Record<string, unknown>,
) {
  return {
    context_kind: "current_report_amendment_lifecycle",
    match_source: "amendment_lifecycle_context",
    match_method: "same_cik_current_report_family",
    confidence: "high",
    raw_item_id: stringValue(row.id) || null,
    event_id: stringValue(existing.event_id) || null,
    accession_number: readRawAccession(row) || null,
    form_type: readRawFormType(row) || null,
    filed_at: stringValue(row.published_at) || readRawFiledDate(row) || null,
    source_url: stringValue(row.source_url) || null,
    company_name: readRawCompanyName(row) || null,
    ticker: readRawTicker(row) || null,
    event_type: stringValue(existing.event_type) || null,
    score: numberValue(existing.score),
    delivery_level: stringValue(existing.delivery_level) || null,
    signal: stringValue(existing.signal) || null,
    event_title: stringValue(existing.event_title) || null,
    quick_take: stringValue(existing.quick_take) || null,
    summary: stringValue(existing.summary) || null,
    key_evidence: readStringArray(existing.key_evidence).slice(0, 3),
    source_blocks: buildCurrentReportLifecycleSourceBlocks(row, currentParserOutput),
  };
}

function buildCurrentReportLifecycleSourceBlocks(
  row: RawItemRow,
  currentParserOutput: Record<string, unknown>,
) {
  const historicalPackage = readRecord(buildSecFilingAnalysisPackage(row, {
    maxChars: 80_000,
    maxDocumentChars: 48_000,
  }));
  const historicalParserOutput = readRecord(readRecord(historicalPackage?.hard_parsers)?.["8k-6k"]);
  if (!historicalPackage || !historicalParserOutput) return [];

  const sourceInput = buildSecSourceBlockPromptInput({
    filingPackage: historicalPackage,
    parserOutput: historicalParserOutput,
    fallbackText: stringValue(historicalPackage.llm_text) || stringValue(row.body_text),
  });
  const currentItems = new Set(readCurrentReportItemNumbers(currentParserOutput));
  const currentExhibits = new Set(readCurrentReportExhibitNumbers(currentParserOutput));
  const excludedTypes = new Set([
    "current_filing",
    "filing_metadata",
    "parser_warnings",
    "source_inventory",
    "attachment_inventory",
    "document_inventory",
    "parent_filing_context",
    "related_filing_context",
    "related_filing_source_block",
    "site_market_context",
  ]);

  return sourceInput.cleaned_source_blocks
    .filter((block) => !excludedTypes.has(block.block_type) && Boolean(block.text))
    .map((block, index) => ({
      block,
      index,
      score:
        block.priority +
        (block.item_number && currentItems.has(block.item_number) ? 80 : 0) +
        (block.exhibit_number && currentExhibits.has(block.exhibit_number) ? 70 : 0),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 6)
    .map(({ block }) => ({
      block_type: block.block_type,
      label: block.label,
      text: block.text,
      source_ref: block.source_ref,
      origin: block.origin,
      item_number: block.item_number || null,
      exhibit_number: block.exhibit_number || null,
      document_type: block.document_type || null,
      document_reference: block.document_reference || null,
    }));
}

function buildCurrentReportAmendmentRepairSourceBlocks(input: SecFilingAnalysisInput) {
  const filingPackage = readRecord(input.filing_package);
  if (!filingPackage || !isCurrentReportAmendmentForm(stringValue(filingPackage.form_type))) return [];

  const sourceInput = buildSecSourceBlockPromptInput({
    filingPackage,
    parserOutput: readCurrentReportParserOutput(input),
    fallbackText: stringValue(filingPackage.llm_text),
    parentFilingContext: readRecord(filingPackage.parent_filing_context),
    relatedFilingContexts: readRecordArray(filingPackage.related_filing_contexts),
    includeAmendmentHistoricalSourceBlocks: true,
    maxBlockChars: 5_000,
  });

  return sourceInput.cleaned_source_blocks
    .filter((block) =>
      block.block_type === "parent_filing_source_block" || block.block_type === "related_filing_source_block"
    )
    .map((block) => ({
      ...block,
      origin: `integration.amendment_repair.${block.origin}`,
    }));
}
