import {
  evaluateOfferingMonitorConditions,
  type OfferingMonitorMatchReasonCode,
  type OfferingMonitorMatchStatus,
} from "../offeringMonitorMatcher.ts";
import {
  readRegistryBackedOfferingFacts,
  type RegistryBackedOfferingFactReadResult,
} from "./registryBackedOfferingFacts.ts";
import {
  listActiveOfferingMonitorsForConsumer,
  type OfferingMonitorDiagnostic,
  type OfferingMonitorListResult,
} from "./offeringMonitorPersistence.ts";

export const OFFERING_MONITOR_ALERT_CONSUMER_VERSION =
  "offering_monitor_alert_consumer_v1" as const;

export type OfferingMonitorAlertWriteResult =
  | Readonly<{ status: "created" | "existing"; monitorId: string; alertId?: string }>
  | Readonly<{ status: "failed"; monitorId: string; error: string }>;

export type OfferingMonitorAlertConsumerDependencies = Readonly<{
  readFacts(eventId: string): Promise<RegistryBackedOfferingFactReadResult>;
  listActiveMonitors(): Promise<OfferingMonitorListResult>;
  createAlert(input: Readonly<{
    eventId: string;
    monitorId: string;
    userId: string;
    registryAccession: string;
    registrySnapshotId: string;
    createdAt: string;
  }>): Promise<OfferingMonitorAlertWriteResult>;
  now(): Date;
}>;

export type OfferingMonitorAlertConsumerInput = Readonly<{
  eventId: string;
  preloadedFacts?: RegistryBackedOfferingFactReadResult;
}>;

export type OfferingMonitorAlertConsumerResult = Readonly<{
  version: typeof OFFERING_MONITOR_ALERT_CONSUMER_VERSION;
  status: "completed" | "partial_failure";
  eventId: string;
  readerStatus: RegistryBackedOfferingFactReadResult["status"];
  readerReason?: string;
  monitorCount: number;
  diagnostics: readonly OfferingMonitorDiagnostic[];
  evaluations: readonly Readonly<{
    monitorId: string;
    status: OfferingMonitorMatchStatus;
    reasonCode: OfferingMonitorMatchReasonCode;
  }>[];
  writes: readonly OfferingMonitorAlertWriteResult[];
  createdCount: number;
  existingCount: number;
  failedCount: number;
}>;

const defaultDependencies: OfferingMonitorAlertConsumerDependencies = {
  readFacts: readRegistryBackedOfferingFacts,
  listActiveMonitors: listActiveOfferingMonitorsForConsumer,
  createAlert: createOfferingMonitorAlert,
  now: () => new Date(),
};

