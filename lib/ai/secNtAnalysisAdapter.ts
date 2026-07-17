import { applySecValidationRepairPatches } from "@/lib/ai/secValidationRepairPatch";
import type { SecFilingAnalysisInput } from "@/lib/prompts/secFilingAnalysis";
import {
  buildNtAnalysisPromptDraft,
  SEC_NT_ANALYSIS_PROMPT_KEY,
  SEC_NT_ANALYSIS_PROMPT_VERSION,
} from "@/lib/sources/sec/forms/nt/analysisPrompt";
import { buildNtDisplayPayload } from "@/lib/sources/sec/forms/nt/displayPayload";
import {
  isNtApprovedEventType,
  type NtAnalysisOutput,
  type NtParserOutput,
} from "@/lib/sources/sec/forms/nt/types";

export {
  SEC_NT_ANALYSIS_PROMPT_KEY,
  SEC_NT_ANALYSIS_PROMPT_VERSION,
};

export const SEC_NT_VALIDATION_REPAIR_PROMPT_KEY = "sec_nt_validation_repair";
export const SEC_NT_VALIDATION_REPAIR_PROMPT_VERSION = "v3-concise-snapshot";

export type SecNtAnalysisAdapterResult =
  | { ok: true; analysis: Record<string, unknown> }
  | { ok: false; error: string };

export type SecNtScoringWarning = {
  code: string;
  warning: string;
  field_paths: string[];
  allowed_patch_paths: string[];
  candidate_source_block_ids: string[];
};

export type SecNtValidationRepairPlan = {
  prompt: ReturnType<typeof buildNtValidationRepairPrompt>;
  issues: SecNtScoringWarning[];
  allowedPatchPaths: string[];
  sourceBlockIds: string[];
};

export function isSecNtFilingInput(input: SecFilingAnalysisInput) {
  const filingPackage = readRecord(input.filing_package);
  const parserOutput = readSecNtParserOutput(input);
  const formType = stringValue(filingPackage?.form_type).toUpperCase();
  return Boolean(
    (parserOutput && parserOutput.isSupported !== false) ||
      /^(?:NT 10-K|NT 10-Q|NT 20-F)(?:\/A)?$/.test(formType),
  );
}

export function buildSecNtAnalysisPromptForInput(input: SecFilingAnalysisInput) {
  const parserOutput = readSecNtParserOutput(input);
  if (!parserOutput) {
    throw new Error("SEC NT parser output is missing from filing package");
  }
  return buildNtAnalysisPromptDraft({ input, parserOutput });
}

export function adaptSecNtAnalysisPromptResultForAnalysis(
  value: unknown,
  input: SecFilingAnalysisInput,
): SecNtAnalysisAdapterResult {
  const root = readRecord(value);
  if (!root) {
    return { ok: false, error: "SEC NT analysis response did not contain a JSON object" };
  }
  const parserOutput = readSecNtParserOutput(input);
  if (!parserOutput) {
    return { ok: false, error: "SEC NT parser output is missing from filing package" };
  }

  const parserTicker = parserOutput.facts.ticker;
  const parserExchange = parserOutput.facts.exchange;
  const suppliedPrimaryTicker = readRecord(root.primary_ticker);
  const primaryTicker = {
    ticker: nullableString(suppliedPrimaryTicker?.ticker) || parserTicker || null,
    exchange: nullableString(suppliedPrimaryTicker?.exchange) || parserExchange || null,
  };
  const score = clampScore(root.score);
  const eventType = normalizeEventType(root.event_type);
  const signal = normalizeSignal(root.signal);
  const scoringAssessment = normalizeNtScoringAssessment(root.nt_scoring_assessment);
  const scoringWarnings = collectSecNtScoringWarnings({
    ...root,
    score,
    signal,
    nt_scoring_assessment: scoringAssessment,
  }, input);
  const displayPayload = buildNtDisplayPayload({
    parserOutput,
    analysisOutput: { ...root, event_type: eventType } as Partial<NtAnalysisOutput>,
  });

  return {
    ok: true,
    analysis: {
      ...root,
      source_group: "filings",
      market_scope: normalizeMarketScope(root.market_scope),
      event_type: eventType,
      primary_ticker: primaryTicker,
      tickers: normalizeTickerRows(root.tickers, primaryTicker),
      score,
      signal,
      nt_scoring_assessment: scoringAssessment,
      bullish_points: stringArray(root.bullish_points).slice(0, 3),
      bearish_points: stringArray(root.bearish_points).slice(0, 3),
      key_evidence: stringArray(root.key_evidence),
      what_to_watch_next: stringArray(root.what_to_watch_next).slice(0, 3),
      related_tickers: normalizeRelatedTickerRows(root.related_tickers).slice(0, 5),
      calendar_items: recordArray(root.calendar_items).slice(0, 3),
      confidence: normalizeConfidence(root.confidence),
      needs_human_review: root.needs_human_review === true,
      archive_summary:
        score < 50
          ? nullableString(root.summary) || nullableString(root.quick_take)
          : null,
      display_payload: displayPayload,
      nt_source_bundle: summarizeNtSourceBundle(input),
      nt_validation_warnings: scoringWarnings,
    },
  };
}

