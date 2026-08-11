import {
  MINIMAL_OFFERING_MONITOR_PROMPT,
  buildMinimalOfferingMarketSnapshot,
  materializeMinimalOfferingMonitor,
  minimalOfferingMonitorProviderSchema,
  resolveMinimalOfferingMonitorBoundary,
  type MinimalOfferingMonitor,
} from "./minimalOfferingMonitor.ts";
import type {
  OfferingMonitorJobIdentity,
  OfferingMonitorParentAuthority,
} from "./offeringMonitorJobFoundation.ts";
import { OFFERING_MONITOR_EXECUTION_CONTRACT_VERSION } from "./offeringMonitorJobFoundation.ts";

export const OFFERING_MONITOR_SECOND_STAGE_PROMPT_KEY = "offering_monitor_normalization_job";
export const OFFERING_MONITOR_SECOND_STAGE_PROMPT_VERSION = OFFERING_MONITOR_EXECUTION_CONTRACT_VERSION;
export const OFFERING_MONITOR_SECOND_STAGE_OUTPUT_TYPE = "offering_monitor_normalization_candidate";

const MAX_EVIDENCE_BLOCKS = 28;
const MAX_EVIDENCE_TEXT_CHARS = 100_000;
const MAX_SOURCE_RATIO = 0.9;

export const offeringMonitorSecondStageProviderSchema = {
  type: "object",
  required: ["offering_monitor_payload"],
  properties: {
    offering_monitor_payload: minimalOfferingMonitorProviderSchema,
  },
} as const;

const monitorContract = MINIMAL_OFFERING_MONITOR_PROMPT.split("\n").slice(1).join("\n");

export const OFFERING_MONITOR_SECOND_STAGE_SYSTEM_PROMPT = [
  "You are not rewriting the user-facing filing analysis.",
  "You are independently normalizing a small set of canonical Offering Monitor facts for deterministic filtering, monitoring, historical matching, and backtesting.",
  "Use the parent Primary analysis only as context. Ground every Monitor fact in the supplied SEC source evidence and cite only a supplied stable source_ref.",
  "The Display analysis and Monitor facts serve different purposes and do not have to use the same representation. Do not copy a Display number unless the source package independently supports the Monitor definition.",
  "Return exactly one JSON object with exactly one key, offering_monitor_payload. Its value must be one minified om1 JSON string. Do not return commentary, markdown, a second analysis, or any other key.",
  monitorContract,
].join("\n");

export type OfferingMonitorEvidenceBlock = {
  block_id: string;
  source_ref: string;
  source: string | null;
  section_key: string | null;
  section_title: string | null;
  document_name: string | null;
  document_id: string | null;
  chunk_index: number | null;
  chunk_count: number | null;
  text: string;
  tables: string[];
};

export type OfferingMonitorSourceInput = {
  currentFiling: Record<string, unknown> | null;
  sourceInventory: Record<string, unknown> | null;
  attachmentInventory: unknown[];
  blocks: OfferingMonitorEvidenceBlock[];
};

export type OfferingMonitorSecondStageArtifacts = {
  jobMetadata: Record<string, unknown>;
  parentRun: Record<string, unknown>;
  parentOutput: Record<string, unknown>;
  rawItem: Record<string, unknown>;
  event: Record<string, unknown>;
  sourceInput: OfferingMonitorSourceInput;
};

export type OfferingMonitorSecondStagePackage = {
  payload: Record<string, unknown>;
  prompt: {
    key: typeof OFFERING_MONITOR_SECOND_STAGE_PROMPT_KEY;
    version: typeof OFFERING_MONITOR_SECOND_STAGE_PROMPT_VERSION;
    system: string;
    user: string;
    responseFormat: { json_schema: { name: string; strict: true; schema: typeof offeringMonitorSecondStageProviderSchema } };
  };
  stats: {
    packageChars: number;
    promptChars: number;
    estimatedPromptTokens: number;
    factsChars: number;
    sourceChars: number;
    sourceTextChars: number;
    sourceBlockCount: number;
    primarySourceTextChars: number;
    sourceTextRatio: number | null;
    parentPrimaryInputTokens: number | null;
    selectedSourceRefs: string[];
  };
};

