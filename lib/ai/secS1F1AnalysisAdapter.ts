import type { SecFilingAnalysisInput } from "@/lib/prompts/secFilingAnalysis";
import { adaptSecFormRoomOutputForIngest, type SecFormRoomAdapterOutput } from "@/lib/sources/sec/forms/common/formRoomAdapter";
import {
  buildS1F1AnalysisPrompt,
  type S1F1AnalysisPromptVariant,
} from "@/lib/sources/sec/forms/s1-f1/analysisPrompt";
import { APPROVED_SEC_EVENT_TYPES, type S1F1ParserOutput } from "@/lib/sources/sec/forms/s1-f1/types";
import { normalize424bOfferingDisplayModel } from "@/lib/ai/sec424bAnalysisAdapter";
import { collectSecOfferingMarketContextWarnings } from "@/lib/secOfferingMarketContext";
import { marketTaxonomyAnalysisOutputSchemaProperties } from "@/lib/marketTaxonomySchema";
import {
  offeringDisplayRowSchema,
  scoreExplanationSchema,
  shareOverhangSchema,
} from "@/lib/ai/secOfferingOutputSchemas";
import {
  applySecValidationRepairPatches,
  escapeSecValidationJsonPointerSegment as escapeJsonPointerSegment,
  hasSecValidationJsonPointer as hasJsonPointer,
  readSecValidationJsonPointer as readJsonPointer,
} from "@/lib/ai/secValidationRepairPatch";
import {
  applyMinimalOfferingMonitorBoundary,
  MINIMAL_OFFERING_MONITOR_PROMPT,
  minimalOfferingMonitorProviderSchema,
} from "@/lib/minimalOfferingMonitor";

export const SEC_S1_F1_ANALYSIS_PROMPT_KEY = "sec_s1_f1_analysis";
export const SEC_S1_F1_ANALYSIS_PROMPT_VERSION = "v35-compact-offering-monitor-payload";
const SEC_F1_LEGACY_ANALYSIS_PROMPT_VERSION = "v32-pending-terms-default";
// Legacy backup: pre-pending-terms default prompt kept selectable only in the debug console.
export const SEC_S1_F1_LEGACY_BACKUP_PROMPT_VERSION = "v28-spac-ipo-minimal-legacy-backup";
export const SEC_S1_F1_VALIDATION_REPAIR_PROMPT_KEY = "sec_s1_f1_validation_repair";
export const SEC_S1_F1_VALIDATION_REPAIR_PROMPT_VERSION = "v2-pending-placeholder-patch";

const S1_F1_SHARE_OVERHANG_PERCENT_TOLERANCE = 0.049;

const ALLOWED_S1_F1_DISPLAY_MODES = new Set([
  "ipo_registration",
  "ipo_amendment",
  "routine_amendment",
  "resale_registration",
  "atm",
  "primary_offering",
  "pending_primary_offering",
  "registered_direct",
  "warrant_convertible",
  "rights_offering",
  "shelf_capacity",
  "mixed_offering",
  "mixed_registration",
  "spac_ipo",
  "rule_462b_mef",
  "post_effective_amendment",
  "generic",
]);

const S1_F1_OFFERING_DETAIL_LABELS_BY_MODE: Record<string, readonly string[]> = {
  ipo_registration: [],
  ipo_amendment: [
    "Lead underwriters",
    "Underwriter option",
    "Primary / secondary mix",
    "Use of proceeds",
    "Lock-up",
    "Control / voting structure",
    "Foreign issuer / VIE structure",
    "Listing condition",
    "Directed share program",
    "ADS ratio",
    "Selling shareholders",
  ],
  resale_registration: [
    "Offering Type",
    "Selling Holders",
    "Agreement Date",
    "Resale Method",
    "Sale Price",
    "Source Instrument",
    "Purchase Limit",
    "Exchange Cap",
    "Ownership Limit",
    "Six-month Cap",
    "Conversion Price",
    "Floor Price",
    "Reset / Repricing",
    "Sales to Date",
    "Approx. Placement Price",
    "Use of Proceeds",
    "Registration Obligation",
  ],
  atm: ["Offering Type", "Sales Agent", "Fee / Commission", "Agreement Date", "End Date", "Use of Proceeds"],
  primary_offering: [
    "Offering Type",
    "Underwriter",
    "Placement Agent / Underwriter",
    "Closing Date",
    "Agreement Date",
    "Use of Proceeds",
    "Warrant Terms",
  ],
  registered_direct: [
    "Offering Type",
    "Purchaser / Investor",
    "Placement Agent / Underwriter",
    "Warrant Terms",
    "Closing Date",
    "Agreement Date",
    "Use of Proceeds",
  ],
  warrant_convertible: [
    "Offering Type",
    "Purchaser / Investor",
    "Placement Agent / Underwriter",
    "Warrant Terms",
    "Exercise Price",
    "Conversion Price",
    "Reset / Repricing",
    "Floor Price",
    "Closing Date",
    "Agreement Date",
    "Use of Proceeds",
  ],
  rights_offering: [
    "Offering Type",
    "Record Date",
    "Subscription Period",
    "Oversubscription",
    "Backstop / Dealer Manager",
    "Use of Proceeds",
  ],
  shelf_capacity: [
    "Offering Type",
    "Shelf Status",
    "Securities Covered",
    "Active Sale Terms",
    "Next Required Filing",
    "Use of Proceeds",
  ],
  mixed_offering: [
    "Offering Type",
    "Component Summary",
    "Units offered",
    "Purchaser / Investor",
    "Selling Holders",
    "Placement Agent",
    "Placement Agent / Underwriter",
    "Assumed Offering Price",
    "Assumed Public Offering Price",
    "Assumed Combined Public Offering Price",
    "Public Offering Price",
    "Company Proceeds",
    "Source Instrument",
    "Concurrent Private Placement",
    "Warrant Terms",
    "ADS Ratio",
    "Underlying ADS Basis",
    "Control / voting structure",
    "Control structure",
    "Listing condition",
    "Lock-up",
    "Use of Proceeds",
  ],
  mixed_registration: [
    "Offering Type",
    "Component Summary",
    "Units offered",
    "Purchaser / Investor",
    "Selling Holders",
    "Placement Agent",
    "Placement Agent / Underwriter",
    "Assumed Offering Price",
    "Assumed Public Offering Price",
    "Assumed Combined Public Offering Price",
    "Public Offering Price",
    "Company Proceeds",
    "Source Instrument",
    "Concurrent Private Placement",
    "Warrant Terms",
    "ADS Ratio",
    "Underlying ADS Basis",
    "Control / voting structure",
    "Control structure",
    "Listing condition",
    "Lock-up",
    "Use of Proceeds",
  ],
  spac_ipo: ["Sponsor", "Acquisition Strategy", "Trust Account", "Redemption Terms", "Unit Components", "Proposed Exchange"],
  rule_462b_mef: [
    "Prior registration statement",
    "Prior registered amount",
    "Rule 462(b) status",
    "Securities added",
    "Fee table",
  ],
  post_effective_amendment: [],
  routine_amendment: [],
  generic: [],
};

export type SecS1F1AnalysisAdapterResult =
  | { ok: true; analysis: Record<string, unknown> }
  | { ok: false; error: string };

export type SecS1F1ValidationRepairIssue = {
  code: string;
  warning: string;
  field_paths: string[];
  allowed_patch_paths: string[];
  candidate_source_block_ids: string[];
};

export type SecS1F1ValidationRepairPlan = {
  prompt: ReturnType<typeof buildS1F1ValidationRepairPrompt>;
  issues: SecS1F1ValidationRepairIssue[];
  allowedPatchPaths: string[];
  sourceBlockIds: string[];
};

export function isS1F1FilingInput(input: SecFilingAnalysisInput) {
  return Boolean(readS1F1ParserOutput(input));
}

function normalizeS1F1PromptVariant(value: unknown): S1F1AnalysisPromptVariant {
  return value === "legacy_default_backup" ? "legacy_default_backup" : "default";
}

export function buildSecS1F1AnalysisPromptForInput(
  input: SecFilingAnalysisInput,
  options: { promptVariant?: S1F1AnalysisPromptVariant | string } = {},
) {
  const parserOutput = withRuntimeMarketContext(readS1F1ParserOutput(input), input);
  if (!parserOutput) {
    throw new Error("SEC S-1/F-1 parser output is missing from filing package");
  }
  const promptVariant = normalizeS1F1PromptVariant(options.promptVariant);
  const monitorEnabled = isS1MonitorInput(input);
  const promptVersion =
    promptVariant === "legacy_default_backup"
      ? SEC_S1_F1_LEGACY_BACKUP_PROMPT_VERSION
      : monitorEnabled
        ? SEC_S1_F1_ANALYSIS_PROMPT_VERSION
        : SEC_F1_LEGACY_ANALYSIS_PROMPT_VERSION;

  return {
    key: SEC_S1_F1_ANALYSIS_PROMPT_KEY,
    version: promptVersion,
    system: [
      "Analyze one SEC S-1/F-1 registration filing from cleaned source blocks.",
      "Return only analysis_output and display_payload, with one primary display_payload.data.display_mode.",
      "There is no S-1/F-1 router LLM and no parser-completed display payload. Choose event_type, display_type, score, and display_payload from the source blocks.",
      "For offering_terms, generic analysis fields are storage/list compatibility only and must match the selected display payload.",
      "Use generic for the common filing detail page, offering_terms for IPO/offering/resale/MEF/POS AM registration terms, and spac_transaction_status only for source-backed de-SPAC status.",
      "For analysis_output sector and industry_group, use natural taxonomy-style names. For theme_group, use an exact slug from the response schema. For sub_theme, use a concise theme name or slug. Use null when unsupported.",
      "Score means investor attention and urgency. Delivery is derived later from score only.",
      ...(monitorEnabled ? [MINIMAL_OFFERING_MONITOR_PROMPT] : []),
    ].join("\n"),
    user: buildS1F1AnalysisPrompt(parserOutput, undefined, undefined, { variant: promptVariant }),
    responseFormat: {
      json_schema: {
        name: "sec_s1_f1_required_output",
        strict: false,
        schema: monitorEnabled ? secS1F1RequiredOutputSchema : secF1LegacyRequiredOutputSchema,
      },
    },
  };
}

