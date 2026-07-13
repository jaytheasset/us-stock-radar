import type { SecFilingAnalysisInput } from "@/lib/prompts/secFilingAnalysis";
import { adaptSecFormRoomOutputForIngest, type SecFormRoomAdapterOutput } from "@/lib/sources/sec/forms/common/formRoomAdapter";
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
  collect424bDisplayPayloadWarnings,
  normalize424bOfferingDisplayModel,
  validate424bDisplayPayload,
} from "@/lib/ai/sec424bAnalysisAdapter";
import { collectSecOfferingMarketContextWarnings } from "@/lib/secOfferingMarketContext";
import {
  applySecValidationRepairPatches,
  escapeSecValidationJsonPointerSegment,
  hasSecValidationJsonPointer,
  readSecValidationJsonPointer,
} from "@/lib/ai/secValidationRepairPatch";

export {
  SEC_S3_AMENDMENT_TRIAGE_PROMPT_KEY,
  SEC_S3_AMENDMENT_TRIAGE_PROMPT_VERSION,
  SEC_S3_OFFERING_ANALYSIS_PROMPT_KEY,
};

export const SEC_S3_VALIDATION_REPAIR_PROMPT_KEY = "sec_s3_validation_repair";
export const SEC_S3_VALIDATION_REPAIR_PROMPT_VERSION = "v1-one-pass-source-backed-patch";

export type SecS3ValidationRepairIssue = {
  code: string;
  warning: string;
  field_paths: string[];
  allowed_patch_paths: string[];
  candidate_source_block_ids: string[];
};

export type SecS3ValidationRepairPlan = {
  prompt: ReturnType<typeof buildS3ValidationRepairPrompt>;
  issues: SecS3ValidationRepairIssue[];
  allowedPatchPaths: string[];
  sourceBlockIds: string[];
};

export type SecS3AnalysisAdapterResult =
  | { ok: true; analysis: Record<string, unknown> }
  | { ok: false; error: string };

export function isS3FilingInput(input: SecFilingAnalysisInput) {
  if (readSecFormAnalysisMode(input) === "s3_offering_flow") return true;

  const filingPackage = readRecord(input.filing_package);
  const formType = stringValue(filingPackage?.form_type).toUpperCase().replace(/\s+/g, "");
  if (/^S-3(?:ASR|\/A)?$/.test(formType)) return true;

  const hardParsers = readRecord(filingPackage?.hard_parsers);
  const s3 = readRecord(hardParsers?.s3);
  return s3?.is_s3_family === true;
}

export function isS3AmendmentInput(input: SecFilingAnalysisInput) {
  const filingPackage = readRecord(input.filing_package);
  const formType = stringValue(filingPackage?.form_type).toUpperCase().replace(/\s+/g, "");
  if (formType === "S-3/A" || formType === "F-3/A") return true;

  const hardParsers = readRecord(filingPackage?.hard_parsers);
  const s3 = readRecord(hardParsers?.s3);
  const amendment = readRecord(s3?.amendment);
  const amendmentFormType = stringValue(amendment?.form_type).toUpperCase().replace(/\s+/g, "");
  const amendmentNumber = numberValue(amendment?.amendment_number) || 0;
  return (
    s3?.is_s3_family === true &&
    (amendment?.is_amendment === true ||
      amendment?.isAmendment === true ||
      amendmentNumber > 0 ||
      amendmentFormType === "S-3/A" ||
      amendmentFormType === "F-3/A")
  );
}

export function buildSecS3AnalysisPrompt(input: SecFilingAnalysisInput) {
  return buildSecS3OfferingAnalysisPrompt(input);
}

export function buildSecS3TriagePrompt(input: SecFilingAnalysisInput) {
  return buildSecS3AmendmentTriagePrompt(input);
}