export type OfferingMonitorProviderRun = {
  ok: boolean;
  responseOk: boolean;
  status: number;
  statusText: string;
  provider: "gemini";
  model: string;
  responseId: string | null;
  outputText: string;
  parsed: Record<string, unknown> | null;
  usage: Record<string, unknown> | null;
  latencyMs: number;
  error?: string;
};

export type OfferingMonitorDiagnosticCandidate = {
  schema_version: "offering_monitor_second_stage_candidate_v1";
  job_id: string;
  parent_primary_ai_run_id: string;
  event_id: string;
  raw_item_id: string;
  source_identity: string;
  prompt: { key: string; version: string };
  input_stats: OfferingMonitorSecondStagePackage["stats"];
  provider: {
    name: "gemini";
    model: string;
    response_id: string | null;
    http_status: number;
    response_ok: boolean;
    attempts: 1;
    latency_ms: number;
    usage: Record<string, unknown> | null;
  };
  raw_output: string;
  outer_payload: Record<string, unknown> | null;
  validation: {
    status: "success" | "transport_failed" | "validation_failed";
    errors: string[];
  };
  canonical_candidate: MinimalOfferingMonitor | null;
  materialized_candidate: ReturnType<typeof materializeMinimalOfferingMonitor> | null;
};

export type OfferingMonitorSecondStageResult =
  | { status: "completed"; candidate: OfferingMonitorDiagnosticCandidate }
  | { status: "failed"; candidate: OfferingMonitorDiagnosticCandidate | null; error: string }
  | { status: "stale"; latestPrimaryAiRunId: string | null; providerCalled: boolean }
  | { status: "duplicate" }
  | { status: "input_reduction_failed"; stats: OfferingMonitorSecondStagePackage["stats"] };

export type OfferingMonitorSecondStageDependencies = {
  readParentAuthority(identity: OfferingMonitorJobIdentity): Promise<OfferingMonitorParentAuthority>;
  claimJob(jobId: string): Promise<boolean>;
  loadArtifacts(identity: OfferingMonitorJobIdentity): Promise<OfferingMonitorSecondStageArtifacts>;
  recordProviderStart(input: {
    identity: OfferingMonitorJobIdentity;
    artifacts: OfferingMonitorSecondStageArtifacts;
    package: OfferingMonitorSecondStagePackage;
  }): Promise<void>;
  runProvider(prompt: OfferingMonitorSecondStagePackage["prompt"]): Promise<OfferingMonitorProviderRun>;
  saveDiagnostic(input: {
    identity: OfferingMonitorJobIdentity;
    artifacts: OfferingMonitorSecondStageArtifacts;
    candidate: OfferingMonitorDiagnosticCandidate;
  }): Promise<void>;
  markFailed(input: {
    identity: OfferingMonitorJobIdentity;
    artifacts?: OfferingMonitorSecondStageArtifacts;
    error: string;
    providerRun?: OfferingMonitorProviderRun;
  }): Promise<void>;
  markStale(input: {
    identity: OfferingMonitorJobIdentity;
    artifacts?: OfferingMonitorSecondStageArtifacts;
    providerRun?: OfferingMonitorProviderRun;
  }): Promise<void>;
};

