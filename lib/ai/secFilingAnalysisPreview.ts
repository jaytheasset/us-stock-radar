import { getServerEnv } from "@/lib/env";
import {
  buildSecOfferingAuditPrompt,
  SEC_OFFERING_AUDIT_PROMPT_KEY,
  SEC_OFFERING_AUDIT_PROMPT_VERSION,
} from "@/lib/prompts/secOfferingAudit";
import { buildSecFilingAnalysisPackage } from "@/lib/prompts/secFilingAnalysisPackage";
import { buildSecFilingAnalysisPrompt, type SecFilingAnalysisInput } from "@/lib/prompts/secFilingAnalysis";
import {
  buildSecS3AmendmentTriagePrompt,
  SEC_S3_AMENDMENT_TRIAGE_PROMPT_KEY,
  SEC_S3_AMENDMENT_TRIAGE_PROMPT_VERSION,
} from "@/lib/prompts/secS3AmendmentTriage";
import {
  buildSecS3OfferingAnalysisPrompt,
  SEC_S3_OFFERING_ANALYSIS_PROMPT_KEY,
} from "@/lib/prompts/secS3OfferingAnalysis";
import {
  applySecOfferingScorePolicy,
  buildSecOfferingDilutionMetrics,
  resolveSecOfferingMarketContext,
} from "@/lib/secOfferingMarketContext";
import { parseSecS3Filing, type SecS3FilingFacts } from "@/lib/sources/sec/s3Parser";
import { supabaseSelect } from "@/lib/supabase";

type PreviewOptions = {
  dryRun?: boolean;
  rawItemId?: string;
  accessionNumber?: string;
  ticker?: string;
  calendarCandidate?: boolean;
};

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

type OpenAiPrompt = {
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
  openAiResponseId: string | null;
  outputText: string;
  parsed: Record<string, unknown> | null;
  usage: OpenAIUsage | null;
  attempts: number;
  error?: string;
  rawOpenAIResponse?: OpenAIResponseBody | null;
};

export type SecFilingAnalysisRunResult = {
  ok: boolean;
  stage: "raw_item" | "openai" | "complete";
  status: number;
  model?: string;
  openAiResponseId?: string | null;
  auditOpenAiResponseId?: string | null;
  sourceItem?: ReturnType<typeof summarizeRawRow>;
  input?: SecFilingAnalysisInput;
  triage?: Record<string, unknown> | null;
  audit?: Record<string, unknown> | null;
  analysis?: Record<string, unknown> | null;
  triageOutputText?: string;
  auditOutputText?: string;
  outputText?: string;
  triageUsage?: OpenAIUsage | null;
  auditUsage?: OpenAIUsage | null;
  usage?: OpenAIUsage | null;
  costEstimate?: CostEstimate | null;
  prompt?: {
    key: string;
    version: string;
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
  };
  error?: string;
  rawOpenAIResponse?: OpenAIResponseBody | null;
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
  const prompt = buildSecFilingPromptForInput(input);
  const auditPrompt = isS3FilingInput(input) ? buildSecOfferingAuditPrompt(input) : null;
  const triagePrompt = isS3AmendmentInput(input) ? buildSecS3AmendmentTriagePrompt(input) : null;

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
        audit: auditPrompt
          ? {
              key: auditPrompt.key,
              version: auditPrompt.version,
              system: auditPrompt.system,
              responseFormat: auditPrompt.responseFormat,
            }
          : undefined,
      },
      audit: null,
      analysis: null,
    };
  }

  const analysisResult = await runSecFilingAnalysisForRawRow(rawResult.rawItem);

  return {
    ...analysisResult,
    stage: analysisResult.ok ? "complete" : analysisResult.stage,
  };
}

