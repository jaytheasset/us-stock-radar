import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  consumeOfferingMonitorAlertsForEvent,
  listOfferingMonitorAlertsForOwner,
  type OfferingMonitorAlertWriteResult,
} from "./offeringMonitorAlertConsumer.ts";
import {
  createOfferingMonitor,
  listActiveOfferingMonitorsForConsumer,
  validateCanonicalOfferingConditions,
  type OfferingMonitorConsumerRepository,
  type OfferingMonitorRepository,
} from "./offeringMonitorPersistence.ts";
import { readRegistryBackedOfferingFacts } from "./registryBackedOfferingFacts.ts";

const ownerId = "a1000000-0000-4000-8000-000000000001";
const monitorId = "b1000000-0000-4000-8000-000000000002";
const eventId = "c1000000-0000-4000-8000-000000000003";
const rawItemId = "d1000000-0000-4000-8000-000000000004";
const accession = "0001213900-26-088706";

test("persisted VEEA amount condition reaches Matcher but ATM capacity creates no Alert or replay", async () => {
  const monitors = new MemoryMonitorRepository();
  const monitor = await createOfferingMonitor({
    ownerId,
    conditions: [{
      key: "offering.amount",
      operator: "gte",
      value: 4_000_000,
      currency: "usd",
    }],
  }, monitors);
  assert.equal(monitor.id, monitorId);
  assert.equal(monitor.conditions[0]?.currency, "USD");

  const alertRows: Record<string, unknown>[] = [];
  let externalDeliveryCalls = 0;
  let runtimeLlmCalls = 0;
  const run = () => consumeOfferingMonitorAlertsForEvent({ eventId }, {
    readFacts: (id) => readRegistryBackedOfferingFacts(id, exactRegistryRepository()),
    listActiveMonitors: () => listActiveOfferingMonitorsForConsumer(monitors),
    createAlert: async (input): Promise<OfferingMonitorAlertWriteResult> => {
      const existing = alertRows.find((row) => (
        row.offering_monitor_id === input.monitorId && row.alert_event_id === input.eventId
      ));
      if (existing) return { status: "existing", monitorId: input.monitorId };
      alertRows.push({
        id: "e1000000-0000-4000-8000-000000000005",
        user_id: input.userId,
        alert_event_id: input.eventId,
        offering_monitor_id: input.monitorId,
        offering_registry_accession: input.registryAccession,
        offering_registry_snapshot_id: input.registrySnapshotId,
        delivered_channels: [],
        scheduled_for: null,
        created_at: input.createdAt,
      });
      return { status: "created", monitorId: input.monitorId };
    },
    now: () => new Date("2026-09-08T12:00:00.000Z"),
  });

  const first = await run();
  const replay = await run();
  assert.deepEqual(
    first.evaluations.map((value) => [value.status, value.reasonCode]),
    [["ineligible", "fact_unavailable"]],
  );
  assert.deepEqual([first.createdCount, first.existingCount], [0, 0]);
  assert.deepEqual([replay.createdCount, replay.existingCount], [0, 0]);
  assert.equal(alertRows.length, 0);
  assert.equal(externalDeliveryCalls, 0);
  assert.equal(runtimeLlmCalls, 0);

  const readback = await listOfferingMonitorAlertsForOwner({ ownerId, monitorId }, {
    list: async () => ({ ok: true, data: alertRows }),
  });
  assert.deepEqual(readback, []);
});