export function buildOfferingMonitorSecondStagePackage(input: {
  identity: OfferingMonitorJobIdentity;
  artifacts: OfferingMonitorSecondStageArtifacts;
}): OfferingMonitorSecondStagePackage {
  const { identity, artifacts } = input;
  const parentPayload = readRecord(artifacts.parentOutput.payload) || {};
  const parentAnalysis = readRecord(parentPayload.analysis) || {};
  const primaryContext = compactPrimaryContext(parentAnalysis);
  const selectedBlocks = selectEvidenceBlocks({
    preparedBlocks: artifacts.sourceInput.blocks,
    parentAnalysis: primaryContext,
    repairTrace: readRecord(parentPayload.validation_repair_trace),
  });
  const identityPayload = {
    event_id: identity.eventId,
    raw_item_id: identity.rawItemId,
    accession: identity.sourceIdentity,
    form_type: identity.formType,
    form_family: identity.family,
    parent_primary_ai_run_id: identity.parentPrimaryAiRunId,
    parent_prompt_key: identity.parentPromptKey,
    parent_prompt_version: identity.parentPromptVersion,
  };
  const sourcePackage = {
    current_filing: artifacts.sourceInput.currentFiling,
    source_inventory: artifacts.sourceInput.sourceInventory,
    attachment_inventory: artifacts.sourceInput.attachmentInventory,
    evidence_blocks: selectedBlocks,
  };
  const payload = {
    package_version: "offering_monitor_second_stage_input_v1",
    identity: identityPayload,
    parent_primary_context: primaryContext,
    source_package: sourcePackage,
  };
  const user = JSON.stringify({
    task: "Normalize the supplied exact filing lineage into the compact om1 Offering Monitor payload.",
    input_package: payload,
  });
  const packageText = JSON.stringify(payload);
  const factsChars = JSON.stringify(primaryContext).length;
  const sourceChars = JSON.stringify(sourcePackage).length;
  const sourceTextChars = selectedBlocks.reduce((sum, block) => sum + block.text.length, 0);
  const primarySourceTextChars = readPrimarySourceTextChars(artifacts.sourceInput, artifacts.sourceInput.blocks);
  const parentUsage = readRecord(artifacts.parentRun.usage);
  const parentPrimaryInputTokens = finiteNumber(parentUsage?.input_tokens);
  const promptChars = OFFERING_MONITOR_SECOND_STAGE_SYSTEM_PROMPT.length + user.length;
  const stats = {
    packageChars: packageText.length,
    promptChars,
    estimatedPromptTokens: Math.ceil(promptChars / 4),
    factsChars,
    sourceChars,
    sourceTextChars,
    sourceBlockCount: selectedBlocks.length,
    primarySourceTextChars,
    sourceTextRatio: primarySourceTextChars > 0 ? sourceTextChars / primarySourceTextChars : null,
    parentPrimaryInputTokens,
    selectedSourceRefs: selectedBlocks.map((block) => block.source_ref),
  };

  return {
    payload,
    prompt: {
      key: OFFERING_MONITOR_SECOND_STAGE_PROMPT_KEY,
      version: OFFERING_MONITOR_SECOND_STAGE_PROMPT_VERSION,
      system: OFFERING_MONITOR_SECOND_STAGE_SYSTEM_PROMPT,
      user,
      responseFormat: {
        json_schema: {
          name: "offering_monitor_second_stage",
          strict: true,
          schema: offeringMonitorSecondStageProviderSchema,
        },
      },
    },
    stats,
  };
}

export function validateOfferingMonitorProviderOutput(input: {
  identity: OfferingMonitorJobIdentity;
  package: OfferingMonitorSecondStagePackage;
  run: OfferingMonitorProviderRun;
}): OfferingMonitorDiagnosticCandidate {
  const errors: string[] = [];
  const outer = input.run.parsed;
  if (!input.run.ok || !outer) {
    errors.push(input.run.error || "Offering Monitor provider transport failed");
  } else {
    const keys = Object.keys(outer);
    if (keys.length !== 1 || keys[0] !== "offering_monitor_payload") {
      errors.push("provider output must contain exactly offering_monitor_payload");
    }
    if (typeof outer.offering_monitor_payload !== "string") {
      errors.push("offering_monitor_payload must be a string");
    }
  }

  const boundary = errors.length
    ? null
    : resolveMinimalOfferingMonitorBoundary(outer?.offering_monitor_payload);
  if (boundary && !boundary.value) errors.push(...boundary.provenance.errors);
  const canonical = boundary?.value || null;
  const materialized = canonical
    ? materializeMinimalOfferingMonitor(canonical, buildMinimalOfferingMarketSnapshot(null))
    : null;
  const validationStatus = !input.run.ok
    ? "transport_failed"
    : errors.length
      ? "validation_failed"
      : "success";

  return {
    schema_version: "offering_monitor_second_stage_candidate_v1",
    job_id: input.identity.jobId,
    parent_primary_ai_run_id: input.identity.parentPrimaryAiRunId,
    event_id: input.identity.eventId,
    raw_item_id: input.identity.rawItemId,
    source_identity: input.identity.sourceIdentity,
    prompt: {
      key: OFFERING_MONITOR_SECOND_STAGE_PROMPT_KEY,
      version: OFFERING_MONITOR_SECOND_STAGE_PROMPT_VERSION,
    },
    input_stats: input.package.stats,
    provider: {
      name: "gemini",
      model: input.run.model,
      response_id: input.run.responseId,
      http_status: input.run.status,
      response_ok: input.run.responseOk,
      attempts: 1,
      latency_ms: input.run.latencyMs,
      usage: input.run.usage,
    },
    raw_output: input.run.outputText,
    outer_payload: outer,
    validation: { status: validationStatus, errors },
    canonical_candidate: canonical,
    materialized_candidate: materialized,
  };
}