export function buildSecS3ValidationRepairPlan({
  analysisResult,
  input,
}: {
  analysisResult: Record<string, unknown>;
  input: SecFilingAnalysisInput;
}): SecS3ValidationRepairPlan | null {
  const root = readRecord(analysisResult);
  const analysisOutput = readRecord(root?.analysis_output);
  const displayPayload = normalizeS3DisplayPayloadForParentContext(readRecord(root?.display_payload), input);
  const data = readRecord(displayPayload?.data);
  if (!root || !analysisOutput || !displayPayload || !data) return null;

  const issues: SecS3ValidationRepairIssue[] = [];
  const warnings = [
    validate424bDisplayPayload(displayPayload, {
      requireKeyCashTermFacts: true,
      requireMixedComponents: false,
      strictLabels: false,
    }),
    ...collect424bDisplayPayloadWarnings(displayPayload),
  ].filter(Boolean) as string[];

  const investorTakeawayPath = "/display_payload/data/investor_takeaway";
  if (
    Object.prototype.hasOwnProperty.call(data, "investor_takeaway") &&
    !stringValue(data.investor_takeaway) &&
    warnings.some((warning) => /investor_takeaway/i.test(warning))
  ) {
    issues.push(buildS3RepairIssue("missing_investor_takeaway", warnings.find((warning) => /investor_takeaway/i.test(warning)) || "Investor takeaway is empty.", [investorTakeawayPath]));
  }

  collectS3PlaceholderRepairIssues(analysisOutput, "/analysis_output", issues);
  collectS3PlaceholderRepairIssues(data, "/display_payload/data", issues);
  collectS3OverhangRepairIssues(analysisResult, analysisOutput, data, warnings, issues);

  const dedupedIssues = dedupeS3RepairIssues(issues);
  if (!dedupedIssues.length) return null;
  const sourceBlocks = selectS3RepairSourceBlocks(buildS3RepairSourceBlocks(input), dedupedIssues, analysisResult);
  if (!sourceBlocks.length) return null;
  const sourceBlockIds = sourceBlocks.map((block) => stringValue(block.block_id)).filter(Boolean);
  const issuesWithSources = dedupedIssues.map((issue) => ({ ...issue, candidate_source_block_ids: sourceBlockIds }));
  const allowedPatchPaths = uniqueStrings(issuesWithSources.flatMap((issue) => issue.allowed_patch_paths));

  return {
    prompt: buildS3ValidationRepairPrompt({
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

export function applySecS3ValidationRepairPatches({
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

function buildS3ValidationRepairPrompt({
  analysisResult,
  issues,
  allowedPatchPaths,
  sourceBlocks,
}: {
  analysisResult: Record<string, unknown>;
  issues: SecS3ValidationRepairIssue[];
  allowedPatchPaths: string[];
  sourceBlocks: Array<Record<string, unknown>>;
}) {
  return {
    key: SEC_S3_VALIDATION_REPAIR_PROMPT_KEY,
    version: SEC_S3_VALIDATION_REPAIR_PROMPT_VERSION,
    system: [
      "Repair one completed SEC S-3/F-3 analysis in one bounded pass.",
      "Validator warnings identify possible inconsistencies but are not evidence.",
      "Use only the selected original source blocks and the existing result as evidence.",
      "Return scalar replacement patches only for exact allowed paths. Never add, remove, reorder, or rewrite arrays or objects.",
      "Preserve event classification, score, signal, display mode, amendment status, and all fields not explicitly allowed.",
      "Preserve counted, conditional, alternative, reference, fixed, variable, pending, and not-calculable distinctions.",
      "If the source blocks do not support a reliable replacement, return the issue as unresolved instead of guessing.",
      "This is the only repair attempt. Return JSON only.",
    ].join("\n"),
    user: JSON.stringify(
      {
        task: "Patch only source-verifiable validator issues in the existing S-3/F-3 analysis.",
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
        name: "sec_s3_validation_repair",
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

function buildS3RepairIssue(code: string, warning: string, paths: string[]): SecS3ValidationRepairIssue {
  return {
    code,
    warning: warning.replace(/^SEC 424B\b/, "SEC S3"),
    field_paths: paths,
    allowed_patch_paths: paths,
    candidate_source_block_ids: [],
  };
}

function collectS3PlaceholderRepairIssues(value: unknown, path: string, issues: SecS3ValidationRepairIssue[]) {
  if (typeof value === "string") {
    if (hasS3VisiblePlaceholder(value)) {
      issues.push(buildS3RepairIssue("unresolved_visible_placeholder", `Visible output contains unresolved placeholder text at ${path}.`, [path]));
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectS3PlaceholderRepairIssues(item, `${path}/${index}`, issues));
    return;
  }
  const record = readRecord(value);
  if (!record) return;
  for (const [key, child] of Object.entries(record)) {
    if (key === "display_warnings") continue;
    collectS3PlaceholderRepairIssues(child, `${path}/${escapeSecValidationJsonPointerSegment(key)}`, issues);
  }
}

function hasS3VisiblePlaceholder(value: string) {
  const text = stringValue(value);
  return Boolean(
    /\$\s*(?:and|to|-)\s*\$/i.test(text) ||
      /\bbetween\s+\$\s+(?:and|to|-)\s+\$/i.test(text) ||
      /\$\s*(?:per\s+(?:share|unit|ADS)|million|billion)\b/i.test(text) ||
      /\$\s*$/i.test(text) ||
      /\[\s*[?●•]?\s*\]|_{2,}/.test(text)
  );
}

function collectS3OverhangRepairIssues(
  analysisResult: Record<string, unknown>,
  analysisOutput: Record<string, unknown>,
  data: Record<string, unknown>,
  warnings: string[],
  issues: SecS3ValidationRepairIssue[],
) {
  const shareOverhang = readRecord(data.share_overhang);
  if (!shareOverhang) return;
  const rows = Array.isArray(shareOverhang.rows)
    ? shareOverhang.rows.map((row) => readRecord(row))
    : [];
  const totalNoteKey = Object.prototype.hasOwnProperty.call(shareOverhang, "total_note") ? "total_note" : "totalNote";
  const totalNote = readRecord(shareOverhang[totalNoteKey]);

  if (warnings.some((warning) => /counted row numeric_value sum does not reconcile/i.test(warning))) {
    const path = `/display_payload/data/share_overhang/${totalNoteKey}/numerator`;
    if (hasSecValidationJsonPointer(analysisResult, path)) {
      issues.push(buildS3RepairIssue("overhang_counted_sum_mismatch", warnings.find((warning) => /counted row numeric_value sum does not reconcile/i.test(warning)) || "Counted rows do not reconcile to the numerator.", [path]));
    }
  }
  if (warnings.some((warning) => /total_note ratio does not reconcile/i.test(warning))) {
    const path = findS3RatioPath(analysisResult, shareOverhang, totalNoteKey);
    if (path) {
      issues.push(buildS3RepairIssue("overhang_ratio_math_mismatch", warnings.find((warning) => /total_note ratio does not reconcile/i.test(warning)) || "The displayed ratio does not reconcile.", [path]));
    }
  }
  if (warnings.some((warning) => /pre-funded replacement supply/i.test(warning))) {
    const paths = rows.flatMap((row, index) => {
      if (!row || !/pre[-\s]?funded/i.test(`${stringValue(row.label)} ${stringValue(row.value)} ${stringValue(row.note)}`)) return [];
      const key = Object.prototype.hasOwnProperty.call(row, "row_role") ? "row_role" : Object.prototype.hasOwnProperty.call(row, "rowRole") ? "rowRole" : "";
      const path = key ? `/display_payload/data/share_overhang/rows/${index}/${key}` : "";
      return path && hasSecValidationJsonPointer(analysisResult, path) ? [path] : [];
    });
    if (paths.length) {
      issues.push(buildS3RepairIssue("duplicate_prefunded_replacement_pool", warnings.find((warning) => /pre-funded replacement supply/i.test(warning)) || "Pre-funded replacement supply may be double-counted.", paths));
    }
  }

  const expectedRatio = parseS3Percent(
    stringValue(totalNote?.ratio) || stringValue(shareOverhang.ratio_value || shareOverhang.ratioValue) || stringValue(shareOverhang.status_value || shareOverhang.statusValue),
  );
  const hasExcludedRows = rows.some((row) => ["conditional", "alternative", "reference"].includes(s3RowRole(row)));
  if (expectedRatio === null || !hasExcludedRows) return;
  for (const [field, value] of readS3AnalysisProseFields(analysisOutput)) {
    if (!hasS3ConflictingOverhangPercent(value, expectedRatio)) continue;
    const path = s3AnalysisFieldToJsonPointer(field);
    if (hasSecValidationJsonPointer(analysisResult, path)) {
      issues.push(buildS3RepairIssue("conflicting_overhang_percentage", `${field} conflicts with the headline overhang ratio.`, [path]));
    }
  }
}

function readS3AnalysisProseFields(analysisOutput: Record<string, unknown>): Array<[string, unknown]> {
  const fields: Array<[string, unknown]> = [
    ["event_title", analysisOutput.event_title],
    ["quick_take", analysisOutput.quick_take],
    ["summary", analysisOutput.summary],
    ["score_reason", analysisOutput.score_reason],
  ];
  const scoreExplanation = readRecord(analysisOutput.score_explanation);
  if (scoreExplanation) {
    fields.push(["score_explanation.summary", scoreExplanation.summary], ["score_explanation.final_read", scoreExplanation.final_read]);
  }
  return fields;
}

function hasS3ConflictingOverhangPercent(value: unknown, expectedRatio: number) {
  const text = stringValue(value);
  return [...text.matchAll(/\d[\d,]*(?:\.\d+)?\s*%/g)].some((match) => {
    const index = match.index ?? 0;
    const context = text.slice(Math.max(0, index - 90), index + match[0].length + 90);
    if (!/dilut|overhang|supply|current\s+shares?|outstanding\s+shares?/i.test(context)) return false;
    const parsed = parseS3Percent(match[0]);
    return parsed !== null && Math.abs(parsed - expectedRatio) > 0.05;
  });
}

function parseS3Percent(value: string) {
  const match = value.match(/(-?\d[\d,]*(?:\.\d+)?)\s*%/);
  if (!match) return null;
  const parsed = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function s3RowRole(row: Record<string, unknown> | null) {
  return stringValue(row?.row_role || row?.rowRole).toLowerCase().replace(/[\s-]+/g, "_");
}

function findS3RatioPath(analysisResult: Record<string, unknown>, shareOverhang: Record<string, unknown>, totalNoteKey: string) {
  const candidates = [
    `/display_payload/data/share_overhang/${totalNoteKey}/ratio`,
    `/display_payload/data/share_overhang/${Object.prototype.hasOwnProperty.call(shareOverhang, "ratio_value") ? "ratio_value" : "ratioValue"}`,
    `/display_payload/data/share_overhang/${Object.prototype.hasOwnProperty.call(shareOverhang, "status_value") ? "status_value" : "statusValue"}`,
  ];
  return candidates.find((path) => hasSecValidationJsonPointer(analysisResult, path)) || "";
}

function s3AnalysisFieldToJsonPointer(field: string) {
  return `/analysis_output/${field.split(".").map(escapeSecValidationJsonPointerSegment).join("/")}`;
}

function buildS3RepairSourceBlocks(input: SecFilingAnalysisInput) {
  const filingPackage = readRecord(input.filing_package);
  const hardParsers = readRecord(filingPackage?.hard_parsers);
  const s3 = readRecord(hardParsers?.s3);
  const blocks = Array.isArray(s3?.cleaned_source_blocks) ? s3.cleaned_source_blocks : [];
  return blocks
    .map((item, index) => {
      const block = readRecord(item);
      const text = stringValue(block?.text);
      if (!block || !text) return null;
      const stem = `${stringValue(block.source)}_${stringValue(block.block_type)}_${stringValue(block.label)}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 48);
      return {
        block_id: `s3_${stem || "source"}_${index + 1}`,
        source_ref: stringValue(block.source),
        block_type: stringValue(block.block_type),
        label: stringValue(block.label),
        text: clipS3RepairText(text, 5_000),
        source_order: index,
      };
    })
    .filter((block): block is NonNullable<typeof block> => Boolean(block));
}

function selectS3RepairSourceBlocks(
  blocks: Array<Record<string, unknown>>,
  issues: SecS3ValidationRepairIssue[],
  analysisResult: Record<string, unknown>,
) {
  const issueText = issues.map((issue) => `${issue.code} ${issue.warning}`).join(" ").toLowerCase();
  const currentText = issues
    .flatMap((issue) => issue.field_paths)
    .map((path) => stringValue(readSecValidationJsonPointer(analysisResult, path)))
    .join(" ")
    .toLowerCase();
  const keywords = uniqueStrings(`${issueText} ${currentText}`.replace(/[^a-z0-9$%.]+/g, " ").split(/\s+/).filter((word) => word.length >= 5).slice(0, 30));
  return blocks
    .map((block) => {
      const content = `${stringValue(block.block_type)} ${stringValue(block.label)} ${stringValue(block.text)}`.toLowerCase();
      let score = /cover|offering|dilution|capital|warrant|security|selling|prospectus/i.test(`${stringValue(block.block_type)} ${stringValue(block.label)}`) ? 8 : 0;
      score += keywords.reduce((total, keyword) => total + (content.includes(keyword) ? 1 : 0), 0);
      return { block, score, order: numberValue(block.source_order) ?? 0 };
    })
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, 3)
    .sort((a, b) => a.order - b.order)
    .map(({ block }) => block);
}

function clipS3RepairText(value: string, maxLength: number) {
  const text = stringValue(value);
  if (text.length <= maxLength) return text;
  const clipped = text.slice(0, maxLength);
  const boundary = Math.max(clipped.lastIndexOf(". "), clipped.lastIndexOf("\n"));
  return `${clipped.slice(0, boundary > maxLength * 0.6 ? boundary + 1 : maxLength).trim()}...`;
}

function dedupeS3RepairIssues(issues: SecS3ValidationRepairIssue[]) {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    issue.field_paths = uniqueStrings(issue.field_paths);
    issue.allowed_patch_paths = uniqueStrings(issue.allowed_patch_paths);
    const key = `${issue.code}:${issue.allowed_patch_paths.join("|")}`;
    if (!issue.allowed_patch_paths.length || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function adaptSecS3AnalysisPromptResultForAnalysis(
  value: unknown,
  input: SecFilingAnalysisInput,
): SecS3AnalysisAdapterResult {
  const root = readRecord(value);
  const analysisOutput = readRecord(root?.analysis_output);
  const displayPayload = normalizeS3DisplayPayloadForParentContext(readRecord(root?.display_payload), input);
  const filingPackage = readRecord(input.filing_package);
  if (!analysisOutput || !displayPayload) {
    return {
      ok: false,
      error: "SEC S3 result did not contain analysis_output and display_payload",
    };
  }

  const rawDisplayPayloadError = validate424bDisplayPayload(displayPayload, {
    requireKeyCashTermFacts: true,
    requireMixedComponents: false,
    strictLabels: false,
  });
  const downgradedDisplayPayloadWarnings: string[] = [];
  if (rawDisplayPayloadError) {
    downgradedDisplayPayloadWarnings.push(rawDisplayPayloadError.replace(/^SEC 424B\b/, "SEC S3"));
  }
  const displayPayloadWarnings = [
    ...downgradedDisplayPayloadWarnings,
    ...collect424bDisplayPayloadWarnings(displayPayload).map((warning) =>
      warning.replace(/^SEC 424B\b/, "SEC S3"),
    ),
    ...collectSecOfferingMarketContextWarnings(filingPackage?.market_context, "SEC S3"),
  ];
  appendS3DisplayWarnings(displayPayload, displayPayloadWarnings);

  const normalizedValue = {
    ...root,
    analysis_output: alignS3AnalysisOutputToDisplayPayload(
      normalizeS3AnalysisTickerMetadata(analysisOutput, input),
      displayPayload,
    ),
    display_payload: displayPayload,
    parser_output: normalizeS3ParserOutput(root?.parser_output, input),
  };
  const adapted = adaptSecFormRoomOutputForIngest(normalizedValue);
  if (!adapted.ok) {
    return {
      ok: false,
      error: `SEC S3 Required Output JSON failed validation: ${adapted.errors.join("; ")}`,
    };
  }

  return {
    ok: true,
    analysis: adapterOutputToAnalysis(adapted.value, displayPayloadWarnings),
  };
}

function normalizeS3DisplayPayloadForParentContext(
  displayPayload: Record<string, unknown> | null,
  input: SecFilingAnalysisInput,
) {
  if (!displayPayload || !isS3AmendmentInput(input) || hasConfirmedS3ParentRegistrationContext(input)) {
    return displayPayload;
  }

  const data = readRecord(displayPayload.data);
  if (!data) return displayPayload;

  return {
    ...displayPayload,
    data: {
      ...data,
      amendment_changes: [],
    },
  };
}

function hasConfirmedS3ParentRegistrationContext(input: SecFilingAnalysisInput) {
  const filingPackage = readRecord(input.filing_package);
  const context = readRecord(filingPackage?.parent_registration_context);
  return (
    stringValue(context?.status) === "found" &&
    context?.confirmed_parent === true &&
    context?.comparison_allowed === true
  );
}

function adapterOutputToAnalysis(value: SecFormRoomAdapterOutput, displayPayloadWarnings: string[] = []) {
  const score = clampScore(numberValue(value.analysis_output.score) ?? 0);
  const archiveSummary =
    nullableString(value.analysis_output.archive_summary) ||
    (score < 50 ? nullableString(value.analysis_output.summary) : null);
  const displayPayload = readRecord(value.metadata.display_payload);
  const displayPayloadData = readRecord(displayPayload?.data);
  const offeringDisplayModel =
    stringValue(displayPayload?.display_type) === "offering_terms"
      ? normalize424bOfferingDisplayModel(displayPayloadData)
      : readRecord(value.analysis_output.offering_display_model);

  return {
    ...value.analysis_output,
    score,
    archive_summary: archiveSummary,
    display_payload: value.metadata.display_payload,
    display_payload_storage_target: value.metadata.display_payload_storage_target,
    display_payload_storage_mode: value.metadata.display_payload_storage_mode,
    candidate_special_metadata_only: value.metadata.candidate_special_metadata_only,
    offering_display_model: offeringDisplayModel,
    sec_s3_display_warnings: displayPayloadWarnings,
    sec_s3_analysis_mode: "analysis_only",
    sec_offering_analysis_mode: "analysis_only",
  };
}

function normalizeS3AnalysisTickerMetadata(
  value: Record<string, unknown>,
  input: SecFilingAnalysisInput,
) {
  const filingPackage = readRecord(input.filing_package) || {};
  const packagePrimary = readRecord(filingPackage.primary_ticker);
  const ticker = nullableString(packagePrimary?.ticker) || nullableString(filingPackage.ticker);
  const exchange = nullableString(packagePrimary?.exchange);
  const primaryTicker = ticker
    ? {
        ticker: ticker.toUpperCase(),
        exchange,
      }
    : null;

  return {
    ...value,
    why_it_matters: stringValue(value.why_it_matters),
    bullish_points: readStringArray(value.bullish_points),
    bearish_points: readStringArray(value.bearish_points),
    key_evidence: readStringArray(value.key_evidence),
    what_to_watch_next: readStringArray(value.what_to_watch_next),
    calendar_items: Array.isArray(value.calendar_items) ? value.calendar_items : [],
    primary_ticker: primaryTicker,
    tickers: primaryTicker
      ? [
          {
            ticker: primaryTicker.ticker,
            exchange: primaryTicker.exchange,
            role: "primary",
            reason: "Primary SEC filing ticker",
          },
        ]
      : [],
    related_tickers: [],
  };
}

function alignS3AnalysisOutputToDisplayPayload(
  analysis: Record<string, unknown>,
  displayPayload: Record<string, unknown>,
) {
  if (stringValue(displayPayload.display_type) !== "offering_terms") return analysis;
  return {
    ...analysis,
    why_it_matters: "",
    bullish_points: [],
    bearish_points: [],
    key_evidence: [],
    what_to_watch_next: [],
    related_tickers: [],
    calendar_items: [],
  };
}

function appendS3DisplayWarnings(displayPayload: Record<string, unknown>, warnings: string[]) {
  if (!warnings.length) return;
  const data = readRecord(displayPayload.data);
  if (!data) return;
  const existing = Array.isArray(data.display_warnings)
    ? data.display_warnings.map((item) => stringValue(item)).filter(Boolean)
    : [];
  data.display_warnings = uniqueStrings([...existing, ...warnings]);
}

function normalizeS3ParserOutput(value: unknown, input: SecFilingAnalysisInput) {
  const parser = readRecord(value) || {};
  const filingPackage = readRecord(input.filing_package) || {};
  const hardParsers = readRecord(filingPackage.hard_parsers) || {};
  const s3 = readRecord(hardParsers.s3) || {};
  return {
    ...parser,
    parserVersion: stringValue(parser.parserVersion) || stringValue(s3.parser_version) || "sec_s3_parser_v1",
    parserGroup: stringValue(parser.parserGroup) || "s3",
    formType: stringValue(parser.formType) || stringValue(filingPackage.form_type) || stringValue(s3.form_type) || "S-3",
    accessionNumber:
      stringValue(parser.accessionNumber) ||
      stringValue(filingPackage.accession_number) ||
      stringValue(s3.accession_number) ||
      null,
    isSupported: typeof parser.isSupported === "boolean" ? parser.isSupported : true,
    facts: readRecord(parser.facts) || {
      company_name: filingPackage.company_name || null,
      primary_ticker: filingPackage.primary_ticker || null,
      offering_terms: readRecord(s3.offering_terms) || null,
    },
    signals: Array.isArray(parser.signals) ? parser.signals : [],
    calendarItems: Array.isArray(parser.calendarItems) ? parser.calendarItems : [],
    warnings: Array.isArray(parser.warnings) ? parser.warnings : [],
    raw: readRecord(parser.raw) || {},
  };
}

function readSecFormAnalysisMode(input: SecFilingAnalysisInput) {
  const filingPackage = readRecord(input.filing_package);
  const adapter = readRecord(filingPackage?.form_adapter);
  return stringValue(adapter?.analysisMode);
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

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => stringValue(item)).filter(Boolean) : [];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function nullableString(value: unknown) {
  const text = stringValue(value);
  return text || null;
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}