export function collectSecNtScoringWarnings(
  analysisResult: Record<string, unknown>,
  input?: SecFilingAnalysisInput,
): SecNtScoringWarning[] {
  const score = clampScore(analysisResult.score);
  const signal = normalizeSignal(analysisResult.signal);
  const assessment = normalizeNtScoringAssessment(analysisResult.nt_scoring_assessment);
  const warnings: SecNtScoringWarning[] = [];
  const band = ntSeverityScoreBand(assessment.severity);

  if (signal === "neutral" && score >= 75) {
    warnings.push(buildNtRepairIssue(
      "neutral_alert_score_conflict",
      "Neutral NT analysis cannot carry an alert-band score of 75 or above.",
      ["/score", "/signal", "/score_reason", "/score_explanation/summary"],
    ));
  }
  if (score >= 75 && !assessment.alert_driver) {
    warnings.push(buildNtRepairIssue(
      "missing_alert_driver",
      "Alert-band NT analysis requires one explicit source-backed alert driver.",
      [
        "/nt_scoring_assessment/alert_driver",
        "/nt_scoring_assessment/severity",
        "/score",
        "/signal",
        "/score_reason",
        "/score_explanation/summary",
      ],
    ));
  }
  if (band && (score < band.minimum || score > band.maximum)) {
    warnings.push(buildNtRepairIssue(
      "score_severity_mismatch",
      `${assessment.severity} NT severity does not align with score ${score}.`,
      [
        "/nt_scoring_assessment/severity",
        "/nt_scoring_assessment/alert_driver",
        "/score",
        "/signal",
        "/score_reason",
        "/score_explanation/summary",
      ],
    ));
  }
  if (
    assessment.delay_status === "within_extension" &&
    ["technical", "routine"].includes(assessment.severity) &&
    assessment.financial_reliability_risk === "none" &&
    /none disclosed|no significant|unchanged/i.test(assessment.results_change) &&
    score >= 50
  ) {
    warnings.push(buildNtRepairIssue(
      "routine_delay_overstated",
      "A routine within-extension delay with no disclosed results change should remain below the feed threshold.",
      [
        "/nt_scoring_assessment/severity",
        "/score",
        "/signal",
        "/score_reason",
        "/score_explanation/summary",
      ],
    ));
  }
  if (
    assessment.financial_reliability_risk === "explicit" &&
    !["major", "critical"].includes(assessment.severity)
  ) {
    warnings.push(buildNtRepairIssue(
      "explicit_financial_risk_understated",
      "Explicit financial-reliability risk requires major or critical severity unless the source states a clear resolution.",
      [
        "/event_type",
        "/nt_scoring_assessment/severity",
        "/nt_scoring_assessment/alert_driver",
        "/score",
        "/signal",
        "/score_reason",
        "/score_explanation/summary",
        "/quick_take",
        "/summary",
      ],
    ));
  }

  const keyEvidence = Array.isArray(analysisResult.key_evidence)
    ? analysisResult.key_evidence
    : [];
  const oversizedKeyEvidencePaths = keyEvidence.flatMap((item, index) =>
    typeof item === "string" && item.trim().length > 140
      ? [`/key_evidence/${index}`]
      : [],
  );
  if (oversizedKeyEvidencePaths.length) {
    warnings.push(buildNtRepairIssue(
      "key_evidence_too_long",
      "Key Evidence must contain concise analyst paraphrases of no more than 140 characters per item, not copied filing sentences or legal boilerplate.",
      oversizedKeyEvidencePaths,
    ));
  }

  if (assessment.underlying_issue.length > 64) {
    warnings.push(buildNtRepairIssue(
      "snapshot_reason_too_long",
      "Reason for Delay must be a compact snapshot value of no more than 64 characters, not a full explanatory sentence.",
      ["/nt_scoring_assessment/underlying_issue"],
    ));
  }
  if (assessment.results_change.length > 90) {
    warnings.push(buildNtRepairIssue(
      "snapshot_results_too_long",
      "Expected Results Impact must combine direction and the most useful figures in no more than 90 characters.",
      ["/nt_scoring_assessment/results_change"],
    ));
  }

  const parserOutput = input ? readSecNtParserOutput(input) : null;
  const significantChange = parserOutput?.facts.partIv.significantChange;
  const significantExplanation = stringValue(significantChange?.explanation);
  const substantiveResultsChange = Boolean(
    significantChange?.answer === true &&
      significantExplanation.length >= 32 &&
      !/^(?:yes|see narrative|significant change expected)\.?$/i.test(significantExplanation),
  );
  const eventType = normalizeEventType(analysisResult.event_type);
  if (
    substantiveResultsChange &&
    (eventType === "other" || score < 50 || ["technical", "routine"].includes(assessment.severity))
  ) {
    warnings.push(buildNtRepairIssue(
      "material_results_change_classified_routine",
      "Part IV discloses a substantive results change, but the analysis classifies or scores the filing as routine. Reassess the underlying earnings or sales event before applying the extension-timing offset.",
      [
        "/event_type",
        "/nt_scoring_assessment/results_change",
        "/nt_scoring_assessment/severity",
        "/nt_scoring_assessment/material_offset",
        "/nt_scoring_assessment/alert_driver",
        "/score",
        "/signal",
        "/score_reason",
        "/score_explanation/summary",
        "/quick_take",
        "/summary",
      ],
    ));
  }
  return dedupeNtRepairIssues(warnings);
}