/** Exact-event Registry facts -> stored Offering conditions -> existing Matcher -> internal Alert. */
export async function consumeOfferingMonitorAlertsForEvent(
  input: OfferingMonitorAlertConsumerInput,
  dependencies: OfferingMonitorAlertConsumerDependencies = defaultDependencies,
): Promise<OfferingMonitorAlertConsumerResult> {
  const monitors = await dependencies.listActiveMonitors();
  let facts: RegistryBackedOfferingFactReadResult;
  if (input.preloadedFacts) {
    facts = input.preloadedFacts;
  } else {
    try {
      facts = await dependencies.readFacts(input.eventId);
    } catch {
      facts = {
        status: "not_ready",
        version: "registry_backed_offering_fact_adapter_v1",
        reason: "reader_unavailable",
      };
    }
  }
  if (facts.status === "available" && facts.eventId !== input.eventId) {
    facts = {
      status: "not_ready",
      version: "registry_backed_offering_fact_adapter_v1",
      reason: "event_identity_mismatch",
    };
  }
  const evaluations = monitors.monitors.map((monitor) => ({
    monitor,
    result: evaluateOfferingMonitorConditions(facts, monitor.conditions),
  }));
  const writes: OfferingMonitorAlertWriteResult[] = [];
  const createdAt = dependencies.now().toISOString();

  for (const evaluation of evaluations) {
    if (
      evaluation.result.status !== "match"
      || facts.status !== "available"
      || facts.mappingStatus !== "mapped"
      || !facts.registrySnapshotId
      || !facts.registrySourceIdentity
    ) continue;
    try {
      writes.push(await dependencies.createAlert({
        eventId: facts.eventId,
        monitorId: evaluation.monitor.id,
        userId: evaluation.monitor.userId,
        registryAccession: facts.accession,
        registrySnapshotId: facts.registrySnapshotId,
        createdAt,
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
    version: OFFERING_MONITOR_ALERT_CONSUMER_VERSION,
    status: failedCount ? "partial_failure" : "completed",
    eventId: input.eventId,
    readerStatus: facts.status,
    ...(facts.status === "not_ready"
      ? { readerReason: facts.reason }
      : facts.mappingStatus === "unmappable"
        ? { readerReason: facts.reason }
        : {}),
    monitorCount: monitors.monitors.length,
    diagnostics: monitors.diagnostics,
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

export async function createOfferingMonitorAlert(input: Readonly<{
  eventId: string;
  monitorId: string;
  userId: string;
  registryAccession: string;
  registrySnapshotId: string;
  createdAt: string;
}>): Promise<OfferingMonitorAlertWriteResult> {
  const repository = await import("../supabase.ts");
  const result = await repository.supabaseUpsert("user_alert_deliveries", {
    user_id: input.userId,
    alert_event_id: input.eventId,
    ticker: null,
    title: "Offering monitor matched",
    category: "dilution_risk",
    source_type: "other",
    source_label: "Offering Monitor",
    alert_lane: "offering_monitor",
    severity: null,
    delivered_channels: [],
    delivery_status: "queued",
    delivered_at: input.createdAt,
    scheduled_for: null,
    sent_at: null,
    attempted_at: null,
    last_error: null,
    dedupe_key: null,
    offering_monitor_id: input.monitorId,
    alert_domain: "offering",
    offering_registry_accession: input.registryAccession,
    offering_registry_snapshot_id: input.registrySnapshotId,
  }, {
    onConflict: "offering_monitor_id,alert_event_id",
    prefer: "resolution=ignore-duplicates,return=representation",
  });
  if (!result.ok) {
    return {
      status: "failed",
      monitorId: input.monitorId,
      error: result.error || `HTTP ${result.status || 0}`,
    };
  }
  const row = Array.isArray(result.data) && record(result.data[0]) ? result.data[0] : undefined;
  return row
    ? {
        status: "created",
        monitorId: input.monitorId,
        alertId: typeof row.id === "string" ? row.id : undefined,
      }
    : { status: "existing", monitorId: input.monitorId };
}

export type OfferingMonitorAlertItem = Readonly<{
  id: string;
  monitorId: string;
  eventId: string;
  registryAccession: string;
  registrySnapshotId: string;
  createdAt: string;
}>;

export type OfferingMonitorAlertReadRepository = Readonly<{
  list(input: Readonly<{ ownerId: string; monitorId?: string }>): Promise<Readonly<{
    ok: boolean;
    status?: number;
    data: unknown;
    error?: string;
  }>>;
}>;

export async function listOfferingMonitorAlertsForOwner(
  input: Readonly<{ ownerId: string; monitorId?: string }>,
  repository?: OfferingMonitorAlertReadRepository,
): Promise<readonly OfferingMonitorAlertItem[]> {
  const ownerId = requireUuid(input.ownerId, "ownerId");
  const monitorId = input.monitorId ? requireUuid(input.monitorId, "monitorId") : undefined;
  const resolved = repository || await resolveAlertRepository();
  const result = await resolved.list({ ownerId, ...(monitorId ? { monitorId } : {}) });
  if (!result.ok) throw new Error(result.error || `Offering Monitor Alert read failed: HTTP ${result.status || 0}`);
  return rows(result.data).flatMap((row) => {
    const id = stringValue(row.id);
    const rowMonitorId = stringValue(row.offering_monitor_id);
    const eventId = stringValue(row.alert_event_id);
    const accession = stringValue(row.offering_registry_accession);
    const snapshotId = integerId(row.offering_registry_snapshot_id);
    const createdAt = stringValue(row.created_at);
    if (
      !UUID_PATTERN.test(id)
      || !UUID_PATTERN.test(rowMonitorId)
      || !UUID_PATTERN.test(eventId)
      || !/^\d{10}-\d{2}-\d{6}$/.test(accession)
      || !snapshotId
      || !Number.isFinite(Date.parse(createdAt))
    ) return [];
    return [{
      id,
      monitorId: rowMonitorId,
      eventId,
      registryAccession: accession,
      registrySnapshotId: snapshotId,
      createdAt,
    }];
  });
}

async function resolveAlertRepository(): Promise<OfferingMonitorAlertReadRepository> {
  const supabase = await import("../supabase.ts");
  return {
    list: ({ ownerId, monitorId }) => supabase.supabaseSelect("user_alert_deliveries", {
      select: "id,alert_event_id,offering_monitor_id,offering_registry_accession,offering_registry_snapshot_id,created_at",
      user_id: `eq.${ownerId}`,
      alert_domain: "eq.offering",
      alert_lane: "eq.offering_monitor",
      ...(monitorId ? { offering_monitor_id: `eq.${monitorId}` } : {}),
      order: "delivered_at.desc,id.desc",
      limit: "100",
    }),
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message.slice(0, 500)
    : typeof error === "string"
      ? error.slice(0, 500)
      : "Offering Monitor Alert write failed";
}

function requireUuid(value: string, label: string) {
  const normalized = stringValue(value);
  if (!UUID_PATTERN.test(normalized)) throw new Error(`${label} must be a UUID`);
  return normalized;
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(record) : [];
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function integerId(value: unknown) {
  const candidate = typeof value === "number" ? String(value) : stringValue(value);
  return /^(?:0|[1-9]\d*)$/.test(candidate) ? candidate : "";
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
