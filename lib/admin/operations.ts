import "server-only";

import { supabaseSelect } from "@/lib/supabase";

type Row = Record<string, unknown>;

export type FailedSourceRun = {
  id: string;
  sourceCode: string;
  sourceGroup: string;
  runType: string;
  startedAt: string;
  finishedAt: string | null;
  errorMessage: string | null;
  stats: Record<string, unknown>;
};

export type FailedAlertDelivery = {
  id: string;
  userId: string;
  ticker: string | null;
  title: string;
  category: string | null;
  sourceLabel: string | null;
  attemptedAt: string | null;
  scheduledFor: string | null;
  lastError: string | null;
  deliveredChannels: string[];
};

export type AlertDeliveryRun = {
  id: string;
  runId: string;
  status: string;
  dryRun: boolean;
  writeEnabled: boolean;
  lockAcquired: boolean;
  lockSkipped: boolean;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  scanned: number;
  sent: number;
  failed: number;
  duplicates: number;
  suppressed: number;
  lastError: string | null;
};

export type AlertChannelAttemptError = {
  id: string;
  deliveryId: string;
  userId: string;
  channel: string;
  status: string;
  attemptCount: number;
  createdAt: string;
  lastError: string | null;
};

export async function listFailedSourceRuns(
  limit = 100,
): Promise<FailedSourceRun[]> {
  const result = await supabaseSelect("source_runs", {
    select:
      "id,source_code,source_group,run_type,started_at,finished_at,error_message,stats",
    status: "eq.failed",
    order: "started_at.desc",
    limit: String(Math.max(1, Math.min(limit, 250))),
  });
  return readRows(result.data).map((row) => ({
    id: readString(row.id),
    sourceCode: readString(row.source_code),
    sourceGroup: readString(row.source_group),
    runType: readString(row.run_type),
    startedAt: readString(row.started_at),
    finishedAt: readNullableString(row.finished_at),
    errorMessage: readNullableString(row.error_message),
    stats: readObject(row.stats),
  }));
}

export async function listFailedAlertDeliveries(
  limit = 100,
): Promise<FailedAlertDelivery[]> {
  const result = await supabaseSelect("user_alert_deliveries", {
    select:
      "id,user_id,ticker,title,category,source_label,attempted_at,scheduled_for,last_error,delivered_channels",
    delivery_status: "eq.failed",
    order: "attempted_at.desc.nullslast,created_at.desc",
    limit: String(Math.max(1, Math.min(limit, 250))),
  });
  return readRows(result.data).map((row) => ({
    id: readString(row.id),
    userId: readString(row.user_id),
    ticker: readNullableString(row.ticker),
    title: readString(row.title),
    category: readNullableString(row.category),
    sourceLabel: readNullableString(row.source_label),
    attemptedAt: readNullableString(row.attempted_at),
    scheduledFor: readNullableString(row.scheduled_for),
    lastError: readNullableString(row.last_error),
    deliveredChannels: Array.isArray(row.delivered_channels)
      ? row.delivered_channels.filter(
          (item): item is string => typeof item === "string",
        )
      : [],
  }));
}

export async function listAlertDeliveryRuns(
  limit = 50,
): Promise<AlertDeliveryRun[]> {
  const result = await supabaseSelect("alert_delivery_scheduler_runs", {
    select:
      "id,run_id,status,dry_run,write_enabled,lock_acquired,lock_skipped,started_at,finished_at,duration_ms,batch_summary,queued_summary,result_summary,last_error",
    order: "started_at.desc",
    limit: String(Math.max(1, Math.min(limit, 100))),
  });

  return readRows(result.data).map((row) => {
    const batch = readObject(row.batch_summary);
    const queued = readObject(row.queued_summary);
    const summary = readObject(row.result_summary);
    const calendar = readObject(summary.calendar);
    return {
      id: readString(row.id),
      runId: readString(row.run_id),
      status: readString(row.status),
      dryRun: row.dry_run === true,
      writeEnabled: row.write_enabled === true,
      lockAcquired: row.lock_acquired === true,
      lockSkipped: row.lock_skipped === true,
      startedAt: readString(row.started_at),
      finishedAt: readNullableString(row.finished_at),
      durationMs: readNullableNumber(row.duration_ms),
      scanned:
        readNumber(batch.scanned) +
        readNumber(queued.scanned) +
        readNumber(calendar.scanned),
      sent: readNumber(queued.sent) + readNumber(calendar.delivered),
      failed:
        readNumber(batch.failed) +
        readNumber(queued.failed) +
        readNumber(calendar.failed),
      duplicates:
        readNumber(batch.duplicatesSkipped) +
        readNumber(queued.duplicatesPrevented) +
        readNumber(calendar.duplicates),
      suppressed:
        readNumber(queued.suppressed) +
        readNumber(calendar.disabled) +
        readNumber(calendar.suppressed),
      lastError: readNullableString(row.last_error),
    };
  });
}

export async function listAlertChannelAttemptErrors(
  limit = 100,
): Promise<AlertChannelAttemptError[]> {
  const result = await supabaseSelect("alert_delivery_channel_attempts", {
    select:
      "id,delivery_id,user_id,channel,status,attempt_count,created_at,last_error",
    status: "in.(failed,uncertain)",
    order: "created_at.desc",
    limit: String(Math.max(1, Math.min(limit, 250))),
  });

  return readRows(result.data).map((row) => ({
    id: readString(row.id),
    deliveryId: readString(row.delivery_id),
    userId: readString(row.user_id),
    channel: readString(row.channel),
    status: readString(row.status),
    attemptCount: readNumber(row.attempt_count),
    createdAt: readString(row.created_at),
    lastError: readNullableString(row.last_error),
  }));
}

function readRows(value: unknown): Row[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Row =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readNullableString(value: unknown) {
  const result = readString(value);
  return result || null;
}

function readNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function readNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
