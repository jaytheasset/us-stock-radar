import type { SecFilingAnalysisInput } from "@/lib/prompts/secFilingAnalysis";
import { adaptSecFormRoomOutputForIngest, type SecFormRoomAdapterOutput } from "@/lib/sources/sec/forms/common/formRoomAdapter";
import {
  buildDeterministicOwnershipResult,
  buildOwnershipDisplayPayload,
  type OwnershipParserOutput,
} from "@/lib/sources/sec/forms/ownership/parser";
import { buildOwnershipAnalysisPrompt } from "@/lib/sources/sec/forms/ownership/analysisPrompt";
import {
  applySecValidationRepairPatches,
  escapeSecValidationJsonPointerSegment,
  hasSecValidationJsonPointer,
  readSecValidationJsonPointer,
} from "@/lib/ai/secValidationRepairPatch";

export const SEC_OWNERSHIP_ANALYSIS_PROMPT_KEY = "sec_ownership_analysis";
export const SEC_OWNERSHIP_ANALYSIS_PROMPT_VERSION = "v1";
export const SEC_OWNERSHIP_VALIDATION_REPAIR_PROMPT_KEY = "sec_ownership_validation_repair";
export const SEC_OWNERSHIP_VALIDATION_REPAIR_PROMPT_VERSION = "v1-one-pass-source-backed-patch";

export type SecOwnershipValidationRepairIssue = {
  code: string;
  warning: string;
  field_paths: string[];
  allowed_patch_paths: string[];
  candidate_source_block_ids: string[];
};

export type SecOwnershipValidationRepairPlan = {
  prompt: ReturnType<typeof buildOwnershipValidationRepairPrompt>;
  issues: SecOwnershipValidationRepairIssue[];
  allowedPatchPaths: string[];
  sourceBlockIds: string[];
};

export type SecOwnershipAnalysisPrompt = {
  key: string;
  version: string;
  system: string;
  user: string;
  responseFormat: {
    json_schema: Record<string, unknown>;
  };
};

export type SecOwnershipAnalysisAdapterResult =
  | { ok: true; analysis: Record<string, unknown> }
  | { ok: false; error: string };

export function isOwnershipFilingInput(input: SecFilingAnalysisInput) {
  if (readSecFormAnalysisMode(input) === "ownership_direct_analysis") return Boolean(readOwnershipParserOutput(input));
  return Boolean(readOwnershipParserOutput(input));
}

export function buildDeterministicOwnershipAnalysis(input: SecFilingAnalysisInput): SecOwnershipAnalysisAdapterResult | null {
  const parserOutput = readOwnershipParserOutput(input);
  if (!parserOutput) return null;

  const deterministicResult = buildDeterministicOwnershipResult(parserOutput);
  if (!deterministicResult) return null;

  return adaptOwnershipRoomResultForAnalysis(deterministicResult, parserOutput, true);
}

export function buildSecOwnershipAnalysisPrompt(input: SecFilingAnalysisInput): SecOwnershipAnalysisPrompt {
  const parserOutput = readOwnershipParserOutput(input);
  if (!parserOutput) {
    throw new Error("SEC ownership parser output is missing from filing package");
  }
  return {
    key: SEC_OWNERSHIP_ANALYSIS_PROMPT_KEY,
    version: SEC_OWNERSHIP_ANALYSIS_PROMPT_VERSION,
    system: [
      "Analyze one SEC ownership filing from cleaned source blocks only.",
      "There is no router LLM. Return strict JSON for the ownership Required Output JSON shape.",
      "Use filing_context.ownership when present as compact site-provided history; absence of filing_context must not fail analysis.",
      "Do not request live DB, FMP, SEC, or market-data lookups.",
      "Do not include full raw XML/source text in the analysis output.",
      "Do not use parser-generated facts, signals, route hints, event labels, display labels, or safety classifications as analysis authority.",
    ].join("\n"),
    user: `${buildOwnershipAnalysisPrompt(parserOutput)}

Site-provided filing_context, optional:
${JSON.stringify(readFilingContext(input), null, 2)}

Integration addendum:
- Do not rewrite parser_output in runtime output. Integration preserves the actual parser output from the filing package.
- For archive scores, use analysis_output.archive_summary when helpful; otherwise analysis_output.summary will be copied to archive_summary for archive display.`,
    responseFormat: {
      json_schema: {
        name: "sec_ownership_required_output",
        strict: false,
        schema: ownershipRequiredOutputJsonSchema,
      },
    },
  };
}

