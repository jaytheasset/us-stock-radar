import type { SecFilingAnalysisInput } from "@/lib/prompts/secFilingAnalysis";
import { buildSecRequiredOutputSchema } from "@/lib/ai/secRequiredOutputSchema";
import { adaptSecFormRoomOutputForIngest, type SecFormRoomAdapterOutput } from "@/lib/sources/sec/forms/common/formRoomAdapter";
import { buildS4F4AnalysisPrompt } from "@/lib/sources/sec/forms/s4-f4/analysisPrompt";
import type { ParserOutput } from "@/lib/sources/sec/forms/s4-f4/types";
import {
  applySecValidationRepairPatches,
  escapeSecValidationJsonPointerSegment,
  hasSecValidationJsonPointer,
  readSecValidationJsonPointer,
} from "@/lib/ai/secValidationRepairPatch";

export const SEC_S4_F4_ANALYSIS_PROMPT_KEY = "sec_s4_f4_analysis";
export const SEC_S4_F4_ANALYSIS_PROMPT_VERSION = "v1";
export const SEC_S4_F4_VALIDATION_REPAIR_PROMPT_KEY = "sec_s4_f4_validation_repair";
export const SEC_S4_F4_VALIDATION_REPAIR_PROMPT_VERSION = "v1-one-pass-source-backed-patch";

export type SecS4F4ValidationRepairIssue = {
  code: string;
  warning: string;
  field_paths: string[];
  allowed_patch_paths: string[];
  candidate_source_block_ids: string[];
};

export type SecS4F4ValidationRepairPlan = {
  prompt: ReturnType<typeof buildS4F4ValidationRepairPrompt>;
  issues: SecS4F4ValidationRepairIssue[];
  allowedPatchPaths: string[];
  sourceBlockIds: string[];
};

export type SecS4F4AnalysisAdapterResult =
  | { ok: true; analysis: Record<string, unknown> }
  | { ok: false; error: string };

export function isS4F4FilingInput(input: SecFilingAnalysisInput) {
  return Boolean(readS4F4ParserOutput(input));
}

export function buildSecS4F4AnalysisPromptForInput(input: SecFilingAnalysisInput) {
  const parserOutput = readS4F4ParserOutput(input);
  if (!parserOutput) {
    throw new Error("SEC S-4/F-4 parser output is missing from filing package");
  }

  const parentFilingContext = readParentFilingContext(input);

  return {
    key: SEC_S4_F4_ANALYSIS_PROMPT_KEY,
    version: SEC_S4_F4_ANALYSIS_PROMPT_VERSION,
    system: [
      "Analyze one SEC S-4/F-4 filing from cleaned source blocks.",
      "Return the full Required Output JSON shape.",
      "Use display_payload.display_type=generic for the common filing detail page.",
      "Do not use spac_transaction_status for S-4/F-4 runtime output.",
      "Score means investor attention and urgency. Delivery is derived later from score only.",
    ].join("\n"),
    user: buildS4F4AnalysisPrompt(parserOutput, undefined, readMarketContext(input), null, parentFilingContext),
    responseFormat: {
      json_schema: {
        name: "sec_s4_f4_required_output",
        strict: false,
        schema: s4F4RequiredOutputSchema,
      },
    },
  };
}

