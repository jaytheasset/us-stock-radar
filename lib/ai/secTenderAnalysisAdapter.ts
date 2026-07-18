import type { SecFilingAnalysisInput } from "@/lib/prompts/secFilingAnalysis";
import { adaptSecFormRoomOutputForIngest, type SecFormRoomAdapterOutput } from "@/lib/sources/sec/forms/common/formRoomAdapter";
import {
  SEC_TENDER_ANALYSIS_PROMPT_KEY,
  SEC_TENDER_ANALYSIS_PROMPT_VERSION,
  buildSecTenderAnalysisPromptDraft,
} from "@/lib/sources/sec/forms/tender/analysisPrompt";
import { buildSecTenderSourceBlockPromptInput } from "@/lib/sources/sec/forms/tender/sourceBlockPromptInput";
import {
  applySecValidationRepairPatches,
  readSecValidationJsonPointer,
} from "@/lib/ai/secValidationRepairPatch";

export { SEC_TENDER_ANALYSIS_PROMPT_KEY, SEC_TENDER_ANALYSIS_PROMPT_VERSION };

export const SEC_TENDER_VALIDATION_REPAIR_PROMPT_KEY = "sec_tender_validation_repair";
export const SEC_TENDER_VALIDATION_REPAIR_PROMPT_VERSION = "v1-one-pass-source-backed-patch";

export type SecTenderValidationRepairIssue = {
  code: string;
  warning: string;
  field_paths: string[];
  allowed_patch_paths: string[];
  candidate_source_block_ids: string[];
};

export type SecTenderValidationRepairPlan = {
  prompt: ReturnType<typeof buildTenderValidationRepairPrompt>;
  issues: SecTenderValidationRepairIssue[];
  allowedPatchPaths: string[];
  sourceBlockIds: string[];
};

export type SecTenderAnalysisAdapterResult =
  | { ok: true; analysis: Record<string, unknown> }
  | { ok: false; error: string };

export function isTenderFilingInput(input: SecFilingAnalysisInput) {
  const parserOutput = readTenderParserOutput(input);
  if (!parserOutput) return false;

  const filingPackage = readFilingPackage(input);
  const adapter = readRecord(filingPackage.form_adapter);
  return stringValue(adapter?.parserGroup) === "tender" || stringValue(adapter?.analysisMode) === "analysis_only";
}

export function buildSecTenderAnalysisPromptForInput(input: SecFilingAnalysisInput) {
  const filingPackage = readFilingPackage(input);
  const parserOutput = readTenderParserOutput(input);
  if (!parserOutput) {
    throw new Error("SEC tender parser output is missing from filing package");
  }

  return buildSecTenderAnalysisPromptDraft({
    filing_package: filingPackage,
    parser_output: parserOutput,
    filing_excerpt: stringValue(filingPackage.llm_text),
    filing_context: readRecord(filingPackage.filing_context) || null,
    parent_filing_context: readRecord(filingPackage.parent_filing_context) || null,
    market_context: readMarketContext(input),
  });
}

export function buildSecTenderValidationRepairPlan({
  analysisResult,
  input,
}: {
  analysisResult: Record<string, unknown>;
  input: SecFilingAnalysisInput;
}): SecTenderValidationRepairPlan | null {
  const root = readRecord(analysisResult);
  const filingPackage = readFilingPackage(input);
  const parserOutput = readTenderParserOutput(input);
  const marketContext = readMarketContext(input);
  if (!root || !parserOutput || !marketContext) return null;

  const filingDate = readTenderFilingDate(filingPackage, parserOutput);
  const marketAsOf = firstString(
    marketContext.as_of,
    marketContext.asOf,
    marketContext.date,
    marketContext.timestamp,
  );
  if (!isMateriallyLaterDate(marketAsOf, filingDate)) return null;

  const premiumClaimPaths = collectTenderPremiumClaimPaths(root);
  if (!premiumClaimPaths.length) return null;

  const sourceBlocks = selectTenderRepairSourceBlocks(
    buildTenderRepairSourceBlocks({ filingPackage, parserOutput, marketContext }),
  );
  if (!sourceBlocks.length) return null;

  const sourceBlockIds = sourceBlocks.map((block) => stringValue(block.block_id)).filter(Boolean);
  const warning = `Tender premium language used market context dated ${marketAsOf} for filing dated ${filingDate}; use a filing-stated unaffected/reference price or remove the premium claim.`;
  const issue: SecTenderValidationRepairIssue = {
    code: "stale_market_context_premium",
    warning,
    field_paths: premiumClaimPaths,
    allowed_patch_paths: premiumClaimPaths,
    candidate_source_block_ids: sourceBlockIds,
  };

  return {
    prompt: buildTenderValidationRepairPrompt({
      analysisResult: root,
      issues: [issue],
      allowedPatchPaths: premiumClaimPaths,
      sourceBlocks,
    }),
    issues: [issue],
    allowedPatchPaths: premiumClaimPaths,
    sourceBlockIds,
  };
}