export async function runSecFilingAnalysisPreviewForRawItem(rawItem: RawItemRow, options: { dryRun?: boolean } = {}) {
  const input = await buildInputFromSecRawRowWithContext(rawItem);
  const prompt = buildSecFilingPromptForInput(input);
  const auditPrompt = isS3FilingInput(input) ? buildSecOfferingAuditPrompt(input) : null;
  const triagePrompt = isS3AmendmentInput(input) ? buildSecS3AmendmentTriagePrompt(input) : null;

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
        audit: auditPrompt
          ? {
              key: auditPrompt.key,
              version: auditPrompt.version,
              system: auditPrompt.system,
              responseFormat: auditPrompt.responseFormat,
            }
          : undefined,
      },
      audit: null,
      analysis: null,
    };
  }

  const deterministicTriage = isS3AmendmentInput(input) ? buildDeterministicS3AmendmentTriage(input) : null;
  if (deterministicTriage) {
    attachS3AmendmentTriage(input, deterministicTriage);
    return {
      ok: true,
      stage: "complete",
      status: 200,
      model: getServerEnv().openAiModel,
      openAiResponseId: null,
      sourceItem: summarizeRawRow(rawItem),
      input,
      triage: deterministicTriage,
      audit: null,
      analysis: buildS3AmendmentSkipAnalysis(input, deterministicTriage),
      triageUsage: null,
      usage: null,
      costEstimate: null,
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

  const analysisResult = await runSecFilingAnalysisForRawRow(rawItem);
  return {
    ...analysisResult,
    stage: analysisResult.ok ? "complete" : analysisResult.stage,
  };
}

export async function runSecFilingAnalysisForRawRow(rawItem: RawItemRow): Promise<SecFilingAnalysisRunResult> {
  const input = await buildInputFromSecRawRowWithParentContext(rawItem);
  const env = getServerEnv();

  if (!env.openAiApiKey) {
    return {
      ok: false,
      stage: "openai",
      status: 0,
      error: "OPENAI_API_KEY is missing",
      sourceItem: summarizeRawRow(rawItem),
      input,
    };
  }

  let triage: Record<string, unknown> | null = null;
  let triageRun: OpenAiPromptRun | null = null;
  if (isS3AmendmentInput(input)) {
    triage = buildDeterministicS3AmendmentTriage(input);
    const triagePrompt = triage ? null : buildSecS3AmendmentTriagePrompt(input);
    if (!triage && triagePrompt) {
      triageRun = await runOpenAiJsonPrompt(env, triagePrompt);
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
    }
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
        model: env.openAiModel,
        openAiResponseId: triageRun?.openAiResponseId || null,
        sourceItem: summarizeRawRow(rawItem),
        input,
        triage,
        audit: null,
        analysis,
        triageOutputText: triageRun?.outputText,
        triageUsage: triageRun?.usage || null,
        usage,
        costEstimate: estimateCost(env.openAiModel, usage),
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

  await attachSecOfferingMarketContext(input);

  let audit: Record<string, unknown> | null = null;
  let auditRun: OpenAiPromptRun | null = null;
  if (isS3FilingInput(input)) {
    const auditPrompt = buildSecOfferingAuditPrompt(input);
    auditRun = await runOpenAiJsonPrompt(env, auditPrompt);
    if (!auditRun.ok || !auditRun.parsed) {
      return {
        ok: false,
        stage: "openai",
        status: auditRun.status,
        error: `SEC offering audit failed after ${auditRun.attempts} attempt(s): ${auditRun.error || "no parseable JSON"}`,
        sourceItem: summarizeRawRow(rawItem),
        input,
        triage,
        triageOutputText: triageRun?.outputText,
        triageUsage: triageRun?.usage || null,
        auditOutputText: auditRun.outputText,
        auditUsage: auditRun.usage,
        rawOpenAIResponse: auditRun.rawOpenAIResponse,
        prompt: {
          key: auditPrompt.key,
          version: auditPrompt.version,
        },
      };
    }
    audit = auditRun.parsed;
    attachOfferingSecurityAudit(input, audit);
  }

  const prompt = buildSecFilingPromptForInput(input);
  const analysisRun = await runOpenAiJsonPrompt(env, prompt);
  if (!analysisRun.ok) {
    return {
      ok: false,
      stage: "openai",
      status: analysisRun.status,
      error: `SEC filing analysis failed after ${analysisRun.attempts} attempt(s): ${analysisRun.error || "unknown OpenAI error"}`,
      sourceItem: summarizeRawRow(rawItem),
      input,
      triage,
      audit,
      auditOpenAiResponseId: auditRun?.openAiResponseId || null,
      triageOutputText: triageRun?.outputText,
      triageUsage: triageRun?.usage || null,
      auditOutputText: auditRun?.outputText,
      auditUsage: auditRun?.usage || null,
      rawOpenAIResponse: analysisRun.rawOpenAIResponse,
    };
  }

  const parsedAnalysis = analysisRun.parsed;
  const analysisWithAudit = parsedAnalysis
    ? audit
      ? { ...parsedAnalysis, offering_security_audit: audit }
      : parsedAnalysis
    : null;
  const analysis = analysisWithAudit ? applySecOfferingScorePolicy(readRecord(input.filing_package) || {}, analysisWithAudit) : null;
  const usage = combineUsage(triageRun?.usage || null, auditRun?.usage || null, analysisRun.usage);
  return {
    ok: Boolean(analysis),
    stage: "complete",
    status: analysisRun.status,
    model: env.openAiModel,
    openAiResponseId: analysisRun.openAiResponseId,
    auditOpenAiResponseId: auditRun?.openAiResponseId || null,
    sourceItem: summarizeRawRow(rawItem),
    input,
    triage,
    audit,
    analysis,
    triageOutputText: triageRun?.outputText,
    auditOutputText: auditRun?.outputText,
    outputText: analysisRun.outputText,
    triageUsage: triageRun?.usage || null,
    auditUsage: auditRun?.usage || null,
    usage,
    costEstimate: estimateCost(env.openAiModel, usage),
    prompt: {
      key: prompt.key,
      version: prompt.version,
      triage: triageRun
        ? {
            key: SEC_S3_AMENDMENT_TRIAGE_PROMPT_KEY,
            version: SEC_S3_AMENDMENT_TRIAGE_PROMPT_VERSION,
          }
        : undefined,
      audit: auditRun
        ? {
            key: SEC_OFFERING_AUDIT_PROMPT_KEY,
            version: SEC_OFFERING_AUDIT_PROMPT_VERSION,
          }
        : undefined,
    },
    error: analysis ? undefined : "OpenAI response did not contain parseable JSON",
  };
}

async function runOpenAiJsonPrompt(env: ReturnType<typeof getServerEnv>, prompt: OpenAiPrompt): Promise<OpenAiPromptRun> {
  const maxAttempts = 3;
  let lastRun: OpenAiPromptRun | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${env.openAiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: env.openAiModel,
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
      const parsed = response.ok ? parseAnalysisJson(outputText) : null;
      lastRun = {
        ok: response.ok && Boolean(parsed),
        status: response.status,
        openAiResponseId: responseBody?.id || null,
        outputText,
        parsed,
        usage: responseBody?.usage || null,
        attempts: attempt,
        error: response.ok
          ? parsed
            ? undefined
            : "OpenAI response did not contain parseable JSON"
          : responseBody?.error?.message || response.statusText || `<HTTP ${response.status}>`,
        rawOpenAIResponse: responseBody,
      };

      if (lastRun.ok || !shouldRetryOpenAiRun(lastRun.status, lastRun.error)) return lastRun;
    } catch (error) {
      lastRun = {
        ok: false,
        status: 0,
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
  if (status === 0) return true;
  if (status === 408 || status === 409 || status === 425 || status === 429) return true;
  if (status >= 500 && status <= 599) return true;
  return /\b(?:timeout|temporarily|rate limit|overloaded|upstream|gateway|socket|network)\b/i.test(error || "");
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
  if (promptKey === SEC_S3_AMENDMENT_TRIAGE_PROMPT_KEY) return 2500;
  if (promptKey === SEC_OFFERING_AUDIT_PROMPT_KEY) return 12000;
  return promptKey === SEC_S3_OFFERING_ANALYSIS_PROMPT_KEY ? 8000 : 5000;
}

export async function findSecRawItem(options: PreviewOptions = {}) {
  if (options.rawItemId) {
    const result = await supabaseSelect("raw_items", {
      select: "*",
      id: `eq.${options.rawItemId}`,
      source_code: "eq.sec_edgar",
      limit: "1",
    });
    return readRawItemResult(result);
  }

  if (options.accessionNumber) {
    const result = await supabaseSelect("raw_items", {
      select: "*",
      source_code: "eq.sec_edgar",
      source_unique_id: `eq.${options.accessionNumber}`,
      limit: "1",
    });
    return readRawItemResult(result);
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

function buildSecFilingPromptForInput(input: SecFilingAnalysisInput) {
  return isS3FilingInput(input) ? buildSecS3OfferingAnalysisPrompt(input) : buildSecFilingAnalysisPrompt(input);
}

function isS3FilingInput(input: SecFilingAnalysisInput) {
  const filingPackage = readRecord(input.filing_package);
  const formType = stringValue(filingPackage?.form_type).toUpperCase().replace(/\s+/g, "");
  if (/^S-3(?:ASR|\/A)?$/.test(formType)) return true;

  const hardParsers = readRecord(filingPackage?.hard_parsers);
  const s3 = readRecord(hardParsers?.s3);
  return s3?.is_s3_family === true;
}

function isS3AmendmentInput(input: SecFilingAnalysisInput) {
  const filingPackage = readRecord(input.filing_package);
  const formType = stringValue(filingPackage?.form_type).toUpperCase().replace(/\s+/g, "");
  if (formType === "S-3/A") return true;

  const hardParsers = readRecord(filingPackage?.hard_parsers);
  const s3 = readRecord(hardParsers?.s3);
  const amendment = readRecord(s3?.amendment);
  return s3?.is_s3_family === true && amendment?.is_amendment === true;
}

function buildDeterministicS3AmendmentTriage(input: SecFilingAnalysisInput): Record<string, unknown> | null {
  const filingPackage = readRecord(input.filing_package);
  const hardParsers = readRecord(filingPackage?.hard_parsers);
  const s3 = readRecord(hardParsers?.s3);
  const amendment = readRecord(s3?.amendment);
  const formType = stringValue(filingPackage?.form_type || amendment?.form_type)
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!s3 || !amendment || (amendment.is_amendment !== true && formType !== "S-3/A")) return null;

  const amendmentExcerpt = stringValue(amendment.amendment_excerpt);
  const limitedSignals = readFieldValueArray(amendment.limited_scope_signal_candidates);
  const changeSignals = readFieldValueArray(amendment.change_signal_candidates);
  const addedExhibits = readS3DocumentLabels(amendment.added_exhibits);
  const unchangedRemainder = amendment.unchanged_remainder_not_included === true;
  const onlyRoutineExhibits = addedExhibits.length > 0 && addedExhibits.every(isRoutineS3AmendmentExhibit);
  const allowedRoutineChangeSignals = new Set(["registration_fee_change", "post_effective_amendment"]);
  const materialChangeSignals = changeSignals.filter((signal) => !allowedRoutineChangeSignals.has(signal));

  if (materialChangeSignals.length > 0) return null;
  if (!unchangedRemainder && !onlyRoutineExhibits && !limitedSignals.length && !hasRoutineS3AmendmentText(amendmentExcerpt)) {
    return null;
  }
  if (hasMaterialS3AmendmentChangeText(amendmentExcerpt)) return null;

  const routineReasons = [
    unchangedRemainder ? "Remainder of the registration statement is unchanged and not included" : "",
    onlyRoutineExhibits ? `Only routine exhibit/consent items added: ${addedExhibits.slice(0, 4).join(", ")}` : "",
    ...limitedSignals.map((signal) => signal.replace(/_/g, " ")),
    changeSignals.includes("registration_fee_change") ? "Fee table update without changed offering economics" : "",
    changeSignals.includes("post_effective_amendment") ? "Post-effective amendment with limited routine scope" : "",
  ]
    .filter(Boolean)
    .slice(0, 4);

  return {
    triage_action: "skip_analysis",
    material_change: false,
    material_change_reasons: [],
    routine_reasons: routineReasons.length ? routineReasons : ["Routine S-3/A housekeeping amendment"],
    archive_summary: "Routine S-3/A amendment limited to housekeeping exhibits, consents, or fee-table cleanup; no changed offering economics were detected.",
    confidence: "high",
    needs_human_review: false,
    deterministic_prefilter: true,
  };
}

function shouldForceS3AmendmentAudit(input: SecFilingAnalysisInput, triage: Record<string, unknown>) {
  if (stringValue(triage.triage_action) !== "skip_analysis") return false;
  if (triage.deterministic_prefilter === true) return false;

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
    analysis_action: "skip_analysis",
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
    score_reason: "routine s-3/a amendment",
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
  await attachSecOfferingMarketContext(input);
  return input;
}

async function buildInputFromSecRawRowWithParentContext(rawItem: RawItemRow): Promise<SecFilingAnalysisInput> {
  const input = buildInputFromSecRawRow(rawItem);
  await attachParentRegistrationContext(input, rawItem);
  return input;
}

async function attachSecOfferingMarketContext(input: SecFilingAnalysisInput) {
  if (!isS3FilingInput(input)) return;

  const filingPackage = readRecord(input.filing_package);
  if (!filingPackage) return;

  const primaryTicker = readRecord(filingPackage.primary_ticker);
  const symbol = stringValue(primaryTicker?.ticker);
  const marketContext = await resolveSecOfferingMarketContext(symbol);
  filingPackage.market_context = marketContext;
  filingPackage.dilution_metrics = buildSecOfferingDilutionMetrics(filingPackage, marketContext);
}

async function attachParentRegistrationContext(input: SecFilingAnalysisInput, rawItem: RawItemRow) {
  const filingPackage = readRecord(input.filing_package);
  const hardParsers = readRecord(filingPackage?.hard_parsers);
  const s3 = readRecord(hardParsers?.s3);
  const amendment = readRecord(s3?.amendment);
  if (!filingPackage || !s3 || !amendment || amendment.is_amendment !== true) return;

  const registrationNumber = stringValue(amendment.registration_number);
  if (!registrationNumber) return;

  const parentContext = await findParentS3RegistrationContext({
    currentAccession: stringValue(filingPackage.accession_number) || stringValue(rawItem.source_unique_id),
    rawItem,
    registrationNumber,
  });
  if (!parentContext) return;

  filingPackage.parent_registration_context = parentContext;
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
  const rows = await fetchS3ParentCandidateRows(ticker);
  if (!rows.length) return null;

  const currentFiledAt = Date.parse(stringValue(rawItem.published_at));
  const matches: Array<{
    row: RawItemRow;
    parsed: SecS3FilingFacts;
    score: number;
  }> = [];

  for (const row of rows) {
    const accession = readRawAccession(row);
    if (currentAccession && accession === currentAccession) continue;

    const formType = readRawFormType(row);
    if (!/^S-3(?:ASR|\/A)?$/i.test(formType)) continue;

    const rowTicker = readRawTicker(row);
    if (ticker && rowTicker && rowTicker !== ticker) continue;

    const parsed = parseSecS3Filing(rawRowToS3ParseInput(row));
    if (!sameRegistrationNumber(parsed.amendment.registration_number?.value, registrationNumber)) continue;

    const filedAt = Date.parse(stringValue(row.published_at));
    let score = 0;
    if (!parsed.amendment.is_amendment) score += 100;
    if (Number.isFinite(currentFiledAt) && Number.isFinite(filedAt) && filedAt <= currentFiledAt) score += 50;
    if (parsed.fee_table.present) score += 10;
    if (parsed.selling_stockholders.length) score += 10;
    if (parsed.extracted_field_count) score += Math.min(10, parsed.extracted_field_count);

    matches.push({ row, parsed, score });
  }

  matches.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return Date.parse(stringValue(right.row.published_at)) - Date.parse(stringValue(left.row.published_at));
  });

  const best = matches[0];
  if (!best) return null;

  return buildParentS3Context({
    matchCount: matches.length,
    parsed: best.parsed,
    registrationNumber,
    row: best.row,
  });
}

async function fetchS3ParentCandidateRows(ticker: string) {
  const select = "id,source_unique_id,source_url,title,published_at,body_text,analysis_text,raw_payload,metadata";
  const withTicker = ticker
    ? await supabaseSelect("raw_items", {
        select,
        source_code: "eq.sec_edgar",
        "raw_payload->>ticker": `eq.${ticker}`,
        order: "published_at.desc",
        limit: "200",
      })
    : null;

  if (withTicker?.ok && Array.isArray(withTicker.data) && withTicker.data.length > 0) return withTicker.data as RawItemRow[];

  const result = await supabaseSelect("raw_items", {
    select,
    source_code: "eq.sec_edgar",
    order: "published_at.desc",
    limit: "200",
  });
  return result.ok && Array.isArray(result.data) ? (result.data as RawItemRow[]) : [];
}

async function buildParentS3Context({
  matchCount,
  parsed,
  registrationNumber,
  row,
}: {
  matchCount: number;
  parsed: SecS3FilingFacts;
  registrationNumber: string;
  row: RawItemRow;
}) {
  return {
    source: "raw_items",
    match_method: "registration_number",
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
    existing_analysis: await fetchExistingParentAnalysis(stringValue(row.id)),
    needs_human_review: parsed.needs_human_review,
    review_reasons: parsed.review_reasons,
  };
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

function readRawItemResult(result: { ok: boolean; status: number; error?: string; data: unknown }) {
  const row = Array.isArray(result.data) ? (result.data[0] as RawItemRow | undefined) : null;
  return {
    ok: result.ok && Boolean(row),
    status: result.status,
    rawItem: row || null,
    error: result.error,
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

function readRawAccession(row: RawItemRow) {
  const rawPayload = readRecord(row.raw_payload);
  return stringValue(rawPayload?.accession_number) || stringValue(row.source_unique_id);
}

function readRawFormType(row: RawItemRow) {
  const rawPayload = readRecord(row.raw_payload);
  const metadata = readRecord(row.metadata);
  return stringValue(rawPayload?.form_type) || stringValue(metadata?.form_type);
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

function readS3DocumentLabels(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const record = readRecord(item);
      if (!record) return stringValue(item);
      return [stringValue(record.type), stringValue(record.description)].filter(Boolean).join(" ");
    })
    .filter(Boolean);
}

function isRoutineS3AmendmentExhibit(value: string) {
  const normalized = value.toUpperCase();
  if (/\bEX-?(?:5|23|24|107)(?:\.|\b)/.test(normalized)) return true;
  if (/\b(?:CONSENT|LEGAL OPINION|FILING FEE EXHIBIT)\b/.test(normalized)) return true;
  return /\bEX-?99(?:\.|\b)/.test(normalized) && /\b(?:MASTER SERVICES AGREEMENT|TRUST AGREEMENT|TAX OPINION)\b/.test(normalized);
}

function hasRoutineS3AmendmentText(value: string) {
  if (!value) return false;
  return (
    /\bsole\s+purpose\b[\s\S]{0,220}?\b(?:filing|file|furnishing|furnish)\b[\s\S]{0,120}?\b(?:exhibit|consent|opinion|fee table|filing fee)\b/i.test(
      value,
    ) ||
    /\bconsists\s+solely\s+of\b[\s\S]{0,220}?\b(?:cover page|explanatory note|part ii|exhibit|signature pages?)\b/i.test(
      value,
    ) ||
    /\b(?:remainder|rest)\s+of\s+the\s+registration\s+statement[\s\S]{0,180}?\bunchanged\b[\s\S]{0,180}?\bnot\s+been\s+included\b/i.test(
      value,
    ) ||
    /\bno\s+other\s+changes?\s+(?:have\s+)?been\s+made\b/i.test(value) ||
    /\bdelaying\s+amendment\b/i.test(value) ||
    /\b(?:submitted|filed)\s+to\s+refile\s+Exhibit\s+107\b/i.test(value) ||
    /\brefil(?:e|ing)\s+Exhibit\s+107\b/i.test(value) ||
    /\bfiling\s+(?:an?\s+)?updated\s+consent\s+of\b[\s\S]{0,160}?\b(?:independent\s+registered\s+public\s+accounting\s+firm|auditor|accountant)\b/i.test(
      value,
    ) ||
    /\bupdated\s+auditor\s+consent\b/i.test(value)
  );
}

function hasMaterialS3AmendmentChangeText(value: string) {
  if (!value) return false;
  const materialTerm =
    "(?:shares?\\s+(?:registered|offered)|number\\s+of\\s+shares|selling\\s+(?:stockholder|shareholder)s?|plan\\s+of\\s+distribution|use\\s+of\\s+proceeds|warrants?|exercise\\s+price|conversion\\s+price|convertible|at-the-market|ATM|sales\\s+agreement|offering\\s+price|net\\s+proceeds|gross\\s+proceeds|maximum\\s+aggregate\\s+offering\\s+price|shelf\\s+amount|securities\\s+purchase\\s+agreement|registered\\s+direct|private\\s+placement)";
  const changeVerb = "(?:increase|increased|decrease|decreased|amend|amended|modify|modified|revise|revised|update|updated|add|added|remove|removed|change|changed)";
  return new RegExp(`\\b${changeVerb}\\b[\\s\\S]{0,220}\\b${materialTerm}\\b`, "i").test(value);
}
