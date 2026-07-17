import { normalizeCalendarEventType } from "@/lib/calendarEventRegistry";
import type { SecFilingAnalysisInput } from "@/lib/prompts/secFilingAnalysis";
import { applySecValidationRepairPatches } from "@/lib/ai/secValidationRepairPatch";
import {
  buildSecPeriodicReportsAnalysisPromptDraft,
  SEC_PERIODIC_REPORTS_ANALYSIS_PROMPT_KEY,
  SEC_PERIODIC_REPORTS_ANALYSIS_PROMPT_VERSION,
} from "@/lib/sources/sec/forms/periodic-reports/analysisPrompt";
import { buildSecPeriodicReportsDisplayPayload } from "@/lib/sources/sec/forms/periodic-reports/displayPayload";
import { clipPeriodicDisplayText } from "@/lib/sources/sec/forms/periodic-reports/uiNormalization";
import {
  APPROVED_SEC_EVENT_TYPES,
  type PeriodicParserOutput,
} from "@/lib/sources/sec/forms/periodic-reports/types";

export {
  SEC_PERIODIC_REPORTS_ANALYSIS_PROMPT_KEY,
  SEC_PERIODIC_REPORTS_ANALYSIS_PROMPT_VERSION,
};

export const SEC_PERIODIC_REPORTS_VALIDATION_REPAIR_PROMPT_KEY =
  "sec_periodic_reports_validation_repair";
export const SEC_PERIODIC_REPORTS_VALIDATION_REPAIR_PROMPT_VERSION =
  "v4-quantitative-narrative-consistency";

export type SecPeriodicReportsAnalysisAdapterResult =
  | { ok: true; analysis: Record<string, unknown> }
  | { ok: false; error: string };

export type SecPeriodicReportsValidationRepairIssue = {
  code: string;
  warning: string;
  field_paths: string[];
  allowed_patch_paths: string[];
  candidate_source_block_ids: string[];
};

export type SecPeriodicReportsValidationRepairPlan = {
  prompt: ReturnType<typeof buildPeriodicReportsValidationRepairPrompt>;
  issues: SecPeriodicReportsValidationRepairIssue[];
  allowedPatchPaths: string[];
  sourceBlockIds: string[];
};

export function isSecPeriodicReportsFilingInput(input: SecFilingAnalysisInput) {
  const parserOutput = readSecPeriodicReportsParserOutput(input);
  return Boolean(parserOutput && parserOutput.isSupported !== false);
}

export function buildSecPeriodicReportsAnalysisPromptForInput(input: SecFilingAnalysisInput) {
  const parserOutput = readSecPeriodicReportsParserOutput(input);
  if (!parserOutput) {
    throw new Error("SEC periodic-reports parser output is missing from filing package");
  }

  const filingPackage = readRecord(input.filing_package) || {};
  return buildSecPeriodicReportsAnalysisPromptDraft({
    filing_package: filingPackage,
    parser_output: parserOutput,
    filing_excerpt: stringValue(filingPackage.llm_text) || null,
    market_context: readRecord(filingPackage.market_context),
    parent_filing_context: readRecord(filingPackage.parent_filing_context),
  });
}

export function buildSecPeriodicReportsValidationRepairPlan({
  analysisResult,
  input,
}: {
  analysisResult: Record<string, unknown>;
  input: SecFilingAnalysisInput;
}): SecPeriodicReportsValidationRepairPlan | null {
  const issues = collectSecPeriodicReportsScoringWarnings(analysisResult, input);
  if (!issues.length) return null;

  const sourceBlocks = selectPeriodicReportsRepairSourceBlocks(input, issues);
  if (!sourceBlocks.length) return null;
  const sourceBlockIds = sourceBlocks
    .map((block) => stringValue(block.block_id))
    .filter(Boolean);
  const issuesWithSources = issues.map((issue) => ({
    ...issue,
    candidate_source_block_ids: sourceBlockIds,
  }));
  const allowedPatchPaths = uniqueStrings(
    issuesWithSources.flatMap((issue) => issue.allowed_patch_paths),
  );

  return {
    prompt: buildPeriodicReportsValidationRepairPrompt({
      analysisResult,
      issues: issuesWithSources,
      allowedPatchPaths,
      sourceBlocks,
    }),
    issues: issuesWithSources,
    allowedPatchPaths,
    sourceBlockIds,
  };
}

export function applySecPeriodicReportsValidationRepairPatches({
  analysisResult,
  repairResult,
  allowedPatchPaths,
}: {
  analysisResult: Record<string, unknown>;
  repairResult: unknown;
  allowedPatchPaths: string[];
}) {
  return applySecValidationRepairPatches({
    analysisResult,
    repairResult,
    allowedPatchPaths,
  });
}