export function buildSecS4F4ValidationRepairPlan({
  analysisResult,
  input,
}: {
  analysisResult: Record<string, unknown>;
  input: SecFilingAnalysisInput;
}): SecS4F4ValidationRepairPlan | null {
  const parserOutput = readS4F4ParserOutput(input);
  const root = readRecord(analysisResult);
  const analysisOutput = readRecord(root?.analysis_output);
  const displayPayload = readRecord(root?.display_payload);
  const data = readRecord(displayPayload?.data);
  if (!parserOutput || !root || !analysisOutput || !displayPayload || !data) return null;

  const warnings = [
    ...collectS4F4RuntimeDisplayPayloadWarnings(displayPayload),
    ...collectS4F4RuntimeAnalysisWarnings(analysisOutput),
  ];
  const issues: SecS4F4ValidationRepairIssue[] = [];
  const summaryPath = "/display_payload/data/filing_summary";
  if (
    warnings.some((warning) => /filing_summary/i.test(warning)) &&
    hasSecValidationJsonPointer(root, summaryPath) &&
    !stringValue(readSecValidationJsonPointer(root, summaryPath))
  ) {
    issues.push(buildS4F4RepairIssue("missing_filing_summary", "The visible filing summary is empty.", [summaryPath]));
  }

  collectS4F4PlaceholderRepairIssues(analysisOutput, "/analysis_output", issues);
  collectS4F4PlaceholderRepairIssues(data, "/display_payload/data", issues);

  const dedupedIssues = dedupeS4F4RepairIssues(issues);
  if (!dedupedIssues.length) return null;
  const sourceBlocks = selectS4F4RepairSourceBlocks(buildS4F4RepairSourceBlocks(parserOutput), dedupedIssues, root);
  if (!sourceBlocks.length) return null;

  const sourceBlockIds = sourceBlocks.map((block) => stringValue(block.block_id)).filter(Boolean);
  const issuesWithSources = dedupedIssues.map((issue) => ({
    ...issue,
    candidate_source_block_ids: sourceBlockIds,
  }));
  const allowedPatchPaths = uniqueStrings(issuesWithSources.flatMap((issue) => issue.allowed_patch_paths));

  return {
    prompt: buildS4F4ValidationRepairPrompt({
      analysisResult: root,
      issues: issuesWithSources,
      allowedPatchPaths,
      sourceBlocks,
    }),
    issues: issuesWithSources,
    allowedPatchPaths,
    sourceBlockIds,
  };
}

