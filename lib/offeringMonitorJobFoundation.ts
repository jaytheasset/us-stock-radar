import { createHash } from "node:crypto";
import { SEC_S3_F3_FORMS } from "./sources/sec/forms/common/forms.ts";

export const OFFERING_MONITOR_JOB_PURPOSE = "offering_monitor_normalization";
export const OFFERING_MONITOR_JOB_PROMPT_KEY = "offering_monitor_normalization_job";
export const OFFERING_MONITOR_EXECUTION_CONTRACT_VERSION = "second_stage_direct_v3";
export const OFFERING_MONITOR_AUTOMATIC_ATTEMPT_KEY = "automatic";
export const OFFERING_MONITOR_JOB_VERSION = OFFERING_MONITOR_EXECUTION_CONTRACT_VERSION;

const OFFERING_PRIMARY_PROMPT_KEYS = new Set([
  "sec_s1_f1_analysis",
  "sec_s3_offering_analysis",
  "sec_424b_analysis",
]);

export type OfferingMonitorJobFamily = "s1" | "s3" | "424b";

export type OfferingMonitorJobIdentity = {
  schemaVersion: "offering_monitor_job_v2";
  purpose: typeof OFFERING_MONITOR_JOB_PURPOSE;
  /** Backward-compatible name used by the existing workflow; this is the execution row ID in v2. */
  jobId: string;
  logicalJobId: string;
  executionId: string;
  executionContractVersion: string;
  executionAttemptKey: string;
  eventId: string;
  rawItemId: string;
  sourceIdentity: string;
  formType: string;
  family: OfferingMonitorJobFamily;
  parentPrimaryAiRunId: string;
  parentPromptKey: string;
  parentPromptVersion: string;
  enqueuedAt: string;
};

export type OfferingMonitorParentAuthority =
  | { status: "current"; latestPrimaryAiRunId: string }
  | { status: "stale"; latestPrimaryAiRunId: string }
  | { status: "missing"; latestPrimaryAiRunId: null };

export type OfferingMonitorFoundationRepository = {
  readParentAuthority(identity: OfferingMonitorJobIdentity): Promise<OfferingMonitorParentAuthority>;
  claimJob(jobId: string): Promise<boolean>;
  completeJob(jobId: string): Promise<void>;
  markStale(jobId: string): Promise<void>;
};

export type OfferingMonitorFoundationResult = {
  status: "completed" | "stale" | "duplicate";
  jobId: string;
  parentPrimaryAiRunId: string;
  latestPrimaryAiRunId: string | null;
};

export type OfferingMonitorEnqueueResult =
  | { status: "duplicate"; jobId: string }
  | { status: "enqueued"; jobId: string; workflowRunId: string; linkageWarning?: string }
  | { status: "enqueue_failed"; jobId: string; error: string };

export type OfferingMonitorEnqueueDependencies = {
  reserveJob(identity: OfferingMonitorJobIdentity): Promise<{ reserved: boolean; jobId: string }>;
  startWorkflow(identity: OfferingMonitorJobIdentity): Promise<{ runId: string }>;
  attachWorkflowRun(identity: OfferingMonitorJobIdentity, workflowRunId: string): Promise<void>;
  markFailed(jobId: string, error: unknown): Promise<void>;
};

export function buildOfferingMonitorJobIdentity(
  result: unknown,
  options: { now?: string; executionAttemptKey?: string } = {},
): OfferingMonitorJobIdentity | null {
  const root = readRecord(result);
  if (!root || root.ok !== true || stringValue(root.stage) !== "complete") return null;

  const event = readRecord(root.event);
  const sourceItem = readRecord(root.sourceItem);
  const prompt = readRecord(root.prompt);
  const input = readRecord(root.input);
  const filingPackage = readRecord(input?.filing_package);
  const eventId = stringValue(event?.id);
  const rawItemId = stringValue(sourceItem?.id);
  const sourceIdentity = stringValue(filingPackage?.accession_number) || stringValue(sourceItem?.source_unique_id);
  const formType = stringValue(filingPackage?.form_type) || stringValue(sourceItem?.form_type);
  const parentPrimaryAiRunId = stringValue(root.primaryAiRunId);
  const parentPromptKey = stringValue(prompt?.key);
  const parentPromptVersion = stringValue(prompt?.version);
  const family = offeringMonitorFamily(formType, parentPromptKey);

  if (
    !eventId ||
    !rawItemId ||
    !sourceIdentity ||
    !parentPrimaryAiRunId ||
    !parentPromptVersion ||
    !family
  ) {
    return null;
  }

  const executionAttemptKey = normalizeExecutionAttemptKey(
    options.executionAttemptKey || OFFERING_MONITOR_AUTOMATIC_ATTEMPT_KEY,
  );
  if (!executionAttemptKey) return null;

  const logicalJobId = deterministicLogicalJobId({
    eventId,
    rawItemId,
    parentPrimaryAiRunId,
  });
  const executionId = deterministicExecutionId({
    logicalJobId,
    executionContractVersion: OFFERING_MONITOR_EXECUTION_CONTRACT_VERSION,
    executionAttemptKey,
  });

  return {
    schemaVersion: "offering_monitor_job_v2",
    purpose: OFFERING_MONITOR_JOB_PURPOSE,
    jobId: executionId,
    logicalJobId,
    executionId,
    executionContractVersion: OFFERING_MONITOR_EXECUTION_CONTRACT_VERSION,
    executionAttemptKey,
    eventId,
    rawItemId,
    sourceIdentity,
    formType,
    family,
    parentPrimaryAiRunId,
    parentPromptKey,
    parentPromptVersion,
    enqueuedAt: options.now || new Date().toISOString(),
  };
}

