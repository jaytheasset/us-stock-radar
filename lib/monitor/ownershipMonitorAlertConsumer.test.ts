import assert from "node:assert/strict";
import test from "node:test";
import { consumeListingMonitorAlertsForEvent } from "./listingMonitorAlertConsumer.ts";
import type { CurrentOwnershipReadResult } from "./ownershipMonitorPersistence.ts";

const eventId = "22222222-2222-4222-8222-222222222222";
const monitorId = "44444444-4444-4444-8444-444444444444";
const userId = "55555555-5555-4555-8555-555555555555";

test("Ownership consumer reads canonical rows once and replay creates no duplicate output", async () => {
  let reads = 0;
  const writes = new Set<string>();
  const dependencies = {
    readFacts: async () => ({ status: "not_ready", reason: "reader_not_requested" } as const),
    readCorporateActionFacts: async () => ({ status: "not_ready", reason: "reader_not_requested" } as const),
    readOwnershipFacts: async () => {
      reads += 1;
      return form4Current();
    },
    listActiveMonitors: async () => ({
      diagnostics: [],
      monitors: [{
        id: monitorId,
        userId,
        domain: "listing" as const,
        isActive: true,
        createdAt: "2026-05-13T00:00:00.000Z",
        updatedAt: "2026-05-13T00:00:00.000Z",
        conditions: [
          { key: "ownership.form4.transaction_code", operator: "eq" as const, value: "P" },
          { key: "ownership.form4.shares", operator: "gte" as const, value: 1_000 },
        ],
      }],
    }),
    createAlert: async (input: { monitorId: string; eventId: string }) => {
      const key = `${input.monitorId}:${input.eventId}`;
      if (writes.has(key)) return { status: "existing" as const, monitorId: input.monitorId };
      writes.add(key);
      return { status: "created" as const, monitorId: input.monitorId };
    },
    now: () => new Date("2026-05-13T12:00:00.000Z"),
  };

  const first = await consumeListingMonitorAlertsForEvent({ eventId }, dependencies);
  const replay = await consumeListingMonitorAlertsForEvent({ eventId }, dependencies);

  assert.equal(reads, 2, "one canonical Ownership read per event attempt");
  assert.equal(first.ownershipReaderStatus, "available");
  assert.equal(first.evaluations[0].status, "match");
  assert.equal(first.createdCount, 1);
  assert.equal(replay.existingCount, 1);
  assert.equal(writes.size, 1);
});

function form4Current(): CurrentOwnershipReadResult {
  return {
    status: "available",
    form: "form4",
    eventId,
    rawItemId: "33333333-3333-4333-8333-333333333333",
    sourceExecutionId: eventId,
    accessionNumber: "0001493152-26-023264",
    parserVersion: "ownership-parser-v1",
    persistedAt: "2026-05-13T00:00:00.000Z",
    rows: [{
      event_id: eventId,
      transaction_index: 0,
      symbol: "XXII",
      transaction_code: "P",
      shares: 1_050,
      shares_value_quality: "exact",
      shares_availability: "available",
      provenance: { reporting_owner_scope: "single_filing_owner" },
    }],
  };
}