export function collectSecPeriodicReportsScoringWarnings(
  analysisResult: Record<string, unknown>,
  input: SecFilingAnalysisInput,
): SecPeriodicReportsValidationRepairIssue[] {
  const root = readRecord(analysisResult);
  if (!root) return [];
  const issues: SecPeriodicReportsValidationRepairIssue[] = [];
  const fiscalPeriodIssue = buildFiscalPeriodLabelMismatchIssue(root, input);
  if (fiscalPeriodIssue) issues.push(fiscalPeriodIssue);
  const annualComparisonIssue = buildAnnualPriorYearComparisonIssue(root, input);
  if (annualComparisonIssue) issues.push(annualComparisonIssue);
  const annualCorePerformanceIssue = buildAnnualCorePerformanceMissingIssue(root, input);
  if (annualCorePerformanceIssue) issues.push(annualCorePerformanceIssue);
  const annualScopeIssue = buildAnnualConsolidatedMetricScopeIssue(root, input);
  if (annualScopeIssue) issues.push(annualScopeIssue);
  const quantitativeNarrativeIssue = buildQuantitativeNarrativeConsistencyIssue(root);
  if (quantitativeNarrativeIssue) issues.push(quantitativeNarrativeIssue);

  const assessment = readRecord(root?.scoring_assessment);
  if (!assessment) return dedupePeriodicRepairIssues(issues);

  const score = clampScore(root.score);
  const signal = normalizeSignal(root.signal);
  const severity = stringValue(assessment.primary_change_severity).toLowerCase();
  const earningsQuality = stringValue(assessment.earnings_quality).toLowerCase();
  const operatingDirection = stringValue(assessment.operating_direction).toLowerCase();
  const cashFlowDirection = stringValue(assessment.cash_flow_direction).toLowerCase();
  const guidanceDirection = stringValue(assessment.guidance_direction).toLowerCase();
  const alertDriver = nullableString(assessment.alert_driver);
  const offsets = stringArray(assessment.material_offsets);
  const resolvedMarketCap = readPeriodicReportsMarketCap(input);
  const actualTier = marketCapTier(resolvedMarketCap.value);
  const reportedTier = stringValue(assessment.market_cap_tier).toLowerCase();
  if (actualTier !== "unknown" && reportedTier !== actualTier) {
    issues.push(buildPeriodicRepairIssue(
      "market_cap_tier_mismatch",
      `${resolvedMarketCap.label} maps to ${actualTier}, but scoring_assessment uses ${reportedTier || "no tier"}.`,
      [
        "/scoring_assessment/market_cap_tier",
        "/scoring_assessment/primary_change_severity",
        "/score",
        "/signal",
        "/score_reason",
        "/quick_take",
        "/summary",
      ],
    ));
  }

  const thresholdTier = actualTier !== "unknown"
    ? actualTier
    : isMarketCapTier(reportedTier)
      ? reportedTier
      : "mid";
  const observedPerformanceSeverity = deriveObservedPerformanceSeverity(
    readRecord(root.report_ui)?.performance_comparisons,
    thresholdTier,
  );
  if (
    observedPerformanceSeverity &&
    severityRank(severity) < severityRank(observedPerformanceSeverity)
  ) {
    issues.push(buildPeriodicRepairIssue(
      "performance_threshold_understated",
      `Comparable performance changes meet the ${observedPerformanceSeverity} threshold for the ${thresholdTier} market-cap tier, above the reported ${severity || "unknown"} severity.`,
      [
        "/scoring_assessment/primary_change_severity",
        "/scoring_assessment/alert_driver",
        "/score",
        "/signal",
        "/score_reason",
        "/quick_take",
        "/summary",
      ],
    ));
  }

  if (signal === "neutral" && score >= 75) {
    issues.push(buildPeriodicRepairIssue(
      "neutral_alert_score_conflict",
      "Neutral signal cannot carry an alert-band score of 75 or above.",
      ["/score", "/signal", "/score_reason", "/quick_take", "/summary"],
    ));
  }

  if (score >= 75 && !alertDriver) {
    issues.push(buildPeriodicRepairIssue(
      "missing_alert_driver",
      "Alert-band periodic-report analysis requires one explicit source-backed alert driver.",
      [
        "/scoring_assessment/alert_driver",
        "/scoring_assessment/primary_change_severity",
        "/score",
        "/signal",
        "/score_reason",
      ],
    ));
  }

  const expectedBand = severityScoreBand(severity);
  if (expectedBand && (score < expectedBand.minimum || score > expectedBand.maximum)) {
    issues.push(buildPeriodicRepairIssue(
      "score_severity_mismatch",
      `${severity || "Unknown"} primary-change severity does not align with score ${score}.`,
      [
        "/scoring_assessment/primary_change_severity",
        "/scoring_assessment/alert_driver",
        "/score",
        "/signal",
        "/score_reason",
        "/quick_take",
        "/summary",
      ],
    ));
  }

  if (earningsQuality === "low" && signal === "bullish" && score >= 75) {
    issues.push(buildPeriodicRepairIssue(
      "low_quality_bullish_alert",
      "Low-quality earnings are paired with a high-conviction bullish alert without a conservative signal check.",
      [
        "/scoring_assessment/earnings_quality",
        "/scoring_assessment/alert_driver",
        "/score",
        "/signal",
        "/score_reason",
        "/quick_take",
        "/summary",
      ],
    ));
  }

  const hasMaterialConflict =
    operatingDirection === "mixed" ||
    guidanceDirection === "mixed" ||
    (operatingDirection === "positive" && cashFlowDirection === "negative") ||
    (operatingDirection === "negative" && cashFlowDirection === "positive");
  if (score >= 75 && signal !== "volatile" && hasMaterialConflict && offsets.length > 0) {
    issues.push(buildPeriodicRepairIssue(
      "material_offset_signal_conflict",
      "The assessment identifies material opposing developments, but the alert-band signal is one-directional.",
      [
        "/scoring_assessment/operating_direction",
        "/scoring_assessment/cash_flow_direction",
        "/scoring_assessment/guidance_direction",
        "/scoring_assessment/alert_driver",
        "/score",
        "/signal",
        "/score_reason",
        "/quick_take",
        "/summary",
      ],
    ));
  }

  return dedupePeriodicRepairIssues(issues);
}

export function adaptSecPeriodicReportsAnalysisPromptResultForAnalysis(
  value: unknown,
  input: SecFilingAnalysisInput,
): SecPeriodicReportsAnalysisAdapterResult {
  const root = readRecord(value);
  if (!root) {
    return { ok: false, error: "SEC periodic-reports analysis response did not contain a JSON object" };
  }

  const parserOutput = readSecPeriodicReportsParserOutput(input);
  if (!parserOutput) {
    return { ok: false, error: "SEC periodic-reports parser output is missing from filing package" };
  }

  const normalizedRoot = normalizePeriodicAnalysisText(root);
  const parserTicker = parserOutput.facts.primaryTicker;
  const parserExchange = parserOutput.facts.exchange;
  const suppliedPrimaryTicker = readRecord(normalizedRoot.primary_ticker);
  const primaryTicker = {
    ticker: nullableString(suppliedPrimaryTicker?.ticker) || parserTicker || null,
    exchange: nullableString(suppliedPrimaryTicker?.exchange) || parserExchange || null,
  };
  const score = clampScore(normalizedRoot.score);
  const eventType = normalizeEventType(normalizedRoot.event_type);
  const displayPayload = buildSecPeriodicReportsDisplayPayload({
    parser_output: parserOutput,
    analysis_output: normalizedRoot,
  });

  return {
    ok: true,
    analysis: {
      ...normalizedRoot,
      source_group: "filings",
      market_scope: normalizeMarketScope(normalizedRoot.market_scope),
      event_type: eventType,
      primary_ticker: primaryTicker,
      tickers: normalizeTickerRows(normalizedRoot.tickers, primaryTicker, "primary"),
      score,
      signal: normalizeSignal(normalizedRoot.signal),
      bullish_points: stringArray(normalizedRoot.bullish_points).slice(0, 3),
      bearish_points: stringArray(normalizedRoot.bearish_points).slice(0, 3),
      key_evidence: stringArray(normalizedRoot.key_evidence).slice(0, 3),
      what_to_watch_next: stringArray(normalizedRoot.what_to_watch_next).slice(0, 3),
      related_tickers: normalizeTickerRows(normalizedRoot.related_tickers, primaryTicker, "related"),
      calendar_items: normalizeCalendarItems(normalizedRoot.calendar_items).slice(0, 4),
      confidence: normalizeConfidence(normalizedRoot.confidence),
      needs_human_review: normalizedRoot.needs_human_review === true,
      archive_summary: score < 50 ? nullableString(normalizedRoot.summary) || nullableString(normalizedRoot.quick_take) : null,
      display_payload: displayPayload,
      periodic_reports_source_bundle: summarizePromptSourceBundle(input),
    },
  };
}

