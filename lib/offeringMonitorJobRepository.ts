import {
  OFFERING_MONITOR_JOB_PROMPT_KEY,
  OFFERING_MONITOR_JOB_VERSION,
  type OfferingMonitorJobIdentity,
  type OfferingMonitorParentAuthority,
} from "@/lib/offeringMonitorJobFoundation";
import { supabaseSelect, supabaseUpdate, supabaseUpsert } from "@/lib/supabase";

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
  const result = await supabaseUpdate(
    "ai_runs",
    { id: `eq.${identity.jobId}`, prompt_key: `eq.${OFFERING_MONITOR_JOB_PROMPT_KEY}` },
    { metadata: jobMetadata(identity, workflowRunId) },
  );
  if (!result.ok) throw new Error(`Offering Monitor workflow run linkage failed: ${result.error || result.status}`);
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
    phase: "second_stage_pending",
  };
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