export function buildSecOwnershipValidationRepairPlan({
  analysisResult,
  input,
}: {
  analysisResult: Record<string, unknown>;
  input: SecFilingAnalysisInput;
}): SecOwnershipValidationRepairPlan | null {
  const parserOutput = readOwnershipParserOutput(input);
  const root = readRecord(analysisResult);
  const analysisOutput = readRecord(root?.analysis_output);
  const displayPayload = readRecord(root?.display_payload);
  const data = readRecord(displayPayload?.data);
  if (!parserOutput || !root || !analysisOutput || !displayPayload || !data) return null;

  const warnings = collectOwnershipRuntimeDisplayPayloadWarnings(displayPayload);
  const issues: SecOwnershipValidationRepairIssue[] = [];
  const filingSummaryPath = "/display_payload/data/filing_summary";
  if (
    warnings.some((warning) => /filing_summary|ownership details/i.test(warning)) &&
    hasSecValidationJsonPointer(root, filingSummaryPath) &&
    !stringValue(readSecValidationJsonPointer(root, filingSummaryPath))
  ) {
    issues.push(buildOwnershipRepairIssue("missing_filing_summary", "The visible ownership filing summary is empty.", [filingSummaryPath]));
  }
  collectOwnershipPlaceholderRepairIssues(analysisOutput, "/analysis_output", issues);
  collectOwnershipPlaceholderRepairIssues(data, "/display_payload/data", issues);

  const dedupedIssues = dedupeOwnershipRepairIssues(issues);
  if (!dedupedIssues.length) return null;
  const sourceBlocks = buildOwnershipRepairSourceBlocks(parserOutput);
  if (!sourceBlocks.length) return null;
  const sourceBlockIds = sourceBlocks.map((block) => stringValue(block.block_id)).filter(Boolean);
  const issuesWithSources = dedupedIssues.map((issue) => ({
    ...issue,
    candidate_source_block_ids: sourceBlockIds,
  }));
  const allowedPatchPaths = uniqueStrings(issuesWithSources.flatMap((issue) => issue.allowed_patch_paths));

  return {
    prompt: buildOwnershipValidationRepairPrompt({
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

export function applySecOwnershipValidationRepairPatches({
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

export function adaptOwnershipPromptResultForAnalysis(
  value: unknown,
  input: SecFilingAnalysisInput,
): SecOwnershipAnalysisAdapterResult {
  return adaptOwnershipRoomResultForAnalysis(value, readOwnershipParserOutput(input));
}

function readOwnershipParserOutput(input: SecFilingAnalysisInput): OwnershipParserOutput | null {
  const filingPackage = readRecord(input.filing_package);
  const hardParsers = readRecord(filingPackage?.hard_parsers);
  const ownership = readRecord(hardParsers?.ownership);
  return ownership ? (ownership as unknown as OwnershipParserOutput) : null;
}

function readSecFormAnalysisMode(input: SecFilingAnalysisInput) {
  const filingPackage = readRecord(input.filing_package);
  const adapter = readRecord(filingPackage?.form_adapter);
  return stringValue(adapter?.analysisMode);
}

function readFilingContext(input: SecFilingAnalysisInput) {
  const filingPackage = readRecord(input.filing_package);
  return readRecord(filingPackage?.filing_context) || null;
}

function adaptOwnershipRoomResultForAnalysis(
  value: unknown,
  parserOutput: OwnershipParserOutput | null,
  isDeterministic = false,
): SecOwnershipAnalysisAdapterResult {
  const requiredOutput = normalizeOwnershipRequiredOutput(value, parserOutput, isDeterministic);
  if (!requiredOutput) {
    return {
      ok: false,
      error: "SEC ownership result did not contain Required Output JSON fields",
    };
  }

  if (!isDeterministic) {
    appendOwnershipDisplayWarnings(
      requiredOutput.display_payload,
      collectOwnershipRuntimeDisplayPayloadWarnings(requiredOutput.display_payload),
    );
  }

  const adapted = adaptSecFormRoomOutputForIngest(requiredOutput);
  if (!adapted.ok) {
    return {
      ok: false,
      error: `SEC ownership Required Output JSON failed validation: ${adapted.errors.join("; ")}`,
    };
  }

  return {
    ok: true,
    analysis: ownershipAdapterOutputToAnalysis(adapted.value),
  };
}

function normalizeOwnershipRequiredOutput(
  value: unknown,
  parserOutput: OwnershipParserOutput | null,
  isDeterministic: boolean,
) {
  const root = readRecord(value);
  if (!root) return null;

  const analysisOutput = readRecord(root.analysis_output);
  const parserDisplayPayload = isDeterministic && parserOutput
    ? (buildOwnershipDisplayPayload(parserOutput) as unknown as Record<string, unknown>)
    : null;
  const llmDisplayPayload = readRecord(root.display_payload);
  const displayPayload =
    isDeterministic
      ? normalizeOwnershipRuntimeDisplayPayload(llmDisplayPayload, parserDisplayPayload)
      : llmDisplayPayload;
  const outputParser = (parserOutput as unknown as Record<string, unknown> | null) || readRecord(root.parser_output);

  if (!analysisOutput || !displayPayload || !outputParser) return null;

  return {
    parser_output: outputParser,
    analysis_output: analysisOutput,
    display_payload: normalizeOwnershipDisplayPayloadForRuntime(displayPayload),
  };
}

function normalizeOwnershipDisplayPayloadForRuntime(displayPayload: Record<string, unknown>) {
  return {
    ...displayPayload,
    data: readRecord(displayPayload.data) || {},
    evidence: arrayValue(displayPayload.evidence),
    notes: arrayValue(displayPayload.notes),
  };
}

function normalizeOwnershipRuntimeDisplayPayload(
  llmDisplayPayload: Record<string, unknown> | null,
  parserDisplayPayload: Record<string, unknown> | null,
) {
  if (!llmDisplayPayload) return parserDisplayPayload;
  if (!parserDisplayPayload) return llmDisplayPayload;

  const llmData = readRecord(llmDisplayPayload.data) || {};
  const parserData = readRecord(parserDisplayPayload.data) || {};
  if (hasOwnershipTransactionDisplayData(llmData)) return llmDisplayPayload;

  return {
    ...parserDisplayPayload,
    display_type: stringValue(llmDisplayPayload.display_type) || parserDisplayPayload.display_type,
    data: {
      ...parserData,
      ...pickOwnershipDisplayCopyFields(llmData),
    },
    evidence: arrayValue(llmDisplayPayload.evidence).length
      ? arrayValue(llmDisplayPayload.evidence)
      : arrayValue(parserDisplayPayload.evidence),
    notes: arrayValue(llmDisplayPayload.notes).length
      ? arrayValue(llmDisplayPayload.notes)
      : arrayValue(parserDisplayPayload.notes),
  };
}

function hasOwnershipTransactionDisplayData(data: Record<string, unknown>) {
  return Boolean(readRecord(data.form4) || readRecord(data.form144));
}

export function collectOwnershipRuntimeDisplayPayloadWarnings(displayPayload: Record<string, unknown>) {
  const warnings: string[] = [];
  const data = readRecord(displayPayload.data);
  if (!data || Object.keys(data).length === 0) {
    warnings.push("SEC ownership display_payload.data must be filled by the analysis LLM.");
    return warnings;
  }
  if (!hasOwnershipTransactionDisplayData(data) && !stringValue(data.filing_summary)) {
    warnings.push("SEC ownership display_payload.data must include LLM-authored ownership details or filing_summary.");
  }
  return warnings;
}

function appendOwnershipDisplayWarnings(displayPayload: Record<string, unknown>, warnings: string[]) {
  const uniqueWarnings = uniqueStrings(warnings);
  if (!uniqueWarnings.length) return;
  const data = readRecord(displayPayload.data) ?? {};
  displayPayload.data = data;
  data.display_warnings = uniqueStrings([...readStringArray(data.display_warnings), ...uniqueWarnings]);
  displayPayload.notes = uniqueStrings([...readStringArray(displayPayload.notes), ...uniqueWarnings]);
}

function buildOwnershipValidationRepairPrompt({
  analysisResult,
  issues,
  allowedPatchPaths,
  sourceBlocks,
}: {
  analysisResult: Record<string, unknown>;
  issues: SecOwnershipValidationRepairIssue[];
  allowedPatchPaths: string[];
  sourceBlocks: Array<Record<string, unknown>>;
}) {
  return {
    key: SEC_OWNERSHIP_VALIDATION_REPAIR_PROMPT_KEY,
    version: SEC_OWNERSHIP_VALIDATION_REPAIR_PROMPT_VERSION,
    system: [
      "Repair one completed SEC Ownership analysis in one bounded pass.",
      "Validator warnings identify possible inconsistencies but are not evidence.",
      "Use only the selected original SEC source excerpt and the existing result as evidence.",
      "Return scalar replacement patches only for exact allowed paths. Never add, remove, reorder, truncate, or rewrite arrays or objects.",
      "Preserve event classification, score, signal, display mode, transaction type, amendment status, and all fields not explicitly allowed.",
      "Keep Form 144 proposed-sale language distinct from executed Form 4 transactions.",
      "If the source excerpt does not support a reliable replacement, return the issue as unresolved instead of using parser facts or guessing.",
      "This is the only repair attempt. Return JSON only.",
    ].join("\n"),
    user: JSON.stringify(
      {
        task: "Patch only source-verifiable validator issues in the existing Ownership analysis.",
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
        name: "sec_ownership_validation_repair",
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

function collectOwnershipPlaceholderRepairIssues(
  value: unknown,
  path: string,
  issues: SecOwnershipValidationRepairIssue[],
) {
  if (typeof value === "string") {
    if (hasOwnershipVisiblePlaceholder(value)) {
      issues.push(
        buildOwnershipRepairIssue(
          "unresolved_visible_placeholder",
          `Visible output contains unresolved placeholder text at ${path}.`,
          [path],
        ),
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectOwnershipPlaceholderRepairIssues(item, `${path}/${index}`, issues));
    return;
  }
  const record = readRecord(value);
  if (!record) return;
  for (const [key, child] of Object.entries(record)) {
    if (key === "display_warnings") continue;
    collectOwnershipPlaceholderRepairIssues(child, `${path}/${escapeSecValidationJsonPointerSegment(key)}`, issues);
  }
}

function hasOwnershipVisiblePlaceholder(value: string) {
  const text = stringValue(value);
  return Boolean(
    /\$\s*(?:and|to|-)\s*\$/i.test(text) ||
      /\bbetween\s+\$\s+(?:and|to|-)\s+\$/i.test(text) ||
      /\$\s*(?:per\s+(?:share|unit)|shares?|securities?|million|billion)\b/i.test(text) ||
      /\$\s*$/i.test(text) ||
      /\[\s*[●•?]\s*\]|_{2,}/.test(text)
  );
}

function buildOwnershipRepairSourceBlocks(parserOutput: OwnershipParserOutput) {
  const raw = readRecord(parserOutput.raw);
  const sourceExcerpt = stringValue(raw?.source_excerpt);
  if (!sourceExcerpt) return [];
  return [
    {
      block_id: "ownership_original_source_excerpt_1",
      source_ref: "SEC ownership source excerpt",
      block_type: "original_source_excerpt",
      label: "Current ownership filing source excerpt",
      text: sourceExcerpt,
      source_order: 0,
    },
  ];
}

function buildOwnershipRepairIssue(code: string, warning: string, paths: string[]): SecOwnershipValidationRepairIssue {
  return {
    code,
    warning,
    field_paths: paths,
    allowed_patch_paths: paths,
    candidate_source_block_ids: [],
  };
}

function dedupeOwnershipRepairIssues(issues: SecOwnershipValidationRepairIssue[]) {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}:${issue.allowed_patch_paths.join("|")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function pickOwnershipDisplayCopyFields(data: Record<string, unknown>) {
  const result: Record<string, unknown> = {};
  for (const key of [
    "filing_summary",
    "summary",
    "quick_take",
    "score_reason",
    "what_to_watch_next",
    "key_evidence",
  ]) {
    if (data[key] !== undefined && data[key] !== null && data[key] !== "") result[key] = data[key];
  }
  return result;
}

function ownershipAdapterOutputToAnalysis(value: SecFormRoomAdapterOutput) {
  const score = clampSecScore(numberValue(value.analysis_output.score) ?? 0);
  const archiveSummary =
    nullableSecString(value.analysis_output.archive_summary) ||
    (score < 50 ? nullableSecString(value.analysis_output.summary) : null);

  return {
    ...value.analysis_output,
    archive_summary: archiveSummary,
    display_payload: value.metadata.display_payload,
    display_payload_storage_target: value.metadata.display_payload_storage_target,
    display_payload_storage_mode: value.metadata.display_payload_storage_mode,
    candidate_special_metadata_only: value.metadata.candidate_special_metadata_only,
  };
}

function clampSecScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 0)));
}

function nullableSecString(value: unknown) {
  const text = stringValue(value);
  return text || null;
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

function arrayValue(value: unknown) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => stringValue(item)).filter(Boolean) : [];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

const ownershipRequiredOutputJsonSchema = {
  type: "object",
  additionalProperties: true,
  required: ["analysis_output", "display_payload"],
  properties: {
    parser_output: {
      type: "object",
      additionalProperties: true,
    },
    analysis_output: {
      type: "object",
      additionalProperties: true,
      required: [
        "source_group",
        "market_scope",
        "event_type",
        "event_title",
        "primary_ticker",
        "tickers",
        "sector",
        "industry_group",
        "theme_group",
        "sub_theme",
        "score",
        "score_reason",
        "signal",
        "quick_take",
        "summary",
        "why_it_matters",
        "bullish_points",
        "bearish_points",
        "key_evidence",
        "what_to_watch_next",
        "related_tickers",
        "calendar_items",
        "confidence",
        "needs_human_review",
      ],
      properties: {
        source_group: { type: "string", enum: ["filings"] },
        market_scope: { type: "string", enum: ["company", "sector", "theme", "macro"] },
        event_type: {
          type: "string",
          enum: [
            "listing_risk",
            "dilution_risk",
            "ipo_listing",
            "earnings",
            "sales_performance",
            "product_update",
            "leadership_governance",
            "insider_ownership",
            "shareholder_vote",
            "strategic_transaction",
            "financial_risk",
            "legal_risk",
            "dividends",
            "capital_return",
            "fda_clinical",
            "other",
          ],
        },
        event_title: { type: "string" },
        primary_ticker: {
          type: ["object", "null"],
          additionalProperties: true,
        },
        tickers: { type: "array", items: { type: "object", additionalProperties: true } },
        sector: { type: ["string", "null"] },
        industry_group: { type: ["string", "null"] },
        theme_group: { type: ["string", "null"] },
        sub_theme: { type: ["string", "null"] },
        score: { type: "integer", minimum: 0, maximum: 100 },
        score_reason: { type: "string" },
        signal: { type: "string", enum: ["bullish", "bearish", "volatile", "neutral"] },
        quick_take: { type: "string" },
        summary: { type: "string" },
        why_it_matters: { type: "string" },
        bullish_points: { type: "array", items: { type: "string" } },
        bearish_points: { type: "array", items: { type: "string" } },
        key_evidence: { type: "array", items: { type: "string" } },
        what_to_watch_next: { type: "array", items: { type: "string" } },
        related_tickers: { type: "array", items: { type: "object", additionalProperties: true } },
        calendar_items: { type: "array", items: { type: "object", additionalProperties: true } },
        confidence: { type: "string", enum: ["high", "medium", "low"] },
        needs_human_review: { type: "boolean" },
        archive_summary: { type: ["string", "null"] },
      },
    },
    display_payload: {
      type: "object",
      additionalProperties: true,
      required: ["display_type", "data", "evidence", "notes"],
      properties: {
        display_type: { type: "string", enum: ["generic", "offering_terms", "candidate_special"] },
        data: {
          type: "object",
          additionalProperties: true,
          required: ["filing_summary"],
          properties: {
            filing_summary: { type: "string" },
            form4: { type: ["object", "null"], additionalProperties: true },
            form144: { type: ["object", "null"], additionalProperties: true },
          },
        },
        evidence: { type: "array", items: { type: ["string", "object"], additionalProperties: true } },
        notes: { type: "array", items: { type: ["string", "object"], additionalProperties: true } },
      },
    },
  },
} as const;
