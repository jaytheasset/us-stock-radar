import {
  buildMinimalOfferingMarketSnapshot,
  materializeMinimalOfferingMonitor,
  parseJsonWithoutDuplicateKeys,
  validateMinimalOfferingMonitor,
  type MinimalOfferingMonitor,
  type MinimalOfferingNumericFact,
} from "./minimalOfferingMonitor.ts";
import type {
  OfferingMonitorJobIdentity,
  OfferingMonitorParentAuthority,
} from "./offeringMonitorJobFoundation.ts";
import { OFFERING_MONITOR_EXECUTION_CONTRACT_VERSION } from "./offeringMonitorJobFoundation.ts";
import {
  LEVEL2_SHARE_COUNT_OBSERVATION_FIELD,
  LEVEL2_SHARE_COUNT_PROMPT_CONTRACT,
  LEVEL2_SHARE_COUNT_PROVIDER_SCHEMA,
  extractLevel2ShareCountSidecar,
  type Level2ShareCountValidatedCandidate,
} from "./sec-structured-data/level2ShareCountObservation.ts";

export const OFFERING_MONITOR_SECOND_STAGE_PROMPT_KEY = "offering_monitor_normalization_job";
export const OFFERING_MONITOR_SECOND_STAGE_PROMPT_VERSION = OFFERING_MONITOR_EXECUTION_CONTRACT_VERSION;
export const OFFERING_MONITOR_SECOND_STAGE_OUTPUT_TYPE = "offering_monitor_normalization_candidate";

const MAX_EVIDENCE_BLOCKS = 28;
const MAX_EVIDENCE_TEXT_CHARS = 100_000;
const MAX_SOURCE_RATIO = 0.9;
export const OFFERING_MONITOR_MAX_NUMERIC_LITERAL_CHARS = 128;

export const OFFERING_MONITOR_SECOND_STAGE_MONETARY_FACT_KEYS = [
  "actual_primary_offering_amount",
  "offering_price",
] as const;

export const OFFERING_MONITOR_SECOND_STAGE_SHARE_FACT_KEYS = [
  "immediate_primary_share_exposure",
  "additional_potential_primary_share_exposure",
  "resale_share_exposure",
] as const;

const offeringMonitorAvailableMonetaryFactProviderSchema = {
  type: "object",
  required: [
    "fact_key", "value", "value_quality", "bound", "unit", "currency", "security_basis",
    "comparison_basis_type", "source_ref",
  ],
  properties: {
    fact_key: { type: "string", enum: OFFERING_MONITOR_SECOND_STAGE_MONETARY_FACT_KEYS },
    value: { type: "number" },
    value_quality: { type: "string" },
    bound: { type: "string" },
    unit: { type: "string" },
    currency: { type: "string" },
    security_basis: { type: "string" },
    comparison_basis_type: { type: "string" },
    comparable_to_event_market_basis: { type: "boolean" },
    source_ref: { type: "string" },
  },
} as const;

const offeringMonitorAvailableShareFactProviderSchema = {
  type: "object",
  required: [
    "fact_key", "value", "value_quality", "bound", "unit", "security_basis",
    "comparison_basis_type", "source_ref",
  ],
  properties: {
    fact_key: { type: "string", enum: OFFERING_MONITOR_SECOND_STAGE_SHARE_FACT_KEYS },
    value: { type: "number" },
    value_quality: { type: "string" },
    bound: { type: "string" },
    unit: { type: "string" },
    security_basis: { type: "string" },
    comparison_basis_type: { type: "string" },
    comparable_to_event_market_basis: { type: "boolean" },
    source_ref: { type: "string" },
  },
} as const;

export const OFFERING_MONITOR_SECOND_STAGE_FACT_KEYS = [
  "actual_primary_offering_amount",
  "offering_price",
  "immediate_primary_share_exposure",
  "additional_potential_primary_share_exposure",
  "resale_share_exposure",
] as const;

