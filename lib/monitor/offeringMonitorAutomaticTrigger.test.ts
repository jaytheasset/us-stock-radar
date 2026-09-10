import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { DilutionRegistryPayload } from "../dilution-registry/preview.ts";
import type { OfferingMonitorAlertConsumerResult } from "./offeringMonitorAlertConsumer.ts";
import {
  runOfferingMonitorAutomaticTriggerForEvent,
  runOfferingMonitorAutomaticTriggerForRegistryPayload,
  registrySnapshotAccessions,
} from "./offeringMonitorAutomaticTrigger.ts";
import type { RegistryBackedOfferingFactReadResult } from "./registryBackedOfferingFacts.ts";

const EVENT_A = "c1000000-0000-4000-8000-000000000003";
const EVENT_B = "c1000000-0000-4000-8000-000000000004";
const ACCESSION_A = "0001213900-26-088706";
const ACCESSION_B = "0001213900-26-088707";

test("Event-first execution defers without loading stored monitors until Registry facts exist", async () => {
  let consumes = 0;
  const result = await runOfferingMonitorAutomaticTriggerForEvent({ eventId: EVENT_A }, {
    readFacts: async () => notReady("registry_event_missing"),
    consume: async () => {
      consumes += 1;
      return completedConsumer(EVENT_A);
    },
  });
  assert.deepEqual(result, {
    version: "offering_monitor_automatic_trigger_v1",
    status: "deferred",
    eventId: EVENT_A,
    readerStatus: "not_ready",
    readerReason: "registry_event_missing",
  });
  assert.equal(consumes, 0);
});

test("Registry-ready Event execution passes exact preloaded facts to the existing consumer", async () => {
  const facts = mappedFacts(EVENT_A);
  const seen: unknown[] = [];
  const result = await runOfferingMonitorAutomaticTriggerForEvent({ eventId: EVENT_A }, {
    readFacts: async (eventId) => {
      assert.equal(eventId, EVENT_A);
      return facts;
    },
    consume: async (input) => {
      seen.push(input);
      return completedConsumer(EVENT_A, 1);
    },
  });
  assert.equal(result.status, "completed");
  assert.equal(result.consumer?.createdCount, 1);
  assert.deepEqual(seen, [{ eventId: EVENT_A, preloadedFacts: facts }]);
});

test("reader outages and partial Alert writes remain retryable failures", async () => {
  await assert.rejects(
    () => runOfferingMonitorAutomaticTriggerForEvent({ eventId: EVENT_A }, {
      readFacts: async () => notReady("reader_unavailable"),
      consume: async () => completedConsumer(EVENT_A),
    }),
    /reader_unavailable/,
  );
  await assert.rejects(
    () => runOfferingMonitorAutomaticTriggerForEvent({ eventId: EVENT_A }, {
      readFacts: async () => notReady("event_identity_mismatch"),
      consume: async () => completedConsumer(EVENT_A),
    }),
    /event_identity_mismatch/,
  );
  await assert.rejects(
    () => runOfferingMonitorAutomaticTriggerForEvent({ eventId: EVENT_A }, {
      readFacts: async () => mappedFacts(EVENT_A),
      consume: async () => ({
        ...completedConsumer(EVENT_A),
        status: "partial_failure",
        failedCount: 1,
      }),
    }),
    /persistence failed for 1 monitor/,
  );
});

test("Registry Apply evaluates only unique exact snapshot accessions and exact returned Events", async () => {
  const payload = registryPayload();
  assert.deepEqual(registrySnapshotAccessions(payload), [ACCESSION_A, ACCESSION_B]);
  const lookups: string[] = [];
  const runs: string[] = [];
  const result = await runOfferingMonitorAutomaticTriggerForRegistryPayload({ payload }, {
    listEventsByAccession: async (accession) => {
      lookups.push(accession);
      const ids = accession === ACCESSION_A ? [EVENT_A, EVENT_A] : [EVENT_B];
      return {
        ok: true,
        data: ids.map((id) => ({
          id,
          source_code: "sec_edgar",
          source_group: "filings",
          event_type: "offering",
          metadata: { accession_number: accession, cik: "1840317" },
        })),
      };
    },
    runEvent: async ({ eventId }) => {
      runs.push(eventId);
      return {
        version: "offering_monitor_automatic_trigger_v1",
        status: "deferred",
        eventId,
        readerStatus: "not_ready",
        readerReason: "registry_event_missing",
      };
    },
  });
  assert.deepEqual(lookups, [ACCESSION_A, ACCESSION_B]);
  assert.deepEqual(runs, [EVENT_A, EVENT_B]);
  assert.deepEqual(result.eventIds, [EVENT_A, EVENT_B]);
  assert.equal(result.issuerCik, "0001840317");
});

