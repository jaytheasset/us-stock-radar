/** Historical candidate inspection only. No provider, input builder, or persistence writer. */
import {
  buildMinimalOfferingMarketSnapshot,
  materializeMinimalOfferingMonitor,
  validateMinimalOfferingMonitor,
  type MinimalOfferingMaterialized,
  type MinimalOfferingMonitor,
} from "./minimalOfferingMonitor.ts";

export const OFFERING_MONITOR_SECOND_STAGE_PROMPT_KEY = "offering_monitor_normalization_job";
export const OFFERING_MONITOR_SECOND_STAGE_PROMPT_VERSION = "second_stage_direct_v8";
export const OFFERING_MONITOR_SECOND_STAGE_OUTPUT_TYPE = "offering_monitor_normalization_candidate";

export type OfferingMonitorHistoricalInputStats = {
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

export type OfferingMonitorDiagnosticCandidate = {
  schema_version: "offering_monitor_second_stage_candidate_v2";
  job_id: string;
  parent_primary_ai_run_id: string;
  event_id: string;
  raw_item_id: string;
  source_identity: string;
  prompt: { key: string; version: string };
  input_stats: OfferingMonitorHistoricalInputStats;
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
  materialized_candidate: MinimalOfferingMaterialized | null;
};

/** Preserves the former promotion validation contract for immutable historical candidates.
 * Re-materialization checks equality only; it never repairs or persists stored values. */
export function validateOfferingMonitorHistoricalCandidate(value: unknown):
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
