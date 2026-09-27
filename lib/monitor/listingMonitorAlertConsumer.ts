import { readMonitorCurrentPrice, type MonitorCurrentPriceProjectionReaders } from "./currentPrice.ts";
import { readSecForm25EventIdentity, type Form25IdentityGate } from "../sec-form25-identity/consumption.ts";
import {
  currentListingTicker,
  currentOwnershipTicker,
  evaluateForm4InsiderPurchaseMonitor,
  evaluateMonitorConditions,
  readMonitorEventTicker,
  safeReadMonitorEventIdentity,
  type ListingMonitorMatchReasonCode,
  type ListingMonitorMatchStatus,
  type MonitorFactReaders,
} from "../listingMonitorMatcher.ts";
import {
  type CurrentPrice,
} from "../market-data/marketDataProvider.ts";
import { getReadyMonitorCondition } from "./conditionRegistry.ts";
import {
  FORM4_INSIDER_PURCHASE_MONITOR_KIND,
  type Form4PurchaseMatchEvidence,
} from "./form4InsiderPurchaseMonitor.ts";
import {
  recordForm4MonitorEvaluation,
  type Form4MonitorEvaluationRecordInput,
  type Form4MonitorEvaluationRecordWriteResult,
  type Form4NotificationOutcome,
} from "./form4MonitorEvaluationHistory.ts";
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
  evaluationHistoryWrites: readonly Form4MonitorEvaluationRecordWriteResult[];
  createdCount: number;
  existingCount: number;
  failedCount: number;
}>;

export type ListingMonitorAlertConsumerDependencies = Readonly<{
  readEventIdentity?(eventId: string): Promise<Form25IdentityGate>;
  readFacts?(eventId: string): Promise<CurrentListingRiskReadResult>;
  readCorporateActionFacts?(eventId: string): Promise<CurrentCorporateActionReadResult>;
  readOwnershipFacts?(eventId: string): Promise<CurrentOwnershipReadResult>;
  readSecAmendmentCurrentState?(eventId: string): Promise<SecAmendmentMonitorCurrentState>;
  readEventTicker?(eventId: string): Promise<string>;
  readCurrentPrice?(symbol: string): Promise<CurrentPrice>;
  currentPriceProjectionReaders?: MonitorCurrentPriceProjectionReaders;
  readWatchlistTickers?(userId: string): Promise<readonly string[]>;
  recordForm4Evaluation?(
    input: Form4MonitorEvaluationRecordInput,
  ): Promise<Form4MonitorEvaluationRecordWriteResult>;
  listActiveMonitors(): Promise<ListingMonitorListResult>;
  createAlert(input: Readonly<{
    eventId: string;
    sourceExecutionId: string;
    monitorId: string;
    userId: string;
    createdAt: string;
    matchEvidence?: Form4PurchaseMatchEvidence;
  }>): Promise<ListingMonitorAlertWriteResult>;
  now(): Date;
}>;