export async function processOfferingMonitorSecondStageJob(
  identity: OfferingMonitorJobIdentity,
  dependencies: OfferingMonitorSecondStageDependencies,
): Promise<OfferingMonitorSecondStageResult> {
  const initialAuthority = await dependencies.readParentAuthority(identity);
  if (initialAuthority.status !== "current") {
    await dependencies.markStale({ identity });
    return {
      status: "stale",
      latestPrimaryAiRunId: initialAuthority.latestPrimaryAiRunId,
      providerCalled: false,
    };
  }

  if (!await dependencies.claimJob(identity.jobId)) return { status: "duplicate" };

  let artifacts: OfferingMonitorSecondStageArtifacts;
  try {
    artifacts = await dependencies.loadArtifacts(identity);
  } catch (error) {
    const message = errorMessage(error, "Offering Monitor exact lineage artifacts are unavailable");
    await dependencies.markFailed({ identity, error: message });
    return { status: "failed", candidate: null, error: message };
  }

  const inputPackage = buildOfferingMonitorSecondStagePackage({ identity, artifacts });
  if (!isMeaningfullyReduced(inputPackage.stats)) {
    const error = "Second-stage source package is not meaningfully smaller than the Primary source input";
    await dependencies.markFailed({ identity, artifacts, error });
    return { status: "input_reduction_failed", stats: inputPackage.stats };
  }

  const preCallAuthority = await dependencies.readParentAuthority(identity);
  if (preCallAuthority.status !== "current") {
    await dependencies.markStale({ identity, artifacts });
    return {
      status: "stale",
      latestPrimaryAiRunId: preCallAuthority.latestPrimaryAiRunId,
      providerCalled: false,
    };
  }

  await dependencies.recordProviderStart({ identity, artifacts, package: inputPackage });
  const providerRun = await dependencies.runProvider(inputPackage.prompt);

  const postCallAuthority = await dependencies.readParentAuthority(identity);
  if (postCallAuthority.status !== "current") {
    await dependencies.markStale({ identity, artifacts, providerRun });
    return {
      status: "stale",
      latestPrimaryAiRunId: postCallAuthority.latestPrimaryAiRunId,
      providerCalled: true,
    };
  }

  const candidate = validateOfferingMonitorProviderOutput({ identity, package: inputPackage, run: providerRun });
  await dependencies.saveDiagnostic({ identity, artifacts, candidate });
  if (candidate.validation.status !== "success") {
    const error = candidate.validation.errors.join("; ") || "Offering Monitor normalization failed";
    return { status: "failed", candidate, error };
  }

  return { status: "completed", candidate };
}

function compactPrimaryContext(analysis: Record<string, unknown>) {
  const analysisOutput = readRecord(analysis.analysis_output);
  const source = analysisOutput || analysis;
  const keys = [
    "event_type",
    "event_title",
    "quick_take",
    "summary",
    "score",
    "score_reason",
    "score_explanation",
    "signal",
    "why_it_matters",
    "key_evidence",
    "what_to_watch_next",
    "offering_display_model",
    "offering_security_audit",
  ];
  const output: Record<string, unknown> = {};
  for (const key of keys) {
    if (source[key] !== undefined) output[key] = sanitizePrimaryValue(source[key]);
    else if (analysis[key] !== undefined) output[key] = sanitizePrimaryValue(analysis[key]);
  }
  if (analysis.display_payload !== undefined) output.display_payload = sanitizePrimaryValue(analysis.display_payload);
  else if (source.display_payload !== undefined) output.display_payload = sanitizePrimaryValue(source.display_payload);
  return output;
}

function sanitizePrimaryValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizePrimaryValue);
  const record = readRecord(value);
  if (!record) return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    if (["offering_monitor", "offering_monitor_payload", "offering_monitor_provenance", "parser_output"].includes(key)) {
      continue;
    }
    output[key] = sanitizePrimaryValue(child);
  }
  return output;
}

