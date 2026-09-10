import {
  OFFERING_MONITOR_JOB_PROMPT_KEY,
  OFFERING_MONITOR_JOB_VERSION,
  type OfferingMonitorJobIdentity,
  type OfferingMonitorParentAuthority,
  type OfferingMonitorSidecarOutcome,
} from "@/lib/offeringMonitorJobFoundation";
import { supabaseRpc, supabaseSelect, supabaseUpdate, supabaseUpsert } from "@/lib/supabase";

export type OfferingMonitorRegistryAlertState = "pending" | "failed" | "completed";

export type OfferingMonitorRegistryExecutionValue = Readonly<{
  status: "completed" | "deferred" | "failed";
  error?: string;
  readerReason?: string;
}>;

const PRIMARY_PROMPT_FILTER = "in.(sec_s1_f1_analysis,sec_s3_offering_analysis,sec_424b_analysis)";

export async function reserveOfferingMonitorJob(identity: OfferingMonitorJobIdentity) {
  const result = await supabaseUpsert(
    "ai_runs",
    {
      id: identity.jobId,
      event_id: identity.eventId,
      raw_item_id: identity.rawItemId,
      prompt_key: OFFERING_MONITOR_JOB_PROMPT_KEY,
      prompt_version: identity.executionContractVersion || OFFERING_MONITOR_JOB_VERSION,
      model: "not_started",
      status: "pending",
      started_at: null,
      finished_at: null,
      usage: {},
      error_message: null,
      metadata: jobMetadata(identity, null),
    },
    {
      onConflict: "id",
      prefer: "resolution=ignore-duplicates,return=representation",
    },
  );
  if (!result.ok) throw new Error(`Offering Monitor job reservation failed: ${result.error || result.status}`);
  const rows = Array.isArray(result.data) ? result.data : [];
  return { reserved: rows.length > 0, jobId: identity.jobId };
}

export async function attachOfferingMonitorWorkflowRun(
  identity: OfferingMonitorJobIdentity,
  workflowRunId: string,
) {
  const result = await supabaseRpc("attach_offering_monitor_workflow_run", {
    p_job_id: identity.jobId,
    p_workflow_run_id: workflowRunId,
  });
  assertAtomicJobUpdate(result, "Offering Monitor workflow run linkage");
}

export async function markOfferingMonitorJobFailed(jobId: string, error: unknown) {
  const result = await supabaseUpdate(
    "ai_runs",
    { id: `eq.${jobId}`, prompt_key: `eq.${OFFERING_MONITOR_JOB_PROMPT_KEY}` },
    {
      status: "failed",
      finished_at: new Date().toISOString(),
      error_message: error instanceof Error ? error.message : "Offering Monitor foundation failed",
    },
  );
  if (!result.ok) throw new Error(`Offering Monitor failure status update failed: ${result.error || result.status}`);
}

export async function recordOfferingMonitorRegistryExecution(
  jobId: string,
  execution: OfferingMonitorRegistryExecutionValue,
) {
  const next = registryAlertStateForExecution(execution);
  const error = next === "failed"
    ? stringValue(execution.error) || "Registry-backed Offering Monitor failed"
    : next === "pending"
      ? stringValue(execution.readerReason) || "Registry-backed Offering facts are pending"
      : null;
  const result = await supabaseRpc("set_offering_monitor_registry_alert_state", {
    p_job_id: jobId,
    p_state: next,
    p_error: error,
  });
  const response = assertAtomicJobUpdate(result, "Offering Monitor Registry Alert state update", [
    "updated",
    "preserved",
  ]);
  const status = registryAlertState(response.registry_alert_status);
  if (!status) throw new Error("Offering Monitor Registry Alert state update returned no state");
  return { status, jobId };
}

export async function readOfferingMonitorRegistryRetryCandidate(input: {
  eventId: string;
  rawItemId: string;
}) {
  const result = await supabaseSelect("ai_runs", {
    select: "id,metadata",
    event_id: `eq.${input.eventId}`,
    raw_item_id: `eq.${input.rawItemId}`,
    prompt_key: `eq.${OFFERING_MONITOR_JOB_PROMPT_KEY}`,
    "metadata->>registry_alert_status": "in.(failed,pending)",
    order: "finished_at.desc.nullslast,started_at.desc.nullslast,id.desc",
    limit: "1",
  });
  if (!result.ok) {
    throw new Error(`Offering Monitor Registry retry state read failed: ${result.error || result.status}`);
  }
  const row = readRecord(Array.isArray(result.data) ? result.data[0] : null);
  const jobId = stringValue(row?.id);
  const state = registryAlertState(readRecord(row?.metadata)?.registry_alert_status);
  return jobId && (state === "failed" || state === "pending")
    ? { jobId, state }
    : null;
}

export async function readOfferingMonitorParentAuthority(
  identity: OfferingMonitorJobIdentity,
): Promise<OfferingMonitorParentAuthority> {
  const result = await supabaseSelect("ai_runs", {
    select: "id",
    event_id: `eq.${identity.eventId}`,
    raw_item_id: `eq.${identity.rawItemId}`,
    prompt_key: PRIMARY_PROMPT_FILTER,
    status: "eq.completed",
    order: "finished_at.desc.nullslast,started_at.desc.nullslast,id.desc",
    limit: "1",
  });
  if (!result.ok) throw new Error(`Offering Monitor parent authority read failed: ${result.error || result.status}`);
  const row = Array.isArray(result.data) ? readRecord(result.data[0]) : null;
  const latestPrimaryAiRunId = stringValue(row?.id);
  if (!latestPrimaryAiRunId) return { status: "missing", latestPrimaryAiRunId: null };
  return latestPrimaryAiRunId === identity.parentPrimaryAiRunId
    ? { status: "current", latestPrimaryAiRunId }
    : { status: "stale", latestPrimaryAiRunId };
}

