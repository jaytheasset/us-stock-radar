import type { SecFilingAnalysisInput } from "@/lib/prompts/secFilingAnalysis";
import type { ProxyParserOutput } from "@/lib/sources/sec/forms/proxy/parser";
import { buildProxySourceBlockPromptInput } from "@/lib/sources/sec/forms/proxy/sourceInput";
import {
  applySecValidationRepairPatches,
  escapeSecValidationJsonPointerSegment,
  hasSecValidationJsonPointer,
  readSecValidationJsonPointer,
} from "@/lib/ai/secValidationRepairPatch";

export const SEC_PROXY_VALIDATION_REPAIR_PROMPT_KEY = "sec_proxy_validation_repair";
export const SEC_PROXY_VALIDATION_REPAIR_PROMPT_VERSION = "v1-one-pass-source-backed-patch";

export type SecProxyValidationRepairIssue = {
  code: string;
  warning: string;
  field_paths: string[];
  allowed_patch_paths: string[];
  candidate_source_block_ids: string[];
};

export type SecProxyValidationRepairPlan = {
  prompt: ReturnType<typeof buildProxyValidationRepairPrompt>;
  issues: SecProxyValidationRepairIssue[];
  allowedPatchPaths: string[];
  sourceBlockIds: string[];
};

export function buildSecProxyValidationRepairPlan({
  analysisResult,
  input,
}: {
  analysisResult: Record<string, unknown>;
  input: SecFilingAnalysisInput;
}): SecProxyValidationRepairPlan | null {
  const root = readRecord(analysisResult);
  const displayPayload = readRecord(root?.display_payload);
  const data = readRecord(displayPayload?.data);
  const parserOutput = readProxyParserOutput(input);
  if (!root || !displayPayload || !data || !parserOutput) return null;

  const warnings = validateSecProxyDisplayPayload(displayPayload);
  const issues = collectProxyScalarRepairIssues(root, data, warnings);
  if (!issues.length) return null;

  const sourceBlocks = selectProxyRepairSourceBlocks(
    buildProxyRepairSourceBlocks(parserOutput, readRecord(readRecord(input.filing_package)?.market_context)),
    issues,
    root,
  );
  if (!sourceBlocks.length) return null;

  const sourceBlockIds = sourceBlocks.map((block) => stringValue(block.block_id)).filter(Boolean);
  const issuesWithSources = issues.map((issue) => ({
    ...issue,
    candidate_source_block_ids: sourceBlockIds,
  }));
  const allowedPatchPaths = uniqueStrings(issuesWithSources.flatMap((issue) => issue.allowed_patch_paths));

  return {
    prompt: buildProxyValidationRepairPrompt({
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

export function applySecProxyValidationRepairPatches({
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

export function validateSecProxyDisplayPayload(displayPayload: Record<string, unknown>): string[] {
  const warnings: string[] = [];
  const displayVersion = stringValue(displayPayload.display_version);
  if (displayVersion !== "proxy_vote_v1") {
    warnings.push(`SEC proxy display_payload.display_version should be proxy_vote_v1, got: ${displayVersion || "(empty)"}`);
  }
  const data = readRecord(displayPayload.data);
  if (!data || Object.keys(data).length === 0) {
    warnings.push("SEC proxy result display_payload.data was empty; selected proxy UI cannot render source facts.");
    return warnings;
  }

  const requiredKeys = ["summary_title", "summary_sentence", "snapshot", "proposals"];
  const missingKeys = requiredKeys.filter((key) => !Object.prototype.hasOwnProperty.call(data, key));
  if (missingKeys.length) {
    warnings.push(`SEC proxy proxy_vote_v1 data missing required field(s): ${missingKeys.join(", ")}`);
  }

  for (const arrayKey of ["snapshot", "proposals"]) {
    if (!Array.isArray(data[arrayKey])) {
      warnings.push(`SEC proxy proxy_vote_v1 data requires ${arrayKey} to be an array.`);
    }
  }

  const snapshot = readRecordArray(data.snapshot);
  if (snapshot.length > 4) {
    warnings.push(`SEC proxy proxy_vote_v1 data.snapshot should contain at most 4 rows, got ${snapshot.length}.`);
  }
  snapshot.forEach((row, index) => {
    if (!stringValue(row.label)) warnings.push(`SEC proxy proxy_vote_v1 data.snapshot row ${index + 1} missing label.`);
    if (!stringValue(row.value)) warnings.push(`SEC proxy proxy_vote_v1 data.snapshot row ${index + 1} missing value.`);
  });

  const proposals = readRecordArray(data.proposals);
  if (proposals.length && !snapshot.length) {
    warnings.push("SEC proxy proxy_vote_v1 data.snapshot should include visible summary rows when proposals are present.");
  }
  proposals.forEach((proposal, index) => {
    const row = index + 1;
    if (!stringValue(proposal.id)) warnings.push(`SEC proxy proxy_vote_v1 data.proposals row ${row} missing id.`);
    if (!stringValue(proposal.title)) warnings.push(`SEC proxy proxy_vote_v1 data.proposals row ${row} missing title.`);
    const proposalType = stringValue(proposal.type) || stringValue(proposal.category);
    if (!proposalType) warnings.push(`SEC proxy proxy_vote_v1 data.proposals row ${row} missing type.`);
    const recommendation = stringValue(proposal.board_recommendation) || stringValue(proposal.recommendation);
    if (!recommendation) warnings.push(`SEC proxy proxy_vote_v1 data.proposals row ${row} missing board_recommendation.`);
    if (!stringValue(proposal.explanation)) warnings.push(`SEC proxy proxy_vote_v1 data.proposals row ${row} missing beginner explanation.`);
    const details = readRecordArray(proposal.details);
    if (details.length > 4) {
      warnings.push(`SEC proxy proxy_vote_v1 data.proposals row ${row} should contain at most 4 detail rows, got ${details.length}.`);
    }
    if (isMaterialProxyProposalType(`${proposalType} ${stringValue(proposal.title)}`) && !details.length) {
      warnings.push(`SEC proxy proxy_vote_v1 data.proposals row ${row} should include details for material proposal terms.`);
    }
    details.forEach((detail, detailIndex) => {
      if (!stringValue(detail.label)) warnings.push(`SEC proxy proxy_vote_v1 proposal row ${row} detail ${detailIndex + 1} missing label.`);
      if (!stringValue(detail.value)) warnings.push(`SEC proxy proxy_vote_v1 proposal row ${row} detail ${detailIndex + 1} missing value.`);
    });
  });

  return warnings;
}

export function appendSecProxyDisplayWarnings(displayPayload: Record<string, unknown>, warnings: string[]) {
  const uniqueWarnings = uniqueStrings(warnings);
  if (!uniqueWarnings.length) return;
  const data = readRecord(displayPayload.data) ?? {};
  displayPayload.data = data;
  data.display_warnings = uniqueStrings([...readStringArray(data.display_warnings), ...uniqueWarnings]);
  displayPayload.notes = uniqueStrings([...readStringArray(displayPayload.notes), ...uniqueWarnings]);
}

function collectProxyScalarRepairIssues(
  analysisResult: Record<string, unknown>,
  data: Record<string, unknown>,
  warnings: string[],
) {
  const issues: SecProxyValidationRepairIssue[] = [];
  const warningText = warnings.join("\n");
  const addEmptyScalarIssue = (code: string, warningPattern: RegExp, path: string) => {
    if (!warningPattern.test(warningText) || !hasSecValidationJsonPointer(analysisResult, path)) return;
    if (stringValue(readSecValidationJsonPointer(analysisResult, path))) return;
    issues.push(buildProxyRepairIssue(code, warnings.find((warning) => warningPattern.test(warning)) || code, [path]));
  };

  readRecordArray(data.snapshot).forEach((row, index) => {
    addEmptyScalarIssue(
      "snapshot_label_missing",
      new RegExp(`snapshot row ${index + 1} missing label`, "i"),
      `/display_payload/data/snapshot/${index}/label`,
    );
    addEmptyScalarIssue(
      "snapshot_value_missing",
      new RegExp(`snapshot row ${index + 1} missing value`, "i"),
      `/display_payload/data/snapshot/${index}/value`,
    );
  });

  readRecordArray(data.proposals).forEach((proposal, index) => {
    const row = index + 1;
    addEmptyScalarIssue("proposal_id_missing", new RegExp(`proposals row ${row} missing id`, "i"), `/display_payload/data/proposals/${index}/id`);
    addEmptyScalarIssue("proposal_title_missing", new RegExp(`proposals row ${row} missing title`, "i"), `/display_payload/data/proposals/${index}/title`);
    const typeKey = Object.prototype.hasOwnProperty.call(proposal, "type") ? "type" : "category";
    addEmptyScalarIssue("proposal_type_missing", new RegExp(`proposals row ${row} missing type`, "i"), `/display_payload/data/proposals/${index}/${typeKey}`);
    const recommendationKey = Object.prototype.hasOwnProperty.call(proposal, "board_recommendation")
      ? "board_recommendation"
      : "recommendation";
    addEmptyScalarIssue(
      "proposal_recommendation_missing",
      new RegExp(`proposals row ${row} missing board_recommendation`, "i"),
      `/display_payload/data/proposals/${index}/${recommendationKey}`,
    );
    addEmptyScalarIssue(
      "proposal_explanation_missing",
      new RegExp(`proposals row ${row} missing beginner explanation`, "i"),
      `/display_payload/data/proposals/${index}/explanation`,
    );

    readRecordArray(proposal.details).forEach((_detail, detailIndex) => {
      const detailRow = detailIndex + 1;
      addEmptyScalarIssue(
        "proposal_detail_label_missing",
        new RegExp(`proposal row ${row} detail ${detailRow} missing label`, "i"),
        `/display_payload/data/proposals/${index}/details/${detailIndex}/label`,
      );
      addEmptyScalarIssue(
        "proposal_detail_value_missing",
        new RegExp(`proposal row ${row} detail ${detailRow} missing value`, "i"),
        `/display_payload/data/proposals/${index}/details/${detailIndex}/value`,
      );
    });
  });

  return dedupeProxyRepairIssues(issues);
}

function buildProxyValidationRepairPrompt({
  analysisResult,
  issues,
  allowedPatchPaths,
  sourceBlocks,
}: {
  analysisResult: Record<string, unknown>;
  issues: SecProxyValidationRepairIssue[];
  allowedPatchPaths: string[];
  sourceBlocks: Array<Record<string, unknown>>;
}) {
  return {
    key: SEC_PROXY_VALIDATION_REPAIR_PROMPT_KEY,
    version: SEC_PROXY_VALIDATION_REPAIR_PROMPT_VERSION,
    system: [
      "Repair one completed SEC Proxy analysis in one bounded pass.",
      "Validator warnings identify possible inconsistencies but are not evidence.",
      "Use only the selected original source blocks and the existing result as evidence.",
      "Return scalar replacement patches only for exact allowed paths. Never add, remove, reorder, truncate, or rewrite arrays or objects.",
      "Preserve event classification, score, signal, display mode, proposal order, and all fields not explicitly allowed.",
      "For proposal explanations, use one short beginner-friendly sentence with a clear subject.",
      "If the source blocks do not support a reliable replacement, return the issue as unresolved instead of guessing.",
      "This is the only repair attempt. Return JSON only.",
    ].join("\n"),
    user: JSON.stringify(
      {
        task: "Patch only source-verifiable validator issues in the existing Proxy analysis.",
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
        name: "sec_proxy_validation_repair",
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

function buildProxyRepairSourceBlocks(parserOutput: ProxyParserOutput, marketContext: Record<string, unknown> | null) {
  const promptInput = buildProxySourceBlockPromptInput(parserOutput, marketContext);
  const blocks = Array.isArray(promptInput.cleaned_source_blocks) ? promptInput.cleaned_source_blocks : [];
  return blocks
    .map((item, index) => {
      const block = readRecord(item);
      const text = stringValue(block?.text);
      if (!block || !text) return null;
      const stem = `${stringValue(block.block_type)}_${stringValue(block.label)}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 48);
      return {
        block_id: `proxy_${stem || "source"}_${index + 1}`,
        source_ref: stringValue(block.label),
        block_type: stringValue(block.block_type),
        label: stringValue(block.label),
        text: clipText(text, 5_000),
        source_order: index,
      };
    })
    .filter((block): block is NonNullable<typeof block> => Boolean(block));
}

function selectProxyRepairSourceBlocks(
  blocks: Array<Record<string, unknown>>,
  issues: SecProxyValidationRepairIssue[],
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
      const content = `${stringValue(block.block_type)} ${stringValue(block.label)} ${stringValue(block.text)}`.toLowerCase();
      let score = /proposal|meeting|vote|transaction|merger|split|authorized|equity|spac|governance/i.test(
        `${stringValue(block.block_type)} ${stringValue(block.label)}`,
      )
        ? 8
        : 0;
      score += keywords.reduce((total, keyword) => total + (content.includes(keyword) ? 1 : 0), 0);
      return { block, score, order: numberValue(block.source_order) ?? 0 };
    })
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, 3)
    .sort((a, b) => a.order - b.order)
    .map(({ block }) => block);
}

function buildProxyRepairIssue(code: string, warning: string, paths: string[]): SecProxyValidationRepairIssue {
  return {
    code,
    warning,
    field_paths: paths,
    allowed_patch_paths: paths,
    candidate_source_block_ids: [],
  };
}

function dedupeProxyRepairIssues(issues: SecProxyValidationRepairIssue[]) {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}:${issue.allowed_patch_paths.join("|")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function readProxyParserOutput(input: SecFilingAnalysisInput): ProxyParserOutput | null {
  const filingPackage = readRecord(input.filing_package);
  const hardParsers = readRecord(filingPackage?.hard_parsers);
  const proxy = readRecord(hardParsers?.proxy);
  if (!proxy || stringValue(proxy.parserGroup) !== "proxy") return null;
  return proxy as unknown as ProxyParserOutput;
}

function isMaterialProxyProposalType(value: string) {
  return /merger|transaction|reverse|authorized|equity|incentive|listing|spac|de-spac|business combination|shareholder|contest|dissident|governance/i.test(value);
}

function clipText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readRecordArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => readRecord(item)).filter((item): item is Record<string, unknown> => Boolean(item)) : [];
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => stringValue(item)).filter(Boolean) : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

