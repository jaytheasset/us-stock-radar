export const SEC_VALIDATION_REPAIR_TRACE_SCHEMA_VERSION = 1;

type RepairTraceInput = {
  analysis: Record<string, unknown> | null;
  outputText: string;
  repairOutputText?: string;
  usage: Record<string, unknown> | null;
  repairUsage?: Record<string, unknown> | null;
  model: string;
  openAiResponseId: string | null;
  repairOpenAiResponseId?: string | null;
  prompt: Record<string, unknown> | null;
  validationRepair: Record<string, unknown> | null;
  error?: string | null;
};

export type SecValidationRepairTrace = ReturnType<typeof buildSecValidationRepairTrace>;

export function buildSecValidationRepairTrace(input: RepairTraceInput) {
  const repairPrompt = readRecord(input.prompt?.repair);
  const validation = input.validationRepair;
  const attempted = validation?.attempted === true || Boolean(repairPrompt);
  const succeeded = attempted && readRepairSucceeded(validation);
  const initialResult = parseJsonObject(input.outputText);
  const repairResult = parseJsonObject(input.repairOutputText || "");
  const promptPayload = parseJsonObject(stringValue(repairPrompt?.user));
  const appliedPaths = uniqueStrings([
    ...stringArray(validation?.applied_patch_paths),
    ...stringArray(validation?.applied_paths),
  ]);

  return {
    schema_version: SEC_VALIDATION_REPAIR_TRACE_SCHEMA_VERSION,
    attempted,
    status: attempted ? (succeeded ? "succeeded" : "failed") : "not_attempted",
    warnings: readValidationWarnings(promptPayload, validation),
    repair_prompt: repairPrompt
      ? {
          key: stringValue(repairPrompt.key) || null,
          version: stringValue(repairPrompt.version) || null,
          system: stringValue(repairPrompt.system) || null,
          user: stringValue(repairPrompt.user) || null,
          response_format: repairPrompt.responseFormat || repairPrompt.response_format || null,
        }
      : null,
    initial_analysis: {
      parsed_result: initialResult,
      output_text: input.outputText || null,
      model: input.model || null,
      response_id: input.openAiResponseId || null,
      usage: subtractUsage(input.usage, input.repairUsage || null),
    },
    repair_analysis: attempted
      ? {
          parsed_result: repairResult,
          output_text: input.repairOutputText || null,
          model: input.model || null,
          response_id: input.repairOpenAiResponseId || null,
          usage: input.repairUsage || null,
        }
      : null,
    final_analysis: input.analysis,
    applied_changes: buildAppliedChanges({
      appliedPaths,
      initialResult,
      repairResult,
      finalResult: input.analysis,
    }),
    ignored_patch_paths: stringArray(validation?.ignored_patch_paths),
    unresolved: Array.isArray(validation?.unresolved)
      ? validation.unresolved
      : stringArray(validation?.unresolved_warning_codes),
    source_selection: buildSourceSelection(promptPayload, validation),
    combined_usage: input.usage,
    error_summary:
      nullableString(validation?.error) ||
      nullableString(validation?.run_error) ||
      nullableString(validation?.adaptation_error) ||
      nullableString(input.error),
  };
}

function readRepairSucceeded(validation: Record<string, unknown> | null) {
  if (!validation) return false;
  if (typeof validation.succeeded === "boolean") return validation.succeeded;
  if (typeof validation.run_ok === "boolean") return validation.run_ok;
  return false;
}

function readValidationWarnings(
  promptPayload: Record<string, unknown> | null,
  validation: Record<string, unknown> | null,
) {
  const candidates = [
    validation?.diagnostic_findings,
    ...(promptPayload
      ? [
        promptPayload.validator_issues,
        promptPayload.validation_issues,
        promptPayload.validator_warnings,
        promptPayload.validation_warnings,
        promptPayload.issues,
        promptPayload.warnings,
      ]
      : []),
  ];
  const issueRecords = candidates
    .flatMap((value) => recordArray(value))
    .filter((issue, index, all) => {
      const code = stringValue(issue.code);
      return Boolean(code) && all.findIndex((candidate) => stringValue(candidate.code) === code) === index;
    });
  if (issueRecords.length) {
    return issueRecords.map((issue) => ({
      code: stringValue(issue.code),
      description:
        nullableString(issue.warning) ||
        nullableString(issue.description) ||
        nullableString(issue.message) ||
        nullableString(issue.reason),
      detail: issue,
    }));
  }
  return stringArray(validation?.issue_codes).map((code) => ({
    code,
    description: null,
    detail: null,
  }));
}

