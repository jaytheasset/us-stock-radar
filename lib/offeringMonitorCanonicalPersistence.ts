import {
  buildMinimalOfferingMarketSnapshot,
  materializeMinimalOfferingMonitor,
  validateMinimalOfferingMonitor,
  type MinimalOfferingMaterialized,
  type MinimalOfferingMonitor,
} from "./minimalOfferingMonitor.ts";
import {
  OFFERING_MONITOR_SECOND_STAGE_OUTPUT_TYPE,
  type OfferingMonitorDiagnosticCandidate,
} from "./offeringMonitorSecondStage.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type OfferingMonitorPromotionResult =
  | { status: "saved" | "idempotent"; eventId: string; sourceExecutionId: string }
  | { status: "stale" | "rejected"; reason: string };

export type OfferingMonitorCanonicalReadResult =
  | {
      status: "available";
      eventId: string;
      rawItemId: string;
      parentPrimaryAiRunId: string;
      sourceExecutionId: string;
      formFamily: "s1" | "s3" | "424b";
      contractVersion: string;
      schemaVersion: string;
      canonical: MinimalOfferingMonitor;
      materialized: MinimalOfferingMaterialized;
      totalPotentialPrimaryShareExposure: number | null;
      promotedAt: string;
    }
  | { status: "not_ready"; reason: string };

export type CanonicalPersistenceDependencies = {
  select(table: string, search: Record<string, string>): Promise<{
    ok: boolean;
    status: number;
    data: unknown;
    error?: string;
  }>;
  rpc(functionName: string, payload: Record<string, unknown>): Promise<{
    ok: boolean;
    status: number;
    data: unknown;
    error?: string;
  }>;
};

const defaultDependencies: CanonicalPersistenceDependencies = {
  select: async (table, search) => {
    const repository = await import("./supabase.ts");
    return repository.supabaseSelect(table, search);
  },
  rpc: async (functionName, payload) => {
    const repository = await import("./supabase.ts");
    return repository.supabaseRpc(functionName, payload);
  },
};

/**
 * Promotion is the only place that rematerializes the five strict facts. The
 * resulting total is compared with the immutable diagnostic candidate before
 * the atomic database RPC is allowed to persist it.
 */
export function validateOfferingMonitorCandidateForPromotion(value: unknown):
  | {
      ok: true;
      candidate: OfferingMonitorDiagnosticCandidate;
      canonical: MinimalOfferingMonitor;
      materialized: MinimalOfferingMaterialized;
      totalPotentialPrimaryShareExposure: number | null;
    }
  | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const candidate = recordValue(value);
  if (!candidate) return { ok: false, errors: ["Offering Monitor promotion candidate must be an object"] };
  if (candidate.schema_version !== "offering_monitor_second_stage_candidate_v2") {
    errors.push("Offering Monitor promotion candidate schema_version is invalid");
  }
  const validation = recordValue(candidate.validation);
  if (validation?.status !== "success" || !Array.isArray(validation.errors) || validation.errors.length !== 0) {
    errors.push("Offering Monitor promotion candidate validation must be successful without errors");
  }
  const canonicalValidation = validateMinimalOfferingMonitor(candidate.canonical_candidate);
  if (!canonicalValidation.ok) errors.push(...canonicalValidation.errors);

  const selectedSourceRefs = readSelectedSourceRefs(candidate);
  if (!selectedSourceRefs.ok) errors.push(...selectedSourceRefs.errors);
  if (canonicalValidation.ok && selectedSourceRefs.ok) {
    const allowed = new Set(selectedSourceRefs.refs);
    for (const [factKey, fact] of Object.entries(canonicalValidation.value.facts)) {
      if (fact.availability === "available" && (!fact.source_ref || !allowed.has(fact.source_ref))) {
        errors.push(`facts.${factKey}.source_ref must be a member of selectedSourceRefs`);
      }
    }
  }
  if (errors.length || !canonicalValidation.ok) return { ok: false, errors };

  const materialized = materializeMinimalOfferingMonitor(
    canonicalValidation.value,
    buildMinimalOfferingMarketSnapshot(null),
  );
  if (!deepEqualJson(candidate.materialized_candidate, materialized)) {
    return {
      ok: false,
      errors: ["Offering Monitor stored materialized candidate does not match promotion materialization"],
    };
  }
  const total = materialized.total_potential_primary_share_exposure;
  return {
    ok: true,
    candidate: candidate as unknown as OfferingMonitorDiagnosticCandidate,
    canonical: canonicalValidation.value,
    materialized,
    totalPotentialPrimaryShareExposure: total.availability === "available" ? total.value : null,
  };
}

