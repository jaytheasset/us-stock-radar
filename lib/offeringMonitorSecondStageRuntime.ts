import { createHash } from "node:crypto";
import { getServerEnv } from "@/lib/env";
import { runStructuredGeminiJson } from "@/lib/ai/geminiStructuredJson";
import { buildInputFromSecRawRow } from "@/lib/ai/secFilingAnalysisPreview";
import {
  OFFERING_MONITOR_JOB_PROMPT_KEY,
  type OfferingMonitorJobIdentity,
} from "@/lib/offeringMonitorJobFoundation";
import {
  OFFERING_MONITOR_SECOND_STAGE_OUTPUT_TYPE,
  OFFERING_MONITOR_SECOND_STAGE_PROMPT_VERSION,
  offeringMonitorSecondStageProviderSchema,
  type OfferingMonitorDiagnosticCandidate,
  type OfferingMonitorEvidenceBlock,
  type OfferingMonitorProviderRun,
  type OfferingMonitorSecondStageArtifacts,
  type OfferingMonitorSecondStageDependencies,
  type OfferingMonitorSecondStagePackage,
  type OfferingMonitorSourceInput,
} from "@/lib/offeringMonitorSecondStage";
import { buildS1F1LlmSourceInput } from "@/lib/sources/sec/forms/s1-f1/sourceInput";
import type { S1F1ParserOutput } from "@/lib/sources/sec/forms/s1-f1/types";
import { supabaseSelect, supabaseUpdate, supabaseUpsert } from "@/lib/supabase";

export const offeringMonitorSecondStageRuntimeDependencies: OfferingMonitorSecondStageDependencies = {
  readParentAuthority: async (identity) => {
    const repository = await import("@/lib/offeringMonitorJobRepository");
    return repository.readOfferingMonitorParentAuthority(identity);
  },
  claimJob: async (jobId) => {
    const repository = await import("@/lib/offeringMonitorJobRepository");
    return repository.claimOfferingMonitorJob(jobId);
  },
  loadArtifacts: loadOfferingMonitorSecondStageArtifacts,
  recordProviderStart: recordOfferingMonitorProviderStart,
  runProvider: runOfferingMonitorProviderOnce,
  saveDiagnostic: saveOfferingMonitorDiagnosticCandidate,
  markFailed: markOfferingMonitorSecondStageFailed,
  markStale: markOfferingMonitorSecondStageStale,
};

export async function loadOfferingMonitorSecondStageArtifacts(
  identity: OfferingMonitorJobIdentity,
): Promise<OfferingMonitorSecondStageArtifacts> {
  const [jobResult, parentRunResult, parentOutputResult, rawResult, eventResult] = await Promise.all([
    supabaseSelect("ai_runs", {
      select: "*",
      id: `eq.${identity.jobId}`,
      prompt_key: `eq.${OFFERING_MONITOR_JOB_PROMPT_KEY}`,
      limit: "1",
    }),
    supabaseSelect("ai_runs", {
      select: "*",
      id: `eq.${identity.parentPrimaryAiRunId}`,
      event_id: `eq.${identity.eventId}`,
      raw_item_id: `eq.${identity.rawItemId}`,
      prompt_key: `eq.${identity.parentPromptKey}`,
      status: "eq.completed",
      limit: "1",
    }),
    supabaseSelect("ai_outputs", {
      select: "*",
      ai_run_id: `eq.${identity.parentPrimaryAiRunId}`,
      event_id: `eq.${identity.eventId}`,
      output_type: `eq.${identity.parentPromptKey}`,
      order: "created_at.desc,id.desc",
      limit: "1",
    }),
    supabaseSelect("raw_items", {
      select: "*",
      id: `eq.${identity.rawItemId}`,
      limit: "1",
    }),
    supabaseSelect("events", {
      select: "*",
      id: `eq.${identity.eventId}`,
      limit: "1",
    }),
  ]);
  const job = requiredSingleRow(jobResult, "Offering Monitor exact job");
  const parentRun = requiredSingleRow(parentRunResult, "Offering Monitor exact parent Primary run");
  const parentOutput = requiredSingleRow(parentOutputResult, "Offering Monitor exact parent Primary output");
  const rawItem = requiredSingleRow(rawResult, "Offering Monitor exact raw item");
  const event = requiredSingleRow(eventResult, "Offering Monitor exact event");
  const jobMetadata = readRecord(job.metadata) || {};

  assertEqual(stringValue(jobMetadata.parent_primary_ai_run_id), identity.parentPrimaryAiRunId, "job parent run");
  assertEqual(stringValue(parentRun.id), identity.parentPrimaryAiRunId, "parent run id");
  assertEqual(stringValue(parentRun.event_id), identity.eventId, "parent run event");
  assertEqual(stringValue(parentRun.raw_item_id), identity.rawItemId, "parent run raw item");
  assertEqual(stringValue(parentOutput.ai_run_id), identity.parentPrimaryAiRunId, "parent output run");
  assertEqual(stringValue(parentOutput.event_id), identity.eventId, "parent output event");
  assertEqual(stringValue(rawItem.id), identity.rawItemId, "raw item id");
  assertEqual(stringValue(event.id), identity.eventId, "event id");
  assertEqual(readRawSourceIdentity(rawItem), identity.sourceIdentity, "raw item source identity");

  const payload = readRecord(parentOutput.payload);
  if (!readRecord(payload?.analysis)) throw new Error("Offering Monitor parent Primary analysis payload is missing");
  const sourceInput = buildOfferingMonitorSourceInput(rawItem, identity.family);
  if (!sourceInput.blocks.length) throw new Error("Offering Monitor stable source blocks are unavailable");

  return { jobMetadata, parentRun, parentOutput, rawItem, event, sourceInput };
}