export const offeringMonitorSecondStageProviderSchema = {
  type: "object",
  required: [
    "version", "applicability", "financing_stage", "primary_or_resale", "security_nature",
    "available_monetary_facts", "available_share_facts", "unavailable_fact_keys",
  ],
  properties: {
    version: { type: "string" },
    applicability: { type: "string" },
    financing_stage: { type: "string" },
    primary_or_resale: { type: "string" },
    security_nature: { type: "string" },
    has_warrant: { type: "boolean" },
    has_prefunded_warrant: { type: "boolean" },
    has_convertible: { type: "boolean" },
    available_monetary_facts: {
      type: "array",
      items: offeringMonitorAvailableMonetaryFactProviderSchema,
    },
    available_share_facts: {
      type: "array",
      items: offeringMonitorAvailableShareFactProviderSchema,
    },
    unavailable_fact_keys: {
      type: "array",
      items: { type: "string", enum: OFFERING_MONITOR_SECOND_STAGE_FACT_KEYS },
    },
    [LEVEL2_SHARE_COUNT_OBSERVATION_FIELD]: LEVEL2_SHARE_COUNT_PROVIDER_SCHEMA,
  },
} as const;

const OFFERING_MONITOR_SECOND_STAGE_CONTRACT = [
  "DIRECT MONITOR CONTRACT: return one direct object. Do not return a wrapper field, legacy aliases, or a JSON string containing JSON.",
  "The root fields are version, applicability, financing_stage, primary_or_resale, security_nature, has_warrant, has_prefunded_warrant, has_convertible, available_monetary_facts, available_share_facts, and unavailable_fact_keys. version is minimal_offering_monitor_v1. applicability is applicable when supplied SEC evidence supports a current offering/financing or selling-holder resale, or source-backed not_applicable otherwise; failure is never not_applicable. financing_stage is registration_only, active_offering, priced, closed, or unknown. primary_or_resale is primary, resale, mixed, not_applicable, or unknown. security_nature is equity, equity_linked, debt, mixed, non_equity, or unknown. Omit a warrant/convertible boolean only when its canonical value is unknown; never invent a default.",
  "The five canonical facts remain actual_primary_offering_amount, offering_price, immediate_primary_share_exposure, additional_potential_primary_share_exposure, and resale_share_exposure. Put each fact key exactly once in one place: an available row or unavailable_fact_keys. Never omit, duplicate, or place the same fact in both. Array order has no meaning. Do not emit total; deterministic code derives total only when immediate and additional are compatible.",
  "available_monetary_facts contains only actual_primary_offering_amount and offering_price rows. Every row requires fact_key, value, value_quality, bound, unit, currency, security_basis, comparison_basis_type, and source_ref. available_share_facts contains only immediate_primary_share_exposure, additional_potential_primary_share_exposure, and resale_share_exposure rows. Every row requires fact_key, value, value_quality, bound, unit, security_basis, comparison_basis_type, and source_ref. comparable_to_event_market_basis may be included only as a boolean when known.",
  "unavailable_fact_keys contains only fact key strings. It is the complete unavailable representation: never create an unavailable row and never invent value, currency, security_basis, source_ref, empty strings, nulls, placeholders, sentinels, decorated numbers, suffix numbers, or inferred defaults for an unavailable fact.",
  "value_quality is exact, derived, estimated, or unknown. bound is exact, maximum, minimum, or unknown. unit is currency, currency_per_security, shares, other, or unknown. comparison_basis_type is shares_outstanding, public_float, market_cap, market_price, none, or unknown. Every available value is a non-negative JSON number, security_basis is non-empty, source_ref is one allowed SEC source_ref, and every available monetary row has non-empty currency.",
  "Classify side from actual sellers, proceeds recipients, and the current transaction structure. primary means issuer-sold securities whose proceeds go to the issuer; resale means an actual selling-securityholder resale; mixed requires both in this same current transaction. Multiple instruments alone, future resale rights, transfer restrictions, Rule 144 language, or possible later warrant-share sales do not make side mixed.",
  "actual_primary_offering_amount is the source-backed gross size of the current specific issuer-primary transaction, not only closed cash or a fixed final amount. Preserve a source-stated approximate, up-to, or committed maximum with value_quality and bound; a gross/net fee difference does not invalidate gross. Never substitute net proceeds, a generic registration or fee-table ceiling, shelf capacity, resale value/proceeds, amount remaining, or unrelated values; for mixed include only the issuer-primary portion.",
  "FINANCING AMOUNT: Return actual_primary_offering_amount as available when any supplied SEC evidence directly states or establishes the size of the current issuer financing transaction. The source_ref may be any supplied SEC source that directly supports that economic fact; do not require one specific document type or source_ref. Do not select a source merely because it contains the same number: a filing-fee calculation, registration capacity, resale value, or other administrative amount is insufficient unless it actually establishes the current issuer financing transaction amount. If qualifying transaction evidence is present, do not mark the fact unavailable merely because another source contains the same amount. Return unavailable only when no supplied SEC source supports the current financing transaction amount.",
  "offering_price is the source-backed per-security price. immediate_primary_share_exposure is the deduplicated immediate primary share-equivalent pool. additional_potential_primary_share_exposure is only distinct conditional/potential primary exposure not already in immediate and is not a total. Use source relationships to distinguish simultaneous, alternative, substitute, exercise, and conversion exposure; equal values alone do not prove duplication and alternatives are not simultaneous. resale_share_exposure is actual selling-securityholder share exposure kept separate from issuer-primary exposure.",
  "Return every numeric value in the shortest ordinary JSON number that preserves source-supported value and precision, such as 1250000, 0.625, or 15750000. Never pad trailing zeros, invent decimal precision, emit a floating-point artifact, or expand a concise source number. A short exponent form is allowed when it is the shortest source-faithful JSON number.",
  "Available actual_primary_offering_amount uses unit currency and comparison_basis_type market_cap; offering_price uses currency_per_security and market_price; immediate_primary_share_exposure and additional_potential_primary_share_exposure use shares and shares_outstanding; resale_share_exposure uses shares and public_float. For primary side keep resale_share_exposure unavailable; for resale side keep actual_primary_offering_amount, immediate_primary_share_exposure, and additional_potential_primary_share_exposure unavailable.",
  "Use parent_primary_context only as context. It is not SEC provenance. Ground each available fact in supplied SEC evidence, and return only a source_ref listed in allowed_source_refs. block_id, parent_primary_context, row IDs, display labels, and document labels are not returnable fact sources.",
  "For source-backed non-equity not_applicable, put all five facts in unavailable_fact_keys and keep both available collections empty. Do not add components, groups, calculation inputs, row sets, evidence objects, confidence objects, or any field outside this contract.",
  LEVEL2_SHARE_COUNT_PROMPT_CONTRACT,
].join("\n");