export function applySecS4F4ValidationRepairPatches({
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

export function adaptSecS4F4AnalysisPromptResultForAnalysis(
  value: unknown,
  input: SecFilingAnalysisInput,
): SecS4F4AnalysisAdapterResult {
  const parserOutput = readS4F4ParserOutput(input);
  const root = readRecord(value);
  const analysisOutput = readRecord(root?.analysis_output);
  const displayPayload = readRecord(root?.display_payload);
  if (!parserOutput || !analysisOutput || !displayPayload) {
    return {
      ok: false,
      error: "SEC S-4/F-4 result did not contain parser_output, analysis_output, and LLM display_payload",
    };
  }

  appendS4F4DisplayWarnings(displayPayload, [
    ...collectS4F4RuntimeDisplayPayloadWarnings(displayPayload),
    ...collectS4F4RuntimeAnalysisWarnings(analysisOutput),
  ]);

  const requiredOutput = {
    parser_output: parserOutput,
    analysis_output: normalizeS4F4AnalysisOutput(analysisOutput, input),
    display_payload: displayPayload,
  };
  const adapted = adaptSecFormRoomOutputForIngest(requiredOutput);
  if (!adapted.ok) {
    return {
      ok: false,
      error: `SEC S-4/F-4 Required Output JSON failed validation: ${adapted.errors.join("; ")}`,
    };
  }

  return {
    ok: true,
    analysis: s4F4AdapterOutputToAnalysis(adapted.value),
  };
}

export function collectS4F4RuntimeDisplayPayloadWarnings(value: Record<string, unknown>) {
  const warnings: string[] = [];
  const data = readRecord(value.data);
  if (!data || Object.keys(data).length === 0) {
    warnings.push("SEC S-4/F-4 display_payload.data must be filled by the analysis LLM.");
    return warnings;
  }
  if (!stringValue(data.filing_summary)) {
    warnings.push("SEC S-4/F-4 display_payload.data.filing_summary is required.");
  }
  if (!Array.isArray(data.key_terms)) {
    warnings.push("SEC S-4/F-4 display_payload.data.key_terms is required.");
  }
  return warnings;
}

export function collectS4F4RuntimeAnalysisWarnings(value: Record<string, unknown>) {
  const warnings: string[] = [];
  const keyEvidence = readStringArray(value.key_evidence);
  if (keyEvidence.length > 3) {
    warnings.push(`SEC S-4/F-4 analysis_output.key_evidence must contain no more than 3 items; received ${keyEvidence.length}.`);
  }
  keyEvidence.forEach((item, index) => {
    const wordCount = item.split(/\s+/).filter(Boolean).length;
    if (wordCount >= 22) {
      warnings.push(`SEC S-4/F-4 analysis_output.key_evidence[${index}] must stay under 22 words; received ${wordCount}.`);
    }
  });
  return warnings;
}

function appendS4F4DisplayWarnings(displayPayload: Record<string, unknown>, warnings: string[]) {
  const uniqueWarnings = uniqueStrings(warnings);
  if (!uniqueWarnings.length) return;
  const data = readRecord(displayPayload.data) ?? {};
  displayPayload.data = data;
  data.display_warnings = uniqueStrings([...readStringArray(data.display_warnings), ...uniqueWarnings]);
  displayPayload.notes = uniqueStrings([...readStringArray(displayPayload.notes), ...uniqueWarnings]);
}

function buildS4F4ValidationRepairPrompt({
  analysisResult,
  issues,
  allowedPatchPaths,
  sourceBlocks,
}: {
  analysisResult: Record<string, unknown>;
  issues: SecS4F4ValidationRepairIssue[];
  allowedPatchPaths: string[];
  sourceBlocks: Array<Record<string, unknown>>;
}) {
  return {
    key: SEC_S4_F4_VALIDATION_REPAIR_PROMPT_KEY,
    version: SEC_S4_F4_VALIDATION_REPAIR_PROMPT_VERSION,
    system: [
      "Repair one completed SEC S-4/F-4 analysis in one bounded pass.",
      "Validator warnings identify possible inconsistencies but are not evidence.",
      "Use only the selected original source blocks and the existing result as evidence.",
      "Return scalar replacement patches only for exact allowed paths. Never add, remove, reorder, truncate, or rewrite arrays or objects.",
      "Preserve event classification, score, signal, display mode, transaction subtype, amendment status, and all fields not explicitly allowed.",
      "If the source blocks do not support a reliable replacement, return the issue as unresolved instead of guessing.",
      "This is the only repair attempt. Return JSON only.",
    ].join("\n"),
    user: JSON.stringify(
      {
        task: "Patch only source-verifiable validator issues in the existing S-4/F-4 analysis.",
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
        name: "sec_s4_f4_validation_repair",
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

function collectS4F4PlaceholderRepairIssues(
  value: unknown,
  path: string,
  issues: SecS4F4ValidationRepairIssue[],
) {
  if (typeof value === "string") {
    if (hasS4F4VisiblePlaceholder(value)) {
      issues.push(
        buildS4F4RepairIssue(
          "unresolved_visible_placeholder",
          `Visible output contains unresolved placeholder text at ${path}.`,
          [path],
        ),
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectS4F4PlaceholderRepairIssues(item, `${path}/${index}`, issues));
    return;
  }
  const record = readRecord(value);
  if (!record) return;
  for (const [key, child] of Object.entries(record)) {
    if (key === "display_warnings") continue;
    collectS4F4PlaceholderRepairIssues(child, `${path}/${escapeSecValidationJsonPointerSegment(key)}`, issues);
  }
}

function hasS4F4VisiblePlaceholder(value: string) {
  const text = stringValue(value);
  return Boolean(
    /\$\s*(?:and|to|-)\s*\$/i.test(text) ||
      /\bbetween\s+\$\s+(?:and|to|-)\s+\$/i.test(text) ||
      /\$\s*(?:per\s+(?:share|unit|ADS)|million|billion)\b/i.test(text) ||
      /\$\s*$/i.test(text) ||
      /\[\s*[●•?]\s*\]|_{2,}/.test(text)
  );
}

function buildS4F4RepairSourceBlocks(parserOutput: ParserOutput) {
  return parserOutput.cleaned_source_blocks
    .map((block, index) => {
      const text = stringValue(block.text);
      if (!text || block.block_type === "parser_warning" || block.block_type === "source_noise_summary") return null;
      const stem = `${block.block_type}_${block.title}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 48);
      return {
        block_id: `s4f4_${stem || "source"}_${index + 1}`,
        source_ref: block.source,
        block_type: block.block_type,
        label: block.title,
        text: clipS4F4RepairText(text, 5_000),
        source_order: index,
      };
    })
    .filter((block): block is NonNullable<typeof block> => Boolean(block));
}

function selectS4F4RepairSourceBlocks(
  blocks: Array<Record<string, unknown>>,
  issues: SecS4F4ValidationRepairIssue[],
  analysisResult: Record<string, unknown>,
) {
  const issueText = issues.map((issue) => `${issue.code} ${issue.warning}`).join(" ").toLowerCase();
  const currentText = issues
    .flatMap((issue) => issue.field_paths)
    .map((path) => stringValue(readSecValidationJsonPointer(analysisResult, path)))
    .join(" ")
    .toLowerCase();
  const keywords = uniqueStrings(
    `${issueText} ${currentText}`
      .replace(/[^a-z0-9$%.]+/g, " ")
      .split(/\s+/)
      .filter((word) => word.length >= 5)
      .slice(0, 30),
  );

  return blocks
    .map((block) => {
      const blockLabel = `${stringValue(block.block_type)} ${stringValue(block.label)}`;
      const content = `${blockLabel} ${stringValue(block.text)}`.toLowerCase();
      let score = /transaction|merger|combination|consideration|exchange|vote|ownership|closing|amendment/i.test(blockLabel) ? 8 : 0;
      score += keywords.reduce((total, keyword) => total + (content.includes(keyword) ? 1 : 0), 0);
      return { block, score, order: numberValue(block.source_order) ?? 0 };
    })
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, 3)
    .sort((a, b) => a.order - b.order)
    .map(({ block }) => block);
}

function buildS4F4RepairIssue(code: string, warning: string, paths: string[]): SecS4F4ValidationRepairIssue {
  return {
    code,
    warning,
    field_paths: paths,
    allowed_patch_paths: paths,
    candidate_source_block_ids: [],
  };
}

function dedupeS4F4RepairIssues(issues: SecS4F4ValidationRepairIssue[]) {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}:${issue.allowed_patch_paths.join("|")}`;
    if (!issue.allowed_patch_paths.length || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function clipS4F4RepairText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function s4F4AdapterOutputToAnalysis(value: SecFormRoomAdapterOutput) {
  const score = clampScore(numberValue(value.analysis_output.score) ?? 0);
  const archiveSummary =
    nullableString(value.analysis_output.archive_summary) ||
    (score < 50 ? nullableString(value.analysis_output.summary) : null);

  return {
    ...value.analysis_output,
    score,
    archive_summary: archiveSummary,
    display_payload: value.metadata.display_payload,
    display_payload_storage_target: value.metadata.display_payload_storage_target,
    display_payload_storage_mode: value.metadata.display_payload_storage_mode,
    candidate_special_metadata_only: value.metadata.candidate_special_metadata_only,
    sec_s4_f4_analysis_mode: "analysis_only",
  };
}

function normalizeS4F4AnalysisOutput(value: Record<string, unknown>, input: SecFilingAnalysisInput) {
  const filingPackage = readFilingPackage(input);
  const primaryTicker = normalizePrimaryTicker(readRecord(value.primary_ticker), filingPackage);

  return {
    ...value,
    source_group: stringValue(value.source_group) || "filings",
    market_scope: stringValue(value.market_scope) || "company",
    primary_ticker: primaryTicker,
    tickers: normalizeTickerRows(value.tickers, primaryTicker, "primary"),
    related_tickers: normalizeTickerRows(value.related_tickers, primaryTicker, "related"),
    bullish_points: readStringArray(value.bullish_points),
    bearish_points: readStringArray(value.bearish_points),
    key_evidence: readStringArray(value.key_evidence),
    what_to_watch_next: readStringArray(value.what_to_watch_next),
    calendar_items: Array.isArray(value.calendar_items) ? value.calendar_items : [],
    confidence: normalizeConfidence(stringValue(value.confidence)),
    needs_human_review: value.needs_human_review === true,
  };
}

function normalizeTickerRows(value: unknown, primaryTicker: { ticker: string | null; exchange: string | null }, role: string) {
  const rows = Array.isArray(value) ? value : [];
  const normalized: Array<Record<string, unknown>> = [];
  for (const item of rows) {
    const record = readRecord(item);
    const ticker = stringValue(record?.ticker) || stringValue(item);
    if (!ticker) continue;
    normalized.push({
      ticker,
      exchange: stringValue(record?.exchange) || (ticker === primaryTicker.ticker ? primaryTicker.exchange : null),
      role: stringValue(record?.role) || role,
      reason: stringValue(record?.reason) || null,
    });
  }

  if (role === "primary" && primaryTicker.ticker && !normalized.some((item) => item.ticker === primaryTicker.ticker)) {
    normalized.unshift({
      ticker: primaryTicker.ticker,
      exchange: primaryTicker.exchange,
      role: "primary",
      reason: "Primary SEC filing ticker",
    });
  }

  return normalized;
}

function normalizePrimaryTicker(record: Record<string, unknown> | null, filingPackage: Record<string, unknown>) {
  const packagePrimary = readRecord(filingPackage.primary_ticker);
  const ticker = nullableString(record?.ticker) || nullableString(packagePrimary?.ticker) || nullableString(filingPackage.ticker);
  const exchange = nullableString(record?.exchange) || nullableString(packagePrimary?.exchange);
  return {
    ticker: ticker ? ticker.toUpperCase() : null,
    exchange,
  };
}

function readS4F4ParserOutput(input: SecFilingAnalysisInput): ParserOutput | null {
  const filingPackage = readFilingPackage(input);
  const hardParsers = readRecord(filingPackage.hard_parsers);
  return (readRecord(hardParsers?.s4_f4) || readRecord(hardParsers?.["s4-f4"])) as ParserOutput | null;
}

function readFilingPackage(input: SecFilingAnalysisInput) {
  return readRecord(input.filing_package) || {};
}

function readMarketContext(input: SecFilingAnalysisInput) {
  const filingPackage = readFilingPackage(input);
  return readRecord(filingPackage.market_context);
}

function readParentFilingContext(input: SecFilingAnalysisInput) {
  const filingPackage = readFilingPackage(input);
  return readRecord(filingPackage.parent_filing_context);
}

function normalizeConfidence(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "high" || normalized === "medium" || normalized === "low") return normalized;
  return "medium";
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => stringValue(item)).filter(Boolean) : [];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 0)));
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

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

const s4F4RequiredOutputSchema = {
  ...buildSecRequiredOutputSchema({
    displayTypes: ["generic"],
    analysisOutputProperties: {
      key_evidence: {
        type: "array",
        maxItems: 3,
        description: "Never return more than three items.",
        items: {
          type: "string",
          maxLength: 180,
          description: "Use fewer than 22 words and only concrete, source-backed facts.",
        },
      },
    },
    displayDataRequired: ["filing_summary", "key_terms"],
    displayDataProperties: {
      display_version: { type: ["string", "null"] },
      form_type: { type: ["string", "null"] },
      filing_summary: { type: "string" },
      key_terms: { type: "array", items: { type: ["string", "object"], additionalProperties: true } },
      amendment_context: { type: ["string", "null"] },
      source_inventory: { type: "array", items: { type: ["string", "object"], additionalProperties: true } },
    },
  }),
};