export function buildOfferingMonitorSourceInput(
  rawItem: Record<string, unknown>,
  family: OfferingMonitorJobIdentity["family"],
): OfferingMonitorSourceInput {
  const analysisInput = buildInputFromSecRawRow(rawItem);
  const filingPackage = readRecord(analysisInput.filing_package) || {};
  const hardParsers = readRecord(filingPackage.hard_parsers) || {};
  if (family === "s1") {
    const parserOutput = (readRecord(hardParsers["s1-f1"]) || readRecord(hardParsers.s1_f1)) as S1F1ParserOutput | null;
    if (!parserOutput) throw new Error("Offering Monitor S-1 source parser output is unavailable");
    const sourceInput = buildS1F1LlmSourceInput(parserOutput);
    return {
      currentFiling: readRecord(sourceInput.current_filing),
      sourceInventory: readRecord(sourceInput.source_inventory),
      attachmentInventory: Array.isArray(sourceInput.attachment_inventory) ? sourceInput.attachment_inventory : [],
      blocks: normalizeSourceBlocks(sourceInput.cleaned_source_blocks),
    };
  }

  const blocks = normalizeSourceBlocks(collectCleanedSourceBlocks(hardParsers));
  return {
    currentFiling: {
      accession_number: stringValue(filingPackage.accession_number) || readRawSourceIdentity(rawItem),
      form_type: stringValue(filingPackage.form_type),
    },
    sourceInventory: {
      originalBlockCount: blocks.length,
      includedTextChars: blocks.reduce((sum, block) => sum + block.text.length, 0),
    },
    attachmentInventory: [],
    blocks,
  };
}

export async function runOfferingMonitorProviderOnce(
  prompt: OfferingMonitorSecondStagePackage["prompt"],
): Promise<OfferingMonitorProviderRun> {
  const env = getServerEnv();
  if (!env.geminiApiKey) throw new Error("Offering Monitor Gemini API key is unavailable");
  const startedAt = Date.now();
  const run = await runStructuredGeminiJson({
    apiKey: env.geminiApiKey,
    model: env.geminiModel,
    prompt,
    maxOutputTokens: 3_500,
    responseSchema: offeringMonitorSecondStageProviderSchema as unknown as Record<string, unknown>,
  });
  return {
    ok: run.ok,
    responseOk: run.responseOk,
    status: run.status,
    statusText: run.statusText,
    provider: "gemini",
    model: run.model,
    responseId: run.responseId,
    outputText: run.outputText,
    parsed: run.parsed,
    usage: run.usage,
    latencyMs: Date.now() - startedAt,
    error: run.error,
  };
}