export function buildSecS1F1ValidationRepairPlan({
  analysisResult,
  input,
}: {
  analysisResult: Record<string, unknown>;
  input: SecFilingAnalysisInput;
}): SecS1F1ValidationRepairPlan | null {
  const root = readRecord(analysisResult);
  const analysisOutput = readRecord(root?.analysis_output);
  const displayPayload = readRecord(root?.display_payload);
  const data = readRecord(displayPayload?.data);
  if (!root || !analysisOutput || !data) return null;

  const issues: SecS1F1ValidationRepairIssue[] = [];
  const shareOverhang = readRecord(data.share_overhang);
  const sourceBlocks = buildS1F1RepairSourceBlocks(input);

  if (shareOverhang) {
    const ratioText = readS1F1ShareOverhangRatio(shareOverhang);
    const ratio = parseS1F1PercentNumber(ratioText);
    if (ratio !== null) {
      const fields = collectS1F1ConflictingShareOverhangPercentFields(analysisOutput, shareOverhang);
      for (const field of fields) {
        const path = s1F1AnalysisFieldToJsonPointer(field);
        if (!path || !hasJsonPointer(analysisResult, path)) continue;
        issues.push({
          code: "conflicting_overhang_percentage",
          warning: `${field} contains a dilution/overhang percentage that conflicts with the displayed headline ratio ${ratioText}.`,
          field_paths: [path],
          allowed_patch_paths: [path],
          candidate_source_block_ids: [],
        });
      }
    }
    collectS1F1ShareOverhangRepairIssues(analysisResult, shareOverhang, issues);
  }

  collectS1F1PlaceholderRepairIssues(analysisOutput, "/analysis_output", issues);
  collectS1F1PlaceholderRepairIssues(data, "/display_payload/data", issues);

  const displayMode = stringValue(data.display_mode);
  if (["ipo_registration", "ipo_amendment", "spac_ipo", "rule_462b_mef"].includes(displayMode)) {
    for (const field of ["display_quick_take", "company_story"] as const) {
      const path = `/display_payload/data/${field}`;
      if (Object.prototype.hasOwnProperty.call(data, field) && !stringValue(data[field])) {
        issues.push({
          code: `missing_${field}`,
          warning: `${field} is empty even though the selected IPO/MEF display mode renders it directly.`,
          field_paths: [path],
          allowed_patch_paths: [path],
          candidate_source_block_ids: [],
        });
      }
    }
  }

  const dedupedIssues = dedupeS1F1RepairIssues(issues);
  if (!dedupedIssues.length) return null;

  const selectedSourceBlocks = selectS1F1RepairSourceBlocks(sourceBlocks, dedupedIssues, analysisResult);
  const sourceBlockIds = selectedSourceBlocks.map((block) => stringValue(block.block_id)).filter(Boolean);
  const issuesWithSources = dedupedIssues.map((issue) => ({
    ...issue,
    candidate_source_block_ids: sourceBlockIds,
  }));
  const allowedPatchPaths = uniqueStrings(issuesWithSources.flatMap((issue) => issue.allowed_patch_paths));

  return {
    prompt: buildS1F1ValidationRepairPrompt({
      analysisResult,
      issues: issuesWithSources,
      allowedPatchPaths,
      selectedSourceBlocks,
    }),
    issues: issuesWithSources,
    allowedPatchPaths,
    sourceBlockIds,
  };
}

