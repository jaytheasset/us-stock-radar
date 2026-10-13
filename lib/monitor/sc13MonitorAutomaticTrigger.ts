import {
  consumeSc13MonitorAlertsForIssuer,
  type Sc13MonitorAlertConsumerResult,
} from "./sc13MonitorAlertConsumer.ts";

export const SC13_MONITOR_AUTOMATIC_TRIGGER_VERSION = "sec_sc13_monitor_auto_v1" as const;

type RepositoryResult = Readonly<{ ok: boolean; status: number; data: unknown; error?: string }>;
type Attempt = Readonly<{ attemptId: string; attemptGeneration: number }>;
type AttemptStart = Readonly<{ status: "started"; attempt: Attempt }> | Readonly<{ status: "rejected"; error: string }>;

export type Sc13MonitorAutomaticTriggerResult = Readonly<{
  version: typeof SC13_MONITOR_AUTOMATIC_TRIGGER_VERSION;
  status: "completed" | "failed";
  rawItemId: string;
  issuerCik: string;
  stateRecorded: boolean;
  stateWriteStatus?: string;
  error?: string;
  consumer?: Sc13MonitorAlertConsumerResult;
}>;

export type Sc13MonitorAutomaticTriggerDependencies = Readonly<{
  begin(input: Readonly<{ rawItemId: string; issuerCik: string; sourceSha256: string }>): Promise<AttemptStart>;
  finish(input: Readonly<{
    rawItemId: string;
    attempt: Attempt;
    status: "completed" | "failed";
    error?: string;
    result: Record<string, unknown>;
  }>): Promise<string>;
  consume(input: Readonly<{ issuerCik: string; filingSource?: { accessionNumber: string; sourceSha256: string } }>): Promise<Sc13MonitorAlertConsumerResult>;
  reportFailure(result: Sc13MonitorAutomaticTriggerResult): void;
}>;

const defaultDependencies: Sc13MonitorAutomaticTriggerDependencies = {
  begin: beginAttempt,
  finish: finishAttempt,
  consume: consumeSc13MonitorAlertsForIssuer,
  reportFailure: (result) => console.error("[sc13-monitor] isolated canonical XML trigger failure", result),
};

/**
 * Runs only from a successfully persisted canonical XML identity. Monitor and
 * state-write failures remain observable and retryable without changing raw/XML
 * or site-analysis success.
 */
export async function runSc13MonitorAutomaticTrigger(
  input: Readonly<{ rawItemId: string; issuerCik: string; sourceSha256: string; accessionNumber?: string }>,
  dependencies: Sc13MonitorAutomaticTriggerDependencies = defaultDependencies,
): Promise<Sc13MonitorAutomaticTriggerResult> {
  let attempt: Attempt | null = null;
  let beginError = "";
  try {
    const start = await dependencies.begin(input);
    if (start.status === "rejected") {
      const result: Sc13MonitorAutomaticTriggerResult = {
        version: SC13_MONITOR_AUTOMATIC_TRIGGER_VERSION,
        status: "failed",
        rawItemId: input.rawItemId,
        issuerCik: input.issuerCik,
        stateRecorded: false,
        error: start.error,
      };
      reportFailure(result, dependencies);
      return result;
    }
    attempt = start.attempt;
  } catch (error) {
    beginError = message(error, "SC13 Monitor pending state write failed");
  }

  let consumer: Sc13MonitorAlertConsumerResult | undefined;
  let executionError = "";
  try {
    consumer = await dependencies.consume({ issuerCik: input.issuerCik, ...(input.accessionNumber ? { filingSource: { accessionNumber: input.accessionNumber, sourceSha256: input.sourceSha256 } } : {}) });
    if (consumer.status !== "completed") {
      executionError = consumer.status === "partial_failure"
        ? `SC13 Monitor Alert persistence failed for ${consumer.failedCount} monitor(s)`
        : `SC13 Monitor current-state read failed: ${consumer.readerReason || consumer.readerStatus}`;
    }
  } catch (error) {
    executionError = message(error, "SC13 Monitor execution failed");
  }

  const terminalStatus = executionError ? "failed" as const : "completed" as const;
  let finishError = "";
  let stateWriteStatus: string | undefined;
  if (attempt) {
    try {
      stateWriteStatus = await dependencies.finish({
        rawItemId: input.rawItemId,
        attempt,
        status: terminalStatus,
        ...(executionError ? { error: executionError } : {}),
        result: consumerSummary(consumer),
      });
    } catch (error) {
      finishError = message(error, "SC13 Monitor terminal state write failed");
    }
  }

  const error = [beginError, executionError, finishError].filter(Boolean).join("; ");
  const result: Sc13MonitorAutomaticTriggerResult = {
    version: SC13_MONITOR_AUTOMATIC_TRIGGER_VERSION,
    status: error ? "failed" : "completed",
    rawItemId: input.rawItemId,
    issuerCik: input.issuerCik,
    stateRecorded: Boolean(attempt && !finishError),
    ...(stateWriteStatus ? { stateWriteStatus } : {}),
    ...(error ? { error } : {}),
    ...(consumer ? { consumer } : {}),
  };
  if (result.status === "failed") {
    reportFailure(result, dependencies);
  }
  return result;
}