export function applySecTenderValidationRepairPatches({
  analysisResult,
  repairResult,
  allowedPatchPaths,
}: {
  analysisResult: Record<string, unknown>;
  repairResult: unknown;
  allowedPatchPaths: string[];
}) {
  return applySecValidationRepairPatches({ analysisResult, repairResult, allowedPatchPaths });
}

export function adaptSecTenderAnalysisPromptResultForAnalysis(
  value: unknown,
  input: SecFilingAnalysisInput,
): SecTenderAnalysisAdapterResult {
  const parserOutput = readTenderParserOutput(input);
  const root = readRecord(value);
  const analysisOutput = readRecord(root?.analysis_output);
  const displayPayload = readRecord(root?.display_payload);
  const transactionFingerprint = readRecord(root?.transaction_fingerprint);
  if (!parserOutput || !analysisOutput || !displayPayload || !transactionFingerprint) {
    return {
      ok: false,
      error: "SEC tender result did not contain analysis_output, display_payload, and transaction_fingerprint",
    };
  }

  const adapted = adaptSecFormRoomOutputForIngest({
    parser_output: parserOutput,
    analysis_output: analysisOutput,
    display_payload: displayPayload,
    transaction_fingerprint: transactionFingerprint,
  });
  if (!adapted.ok) {
    return {
      ok: false,
      error: `SEC tender Required Output JSON failed validation: ${adapted.errors.join("; ")}`,
    };
  }

  return {
    ok: true,
    analysis: tenderAdapterOutputToAnalysis(adapted.value, input),
  };
}

function tenderAdapterOutputToAnalysis(value: SecFormRoomAdapterOutput, input: SecFilingAnalysisInput) {
  const transactionFingerprint = normalizeTenderTransactionFingerprint(
    value.metadata.transaction_fingerprint || value.transaction_fingerprint || null,
    input,
  );
  const scoreNormalizedOutput = normalizeTenderCurrencyText(
    normalizeTenderAnalysisScore(value.analysis_output, transactionFingerprint, input),
  ) as Record<string, unknown>;
  const score = clampScore(numberValue(scoreNormalizedOutput.score) ?? 0);
  const archiveSummary =
    nullableString(scoreNormalizedOutput.archive_summary) ||
    (score < 50 ? nullableString(scoreNormalizedOutput.summary) : null);
  const analysisOutput = normalizeTenderAnalysisTickers(scoreNormalizedOutput, transactionFingerprint, input);
  const displayPayload = normalizeTenderCurrencyText(value.metadata.display_payload);

  return {
    ...analysisOutput,
    archive_summary: archiveSummary,
    display_payload: displayPayload,
    transaction_fingerprint: transactionFingerprint,
    display_payload_storage_target: value.metadata.display_payload_storage_target,
    display_payload_storage_mode: value.metadata.display_payload_storage_mode,
    sec_tender_analysis_mode: "analysis_only",
    sec_tender_router_result: null,
    sec_tender_route_case: null,
    source_blocks_used: [],
  };
}