export function buildSecNtValidationRepairPlan({
  analysisResult,
  input,
}: {
  analysisResult: Record<string, unknown>;
  input: SecFilingAnalysisInput;
}): SecNtValidationRepairPlan | null {
  const issues = collectSecNtScoringWarnings(analysisResult, input);
  if (!issues.length) return null;
  const sourceBlocks = selectNtRepairSourceBlocks(input);
  if (!sourceBlocks.length) return null;
  const sourceBlockIds = sourceBlocks.map((block) => stringValue(block.block_id)).filter(Boolean);
  const issuesWithSources = issues.map((issue) => ({
    ...issue,
    candidate_source_block_ids: sourceBlockIds,
  }));
  const allowedPatchPaths = uniqueStrings(issuesWithSources.flatMap((issue) => issue.allowed_patch_paths));
  return {
    prompt: buildNtValidationRepairPrompt({
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

export function applySecNtValidationRepairPatches({
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

function buildNtValidationRepairPrompt({
  analysisResult,
  issues,
  allowedPatchPaths,
  sourceBlocks,
}: {
  analysisResult: Record<string, unknown>;
  issues: SecNtScoringWarning[];
  allowedPatchPaths: string[];
  sourceBlocks: Array<Record<string, unknown>>;
}) {
  return {
    key: SEC_NT_VALIDATION_REPAIR_PROMPT_KEY,
    version: SEC_NT_VALIDATION_REPAIR_PROMPT_VERSION,
    system: [
      "Repair one completed SEC NT filing analysis in one bounded pass.",
      "Validator warnings identify possible classification, scoring, or snapshot inconsistencies but are not evidence.",
      "Use only the selected original Part III/Part IV source blocks and the existing result as evidence.",
      "Classify and score a substantive disclosed results change before treating expected filing within the extension as an offset.",
      "Use earnings for broader profit, loss, or EPS changes. Use sales_performance only when the material change is primarily revenue, sales, orders, or margin.",
      "A substantive results change cannot remain other, routine, or below score 50.",
      "Patch scalar values only at exact allowed paths. Preserve unrelated fields and arrays.",
      "For a key_evidence_too_long warning, rewrite only the flagged array item as one source-faithful analyst paraphrase of no more than 140 characters. Preserve the material fact and remove legal boilerplate.",
      "For snapshot_reason_too_long, rewrite underlying_issue as a plain-English issue label of no more than 64 characters, without the issuer, form name, or reporting period.",
      "For snapshot_results_too_long, rewrite results_change in no more than 90 characters using the expected current direction and only the most useful source-backed figures. Omit prior-period figures unless needed to understand direction.",
      "If evidence is insufficient, return the issue as unresolved instead of guessing.",
      "This is the only repair attempt. Return JSON only.",
    ].join("\n"),
    user: JSON.stringify({
      task: "Patch only source-verifiable NT classification, scoring, or snapshot inconsistencies.",
      allowed_patch_paths: allowedPatchPaths,
      validator_issues: issues,
      selected_original_source_blocks: sourceBlocks,
      existing_analysis_result: analysisResult,
    }, null, 2),
    responseFormat: {
      json_schema: {
        name: "sec_nt_validation_repair",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["patches", "unresolved"],
          properties: {
            patches: {
              type: "array",
              maxItems: 24,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["path", "replacement", "reason", "source_block_ids"],
                properties: {
                  path: { type: "string", enum: allowedPatchPaths },
                  replacement: { type: ["string", "number", "boolean", "null"] },
                  reason: { type: "string", maxLength: 220 },
                  source_block_ids: { type: "array", maxItems: 3, items: { type: "string" } },
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
                  reason: { type: "string", maxLength: 220 },
                },
              },
            },
          },
        },
      },
    },
  };
}

function selectNtRepairSourceBlocks(input: SecFilingAnalysisInput): Array<Record<string, unknown>> {
  try {
    const prompt = buildSecNtAnalysisPromptForInput(input);
    const payload = JSON.parse(prompt.user) as Record<string, unknown>;
    return recordArray(payload.cleaned_source_blocks)
      .map((block, index) => ({ block, index, score: ntRepairSourceBlockScore(block) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .slice(0, 3)
      .map(({ block }) => ({ ...block, text: stringValue(block.text).slice(0, 4_000) }));
  } catch {
    return [];
  }
}

function ntRepairSourceBlockScore(block: Record<string, unknown>) {
  const type = stringValue(block.block_type).toLowerCase();
  if (type === "nt_part_iv") return 200;
  if (type === "nt_part_iii") return 180;
  if (type === "nt_accountant_statement") return 120;
  return 0;
}

function buildNtRepairIssue(code: string, warning: string, paths: string[]): SecNtScoringWarning {
  const uniquePaths = uniqueStrings(paths);
  return {
    code,
    warning,
    field_paths: uniquePaths,
    allowed_patch_paths: uniquePaths,
    candidate_source_block_ids: [],
  };
}

function dedupeNtRepairIssues(issues: SecNtScoringWarning[]) {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    if (seen.has(issue.code)) return false;
    seen.add(issue.code);
    return true;
  });
}

export function readSecNtParserOutput(input: SecFilingAnalysisInput): NtParserOutput | null {
  const filingPackage = readRecord(input.filing_package);
  const hardParsers = readRecord(filingPackage?.hard_parsers);
  return readRecord(hardParsers?.nt) as NtParserOutput | null;
}

function summarizeNtSourceBundle(input: SecFilingAnalysisInput) {
  try {
    const prompt = buildSecNtAnalysisPromptForInput(input);
    const payload = JSON.parse(prompt.user) as Record<string, unknown>;
    const blocks = recordArray(payload.cleaned_source_blocks);
    return {
      block_count: blocks.length,
      text_chars: blocks.reduce((sum, block) => sum + stringValue(block.text).length, 0),
      block_types: uniqueStrings(blocks.map((block) => stringValue(block.block_type))),
    };
  } catch {
    return { block_count: 0, text_chars: 0, block_types: [] };
  }
}

function normalizeTickerRows(
  value: unknown,
  primaryTicker: { ticker: string | null; exchange: string | null },
) {
  const rows = recordArray(value)
    .map((row) => ({
      ticker: nullableString(row.ticker),
      exchange: nullableString(row.exchange),
      role: normalizeTickerRole(row.role),
    }))
    .filter((row) => row.ticker);
  if (primaryTicker.ticker && !rows.some((row) => row.ticker === primaryTicker.ticker)) {
    rows.unshift({ ...primaryTicker, role: "primary" });
  }
  return rows;
}

function normalizeRelatedTickerRows(value: unknown) {
  return recordArray(value)
    .map((row) => ({
      ticker: nullableString(row.ticker),
      exchange: nullableString(row.exchange),
      reason: nullableString(row.reason),
    }))
    .filter((row) => row.ticker && row.reason);
}

function normalizeTickerRole(value: unknown) {
  const role = stringValue(value).toLowerCase();
  return ["primary", "issuer", "acquirer", "target", "competitor", "peer", "related"].includes(role)
    ? role
    : "related";
}

function normalizeEventType(value: unknown) {
  const eventType = stringValue(value);
  return isNtApprovedEventType(eventType) ? eventType : "other";
}

function normalizeMarketScope(value: unknown) {
  const scope = stringValue(value).toLowerCase();
  return ["company", "sector", "theme", "macro"].includes(scope) ? scope : "company";
}

function normalizeSignal(value: unknown) {
  const signal = stringValue(value).toLowerCase();
  return ["bullish", "bearish", "volatile", "neutral"].includes(signal) ? signal : "neutral";
}

function normalizeConfidence(value: unknown) {
  const confidence = stringValue(value).toLowerCase();
  return ["high", "medium", "low"].includes(confidence) ? confidence : "medium";
}

function normalizeNtScoringAssessment(value: unknown) {
  const assessment = readRecord(value) || {};
  return {
    delay_status: normalizeAssessmentValue(
      assessment.delay_status,
      ["within_extension", "outside_extension", "unclear"],
      "unclear",
    ),
    underlying_issue: nullableString(assessment.underlying_issue) || "Not established",
    results_change: nullableString(assessment.results_change) || "unclear",
    financial_reliability_risk: normalizeAssessmentValue(
      assessment.financial_reliability_risk,
      ["none", "possible", "explicit"],
      "possible",
    ),
    severity: normalizeAssessmentValue(
      assessment.severity,
      ["technical", "routine", "limited", "meaningful", "major", "critical"],
      "limited",
    ),
    material_offset: nullableString(assessment.material_offset),
    alert_driver: nullableString(assessment.alert_driver),
  };
}

function normalizeAssessmentValue(
  value: unknown,
  allowed: string[],
  fallback: string,
) {
  const normalized = stringValue(value).toLowerCase().replace(/[\s-]+/g, "_");
  return allowed.includes(normalized) ? normalized : fallback;
}

function ntSeverityScoreBand(severity: string) {
  if (severity === "technical") return { minimum: 0, maximum: 24 };
  if (severity === "routine") return { minimum: 25, maximum: 39 };
  if (severity === "limited") return { minimum: 40, maximum: 59 };
  if (severity === "meaningful") return { minimum: 50, maximum: 74 };
  if (severity === "major") return { minimum: 75, maximum: 84 };
  if (severity === "critical") return { minimum: 85, maximum: 100 };
  return null;
}

function clampScore(value: unknown) {
  const score = Number(value);
  return Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function recordArray(value: unknown) {
  return Array.isArray(value)
    ? value.map(readRecord).filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(stringValue).filter(Boolean) : [];
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function nullableString(value: unknown) {
  return stringValue(value) || null;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}