export async function promoteOfferingMonitorCanonical(input: {
  eventId: string;
  sourceExecutionId: string;
  dependencies?: CanonicalPersistenceDependencies;
}): Promise<OfferingMonitorPromotionResult> {
  if (!UUID_PATTERN.test(input.eventId) || !UUID_PATTERN.test(input.sourceExecutionId)) {
    return { status: "rejected", reason: "invalid_identity" };
  }
  const dependencies = input.dependencies || defaultDependencies;
  const output = await dependencies.select("ai_outputs", {
    select: "payload",
    id: `eq.${input.sourceExecutionId}`,
    ai_run_id: `eq.${input.sourceExecutionId}`,
    event_id: `eq.${input.eventId}`,
    output_type: `eq.${OFFERING_MONITOR_SECOND_STAGE_OUTPUT_TYPE}`,
    limit: "1",
  });
  if (!output.ok) throw new Error(`Offering Monitor candidate read failed: ${output.error || output.status}`);
  const row = Array.isArray(output.data) ? recordValue(output.data[0]) : null;
  const validation = validateOfferingMonitorCandidateForPromotion(row?.payload);
  if (!validation.ok) return { status: "rejected", reason: validation.errors.join("; ") };
  if (
    validation.candidate.job_id !== input.sourceExecutionId ||
    validation.candidate.event_id !== input.eventId
  ) {
    return { status: "rejected", reason: "candidate_identity_mismatch" };
  }

  const result = await dependencies.rpc("promote_event_offering_monitor_canonical", {
    p_event_id: input.eventId,
    p_source_execution_id: input.sourceExecutionId,
    p_expected_candidate: validation.candidate,
  });
  if (!result.ok) throw new Error(`Offering Monitor atomic promotion failed: ${result.error || result.status}`);
  const payload = recordValue(result.data);
  const status = stringValue(payload?.status);
  if (status === "saved" || status === "idempotent") {
    return { status, eventId: input.eventId, sourceExecutionId: input.sourceExecutionId };
  }
  if (status === "stale" || status === "rejected") {
    return { status, reason: stringValue(payload?.reason) || "unknown" };
  }
  throw new Error("Offering Monitor atomic promotion returned an invalid response");
}

export async function readOfferingMonitorCanonical(
  eventId: string,
  dependencies: Pick<CanonicalPersistenceDependencies, "rpc"> = defaultDependencies,
): Promise<OfferingMonitorCanonicalReadResult> {
  if (!UUID_PATTERN.test(eventId)) return { status: "not_ready", reason: "invalid_event_id" };
  const result = await dependencies.rpc("read_event_offering_monitor_canonical", { p_event_id: eventId });
  if (!result.ok) throw new Error(`Offering Monitor canonical read failed: ${result.error || result.status}`);
  return validateOfferingMonitorCanonicalReadResult(result.data);
}

export function validateOfferingMonitorCanonicalReadResult(value: unknown): OfferingMonitorCanonicalReadResult {
  const row = recordValue(value);
  if (!row) return { status: "not_ready", reason: "invalid_reader_response" };
  if (row.status === "not_ready") {
    return { status: "not_ready", reason: stringValue(row.reason) || "unknown" };
  }
  if (row.status !== "available") return { status: "not_ready", reason: "invalid_reader_status" };

  const eventId = stringValue(row.event_id);
  const rawItemId = stringValue(row.raw_item_id);
  const parentPrimaryAiRunId = stringValue(row.parent_primary_ai_run_id);
  const sourceExecutionId = stringValue(row.source_execution_id);
  const formFamily = stringValue(row.form_family);
  const canonicalValidation = validateMinimalOfferingMonitor(row.canonical_payload);
  const materialized = recordValue(row.materialized_payload);
  const storedTotal = finiteNumberOrNull(row.total_potential_primary_share_exposure);
  const materializedTotal = recordValue(materialized?.total_potential_primary_share_exposure);
  const materializedTotalValue = materializedTotal?.availability === "available"
    ? finiteNumberOrUndefined(materializedTotal.value)
    : materializedTotal?.availability === "unavailable" && materializedTotal.value === null
      ? null
      : undefined;
  if (
    !UUID_PATTERN.test(eventId) ||
    !UUID_PATTERN.test(rawItemId) ||
    !UUID_PATTERN.test(parentPrimaryAiRunId) ||
    !UUID_PATTERN.test(sourceExecutionId) ||
    !["s1", "s3", "424b"].includes(formFamily) ||
    !canonicalValidation.ok ||
    !materialized ||
    materializedTotalValue === undefined ||
    storedTotal === undefined ||
    storedTotal !== materializedTotalValue
  ) {
    return { status: "not_ready", reason: "canonical_reader_validation_failed" };
  }
  return {
    status: "available",
    eventId,
    rawItemId,
    parentPrimaryAiRunId,
    sourceExecutionId,
    formFamily: formFamily as "s1" | "s3" | "424b",
    contractVersion: stringValue(row.contract_version),
    schemaVersion: stringValue(row.schema_version),
    canonical: canonicalValidation.value,
    materialized: materialized as unknown as MinimalOfferingMaterialized,
    totalPotentialPrimaryShareExposure: storedTotal,
    promotedAt: stringValue(row.promoted_at),
  };
}

function readSelectedSourceRefs(candidate: Record<string, unknown>):
  | { ok: true; refs: string[] }
  | { ok: false; errors: string[] } {
  const stats = recordValue(candidate.input_stats);
  const refs = stats?.selectedSourceRefs;
  if (!Array.isArray(refs) || !refs.length || refs.some((ref) => !stringValue(ref))) {
    return { ok: false, errors: ["Offering Monitor candidate selectedSourceRefs must be a non-empty string array"] };
  }
  const normalized = refs.map(stringValue);
  if (new Set(normalized).size !== normalized.length) {
    return { ok: false, errors: ["Offering Monitor candidate selectedSourceRefs must be unique"] };
  }
  return { ok: true, refs: normalized };
}

function deepEqualJson(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((value, index) => deepEqualJson(value, right[index]));
  }
  const leftRecord = recordValue(left);
  const rightRecord = recordValue(right);
  if (!leftRecord || !rightRecord) return false;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index] && deepEqualJson(leftRecord[key], rightRecord[key]));
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function finiteNumberOrUndefined(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function finiteNumberOrNull(value: unknown) {
  return value === null ? null : finiteNumberOrUndefined(value);
}
