import "server-only";

import { runCalendarAlertDelivery } from "@/lib/alerts/calendarDelivery";
import { acquireJobLock, createLockOwner, releaseJobLock } from "@/lib/alerts/delivery/jobLock";
import { processQueuedDeliveries } from "@/lib/alerts/delivery/processQueuedDeliveries";
import { runPublicTelegramBroadcastDelivery } from "@/lib/alerts/delivery/publicTelegramBroadcast";
import { runAlertDeliveryBatch } from "@/lib/alerts/delivery/runAlertDeliveryBatch";
import { runDueAdminTelegramCampaigns } from "@/lib/admin/telegramCampaignDelivery";
import {
  createSchedulerRunLog,
  failSchedulerRunLog,
  finishSchedulerRunLog,
} from "@/lib/alerts/delivery/schedulerRunLog";
import type { RunAlertDeliverySchedulerOptions, RunAlertDeliverySchedulerResult } from "@/lib/alerts/delivery/types";

const DEFAULT_LOCK_TTL_SECONDS = 300;
const SCHEDULER_JOB_NAME = "alert_delivery_scheduler";

export async function runAlertDeliveryScheduler(
  options: RunAlertDeliverySchedulerOptions = {},
): Promise<RunAlertDeliverySchedulerResult> {
  const requestedWrite = options.write === true;
  const dryRun = options.dryRun ?? !requestedWrite;
  const write = requestedWrite && !dryRun;
  const useLock = options.useLock !== false;
  const lockTtlSeconds = normalizeLockTtl(options.lockTtlSeconds);
  const lockedBy = createLockOwner();
  const runId = options.runId || createRunId();
  const startedAt = new Date().toISOString();
  const recordRunLog = options.recordRunLog === true || write;

  if (recordRunLog) {
    await createSchedulerRunLog({
      runId,
      dryRun,
      writeEnabled: write,
      startedAt,
    });
  }

  let locked = false;
  if (useLock) {
    const lock = await acquireJobLock(SCHEDULER_JOB_NAME, lockTtlSeconds, lockedBy);
    if (!lock.ok || !lock.acquired) {
      const skippedResult: RunAlertDeliverySchedulerResult = {
        ok: true,
        runId,
        dryRun,
        write,
        locked: false,
        lockSkipped: true,
        batch: null,
        queued: null,
        publicTelegram: null,
        telegramCampaigns: null,
        calendar: null,
        error: "LOCK_HELD",
      };
      if (recordRunLog) {
        await finishSchedulerRunLog({ runId, startedAt, result: skippedResult });
      }
      return skippedResult;
    }
    locked = true;
  }

  let batch: RunAlertDeliverySchedulerResult["batch"] = null;
  let queued: RunAlertDeliverySchedulerResult["queued"] = null;
  let publicTelegram: RunAlertDeliverySchedulerResult["publicTelegram"] = null;
  let telegramCampaigns: RunAlertDeliverySchedulerResult["telegramCampaigns"] = null;
  let calendar: RunAlertDeliverySchedulerResult["calendar"] = null;

  try {
    batch = options.skipBatch
      ? null
      : await runAlertDeliveryBatch({
          dryRun,
          write,
          force: options.force,
          limit: options.limit,
          lookbackHours: options.lookbackHours,
        });
    queued = options.skipQueued
      ? null
      : await processQueuedDeliveries({
          dryRun,
          write,
          limit: options.queuedLimit,
        });
    publicTelegram = options.skipPublicTelegram
      ? null
      : await runPublicTelegramBroadcastDelivery({
          dryRun,
          write,
          limit: options.publicTelegramLimit,
        });
    telegramCampaigns = options.skipTelegramCampaigns || !write
      ? null
      : await runDueAdminTelegramCampaigns({
          limit: options.telegramCampaignLimit,
          trigger: "scheduler",
        });
    calendar = options.skipCalendar
      ? null
      : await runCalendarAlertDelivery({
          write,
          limit: options.calendarLimit,
        });

    const error = [
      batch?.error,
      queued?.error,
      publicTelegram?.error,
      telegramCampaigns?.disabled ? undefined : telegramCampaigns?.error,
      calendar?.error,
    ].find(
      (value): value is string => Boolean(value),
    );
    const result: RunAlertDeliverySchedulerResult = {
      ok:
        Boolean(batch?.ok ?? true) &&
        Boolean(queued?.ok ?? true) &&
        Boolean(publicTelegram?.ok ?? true) &&
        Boolean(telegramCampaigns?.ok ?? true) &&
        Boolean(calendar?.ok ?? true),
      runId,
      dryRun,
      write,
      locked,
      batch,
      queued,
      publicTelegram,
      telegramCampaigns,
      calendar,
      error,
    };
    if (recordRunLog) {
      await finishSchedulerRunLog({ runId, startedAt, result });
    }
    return result;
  } catch (error) {
    const failedResult: RunAlertDeliverySchedulerResult = {
      ok: false,
      runId,
      dryRun,
      write,
      locked,
      batch,
      queued,
      publicTelegram,
      telegramCampaigns,
      calendar,
      error: sanitizeError(error instanceof Error ? error.message : "Alert delivery scheduler failed."),
    };
    if (recordRunLog) {
      await failSchedulerRunLog(runId, startedAt, failedResult.error || error, {
        locked,
        dryRun,
        write,
      });
    }
    return failedResult;
  } finally {
    if (locked) {
      await releaseJobLock(SCHEDULER_JOB_NAME, lockedBy);
    }
  }
}

function normalizeLockTtl(value: unknown) {
  const ttl = typeof value === "number" && Number.isFinite(value) ? value : DEFAULT_LOCK_TTL_SECONDS;
  return Math.max(1, Math.min(Math.trunc(ttl), 3600));
}

function createRunId() {
  return `scheduler:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
}

function sanitizeError(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [REDACTED]")
    .replace(/bot[A-Za-z0-9:_-]+/g, "bot[REDACTED]")
    .slice(0, 500);
}