const defaultDependencies: ListingMonitorAlertConsumerDependencies = {
  readEventIdentity: readSecForm25EventIdentity,
  readFacts: readCurrentListingRiskFacts,
  readCorporateActionFacts: readCurrentCorporateActionFacts,
  readOwnershipFacts: readCurrentOwnershipFacts,
  readSecAmendmentCurrentState: readSecAmendmentMonitorCurrentState,
  readEventTicker: readMonitorEventTicker,
  readCurrentPrice: async (symbol) => (
    await import("../market-data/currentPrice.ts")
  ).getCurrentPrice(symbol),
  readWatchlistTickers: readOwnerWatchlistTickers,
  recordForm4Evaluation: recordForm4MonitorEvaluation,
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
  const processingAttemptId = crypto.randomUUID();
  const currentEventId = input.alertEventId || input.eventId;
  const identity = dependencies.readEventIdentity
    ? await safeReadMonitorEventIdentity(currentEventId, dependencies.readEventIdentity)
    : null;
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
  const amendmentBlocked = identity?.status === "blocked" || amendmentState.status === "blocked";
  const amendmentBlockReason = identity?.status === "blocked" ? identity.reason : amendmentState.status === "blocked"
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
  if (priceRequested && identity?.status !== "blocked") {
    const symbol = identity?.ticker || currentListingTicker(readers.listing)
      || currentOwnershipTicker(readers.ownership)
      || await safeReadTicker(
        currentEventId,
        dependencies.readEventTicker ?? defaultDependencies.readEventTicker!,
      );
    currentPrice = await readMonitorCurrentPrice({
      eventId: currentEventId, historicalTicker: symbol, ownership: readers.ownership,
    }, {
      readCurrentPrice: dependencies.readCurrentPrice ?? defaultDependencies.readCurrentPrice!,
      projectionReaders: dependencies.currentPriceProjectionReaders,
    });
  }
  const watchlistReads = new Map<string, Promise<readonly string[] | null>>();
  const evaluations = await Promise.all(listingMonitors.monitors.map(async (monitor) => {
    if (monitor.kind === FORM4_INSIDER_PURCHASE_MONITOR_KIND && monitor.form4PurchaseSettings) {
      const activeAtFiling = form4MonitorWasActiveAtFiling(monitor.createdAt, readers.ownership);
      const targetStatus = await resolveForm4PurchaseTargetStatus({
        userId: monitor.userId,
        ticker: currentOwnershipTicker(readers.ownership),
        settings: monitor.form4PurchaseSettings,
        readWatchlistTickers: dependencies.readWatchlistTickers ?? defaultDependencies.readWatchlistTickers!,
        watchlistReads,
      });
      const evaluated = evaluateForm4InsiderPurchaseMonitor(
        readers.ownership,
        monitor.conditions,
        monitor.form4PurchaseSettings,
        targetStatus,
      );
      return {
        monitor,
        result: activeAtFiling ? evaluated : {
          ...evaluated,
          status: "no_match" as const,
          reasonCode: "monitor_activation_not_met" as const,
          form4PurchaseEvidence: undefined,
          conditions: monitor.conditions.map((condition) => ({
            key: String(condition.key),
            status: "no_match" as const,
            reasonCode: "monitor_activation_not_met" as const,
          })),
        },
      };
    }
    return {
      monitor,
      result: evaluateMonitorConditions(readers, monitor.conditions, {
        evaluationDate,
        evaluatedAt: evaluationTime.toISOString(),
        ...(currentPrice ? { currentPrice } : {}),
      }),
    };
  }));
  const writes: ListingMonitorAlertWriteResult[] = [];
  const evaluationHistoryWrites: Form4MonitorEvaluationRecordWriteResult[] = [];

  for (const evaluation of evaluations) {
    if (evaluation.monitor.kind !== FORM4_INSIDER_PURCHASE_MONITOR_KIND) {
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
        writes.push({ status: "failed", monitorId: evaluation.monitor.id, error: errorMessage(error) });
      }
      continue;
    }

    const lineage = matchingLineage(readers, evaluation.monitor.conditions);
    let notification: Form4NotificationOutcome;
    if (evaluation.result.status !== "match") {
      notification = { status: "not_created", reasonCode: "evaluation_not_match" };
    } else if (!lineage) {
      notification = { status: "not_created", reasonCode: "matching_lineage_unavailable" };
    } else {
      let write: ListingMonitorAlertWriteResult;
      try {
        write = await dependencies.createAlert({
          eventId: input.alertEventId || lineage.eventId,
          sourceExecutionId: lineage.sourceExecutionId,
          monitorId: evaluation.monitor.id,
          userId: evaluation.monitor.userId,
          createdAt: lineage.persistedAt,
          ...(evaluation.result.form4PurchaseEvidence
            ? { matchEvidence: evaluation.result.form4PurchaseEvidence }
            : {}),
        });
      } catch (error) {
        write = { status: "failed", monitorId: evaluation.monitor.id, error: errorMessage(error) };
      }
      writes.push(write);
      if (write.status === "created") {
        notification = { status: "created", reasonCode: "alert_created", ...(write.alertId ? { alertId: write.alertId } : {}) };
      } else if (write.status === "existing") {
        notification = { status: "existing", reasonCode: "duplicate_alert_existing", ...(write.alertId ? { alertId: write.alertId } : {}) };
      } else {
        notification = { status: "failed", reasonCode: "alert_write_failed", error: "error" in write ? write.error : "Alert write failed" };
      }
    }
    if (dependencies.recordForm4Evaluation) {
      evaluationHistoryWrites.push(await dependencies.recordForm4Evaluation({
        processingAttemptId,
        eventId: input.alertEventId || lineage?.eventId || currentEventId,
        ...(lineage?.sourceExecutionId ? { sourceExecutionId: lineage.sourceExecutionId } : {}),
        evaluatedAt: evaluationTime.toISOString(),
        monitor: evaluation.monitor,
        result: evaluation.result,
        notification,
      }).catch((error) => ({ status: "failed" as const, error: errorMessage(error) })));
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
    evaluationHistoryWrites,
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
  matchEvidence?: Form4PurchaseMatchEvidence;
}>): Promise<ListingMonitorAlertWriteResult> {
  const repository = await import("../supabase.ts");
  const result = await repository.supabaseUpsert("user_alert_deliveries", {
    user_id: input.userId,
    alert_event_id: input.eventId,
    ticker: input.matchEvidence?.ticker ?? null,
    title: input.matchEvidence ? "Form 4 insider purchase reported" : "Listing monitor matched",
    category: input.matchEvidence ? "insider_ownership" : "listing_risk",
    source_type: "other",
    source_label: input.matchEvidence ? "Form 4 Purchase Monitor" : "Listing Monitor",
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
    listing_match_evidence: input.matchEvidence ?? null,
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
  if (row) return {
        status: "created",
        monitorId: input.monitorId,
        alertId: typeof row.id === "string" ? row.id : undefined,
      };
  const existing = await repository.supabaseSelect("user_alert_deliveries", {
    select: "id",
    listing_monitor_id: `eq.${input.monitorId}`,
    alert_event_id: `eq.${input.eventId}`,
    limit: "1",
  });
  const existingRow = existing.ok && Array.isArray(existing.data)
    ? existing.data[0] as Record<string, unknown> | undefined
    : undefined;
  return {
    status: "existing",
    monitorId: input.monitorId,
    ...(typeof existingRow?.id === "string" ? { alertId: existingRow.id } : {}),
  };
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function form4MonitorWasActiveAtFiling(
  monitorCreatedAt: string,
  current: CurrentOwnershipReadResult,
) {
  if (current.status !== "available" || current.form !== "form4") return true;
  const createdAt = Date.parse(monitorCreatedAt);
  const filedAt = Date.parse(current.filedAt ?? "");
  return Number.isFinite(createdAt) && Number.isFinite(filedAt) && createdAt <= filedAt;
}

async function resolveForm4PurchaseTargetStatus(input: Readonly<{
  userId: string;
  ticker: string;
  settings: NonNullable<import("./listingMonitorPersistence.ts").ListingMonitor["form4PurchaseSettings"]>;
  readWatchlistTickers(userId: string): Promise<readonly string[]>;
  watchlistReads: Map<string, Promise<readonly string[] | null>>;
}>): Promise<"eligible" | "no_match" | "unavailable"> {
  if (!input.ticker) return "unavailable";
  if (input.settings.target.scope === "ticker") {
    return input.settings.target.ticker === input.ticker ? "eligible" : "no_match";
  }
  let read = input.watchlistReads.get(input.userId);
  if (!read) {
    read = input.readWatchlistTickers(input.userId)
      .then((tickers) => tickers)
      .catch(() => null);
    input.watchlistReads.set(input.userId, read);
  }
  const tickers = await read;
  return tickers === null
    ? "unavailable"
    : tickers.includes(input.ticker) ? "eligible" : "no_match";
}

async function readOwnerWatchlistTickers(userId: string) {
  const repository = await import("../supabase.ts");
  const result = await repository.supabaseSelect("watchlist_tickers", {
    select: "ticker",
    user_id: `eq.${userId}`,
    order: "ticker.asc",
    limit: "500",
  });
  if (!result.ok || !Array.isArray(result.data)) {
    throw new Error(result.error || "Watchlist target read failed");
  }
  return result.data.flatMap((row) => {
    const ticker = row && typeof row === "object" && !Array.isArray(row)
      && typeof (row as Record<string, unknown>).ticker === "string"
      ? String((row as Record<string, unknown>).ticker).trim().toUpperCase()
      : "";
    return /^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(ticker) ? [ticker] : [];
  });
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message.slice(0, 500)
    : typeof error === "string"
      ? error.slice(0, 500)
      : "Listing Monitor Alert write failed";
}