export function applySecS1F1ValidationRepairPatches({
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

function buildS1F1ValidationRepairPrompt({
  analysisResult,
  issues,
  allowedPatchPaths,
  selectedSourceBlocks,
}: {
  analysisResult: Record<string, unknown>;
  issues: SecS1F1ValidationRepairIssue[];
  allowedPatchPaths: string[];
  selectedSourceBlocks: Array<Record<string, unknown>>;
}) {
  return {
    key: SEC_S1_F1_VALIDATION_REPAIR_PROMPT_KEY,
    version: SEC_S1_F1_VALIDATION_REPAIR_PROMPT_VERSION,
    system: [
      "Repair one completed SEC S-1/F-1 analysis in one bounded pass.",
      "The validator warning identifies a possible inconsistency but is not evidence.",
      "Use only the selected original source blocks and the existing analysis result as evidence.",
      "Return scalar replacement patches only for the exact allowed paths. Never add, remove, reorder, or rewrite arrays or objects.",
      "Preserve event classification, score, signal, display mode, and all fields that are not explicitly allowed.",
      "Preserve the distinction between counted, conditional, alternative, fixed, pending, and not calculable supply.",
      "For unresolved_visible_placeholder issues, a blank or placeholder source term is evidence that the term is not yet disclosed; replace only the affected scalar with concise pending wording instead of repeating the placeholder.",
      "Use natural phrases such as 'Price range not yet disclosed', 'Share count pending', or 'Final proceeds not yet disclosed', choosing only the term supported by the affected field and source context.",
      "Never infer, calculate, or invent a missing price, share count, proceeds amount, or dilution value while repairing a placeholder.",
      "If the selected source blocks do not support a reliable replacement, leave the issue unresolved instead of guessing.",
      "This is the only repair attempt. Return JSON only.",
    ].join("\n"),
    user: JSON.stringify(
      {
        task: "Patch only source-verifiable validator issues in the existing S-1/F-1 analysis.",
        allowed_patch_paths: allowedPatchPaths,
        validator_issues: issues,
        selected_original_source_blocks: selectedSourceBlocks,
        existing_analysis_result: analysisResult,
      },
      null,
      2,
    ),
    responseFormat: {
      json_schema: {
        name: "sec_s1_f1_validation_repair",
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
                  source_block_ids: {
                    type: "array",
                    items: { type: "string" },
                  },
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

function buildS1F1RepairSourceBlocks(input: SecFilingAnalysisInput) {
  const parserOutput = readS1F1ParserOutput(input);
  const blocks = parserOutput?.raw?.cleanedSourceBlocks ?? [];
  return blocks.map((block, index) => ({
    block_id: buildS1F1RepairBlockId(block.sectionKey, block.source, index),
    source_ref: [block.source, block.documentName, block.sectionKey].filter(Boolean).join(":"),
    origin: block.source,
    section_key: block.sectionKey,
    section_title: block.sectionTitle,
    document_name: block.documentName,
    text: clipS1F1RepairSourceText(block.text, 5_000),
    tables: block.tables.map((table) => clipS1F1RepairSourceText(table, 1_500)).filter(Boolean).slice(0, 2),
    source_order: index,
  }));
}

function buildS1F1RepairBlockId(sectionKey: string | null, source: string, index: number) {
  const stem = `${source}_${sectionKey || "section"}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return `s1f1_${stem || "source"}_${index + 1}`;
}

function clipS1F1RepairSourceText(value: string, maxLength: number) {
  const text = stringValue(value);
  if (text.length <= maxLength) return text;
  const clipped = text.slice(0, maxLength);
  const sentenceEnd = Math.max(clipped.lastIndexOf(". "), clipped.lastIndexOf("\n"));
  return `${clipped.slice(0, sentenceEnd > maxLength * 0.6 ? sentenceEnd + 1 : maxLength).trim()}...`;
}

function selectS1F1RepairSourceBlocks(
  sourceBlocks: Array<Record<string, unknown>>,
  issues: SecS1F1ValidationRepairIssue[],
  analysisResult: Record<string, unknown>,
) {
  if (!sourceBlocks.length) return [];
  const issueText = issues.map((issue) => `${issue.code} ${issue.warning}`).join(" ");
  const currentValues = issues
    .flatMap((issue) => issue.field_paths)
    .map((path) => stringValue(readJsonPointer(analysisResult, path)))
    .filter(Boolean)
    .join(" ");
  const wantsOverhang = /overhang|dilution|share|warrant|placeholder/i.test(`${issueText} ${currentValues}`);
  const wantsIpoNarrative = /display_quick_take|company_story|ipo|mef/i.test(issueText);
  const keywords = uniqueStrings(
    `${currentValues} ${issueText}`
      .toLowerCase()
      .replace(/[^a-z0-9$%.]+/g, " ")
      .split(/\s+/)
      .filter((word) => word.length >= 5)
      .slice(0, 30),
  );

  return sourceBlocks
    .map((block) => {
      const metadata = `${stringValue(block.section_key)} ${stringValue(block.section_title)} ${stringValue(block.document_name)}`;
      const content = `${metadata} ${stringValue(block.text)}`.toLowerCase();
      let score = 0;
      if (wantsOverhang && /offering|dilution|capitalization|share.count|warrant|security|cover|front.matter/i.test(metadata)) score += 12;
      if (wantsIpoNarrative && /summary|business|offering|cover|front.matter|rule.462|fee/i.test(metadata)) score += 10;
      if (/primary/i.test(stringValue(block.origin))) score += 2;
      score += keywords.reduce((total, keyword) => total + (content.includes(keyword) ? 1 : 0), 0);
      return { block, score, order: numberValue(block.source_order) ?? 0 };
    })
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, 3)
    .sort((a, b) => a.order - b.order)
    .map(({ block }) => block);
}

function collectS1F1PlaceholderRepairIssues(
  value: unknown,
  path: string,
  issues: SecS1F1ValidationRepairIssue[],
) {
  if (typeof value === "string") {
    if (hasS1F1UnresolvedPlaceholderText(value)) {
      issues.push({
        code: "unresolved_visible_placeholder",
        warning: `Visible output contains unresolved placeholder text at ${path}: ${compactWarningText(value)}`,
        field_paths: [path],
        allowed_patch_paths: [path],
        candidate_source_block_ids: [],
      });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectS1F1PlaceholderRepairIssues(item, `${path}/${index}`, issues));
    return;
  }
  const record = readRecord(value);
  if (!record) return;
  for (const [key, child] of Object.entries(record)) {
    if (key === "display_warnings") continue;
    collectS1F1PlaceholderRepairIssues(child, `${path}/${escapeJsonPointerSegment(key)}`, issues);
  }
}

function collectS1F1ShareOverhangRepairIssues(
  analysisResult: Record<string, unknown>,
  shareOverhang: Record<string, unknown>,
  issues: SecS1F1ValidationRepairIssue[],
) {
  const rawRows = Array.isArray(shareOverhang.rows) ? shareOverhang.rows : [];
  const rows = rawRows.map((item) => readRecord(item));
  const countedRows = rows.filter((row): row is Record<string, unknown> => Boolean(row && isS1F1CountedShareOverhangRow(row, true)));
  const totalNoteKey = Object.prototype.hasOwnProperty.call(shareOverhang, "total_note") ? "total_note" : "totalNote";
  const totalNote = readRecord(shareOverhang[totalNoteKey]);
  const includedRowSum = countedRows.reduce((total, row) => total + (s1F1ShareOverhangNumericValue(row) || 0), 0);
  const numerator = parseS1F1ShareCount(stringValue(totalNote?.numerator));
  const denominator = parseS1F1ShareCount(stringValue(totalNote?.denominator));
  const ratioText = readS1F1ShareOverhangRatio(shareOverhang);
  const ratio = parseS1F1PercentNumber(ratioText);

  if (
    includedRowSum > 0 &&
    numerator &&
    Math.abs(includedRowSum - numerator) / Math.max(includedRowSum, numerator) > 0.02
  ) {
    const candidatePaths = [`/display_payload/data/share_overhang/${totalNoteKey}/numerator`].filter((path) =>
      hasJsonPointer(analysisResult, path),
    );
    if (candidatePaths.length) {
      issues.push({
        code: "overhang_counted_sum_mismatch",
        warning: `Counted row sum (${includedRowSum}) does not reconcile to total numerator (${numerator}); repair only the source-inconsistent scalar or leave unresolved.`,
        field_paths: candidatePaths,
        allowed_patch_paths: candidatePaths,
        candidate_source_block_ids: [],
      });
    }
  }

  if (numerator && denominator && ratio !== null) {
    const expectedRatio = (numerator / denominator) * 100;
    if (Number.isFinite(expectedRatio) && Math.abs(expectedRatio - ratio) > S1_F1_SHARE_OVERHANG_PERCENT_TOLERANCE) {
      const ratioPath = findS1F1OverhangRatioPath(analysisResult, shareOverhang, totalNoteKey);
      if (ratioPath) {
        issues.push({
          code: "overhang_ratio_math_mismatch",
          warning: `Displayed ratio ${ratioText} does not reconcile to ${numerator} divided by ${denominator} (${expectedRatio.toFixed(1)}%).`,
          field_paths: [ratioPath],
          allowed_patch_paths: [ratioPath],
          candidate_source_block_ids: [],
        });
      }
    }
  }

  rows.forEach((row, index) => {
    if (!row) return;
    const rowText = `${stringValue(row.label)} ${stringValue(row.value)} ${stringValue(row.note)}`;
    const role = s1F1ShareOverhangRowRole(row);
    const roleKey = Object.prototype.hasOwnProperty.call(row, "row_role") ? "row_role" : Object.prototype.hasOwnProperty.call(row, "rowRole") ? "rowRole" : "";
    if (!roleKey) return;
    const path = `/display_payload/data/share_overhang/rows/${index}/${roleKey}`;
    if (role === "conditional" && isS1F1ShareEquivalentCountedText(rowText)) {
      issues.push({
        code: "share_equivalent_marked_conditional",
        warning: `${stringValue(row.label)} appears share-equivalent but is marked conditional; verify whether it is counted or an alternative replacement pool.`,
        field_paths: [path],
        allowed_patch_paths: [path],
        candidate_source_block_ids: [],
      });
    }
    if (role === "counted" && isNonShareEquivalentWarrantText(rowText)) {
      issues.push({
        code: "future_warrant_marked_counted",
        warning: `${stringValue(row.label)} appears to be future warrant exercise supply but is marked counted.`,
        field_paths: [path],
        allowed_patch_paths: [path],
        candidate_source_block_ids: [],
      });
    }
  });
}

function findS1F1OverhangRatioPath(
  analysisResult: Record<string, unknown>,
  shareOverhang: Record<string, unknown>,
  totalNoteKey: string,
) {
  const candidates = [
    `/display_payload/data/share_overhang/${totalNoteKey}/ratio`,
    `/display_payload/data/share_overhang/${Object.prototype.hasOwnProperty.call(shareOverhang, "ratio_value") ? "ratio_value" : "ratioValue"}`,
    `/display_payload/data/share_overhang/${Object.prototype.hasOwnProperty.call(shareOverhang, "status_value") ? "status_value" : "statusValue"}`,
  ];
  return candidates.find((path) => hasJsonPointer(analysisResult, path)) || "";
}

function s1F1AnalysisFieldToJsonPointer(field: string) {
  const parts = field
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean)
    .map(escapeJsonPointerSegment);
  return parts.length ? `/analysis_output/${parts.join("/")}` : "";
}

function dedupeS1F1RepairIssues(issues: SecS1F1ValidationRepairIssue[]) {
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

function withRuntimeMarketContext(parserOutput: S1F1ParserOutput | null, input: SecFilingAnalysisInput) {
  if (!parserOutput) return null;
  const filingPackage = readFilingPackage(input);
  const marketContext = readRecord(filingPackage.market_context);
  if (!marketContext || !Object.keys(marketContext).length) return parserOutput;
  return {
    ...parserOutput,
    raw: {
      ...parserOutput.raw,
      marketContext,
    },
  };
}

export function adaptSecS1F1AnalysisPromptResultForAnalysis(
  value: unknown,
  input: SecFilingAnalysisInput,
): SecS1F1AnalysisAdapterResult {
  const root = readRecord(value);
  const analysisOutput = readRecord(root?.analysis_output);
  const displayPayload = normalizeS1F1DisplayPayload(readRecord(root?.display_payload));
  const filingPackage = readFilingPackage(input);
  if (!analysisOutput || !displayPayload) {
    return {
      ok: false,
      error: "SEC S-1/F-1 result did not contain analysis_output and display_payload",
    };
  }

  const displayPayloadError = validateS1F1DisplayPayload(displayPayload);
  if (isS1MonitorInput(input)) applyMinimalOfferingMonitorBoundary(analysisOutput);
  const displayPayloadWarnings = [
    ...(displayPayloadError ? [displayPayloadError] : []),
    ...collectSecOfferingMarketContextWarnings(filingPackage.market_context, "SEC S-1/F-1"),
  ];
  const displayPayloadData = readRecord(displayPayload.data);
  if (displayPayloadData) {
    displayPayloadWarnings.push(...collectS1F1IpoDisplayWarnings(displayPayloadData, analysisOutput));
    displayPayloadWarnings.push(...collectS1F1VisiblePlaceholderWarnings(displayPayloadData, analysisOutput));
    displayPayloadWarnings.push(...collectS1F1SourceCoverageWarnings(displayPayloadData, input));
    displayPayloadWarnings.push(...collectS1F1ShareOverhangDisplayWarnings(displayPayloadData, analysisOutput));
    appendS1F1DisplayWarnings(displayPayloadData, displayPayloadWarnings);
  }

  const normalizedValue = {
    ...root,
    parser_output: normalizeS1F1ParserOutput(root?.parser_output, input),
    analysis_output: alignS1F1AnalysisOutputToDisplayPayload(
      normalizeS1F1AnalysisOutput(analysisOutput, input),
      displayPayload,
    ),
    display_payload: displayPayload,
  };
  const adapted = adaptSecFormRoomOutputForIngest(normalizedValue);
  if (!adapted.ok) {
    return {
      ok: false,
      error: `SEC S-1/F-1 Required Output JSON failed validation: ${adapted.errors.join("; ")}`,
    };
  }

  return {
    ok: true,
    analysis: adapterOutputToAnalysis(adapted.value, displayPayloadWarnings),
  };
}

function validateS1F1DisplayPayload(displayPayload: Record<string, unknown>) {
  const displayType = stringValue(displayPayload.display_type);
  if (!["generic", "offering_terms", "candidate_special", "spac_transaction_status"].includes(displayType)) {
    return `SEC S-1/F-1 display_payload.display_type is not allowed: ${displayType || "(empty)"}`;
  }
  if (displayType !== "offering_terms") return "";

  const data = readRecord(displayPayload.data);
  if (!data || !Object.keys(data).length) {
    return "SEC S-1/F-1 offering_terms display_payload.data must be filled by the analysis LLM";
  }
  const displayMode = stringValue(data.display_mode);
  if (displayMode && !ALLOWED_S1_F1_DISPLAY_MODES.has(displayMode)) {
    return `SEC S-1/F-1 offering_terms display_payload.data.display_mode is not allowed: ${displayMode}`;
  }
  if (!displayMode) {
    return "SEC S-1/F-1 offering_terms display_payload.data.display_mode must be written by the analysis LLM";
  }
  const amendmentSummaryMode = displayMode === "post_effective_amendment" || displayMode === "routine_amendment";
  const snapshotMetricsMayBeEmpty = amendmentSummaryMode;
  if (!Array.isArray(data.snapshot_metrics) || (!snapshotMetricsMayBeEmpty && !data.snapshot_metrics.length)) {
    return "SEC S-1/F-1 offering_terms display_payload.data.snapshot_metrics must be written by the analysis LLM";
  }
  const offeringDetailsMayBeEmpty = displayMode === "ipo_registration" || amendmentSummaryMode;
  if (!Array.isArray(data.offering_details) || (!offeringDetailsMayBeEmpty && !data.offering_details.length)) {
    return "SEC S-1/F-1 offering_terms display_payload.data.offering_details must be written by the analysis LLM";
  }
  if (!stringValue(data.investor_takeaway)) {
    return "SEC S-1/F-1 offering_terms display_payload.data.investor_takeaway must be written by the analysis LLM";
  }
  appendS1F1DisplayWarnings(
    data,
    [
      ...collectLabelValueRowWarnings(data.offering_details, "offering_details", {
        maxValueLength: 90,
        maxNoteLength: 80,
      }),
      ...collectOfferingDetailLabelWarnings(data.offering_details, displayMode),
    ],
  );
  const rowError =
    validateLabelValueRows(data.snapshot_metrics, "snapshot_metrics", {
      allowEmpty: snapshotMetricsMayBeEmpty,
    }) ||
    validateLabelValueRows(data.offering_details, "offering_details", {
      allowEmpty: offeringDetailsMayBeEmpty,
    }) ||
    validateLabelValueRows(data.amendment_changes, "amendment_changes", { allowEmpty: true });
  if (rowError) return rowError;
  const structuredOverhangError = validateS1F1OverhangFacts(data);
  if (structuredOverhangError) return structuredOverhangError;
  return "";
}

function validateLabelValueRows(
  value: unknown,
  fieldName: string,
  options?: { allowEmpty?: boolean },
) {
  if (value === undefined || value === null) return "";
  if (!Array.isArray(value)) return `SEC S-1/F-1 display_payload.data.${fieldName} must be an array`;
  if (!options?.allowEmpty && !value.length) {
    return `SEC S-1/F-1 display_payload.data.${fieldName} must be written by the analysis LLM`;
  }
  for (const [index, row] of value.entries()) {
    const record = readRecord(row);
    if (!record || !Object.keys(record).length) {
      return `SEC S-1/F-1 display_payload.data.${fieldName}[${index}] cannot be an empty object`;
    }
    const label = stringValue(record.label);
    const rowValue = stringValue(record.value);
    const note = stringValue(record.note);
    if (!label || !rowValue) {
      return `SEC S-1/F-1 display_payload.data.${fieldName}[${index}] must include label and value`;
    }
  }
  return "";
}

function collectLabelValueRowWarnings(
  value: unknown,
  fieldName: string,
  options: { maxValueLength?: number; maxNoteLength?: number },
) {
  if (!Array.isArray(value)) return [];
  const warnings: string[] = [];
  for (const [index, row] of value.entries()) {
    const record = readRecord(row);
    if (!record) continue;
    const rowValue = stringValue(record.value);
    const note = stringValue(record.note);
    if (options.maxValueLength && rowValue.length > options.maxValueLength) {
      warnings.push(
        `S-1/F-1 display_payload.data.${fieldName}[${index}].value exceeded ${options.maxValueLength} characters`,
      );
    }
    if (options.maxNoteLength && note.length > options.maxNoteLength) {
      warnings.push(
        `S-1/F-1 display_payload.data.${fieldName}[${index}].note exceeded ${options.maxNoteLength} characters`,
      );
    }
  }
  return warnings;
}

function collectOfferingDetailLabelWarnings(value: unknown, displayMode: string) {
  if (!Array.isArray(value)) return [];
  const allowed = S1_F1_OFFERING_DETAIL_LABELS_BY_MODE[displayMode] || [];
  if (!allowed.length) return [];
  const allowedSet = new Set(allowed.map((label) => label.toLowerCase()));
  const warnings: string[] = [];
  for (const [index, row] of value.entries()) {
    const record = readRecord(row);
    const label = stringValue(record?.label);
    if (!label || allowedSet.has(label.toLowerCase())) continue;
    warnings.push(
      `S-1/F-1 display_payload.data.offering_details[${index}].label is outside ${displayMode} candidates: ${label}`,
    );
  }
  return warnings;
}

function collectS1F1ShareOverhangDisplayWarnings(data: Record<string, unknown>, analysisOutput?: Record<string, unknown>) {
  const warnings: string[] = [];
  const shareOverhang = readRecord(data.share_overhang);
  if (!shareOverhang) return warnings;

  const caption = stringValue(shareOverhang.caption);
  const basis = readRecord(shareOverhang.basis);
  const structuredRows = Array.isArray(shareOverhang.rows) ? shareOverhang.rows : [];
  warnings.push(...collectS1F1ShareOverhangUnitWarnings(basis, structuredRows, structuredRows.length > 0));
  const hasIncludedAmount = structuredRows.some((item) => {
    const row = readRecord(item);
    return Boolean(row && isS1F1CountedShareOverhangRow(row, structuredRows.length > 0) && hasUsableS1F1ShareOverhangAmount(row));
  });
  const hasUsableBasis = hasUsableS1F1ShareOverhangAmount(basis);
  if (hasIncludedAmount && !hasUsableBasis) {
    warnings.push(
      "S-1/F-1 display_payload.data.share_overhang has numeric included supply rows but no usable numeric basis denominator; use source-block shares outstanding first, then market_context.shares_outstanding when source blocks do not provide it.",
    );
  }
  for (const item of structuredRows) {
    const row = readRecord(item);
    const label = stringValue(row?.label);
    const included = isS1F1CountedShareOverhangRow(row, structuredRows.length > 0);
    if (!hasGroupedInstrumentSeriesLabel(label) || !included) continue;
    warnings.push(
      `S-1/F-1 display_payload.data.share_overhang has grouped instrument series in an included numerator row (${label}); grouped series must share the same row_role and material economics.`,
    );
  }
  warnings.push(...collectS1F1WarrantShareOverhangWarnings(data, structuredRows, analysisOutput));
  warnings.push(...collectS1F1ShareOverhangCalculationWarnings(shareOverhang, structuredRows, analysisOutput));

  if (!caption) return warnings;

  const primaryPercent =
    firstPercentValue(stringValue(shareOverhang.status_value || shareOverhang.statusValue)) ??
    firstPercentValue(stringValue(shareOverhang.ratio_value || shareOverhang.ratioValue));
  if (primaryPercent === null) return warnings;

  const captionPercents = percentValues(caption);
  if (!captionPercents.length) return warnings;

  const hasMatchingCaptionPercent = captionPercents.some((percent) => Math.abs(percent - primaryPercent) <= S1_F1_SHARE_OVERHANG_PERCENT_TOLERANCE);
  if (hasMatchingCaptionPercent) return warnings;

  warnings.push(
    `S-1/F-1 display_payload.data.share_overhang.caption percent does not match status_value/ratio_value (${caption} vs ${primaryPercent}%).`,
  );
  return warnings;
}

function collectS1F1ShareOverhangCalculationWarnings(
  shareOverhang: Record<string, unknown>,
  rawRows: unknown[],
  analysisOutput?: Record<string, unknown>,
) {
  const warnings: string[] = [];
  const rows = rawRows.map((item) => readRecord(item)).filter((item): item is Record<string, unknown> => Boolean(item));
  const includedRows = rows.filter((row) => isS1F1CountedShareOverhangRow(row, rows.length > 0));
  const includedRowSum = includedRows.reduce((total, row) => total + (s1F1ShareOverhangNumericValue(row) || 0), 0);
  const totalNote = readRecord(shareOverhang.total_note || shareOverhang.totalNote);
  const totalNoteNumerator = parseS1F1ShareCount(stringValue(totalNote?.numerator));
  const totalNoteDenominator = parseS1F1ShareCount(stringValue(totalNote?.denominator));
  const totalNoteRatio = firstPercentValue(
    [
      stringValue(totalNote?.ratio),
      stringValue(shareOverhang.ratio_value || shareOverhang.ratioValue),
      stringValue(shareOverhang.status_value || shareOverhang.statusValue),
    ]
      .filter(Boolean)
      .join(" "),
  );

  if (
    includedRowSum > 0 &&
    totalNoteNumerator &&
    Math.abs(includedRowSum - totalNoteNumerator) / Math.max(includedRowSum, totalNoteNumerator) > 0.02
  ) {
    warnings.push(
      "S-1/F-1 share_overhang counted row numeric_value sum does not reconcile to total_note.numerator; merge alternative pools or fix row_role before relying on the displayed ratio.",
    );
  }

  if (totalNoteNumerator && totalNoteDenominator && totalNoteRatio !== null) {
    const expectedRatio = (totalNoteNumerator / totalNoteDenominator) * 100;
    if (Number.isFinite(expectedRatio) && Math.abs(expectedRatio - totalNoteRatio) > S1_F1_SHARE_OVERHANG_PERCENT_TOLERANCE) {
      warnings.push(
        "S-1/F-1 share_overhang total_note ratio does not reconcile to numerator divided by denominator; verify unit conversion and full share counts.",
      );
    }
  }

  const basis = readRecord(shareOverhang.basis);
  const basisUnit = normalizeShareOverhangUnitForWarning(stringValue(basis?.unit));
  const countedUnits = uniqueStrings(includedRows.map((row) => normalizeShareOverhangUnitForWarning(stringValue(row.unit))).filter(Boolean));
  const totalNoteText = `${stringValue(totalNote?.numerator)} ${stringValue(totalNote?.denominator)}`;
  const totalNoteUnit = detectS1F1TotalNoteUnit(totalNoteText);
  const expectedUnit = countedUnits.length === 1 ? countedUnits[0] : basisUnit;
  if (expectedUnit && totalNoteUnit && expectedUnit !== totalNoteUnit) {
    warnings.push(
      `S-1/F-1 share_overhang total_note unit appears inconsistent with counted rows/basis (${totalNoteUnit} vs ${expectedUnit}).`,
    );
  }

  if (analysisOutput) {
    const conflictingProseFields = collectS1F1ConflictingShareOverhangPercentFields(analysisOutput, shareOverhang);
    if (conflictingProseFields.length) {
      warnings.push(
        `S-1/F-1 analysis prose contains dilution/overhang percentage(s) that conflict with share_overhang.total_note.ratio in: ${conflictingProseFields.join(", ")}.`,
      );
    }
  }

  return uniqueStrings(warnings);
}

function collectS1F1ShareOverhangUnitWarnings(
  basis: Record<string, unknown> | null,
  rawRows: unknown[],
  structuredRows: boolean,
) {
  const warnings: string[] = [];
  const basisNumericValue = numberValue(basis?.numeric_value) ?? numberValue(basis?.numericValue);
  const basisUnit = stringValue(basis?.unit);
  const basisClass = stringValue(basis?.class_basis || basis?.classBasis);
  if (typeof basisNumericValue === "number" && Number.isFinite(basisNumericValue) && basisNumericValue > 0 && !basisUnit) {
    warnings.push("S-1/F-1 display_payload.data.share_overhang.basis has numeric_value but missing unit.");
  }

  for (const item of rawRows) {
    const row = readRecord(item);
    if (!row) continue;
    const numericValue = numberValue(row.numeric_value) ?? numberValue(row.numericValue);
    if (typeof numericValue !== "number" || !Number.isFinite(numericValue) || numericValue <= 0) continue;

    const rowUnit = stringValue(row.unit);
    const rowClass = stringValue(row.class_basis || row.classBasis);
    const included = isS1F1CountedShareOverhangRow(row, structuredRows);

    if (!rowUnit) {
      warnings.push(
        `S-1/F-1 display_payload.data.share_overhang row has numeric_value but missing unit: ${stringValue(row.label) || "(unlabeled)"}`,
      );
    }
    if (!included) continue;

    if (basisUnit && rowUnit && normalizeShareOverhangUnitForWarning(basisUnit) !== normalizeShareOverhangUnitForWarning(rowUnit)) {
      warnings.push(
        `S-1/F-1 display_payload.data.share_overhang headline row unit does not match basis unit: ${stringValue(row.label) || "(unlabeled)"}`,
      );
    }
    if (basisClass && rowClass && normalizeShareOverhangUnitForWarning(basisClass) !== normalizeShareOverhangUnitForWarning(rowClass)) {
      warnings.push(
        `S-1/F-1 display_payload.data.share_overhang headline row class_basis does not match basis class_basis: ${stringValue(row.label) || "(unlabeled)"}`,
      );
    }
  }

  return uniqueStrings(warnings);
}

function hasUsableS1F1ShareOverhangAmount(record: Record<string, unknown> | null) {
  if (!record) return false;
  const numericValue =
    numberValue(record.numeric_value) ??
    numberValue(record.numericValue) ??
    numberValue(record.amount);
  if (typeof numericValue === "number" && Number.isFinite(numericValue) && numericValue > 0) return true;

  const valueText = [
    stringValue(record.value),
    stringValue(record.value_text),
    stringValue(record.valueText),
  ]
    .filter(Boolean)
    .join(" ");
  if (!/\b(?:shares?|ADSs?|American Depositary Shares?|ordinary shares?|common stock)\b/i.test(valueText)) {
    return false;
  }
  return (parseS1F1ShareCount(valueText) || 0) > 0;
}

function parseS1F1ShareCount(value: string) {
  const match = value.match(/(\d[\d,]*(?:\.\d+)?)\s*(million|m|thousand|k)?/i);
  if (!match) return null;
  const base = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(base)) return null;
  const suffix = (match[2] || "").toLowerCase();
  if (suffix === "million" || suffix === "m") return Math.round(base * 1_000_000);
  if (suffix === "thousand" || suffix === "k") return Math.round(base * 1_000);
  return Math.round(base);
}

function s1F1ShareOverhangNumericValue(record: Record<string, unknown>) {
  return (
    numberValue(record.numeric_value) ??
    numberValue(record.numericValue) ??
    numberValue(record.amount) ??
    numberValue(record.share_count) ??
    numberValue(record.shareCount) ??
    parseS1F1ShareCount([stringValue(record.value), stringValue(record.value_text), stringValue(record.valueText)].filter(Boolean).join(" "))
  );
}

function s1F1ShareOverhangRowText(record: Record<string, unknown>) {
  return [
    record.label,
    record.value,
    record.note,
    record.unit,
    record.class_basis,
    record.classBasis,
    record.supply_type,
    record.supplyType,
  ]
    .map((value) => stringValue(value))
    .filter(Boolean)
    .join(" ");
}

function hasDuplicateS1F1OrdinaryPrefundedCountedRows(rows: Record<string, unknown>[]) {
  const ordinaryRows = rows.filter((row) => {
    const text = s1F1ShareOverhangRowText(row);
    return /\b(?:ordinary|common|class\s+a|ADSs?|units?)\b/i.test(text) && !/\bpre[-\s]?funded\b/i.test(text);
  });
  const combinedOrdinaryPrefundedRows = rows.filter((row) => {
    const text = s1F1ShareOverhangRowText(row);
    return /\b(?:ordinary|common|class\s+a|ADSs?|units?)\b/i.test(text) && /\bpre[-\s]?funded\b/i.test(text);
  });
  const prefundedRows = rows.filter((row) => /\bpre[-\s]?funded\b/i.test(s1F1ShareOverhangRowText(row)));
  const hasSeparateDuplicate = ordinaryRows.some((ordinaryRow) => {
    const ordinaryValue = s1F1ShareOverhangNumericValue(ordinaryRow);
    if (!ordinaryValue) return false;
    return prefundedRows.some((prefundedRow) => {
      const prefundedValue = s1F1ShareOverhangNumericValue(prefundedRow);
      return Boolean(prefundedValue && Math.abs(ordinaryValue - prefundedValue) / Math.max(ordinaryValue, prefundedValue) <= 0.01);
    });
  });
  if (hasSeparateDuplicate) return true;
  return combinedOrdinaryPrefundedRows.some((combinedRow) => {
    const combinedValue = s1F1ShareOverhangNumericValue(combinedRow);
    if (!combinedValue) return false;
    return prefundedRows.some((prefundedRow) => {
      if (prefundedRow === combinedRow) return false;
      const prefundedValue = s1F1ShareOverhangNumericValue(prefundedRow);
      return Boolean(prefundedValue && Math.abs(combinedValue - prefundedValue) / Math.max(combinedValue, prefundedValue) <= 0.01);
    });
  });
}

function normalizeShareOverhangUnitForWarning(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/\bamerican depositary shares?\b/g, "ads")
    .replace(/\badses\b/g, "ads")
    .replace(/\badss\b/g, "ads")
    .replace(/\bshares?\b/g, "shares")
    .replace(/\bunits?\b/g, "units")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (/\bads\b/.test(normalized)) return "ads";
  return normalized;
}

function detectS1F1TotalNoteUnit(value: string) {
  const normalized = normalizeShareOverhangUnitForWarning(value);
  if (/\bads\b/.test(normalized)) return "ads";
  if (/\bshares\b/.test(normalized)) return "shares";
  if (/\bunits\b/.test(normalized)) return "units";
  return "";
}

function collectS1F1ConflictingShareOverhangPercentFields(
  analysisOutput: Record<string, unknown>,
  shareOverhang: Record<string, unknown> | null,
) {
  const expectedRatio = parseS1F1PercentNumber(readS1F1ShareOverhangRatio(shareOverhang));
  if (expectedRatio === null) return [];
  const fields: Array<[string, unknown]> = [
    ["event_title", analysisOutput.event_title],
    ["quick_take", analysisOutput.quick_take],
    ["summary", analysisOutput.summary],
    ["score_reason", analysisOutput.score_reason],
  ];
  const scoreExplanation = readRecord(analysisOutput.score_explanation);
  if (scoreExplanation) {
    fields.push(
      ["score_explanation.summary", scoreExplanation.summary],
      ["score_explanation.final_read", scoreExplanation.final_read],
    );
    for (const key of ["upward_factors", "limiting_factors"]) {
      for (const [index, value] of readStringArray(scoreExplanation[key]).entries()) {
        fields.push([`score_explanation.${key}[${index}]`, value]);
      }
    }
  }
  return fields
    .filter(([, value]) => hasS1F1ConflictingPercent(value, expectedRatio))
    .map(([field]) => field);
}

function readS1F1ShareOverhangRatio(shareOverhang: Record<string, unknown> | null) {
  const totalNote = readRecord(shareOverhang?.total_note || shareOverhang?.totalNote);
  return stringValue(totalNote?.ratio) || stringValue(shareOverhang?.ratio_value || shareOverhang?.ratioValue) || stringValue(shareOverhang?.status_value || shareOverhang?.statusValue);
}

function parseS1F1PercentNumber(value: unknown) {
  const match = stringValue(value).match(/(\d[\d,]*(?:\.\d+)?)\s*%/);
  if (!match) return null;
  const parsed = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function hasS1F1ConflictingPercent(value: unknown, expectedRatio: number) {
  const text = stringValue(value);
  const matches = [...text.matchAll(/\d[\d,]*(?:\.\d+)?\s*%/g)];
  return matches.some((match) => {
    const index = match.index ?? 0;
    const context = text.slice(Math.max(0, index - 90), Math.min(text.length, index + match[0].length + 90));
    if (!/\b(?:dilut|overhang|supply|offering|current\s+shares?|outstanding\s+shares?|ratio)\b/i.test(context)) {
      return false;
    }
    const parsed = parseS1F1PercentNumber(match[0]);
    return parsed !== null && Math.abs(parsed - expectedRatio) > S1_F1_SHARE_OVERHANG_PERCENT_TOLERANCE;
  });
}

function collectS1F1WarrantShareOverhangWarnings(
  data: Record<string, unknown>,
  rawRows: unknown[],
  analysisOutput?: Record<string, unknown>,
) {
  const rows = rawRows.map((item) => readRecord(item)).filter((item): item is Record<string, unknown> => Boolean(item));
  if (!rows.length) return [];

  const warnings: string[] = [];
  for (const row of rows) {
    const label = stringValue(row.label);
    const rowText = `${label} ${stringValue(row.value)} ${stringValue(row.note)}`;
    const rowRole = s1F1ShareOverhangRowRole(row);
    const supplyType = stringValue(row.supply_type || row.supplyType);
    const countedInRatio = booleanValue(row.counted_in_ratio ?? row.countedInRatio);
    if (rowRole === "conditional" && isS1F1ShareEquivalentCountedText(rowText)) {
      warnings.push(
        `S-1/F-1 display_payload.data.share_overhang row appears share-equivalent but is marked conditional: ${label}`,
      );
    }
    if (
      (rowRole ? rowRole === "counted" : countedInRatio === true) &&
      isNonShareEquivalentWarrantText(rowText)
    ) {
      warnings.push(
        `S-1/F-1 display_payload.data.share_overhang counted row appears to include non-share-equivalent warrant supply: ${label}`,
      );
    }
    if (
      (rowRole ? rowRole === "counted" : countedInRatio === true) &&
      supplyType === "current_offering_pool" &&
      isNonShareEquivalentWarrantText(label)
    ) {
      warnings.push(
        `S-1/F-1 display_payload.data.share_overhang headline row label appears to mix accompanying warrant package text with counted current offering supply: ${label}`,
      );
    }
    if (
      (rowRole ? rowRole === "counted" : countedInRatio === true) &&
      supplyType === "share_equivalent" &&
      isNonShareEquivalentWarrantText(rowText)
    ) {
      warnings.push(
        `S-1/F-1 display_payload.data.share_overhang headline row appears to include non-share-equivalent warrant supply: ${label}`,
      );
    }
  }

  const futureExerciseRows = rows.filter((row) => {
    const rowRole = s1F1ShareOverhangRowRole(row);
    if (rowRole) return rowRole === "conditional";
    const countedInRatio = booleanValue(row.counted_in_ratio ?? row.countedInRatio);
    const supplyType = stringValue(row.supply_type || row.supplyType);
    return countedInRatio === false || supplyType === "future_exercise";
  });
  const aggregateFutureRows = futureExerciseRows.filter((row) =>
    /\b(?:all|total)\b[\s\S]{0,80}\bwarrants?\b|\b(?:warrants?\s+total|total\s+potential\s+supply|issuable\s+upon\s+exercise\s+of\s+all\s+warrants?)\b/i.test(
      `${stringValue(row.label)} ${stringValue(row.value)} ${stringValue(row.note)}`,
    ),
  );
  if (aggregateFutureRows.length && futureExerciseRows.length > aggregateFutureRows.length) {
    warnings.push(
      "S-1/F-1 display_payload.data.share_overhang includes an aggregate all-warrants future_exercise row alongside component future_exercise rows; omit the overlapping aggregate row.",
    );
  }

  const includedRows = rows.filter((row) => {
    const rowRole = s1F1ShareOverhangRowRole(row);
    if (rowRole) return rowRole === "counted";
    const countedInRatio = booleanValue(row.counted_in_ratio ?? row.countedInRatio);
    return countedInRatio === true;
  });
  if (hasDuplicateS1F1OrdinaryPrefundedCountedRows(includedRows)) {
    warnings.push(
      "S-1/F-1 share_overhang appears to count ordinary/unit supply and pre-funded replacement supply with the same numeric_value; use one ordinary-or-pre-funded current offering pool row or mark the replacement row row_role alternative.",
    );
  }

  for (const group of readInstrumentDetailGroups(data.instrument_details)) {
    if (!isNonShareEquivalentWarrantText(group.text)) continue;
    const hasVisibleConditionalRow = rows.some((row) => {
      if (!shareOverhangRowMatchesInstrument(row, group.type)) return false;
      const rowRole = s1F1ShareOverhangRowRole(row);
      if (rowRole) return rowRole === "conditional";
      const countedInRatio = booleanValue(row.counted_in_ratio ?? row.countedInRatio);
      const supplyType = stringValue(row.supply_type || row.supplyType);
      return countedInRatio === false || supplyType === "future_exercise";
    });
    if (hasVisibleConditionalRow) continue;
    warnings.push(
      `S-1/F-1 display_payload.data.instrument_details includes ${group.type}, but share_overhang.rows does not show a matching row_role conditional row.`,
    );
  }

  const instrumentGroups = readInstrumentDetailGroups(data.instrument_details);
  for (const row of rows) {
    const rowRole = s1F1ShareOverhangRowRole(row);
    const countedInRatio = booleanValue(row.counted_in_ratio ?? row.countedInRatio);
    const supplyType = stringValue(row.supply_type || row.supplyType);
    const rowText = `${stringValue(row.label)} ${stringValue(row.value)} ${stringValue(row.note)}`;
    if (rowRole ? rowRole !== "conditional" : countedInRatio !== false && supplyType !== "future_exercise") continue;
    if (!isNonShareEquivalentWarrantText(rowText)) continue;
    const hasMatchingInstrument = instrumentGroups.some((group) => shareOverhangRowMatchesInstrument(row, group.type));
    if (hasMatchingInstrument) continue;
    warnings.push(
      `S-1/F-1 display_payload.data.share_overhang includes ${stringValue(row.label)}, but instrument_details does not show a matching Type group.`,
    );
  }

  const shareOverhangContext = `${JSON.stringify(readRecord(data.share_overhang) || {})} ${JSON.stringify(data.snapshot_metrics || [])} ${stringValue(analysisOutput?.summary)} ${stringValue(analysisOutput?.quick_take)} ${stringValue(data.investor_takeaway)}`;
  const hasFutureExerciseWarrantMention = hasNonShareEquivalentWarrantMention(shareOverhangContext);
  const hasFutureExerciseWarrantRow = rows.some((row) => {
    const rowRole = s1F1ShareOverhangRowRole(row);
    const countedInRatio = booleanValue(row.counted_in_ratio ?? row.countedInRatio);
    const supplyType = stringValue(row.supply_type || row.supplyType);
    const rowText = `${stringValue(row.label)} ${stringValue(row.value)} ${stringValue(row.note)}`;
    const isConditional = rowRole ? rowRole === "conditional" : countedInRatio === false || supplyType === "future_exercise";
    return isConditional && hasNonShareEquivalentWarrantMention(rowText);
  });
  if (hasFutureExerciseWarrantMention && !hasFutureExerciseWarrantRow) {
    warnings.push(
      "S-1/F-1 display_payload mentions material warrant supply, but share_overhang.rows does not show a row_role conditional row.",
    );
  }
  if (hasFutureExerciseWarrantMention && !instrumentGroups.length) {
    warnings.push(
      "S-1/F-1 display_payload mentions material warrant supply, but instrument_details is empty.",
    );
  }

  return uniqueStrings(warnings);
}

function readInstrumentDetailGroups(value: unknown) {
  const groups: Array<{ type: string; text: string }> = [];
  let current: { type: string; parts: string[] } | null = null;

  for (const item of Array.isArray(value) ? value : []) {
    const row = readRecord(item);
    const label = stringValue(row?.label);
    const rowValue = stringValue(row?.value);
    if (!label || !rowValue) continue;
    if (label.toLowerCase() === "type") {
      current = { type: rowValue, parts: [rowValue] };
      groups.push({
        type: current.type,
        text: current.parts.join(" "),
      });
      continue;
    }
    if (!current) continue;
    current.parts.push(rowValue);
    groups[groups.length - 1] = {
      type: current.type,
      text: current.parts.join(" "),
    };
  }

  return groups;
}

function isNonShareEquivalentWarrantText(value: string) {
  if (!/\bwarrants?\b/i.test(value)) return false;
  if (/\bpre[-\s]?funded\b/i.test(value)) return false;
  if (/\b(?:zero[-\s]?exercise|zero\s+exercise\s+price|nominal[-\s]?exercise|share[-\s]?equivalent)\b/i.test(value)) return false;
  if (/\$0\.0+1\b|\$0\.0+01\b/i.test(value)) return false;
  return true;
}

function isS1F1ShareEquivalentCountedText(value: string) {
  return (
    /\bpre[-\s]?funded\b/i.test(value) ||
    /\b(?:zero[-\s]?exercise|zero\s+exercise\s+price|zero[-\s]?price\s+exercise|nominal[-\s]?exercise|share[-\s]?equivalent)\b/i.test(value) ||
    /\$0\.0+1\b|\$0\.0+01\b/i.test(value)
  );
}

function hasNonShareEquivalentWarrantMention(value: string) {
  return /\b(?:common|ordinary|placement\s+agent|agent|underwriter|representative|Series\s+[A-Z])\s+warrants?\b/i.test(value);
}

function shareOverhangRowMatchesInstrument(row: Record<string, unknown>, instrumentType: string) {
  const rowText = `${stringValue(row.label)} ${stringValue(row.value)} ${stringValue(row.note)}`;
  const normalizedRowText = normalizeInstrumentMatchText(rowText);
  const normalizedType = normalizeInstrumentMatchText(instrumentType);
  if (normalizedType && normalizedRowText.includes(normalizedType)) return true;

  const words = normalizedType.split(" ").filter((word) => word.length > 2 && word !== "warrant" && word !== "warrants");
  if (!words.length) return /\bwarrant\b/i.test(normalizedRowText);
  return words.every((word) => normalizedRowText.includes(word)) && /\bwarrant\b/i.test(normalizedRowText);
}

function normalizeInstrumentMatchText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bwarrants\b/g, "warrant")
    .replace(/\s+/g, " ")
    .trim();
}

function appendS1F1DisplayWarnings(data: Record<string, unknown>, warnings: string[]) {
  if (!warnings.length) return;
  const existing = Array.isArray(data.display_warnings)
    ? data.display_warnings.map((item) => stringValue(item)).filter(Boolean)
    : [];
  data.display_warnings = uniqueStrings([...existing, ...warnings]);
}

function collectS1F1IpoDisplayWarnings(data: Record<string, unknown>, analysisOutput: Record<string, unknown> | null) {
  const displayMode = stringValue(data.display_mode);
  if (!["ipo_registration", "ipo_amendment", "spac_ipo", "rule_462b_mef"].includes(displayMode)) return [];

  const warnings: string[] = [];
  if (!stringValue(data.display_quick_take)) {
    warnings.push(`S-1/F-1 ${displayMode} missing display_quick_take; Quick Take should not fall back to summary.`);
  }
  if (!stringValue(data.company_story)) {
    const panelName = displayMode === "rule_462b_mef" ? "Additional Registration" : "Company Overview";
    warnings.push(`S-1/F-1 ${displayMode} missing company_story; ${panelName} should not fall back to summary.`);
  }

  const summary = stringValue(analysisOutput?.summary);
  if (displayMode === "ipo_registration" && hasBlankMoneyPlaceholder(summary)) {
    warnings.push("S-1/F-1 ipo_registration analysis_output.summary contains blank price placeholders.");
  }

  return warnings;
}

function hasBlankMoneyPlaceholder(value: string) {
  return hasS1F1UnresolvedPlaceholderText(value);
}

function collectS1F1VisiblePlaceholderWarnings(
  data: Record<string, unknown>,
  analysisOutput: Record<string, unknown> | null,
) {
  const warnings: string[] = [];
  collectS1F1PlaceholderWarningsFromValue(data, "display_payload.data", warnings);
  const analysisFields = [
    "event_title",
    "title",
    "headline",
    "summary",
    "quick_take",
    "score_reason",
    "investor_takeaway",
    "archive_summary",
  ];
  for (const field of analysisFields) {
    collectS1F1PlaceholderWarningsFromValue(analysisOutput?.[field], `analysis_output.${field}`, warnings);
  }
  collectS1F1PlaceholderWarningsFromValue(analysisOutput?.score_explanation, "analysis_output.score_explanation", warnings);
  return uniqueStrings(warnings);
}

function collectS1F1PlaceholderWarningsFromValue(value: unknown, path: string, warnings: string[]) {
  if (typeof value === "string") {
    if (hasS1F1UnresolvedPlaceholderText(value)) {
      warnings.push(`S-1/F-1 visible output contains unresolved placeholder text at ${path}: ${compactWarningText(value)}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectS1F1PlaceholderWarningsFromValue(item, `${path}[${index}]`, warnings));
    return;
  }
  const record = readRecord(value);
  if (!record) return;
  for (const [key, child] of Object.entries(record)) {
    if (key === "display_warnings") continue;
    collectS1F1PlaceholderWarningsFromValue(child, `${path}.${key}`, warnings);
  }
}

function hasS1F1UnresolvedPlaceholderText(value: string) {
  const text = stringValue(value);
  if (!text) return false;
  return (
    /\$\s*(?:and|to|-)\s*\$/i.test(text) ||
    /\bbetween\s+\$\s+(?:and|to|-)\s+\$/i.test(text) ||
    /\$\s*(?:per\s+(?:share|unit|ADS|ordinary\s+unit|pre-funded\s+warrant)|million|billion)\b/i.test(text) ||
    /\b(?:estimated|approximately|approx\.?|about|up\s+to)\s+\$\s*(?:$|[.,;)]|\s+(?:in|of|for|from|before|after)\b)/i.test(text) ||
    /\$\s*$/i.test(text) ||
    /\$\s*(?:\[?\s*[●•]\s*\]?|\[\s*\]|\{\s*\}|_{2,})/i.test(text) ||
    /(?:\[?\s*[●•]\s*\]?|\[\s*\]|\{\s*\}|_{2,})\s*(?:shares?|units?|ADSs?|warrants?|per\s+share|per\s+unit|price|proceeds|amount)/i.test(text)
  );
}

function compactWarningText(value: string) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact;
}

function collectS1F1SourceCoverageWarnings(data: Record<string, unknown>, input: SecFilingAnalysisInput) {
  const displayMode = stringValue(data.display_mode);
  if (!["mixed_offering", "mixed_registration"].includes(displayMode)) return [];

  const parserOutput = readS1F1ParserOutput(input);
  const sourceText = Array.isArray(parserOutput?.raw?.cleanedSourceBlocks)
    ? parserOutput.raw.cleanedSourceBlocks.map((block) => stringValue(readRecord(block)?.text)).join("\n")
    : "";
  const hasConcurrentSeries =
    /\bSeries\s+C\s+Warrants?\b/i.test(sourceText) &&
    /\bSeries\s+D\s+Warrants?\b/i.test(sourceText) &&
    /\b(?:concurrent\s+private\s+placement|private\s+placement|VRT Prohibition|Waiver)\b/i.test(sourceText);
  if (!hasConcurrentSeries) return [];

  const offeringDetailsText = JSON.stringify(Array.isArray(data.offering_details) ? data.offering_details : []);
  const shareOverhangText = JSON.stringify(readRecord(data.share_overhang) || {});
  const instrumentDetailsText = JSON.stringify(Array.isArray(data.instrument_details) ? data.instrument_details : []);
  const missingSurfaces: string[] = [];
  if (!/\bConcurrent Private Placement\b/i.test(offeringDetailsText)) {
    missingSurfaces.push("Offering Details");
  }
  if (!hasSeriesCAndDText(shareOverhangText)) {
    missingSurfaces.push("share_overhang");
  }
  if (!hasSeriesCAndDText(instrumentDetailsText)) {
    missingSurfaces.push("instrument_details");
  }
  if (!missingSurfaces.length) {
    return [];
  }

  return [
    `S-1/F-1 source contains concurrent private placement Series C/D warrant exposure, but visible mixed_offering UI is missing it in: ${missingSurfaces.join(", ")}.`,
  ];
}

function hasSeriesCAndDText(value: string) {
  return (
    (/\bSeries\s+C\b/i.test(value) && /\bSeries\s+D\b/i.test(value)) ||
    /\bSeries\s+C\s*(?:\/|&|\band\b)\s*(?:Series\s+)?D\b/i.test(value)
  );
}

function hasGroupedInstrumentSeriesLabel(value: string) {
  return /\bSeries\s+[A-Za-z0-9-]+\s*(?:\/|&|\band\b)\s*(?:Series\s+)?[A-Za-z0-9-]+\b/i.test(value);
}

function isIncludedSupplyNature(value: string) {
  return ["current_offering_supply", "registered_resale_supply", "common_equivalent_supply"].includes(value);
}

function s1F1ShareOverhangRowRole(row: Record<string, unknown> | null) {
  const normalized = stringValue(row?.row_role || row?.rowRole).toLowerCase().replace(/[\s-]+/g, "_");
  if (["counted", "conditional", "alternative", "reference"].includes(normalized)) return normalized;
  return "";
}

function isS1F1CountedShareOverhangRow(row: Record<string, unknown> | null, structuredRows: boolean) {
  if (!row) return false;
  const rowRole = s1F1ShareOverhangRowRole(row);
  if (rowRole) return rowRole === "counted";
  const countedInRatio = booleanValue(row.counted_in_ratio ?? row.countedInRatio);
  if (structuredRows && countedInRatio !== null) return countedInRatio;

  const supplyNature = stringValue(row.supply_nature || row.supplyNature);
  const calculationRole = stringValue(row.calculation_role || row.calculationRole);
  if (structuredRows) return calculationRole === "headline_numerator" && isIncludedSupplyNature(supplyNature);
  return isIncludedSupplyNature(supplyNature);
}

function validateS1F1OverhangFacts(data: Record<string, unknown>) {
  const displayMode = stringValue(data.display_mode);
  if (!["resale_registration", "mixed_offering", "mixed_registration"].includes(displayMode)) return "";
  const requiresOverhangSnapshotLabel = displayMode !== "mixed_offering";
  const hasSupplyNumerator = hasNumericShareOverhangSegment(data, "supply");
  const snapshotText = Array.isArray(data.snapshot_metrics)
    ? data.snapshot_metrics
        .map((row) => {
          const record = readRecord(row);
          return `${stringValue(record?.label)} ${stringValue(record?.value)} ${stringValue(record?.note)}`;
        })
        .join(" ")
    : "";
  const mentionsOverhang = /\b(?:overhang|dilution|outstanding)\b/i.test(snapshotText);
  if (!hasSupplyNumerator && !mentionsOverhang) return "";
  if (
    hasNumericShareOverhangSegment(data, "current") &&
    hasNumericShareOverhangSegment(data, "supply") &&
    hasVisibleShareOverhangRatio(data)
  ) {
    return "";
  }
  if (requiresOverhangSnapshotLabel && hasSupplyNumerator && !/\boverhang\s+vs\.?\s+outstanding\b/i.test(snapshotText)) {
    return "SEC S-1/F-1 resale display must include snapshot_metrics row labeled Overhang vs outstanding when share_overhang has included supply";
  }
  if (!hasNumericShareOverhangSegment(data, "current")) {
    return "SEC S-1/F-1 overhang snapshot must include numeric display_payload.data.share_overhang.basis from filing data when available; market_context shares are allowed only when the filing provides no denominator";
  }
  if (!hasSupplyNumerator) {
    return "SEC S-1/F-1 overhang snapshot must include numeric row_role counted share_overhang.rows from the same registered/offered share numerator";
  }
  return "";
}

function hasNumericShareOverhangSegment(data: Record<string, unknown>, kind: "current" | "supply") {
  const shareOverhang = readRecord(data.share_overhang);
  if (kind === "current") {
    const basis = readRecord(shareOverhang?.basis);
    const numericValue = numberValue(basis?.numeric_value) ?? numberValue(basis?.numericValue);
    if (typeof numericValue === "number" && Number.isFinite(numericValue) && numericValue > 0) return true;
  }

  if (kind === "supply") {
    const rows = Array.isArray(shareOverhang?.rows) ? shareOverhang.rows : [];
    const hasHeadlineSupplyRow = rows.some((item) => {
      const record = readRecord(item);
      const numericValue = numberValue(record?.numeric_value) ?? numberValue(record?.numericValue);
      if (typeof numericValue !== "number" || !Number.isFinite(numericValue) || numericValue <= 0) return false;
      return isS1F1CountedShareOverhangRow(record, true);
    });
    if (hasHeadlineSupplyRow) return true;
  }

  return false;
}

function hasVisibleShareOverhangRatio(data: Record<string, unknown>) {
  const shareOverhang = readRecord(data.share_overhang);
  return Boolean(
    stringValue(shareOverhang?.status_value || shareOverhang?.statusValue) ||
      stringValue(shareOverhang?.ratio_value || shareOverhang?.ratioValue),
  );
}

function adapterOutputToAnalysis(value: SecFormRoomAdapterOutput, displayPayloadWarnings: string[] = []) {
  const score = clampScore(numberValue(value.analysis_output.score) ?? 0);
  const scoreExplanation = normalizeS1F1ScoreExplanation(readRecord(value.analysis_output.score_explanation));
  const displayPayload = readRecord(value.metadata.display_payload);
  const displayPayloadData = readRecord(displayPayload?.data);
  const offeringDisplayModel =
    stringValue(displayPayload?.display_type) === "offering_terms"
      ? normalize424bOfferingDisplayModel(displayPayloadData)
      : readRecord(value.analysis_output.offering_display_model);

  return {
    ...value.analysis_output,
    score,
    score_explanation: scoreExplanation,
    archive_summary:
      nullableString(value.analysis_output.archive_summary) ||
      (score < 50 ? nullableString(value.analysis_output.summary) : null),
    display_payload: value.metadata.display_payload,
    display_payload_storage_target: value.metadata.display_payload_storage_target,
    display_payload_storage_mode: value.metadata.display_payload_storage_mode,
    candidate_special_metadata_only: value.metadata.candidate_special_metadata_only,
    offering_display_model: offeringDisplayModel,
    sec_s1_f1_display_warnings: uniqueStrings(displayPayloadWarnings),
    sec_s1_f1_analysis_mode: "analysis_only",
    sec_offering_analysis_mode: "analysis_only",
  };
}

function normalizeS1F1ScoreExplanation(value: Record<string, unknown> | null) {
  if (!value) return null;
  const summary = nullableString(value.summary) || nullableString(value.rationale);
  const baseBand = nullableString(value.base_band) || nullableString(value.baseBand);
  const upwardFactors = uniqueStrings([
    ...readStringArray(value.upward_factors),
    ...readStringArray(value.upwardFactors),
  ]).slice(0, 3);
  const limitingFactors = uniqueStrings([
    ...readStringArray(value.limiting_factors),
    ...readStringArray(value.limitingFactors),
  ]).slice(0, 3);
  const finalRead = nullableString(value.final_read) || nullableString(value.finalRead);

  if (!summary && !baseBand && !upwardFactors.length && !limitingFactors.length && !finalRead) return null;
  return {
    summary,
    base_band: baseBand,
    upward_factors: upwardFactors,
    limiting_factors: limitingFactors,
    final_read: finalRead,
  };
}

function normalizeS1F1DisplayPayload(displayPayload: Record<string, unknown> | null) {
  if (!displayPayload) return null;
  const data = readRecord(displayPayload.data);
  if (!data) return displayPayload;
  const displayMode = stringValue(data.display_mode);
  const normalizedData =
    displayMode === "mixed_registration"
      ? {
          ...data,
          display_mode: "mixed_offering",
        }
      : data;
  const normalizedPayload = {
    ...displayPayload,
    data: normalizedData,
  };
  if (stringValue((normalizedPayload as Record<string, unknown>).display_type) !== "offering_terms") {
    return normalizedPayload;
  }
  const normalizedPayloadData = (normalize424bOfferingDisplayModel(readRecord(normalizedPayload.data)) ||
    readRecord(normalizedPayload.data) ||
    {}) as Record<string, unknown>;
  const hasReviewFlag =
    normalizedPayloadData.needs_human_review === true ||
    normalizedPayloadData.needsHumanReview === true;
  return {
    ...normalizedPayload,
    evidence: hasReviewFlag ? displayPayload.evidence : [],
    notes: hasReviewFlag ? displayPayload.notes : [],
    data: {
      ...normalizedPayloadData,
      source_notes: hasReviewFlag ? normalizedPayloadData.source_notes : [],
    },
  };
}

function normalizeS1F1ParserOutput(value: unknown, input: SecFilingAnalysisInput) {
  const parser = readRecord(value) || {};
  const fallback = readS1F1ParserOutput(input);
  const filingPackage = readFilingPackage(input);
  const fallbackRaw = readRecord(fallback?.raw) || {};
  const raw = readRecord(parser.raw) || fallbackRaw;
  const runtimeMarketContext = readRecord(filingPackage.market_context);
  return {
    ...fallback,
    ...parser,
    parserVersion: stringValue(parser.parserVersion) || fallback?.parserVersion || "s1-f1-parser-v1",
    parserGroup: stringValue(parser.parserGroup) || fallback?.parserGroup || "s1-f1",
    formType: stringValue(parser.formType) || fallback?.formType || "S-1 / F-1, S-1/A / F-1/A",
    accessionNumber:
      stringValue(parser.accessionNumber) ||
      fallback?.accessionNumber ||
      stringValue(filingPackage.accession_number) ||
      null,
    isSupported: typeof parser.isSupported === "boolean" ? parser.isSupported : fallback?.isSupported !== false,
    facts: readRecord(parser.facts) || readRecord(fallback?.facts) || {},
    signals: Array.isArray(parser.signals) ? parser.signals : Array.isArray(fallback?.signals) ? fallback?.signals : [],
    calendarItems: Array.isArray(parser.calendarItems)
      ? parser.calendarItems
      : Array.isArray(fallback?.calendarItems)
        ? fallback?.calendarItems
        : [],
    warnings: Array.isArray(parser.warnings) ? parser.warnings : Array.isArray(fallback?.warnings) ? fallback?.warnings : [],
    raw: {
      ...raw,
      ...(runtimeMarketContext && Object.keys(runtimeMarketContext).length ? { marketContext: runtimeMarketContext } : {}),
    },
  };
}

function normalizeS1F1AnalysisOutput(value: Record<string, unknown>, input: SecFilingAnalysisInput) {
  const filingPackage = readFilingPackage(input);
  const primaryTicker = normalizePrimaryTicker(readRecord(value.primary_ticker), filingPackage);
  return {
    ...value,
    source_group: "filings",
    market_scope: stringValue(value.market_scope) || "company",
    primary_ticker: primaryTicker,
    tickers: normalizeTickerRows(value.tickers, primaryTicker, "primary"),
    sector: nullableString(value.sector),
    industry_group: nullableString(value.industry_group),
    theme_group: nullableString(value.theme_group),
    sub_theme: nullableString(value.sub_theme),
    why_it_matters:
      nullableString(value.why_it_matters) ||
      nullableString(value.quick_take) ||
      nullableString(value.summary) ||
      "",
    related_tickers: [],
    bullish_points: readStringArray(value.bullish_points),
    bearish_points: readStringArray(value.bearish_points),
    key_evidence: readStringArray(value.key_evidence),
    what_to_watch_next: readStringArray(value.what_to_watch_next),
    calendar_items: Array.isArray(value.calendar_items) ? value.calendar_items : [],
    confidence: normalizeConfidence(stringValue(value.confidence)),
    needs_human_review: value.needs_human_review === true,
  };
}

function alignS1F1AnalysisOutputToDisplayPayload(
  analysis: Record<string, unknown>,
  displayPayload: Record<string, unknown>,
) {
  if (stringValue(displayPayload.display_type) !== "offering_terms") return analysis;
  const data = readRecord(displayPayload.data);
  if (!data) return analysis;
  const displayMode = stringValue(data.display_mode);
  const aligned: Record<string, unknown> = {
    ...analysis,
  };
  if (displayMode && displayMode !== "generic") {
    aligned.bullish_points = [];
    aligned.bearish_points = [];
    aligned.key_evidence = [];
    aligned.what_to_watch_next = [];
  }
  return aligned;
}

function readS1F1ParserOutput(input: SecFilingAnalysisInput): S1F1ParserOutput | null {
  const filingPackage = readFilingPackage(input);
  const hardParsers = readRecord(filingPackage.hard_parsers);
  return (readRecord(hardParsers?.["s1-f1"]) || readRecord(hardParsers?.s1_f1)) as S1F1ParserOutput | null;
}

function readFilingPackage(input: SecFilingAnalysisInput) {
  return readRecord(input.filing_package) || {};
}

function normalizePrimaryTicker(record: Record<string, unknown> | null, filingPackage: Record<string, unknown>) {
  const packagePrimary = readRecord(filingPackage.primary_ticker);
  const packageTicker = nullableString(packagePrimary?.ticker) || nullableString(filingPackage.ticker);
  const ticker = packageTicker || nullableString(record?.ticker);
  const exchange = nullableString(packagePrimary?.exchange) || nullableString(record?.exchange);
  return {
    ticker: ticker ? ticker.toUpperCase() : null,
    exchange,
  };
}

function normalizeTickerRows(value: unknown, primaryTicker: { ticker: string | null; exchange: string | null }, role: string) {
  if (role === "primary" && primaryTicker.ticker) {
    return [
      {
        ticker: primaryTicker.ticker,
        exchange: primaryTicker.exchange,
        role: "primary",
        reason: "Primary SEC filing ticker",
      },
    ];
  }
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

function percentValues(value: string) {
  const matches = value.match(/[+-]?\d[\d,]*(?:\.\d+)?\s*%/g) || [];
  return matches
    .map((match) => Number(match.replace(/[,%\s]/g, "")))
    .filter((item) => Number.isFinite(item));
}

function firstPercentValue(value: string) {
  return percentValues(value)[0] ?? null;
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function booleanValue(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export const secS1F1RequiredOutputSchema = {
  type: "object",
  additionalProperties: true,
  required: ["display_payload", "analysis_output"],
  properties: {
    parser_output: { type: "object", additionalProperties: true },
    display_payload: {
      type: "object",
      additionalProperties: true,
      required: ["display_type", "display_version", "data"],
      properties: {
        display_type: { type: "string" },
        display_version: { type: "string" },
        data: {
          type: "object",
          additionalProperties: true,
          required: [
            "display_mode",
            "risk_label",
            "snapshot_metrics",
            "investor_takeaway",
            "display_quick_take",
            "company_story",
            "offering_details",
            "instrument_details",
          ],
          properties: {
            display_mode: { type: ["string", "null"] },
            ipo_kind: { type: ["string", "null"] },
            risk_label: { type: ["string", "null"] },
            snapshot_metrics: {
              type: "array",
              items: offeringDisplayRowSchema(40, 80, 80),
            },
            share_overhang: shareOverhangSchema({ requireStatusFields: true }),
            investor_takeaway: { type: ["string", "null"] },
            display_quick_take: { type: ["string", "null"] },
            company_story: { type: ["string", "null"] },
            offering_details: {
              type: "array",
              items: offeringDisplayRowSchema(40, 90, 80),
            },
            instrument_details: {
              type: "array",
              items: offeringDisplayRowSchema(40, 130, 80),
            },
            amendment_changes: {
              type: "array",
              items: offeringDisplayRowSchema(40, 130, 80),
            },
            source_notes: { type: "array", items: { type: "string" } },
            needs_human_review: { type: "boolean" },
            review_reasons: { type: "array", items: { type: "string" } },
          },
        },
        evidence: { type: "array", items: { type: "string" } },
        notes: { type: "array", items: { type: "string" } },
      },
    },
    analysis_output: {
      type: "object",
      additionalProperties: true,
      required: [
        "event_type",
        "event_title",
        "sector",
        "industry_group",
        "theme_group",
        "sub_theme",
        "score",
        "score_reason",
        "score_explanation",
        "signal",
        "quick_take",
        "summary",
        "confidence",
        "needs_human_review",
        "offering_monitor_payload",
      ],
      properties: {
        event_type: { type: "string", enum: APPROVED_SEC_EVENT_TYPES },
        event_title: { type: "string" },
        ...marketTaxonomyAnalysisOutputSchemaProperties(),
        score: { type: "number" },
        score_reason: { type: "string" },
        score_explanation: scoreExplanationSchema(),
        signal: { type: "string", enum: ["bullish", "bearish", "volatile", "neutral"] },
        quick_take: { type: "string" },
        summary: { type: "string" },
        confidence: { type: "string", enum: ["high", "medium", "low"] },
        needs_human_review: { type: "boolean" },
        offering_monitor_payload: minimalOfferingMonitorProviderSchema,
        archive_summary: { type: ["string", "null"] },
      },
    },
  },
} as const;

const {
  offering_monitor_payload: _s1OfferingMonitorSchema,
  ...legacyF1AnalysisProperties
} = secS1F1RequiredOutputSchema.properties.analysis_output.properties;

const secF1LegacyRequiredOutputSchema = {
  ...secS1F1RequiredOutputSchema,
  properties: {
    ...secS1F1RequiredOutputSchema.properties,
    analysis_output: {
      ...secS1F1RequiredOutputSchema.properties.analysis_output,
      required: secS1F1RequiredOutputSchema.properties.analysis_output.required.filter(
        (key) => key !== "offering_monitor_payload",
      ),
      properties: legacyF1AnalysisProperties,
    },
  },
};

function isS1MonitorInput(input: SecFilingAnalysisInput) {
  const filingPackage = readFilingPackage(input);
  const parserOutput = readS1F1ParserOutput(input);
  const formType = stringValue(filingPackage.form_type) || stringValue(parserOutput?.formType);
  return formType.toUpperCase().replace(/\s+/g, "").startsWith("S-1");
}