function normalizeTenderTransactionFingerprint(value: unknown, input: SecFilingAnalysisInput) {
  const normalized = normalizeTenderCurrencyText(value);
  const fingerprint = readRecord(normalized);
  if (!fingerprint) return null;

  const contextTargetTicker = readTenderContextTargetTicker(input);
  if (!contextTargetTicker || normalizeTicker(stringValue(fingerprint.target_ticker))) {
    return fingerprint;
  }

  return {
    ...fingerprint,
    target_ticker: contextTargetTicker,
  };
}

function normalizeTenderCurrencyText(value: unknown): unknown {
  if (typeof value === "string") return normalizeTenderCurrencyString(value);
  if (Array.isArray(value)) return value.map((item) => normalizeTenderCurrencyText(item));
  const record = readRecord(value);
  if (!record) return value;
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, normalizeTenderCurrencyText(item)]));
}

function normalizeTenderCurrencyString(value: string) {
  return normalizeIndianGroupedNumbers(value)
    .replace(/₹\s*/g, "INR ")
    .replace(/€\s*/g, "EUR ")
    .replace(/£\s*/g, "GBP ")
    .replace(/¥\s*/g, "JPY ")
    .replace(/\bINR\s+/g, "INR ")
    .replace(/\bEUR\s+/g, "EUR ")
    .replace(/\bGBP\s+/g, "GBP ")
    .replace(/\bJPY\s+/g, "JPY ");
}

function normalizeIndianGroupedNumbers(value: string) {
  return value.replace(/\b\d{1,3}(?:,\d{2})+,\d{3}\b/g, (match) => {
    const digits = match.replace(/,/g, "");
    const parsed = Number(digits);
    if (!Number.isSafeInteger(parsed)) return match;
    return parsed.toLocaleString("en-US");
  });
}

function normalizeTenderAnalysisScore(
  analysisOutput: Record<string, unknown>,
  transactionFingerprint: Record<string, unknown> | null | undefined,
  input: SecFilingAnalysisInput,
): Record<string, unknown> {
  const score = clampScore(numberValue(analysisOutput.score) ?? 0);
  const cap = computeTenderScoreCap(analysisOutput, transactionFingerprint, input);
  if (!cap || score <= cap.score) {
    return {
      ...analysisOutput,
      score,
      delivery_level: deliveryLevelForScore(score),
    };
  }

  const adjustedScore = Math.min(score, cap.score);
  return {
    ...analysisOutput,
    score: adjustedScore,
    delivery_level: deliveryLevelForScore(adjustedScore),
    score_reason: cap.scoreReason,
    score_policy_adjustment: {
      reason: cap.reason,
      original_score: score,
      adjusted_score: adjustedScore,
    },
  };
}

function computeTenderScoreCap(
  analysisOutput: Record<string, unknown>,
  transactionFingerprint: Record<string, unknown> | null | undefined,
  input: SecFilingAnalysisInput,
) {
  const score = clampScore(numberValue(analysisOutput.score) ?? 0);
  if (score < 75) return null;
  const caps: Array<{ score: number; reason: string; scoreReason: string }> = [];

  const formCbCompletionCap = computeFormCbCompletionConfirmationCap(analysisOutput, transactionFingerprint, input);
  if (formCbCompletionCap) caps.push(formCbCompletionCap);

  const issuerTenderResultCap = computeIssuerTenderResultCap(analysisOutput, transactionFingerprint, input);
  if (issuerTenderResultCap) caps.push(issuerTenderResultCap);

  if (!caps.length) return null;
  return caps.reduce((lowest, cap) => (cap.score < lowest.score ? cap : lowest));
}

function computeIssuerTenderResultCap(
  analysisOutput: Record<string, unknown>,
  transactionFingerprint: Record<string, unknown> | null | undefined,
  input: SecFilingAnalysisInput,
) {
  if (!isIssuerTenderResultAmendment(analysisOutput, transactionFingerprint, input)) return null;
  if (hasTenderResultAlertException(analysisOutput, transactionFingerprint)) return null;

  const text = tenderPolicyText(analysisOutput, transactionFingerprint);
  const acceptedPercent = extractAcceptedScalePercent(text);
  const acceptedValue = extractAcceptedValueUsd(text);
  const smallAcceptedPercent = acceptedPercent !== null && acceptedPercent <= 2.1;
  const smallAcceptedValue = acceptedValue !== null && acceptedValue < 5_000_000;

  if (smallAcceptedPercent && smallAcceptedValue) {
    return {
      score: 68,
      reason: "small_scale_issuer_tender_result_cap",
      scoreReason: "Small accepted scale caps tender result below alert.",
    };
  }
  if (smallAcceptedPercent || smallAcceptedValue) {
    return {
      score: 74,
      reason: "small_scale_issuer_tender_result_cap",
      scoreReason: "Tender result scale caps score below alert.",
    };
  }
  return null;
}