test("Registry lookup failures and mismatched rows fail instead of losing the trigger", async () => {
  const payload = registryPayload();
  await assert.rejects(
    () => runOfferingMonitorAutomaticTriggerForRegistryPayload({ payload }, {
      listEventsByAccession: async () => ({ ok: false, status: 503, data: null }),
      runEvent: async () => { throw new Error("must not run"); },
    }),
    /HTTP 503/,
  );
  await assert.rejects(
    () => runOfferingMonitorAutomaticTriggerForRegistryPayload({ payload }, {
      listEventsByAccession: async (accession) => ({ ok: true, data: [{
        id: EVENT_A,
        source_code: "sec_edgar",
        source_group: "filings",
        event_type: "offering",
        metadata: { accession_number: accession === ACCESSION_A ? ACCESSION_B : ACCESSION_A },
      }] }),
      runEvent: async () => { throw new Error("must not run"); },
    }),
    /identity-mismatched/,
  );
});

test("product wiring covers successful/replay Apply and the later-Event ordering without reviving legacy Stage 2", () => {
  const apply = readFileSync(new URL("../dilution-registry/applyServer.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../../app/api/admin/data/dilution-registry/apply/route.ts", import.meta.url), "utf8");
  const ingest = readFileSync(new URL("../secFilingAnalysisIngest.ts", import.meta.url), "utf8");
  const trigger = readFileSync(new URL("./offeringMonitorAutomaticTrigger.ts", import.meta.url), "utf8");
  assert.match(apply, /runOfferingMonitorAutomaticTriggerForRegistryPayload/);
  assert.match(route, /result\.offeringMonitorAlerts\.status !== "failed"/);
  assert.match(ingest, /runOfferingMonitorSiteAnalysisExecution/);
  assert.doesNotMatch(ingest, /runOfferingMonitorAutomaticTriggerForEvent/);
  assert.match(ingest, /persistedEvent\.event_type\) === "offering"/);
  assert.ok(
    ingest.indexOf("const genericMonitorChildren = await")
      < ingest.indexOf("const offeringMonitorRegistryExecution ="),
  );
  assert.doesNotMatch(trigger, /gemini|openai|anthropic|generateContent|sendEmail|telegram/i);
});

function registryPayload(): DilutionRegistryPayload {
  return {
    issuer: { issuer_cik: "0001840317", ticker: "VEEA" },
    instruments: [{ instrument_key: "veea-atm", instrument_type: "atm_program" }],
    snapshots: [
      { instrument_key: "veea-atm", source_accession: ACCESSION_B },
      { instrument_key: "veea-atm", source_accession: ACCESSION_A },
      { instrument_key: "veea-atm", source_accession: ACCESSION_A },
      { instrument_key: "veea-atm", source_accession: "invalid" },
    ],
    activities: [{ source_accession: "0001213900-26-099999" }],
    totals: [{ source_accession: "0001213900-26-099998" }],
  };
}

function mappedFacts(eventId: string): RegistryBackedOfferingFactReadResult {
  return {
    status: "available",
    version: "registry_backed_offering_fact_adapter_v1",
    mappingStatus: "mapped",
    eventId,
    rawItemId: "d1000000-0000-4000-8000-000000000004",
    issuerCik: "0001840317",
    accession: ACCESSION_A,
    registrySnapshotId: "41",
    registrySourceIdentity: `registry:${ACCESSION_A}:41`,
    canonical: {} as never,
    materialized: {} as never,
  };
}

function notReady(
  reason: Extract<RegistryBackedOfferingFactReadResult, { status: "not_ready" }>["reason"],
): RegistryBackedOfferingFactReadResult {
  return { status: "not_ready", version: "registry_backed_offering_fact_adapter_v1", reason };
}

function completedConsumer(eventId: string, createdCount = 0): OfferingMonitorAlertConsumerResult {
  return {
    version: "offering_monitor_alert_consumer_v1",
    status: "completed",
    eventId,
    readerStatus: "available",
    monitorCount: createdCount,
    diagnostics: [],
    evaluations: [],
    writes: [],
    createdCount,
    existingCount: 0,
    failedCount: 0,
  };
}