function selectEvidenceBlocks(input: {
  preparedBlocks: OfferingMonitorEvidenceBlock[];
  parentAnalysis: Record<string, unknown>;
  repairTrace: Record<string, unknown> | null;
}) {
  const { preparedBlocks } = input;
  const knownIds = new Set(preparedBlocks.flatMap((block) => [block.block_id, block.source_ref]).filter(Boolean));
  const referencedIds = collectKnownSourceRefs(input.parentAnalysis, knownIds);
  const repairSelection = readRecord(input.repairTrace?.source_selection);
  collectKnownSourceRefs(repairSelection?.selected_original_source_blocks, knownIds, referencedIds);

  const selectedIndexes = new Set<number>();
  for (let index = 0; index < preparedBlocks.length; index += 1) {
    const block = preparedBlocks[index];
    if (referencedIds.has(block.block_id) || referencedIds.has(block.source_ref)) {
      selectedIndexes.add(index);
      addStructuralNeighbor(preparedBlocks, selectedIndexes, index - 1, block);
      addStructuralNeighbor(preparedBlocks, selectedIndexes, index + 1, block);
    }
    if (block.source === "attachment") selectedIndexes.add(index);
  }

  if (!selectedIndexes.size) {
    for (const index of structuralRoundRobinIndexes(preparedBlocks)) {
      selectedIndexes.add(index);
      if (selectedIndexes.size >= 12) break;
    }
  }

  const prioritizedIndexes = [
    ...[...selectedIndexes].filter((index) => {
      const block = preparedBlocks[index];
      return referencedIds.has(block.block_id) || referencedIds.has(block.source_ref);
    }),
    ...[...selectedIndexes].filter((index) => {
      const block = preparedBlocks[index];
      return !referencedIds.has(block.block_id) && !referencedIds.has(block.source_ref);
    }),
  ];
  const bounded = new Set<number>();
  let textChars = 0;
  for (const index of prioritizedIndexes) {
    const block = preparedBlocks[index];
    if (!block || bounded.size >= MAX_EVIDENCE_BLOCKS) continue;
    if (textChars + block.text.length > MAX_EVIDENCE_TEXT_CHARS) continue;
    bounded.add(index);
    textChars += block.text.length;
  }
  return [...bounded].sort((left, right) => left - right).map((index) => preparedBlocks[index]);
}

function addStructuralNeighbor(
  blocks: OfferingMonitorEvidenceBlock[],
  selected: Set<number>,
  neighborIndex: number,
  anchor: OfferingMonitorEvidenceBlock,
) {
  const neighbor = blocks[neighborIndex];
  if (!neighbor) return;
  if (documentIdentity(neighbor) === documentIdentity(anchor)) selected.add(neighborIndex);
}

function structuralRoundRobinIndexes(blocks: OfferingMonitorEvidenceBlock[]) {
  const documents = new Map<string, number[]>();
  blocks.forEach((block, index) => {
    const id = documentIdentity(block) || `source:${block.source || "unknown"}`;
    const indexes = documents.get(id) || [];
    indexes.push(index);
    documents.set(id, indexes);
  });
  const output: number[] = [];
  for (let offset = 0; ; offset += 1) {
    let found = false;
    for (const indexes of documents.values()) {
      const index = indexes[offset];
      if (index === undefined) continue;
      output.push(index);
      found = true;
    }
    if (!found) break;
  }
  return output;
}

function collectKnownSourceRefs(value: unknown, knownIds: Set<string>, output = new Set<string>()) {
  if (Array.isArray(value)) {
    for (const item of value) collectKnownSourceRefs(item, knownIds, output);
    return output;
  }
  const record = readRecord(value);
  if (record) {
    for (const child of Object.values(record)) collectKnownSourceRefs(child, knownIds, output);
    return output;
  }
  if (typeof value === "string" && knownIds.has(value)) output.add(value);
  return output;
}

function readPrimarySourceTextChars(sourceInput: OfferingMonitorSourceInput, blocks: OfferingMonitorEvidenceBlock[]) {
  const budget = readRecord(sourceInput.sourceInventory?.sourceBlockBudget);
  return finiteNumber(budget?.includedTextChars) ?? blocks.reduce((sum, block) => sum + block.text.length, 0);
}

function isMeaningfullyReduced(stats: OfferingMonitorSecondStagePackage["stats"]) {
  return stats.sourceBlockCount > 0 && stats.sourceTextRatio !== null && stats.sourceTextRatio < MAX_SOURCE_RATIO;
}

function documentIdentity(block: OfferingMonitorEvidenceBlock) {
  return block.document_id || block.document_name || block.source || "";
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
