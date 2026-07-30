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