function buildPeriodicReportsValidationRepairPrompt({
  analysisResult,
  issues,
  allowedPatchPaths,
  sourceBlocks,
}: {
  analysisResult: Record<string, unknown>;
  issues: SecPeriodicReportsValidationRepairIssue[];
  allowedPatchPaths: string[];
  sourceBlocks: Array<Record<string, unknown>>;
}) {
  return {
    key: SEC_PERIODIC_REPORTS_VALIDATION_REPAIR_PROMPT_KEY,
    version: SEC_PERIODIC_REPORTS_VALIDATION_REPAIR_PROMPT_VERSION,
    system: [
      "Repair one completed SEC periodic-report analysis in one bounded pass.",
      "Validator warnings identify possible scoring, earnings-quality, or reporting-period inconsistencies but are not evidence.",
      "Use only the selected original source blocks, site market context, and existing result as evidence.",
      "For reporting-period repairs, treat report_context XBRL DEI fiscal metadata as authoritative and do not infer fiscal quarter from calendar month.",
      "For annual-report repairs, YoY means the current fiscal year versus the immediately preceding fiscal year. Replace non-adjacent annual comparison fields with source-backed adjacent-year values when available.",
      "When annual core performance is missing, use existing performance-comparison and snapshot scalar fields for revenue or sales, GAAP/IFRS net income or loss, operating income or loss, or operating cash flow. Capital-return rows must not displace those metrics.",
      "For annual_consolidated_metric_scope_mismatch, a source_scope=segment_or_subset block cannot support a company-wide total. Remove the unscoped claim from narrative scalars or explicitly label it as a segment/subset metric. Replace an unsupported consolidated comparison with another trusted consolidated core metric when available.",
      "For quantitative_narrative_mismatch, make narrative scalar fields agree with the structured performance comparison. Prefer the exact rounded percentage change and remove inconsistent doubled, more-than-doubled, tripled, or halved wording.",
      "Score is investor attention and urgency; signal is direction. Market capitalization changes percentage thresholds, not score points.",
      "Do not treat one-time, non-operating, tax, fair-value, derivative, or non-cash gains as pure operating improvement.",
      "Return scalar replacement patches only for exact allowed paths. Never add, remove, reorder, or rewrite arrays or objects.",
      "Preserve all unrelated analysis and UI fields. If evidence is insufficient, return the issue as unresolved instead of guessing.",
      "This is the only repair attempt. Return JSON only.",
    ].join("\n"),
    user: JSON.stringify(
      {
        task: "Patch only source-verifiable periodic-report scoring or reporting-period inconsistencies.",
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
        name: "sec_periodic_reports_validation_repair",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["patches", "unresolved"],
          properties: {
            patches: {
              type: "array",
              maxItems: 30,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["path", "replacement", "reason", "source_block_ids"],
                properties: {
                  path: { type: "string", enum: allowedPatchPaths },
                  replacement: { type: ["string", "number", "boolean", "null"] },
                  reason: { type: "string", maxLength: 240 },
                  source_block_ids: {
                    type: "array",
                    maxItems: 3,
                    items: { type: "string" },
                  },
                },
              },
            },
            unresolved: {
              type: "array",
              maxItems: 6,
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

function selectPeriodicReportsRepairSourceBlocks(
  input: SecFilingAnalysisInput,
  issues: SecPeriodicReportsValidationRepairIssue[],
): Array<Record<string, unknown>> {
  let blocks: Array<Record<string, unknown>> = [];
  try {
    const prompt = buildSecPeriodicReportsAnalysisPromptForInput(input);
    const payload = JSON.parse(prompt.user) as Record<string, unknown>;
    blocks = Array.isArray(payload.cleaned_source_blocks)
      ? payload.cleaned_source_blocks.map((block) => readRecord(block)).filter(isRecord)
      : [];
  } catch {
    return [];
  }

  const issueCodes = new Set(issues.map((issue) => issue.code));
  return blocks
    .map((block, index) => ({
      block,
      index,
      score: scorePeriodicRepairSourceBlock(block, issueCodes),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 3)
    .map(({ block }) => ({
      ...block,
      text: stringValue(block.text).slice(0, 4_000),
    }) as Record<string, unknown>);
}

function scorePeriodicRepairSourceBlock(
  block: Record<string, unknown>,
  issueCodes: Set<string>,
) {
  const origin = stringValue(block.origin).toLowerCase();
  const type = stringValue(block.block_type).toLowerCase();
  const haystack = `${stringValue(block.label)} ${stringValue(block.section_key)} ${stringValue(block.text)}`.toLowerCase();
  let score = 0;

  if (issueCodes.has("fiscal_period_label_mismatch") && type === "report_context") score += 160;
  if (
    (issueCodes.has("annual_prior_year_comparison_mismatch") || issueCodes.has("annual_core_performance_missing") || issueCodes.has("annual_consolidated_metric_scope_mismatch")) &&
    type === "annual_core_performance_facts"
  ) score += 180;
  if (issueCodes.has("quantitative_narrative_mismatch") && type === "annual_core_performance_facts") score += 180;
  if (issueCodes.has("market_cap_tier_mismatch") && origin === "filing" && hasExplicitFilingMarketCap(haystack)) score += 140;
  if (origin === "market_context") score += issueCodes.has("market_cap_tier_mismatch") ? 110 : 8;
  if (["financial_table", "xbrl_statement_facts", "periodic_report_section", "context_preserving_snippet"].includes(type)) {
    score += 18;
  }
  if (
    (issueCodes.has("annual_core_performance_missing") || issueCodes.has("annual_consolidated_metric_scope_mismatch")) &&
    /annual|revenue|sales|operating income|operating profit|net income|net loss|profit or loss|cash flow/.test(haystack)
  ) score += 45;
  if (/revenue|sales|operating income|operating profit|net income|net loss|earnings per share|\beps\b/.test(haystack)) score += 24;
  if (/cash flow|free cash flow|capital expenditure|capex|liquidity|debt|borrow/.test(haystack)) score += 20;
  if (/guidance|outlook|forecast|expect/.test(haystack)) score += 18;
  if (/tax benefit|fair value|warrant|derivative|impairment|non-cash|one-time|asset sale|remeasurement/.test(haystack)) score += 22;
  if (type === "report_context") score += 2;
  return score;
}

function buildQuantitativeNarrativeConsistencyIssue(
  analysisResult: Record<string, unknown>,
): SecPeriodicReportsValidationRepairIssue | null {
  const reportUi = readRecord(analysisResult.report_ui);
  const comparisons = Array.isArray(reportUi?.performance_comparisons) ? reportUi.performance_comparisons : [];
  const narrativeFields: Array<[string, unknown]> = [
    ["/event_title", analysisResult.event_title],
    ["/quick_take", analysisResult.quick_take],
    ["/summary", analysisResult.summary],
    ["/score_reason", analysisResult.score_reason],
    ["/report_ui/snapshot_intro", reportUi?.snapshot_intro],
  ];
  const affectedPaths = new Set<string>();
  const mismatches: string[] = [];

  for (const item of comparisons) {
    const row = readRecord(item);
    if (!row) continue;
    const current = finiteNumber(row.current_numeric);
    const comparison = finiteNumber(row.comparison_numeric);
    if (current === null || comparison === null || current <= 0 || comparison <= 0) continue;
    const metricPattern = narrativeMetricPattern(stringValue(row.label));
    if (!metricPattern) continue;
    const ratio = current / comparison;
    const changePercent = ((current - comparison) / comparison) * 100;

    for (const [path, value] of narrativeFields) {
      const text = stringValue(value);
      if (!text) continue;
      const sentences = text.split(/(?<=[.!?])\s+|\n+/);
      const conflictingSentence = sentences.find((sentence) =>
        metricPattern.test(sentence) && hasInconsistentMultiplierWording(sentence, ratio),
      );
      if (!conflictingSentence) continue;
      affectedPaths.add(path);
      mismatches.push(
        `${stringValue(row.label)} changed ${Math.round(changePercent)}% (${stringValue(row.comparison_value)} to ${stringValue(row.current_value)}), but ${path} uses inconsistent multiplier wording.`,
      );
    }
  }

  if (!affectedPaths.size) return null;
  return buildPeriodicRepairIssue(
    "quantitative_narrative_mismatch",
    uniqueStrings(mismatches).join(" "),
    [...affectedPaths],
  );
}

function narrativeMetricPattern(label: string) {
  const normalized = label.toLowerCase();
  if (/operating income|operating profit/.test(normalized)) return /\b(?:operating income|operating profit)\b/i;
  if (/net income|net profit|profit.*loss|profit\/loss/.test(normalized)) return /\b(?:net income|net profit)\b/i;
  if (/revenue|sales/.test(normalized)) return /\b(?:revenue|revenues|sales)\b/i;
  if (/earnings per share|\beps\b/.test(normalized)) return /\b(?:earnings per share|eps)\b/i;
  return null;
}

function hasInconsistentMultiplierWording(text: string, ratio: number) {
  if (/\bmore than doubl(?:ed|ing)\b/i.test(text)) return ratio <= 2;
  if (/\b(?:nearly|almost) doubl(?:ed|ing)\b/i.test(text)) return ratio < 1.8 || ratio >= 2;
  if (/\bdoubl(?:ed|ing)\b/i.test(text)) return Math.abs(ratio - 2) > 0.02;
  if (/\bmore than tripl(?:ed|ing)\b/i.test(text)) return ratio <= 3;
  if (/\btripl(?:ed|ing)\b/i.test(text)) return Math.abs(ratio - 3) > 0.03;
  if (/\bhalv(?:ed|ing)\b/i.test(text)) return Math.abs(ratio - 0.5) > 0.02;
  return false;
}

function buildFiscalPeriodLabelMismatchIssue(
  analysisResult: Record<string, unknown>,
  input: SecFilingAnalysisInput,
): SecPeriodicReportsValidationRepairIssue | null {
  const parserOutput = readSecPeriodicReportsParserOutput(input);
  const fiscalQuarter = nullableString(parserOutput?.facts.fiscalQuarter);
  const fiscalYear = nullableString(parserOutput?.facts.fiscalYear);
  const expectedQuarter = fiscalQuarterNumber(fiscalQuarter);
  if (!expectedQuarter) return null;

  const paths: string[] = [];
  for (const key of ["event_title", "quick_take", "summary", "why_it_matters", "score_reason"] as const) {
    if (hasConflictingFiscalQuarter(analysisResult[key], expectedQuarter, fiscalYear, false)) paths.push(`/${key}`);
  }

  const reportUi = readRecord(analysisResult.report_ui);
  const snapshotMetrics = Array.isArray(reportUi?.snapshot_metrics) ? reportUi.snapshot_metrics : [];
  snapshotMetrics.forEach((item, index) => {
    const row = readRecord(item);
    if (!row || !/reporting period|fiscal quarter|fiscal period|quarter/i.test(stringValue(row.label))) return;
    if (hasConflictingFiscalQuarter(row.value, expectedQuarter, fiscalYear, true)) {
      paths.push(`/report_ui/snapshot_metrics/${index}/value`);
    }
  });

  const comparisons = Array.isArray(reportUi?.performance_comparisons) ? reportUi.performance_comparisons : [];
  comparisons.forEach((item, index) => {
    const row = readRecord(item);
    if (row && hasConflictingFiscalQuarter(row.current_label, expectedQuarter, fiscalYear, true)) {
      paths.push(`/report_ui/performance_comparisons/${index}/current_label`);
    }
  });

  if (!paths.length) return null;
  return buildPeriodicRepairIssue(
    "fiscal_period_label_mismatch",
    `The filing metadata identifies fiscal ${fiscalQuarter}${fiscalYear ? ` ${fiscalYear}` : ""}, but current-period analysis labels use a different fiscal quarter.`,
    uniqueStrings(paths),
  );
}

function buildAnnualPriorYearComparisonIssue(
  analysisResult: Record<string, unknown>,
  input: SecFilingAnalysisInput,
): SecPeriodicReportsValidationRepairIssue | null {
  const parserOutput = readSecPeriodicReportsParserOutput(input);
  if (!isSubstantiveAnnualReport(parserOutput)) return null;

  const reportUi = readRecord(analysisResult.report_ui);
  const comparisons = Array.isArray(reportUi?.performance_comparisons) ? reportUi.performance_comparisons : [];
  const paths: string[] = [];
  const mismatches: string[] = [];

  comparisons.forEach((item, index) => {
    const row = readRecord(item);
    if (!row) return;
    const currentYear = annualPeriodYear(row.current_label);
    const comparisonYear = annualPeriodYear(row.comparison_label);
    if (!currentYear || !comparisonYear || currentYear - comparisonYear === 1) return;
    if (currentYear <= comparisonYear) return;

    mismatches.push(`${stringValue(row.current_label)} versus ${stringValue(row.comparison_label)}`);
    for (const field of [
      "label",
      "current_label",
      "current_value",
      "current_numeric",
      "comparison_label",
      "comparison_value",
      "comparison_numeric",
      "comparison_basis",
      "change_note",
      "change_tone",
    ]) {
      paths.push(`/report_ui/performance_comparisons/${index}/${field}`);
    }
  });

  if (!paths.length) return null;
  paths.push(
    "/scoring_assessment/primary_change_severity",
    "/scoring_assessment/operating_direction",
    "/scoring_assessment/earnings_quality",
    "/scoring_assessment/alert_driver",
    "/score",
    "/signal",
    "/score_reason",
    "/quick_take",
    "/summary",
  );
  return buildPeriodicRepairIssue(
    "annual_prior_year_comparison_mismatch",
    `Annual YoY comparisons must use the immediately preceding fiscal year; non-adjacent comparisons found: ${mismatches.join(", ")}.`,
    uniqueStrings(paths),
  );
}

function buildAnnualCorePerformanceMissingIssue(
  analysisResult: Record<string, unknown>,
  input: SecFilingAnalysisInput,
): SecPeriodicReportsValidationRepairIssue | null {
  const parserOutput = readSecPeriodicReportsParserOutput(input);
  if (!isSubstantiveAnnualReport(parserOutput)) return null;
  const evidence = annualCoreEvidence(parserOutput);
  if (!evidence.revenue && !evidence.netIncome && !evidence.operatingIncome) return null;

  const reportUi = readRecord(analysisResult.report_ui);
  const comparisons = Array.isArray(reportUi?.performance_comparisons) ? reportUi.performance_comparisons : [];
  const labels = comparisons
    .map((item) => stringValue(readRecord(item)?.label).toLowerCase())
    .filter(Boolean);
  const hasRevenue = labels.some((label) => /revenue|sales/.test(label));
  const hasNetIncome = labels.some((label) => /net income|net loss|profit.*loss|profit\/loss/.test(label));
  const eventType = stringValue(analysisResult.event_type).toLowerCase();
  const displacedByCapitalReturn = eventType === "dividends" || eventType === "capital_return";
  const missingRequiredRevenue = evidence.revenue && !hasRevenue;
  const missingRequiredNetIncome = evidence.netIncome && !hasNetIncome;
  if (!displacedByCapitalReturn && !missingRequiredRevenue && !missingRequiredNetIncome) return null;

  const paths = [
    "/event_type",
    "/event_title",
    "/scoring_assessment/primary_change_severity",
    "/scoring_assessment/operating_direction",
    "/scoring_assessment/cash_flow_direction",
    "/scoring_assessment/earnings_quality",
    "/scoring_assessment/alert_driver",
    "/score",
    "/signal",
    "/score_reason",
    "/quick_take",
    "/summary",
    "/why_it_matters",
    "/report_ui/snapshot_intro",
  ];
  comparisons.forEach((item, index) => {
    if (!readRecord(item)) return;
    for (const field of [
      "label",
      "current_label",
      "current_value",
      "current_numeric",
      "comparison_label",
      "comparison_value",
      "comparison_numeric",
      "comparison_basis",
      "change_note",
      "change_tone",
    ]) {
      paths.push(`/report_ui/performance_comparisons/${index}/${field}`);
    }
  });
  const snapshotMetrics = Array.isArray(reportUi?.snapshot_metrics) ? reportUi.snapshot_metrics : [];
  snapshotMetrics.forEach((item, index) => {
    if (!readRecord(item)) return;
    paths.push(
      `/report_ui/snapshot_metrics/${index}/label`,
      `/report_ui/snapshot_metrics/${index}/value`,
      `/report_ui/snapshot_metrics/${index}/note`,
    );
  });

  const missing = [
    displacedByCapitalReturn ? "capital return displaced the annual operating result" : "",
    missingRequiredRevenue ? "revenue or sales comparison" : "",
    missingRequiredNetIncome ? "GAAP/IFRS net income or loss comparison" : "",
  ].filter(Boolean);
  return buildPeriodicRepairIssue(
    "annual_core_performance_missing",
    `A substantive annual report contains core financial evidence, but the analysis is missing or displacing: ${missing.join(", ")}.`,
    uniqueStrings(paths),
  );
}

function buildAnnualConsolidatedMetricScopeIssue(
  analysisResult: Record<string, unknown>,
  input: SecFilingAnalysisInput,
): SecPeriodicReportsValidationRepairIssue | null {
  const parserOutput = readSecPeriodicReportsParserOutput(input);
  if (!isSubstantiveAnnualReport(parserOutput)) return null;
  const evidence = annualCoreEvidence(parserOutput);
  const segmentText = parserOutput.facts.contextSnippets
    .filter((snippet) => snippet.scope === "segment_or_subset")
    .map((snippet) => snippet.text)
    .join("\n")
    .toLowerCase();
  if (!segmentText) return null;

  const reportUi = readRecord(analysisResult.report_ui);
  const comparisons = Array.isArray(reportUi?.performance_comparisons) ? reportUi.performance_comparisons : [];
  const affectedIndexes: number[] = [];
  comparisons.forEach((item, index) => {
    const label = stringValue(readRecord(item)?.label).toLowerCase();
    if (!label) return;
    const unsupportedRevenue = /revenue|sales/.test(label) && !evidence.revenue && /revenue|sales/.test(segmentText);
    const unsupportedOperating = /operating income|operating profit|operating loss/.test(label) && !evidence.operatingIncome && /operating income|operating profit|operating loss/.test(segmentText);
    const unsupportedNetIncome = /net income|net loss|profit.*loss|profit\/loss/.test(label) && !evidence.netIncome && /net income|net loss|profit/.test(segmentText);
    if (unsupportedRevenue || unsupportedOperating || unsupportedNetIncome) affectedIndexes.push(index);
  });

  const segmentMetricKeys = extractMagnitudeKeys(segmentText);
  const textPaths: string[] = [];
  for (const key of ["quick_take", "summary", "score_reason"] as const) {
    if (containsUnscopedSegmentMetric(analysisResult[key], segmentMetricKeys)) textPaths.push(`/${key}`);
  }
  if (containsUnscopedSegmentMetric(reportUi?.snapshot_intro, segmentMetricKeys)) {
    textPaths.push("/report_ui/snapshot_intro");
  }
  const snapshotMetrics = Array.isArray(reportUi?.snapshot_metrics) ? reportUi.snapshot_metrics : [];
  snapshotMetrics.forEach((item, index) => {
    const row = readRecord(item);
    if (!row) return;
    const combined = `${stringValue(row.label)} ${stringValue(row.value)} ${stringValue(row.note)}`;
    if (!containsUnscopedSegmentMetric(combined, segmentMetricKeys)) return;
    textPaths.push(
      `/report_ui/snapshot_metrics/${index}/label`,
      `/report_ui/snapshot_metrics/${index}/value`,
      `/report_ui/snapshot_metrics/${index}/note`,
    );
  });
  const businessUpdates = Array.isArray(reportUi?.key_business_updates) ? reportUi.key_business_updates : [];
  businessUpdates.forEach((item, index) => {
    const row = readRecord(item);
    if (!row) return;
    const combined = `${stringValue(row.title)} ${stringValue(row.value)} ${stringValue(row.summary)}`;
    if (!containsUnscopedSegmentMetric(combined, segmentMetricKeys)) return;
    textPaths.push(
      `/report_ui/key_business_updates/${index}/title`,
      `/report_ui/key_business_updates/${index}/value`,
      `/report_ui/key_business_updates/${index}/summary`,
    );
  });
  if (!affectedIndexes.length && !textPaths.length) return null;

  const paths = [
    "/score",
    "/signal",
    "/score_reason",
    "/quick_take",
    "/summary",
    "/scoring_assessment/primary_change_severity",
    "/scoring_assessment/operating_direction",
    "/scoring_assessment/earnings_quality",
    "/scoring_assessment/alert_driver",
    ...textPaths,
  ];
  for (const index of affectedIndexes) {
    for (const field of [
      "label",
      "current_label",
      "current_value",
      "current_numeric",
      "comparison_label",
      "comparison_value",
      "comparison_numeric",
      "comparison_basis",
      "change_note",
      "change_tone",
    ]) {
      paths.push(`/report_ui/performance_comparisons/${index}/${field}`);
    }
  }
  return buildPeriodicRepairIssue(
    "annual_consolidated_metric_scope_mismatch",
    "The analysis presents a segment or subset metric without its scope, making it read as a consolidated company total even though no trusted consolidated source supports that use.",
    uniqueStrings(paths),
  );
}

function extractMagnitudeKeys(value: unknown) {
  const text = stringValue(value).toLowerCase();
  const result = new Set<string>();
  for (const match of text.matchAll(/(?:[$£€]\s*)?\(?(-?\d+(?:\.\d+)?)\)?\s*(bn|billion|m|million)\b/g)) {
    const amount = match[1];
    const unit = /^(?:bn|billion)$/.test(match[2] || "") ? "b" : "m";
    if (amount) result.add(`${amount}${unit}`);
  }
  return result;
}

function containsUnscopedSegmentMetric(value: unknown, metricKeys: Set<string>) {
  if (!metricKeys.size) return false;
  const sentences = stringValue(value).split(/(?<=[.!?])\s+|\n+/);
  return sentences.some((sentence) => {
    const keys = extractMagnitudeKeys(sentence);
    if (![...keys].some((key) => metricKeys.has(key))) return false;
    return !/\b(?:segment|business\s+unit|division|geograph(?:y|ic)|region|product\s+line|portfolio|subsidiary)\b/i.test(sentence);
  });
}

function isSubstantiveAnnualReport(
  parserOutput: PeriodicParserOutput | null,
): parserOutput is PeriodicParserOutput {
  if (!parserOutput || parserOutput.facts.isAmendment) return false;
  return (
    (parserOutput.facts.isAnnualReport || parserOutput.facts.isForeignIssuerAnnualReport) &&
    /^(?:10-K|20-F)$/i.test(parserOutput.formType || "")
  );
}

function annualCoreEvidence(parserOutput: PeriodicParserOutput) {
  const concepts = parserOutput.facts.sourcePackage.xbrlFacts
    .filter((fact) => fact.hasDimensions !== true)
    .map((fact) =>
    (fact.name.split(":").pop() || fact.name).replace(/[^a-z0-9]/gi, "").toLowerCase(),
  );
  const lineLabels = new Set(
    parserOutput.facts.financialStatementLines
      .filter((item) => item.source !== "financial_section")
      .map((item) => item.label.toLowerCase()),
  );
  return {
    revenue:
      concepts.some((concept) => /revenue|salesrevenuenet/.test(concept)) ||
      lineLabels.has("revenue_or_net_sales"),
    operatingIncome:
      concepts.some((concept) => /^(?:operatingincomeloss|operatingprofitloss|profitlossfromoperatingactivities)$/.test(concept)) ||
      lineLabels.has("operating_income_loss"),
    netIncome:
      concepts.some((concept) => /^(?:netincomeloss|profitloss)$/.test(concept)) ||
      lineLabels.has("net_income_loss"),
  };
}

function annualPeriodYear(value: unknown) {
  const text = stringValue(value);
  if (!text || /\bQ[1-4]\b|\bquarter\b/i.test(text)) return null;
  const match = text.match(/\b(?:FY\s*)?(19\d{2}|20\d{2})\b/i);
  return match ? Number(match[1]) : null;
}

function fiscalQuarterNumber(value: string | null) {
  if (!value) return null;
  const match = value.toLowerCase().match(/\bq([1-4])\b/);
  if (match) return Number(match[1]);
  if (/\bfirst\b/.test(value)) return 1;
  if (/\bsecond\b/.test(value)) return 2;
  if (/\bthird\b/.test(value)) return 3;
  if (/\bfourth\b/.test(value)) return 4;
  return null;
}

function hasConflictingFiscalQuarter(
  value: unknown,
  expectedQuarter: number,
  fiscalYear: string | null,
  currentPeriodField: boolean,
) {
  const text = stringValue(value);
  if (!text) return false;
  const matches = [
    ...text.matchAll(/\bQ([1-4])\b/gi),
    ...text.matchAll(/\b(first|second|third|fourth)(?:\s+fiscal)?\s+quarter\b/gi),
  ];
  for (const match of matches) {
    const number = match[1] && /^\d$/.test(match[1])
      ? Number(match[1])
      : fiscalQuarterNumber(match[1] || null);
    if (!number || number === expectedQuarter) continue;
    if (currentPeriodField) return true;
    const index = match.index || 0;
    const nearby = text.slice(Math.max(0, index - 40), index + match[0].length + 70);
    if (fiscalYear && new RegExp(`\\b(?:FY\\s*)?${fiscalYear}\\b`, "i").test(nearby)) return true;
    if (/\bfiscal\s+year\b/i.test(nearby)) return true;
  }
  return false;
}

function buildPeriodicRepairIssue(
  code: string,
  warning: string,
  paths: string[],
): SecPeriodicReportsValidationRepairIssue {
  return {
    code,
    warning,
    field_paths: paths,
    allowed_patch_paths: paths,
    candidate_source_block_ids: [],
  };
}

function dedupePeriodicRepairIssues(issues: SecPeriodicReportsValidationRepairIssue[]) {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    if (seen.has(issue.code)) return false;
    seen.add(issue.code);
    return true;
  });
}

function severityScoreBand(value: string) {
  if (value === "routine") return { minimum: 0, maximum: 59 };
  if (value === "meaningful") return { minimum: 60, maximum: 64 };
  if (value === "strong") return { minimum: 65, maximum: 74 };
  if (value === "major") return { minimum: 75, maximum: 84 };
  if (value === "critical") return { minimum: 85, maximum: 100 };
  return null;
}

function deriveObservedPerformanceSeverity(
  value: unknown,
  tier: string,
) {
  const comparisons = Array.isArray(value) ? value : [];
  let highest: "meaningful" | "strong" | "major" | null = null;
  for (const item of comparisons) {
    const row = readRecord(item);
    if (!row) continue;
    const label = stringValue(row.label).toLowerCase();
    const current = finiteNumber(row.current_numeric);
    const comparison = finiteNumber(row.comparison_numeric);
    if (current === null || comparison === null || Math.abs(comparison) < 1e-9) continue;

    let thresholds: [number, number, number] | null = null;
    if (/revenue|sales/.test(label)) {
      thresholds = revenueThresholds(tier);
    } else if (
      !/loss|expense|cash flow|debt/.test(label) &&
      /operating income|operating profit|net income|net profit|earnings per share|\beps\b/.test(label) &&
      current > 0 &&
      comparison > 0
    ) {
      thresholds = profitThresholds(tier);
    }
    if (!thresholds) continue;

    const changePercent = Math.abs((current - comparison) / Math.abs(comparison)) * 100;
    const severity = changePercent >= thresholds[2]
      ? "major"
      : changePercent >= thresholds[1]
        ? "strong"
        : changePercent >= thresholds[0]
          ? "meaningful"
          : null;
    if (severity && severityRank(severity) > severityRank(highest || "")) highest = severity;
  }
  return highest;
}

function revenueThresholds(tier: string): [number, number, number] {
  if (tier === "micro") return [25, 50, 100];
  if (tier === "small") return [15, 30, 60];
  if (tier === "large") return [7, 15, 30];
  if (tier === "mega") return [5, 10, 20];
  return [10, 20, 40];
}

function profitThresholds(tier: string): [number, number, number] {
  if (tier === "micro") return [50, 100, 200];
  if (tier === "small") return [30, 60, 120];
  if (tier === "large") return [15, 30, 60];
  if (tier === "mega") return [10, 20, 40];
  return [20, 40, 80];
}

function severityRank(value: string) {
  return ({ routine: 0, meaningful: 1, strong: 2, major: 3, critical: 4 } as Record<string, number>)[value] ?? -1;
}

function isMarketCapTier(value: string) {
  return ["micro", "small", "mid", "large", "mega"].includes(value);
}

function finiteNumber(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function readPeriodicReportsMarketCap(input: SecFilingAnalysisInput) {
  const filingMarketCap = readExplicitFilingMarketCap(input);
  if (filingMarketCap !== null) {
    return {
      value: filingMarketCap,
      label: "Current-filing explicit market capitalization",
      source: "filing" as const,
    };
  }

  const filingPackage = readRecord(input.filing_package);
  const marketContext = readRecord(filingPackage?.market_context);
  if (marketContext) {
    for (const key of ["market_cap", "marketCap", "market_capitalization", "marketCapitalization"]) {
      const parsed = parseScaledNumber(marketContext[key]);
      if (parsed !== null) {
        return {
          value: parsed,
          label: "Site market cap",
          source: "market_context" as const,
        };
      }
    }
  }
  return { value: null, label: "No usable market cap", source: "none" as const };
}

function readExplicitFilingMarketCap(input: SecFilingAnalysisInput) {
  const parserOutput = readSecPeriodicReportsParserOutput(input);
  if (!parserOutput) return null;

  const sourceTexts = [
    ...parserOutput.facts.contextSnippets.map((snippet) => snippet.text),
    ...parserOutput.facts.sections.map((section) => section.excerpt),
    ...parserOutput.facts.highValueEvidence.map((item) => item.evidence),
  ];
  const normalized = readRecord(parserOutput.raw.normalized_primary_document);
  const rawBlocks = Array.isArray(normalized?.blocks) ? normalized.blocks : [];
  for (const value of rawBlocks) {
    const block = readRecord(value);
    const text = stringValue(block?.text);
    if (text) sourceTexts.push(text);
  }

  for (const text of uniqueStrings(sourceTexts)) {
    const parsed = parseExplicitFilingMarketCap(text);
    if (parsed !== null) return parsed;
  }
  return null;
}

function parseExplicitFilingMarketCap(text: string) {
  if (!hasExplicitFilingMarketCap(text)) return null;
  const patterns = [
    /\b(?:our|the\s+(?:company|registrant)(?:'s)?)?\s*(?:total\s+)?market\s+capitalization\s+(?:was|is|stood\s+at|totaled|of)\s+(?:approximately\s+|about\s+)?(\$\s*[0-9][0-9,.]*\s*(?:thousand|million|billion|trillion|[KMBT])?)/gi,
    /\b(?:our|the\s+(?:company|registrant)(?:'s)?)?\s*market\s+cap\s+(?:was|is|stood\s+at|totaled|of)\s+(?:approximately\s+|about\s+)?(\$\s*[0-9][0-9,.]*\s*(?:thousand|million|billion|trillion|[KMBT])?)/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const nearby = text.slice(Math.max(0, (match.index || 0) - 140), (match.index || 0) + match[0].length + 140);
      if (/held\s+by\s+non-affiliates|non-affiliate\s+shares|public\s+float/i.test(nearby)) continue;
      const parsed = parseScaledNumber(match[1]);
      if (parsed !== null) return parsed;
    }
  }
  return null;
}

function hasExplicitFilingMarketCap(text: string) {
  return /\b(?:total\s+)?market\s+cap(?:italization)?\b/i.test(text);
}

function parseScaledNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  const record = readRecord(value);
  if (record) return parseScaledNumber(record.value);
  const text = stringValue(value).replace(/,/g, "");
  const match = text.match(/(-?\d+(?:\.\d+)?)\s*(thousand|million|billion|trillion|[KMBT])?/i);
  if (!match) return null;
  const base = Number(match[1]);
  if (!Number.isFinite(base) || base < 0) return null;
  const suffix = (match[2] || "").toLowerCase();
  const multiplier =
    ({
      k: 1e3,
      thousand: 1e3,
      m: 1e6,
      million: 1e6,
      b: 1e9,
      billion: 1e9,
      t: 1e12,
      trillion: 1e12,
    } as Record<string, number>)[suffix] || 1;
  return base * multiplier;
}

function marketCapTier(value: number | null) {
  if (value === null) return "unknown";
  if (value < 100_000_000) return "micro";
  if (value < 500_000_000) return "small";
  if (value < 2_000_000_000) return "mid";
  if (value < 10_000_000_000) return "large";
  return "mega";
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function isRecord(value: Record<string, unknown> | null): value is Record<string, unknown> {
  return Boolean(value);
}

function normalizePeriodicAnalysisText(root: Record<string, unknown>): Record<string, unknown> {
  return {
    ...root,
    event_title: clipPeriodicDisplayText(root.event_title, 140),
    score_reason: clipPeriodicDisplayText(root.score_reason, 220),
    quick_take: clipPeriodicDisplayText(root.quick_take, 220),
    summary: clipPeriodicDisplayText(root.summary, 900),
    why_it_matters: clipPeriodicDisplayText(root.why_it_matters, 500),
    bullish_points: stringArray(root.bullish_points)
      .slice(0, 3)
      .map((item) => clipPeriodicDisplayText(item, 220)),
    bearish_points: stringArray(root.bearish_points)
      .slice(0, 3)
      .map((item) => clipPeriodicDisplayText(item, 220)),
    key_evidence: stringArray(root.key_evidence)
      .slice(0, 3)
      .map((item) => clipPeriodicDisplayText(item, 260)),
    what_to_watch_next: stringArray(root.what_to_watch_next)
      .slice(0, 3)
      .map((item) => clipPeriodicDisplayText(item, 180)),
  };
}

export function readSecPeriodicReportsParserOutput(input: SecFilingAnalysisInput) {
  const filingPackage = readRecord(input.filing_package);
  const hardParsers = readRecord(filingPackage?.hard_parsers);
  const parserOutput = readRecord(hardParsers?.["periodic-reports"]);
  return parserOutput as unknown as PeriodicParserOutput | null;
}

function normalizeTickerRows(
  value: unknown,
  primaryTicker: { ticker: string | null; exchange: string | null },
  role: "primary" | "related",
) {
  const rows = Array.isArray(value) ? value : [];
  const normalized: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();

  for (const item of rows) {
    const record = readRecord(item);
    const ticker = (nullableString(record?.ticker) || nullableString(item))?.toUpperCase() || null;
    if (!ticker || seen.has(ticker)) continue;
    seen.add(ticker);
    normalized.push({
      ticker,
      exchange: nullableString(record?.exchange) || (ticker === primaryTicker.ticker ? primaryTicker.exchange : null),
      role,
      reason: role === "related" ? nullableString(record?.reason) : null,
    });
  }

  if (role === "primary" && primaryTicker.ticker && !seen.has(primaryTicker.ticker)) {
    normalized.unshift({
      ticker: primaryTicker.ticker,
      exchange: primaryTicker.exchange,
      role: "primary",
      reason: null,
    });
  }

  return normalized;
}

function normalizeCalendarItems(value: unknown) {
  const rows = Array.isArray(value) ? value : [];
  return rows
    .map((item) => {
      const record = readRecord(item);
      if (!record) return null;
      if (record.calendar_event_type) return record;

      const date = normalizeIsoDate(record.date);
      if (!date) return null;
      const itemType = stringValue(record.item_type);
      return {
        calendar_event_type: normalizePeriodicCalendarEventType(itemType),
        calendar_title: nullableString(record.description) || itemType || "Periodic report event",
        event_date: date,
        event_time: null,
        event_timezone: null,
        date_precision: "exact",
        estimated_start_date: null,
        estimated_end_date: null,
        is_estimated: false,
        confidence: "high",
        evidence: nullableString(record.evidence),
      };
    })
    .filter((item): item is Record<string, unknown> => Boolean(item));
}

function normalizePeriodicCalendarEventType(value: string) {
  if (value === "dividend_payable_date") return "dividend_payment_date";
  return normalizeCalendarEventType(value);
}

function normalizeIsoDate(value: unknown) {
  const text = stringValue(value);
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function summarizePromptSourceBundle(input: SecFilingAnalysisInput) {
  try {
    const prompt = buildSecPeriodicReportsAnalysisPromptForInput(input);
    const payload = JSON.parse(prompt.user) as Record<string, unknown>;
    return readRecord(payload.source_bundle);
  } catch {
    return null;
  }
}

function normalizeEventType(value: unknown) {
  const eventType = stringValue(value).toLowerCase();
  return APPROVED_SEC_EVENT_TYPES.includes(eventType as (typeof APPROVED_SEC_EVENT_TYPES)[number])
    ? eventType
    : "other";
}

function normalizeMarketScope(value: unknown) {
  const marketScope = stringValue(value).toLowerCase();
  return ["company", "sector", "theme", "macro"].includes(marketScope) ? marketScope : "company";
}

function normalizeSignal(value: unknown) {
  const signal = stringValue(value).toLowerCase();
  return ["bullish", "bearish", "volatile", "neutral"].includes(signal) ? signal : "neutral";
}

function normalizeConfidence(value: unknown) {
  const confidence = stringValue(value).toLowerCase();
  return ["high", "medium", "low"].includes(confidence) ? confidence : "medium";
}

function clampScore(value: unknown) {
  const score = typeof value === "number" ? value : Number(value);
  return Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => stringValue(item)).filter(Boolean)
    : [];
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function nullableString(value: unknown) {
  return stringValue(value) || null;
}
