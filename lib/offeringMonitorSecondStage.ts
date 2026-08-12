import {
  buildMinimalOfferingMarketSnapshot,
  materializeMinimalOfferingMonitor,
  minimalOfferingMonitorProviderSchema,
  parseMinimalOfferingMonitorPayload,
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

export const OFFERING_MONITOR_SECOND_STAGE_WIRE_FACT_KEYS = [
  "amount",
  "price",
  "immediate",
  "additional",
  "resale",
] as const;

const OFFERING_MONITOR_SECOND_STAGE_CONTRACT = [
  "OM1 WIRE CONTRACT: offering_monitor_payload is one minified JSON string. Its decoded object has exactly v, app, stage, side, nature, w, pfw, conv, facts. v is om1. Every key is required.",
  "app is applicable or source-backed not_applicable. stage is registration_only, active_offering, priced, closed, or unknown. side is primary, resale, mixed, not_applicable, or unknown. nature is equity, equity_linked, debt, mixed, non_equity, or unknown. w, pfw, and conv are true, false, or null.",
  "facts has exactly five wire keys: amount, price, immediate, additional, resale. Do not emit aliases or any other fact key. Do not emit total; deterministic code derives it only when immediate and additional are compatible.",
  "Every fact has exactly value, availability, quality, bound, unit, currency, security_basis, comparison_basis, comparable, source. availability is available or unavailable. quality is exact, derived, estimated, or unknown. bound is exact, maximum, minimum, or unknown. unit is currency, currency_per_security, shares, other, or unknown. comparison_basis is always a string from shares_outstanding, public_float, market_cap, market_price, none, or unknown; it is never null, including when the fact is unavailable. comparable is true, false, or null.",
  "For an available fact, value is a non-negative JSON number, security_basis is non-empty, source is one allowed SEC source_ref, and currency is non-empty for currency units. For an unavailable fact, value and source are null; use the fact's standard comparison basis when known or unknown otherwise. Never use empty strings, placeholders, sentinels, decorated numbers, suffix numbers, or inferred defaults.",
  "Classify side from actual sellers, proceeds recipients, and transaction structure. primary means issuer-sold securities whose proceeds go to the issuer; resale means selling-securityholder resale; mixed means both occur in this transaction. Multiple instruments alone, future resale, transfer restrictions, or boilerplate do not make side mixed.",
  "amount is the source-backed gross amount the issuer raises in the current primary transaction. Do not substitute net proceeds, shelf capacity, resale market value, selling-holder proceeds, amount remaining, or unrelated values. Preserve approximate or up-to meaning with quality and bound; for mixed include only the issuer-primary portion.",
  "price is the source-backed per-security price. immediate is the deduplicated immediate primary share-equivalent pool. additional is a distinct potential primary exposure not already included in immediate and is not a combined total. resale is selling-securityholder share exposure and remains separate from issuer-primary exposure.",
  "Available amount uses unit currency and comparison_basis market_cap; price uses currency_per_security and market_price; immediate and additional use shares and shares_outstanding; resale uses shares and public_float. For primary side keep resale unavailable; for resale side keep amount, immediate, and additional unavailable.",
  "Use parent_primary_context only as context. It is not SEC provenance. Ground each available fact in supplied SEC evidence, and return only a source_ref listed in allowed_source_refs. block_id, parent_primary_context, row IDs, display labels, and document labels are not returnable fact sources.",
  "For source-backed non-equity not_applicable, keep all five facts unavailable. Do not add components, groups, calculation inputs, row sets, evidence objects, confidence objects, or any field outside this contract.",
].join("\n");

export const OFFERING_MONITOR_SECOND_STAGE_SYSTEM_PROMPT = [
  "You are not rewriting the user-facing filing analysis.",
  "You are independently normalizing a small set of canonical Offering Monitor facts for deterministic filtering, monitoring, historical matching, and backtesting.",
  "The Display analysis and Monitor facts serve different purposes and do not have to use the same representation. Do not copy a Display number unless the source package independently supports the Monitor definition.",
  OFFERING_MONITOR_SECOND_STAGE_CONTRACT,
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
  allowedSourceRefs: string[];
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
    allowedSourceRefCount: number;
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
  const allowedSourceRefs = buildAllowedSourceRefs(selectedBlocks);
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
    allowed_source_refs: allowedSourceRefs,
    source_package: sourcePackage,
  };
  const user = [
    JSON.stringify({
      task: "Normalize the supplied exact filing lineage into the compact om1 Offering Monitor payload.",
      input_package: payload,
    }),
    buildFinalOutputContract(allowedSourceRefs),
  ].join("\n\n");
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
    selectedSourceRefs: [...allowedSourceRefs],
    allowedSourceRefCount: allowedSourceRefs.length,
  };

  return {
    payload,
    allowedSourceRefs,
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
  const transportErrors: string[] = [];
  const validationErrors: string[] = [];
  let outer: Record<string, unknown> | null = null;
  if (!input.run.ok) {
    transportErrors.push(input.run.error || "Offering Monitor provider transport failed");
  } else {
    const strictOuter = parseMinimalOfferingMonitorPayload(input.run.outputText);
    if (!strictOuter.ok) {
      transportErrors.push(`provider outer JSON is invalid: ${strictOuter.errors.join("; ")}`);
    } else {
      outer = readRecord(strictOuter.value);
      if (!outer) transportErrors.push("provider output must be one JSON object");
    }
    if (outer) {
      const keys = Object.keys(outer);
      if (keys.length !== 1 || keys[0] !== "offering_monitor_payload") {
        transportErrors.push("provider output must contain exactly offering_monitor_payload");
      }
      if (typeof outer.offering_monitor_payload !== "string") {
        transportErrors.push("offering_monitor_payload must be a string");
      }
    }
  }

  const boundary = transportErrors.length
    ? null
    : resolveMinimalOfferingMonitorBoundary(outer?.offering_monitor_payload);
  if (boundary && !boundary.value) {
    const target = boundary.provenance.status === "transport_failed" ? transportErrors : validationErrors;
    target.push(...boundary.provenance.errors);
  }
  const canonical = boundary?.value || null;
  if (canonical) {
    validateOfferingMonitorSourceMembership(canonical, input.package.allowedSourceRefs, validationErrors);
  }
  const materialized = canonical
    && !validationErrors.length
    ? materializeMinimalOfferingMonitor(canonical, buildMinimalOfferingMarketSnapshot(null))
    : null;
  const errors = [...transportErrors, ...validationErrors];
  const validationStatus = transportErrors.length
    ? "transport_failed"
    : validationErrors.length
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

function buildAllowedSourceRefs(blocks: OfferingMonitorEvidenceBlock[]) {
  const refs = blocks.map((block) => block.source_ref);
  const unique = new Set(refs);
  if (!refs.length || unique.size !== refs.length || refs.some((ref) => !ref)) {
    throw new Error("Offering Monitor selected SEC evidence must have unique stable source_ref values");
  }
  return refs;
}

function buildFinalOutputContract(allowedSourceRefs: string[]) {
  return [
    "FINAL OUTPUT CONTRACT",
    "Return only one JSON object with exactly one outer key: offering_monitor_payload.",
    "offering_monitor_payload is one minified om1 JSON string whose facts keys are exactly amount, price, immediate, additional, resale.",
    `For every available fact, source must be exactly one of these allowed_source_refs: ${JSON.stringify(allowedSourceRefs)}.`,
    "Do not return block_id, parent_primary_context, row IDs, display labels, or document labels as source.",
    "No aliases. No markdown. No commentary. No explanation. No trailing text.",
  ].join("\n");
}

function validateOfferingMonitorSourceMembership(
  monitor: MinimalOfferingMonitor,
  allowedSourceRefs: string[],
  errors: string[],
) {
  const allowed = new Set(allowedSourceRefs);
  const facts = [
    ["amount", monitor.facts.actual_primary_offering_amount],
    ["price", monitor.facts.offering_price],
    ["immediate", monitor.facts.immediate_primary_share_exposure],
    ["additional", monitor.facts.additional_potential_primary_share_exposure],
    ["resale", monitor.facts.resale_share_exposure],
  ] as const;
  for (const [wireKey, fact] of facts) {
    if (fact.availability !== "available") continue;
    if (!fact.source_ref || !allowed.has(fact.source_ref)) {
      errors.push(`facts.${wireKey}.source must be a member of allowed_source_refs`);
    }
  }
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