function computeFormCbCompletionConfirmationCap(
  analysisOutput: Record<string, unknown>,
  transactionFingerprint: Record<string, unknown> | null | undefined,
  input: SecFilingAnalysisInput,
) {
  const filingPackage = readFilingPackage(input);
  const formType = stringValue(filingPackage.form_type).toUpperCase();
  const transactionFamily = stringValue(transactionFingerprint?.transaction_family).toLowerCase();
  if (!formType.startsWith("CB") && !transactionFamily.includes("cross_border")) return null;

  const text = tenderPolicyText(analysisOutput, transactionFingerprint);
  const completionOnly =
    /\b(?:completion|completed|receipt of (?:the )?(?:merger|closing)?\s*certificate|merger certificate|completion date|home[-\s]?jurisdiction completion notice)\b/i.test(
      text,
    );
  if (!completionOnly) return null;
  if (hasFormCbCompletionAlertException(text)) return null;

  return {
    score: 74,
    reason: "form_cb_completion_confirmation_cap",
    scoreReason: "Completion notice lacks new holder-economics or trading-impact details required for alert.",
  };
}

function hasFormCbCompletionAlertException(text: string) {
  const hardException =
    /\b(?:accepted shares|shares accepted|acceptance|proration|payment date|paid|payment mechanics|delisting effectiveness|deregistration effectiveness|form 25|failed|terminated|termination|changed consideration|changed conditions|changed price|injunction|litigation|regulatory block|financing failure)\b/i.test(
      text,
    );
  if (hardException) return true;

  const negativeConsideration =
    /\b(?:no|without|does not provide|not disclose|lacks)[^.\n]{0,100}\b(?:cash consideration|consideration|payment|premium|accepted shares|acceptance)\b/i.test(
      text,
    );
  if (negativeConsideration) return false;

  return /\b(?:cash consideration|consideration amount|exchange ratio)\b[^.\n]{0,120}(?:\b(?:USD|US\$|\$|INR|EUR|GBP|JPY)\b|[0-9]+(?:\.[0-9]+)?\s*(?:per share|per ADS|ratio|for each))/i.test(
    text,
  );
}

function isIssuerTenderResultAmendment(
  analysisOutput: Record<string, unknown>,
  transactionFingerprint: Record<string, unknown> | null | undefined,
  input: SecFilingAnalysisInput,
) {
  const filingPackage = readFilingPackage(input);
  const formType = stringValue(filingPackage.form_type).toUpperCase();
  const transactionType = stringValue(transactionFingerprint?.transaction_type).toLowerCase();
  const transactionFamily = stringValue(transactionFingerprint?.transaction_family).toLowerCase();
  const eventType = stringValue(analysisOutput.event_type).toLowerCase();
  const isIssuerTender =
    transactionType.includes("issuer_tender") ||
    transactionFamily.includes("issuer_repurchase") ||
    eventType === "capital_return";
  if (!isIssuerTender) return false;

  const text = tenderPolicyText(analysisOutput, transactionFingerprint);
  const isAmendment = formType.endsWith("/A") || Boolean(stringValue(transactionFingerprint?.amendment_number));
  const isResult =
    /\b(?:preliminary|final)\s+results?\b/i.test(text) ||
    /\b(?:accepted|acceptance|accept for payment|validly tendered|depositary confirmation|guaranteed delivery)\b/i.test(text);
  return isAmendment && isResult;
}

