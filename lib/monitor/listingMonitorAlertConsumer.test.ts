import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  consumeListingMonitorAlertsForEvent,
  type ListingMonitorAlertConsumerDependencies,
} from "./listingMonitorAlertConsumer.ts";
import type {
  ListingMonitor,
  ListingMonitorDiagnostic,
} from "./listingMonitorPersistence.ts";
import type { CurrentListingRiskReadResult } from "./listingRiskPersistence.ts";

const EVENT_ID = "29f5fe0d-8171-458c-bfb0-baacb6495e13";
const SOURCE_EXECUTION_ID = "5323aa52-5944-5877-99b0-c9f74ba6d98c";
const OTHER_SOURCE_EXECUTION_ID = "696bc839-6355-57e8-a758-98954c23acb6";
const OWNER_ID = "a2000000-0000-4000-8000-000000000001";

test("MATCH creates once, retry dedupes, and NO_MATCH/INELIGIBLE/invalid monitors create nothing", async () => {
  const harness = consumerHarness();
  const first = await consumeListingMonitorAlertsForEvent({ eventId: EVENT_ID }, harness.dependencies);
  const replay = await consumeListingMonitorAlertsForEvent({ eventId: EVENT_ID }, harness.dependencies);

  assert.equal(harness.reads(), 2, "one official read per source processing attempt");
  assert.deepEqual(first.evaluations.map((item) => item.status), ["match", "no_match", "ineligible"]);
  assert.deepEqual(first.diagnostics, [invalidDiagnostic()]);
  assert.deepEqual([first.createdCount, first.existingCount, first.failedCount], [1, 0, 0]);
  assert.deepEqual([replay.createdCount, replay.existingCount, replay.failedCount], [0, 1, 0]);
  assert.equal(harness.alertCount(), 1);
  assert.equal(first.sourceExecutionId, SOURCE_EXECUTION_ID);
  assert.equal(first.evaluationDate, "2026-08-14");
});

test("same monitor and canonical event dedupes across different source executions", async () => {
  const harness = consumerHarness({
    sourceExecutionIds: [SOURCE_EXECUTION_ID, OTHER_SOURCE_EXECUTION_ID],
  });
  const first = await consumeListingMonitorAlertsForEvent({ eventId: EVENT_ID }, harness.dependencies);
  const reanalysis = await consumeListingMonitorAlertsForEvent({ eventId: EVENT_ID }, harness.dependencies);

  assert.equal(first.sourceExecutionId, SOURCE_EXECUTION_ID);
  assert.equal(reanalysis.sourceExecutionId, OTHER_SOURCE_EXECUTION_ID);
  assert.deepEqual([first.createdCount, first.existingCount], [1, 0]);
  assert.deepEqual([reanalysis.createdCount, reanalysis.existingCount], [0, 1]);
  assert.equal(harness.alertCount(), 1);
});

test("not-applicable and reader-unavailable results remain literal INELIGIBLE outcomes", async () => {
  const base = consumerHarness();
  const notApplicable = await consumeListingMonitorAlertsForEvent({ eventId: EVENT_ID }, {
    ...base.dependencies,
    readFacts: async () => {
      const current = availableCurrent();
      const { facts: _facts, factSchemaVersion: _version, status: _status, ...lineage } = current;
      return { status: "not_applicable", ...lineage };
    },
  });
  assert.ok(notApplicable.evaluations.every((item) => item.status === "ineligible"));
  assert.equal(notApplicable.writes.length, 0);

  const unavailable = await consumeListingMonitorAlertsForEvent({ eventId: EVENT_ID }, {
    ...base.dependencies,
    readFacts: async () => { throw new Error("offline"); },
  });
  assert.ok(unavailable.evaluations.every((item) => item.reasonCode === "reader_unavailable"));
  assert.equal(unavailable.writes.length, 0);
});

test("one Alert insert failure is reported and does not block another matching monitor", async () => {
  const harness = consumerHarness({ secondMatch: true, failFirstWrite: true });
  const result = await consumeListingMonitorAlertsForEvent({ eventId: EVENT_ID }, harness.dependencies);
  assert.equal(result.status, "partial_failure");
  assert.deepEqual(result.writes.map((write) => write.status), ["failed", "created"]);
  assert.equal(result.failedCount, 1);
  assert.equal(result.createdCount, 1);
});

test("consumer boundary has no provider, parser, Primary, provenance, legacy, or delivery execution dependency", () => {
  const source = readFileSync(new URL("./listingMonitorAlertConsumer.ts", import.meta.url), "utf8");
  for (const forbidden of [
    "Gemini",
    "runAnalyzer",
    "parser",
    "primary_analysis",
    "ai_runs",
    "fact_provenance",
    "evidence",
    "Telegram",
    "Email",
    "Web push",
  ]) {
    assert.equal(source.toLowerCase().includes(forbidden.toLowerCase()), false, forbidden);
  }
});