export async function recordOfferingMonitorProviderStart(input: {
  identity: OfferingMonitorJobIdentity;
  artifacts: OfferingMonitorSecondStageArtifacts;
  package: OfferingMonitorSecondStagePackage;
}) {
  const env = getServerEnv();
  await updateJobOrThrow(
    input.identity.jobId,
    { status: "eq.running" },
    {
      prompt_version: OFFERING_MONITOR_SECOND_STAGE_PROMPT_VERSION,
      model: env.geminiModel,
      usage: {},
      metadata: {
        ...input.artifacts.jobMetadata,
        phase: "provider_running",
        provider: "gemini",
        model: env.geminiModel,
        provider_attempts: 1,
        input_stats: input.package.stats,
        provider_started_at: new Date().toISOString(),
      },
    },
    "Offering Monitor provider start trace",
  );
}

export async function saveOfferingMonitorDiagnosticCandidate(input: {
  identity: OfferingMonitorJobIdentity;
  artifacts: OfferingMonitorSecondStageArtifacts;
  candidate: OfferingMonitorDiagnosticCandidate;
}) {
  const output = await supabaseUpsert(
    "ai_outputs",
    {
      id: input.identity.jobId,
      ai_run_id: input.identity.jobId,
      event_id: input.identity.eventId,
      output_type: OFFERING_MONITOR_SECOND_STAGE_OUTPUT_TYPE,
      payload: input.candidate,
    },
    { onConflict: "id", prefer: "resolution=ignore-duplicates,return=representation" },
  );
  if (!output.ok) throw new Error(`Offering Monitor diagnostic output save failed: ${output.error || output.status}`);
  if (!Array.isArray(output.data) || !output.data.length) {
    throw new Error("Offering Monitor diagnostic output already exists for this exact job");
  }

  const status = input.candidate.validation.status === "success" ? "completed" : "failed";
  await updateJobOrThrow(
    input.identity.jobId,
    { status: "eq.running" },
    {
      prompt_version: OFFERING_MONITOR_SECOND_STAGE_PROMPT_VERSION,
      model: input.candidate.provider.model,
      status,
      finished_at: new Date().toISOString(),
      usage: input.candidate.provider.usage || {},
      error_message: status === "failed" ? input.candidate.validation.errors.join("; ") : null,
      metadata: {
        ...input.artifacts.jobMetadata,
        phase: status === "completed" ? "diagnostic_candidate_saved" : "diagnostic_candidate_rejected",
        provider: "gemini",
        model: input.candidate.provider.model,
        provider_attempts: 1,
        provider_response_id: input.candidate.provider.response_id,
        provider_http_status: input.candidate.provider.http_status,
        provider_latency_ms: input.candidate.provider.latency_ms,
        output_chars: input.candidate.raw_output.length,
        output_sha256: sha256(input.candidate.raw_output),
        input_stats: input.candidate.input_stats,
        validation_status: input.candidate.validation.status,
        diagnostic_candidate_only: true,
        canonical_persistence_changed: false,
      },
    },
    "Offering Monitor diagnostic job completion",
  );
}

export async function markOfferingMonitorSecondStageFailed(input: {
  identity: OfferingMonitorJobIdentity;
  artifacts?: OfferingMonitorSecondStageArtifacts;
  error: string;
  providerRun?: OfferingMonitorProviderRun;
}) {
  await updateJobOrThrow(
    input.identity.jobId,
    { status: "in.(pending,running,failed,completed)" },
    {
      prompt_version: OFFERING_MONITOR_SECOND_STAGE_PROMPT_VERSION,
      status: "failed",
      finished_at: new Date().toISOString(),
      usage: input.providerRun?.usage || {},
      error_message: input.error,
      metadata: {
        ...(input.artifacts?.jobMetadata || {}),
        phase: "second_stage_failed",
        provider_attempts: input.providerRun ? 1 : 0,
        provider_http_status: input.providerRun?.status ?? null,
        provider_latency_ms: input.providerRun?.latencyMs ?? null,
        diagnostic_candidate_only: true,
        canonical_persistence_changed: false,
      },
    },
    "Offering Monitor failure trace",
  );
}