function hasTenderResultAlertException(
  analysisOutput: Record<string, unknown>,
  transactionFingerprint: Record<string, unknown> | null | undefined,
) {
  const text = tenderPolicyText(analysisOutput, transactionFingerprint);
  return /\b(?:going[-\s]?private|cash[-\s]?out|squeeze[-\s]?out|failed|terminated|termination|financing failure|condition failure|injunction|litigation|regulatory block|control change|all outstanding shares|substantially all shares)\b/i.test(
    text,
  );
}

function tenderPolicyText(
  analysisOutput: Record<string, unknown>,
  transactionFingerprint: Record<string, unknown> | null | undefined,
) {
  return [
    analysisOutput.event_title,
    analysisOutput.quick_take,
    analysisOutput.summary,
    analysisOutput.why_it_matters,
    analysisOutput.score_reason,
    ...stringArray(analysisOutput.key_evidence),
    ...stringArray(analysisOutput.bullish_points),
    ...stringArray(analysisOutput.bearish_points),
    transactionFingerprint?.transaction_family,
    transactionFingerprint?.transaction_type,
    transactionFingerprint?.offer_size,
    transactionFingerprint?.consideration_summary,
  ]
    .map((value) => stringValue(value))
    .filter(Boolean)
    .join("\n");
}

function extractAcceptedScalePercent(text: string) {
  const patterns = [
    /\b(?:represent(?:s|ing)?|equal(?:s|ing)?|about|approximately|roughly|~|≈)\s*(?:\w+\s+){0,5}?([0-9]+(?:\.[0-9]+)?)\s*%[^.\n]{0,120}\b(?:outstanding|public\s+float|float|shares\s+outstanding|class\s+a\s+outstanding)\b/gi,
    /\b([0-9]+(?:\.[0-9]+)?)\s*%[^.\n]{0,120}\b(?:outstanding|public\s+float|float|shares\s+outstanding|class\s+a\s+outstanding)\b/gi,
  ];
  const values: number[] = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const start = Math.max(0, (match.index ?? 0) - 80);
      const end = Math.min(text.length, (match.index ?? 0) + match[0].length + 80);
      const nearby = text.slice(start, end);
      if (/\b(?:premium|above|below|discount|prior close|market price)\b/i.test(nearby)) continue;
      const value = Number(match[1]);
      if (Number.isFinite(value)) values.push(value);
    }
  }
  return values.length ? Math.min(...values) : null;
}

function extractAcceptedValueUsd(text: string) {
  const values: number[] = [];
  const patterns = [
    /\b(?:aggregate\s+(?:purchase\s+)?(?:price|value)|for|approximately|about)\s*(?:of\s*)?(?:USD|US\$|\$)\s*([0-9]+(?:\.[0-9]+)?|[0-9][0-9,]+)\s*(million|m|billion|bn)?\b/gi,
    /\b(?:USD|US\$|\$)\s*([0-9]+(?:\.[0-9]+)?|[0-9][0-9,]+)\s*(million|m|billion|bn)\b[^.\n]{0,100}\b(?:accepted|accept|repurchase|purchase|tender)\b/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const nearby = text.slice(Math.max(0, (match.index ?? 0) - 80), Math.min(text.length, (match.index ?? 0) + match[0].length + 80));
      if (/\bper\s+share\b/i.test(nearby)) continue;
      const value = amountWithUnit(match[1], match[2]);
      if (value !== null) values.push(value);
    }
  }
  return values.length ? Math.min(...values) : null;
}

function amountWithUnit(value: string, unit: unknown) {
  const parsed = Number(value.replace(/,/g, ""));
  if (!Number.isFinite(parsed)) return null;
  const normalizedUnit = stringValue(unit).toLowerCase();
  if (normalizedUnit === "billion" || normalizedUnit === "bn") return parsed * 1_000_000_000;
  if (normalizedUnit === "million" || normalizedUnit === "m") return parsed * 1_000_000;
  return parsed;
}

function deliveryLevelForScore(score: number) {
  if (score >= 75) return "alert";
  if (score >= 50) return "feed";
  return "archive";
}