test("evaluation date preserves Matcher V1 runtime moving-window semantics", async () => {
  const harness = consumerHarness();
  const result = await consumeListingMonitorAlertsForEvent({ eventId: EVENT_ID }, {
    ...harness.dependencies,
    now: () => new Date("2026-08-20T23:59:59.000Z"),
  });
  assert.equal(result.evaluationDate, "2026-08-20");
});

test("existing delivery worker claim predicates cannot select Listing internal Alerts", () => {
  const worker = readFileSync(new URL("../alerts/delivery/processQueuedDeliveries.ts", import.meta.url), "utf8");
  const migration = readFileSync(
    new URL("../../supabase/migrations/20260813211146_listing_monitor_alert_e2e_v1.sql", import.meta.url),
    "utf8",
  );
  assert.match(worker, /delivery_status:\s*"eq\.queued"/);
  assert.match(worker, /scheduled_for:\s*`lte\.\$\{new Date\(\)\.toISOString\(\)\}`/);
  assert.match(worker, /for \(const channel of new Set\(row\.delivered_channels\)\)/);
  assert.match(migration, /delivered_channels = array\[\]::text\[\]/);
  assert.match(migration, /scheduled_for is null/);
});

function consumerHarness(options: {
  secondMatch?: boolean;
  failFirstWrite?: boolean;
  sourceExecutionIds?: string[];
} = {}) {
  let reads = 0;
  let writeAttempts = 0;
  const alerts = new Set<string>();
  const monitors = [
    monitor("a2000000-0000-4000-8000-000000000011", [
      { key: "listing.event_kind", operator: "eq", value: "deficiency_notice" },
      { key: "listing.event_outcome", operator: "eq", value: "adverse" },
    ]),
    monitor("a2000000-0000-4000-8000-000000000012", [{
      key: "listing.event_kind",
      operator: "eq",
      value: options.secondMatch ? "deficiency_notice" : "compliance_recovery",
    }]),
    monitor("a2000000-0000-4000-8000-000000000013", [{
      key: "listing.appeal_deadline",
      operator: "eq",
      value: "2026-08-20",
    }]),
  ] satisfies ListingMonitor[];

  const dependencies: ListingMonitorAlertConsumerDependencies = {
    readFacts: async () => {
      const sourceExecutionId = options.sourceExecutionIds?.[reads] ?? SOURCE_EXECUTION_ID;
      reads += 1;
      return availableCurrent(sourceExecutionId);
    },
    listActiveMonitors: async () => ({ monitors, diagnostics: [invalidDiagnostic()] }),
    createAlert: async (input) => {
      writeAttempts += 1;
      if (options.failFirstWrite && writeAttempts === 1) {
        return { status: "failed", monitorId: input.monitorId, error: "fake insert failure" };
      }
      const key = `${input.monitorId}:${input.eventId}`;
      if (alerts.has(key)) return { status: "existing", monitorId: input.monitorId };
      alerts.add(key);
      return { status: "created", monitorId: input.monitorId, alertId: input.monitorId };
    },
    now: () => new Date("2026-08-14T00:00:00.000Z"),
  };
  return { dependencies, reads: () => reads, alertCount: () => alerts.size };
}

function monitor(id: string, conditions: ListingMonitor["conditions"]): ListingMonitor {
  return {
    id,
    userId: OWNER_ID,
    domain: "listing",
    conditions,
    isActive: true,
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z",
  };
}

function invalidDiagnostic(): ListingMonitorDiagnostic {
  return {
    id: "a2000000-0000-4000-8000-000000000099",
    reason: "stored_conditions_invalid",
    errors: ["conditions[0]:condition_key_unknown"],
  };
}

function availableCurrent(
  sourceExecutionId = SOURCE_EXECUTION_ID,
): Extract<CurrentListingRiskReadResult, { status: "available" }> {
  return {
    status: "available",
    eventId: EVENT_ID,
    rawItemId: "a2000000-0000-4000-8000-000000000002",
    parentPrimaryAiRunId: "a2000000-0000-4000-8000-000000000003",
    sourceExecutionId,
    monitorAnalyzerKey: "listing_risk",
    analyzerContractVersion: "listing_risk_domain_analyzer_v11",
    persistedAt: "2026-08-13T18:57:34.542648Z",
    factSchemaVersion: "listing_risk_event_facts_v2",
    facts: {
      classification: { event_kind: "deficiency_notice", event_outcome: "adverse" },
      dates: {
        appeal_deadline: {
          value: null,
          availability: "unavailable",
          value_quality: "unknown",
          date_status: "unknown",
        },
      },
    } as never,
  };
}