export async function claimOfferingMonitorJob(jobId: string) {
  const result = await supabaseUpdate(
    "ai_runs",
    {
      id: `eq.${jobId}`,
      prompt_key: `eq.${OFFERING_MONITOR_JOB_PROMPT_KEY}`,
      status: "in.(pending,completed)",
      "metadata->>phase": "in.(foundation_only,second_stage_pending)",
    },
    {
      status: "running",
      started_at: new Date().toISOString(),
      finished_at: null,
      error_message: null,
    },
  );
  if (!result.ok) throw new Error(`Offering Monitor job claim failed: ${result.error || result.status}`);
  return Array.isArray(result.data) && result.data.length > 0;
}

export async function completeOfferingMonitorJob(jobId: string) {
  await updateTerminalStatus(jobId, "completed");
}

export async function markOfferingMonitorJobStale(jobId: string) {
  await updateTerminalStatus(jobId, "stale");
}

export async function completeOfferingMonitorJobAfterSidecar(
  identity: OfferingMonitorJobIdentity,
  sidecar: OfferingMonitorSidecarOutcome,
) {
  await updateSidecarOnlyTerminalStatus(identity, sidecar, "completed");
}

export async function failOfferingMonitorJobAfterSidecar(
  identity: OfferingMonitorJobIdentity,
  sidecar: OfferingMonitorSidecarOutcome,
) {
  await updateSidecarOnlyTerminalStatus(identity, sidecar, "failed");
}

export async function markOfferingMonitorJobStaleAfterSidecar(
  identity: OfferingMonitorJobIdentity,
  sidecar: OfferingMonitorSidecarOutcome,
) {
  await updateSidecarOnlyTerminalStatus(identity, sidecar, "stale");
}

async function updateTerminalStatus(jobId: string, status: "completed" | "stale") {
  const result = await supabaseUpdate(
    "ai_runs",
    { id: `eq.${jobId}`, prompt_key: `eq.${OFFERING_MONITOR_JOB_PROMPT_KEY}` },
    {
      status,
      finished_at: new Date().toISOString(),
      error_message: null,
    },
  );
  if (!result.ok) throw new Error(`Offering Monitor ${status} status update failed: ${result.error || result.status}`);
}

async function updateSidecarOnlyTerminalStatus(
  identity: OfferingMonitorJobIdentity,
  sidecar: OfferingMonitorSidecarOutcome,
  status: "completed" | "failed" | "stale",
) {
  const error = status === "failed"
    ? stringValue(sidecar.error) || "Offering deterministic O/S sidecar failed"
    : null;
  const result = await supabaseRpc("finish_offering_monitor_sidecar_job", {
    p_job_id: identity.jobId,
    p_prompt_version: identity.executionContractVersion,
    p_status: status,
    p_error: error,
    p_metadata_patch: {
      phase: status === "completed"
        ? "sidecar_only_completed"
        : status === "failed"
          ? "sidecar_only_failed"
          : "sidecar_only_stale",
      sidecar_status: sidecar.status,
      sidecar_reason: sidecar.reason || null,
      sidecar_inserted: sidecar.inserted ?? null,
      sidecar_deduped: sidecar.deduped ?? null,
      stage_2_provider_enabled: false,
      provider_attempts: 0,
      legacy_canonical_wiring_enabled: false,
      legacy_empty_condition_matcher_enabled: false,
      diagnostic_candidate_saved: false,
      canonical_persistence_changed: false,
    },
  });
  assertAtomicJobUpdate(result, `Offering sidecar ${status} status update`);
}

function jobMetadata(identity: OfferingMonitorJobIdentity, workflowRunId: string | null) {
  return {
    job_schema_version: identity.schemaVersion,
    purpose: identity.purpose,
    logical_job_id: identity.logicalJobId,
    execution_id: identity.executionId,
    execution_contract_version: identity.executionContractVersion,
    execution_attempt_key: identity.executionAttemptKey,
    parent_primary_ai_run_id: identity.parentPrimaryAiRunId,
    parent_prompt_key: identity.parentPromptKey,
    parent_prompt_version: identity.parentPromptVersion,
    source_identity: identity.sourceIdentity,
    form_type: identity.formType,
    form_family: identity.family,
    enqueued_at: identity.enqueuedAt,
    workflow_run_id: workflowRunId,
    phase: "sidecar_only_pending",
    registry_alert_status: "pending",
    registry_alert_error: null,
    registry_alert_updated_at: identity.enqueuedAt,
  };
}

function assertAtomicJobUpdate(
  result: { ok: boolean; status: number; data: unknown; error?: string },
  label: string,
  acceptedStatuses: readonly string[] = ["updated"],
) {
  if (!result.ok) throw new Error(`${label} failed: ${result.error || result.status}`);
  const response = readRecord(result.data);
  const status = stringValue(response?.status);
  if (!response || !acceptedStatuses.includes(status)) {
    const reason = stringValue(response?.reason) || status || "empty response";
    throw new Error(`${label} lost job authority: ${reason}`);
  }
  return response;
}

function registryAlertStateForExecution(
  execution: OfferingMonitorRegistryExecutionValue,
): OfferingMonitorRegistryAlertState {
  return execution.status === "completed"
    ? "completed"
    : execution.status === "failed"
      ? "failed"
      : "pending";
}

function registryAlertState(value: unknown): OfferingMonitorRegistryAlertState | null {
  const state = stringValue(value);
  return state === "pending" || state === "failed" || state === "completed" ? state : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