function normalizeTenderAnalysisTickers(
  analysisOutput: Record<string, unknown>,
  transactionFingerprint: Record<string, unknown> | null | undefined,
  input: SecFilingAnalysisInput,
) {
  const targetTicker = normalizeTicker(stringValue(transactionFingerprint?.target_ticker));
  const filingPackage = readFilingPackage(input);
  const packagePrimaryTicker = readRecord(filingPackage.primary_ticker);
  const analysisPrimaryTicker = readRecord(analysisOutput.primary_ticker);
  const packageTicker = normalizeTicker(stringValue(packagePrimaryTicker?.ticker));
  const analysisTicker = normalizeTicker(stringValue(analysisPrimaryTicker?.ticker));
  const primaryTicker =
    selectTenderPrimaryTicker({
      packageTicker,
      analysisTicker,
    });

  if (!primaryTicker) return normalizeTenderRelatedTickers(analysisOutput, null);

  const primaryExchange =
    resolveTenderTickerExchange(primaryTicker, analysisOutput, input) ||
    stringValue(packagePrimaryTicker?.exchange) ||
    stringValue(analysisPrimaryTicker?.exchange) ||
    null;
  const relatedTickers = buildTenderRelatedTickers({
    primaryTicker,
    targetRelated: targetTicker && targetTicker !== primaryTicker
      ? {
          ticker: targetTicker,
          exchange: resolveTenderTickerExchange(targetTicker, analysisOutput, input),
          reason: "Target company ticker from tender transaction fingerprint.",
        }
      : null,
    analysisOutput,
  });

  return {
    ...analysisOutput,
    primary_ticker: {
      ticker: primaryTicker,
      exchange: primaryExchange,
    },
    tickers: [
      {
        ticker: primaryTicker,
        exchange: primaryExchange,
        role: "primary",
        reason:
          primaryTicker === targetTicker
            ? "Subject company ticker from tender transaction fingerprint."
            : "SEC filing issuer or filer ticker preserved as primary; target is tracked separately.",
      },
    ],
    related_tickers: relatedTickers,
  };
}

function selectTenderPrimaryTicker({
  packageTicker,
  analysisTicker,
}: {
  packageTicker: string;
  analysisTicker: string;
}) {
  if (!packageTicker) return analysisTicker;
  if (!analysisTicker) return packageTicker;
  if (packageTicker === analysisTicker) return packageTicker;

  return packageTicker;
}

function normalizeTenderRelatedTickers(analysisOutput: Record<string, unknown>, primaryTicker: string | null) {
  const primary = primaryTicker || normalizeTicker(stringValue(readRecord(analysisOutput.primary_ticker)?.ticker));
  return {
    ...analysisOutput,
    related_tickers: buildTenderRelatedTickers({
      primaryTicker: primary,
      targetRelated: null,
      analysisOutput,
    }),
  };
}

function buildTenderRelatedTickers({
  primaryTicker,
  targetRelated,
  analysisOutput,
}: {
  primaryTicker: string;
  targetRelated: { ticker: string; exchange: string | null; reason: string } | null;
  analysisOutput: Record<string, unknown>;
}) {
  const rows: Array<Record<string, unknown>> = [];
  const seen = new Set<string>([primaryTicker]);
  const push = (record: Record<string, unknown> | null) => {
    if (!record) return;
    const ticker = normalizeTicker(stringValue(record.ticker));
    if (!ticker || seen.has(ticker)) return;
    seen.add(ticker);
    rows.push({
      ...record,
      ticker,
      exchange: stringValue(record.exchange) || null,
      reason: stringValue(record.reason) || "Related ticker from tender filing analysis.",
    });
  };

  push(targetRelated);
  for (const item of recordArray(analysisOutput.tickers)) push(item);
  for (const item of recordArray(analysisOutput.related_tickers)) push(item);
  return rows;
}

function readTenderContextTargetTicker(input: SecFilingAnalysisInput) {
  const filingPackage = readFilingPackage(input);
  const filingContext = readRecord(filingPackage.filing_context);
  const transactionHistory = readRecord(filingContext?.transaction_history);
  const currentFiling = readRecord(transactionHistory?.current_filing);
  return normalizeTicker(stringValue(currentFiling?.target_ticker));
}