function buildAppliedChanges({
  appliedPaths,
  initialResult,
  repairResult,
  finalResult,
}: {
  appliedPaths: string[];
  initialResult: Record<string, unknown> | null;
  repairResult: Record<string, unknown> | null;
  finalResult: Record<string, unknown> | null;
}) {
  const patches = recordArray(repairResult?.patches);
  return appliedPaths.map((path) => {
    const patch = patches.find((candidate) => stringValue(candidate.path) === path);
    const before = readJsonPointer(initialResult, path);
    const finalValue = readJsonPointer(finalResult, path);
    const hasReplacement = Boolean(patch && Object.prototype.hasOwnProperty.call(patch, "replacement"));
    return {
      path,
      before: before.found ? before.value : null,
      after: hasReplacement ? patch?.replacement ?? null : finalValue.found ? finalValue.value : null,
      before_present: before.found,
      after_present: hasReplacement || finalValue.found,
    };
  });
}

function buildSourceSelection(
  promptPayload: Record<string, unknown> | null,
  validation: Record<string, unknown> | null,
) {
  const sourceBlockIds = uniqueStrings([
    ...stringArray(validation?.source_block_ids),
    ...recordArray(promptPayload?.selected_original_source_blocks).map((block) => stringValue(block.block_id)),
    ...recordArray(promptPayload?.selected_source_blocks).map((block) => stringValue(block.block_id)),
  ]);
  const selectedSourceBlocks =
    (Array.isArray(promptPayload?.selected_original_source_blocks) && promptPayload?.selected_original_source_blocks) ||
    (Array.isArray(promptPayload?.selected_source_blocks) && promptPayload?.selected_source_blocks) ||
    null;
  return {
    description: sourceBlockIds.length
      ? `Repair used ${sourceBlockIds.length} selected original SEC source block(s): ${sourceBlockIds.join(", ")}.`
      : "No selected original source block identifiers were recorded for this repair.",
    source_block_ids: sourceBlockIds,
    selected_original_source_blocks: selectedSourceBlocks,
  };
}

function subtractUsage(
  combined: Record<string, unknown> | null,
  repair: Record<string, unknown> | null,
) {
  if (!combined) return null;
  if (!repair) return combined;
  const result = { ...combined };
  for (const key of ["input_tokens", "output_tokens", "total_tokens"]) {
    const total = numberValue(combined[key]);
    const repairValue = numberValue(repair[key]);
    if (total !== null && repairValue !== null) result[key] = Math.max(0, total - repairValue);
  }
  return result;
}

function readJsonPointer(value: unknown, path: string): { found: boolean; value: unknown } {
  if (!path.startsWith("/")) return { found: false, value: null };
  let current: unknown = value;
  for (const rawPart of path.slice(1).split("/")) {
    const part = rawPart.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return { found: false, value: null };
      current = current[index];
      continue;
    }
    const record = readRecord(current);
    if (!record || !Object.prototype.hasOwnProperty.call(record, part)) return { found: false, value: null };
    current = record[part];
  }
  return { found: true, value: current };
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const candidates = [trimmed, trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")];
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      const record = readRecord(parsed);
      if (record) return record;
    } catch {
      // Keep the exact output text and report a null parsed result.
    }
  }
  return null;
}

function recordArray(value: unknown) {
  return Array.isArray(value)
    ? value.map(readRecord).filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(stringValue).filter(Boolean) : [];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function nullableString(value: unknown) {
  return stringValue(value) || null;
}

function numberValue(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}