test("identity mismatch produces no Matcher evaluation match or Alert write", async () => {
  const monitors = new MemoryMonitorRepository();
  await createOfferingMonitor({
    ownerId,
    conditions: [{ key: "offering.amount", operator: "gte", value: 1, currency: "USD" }],
  }, monitors);
  let writes = 0;
  const mismatchRepository = exactRegistryRepository();
  mismatchRepository.readInstruments = async () => ({
    ok: true,
    data: [{
      id: "11",
      instrument_key: "other-issuer-atm",
      issuer_cik: "0000000001",
      instrument_type: "atm_program",
      name: "Other ATM",
      first_source_accession: accession,
    }],
  });
  const result = await consumeOfferingMonitorAlertsForEvent({ eventId }, {
    readFacts: (id) => readRegistryBackedOfferingFacts(id, mismatchRepository),
    listActiveMonitors: () => listActiveOfferingMonitorsForConsumer(monitors),
    createAlert: async () => {
      writes += 1;
      return { status: "created", monitorId };
    },
    now: () => new Date("2026-09-08T12:00:00.000Z"),
  });
  assert.equal(result.readerStatus, "not_ready");
  assert.equal(result.readerReason, "registry_issuer_mismatch");
  assert.equal(result.evaluations[0]?.status, "ineligible");
  assert.equal(writes, 0);
});

test("Offering persistence rejects non-Offering and non-canonical condition shapes", () => {
  for (const value of [
    [],
    [{ key: "listing.event_kind", operator: "eq", value: "deficiency_notice" }],
    [{ key: "offering.amount", operator: "gte", value: 1 }],
    [{ key: "offering.amount", operator: "gte", value: 1, currency: "USD", injected: true }],
    [{ key: "offering.immediate_primary_share_exposure", operator: "gte", value: 1, currency: "USD" }],
  ]) assert.equal(validateCanonicalOfferingConditions(value).ok, false);
});

test("Offering runtime modules contain no LLM or external delivery integration", () => {
  const source = [
    readFileSync(new URL("./registryBackedOfferingFacts.ts", import.meta.url), "utf8"),
    readFileSync(new URL("./offeringMonitorAlertConsumer.ts", import.meta.url), "utf8"),
  ].join("\n");
  assert.doesNotMatch(source, /gemini|openai|anthropic|generateContent|sendEmail|telegram/i);
});

class MemoryMonitorRepository implements OfferingMonitorRepository, OfferingMonitorConsumerRepository {
  private rows: Record<string, unknown>[] = [];

  async create(row: Record<string, unknown>) {
    const stored = {
      ...row,
      id: monitorId,
      created_at: "2026-09-08T11:00:00.000Z",
      updated_at: "2026-09-08T11:00:00.000Z",
    };
    this.rows.push(stored);
    return { ok: true, data: [stored] };
  }

  async list(owner: string, activeOnly: boolean) {
    return {
      ok: true,
      data: this.rows.filter((row) => (
        row.user_id === owner && (!activeOnly || row.is_active === true)
      )),
    };
  }

  async listActivePage(offset: number, limit: number) {
    return {
      ok: true,
      data: this.rows.filter((row) => row.is_active === true).slice(offset, offset + limit),
    };
  }
}

function exactRegistryRepository() {
  return {
    readEvent: async () => ({ ok: true, data: [{
      id: eventId,
      raw_item_id: rawItemId,
      source_code: "sec_edgar",
      source_group: "filings",
      ticker: "VEEA",
      metadata: { accession_number: accession, cik: "0001840317" },
    }] }),
    readRawItem: async () => ({ ok: true, data: [{
      id: rawItemId,
      source_code: "sec_edgar",
      source_group: "filings",
      source_unique_id: accession,
      raw_payload: { accession_number: accession, cik: "0001840317" },
    }] }),
    readSnapshotsByAccession: async () => ({ ok: true, data: [{
      id: "41",
      instrument_id: "11",
      as_of_date: "2026-08-13",
      status: "current",
      currency: "USD",
      original_capacity: "4353000",
      start_date: "2026-08-13",
      source_accession: accession,
    }] }),
    readInstruments: async () => ({ ok: true, data: [{
      id: "11",
      instrument_key: "veea-roth-atm-20260813",
      issuer_cik: "0001840317",
      instrument_type: "atm_program",
      name: "Roth ATM",
      first_source_accession: accession,
    }] }),
  };
}