export function deterministicLogicalJobId(input: {
  eventId: string;
  rawItemId: string;
  parentPrimaryAiRunId: string;
}) {
  const digest = createHash("sha256")
    .update([
      OFFERING_MONITOR_JOB_PURPOSE,
      input.eventId,
      input.rawItemId,
      input.parentPrimaryAiRunId,
    ].join(":"))
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Legacy export retained because Phase 4W used this value directly as its single job/run ID. */
export const deterministicJobId = deterministicLogicalJobId;

export function deterministicExecutionId(input: {
  logicalJobId: string;
  executionContractVersion: string;
  executionAttemptKey: string;
}) {
  const logicalJobId = stringValue(input.logicalJobId);
  const executionContractVersion = stringValue(input.executionContractVersion);
  const executionAttemptKey = normalizeExecutionAttemptKey(input.executionAttemptKey);
  if (!logicalJobId || !executionContractVersion || !executionAttemptKey) {
    throw new Error("Offering Monitor execution identity is incomplete");
  }
  const digest = createHash("sha256")
    .update(JSON.stringify([
      OFFERING_MONITOR_JOB_PURPOSE,
      "execution",
      logicalJobId,
      executionContractVersion,
      executionAttemptKey,
    ]))
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function processOfferingMonitorFoundationJob(
  identity: OfferingMonitorJobIdentity,
  repository: OfferingMonitorFoundationRepository,
): Promise<OfferingMonitorFoundationResult> {
  const authority = await repository.readParentAuthority(identity);
  if (authority.status !== "current") {
    await repository.markStale(identity.jobId);
    return {
      status: "stale",
      jobId: identity.jobId,
      parentPrimaryAiRunId: identity.parentPrimaryAiRunId,
      latestPrimaryAiRunId: authority.latestPrimaryAiRunId,
    };
  }

  const claimed = await repository.claimJob(identity.jobId);
  if (!claimed) {
    return {
      status: "duplicate",
      jobId: identity.jobId,
      parentPrimaryAiRunId: identity.parentPrimaryAiRunId,
      latestPrimaryAiRunId: authority.latestPrimaryAiRunId,
    };
  }

  // Phase 4U deliberately stops before source packaging, provider work, or canonical writes.
  await repository.completeJob(identity.jobId);
  return {
    status: "completed",
    jobId: identity.jobId,
    parentPrimaryAiRunId: identity.parentPrimaryAiRunId,
    latestPrimaryAiRunId: authority.latestPrimaryAiRunId,
  };
}

export async function enqueueOfferingMonitorJobWithDependencies(
  identity: OfferingMonitorJobIdentity,
  dependencies: OfferingMonitorEnqueueDependencies,
): Promise<OfferingMonitorEnqueueResult> {
  let reserved = false;
  try {
    const reservation = await dependencies.reserveJob(identity);
    reserved = reservation.reserved;
    if (!reserved) return { status: "duplicate", jobId: identity.jobId };
  } catch (error) {
    return {
      status: "enqueue_failed",
      jobId: identity.jobId,
      error: errorMessage(error, "Offering Monitor durable reservation failed"),
    };
  }

  let run: { runId: string };
  try {
    run = await dependencies.startWorkflow(identity);
  } catch (error) {
    await dependencies.markFailed(identity.jobId, error).catch(() => null);
    return {
      status: "enqueue_failed",
      jobId: identity.jobId,
      error: errorMessage(error, "Offering Monitor durable enqueue failed"),
    };
  }

  try {
    await dependencies.attachWorkflowRun(identity, run.runId);
    return { status: "enqueued", jobId: identity.jobId, workflowRunId: run.runId };
  } catch (error) {
    // The durable child already exists. Linkage observability may be repaired later;
    // never relabel a successfully started child as a failed job.
    return {
      status: "enqueued",
      jobId: identity.jobId,
      workflowRunId: run.runId,
      linkageWarning: errorMessage(error, "Workflow run linkage was not recorded"),
    };
  }
}

export type AtomicOfferingMonitorResultWriter<T> = {
  commitIfParentIsLatest(input: {
    identity: OfferingMonitorJobIdentity;
    value: T;
  }): Promise<{ status: "saved" | "stale" }>;
};

/**
 * Future canonical persistence must implement this as one database transaction/RPC.
 * Callers cannot pre-check authority and then write separately through this boundary.
 */
export function commitOfferingMonitorResultIfCurrent<T>(
  writer: AtomicOfferingMonitorResultWriter<T>,
  input: { identity: OfferingMonitorJobIdentity; value: T },
) {
  return writer.commitIfParentIsLatest(input);
}

function offeringMonitorFamily(formType: string, promptKey: string): OfferingMonitorJobFamily | null {
  if (!OFFERING_PRIMARY_PROMPT_KEYS.has(promptKey)) return null;
  const form = formType.trim().toUpperCase();
  if (/^S-1(?:\/A)?$/.test(form) && promptKey === "sec_s1_f1_analysis") return "s1";
  if (
    SEC_S3_F3_FORMS.includes(form as (typeof SEC_S3_F3_FORMS)[number]) &&
    promptKey === "sec_s3_offering_analysis"
  ) {
    return "s3";
  }
  if (/^424B\d*(?:\/A)?$/.test(form) && promptKey === "sec_424b_analysis") return "424b";
  return null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeExecutionAttemptKey(value: unknown) {
  const text = stringValue(value);
  return /^[A-Za-z0-9._:-]{1,80}$/.test(text) ? text : "";
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