function resolveTenderTickerExchange(
  targetTicker: string,
  analysisOutput: Record<string, unknown>,
  input: SecFilingAnalysisInput,
) {
  const filingPackage = readFilingPackage(input);
  const marketContext = readRecord(filingPackage.market_context);
  if (normalizeTicker(stringValue(marketContext?.symbol) || stringValue(marketContext?.ticker)) === targetTicker) {
    const exchange = stringValue(marketContext?.exchange);
    if (exchange) return exchange;
  }

  const candidates = [
    readRecord(analysisOutput.primary_ticker),
    ...recordArray(analysisOutput.tickers),
    ...recordArray(analysisOutput.related_tickers),
    readRecord(filingPackage.primary_ticker),
  ];
  for (const candidate of candidates) {
    if (normalizeTicker(stringValue(candidate?.ticker)) !== targetTicker) continue;
    const exchange = stringValue(candidate?.exchange);
    if (exchange) return exchange;
  }

  return null;
}

function buildTenderValidationRepairPrompt({
  analysisResult,
  issues,
  allowedPatchPaths,
  sourceBlocks,
}: {
  analysisResult: Record<string, unknown>;
  issues: SecTenderValidationRepairIssue[];
  allowedPatchPaths: string[];
  sourceBlocks: Array<Record<string, unknown>>;
}) {
  return {
    key: SEC_TENDER_VALIDATION_REPAIR_PROMPT_KEY,
    version: SEC_TENDER_VALIDATION_REPAIR_PROMPT_VERSION,
    system: [
      "Repair one completed SEC Tender analysis in one bounded pass.",
      "Validator warnings identify possible inconsistencies but are not evidence.",
      "Use only the selected original source blocks and the existing result as evidence.",
      "A filing-stated unaffected price or pre-announcement reference price takes priority over site market context for transaction premium.",
      "Never compare a historical offer price with site market context dated materially after the filing.",
      "If the source blocks support a reliable filing-date reference, recalculate the premium accurately. Otherwise remove unsupported premium or discount wording without inventing a number.",
      "Return scalar replacement patches only for exact allowed paths. Never add, remove, reorder, truncate, or rewrite arrays or objects.",
      "Preserve event classification, score, signal, transaction fingerprint, and all fields not explicitly allowed.",
      "If the source blocks do not support a reliable replacement, return the issue as unresolved instead of guessing.",
      "This is the only repair attempt. Return JSON only.",
    ].join("\n"),
    user: JSON.stringify(
      {
        task: "Patch only source-verifiable stale-market premium claims in the existing Tender analysis.",
        allowed_patch_paths: allowedPatchPaths,
        validator_issues: issues,
        selected_original_source_blocks: sourceBlocks,
        existing_analysis_result: analysisResult,
      },
      null,
      2,
    ),
    responseFormat: {
      json_schema: {
        name: "sec_tender_validation_repair",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["patches", "unresolved"],
          properties: {
            patches: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["path", "replacement", "reason", "source_block_ids"],
                properties: {
                  path: { type: "string", enum: allowedPatchPaths },
                  replacement: { type: ["string", "number", "boolean", "null"] },
                  reason: { type: "string", maxLength: 240 },
                  source_block_ids: { type: "array", items: { type: "string" } },
                },
              },
            },
            unresolved: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["code", "reason"],
                properties: {
                  code: { type: "string" },
                  reason: { type: "string", maxLength: 240 },
                },
              },
            },
          },
        },
      },
    },
  };
}

function collectTenderPremiumClaimPaths(analysisResult: Record<string, unknown>) {
  const paths = [
    "/analysis_output/event_title",
    "/analysis_output/quick_take",
    "/analysis_output/summary",
    "/analysis_output/why_it_matters",
    "/analysis_output/score_reason",
    "/analysis_output/score_explanation/summary",
  ];
  for (const key of ["bullish_points", "bearish_points", "key_evidence", "what_to_watch_next"]) {
    const values = stringArray(readRecord(analysisResult.analysis_output)?.[key]);
    values.forEach((_value, index) => paths.push(`/analysis_output/${key}/${index}`));
  }
  return paths.filter((path) => TENDER_PREMIUM_CLAIM_PATTERN.test(stringValue(readSecValidationJsonPointer(analysisResult, path))));
}