async function beginAttempt(input: Readonly<{ rawItemId: string; issuerCik: string; sourceSha256: string }>): Promise<AttemptStart> {
  const repository = await import("../supabase.ts");
  const result = await repository.supabaseRpc("begin_sec_sc13_monitor_alert_attempt", {
    p_raw_item_id: input.rawItemId,
    p_issuer_cik: input.issuerCik,
    p_source_sha256: input.sourceSha256,
  });
  assertRepositoryResult(result, "SC13 Monitor pending state write");
  const row = record(result.data);
  if (row.status === "rejected" || row.status === "missing") {
    return { status: "rejected", error: `SC13 Monitor pending state write rejected: ${text(row.reason) || text(row.status)}` };
  }
  if (row.status !== "started" || !uuid(row.attempt_id) || !positiveInteger(row.attempt_generation)) {
    throw new Error(`SC13 Monitor pending state write returned ${text(row.status) || "an invalid response"}`);
  }
  return { status: "started", attempt: { attemptId: text(row.attempt_id), attemptGeneration: Number(row.attempt_generation) } };
}

async function finishAttempt(input: Readonly<{
  rawItemId: string;
  attempt: Attempt;
  status: "completed" | "failed";
  error?: string;
  result: Record<string, unknown>;
}>): Promise<string> {
  const repository = await import("../supabase.ts");
  const response = await repository.supabaseRpc("finish_sec_sc13_monitor_alert_attempt", {
    p_raw_item_id: input.rawItemId,
    p_attempt_id: input.attempt.attemptId,
    p_attempt_generation: input.attempt.attemptGeneration,
    p_status: input.status,
    p_error: input.error || null,
    p_result: input.result,
  });
  assertRepositoryResult(response, "SC13 Monitor terminal state write");
  const status = text(record(response.data).status);
  if (status !== "updated" && status !== "preserved") {
    throw new Error(`SC13 Monitor terminal state write returned ${status || "an invalid response"}`);
  }
  return status;
}

function consumerSummary(consumer: Sc13MonitorAlertConsumerResult | undefined): Record<string, unknown> {
  if (!consumer) return {};
  return {
    consumer_version: consumer.version,
    consumer_status: consumer.status,
    reader_status: consumer.readerStatus,
    reader_reason: consumer.readerReason || null,
    monitor_count: consumer.monitorCount,
    created_count: consumer.createdCount,
    existing_count: consumer.existingCount,
    failed_count: consumer.failedCount,
  };
}

function assertRepositoryResult(result: RepositoryResult, operation: string) {
  if (!result.ok) throw new Error(`${operation} failed: ${result.error || `HTTP ${result.status}`}`);
}
function reportFailure(result: Sc13MonitorAutomaticTriggerResult, dependencies: Sc13MonitorAutomaticTriggerDependencies) {
  try {
    dependencies.reportFailure(result);
  } catch {
    // Failure reporting is intentionally outside the raw/XML success boundary.
  }
}
function message(error: unknown, fallback: string) { return error instanceof Error ? error.message.slice(0, 500) : fallback; }
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function positiveInteger(value: unknown) { const number = Number(value); return Number.isSafeInteger(number) && number > 0; }
function uuid(value: unknown) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text(value)); }
