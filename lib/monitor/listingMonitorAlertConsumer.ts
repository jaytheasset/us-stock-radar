import {
  evaluateListingMonitorConditions,
  type ListingMonitorMatchReasonCode,
  type ListingMonitorMatchStatus,
} from "../listingMonitorMatcher.ts";
import {
  listActiveListingMonitorsForConsumer,
  type ListingMonitorDiagnostic,
  type ListingMonitorListResult,
} from "./listingMonitorPersistence.ts";
import {
  readCurrentListingRiskFacts,
  type CurrentListingRiskReadResult,
} from "./listingRiskPersistence.ts";

export const LISTING_MONITOR_ALERT_CONSUMER_VERSION = "listing_monitor_alert_consumer_v1" as const;

export type ListingMonitorAlertWriteResult =
  | Readonly<{ status: "created" | "existing"; monitorId: string; alertId?: string }>
  | Readonly<{ status: "failed"; monitorId: string; error: string }>;

export type ListingMonitorAlertConsumerResult = Readonly<{
  version: typeof LISTING_MONITOR_ALERT_CONSUMER_VERSION;
  status: "completed" | "partial_failure";
  eventId: string;
  sourceExecutionId?: string;
  readerStatus: CurrentListingRiskReadResult["status"];
  readerReason?: string;
  evaluationDate: string;
  monitorCount: number;
  diagnostics: readonly ListingMonitorDiagnostic[];
  evaluations: readonly Readonly<{
    monitorId: string;
    status: ListingMonitorMatchStatus;
    reasonCode: ListingMonitorMatchReasonCode;
  }>[];
  writes: readonly ListingMonitorAlertWriteResult[];
  createdCount: number;
  existingCount: number;
  failedCount: number;
}>;

export type ListingMonitorAlertConsumerDependencies = Readonly<{
  readFacts(eventId: string): Promise<CurrentListingRiskReadResult>;
  listActiveMonitors(): Promise<ListingMonitorListResult>;
  createAlert(input: Readonly<{
    eventId: string;
    sourceExecutionId: string;
    monitorId: string;
    userId: string;
    createdAt: string;
  }>): Promise<ListingMonitorAlertWriteResult>;
  now(): Date;
}>;

const defaultDependencies: ListingMonitorAlertConsumerDependencies = {
  readFacts: readCurrentListingRiskFacts,
  listActiveMonitors: listActiveListingMonitorsForConsumer,
  createAlert: createListingMonitorAlert,
  now: () => new Date(),
};

/**
 * Post-canonical Listing consumer. It reads the official current result once,
 * reuses that immutable value for every active monitor, and persists MATCH
 * results only. Invalid stored monitors are excluded by Persistence V1 with a
 * diagnostic and never prevent valid monitors from running.
 */
export async function consumeListingMonitorAlertsForEvent(
  input: Readonly<{ eventId: string }>,
  dependencies: ListingMonitorAlertConsumerDependencies = defaultDependencies,
): Promise<ListingMonitorAlertConsumerResult> {
  let current: CurrentListingRiskReadResult;
  try {
    current = await dependencies.readFacts(input.eventId);
  } catch {
    current = { status: "not_ready", reason: "reader_unavailable" };
  }

  const listingMonitors = await dependencies.listActiveMonitors();
  // Matcher V1 relative-date operators are intentionally evaluated against
  // the processing date. Replays on a later day may legitimately re-evaluate
  // moving windows; the database identity still prevents duplicate Alerts for
  // the same monitor and exact canonical result.
  const evaluationDate = dateOnly(dependencies.now());
  const evaluations = listingMonitors.monitors.map((monitor) => ({
    monitor,
    result: evaluateListingMonitorConditions(current, monitor.conditions, { evaluationDate }),
  }));
  const writes: ListingMonitorAlertWriteResult[] = [];

  if (current.status === "available") {
    for (const evaluation of evaluations) {
      if (evaluation.result.status !== "match") continue;
      try {
        writes.push(await dependencies.createAlert({
          eventId: current.eventId,
          sourceExecutionId: current.sourceExecutionId,
          monitorId: evaluation.monitor.id,
          userId: evaluation.monitor.userId,
          createdAt: current.persistedAt,
        }));
      } catch (error) {
        writes.push({
          status: "failed",
          monitorId: evaluation.monitor.id,
          error: errorMessage(error),
        });
      }
    }
  }

  const createdCount = writes.filter((write) => write.status === "created").length;
  const existingCount = writes.filter((write) => write.status === "existing").length;
  const failedCount = writes.filter((write) => write.status === "failed").length;
  return {
    version: LISTING_MONITOR_ALERT_CONSUMER_VERSION,
    status: failedCount > 0 ? "partial_failure" : "completed",
    eventId: input.eventId,
    ...(current.status !== "not_ready" ? { sourceExecutionId: current.sourceExecutionId } : {}),
    readerStatus: current.status,
    ...(current.status === "not_ready" ? { readerReason: current.reason } : {}),
    evaluationDate,
    monitorCount: listingMonitors.monitors.length,
    diagnostics: listingMonitors.diagnostics,
    evaluations: evaluations.map(({ monitor, result }) => ({
      monitorId: monitor.id,
      status: result.status,
      reasonCode: result.reasonCode,
    })),
    writes,
    createdCount,
    existingCount,
    failedCount,
  };
}

export async function createListingMonitorAlert(input: Readonly<{
  eventId: string;
  sourceExecutionId: string;
  monitorId: string;
  userId: string;
  createdAt: string;
}>): Promise<ListingMonitorAlertWriteResult> {
  const repository = await import("../supabase.ts");
  const result = await repository.supabaseUpsert("user_alert_deliveries", {
    user_id: input.userId,
    alert_event_id: input.eventId,
    ticker: null,
    title: "Listing monitor matched",
    category: "listing_risk",
    source_type: "other",
    source_label: "Listing Monitor",
    alert_lane: "listing_monitor",
    severity: null,
    delivered_channels: [],
    delivery_status: "queued",
    delivered_at: input.createdAt,
    scheduled_for: null,
    sent_at: null,
    attempted_at: null,
    last_error: null,
    dedupe_key: null,
    listing_monitor_id: input.monitorId,
    alert_domain: "listing",
    listing_source_execution_id: input.sourceExecutionId,
  }, {
    onConflict: "listing_monitor_id,alert_event_id,listing_source_execution_id",
    prefer: "resolution=ignore-duplicates,return=representation",
  });

  if (!result.ok) {
    return {
      status: "failed",
      monitorId: input.monitorId,
      error: result.error || `HTTP ${result.status}`,
    };
  }
  const row = Array.isArray(result.data) ? result.data[0] as Record<string, unknown> | undefined : undefined;
  return row
    ? {
        status: "created",
        monitorId: input.monitorId,
        alertId: typeof row.id === "string" ? row.id : undefined,
      }
    : { status: "existing", monitorId: input.monitorId };
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message.slice(0, 500)
    : typeof error === "string"
      ? error.slice(0, 500)
      : "Listing Monitor Alert write failed";
}