const TENDER_PREMIUM_CLAIM_PATTERN = /\b(?:premium|discount|above[-\s]market|below[-\s]market)\b/i;

function buildTenderRepairSourceBlocks({
  filingPackage,
  parserOutput,
  marketContext,
}: {
  filingPackage: Record<string, unknown>;
  parserOutput: Record<string, unknown>;
  marketContext: Record<string, unknown>;
}) {
  const promptInput = buildSecTenderSourceBlockPromptInput({
    filingPackage,
    parserOutput,
    fallbackText: stringValue(filingPackage.llm_text),
    parentFilingContext: readRecord(filingPackage.parent_filing_context),
    marketContext,
  });
  return promptInput.cleaned_source_blocks.map((block, index) => ({
    block_id: `tender_${String(block.block_type || "source").toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 36)}_${index + 1}`,
    source_ref: block.label,
    block_type: block.block_type,
    label: block.label,
    source: block.source,
    text: stringValue(block.text).slice(0, 5_000),
    source_order: index,
  }));
}

function selectTenderRepairSourceBlocks(blocks: Array<Record<string, unknown>>) {
  return blocks
    .map((block) => {
      const label = `${stringValue(block.block_type)} ${stringValue(block.label)}`.toLowerCase();
      const text = stringValue(block.text).toLowerCase();
      let score = 0;
      if (/unaffected|reference market price/.test(label)) score += 60;
      if (/last full (?:trading day|day of trading)|before (?:the )?public announcement|unaffected (?:closing )?price/.test(text)) score += 40;
      if (/cash consideration|offer price|purchase price|per-share/.test(label)) score += 24;
      if (/\$\s?\d|usd\s?\d/.test(text)) score += 8;
      if (/filing metadata|current filing/.test(label)) score += 12;
      if (/site market context/.test(label)) score -= 30;
      return { block, score, order: numberValue(block.source_order) ?? 0 };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, 3)
    .sort((a, b) => a.order - b.order)
    .map(({ block }) => block);
}

function readTenderFilingDate(filingPackage: Record<string, unknown>, parserOutput: Record<string, unknown>) {
  const rawPayload = readRecord(filingPackage.rawPayload);
  return firstString(
    filingPackage.filed_at,
    filingPackage.filedAt,
    filingPackage.published_at,
    filingPackage.publishedAt,
    rawPayload?.filing_date,
    parserOutput.filedAt,
    parserOutput.filingDate,
  );
}

function isMateriallyLaterDate(laterValue: string, earlierValue: string) {
  const later = Date.parse(laterValue);
  const earlier = Date.parse(earlierValue);
  if (!Number.isFinite(later) || !Number.isFinite(earlier)) return false;
  return later - earlier > 3 * 24 * 60 * 60 * 1_000;
}

function recordArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(stringValue).filter(Boolean) : [];
}

function normalizeTicker(value: string) {
  const ticker = value.trim().toUpperCase();
  if (!ticker || ticker === "N/A" || ticker === "NONE" || ticker === "NULL") return "";
  return /^[A-Z][A-Z0-9.\-]{0,9}$/.test(ticker) ? ticker : "";
}

function readTenderParserOutput(input: SecFilingAnalysisInput): Record<string, unknown> | null {
  const filingPackage = readFilingPackage(input);
  const hardParsers = readRecord(filingPackage.hard_parsers);
  return readRecord(hardParsers?.tender);
}

function readFilingPackage(input: SecFilingAnalysisInput) {
  return readRecord(input.filing_package) || {};
}

function readMarketContext(input: SecFilingAnalysisInput) {
  const filingPackage = readFilingPackage(input);
  return readRecord(filingPackage.market_context);
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 0)));
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function nullableString(value: unknown) {
  const text = stringValue(value);
  return text || null;
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    const normalized = stringValue(value);
    if (normalized) return normalized;
  }
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
