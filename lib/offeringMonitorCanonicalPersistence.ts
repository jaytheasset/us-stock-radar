/** Historical canonical readback only; not the current Registry fact authority. */
import {
  validateMinimalOfferingMonitor,
  type MinimalOfferingMaterialized,
  type MinimalOfferingMonitor,
} from "./minimalOfferingMonitor.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

export type CanonicalReadDependencies = {
  rpc(functionName: string, payload: Record<string, unknown>): Promise<{
    ok: boolean;
    status: number;
    data: unknown;
    error?: string;
  }>;
};

const defaultDependencies: CanonicalReadDependencies = {
  rpc: async (functionName, payload) => {
    const repository = await import("./supabase.ts");
    return repository.supabaseRpc(functionName, payload);
  },
};

export async function readOfferingMonitorCanonical(
  eventId: string,
  dependencies: CanonicalReadDependencies = defaultDependencies,
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
