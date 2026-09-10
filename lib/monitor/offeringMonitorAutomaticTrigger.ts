import type { DilutionRegistryPayload } from "../dilution-registry/preview.ts";
import {
  consumeOfferingMonitorAlertsForEvent,
  type OfferingMonitorAlertConsumerResult,
} from "./offeringMonitorAlertConsumer.ts";
import {
  readRegistryBackedOfferingFacts,
  type RegistryBackedOfferingFactReadResult,
} from "./registryBackedOfferingFacts.ts";

export const OFFERING_MONITOR_AUTOMATIC_TRIGGER_VERSION =
  "offering_monitor_automatic_trigger_v1" as const;

type RepositoryResult = Readonly<{
  ok: boolean;
  status?: number;
  data: unknown;
  error?: string;
}>;

export type OfferingMonitorAutomaticEventResult = Readonly<{
  version: typeof OFFERING_MONITOR_AUTOMATIC_TRIGGER_VERSION;
  status: "completed" | "deferred";
  eventId: string;
  readerStatus: RegistryBackedOfferingFactReadResult["status"];
  readerReason?: string;
  consumer?: OfferingMonitorAlertConsumerResult;
}>;

export type OfferingMonitorAutomaticTriggerDependencies = Readonly<{
  readFacts(eventId: string): Promise<RegistryBackedOfferingFactReadResult>;
  consume(input: Readonly<{
    eventId: string;
    preloadedFacts: RegistryBackedOfferingFactReadResult;
  }>): Promise<OfferingMonitorAlertConsumerResult>;
}>;

export type OfferingMonitorRegistryTriggerDependencies = Readonly<{
  listEventsByAccession(accession: string): Promise<RepositoryResult>;
  runEvent(input: Readonly<{ eventId: string }>): Promise<OfferingMonitorAutomaticEventResult>;
}>;

const defaultEventDependencies: OfferingMonitorAutomaticTriggerDependencies = {
  readFacts: readRegistryBackedOfferingFacts,
  consume: (input) => consumeOfferingMonitorAlertsForEvent(input),
};

/**
 * Runs only after an Event exists. Missing Registry data is a safe deferred
 * state because a later Registry Apply invokes the symmetric trigger.
 */
export async function runOfferingMonitorAutomaticTriggerForEvent(
  input: Readonly<{ eventId: string }>,
  dependencies: OfferingMonitorAutomaticTriggerDependencies = defaultEventDependencies,
): Promise<OfferingMonitorAutomaticEventResult> {
  const facts = await dependencies.readFacts(input.eventId);
  if (facts.status === "not_ready") {
    if (facts.reason === "registry_event_missing") {
      return {
        version: OFFERING_MONITOR_AUTOMATIC_TRIGGER_VERSION,
        status: "deferred",
        eventId: input.eventId,
        readerStatus: facts.status,
        readerReason: facts.reason,
      };
    }
    throw new Error(`Registry-backed Offering facts are not ready: ${facts.reason}`);
  }

  const consumer = await dependencies.consume({
    eventId: input.eventId,
    preloadedFacts: facts,
  });
  if (consumer.status === "partial_failure") {
    throw new Error(
      `Registry-backed Offering Alert persistence failed for ${consumer.failedCount} monitor(s)`,
    );
  }
  return {
    version: OFFERING_MONITOR_AUTOMATIC_TRIGGER_VERSION,
    status: "completed",
    eventId: input.eventId,
    readerStatus: facts.status,
    ...(facts.mappingStatus === "unmappable" ? { readerReason: facts.reason } : {}),
    consumer,
  };
}

/**
 * Registry Apply/update side of the two-order trigger. Only snapshot source
 * accessions can back the current adapter, so issuer totals/activity do not
 * cause broad or issuer-current evaluations.
 */
export async function runOfferingMonitorAutomaticTriggerForRegistryPayload(
  input: Readonly<{ payload: DilutionRegistryPayload }>,
  dependencies?: OfferingMonitorRegistryTriggerDependencies,
) {
  const issuerCik = exactCik(input.payload.issuer?.issuer_cik);
  if (!issuerCik) throw new Error("Dilution Registry issuer CIK is unavailable");
  const accessions = registrySnapshotAccessions(input.payload);
  const resolved = dependencies || await defaultRegistryDependencies();
  const eventIds = new Set<string>();

  for (const accession of accessions) {
    const result = await resolved.listEventsByAccession(accession);
    if (!result.ok) {
      throw new Error(result.error || `Offering Event lookup failed: HTTP ${result.status || 0}`);
    }
    for (const row of rows(result.data)) {
      if (
        stringValue(row.source_code) !== "sec_edgar"
        || stringValue(row.source_group) !== "filings"
        || stringValue(row.event_type) !== "offering"
        || exactAccession(record(row.metadata)?.accession_number) !== accession
      ) {
        throw new Error("Offering Event lookup returned an identity-mismatched row");
      }
      const eventId = stringValue(row.id);
      if (!UUID_PATTERN.test(eventId)) {
        throw new Error("Offering Event lookup returned an invalid Event id");
      }
      eventIds.add(eventId);
    }
  }

  const executions: OfferingMonitorAutomaticEventResult[] = [];
  for (const eventId of [...eventIds].sort()) {
    executions.push(await resolved.runEvent({ eventId }));
  }
  return {
    version: OFFERING_MONITOR_AUTOMATIC_TRIGGER_VERSION,
    status: "completed" as const,
    issuerCik,
    accessions,
    eventIds: [...eventIds].sort(),
    executions,
  };
}

export function registrySnapshotAccessions(payload: DilutionRegistryPayload) {
  return [...new Set(payload.snapshots
    .map((snapshot) => exactAccession(snapshot.source_accession))
    .filter(Boolean))].sort();
}

async function defaultRegistryDependencies(): Promise<OfferingMonitorRegistryTriggerDependencies> {
  const repository = await import("../supabase.ts");
  return {
    listEventsByAccession: (accession) => repository.supabaseSelect("events", {
      select: "id,source_code,source_group,event_type,metadata",
      source_code: "eq.sec_edgar",
      source_group: "eq.filings",
      event_type: "eq.offering",
      "metadata->>accession_number": `eq.${accession}`,
      order: "id.asc",
      limit: "100",
    }),
    runEvent: runOfferingMonitorAutomaticTriggerForEvent,
  };
}

function rows(value: unknown) {
  return Array.isArray(value)
    ? value.map(record).filter((row): row is Record<string, unknown> => row !== null)
    : [];
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function exactAccession(value: unknown) {
  const candidate = stringValue(value);
  return ACCESSION_PATTERN.test(candidate) ? candidate : "";
}

function exactCik(value: unknown) {
  const candidate = stringValue(value);
  return CIK_PATTERN.test(candidate) && candidate !== "0000000000" ? candidate : "";
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCESSION_PATTERN = /^\d{10}-\d{2}-\d{6}$/;
const CIK_PATTERN = /^\d{10}$/;
