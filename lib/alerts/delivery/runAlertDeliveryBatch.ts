import "server-only";

import { runAlertDeliveryForEvent } from "@/lib/alerts/delivery/runAlertDeliveryForEvent";
import { supabaseSelect, supabaseUpdate, supabaseUpsert } from "@/lib/supabase";
import type {
  AlertDeliveryBatchEventResult,
  RunAlertDeliveryBatchOptions,
  RunAlertDeliveryBatchResult,
  RunAlertDeliveryResult,
} from "@/lib/alerts/delivery/types";

type EventRow = {
  id?: unknown;
  title?: unknown;
  detected_at?: unknown;
  delivery_level?: unknown;
};

type EventRunRow = {
  event_id?: unknown;
  status?: unknown;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 250;
const DEFAULT_LOOKBACK_HOURS = 6;

export async function runAlertDeliveryBatch(
  options: RunAlertDeliveryBatchOptions = {},
): Promise<RunAlertDeliveryBatchResult> {
  const requestedWrite = options.write === true;
  const dryRun = options.dryRun ?? !requestedWrite;
  const write = requestedWrite && !dryRun;
  const force = options.force === true;
  const limit = normalizeLimit(options.limit);
  const lookbackHours = normalizeLookbackHours(options.lookbackHours);
  const events = await fetchRecentDeliveryEvents({ limit, lookbackHours });
  const processedIds = force || !events.length ? new Set<string>() : await fetchAlreadyProcessedEventIds(events.map((event) => event.id));
  const eventResults: AlertDeliveryBatchEventResult[] = [];
  let skippedAlreadyProcessed = 0;

  for (const event of events) {
    if (!force && processedIds.has(event.id)) {
      skippedAlreadyProcessed += 1;
      eventResults.push({
        eventId: event.id,
        title: event.title,
        status: "already_processed",
        candidatesFound: 0,
        deliveriesCreated: 0,
        duplicatesSkipped: 0,
        suppressedCount: 0,
        failedCount: 0,
      });
      continue;
    }

    const result = await runAlertDeliveryForEvent({ eventId: event.id, dryRun, write });
    const eventResult = summarizeEventRun(event, result);
    eventResults.push(eventResult);

    if (write) {
      await recordEventRun(event.id, eventResult, result);
    }
  }

  const failed = eventResults.filter((event) => event.status === "failed").length;

  return {
    ok: failed === 0,
    dryRun,
    write,
    force,
    scanned: events.length,
    processed: write ? eventResults.filter((event) => event.status !== "already_processed").length : 0,
    wouldProcess: dryRun ? eventResults.filter((event) => event.status !== "already_processed").length : 0,
    skippedAlreadyProcessed,
    deliveriesCreated: eventResults.reduce((sum, event) => sum + event.deliveriesCreated, 0),
    duplicatesSkipped: eventResults.reduce((sum, event) => sum + event.duplicatesSkipped, 0),
    failed,
    events: eventResults,
  };
}

async function fetchRecentDeliveryEvents({
  limit,
  lookbackHours,
}: {
  limit: number;
  lookbackHours: number;
}) {
  const detectedAfter = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();
  const result = await supabaseSelect("events", {
    select: "id,title,detected_at,delivery_level",
    delivery_level: "eq.alert",
    detected_at: `gte.${detectedAfter}`,
    order: "detected_at.asc",
    limit: String(limit),
  });

  if (!result.ok) {
    throw new Error(result.error || "Failed to fetch recent events for delivery batch.");
  }

  return (Array.isArray(result.data) ? (result.data as EventRow[]) : [])
    .map((row) => ({
      id: readString(row.id),
      title: readString(row.title) || undefined,
    }))
    .filter((row) => row.id);
}

async function fetchAlreadyProcessedEventIds(eventIds: string[]) {
  if (!eventIds.length) return new Set<string>();
  const result = await supabaseSelect("alert_delivery_event_runs", {
    select: "event_id,status",
    event_id: `in.(${eventIds.join(",")})`,
    status: "in.(processed,skipped)",
    dry_run: "eq.false",
    limit: String(Math.max(eventIds.length, 1)),
  });

  if (!result.ok) return new Set<string>();

  return new Set(
    (Array.isArray(result.data) ? (result.data as EventRunRow[]) : [])
      .map((row) => readString(row.event_id))
      .filter(Boolean),
  );
}

function summarizeEventRun(
  event: {
    id: string;
    title?: string;
  },
  result: RunAlertDeliveryResult,
): AlertDeliveryBatchEventResult {
  const suppressedCount = result.writes.filter(
    (write) => write.skipped && write.reason && write.reason !== "DUPLICATE_DELIVERY",
  ).length;
  const failedCount = result.writes.filter((write) => !write.ok).length + (result.ok ? 0 : 1);

  if (!result.ok) {
    return {
      eventId: event.id,
      title: event.title,
      status: "failed",
      candidatesFound: 0,
      deliveriesCreated: 0,
      duplicatesSkipped: 0,
      suppressedCount,
      failedCount,
      error: sanitizeError(result.error || "Alert delivery event run failed."),
    };
  }

  const eventHasNoTicker = result.skipped.some((skip) => skip.reason === "EVENT_HAS_NO_TICKERS");
  return {
    eventId: event.id,
    title: result.event?.title || event.title,
    status: eventHasNoTicker ? "skipped" : "processed",
    candidatesFound: result.stats.candidateCount,
    deliveriesCreated: result.stats.writtenCount,
    duplicatesSkipped: result.stats.duplicateCount,
    suppressedCount,
    failedCount,
  };
}

async function recordEventRun(eventId: string, eventResult: AlertDeliveryBatchEventResult, result: RunAlertDeliveryResult) {
  const payload = {
    event_id: eventId,
    status: eventResult.status === "already_processed" ? "processed" : eventResult.status,
    dry_run: false,
    processed_at: new Date().toISOString(),
    deliveries_created: eventResult.deliveriesCreated,
    duplicates_skipped: eventResult.duplicatesSkipped,
    candidates_found: eventResult.candidatesFound,
    suppressed_count: eventResult.suppressedCount,
    failed_count: eventResult.failedCount,
    result_summary: {
      event: result.event
        ? {
            title: result.event.title,
            tickers: result.event.tickers,
            category: result.event.category,
            sourceType: result.event.sourceType,
          }
        : null,
      stats: result.stats,
      skipped: result.skipped.map((skip) => ({
        reason: skip.reason,
        detail: skip.detail,
      })),
    },
    last_error: eventResult.error || null,
  };

  const inserted = await supabaseUpsert("alert_delivery_event_runs", payload, {
    prefer: "return=representation",
  });

  if (inserted.ok) return;

  if (/duplicate|unique/i.test(inserted.error || "")) {
    await supabaseUpdate("alert_delivery_event_runs", { event_id: `eq.${eventId}`, dry_run: "eq.false" }, payload);
  }
}

function normalizeLimit(value: unknown) {
  const limit = typeof value === "number" && Number.isFinite(value) ? value : DEFAULT_LIMIT;
  return Math.max(1, Math.min(Math.trunc(limit), MAX_LIMIT));
}

function normalizeLookbackHours(value: unknown) {
  const hours = typeof value === "number" && Number.isFinite(value) ? value : DEFAULT_LOOKBACK_HOURS;
  return Math.max(1, Math.min(Math.trunc(hours), 24 * 30));
}

function sanitizeError(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [REDACTED]")
    .replace(/bot[A-Za-z0-9:_-]+/g, "bot[REDACTED]")
    .slice(0, 500);
}

function readString(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}
