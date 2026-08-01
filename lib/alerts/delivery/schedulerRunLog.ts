import "server-only";

import { supabaseUpdate, supabaseUpsert } from "@/lib/supabase";
import type { RunAlertDeliverySchedulerResult } from "@/lib/alerts/delivery/types";

export type SchedulerRunStatus = "running" | "success" | "failed" | "skipped";

export type SchedulerRunLogStartInput = {
  runId: string;
  dryRun: boolean;
  writeEnabled: boolean;
  startedAt?: string;
};

export type SchedulerRunLogFinishInput = {
  runId: string;
  startedAt: string;
  result: RunAlertDeliverySchedulerResult;
};

export async function createSchedulerRunLog(input: SchedulerRunLogStartInput) {
  const result = await supabaseUpsert(
    "alert_delivery_scheduler_runs",
    {
      run_id: input.runId,
      status: "running",
      dry_run: input.dryRun,
      write_enabled: input.writeEnabled,
      lock_acquired: false,
      lock_skipped: false,
      started_at: input.startedAt || new Date().toISOString(),
      batch_summary: {},
      queued_summary: {},
      result_summary: {},
      last_error: null,
    },
    {
      onConflict: "run_id",
      prefer: "resolution=merge-duplicates,return=representation",
    },
  );

  return {
    ok: result.ok,
    status: result.status,
    error: result.error,
  };
}

export async function finishSchedulerRunLog(input: SchedulerRunLogFinishInput) {
  const status: SchedulerRunStatus = input.result.lockSkipped ? "skipped" : input.result.ok ? "success" : "failed";
  return updateSchedulerRunLog(input.runId, {
    status,
    finished_at: new Date().toISOString(),
    duration_ms: readDurationMs(input.startedAt),
    lock_acquired: input.result.locked,
    lock_skipped: input.result.lockSkipped === true,
    batch_summary: summarizeBatch(input.result.batch),
    queued_summary: summarizeQueued(input.result.queued),
    result_summary: summarizeSchedulerResult(input.result),
    last_error: input.result.error ? sanitizeSchedulerError(input.result.error) : null,
  });
}

export async function failSchedulerRunLog(
  runId: string,
  startedAt: string,
  error: unknown,
  partialSummary: Record<string, unknown> = {},
) {
  return updateSchedulerRunLog(runId, {
    status: "failed",
    finished_at: new Date().toISOString(),
    duration_ms: readDurationMs(startedAt),
    result_summary: partialSummary,
    last_error: sanitizeSchedulerError(error),
  });
}

export function sanitizeSchedulerError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "Unknown scheduler error");
  return message
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [REDACTED]")
    .replace(/bot[A-Za-z0-9:_-]+/g, "bot[REDACTED]")
    .replace(/(postgres|postgresql):\/\/[^\s]+/gi, "[REDACTED_DB_URL]")
    .slice(0, 500);
}

async function updateSchedulerRunLog(runId: string, payload: Record<string, unknown>) {
  const result = await supabaseUpdate("alert_delivery_scheduler_runs", { run_id: `eq.${runId}` }, payload);
  return {
    ok: result.ok,
    status: result.status,
    error: result.error,
  };
}

function summarizeBatch(batch: RunAlertDeliverySchedulerResult["batch"]) {
  if (!batch) return {};
  return {
    ok: batch.ok,
    dryRun: batch.dryRun,
    write: batch.write,
    scanned: batch.scanned,
    processed: batch.processed,
    wouldProcess: batch.wouldProcess,
    skippedAlreadyProcessed: batch.skippedAlreadyProcessed,
    deliveriesCreated: batch.deliveriesCreated,
    duplicatesSkipped: batch.duplicatesSkipped,
    failed: batch.failed,
  };
}

function summarizeQueued(queued: RunAlertDeliverySchedulerResult["queued"]) {
  if (!queued) return {};
  return {
    ok: queued.ok,
    dryRun: queued.dryRun,
    write: queued.write,
    scanned: queued.scanned,
    processed: queued.processed,
    wouldProcess: queued.wouldProcess,
    sent: queued.sent,
    failed: queued.failed,
    suppressed: queued.suppressed,
    duplicatesPrevented: queued.duplicatesPrevented,
    inProgress: queued.inProgress,
  };
}

function summarizeSchedulerResult(result: RunAlertDeliverySchedulerResult) {
  return {
    ok: result.ok,
    dryRun: result.dryRun,
    write: result.write,
    locked: result.locked,
    lockSkipped: result.lockSkipped === true,
    publicTelegram: result.publicTelegram
      ? {
          ok: result.publicTelegram.ok,
          write: result.publicTelegram.write,
          scanned: result.publicTelegram.scanned,
          processed: result.publicTelegram.processed,
          wouldProcess: result.publicTelegram.wouldProcess,
          sent: result.publicTelegram.sent,
          failed: result.publicTelegram.failed,
          suppressed: result.publicTelegram.suppressed,
          disabled: result.publicTelegram.disabled,
          duplicatesPrevented:
            result.publicTelegram.duplicatesPrevented,
          inProgress: result.publicTelegram.inProgress,
        }
      : null,
    calendar: result.calendar
      ? {
          ok: result.calendar.ok,
          write: result.calendar.write,
          scanned: result.calendar.scanned,
          delivered: result.calendar.delivered,
          duplicates: result.calendar.duplicates,
          disabled: result.calendar.disabled,
          suppressed: result.calendar.suppressed,
          failed: result.calendar.failed || 0,
        }
      : null,
    error: result.error ? sanitizeSchedulerError(result.error) : null,
  };
}

function readDurationMs(startedAt: string) {
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return null;
  return Math.max(0, Date.now() - start);
}