export const OFFERING_MONITOR_SECOND_STAGE_SYSTEM_PROMPT = [
  "ROLE: You are the Offering Monitor Normalizer.",
  "GOAL: Independently normalize only the small set of canonical Offering Monitor facts needed for deterministic filtering, monitoring, historical matching, and backtesting. Do not produce or revise score, signal, title, summary, why-it-matters, or other user-facing analysis.",
  "INPUT AUTHORITY: parent_primary_context is analysis context only. Supplied SEC evidence is the grounding authority, and allowed_source_refs is the only valid provenance namespace.",
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

export type OfferingMonitorEvidenceDocumentGroup = {
  document_identity: {
    key: string;
    source: string | null;
    document_id: string | null;
    document_name: string | null;
  };
  evidence_blocks: OfferingMonitorEvidenceBlock[];
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
  sourceDocuments: OfferingMonitorEvidenceBlock[];
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
    sourceDocumentGroupCount: number;
    ungroupedPackageChars: number;
    ungroupedPromptChars: number;
    ungroupedEstimatedPromptTokens: number;
    groupingAddedPackageChars: number;
    groupingAddedPromptChars: number;
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
  schema_version: "offering_monitor_second_stage_candidate_v2";
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
  direct_payload: Record<string, unknown> | null;
  validation: {
    status: "success" | "transport_failed" | "validation_failed";
    errors: string[];
  };
  canonical_candidate: MinimalOfferingMonitor | null;
  materialized_candidate: ReturnType<typeof materializeMinimalOfferingMonitor> | null;
  share_count_observation_candidate?: Level2ShareCountValidatedCandidate | null;
  share_count_observation_validation?: {
    present: boolean;
    errors: string[];
  };
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
  const evidenceDocumentGroups = groupOfferingMonitorEvidenceBlocks(selectedBlocks);
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
    evidence_document_groups: evidenceDocumentGroups,
  };
  const payload = {
    package_version: "offering_monitor_second_stage_input_v1",
    identity: identityPayload,
    parent_primary_context: primaryContext,
    allowed_source_refs: allowedSourceRefs,
    source_package: sourcePackage,
  };
  const finalOutputContract = buildFinalOutputContract(allowedSourceRefs);
  const user = [
    JSON.stringify({
      task: "Normalize the supplied exact filing lineage into the direct readable Minimal Offering Monitor object.",
      input_package: payload,
    }),
    finalOutputContract,
  ].join("\n\n");
  const packageText = JSON.stringify(payload);
  const ungroupedSourcePackage = {
    current_filing: artifacts.sourceInput.currentFiling,
    source_inventory: artifacts.sourceInput.sourceInventory,
    attachment_inventory: artifacts.sourceInput.attachmentInventory,
    evidence_blocks: selectedBlocks,
  };
  const ungroupedPayload = { ...payload, source_package: ungroupedSourcePackage };
  const ungroupedPackageText = JSON.stringify(ungroupedPayload);
  const ungroupedUser = [
    JSON.stringify({
      task: "Normalize the supplied exact filing lineage into the direct readable Minimal Offering Monitor object.",
      input_package: ungroupedPayload,
    }),
    finalOutputContract,
  ].join("\n\n");
  const factsChars = JSON.stringify(primaryContext).length;
  const sourceChars = JSON.stringify(sourcePackage).length;
  const sourceTextChars = selectedBlocks.reduce((sum, block) => sum + block.text.length, 0);
  const primarySourceTextChars = readPrimarySourceTextChars(artifacts.sourceInput, artifacts.sourceInput.blocks);
  const parentUsage = readRecord(artifacts.parentRun.usage);
  const parentPrimaryInputTokens = finiteNumber(parentUsage?.input_tokens);
  const promptChars = OFFERING_MONITOR_SECOND_STAGE_SYSTEM_PROMPT.length + user.length;
  const ungroupedPromptChars = OFFERING_MONITOR_SECOND_STAGE_SYSTEM_PROMPT.length + ungroupedUser.length;
  const stats = {
    packageChars: packageText.length,
    promptChars,
    estimatedPromptTokens: Math.ceil(promptChars / 4),
    factsChars,
    sourceChars,
    sourceTextChars,
    sourceBlockCount: selectedBlocks.length,
    sourceDocumentGroupCount: evidenceDocumentGroups.length,
    ungroupedPackageChars: ungroupedPackageText.length,
    ungroupedPromptChars,
    ungroupedEstimatedPromptTokens: Math.ceil(ungroupedPromptChars / 4),
    groupingAddedPackageChars: packageText.length - ungroupedPackageText.length,
    groupingAddedPromptChars: promptChars - ungroupedPromptChars,
    primarySourceTextChars,
    sourceTextRatio: primarySourceTextChars > 0 ? sourceTextChars / primarySourceTextChars : null,
    parentPrimaryInputTokens,
    selectedSourceRefs: [...allowedSourceRefs],
    allowedSourceRefCount: allowedSourceRefs.length,
  };

  return {
    payload,
    allowedSourceRefs,
    sourceDocuments: selectedBlocks,
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

export function groupOfferingMonitorEvidenceBlocks(
  blocks: OfferingMonitorEvidenceBlock[],
): OfferingMonitorEvidenceDocumentGroup[] {
  const groups = new Map<string, OfferingMonitorEvidenceDocumentGroup>();
  for (const block of blocks) {
    const key = documentIdentity(block);
    let group = groups.get(key);
    if (!group) {
      group = {
        document_identity: {
          key,
          source: block.source,
          document_id: block.document_id,
          document_name: block.document_name,
        },
        evidence_blocks: [],
      };
      groups.set(key, group);
    }
    group.evidence_blocks.push(block);
  }
  return [...groups.values()];
}

export function validateOfferingMonitorProviderOutput(input: {
  identity: OfferingMonitorJobIdentity;
  package: OfferingMonitorSecondStagePackage;
  run: OfferingMonitorProviderRun;
}): OfferingMonitorDiagnosticCandidate {
  const transportErrors: string[] = [];
  const validationErrors: string[] = [];
  let direct: Record<string, unknown> | null = null;
  if (input.run.outputText) {
    try {
      assertOfferingMonitorNumericLiteralSafety(input.run.outputText);
    } catch (error) {
      transportErrors.push(`provider direct JSON is invalid: ${error instanceof Error ? error.message : "unknown numeric literal error"}`);
    }
  }
  if (!input.run.ok) {
    if (!transportErrors.length) transportErrors.push(input.run.error || "Offering Monitor provider transport failed");
  } else if (!transportErrors.length) {
    try {
      direct = readRecord(parseJsonWithoutDuplicateKeys(input.run.outputText));
      if (!direct) transportErrors.push("provider output must be one direct JSON object");
    } catch (error) {
      transportErrors.push(`provider direct JSON is invalid: ${error instanceof Error ? error.message : "unknown parse error"}`);
    }
  }

  const sidecar = direct
    ? extractLevel2ShareCountSidecar({
        payload: direct,
        accessionNumber: input.identity.sourceIdentity,
        sourceDocumentUrl: readOfferingSourceDocumentUrl(input.package.payload),
        sourceDocuments: input.package.sourceDocuments.map((block) => ({
          source_ref: block.source_ref,
          text: block.text,
          document_name: block.document_name,
          label: block.document_id || block.section_title,
        })),
      })
    : { domainPayload: {}, candidate: null, errors: [], present: false };
  const normalized = transportErrors.length ? null : normalizeDirectOfferingMonitor(sidecar.domainPayload);
  if (normalized && !normalized.ok) validationErrors.push(...normalized.errors);
  const canonical = normalized?.ok ? normalized.value : null;
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
    schema_version: "offering_monitor_second_stage_candidate_v2",
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
    direct_payload: direct,
    validation: { status: validationStatus, errors },
    canonical_candidate: canonical,
    materialized_candidate: materialized,
    share_count_observation_candidate: sidecar.candidate,
    share_count_observation_validation: {
      present: sidecar.present,
      errors: sidecar.errors,
    },
  };
}

function readOfferingSourceDocumentUrl(payload: Record<string, unknown>) {
  const sourcePackage = readRecord(payload.source_package);
  const currentFiling = readRecord(sourcePackage?.current_filing);
  return textValue(currentFiling?.primary_document_url)
    || textValue(currentFiling?.source_url)
    || null;
}

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function assertOfferingMonitorNumericLiteralSafety(text: string) {
  let index = 0;
  while (index < text.length) {
    if (text[index] === '"') {
      index += 1;
      while (index < text.length) {
        if (text[index] === "\\") {
          index += 2;
          continue;
        }
        if (text[index] === '"') {
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }
    if (text[index] !== "-" && !/[0-9]/.test(text[index] || "")) {
      index += 1;
      continue;
    }
    const numeric = text.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (!numeric) {
      index += 1;
      continue;
    }
    if (numeric[0].length > OFFERING_MONITOR_MAX_NUMERIC_LITERAL_CHARS) {
      throw new Error(`numeric_literal_too_long at character ${index}`);
    }
    index += numeric[0].length;
  }
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
    "Return only the direct Offering Monitor JSON object. Never return offering_monitor_payload or nested JSON text.",
    "Use exactly available_monetary_facts, available_share_facts, and unavailable_fact_keys to cover each of the five canonical fact keys once; no aliases, unavailable objects, or extra keys.",
    `For every available row, source_ref must be exactly one of these allowed_source_refs: ${JSON.stringify(allowedSourceRefs)}.`,
    "Do not return block_id, parent_primary_context, row IDs, display labels, or document labels as source_ref.",
    "No aliases. No markdown. No commentary. No explanation. No trailing text.",
  ].join("\n");
}

function validateOfferingMonitorSourceMembership(
  monitor: MinimalOfferingMonitor,
  allowedSourceRefs: string[],
  errors: string[],
) {
  const allowed = new Set(allowedSourceRefs);
  const facts = Object.entries(monitor.facts) as Array<[string, MinimalOfferingNumericFact]>;
  for (const [factKey, fact] of facts) {
    if (fact.availability === "available" && !fact.source_ref) {
      errors.push(`facts.${factKey}.source_ref must be a member of allowed_source_refs`);
    } else if (fact.source_ref && !allowed.has(fact.source_ref)) {
      errors.push(`facts.${factKey}.source_ref must be a member of allowed_source_refs`);
    }
  }
}

function normalizeDirectOfferingMonitor(value: unknown):
  | { ok: true; value: MinimalOfferingMonitor; errors: [] }
  | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const root = readRecord(value);
  if (!root) return { ok: false, errors: ["direct offering monitor must be an object"] };
  validateDirectKeys(root, [
    "version", "applicability", "financing_stage", "primary_or_resale", "security_nature",
    "has_warrant", "has_prefunded_warrant", "has_convertible", "available_monetary_facts",
    "available_share_facts", "unavailable_fact_keys",
  ], [
    "version", "applicability", "financing_stage", "primary_or_resale", "security_nature",
    "available_monetary_facts", "available_share_facts", "unavailable_fact_keys",
  ], "offering_monitor", errors);
  for (const key of ["version", "applicability", "financing_stage", "primary_or_resale", "security_nature"] as const) {
    if (typeof root[key] !== "string") errors.push(`${key} must be a string`);
  }
  for (const key of ["has_warrant", "has_prefunded_warrant", "has_convertible"] as const) {
    if (root[key] !== undefined && typeof root[key] !== "boolean") errors.push(`${key} must be a boolean when present`);
  }
  const monetaryRows = normalizeAvailableFactRows(
    root.available_monetary_facts,
    "available_monetary_facts",
    OFFERING_MONITOR_SECOND_STAGE_MONETARY_FACT_KEYS,
    true,
    errors,
  );
  const shareRows = normalizeAvailableFactRows(
    root.available_share_facts,
    "available_share_facts",
    OFFERING_MONITOR_SECOND_STAGE_SHARE_FACT_KEYS,
    false,
    errors,
  );
  const unavailableKeys = normalizeUnavailableFactKeys(root.unavailable_fact_keys, errors);
  const occurrences = new Map<string, Array<"available_monetary_facts" | "available_share_facts" | "unavailable_fact_keys">>();
  for (const row of monetaryRows) addFactOccurrence(occurrences, row.factKey, "available_monetary_facts");
  for (const row of shareRows) addFactOccurrence(occurrences, row.factKey, "available_share_facts");
  for (const key of unavailableKeys) addFactOccurrence(occurrences, key, "unavailable_fact_keys");
  for (const key of OFFERING_MONITOR_SECOND_STAGE_FACT_KEYS) {
    const locations = occurrences.get(key) || [];
    if (!locations.length) errors.push(`fact coverage is missing ${key}`);
    else if (locations.length > 1) errors.push(`fact coverage duplicates ${key} across ${locations.join(", ")}`);
  }
  const normalizedFacts = {} as MinimalOfferingMonitor["facts"];
  for (const row of [...monetaryRows, ...shareRows]) normalizedFacts[row.factKey] = row.fact;
  for (const key of unavailableKeys) normalizedFacts[key] = unavailableCanonicalFact(key);
  if (errors.length) return { ok: false, errors };
  return validateMinimalOfferingMonitor({
    version: root.version,
    applicability: root.applicability,
    financing_stage: root.financing_stage,
    primary_or_resale: root.primary_or_resale,
    security_nature: root.security_nature,
    has_warrant: root.has_warrant ?? null,
    has_prefunded_warrant: root.has_prefunded_warrant ?? null,
    has_convertible: root.has_convertible ?? null,
    facts: normalizedFacts,
  });
}

type OfferingMonitorSecondStageFactKey = typeof OFFERING_MONITOR_SECOND_STAGE_FACT_KEYS[number];

function normalizeAvailableFactRows(
  value: unknown,
  collection: "available_monetary_facts" | "available_share_facts",
  allowedFactKeys: readonly OfferingMonitorSecondStageFactKey[],
  monetary: boolean,
  errors: string[],
) {
  if (!Array.isArray(value)) {
    errors.push(`${collection} must be an array`);
    return [] as Array<{ factKey: OfferingMonitorSecondStageFactKey; fact: MinimalOfferingNumericFact }>;
  }
  const rows: Array<{ factKey: OfferingMonitorSecondStageFactKey; fact: MinimalOfferingNumericFact }> = [];
  value.forEach((candidate, index) => {
    const path = `${collection}[${index}]`;
    const row = readRecord(candidate);
    if (!row) {
      errors.push(`${path} must be an object`);
      return;
    }
    const commonRequired = [
      "fact_key", "value", "value_quality", "bound", "unit", "security_basis",
      "comparison_basis_type", "source_ref",
    ];
    const required = monetary ? [...commonRequired, "currency"] : commonRequired;
    const optional = ["comparable_to_event_market_basis"];
    validateDirectKeys(row, [...required, ...optional], required, path, errors);
    const factKey = typeof row.fact_key === "string" ? row.fact_key : "";
    if (!factKey) errors.push(`${path}.fact_key must be a string`);
    else if (!OFFERING_MONITOR_SECOND_STAGE_FACT_KEYS.includes(factKey as OfferingMonitorSecondStageFactKey)) {
      errors.push(`${path}.fact_key is unknown`);
    } else if (!allowedFactKeys.includes(factKey as OfferingMonitorSecondStageFactKey)) {
      errors.push(`${path}.fact_key belongs to the wrong fact family`);
    }
    if (typeof row.value !== "number" || !Number.isFinite(row.value)) errors.push(`${path}.value must be a finite number`);
    for (const key of ["value_quality", "bound", "unit", "security_basis", "comparison_basis_type", "source_ref"] as const) {
      if (typeof row[key] !== "string" || !row[key].trim() || row[key] !== row[key].trim()) {
        errors.push(`${path}.${key} must be a non-empty string`);
      }
    }
    if (monetary && (typeof row.currency !== "string" || !row.currency.trim() || row.currency !== row.currency.trim())) {
      errors.push(`${path}.currency must be a non-empty string`);
    }
    if (row.comparable_to_event_market_basis !== undefined && typeof row.comparable_to_event_market_basis !== "boolean") {
      errors.push(`${path}.comparable_to_event_market_basis must be a boolean when present`);
    }
    if (!OFFERING_MONITOR_SECOND_STAGE_FACT_KEYS.includes(factKey as OfferingMonitorSecondStageFactKey)) return;
    rows.push({
      factKey: factKey as OfferingMonitorSecondStageFactKey,
      fact: {
        value: typeof row.value === "number" && Number.isFinite(row.value) ? row.value : null,
        availability: "available",
        value_quality: row.value_quality as MinimalOfferingNumericFact["value_quality"],
        bound: row.bound as MinimalOfferingNumericFact["bound"],
        unit: row.unit as MinimalOfferingNumericFact["unit"],
        currency: monetary && typeof row.currency === "string" ? row.currency : null,
        security_basis: typeof row.security_basis === "string" ? row.security_basis : null,
        comparison_basis_type: row.comparison_basis_type as MinimalOfferingNumericFact["comparison_basis_type"],
        comparable_to_event_market_basis: typeof row.comparable_to_event_market_basis === "boolean"
          ? row.comparable_to_event_market_basis
          : null,
        source_ref: typeof row.source_ref === "string" ? row.source_ref : null,
      },
    });
  });
  return rows;
}

function normalizeUnavailableFactKeys(value: unknown, errors: string[]) {
  if (!Array.isArray(value)) {
    errors.push("unavailable_fact_keys must be an array");
    return [] as OfferingMonitorSecondStageFactKey[];
  }
  const keys: OfferingMonitorSecondStageFactKey[] = [];
  value.forEach((candidate, index) => {
    if (typeof candidate !== "string") {
      errors.push(`unavailable_fact_keys[${index}] must be a string`);
    } else if (!OFFERING_MONITOR_SECOND_STAGE_FACT_KEYS.includes(candidate as OfferingMonitorSecondStageFactKey)) {
      errors.push(`unavailable_fact_keys[${index}] is unknown`);
    } else {
      keys.push(candidate as OfferingMonitorSecondStageFactKey);
    }
  });
  return keys;
}

function addFactOccurrence(
  occurrences: Map<string, Array<"available_monetary_facts" | "available_share_facts" | "unavailable_fact_keys">>,
  factKey: string,
  location: "available_monetary_facts" | "available_share_facts" | "unavailable_fact_keys",
) {
  occurrences.set(factKey, [...(occurrences.get(factKey) || []), location]);
}

function unavailableCanonicalFact(factKey: OfferingMonitorSecondStageFactKey): MinimalOfferingNumericFact {
  const basis = {
    actual_primary_offering_amount: { unit: "currency", comparison: "market_cap" },
    offering_price: { unit: "currency_per_security", comparison: "market_price" },
    immediate_primary_share_exposure: { unit: "shares", comparison: "shares_outstanding" },
    additional_potential_primary_share_exposure: { unit: "shares", comparison: "shares_outstanding" },
    resale_share_exposure: { unit: "shares", comparison: "public_float" },
  }[factKey];
  return {
    value: null,
    availability: "unavailable",
    value_quality: "unknown",
    bound: "unknown",
    unit: basis.unit as MinimalOfferingNumericFact["unit"],
    currency: null,
    security_basis: null,
    comparison_basis_type: basis.comparison as MinimalOfferingNumericFact["comparison_basis_type"],
    comparable_to_event_market_basis: null,
    source_ref: null,
  };
}

function validateDirectKeys(
  value: Record<string, unknown>,
  allowed: string[],
  required: string[],
  path: string,
  errors: string[],
) {
  const keys = Object.keys(value);
  for (const key of keys) if (!allowed.includes(key)) errors.push(`${path}.${key} is not allowed`);
  for (const key of required) if (!keys.includes(key)) errors.push(`${path}.${key} is required`);
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
