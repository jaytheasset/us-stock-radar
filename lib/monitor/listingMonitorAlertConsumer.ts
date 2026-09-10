import {
  currentListingTicker,
  currentOwnershipTicker,
  evaluateMonitorConditions,
  readMonitorEventTicker,
  type ListingMonitorMatchReasonCode,
  type ListingMonitorMatchStatus,
  type MonitorFactReaders,
} from "../listingMonitorMatcher.ts";
import {
  unavailableCurrentPrice,
  type CurrentPrice,
} from "../market-data/marketDataProvider.ts";
import { getReadyMonitorCondition } from "./conditionRegistry.ts";
import {
  listActiveListingMonitorsForConsumer,
  type ListingMonitorDiagnostic,
  type ListingMonitorListResult,
} from "./listingMonitorPersistence.ts";
import {
  readCurrentListingRiskFacts,
  type CurrentListingRiskReadResult,
} from "./listingRiskPersistence.ts";
import {
  readCurrentCorporateActionFacts,
  type CurrentCorporateActionReadResult,
} from "./corporateActionPersistence.ts";
import {
  readCurrentOwnershipFacts,
  type CurrentOwnershipReadResult,
} from "./ownershipMonitorPersistence.ts";
import {
  readSecAmendmentMonitorCurrentState,
  type SecAmendmentMonitorCurrentState,
} from "../sec-amendments/secAmendmentMonitorBridge.ts";

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
  corporateActionReaderStatus: CurrentCorporateActionReadResult["status"];
  corporateActionReaderReason?: string;
  ownershipReaderStatus: CurrentOwnershipReadResult["status"];
  ownershipReaderReason?: string;
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
  readFacts?(eventId: string): Promise<CurrentListingRiskReadResult>;
  readCorporateActionFacts?(eventId: string): Promise<CurrentCorporateActionReadResult>;
  readOwnershipFacts?(eventId: string): Promise<CurrentOwnershipReadResult>;
  readSecAmendmentCurrentState?(eventId: string): Promise<SecAmendmentMonitorCurrentState>;
  readEventTicker?(eventId: string): Promise<string>;
  readCurrentPrice?(symbol: string): Promise<CurrentPrice>;
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
  readCorporateActionFacts: readCurrentCorporateActionFacts,
  readOwnershipFacts: readCurrentOwnershipFacts,
  readSecAmendmentCurrentState: readSecAmendmentMonitorCurrentState,
  readEventTicker: readMonitorEventTicker,
  readCurrentPrice: async (symbol) => (
    await import("../market-data/currentPrice.ts")
  ).getCurrentPrice(symbol),
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
  input: Readonly<{ eventId: string; alertEventId?: string }>,
  dependencies: ListingMonitorAlertConsumerDependencies = defaultDependencies,
): Promise<ListingMonitorAlertConsumerResult> {
  const listingMonitors = await dependencies.listActiveMonitors();
  const currentEventId = input.alertEventId || input.eventId;
  const amendmentState = dependencies.readSecAmendmentCurrentState
    ? await safeReadSecAmendmentCurrentState(currentEventId, dependencies.readSecAmendmentCurrentState)
    : { status: "not_applicable" as const };
  const allConditions = listingMonitors.monitors.flatMap((monitor) => monitor.conditions);
  const listingRequested = allConditions.some((condition) => (
    getReadyMonitorCondition(condition.key)?.source.reader === "read_current_event_listing_risk_facts"
  ));
  const corporateActionRequested = allConditions.some((condition) => (
    getReadyMonitorCondition(condition.key)?.source.reader === "read_current_event_corporate_action_facts"
  ));
  const ownershipRequested = allConditions.some((condition) => (
    getReadyMonitorCondition(condition.key)?.source.reader === "read_current_event_ownership_facts"
  ));
  const amendmentBlocked = amendmentState.status === "blocked";
  const amendmentBlockReason = amendmentBlocked
    ? `sec_amendment_current_state_${amendmentState.reason}`
    : "";
  const readers: MonitorFactReaders = {
    listing: amendmentBlocked
      ? { status: "not_ready", reason: amendmentBlockReason }
      : amendmentState.status === "available" && amendmentState.listing
      ? amendmentState.listing
      : listingRequested
      ? await safeReadFacts(
          currentEventId,
          dependencies.readFacts ?? defaultDependencies.readFacts!,
        )
      : { status: "not_ready", reason: "reader_not_requested" },
    corporateAction: amendmentBlocked
      ? { status: "not_ready", reason: amendmentBlockReason }
      : amendmentState.status === "available" && amendmentState.corporateAction
      ? amendmentState.corporateAction
      : corporateActionRequested
      ? await safeReadFacts(
          currentEventId,
          dependencies.readCorporateActionFacts ?? defaultDependencies.readCorporateActionFacts!,
        )
      : { status: "not_ready", reason: "reader_not_requested" },
    ownership: amendmentBlocked
      ? { status: "not_ready", reason: amendmentBlockReason }
      : ownershipRequested
      ? await safeReadFacts(
          currentEventId,
          dependencies.readOwnershipFacts ?? defaultDependencies.readOwnershipFacts!,
        )
      : { status: "not_ready", reason: "reader_not_requested" },
  };
  // Matcher V1 relative-date operators are intentionally evaluated against
  // the processing date. Replays on a later day may legitimately re-evaluate
  // moving windows; the database identity still prevents duplicate Alerts for
  // the same monitor and exact canonical result.
  const evaluationTime = dependencies.now();
  const evaluationDate = dateOnly(evaluationTime);
  const priceRequested = listingMonitors.monitors.some((monitor) => (
    monitor.conditions.some((condition) => (
      getReadyMonitorCondition(condition.key)?.source.reader === "get_current_price"
    ))
  ));
  let currentPrice: CurrentPrice | undefined;
  if (priceRequested) {
    const symbol = currentListingTicker(readers.listing)
      || currentOwnershipTicker(readers.ownership)
      || await safeReadTicker(
        currentEventId,
        dependencies.readEventTicker ?? defaultDependencies.readEventTicker!,
      );
    if (!symbol) {
      currentPrice = unavailableCurrentPrice(symbol);
    } else {
      try {
        currentPrice = await (dependencies.readCurrentPrice
          ?? defaultDependencies.readCurrentPrice!)(symbol);
      } catch {
        currentPrice = unavailableCurrentPrice(symbol);
      }
    }
  }
  const evaluations = listingMonitors.monitors.map((monitor) => ({
    monitor,
    result: evaluateMonitorConditions(readers, monitor.conditions, {
      evaluationDate,
      evaluatedAt: evaluationTime.toISOString(),
      ...(currentPrice ? { currentPrice } : {}),
    }),
  }));
  const writes: ListingMonitorAlertWriteResult[] = [];

  for (const evaluation of evaluations) {
    if (evaluation.result.status !== "match") continue;
    const lineage = matchingLineage(readers, evaluation.monitor.conditions);
    if (!lineage) continue;
    try {
      writes.push(await dependencies.createAlert({
        eventId: input.alertEventId || lineage.eventId,
        sourceExecutionId: lineage.sourceExecutionId,
        monitorId: evaluation.monitor.id,
        userId: evaluation.monitor.userId,
        createdAt: lineage.persistedAt,
      }));
    } catch (error) {
      writes.push({
        status: "failed",
        monitorId: evaluation.monitor.id,
        error: errorMessage(error),
      });
    }
  }

  const createdCount = writes.filter((write) => write.status === "created").length;
  const existingCount = writes.filter((write) => write.status === "existing").length;
  const failedCount = writes.filter((write) => write.status === "failed").length;
  return {
    version: LISTING_MONITOR_ALERT_CONSUMER_VERSION,
    status: failedCount > 0 ? "partial_failure" : "completed",
    eventId: input.eventId,
    ...sourceExecutionSummary(readers, corporateActionRequested, ownershipRequested),
    readerStatus: readers.listing.status,
    ...(readers.listing.status === "not_ready" ? { readerReason: readers.listing.reason } : {}),
    corporateActionReaderStatus: readers.corporateAction.status,
    ...(readers.corporateAction.status === "not_ready"
      ? { corporateActionReaderReason: readers.corporateAction.reason }
      : {}),
    ownershipReaderStatus: readers.ownership.status,
    ...(readers.ownership.status === "not_ready"
      ? { ownershipReaderReason: readers.ownership.reason }
      : {}),
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

async function safeReadFacts<T>(eventId: string, reader: (eventId: string) => Promise<T>): Promise<T> {
  try {
    return await reader(eventId);
  } catch {
    return { status: "not_ready", reason: "reader_unavailable" } as T;
  }
}

async function safeReadSecAmendmentCurrentState(
  eventId: string,
  reader: (eventId: string) => Promise<SecAmendmentMonitorCurrentState>,
): Promise<SecAmendmentMonitorCurrentState> {
  try {
    return await reader(eventId);
  } catch {
    return { status: "blocked", reason: "lineage_reader_unavailable" };
  }
}

async function safeReadTicker(eventId: string, reader: (eventId: string) => Promise<string>) {
  try {
    const ticker = await reader(eventId);
    return typeof ticker === "string" && /^[A-Z0-9][A-Z0-9.-]{0,14}$/i.test(ticker.trim())
      ? ticker.trim().toUpperCase()
      : "";
  } catch {
    return "";
  }
}

function matchingLineage(
  readers: MonitorFactReaders,
  conditions: readonly Readonly<{ key: string }>[],
) {
  const usesCorporateAction = conditions.some((condition) => (
    getReadyMonitorCondition(condition.key)?.source.reader === "read_current_event_corporate_action_facts"
  ));
  const usesOwnership = conditions.some((condition) => (
    getReadyMonitorCondition(condition.key)?.source.reader === "read_current_event_ownership_facts"
  ));
  if (usesOwnership && readers.ownership.status === "available") {
    return readers.ownership;
  }
  if (usesCorporateAction && readers.corporateAction.status === "available") {
    return readers.corporateAction;
  }
  if (readers.listing.status === "available") return readers.listing;
  if (readers.corporateAction.status === "available") return readers.corporateAction;
  return null;
}

function sourceExecutionSummary(
  readers: MonitorFactReaders,
  preferCorporateAction: boolean,
  preferOwnership: boolean,
) {
  const current = preferOwnership && readers.ownership.status === "available"
    ? readers.ownership
    : preferCorporateAction && readers.corporateAction.status !== "not_ready"
    ? readers.corporateAction
    : readers.listing.status !== "not_ready"
      ? readers.listing
      : readers.corporateAction.status !== "not_ready"
      ? readers.corporateAction
      : readers.ownership.status === "available"
        ? readers.ownership
      : null;
  return current ? { sourceExecutionId: current.sourceExecutionId } : {};
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
    onConflict: "listing_monitor_id,alert_event_id",
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