export async function markOfferingMonitorSecondStageStale(input: {
  identity: OfferingMonitorJobIdentity;
  artifacts?: OfferingMonitorSecondStageArtifacts;
  providerRun?: OfferingMonitorProviderRun;
}) {
  await updateJobOrThrow(
    input.identity.jobId,
    { status: "in.(pending,running,completed)" },
    {
      prompt_version: OFFERING_MONITOR_SECOND_STAGE_PROMPT_VERSION,
      status: "stale",
      finished_at: new Date().toISOString(),
      usage: input.providerRun?.usage || {},
      error_message: null,
      metadata: {
        ...(input.artifacts?.jobMetadata || {}),
        phase: input.providerRun ? "stale_after_provider" : "stale_before_provider",
        provider_attempts: input.providerRun ? 1 : 0,
        provider_http_status: input.providerRun?.status ?? null,
        provider_latency_ms: input.providerRun?.latencyMs ?? null,
        diagnostic_candidate_saved: false,
        canonical_persistence_changed: false,
      },
    },
    "Offering Monitor stale trace",
  );
}

function normalizeSourceBlocks(value: unknown) {
  const rows = Array.isArray(value) ? value : [];
  const output: OfferingMonitorEvidenceBlock[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const block = readRecord(row);
    if (!block) continue;
    const blockId = stringValue(block.block_id || block.blockId);
    const sourceRef = stringValue(block.source_ref || block.sourceRef || blockId);
    const text = stringValuePreserve(block.text);
    if (!blockId || !sourceRef || !text || seen.has(blockId)) continue;
    seen.add(blockId);
    output.push({
      block_id: blockId,
      source_ref: sourceRef,
      source: nullableString(block.source),
      section_key: nullableString(block.sectionKey || block.section_key),
      section_title: nullableString(block.sectionTitle || block.section_title),
      document_name: nullableString(block.documentName || block.document_name),
      document_id: nullableString(block.documentId || block.document_id),
      chunk_index: finiteNumber(block.chunk_index ?? block.chunkIndex),
      chunk_count: finiteNumber(block.chunk_count ?? block.chunkCount),
      text,
      tables: Array.isArray(block.tables)
        ? block.tables.map(stringValuePreserve).filter(Boolean).slice(0, 2)
        : [],
    });
  }
  return output;
}

function collectCleanedSourceBlocks(value: unknown, output: unknown[] = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectCleanedSourceBlocks(item, output);
    return output;
  }
  const record = readRecord(value);
  if (!record) return output;
  for (const [key, child] of Object.entries(record)) {
    if ((key === "cleaned_source_blocks" || key === "cleanedSourceBlocks") && Array.isArray(child)) {
      output.push(...child);
    } else {
      collectCleanedSourceBlocks(child, output);
    }
  }
  return output;
}

async function updateJobOrThrow(
  jobId: string,
  extraSearch: Record<string, string>,
  payload: Record<string, unknown>,
  label: string,
) {
  const result = await supabaseUpdate(
    "ai_runs",
    {
      id: `eq.${jobId}`,
      prompt_key: `eq.${OFFERING_MONITOR_JOB_PROMPT_KEY}`,
      ...extraSearch,
    },
    payload,
  );
  if (!result.ok) throw new Error(`${label} failed: ${result.error || result.status}`);
  if (!Array.isArray(result.data) || !result.data.length) throw new Error(`${label} lost job authority`);
}

function requiredSingleRow(result: { ok: boolean; status: number; data: unknown; error?: string }, label: string) {
  if (!result.ok) throw new Error(`${label} read failed: ${result.error || result.status}`);
  const rows = Array.isArray(result.data) ? result.data : [];
  const row = readRecord(rows[0]);
  if (!row) throw new Error(`${label} is missing`);
  return row;
}

function readRawSourceIdentity(rawItem: Record<string, unknown>) {
  const rawPayload = readRecord(rawItem.raw_payload);
  const metadata = readRecord(rawItem.metadata);
  return stringValue(rawItem.source_unique_id) ||
    stringValue(rawPayload?.accession_number) ||
    stringValue(metadata?.accession_number);
}

function assertEqual(actual: string, expected: string, label: string) {
  if (!actual || actual !== expected) throw new Error(`Offering Monitor ${label} mismatch`);
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stringValuePreserve(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function nullableString(value: unknown) {
  const text = stringValue(value);
  return text || null;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
