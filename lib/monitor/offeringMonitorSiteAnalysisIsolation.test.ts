import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildOfferingMonitorJobIdentity,
  enqueueOfferingMonitorJobWithDependencies,
} from "../offeringMonitorJobFoundation.ts";
import type { OfferingMonitorAlertConsumerResult } from "./offeringMonitorAlertConsumer.ts";
import {
  runOfferingMonitorAutomaticTriggerForEvent,
  type OfferingMonitorAutomaticEventResult,
} from "./offeringMonitorAutomaticTrigger.ts";
import type { RegistryBackedOfferingFactReadResult } from "./registryBackedOfferingFacts.ts";
import { runOfferingMonitorSiteAnalysisExecution } from "./offeringMonitorSiteAnalysisIsolation.ts";

const EVENT_ID = "c2000000-0000-4000-8000-000000000003";
const RAW_ITEM_ID = "d2000000-0000-4000-8000-000000000004";
const PRIMARY_RUN_ID = "e2000000-0000-4000-8000-000000000005";
const ACCESSION = "0001213900-26-088706";

const failures = [
  {
    name: "Registry lookup failure",
    expected: /reader_unavailable/,
    run: () => runOfferingMonitorAutomaticTriggerForEvent({ eventId: EVENT_ID }, {
      readFacts: async () => notReady("reader_unavailable"),
      consume: async () => completedConsumer(),
    }),
  },
  {
    name: "identity mismatch",
    expected: /event_identity_mismatch/,
    run: () => runOfferingMonitorAutomaticTriggerForEvent({ eventId: EVENT_ID }, {
      readFacts: async () => notReady("event_identity_mismatch"),
      consume: async () => completedConsumer(),
    }),
  },
  {
    name: "Alert persistence failure",
    expected: /Alert persistence failed/,
    run: () => runOfferingMonitorAutomaticTriggerForEvent({ eventId: EVENT_ID }, {
      readFacts: async () => mappedFacts(),
      consume: async () => ({
        ...completedConsumer(),
        status: "partial_failure",
        failedCount: 1,
      }),
    }),
  },
] as const;

for (const failure of failures) {
  test(`${failure.name} leaves site analysis successful, sidecar enqueueable, and Monitor retryable`, async () => {
    let attempts = 0;
    const reported: string[] = [];
    const firstExecution = await runOfferingMonitorSiteAnalysisExecution(
      { eventId: EVENT_ID },
      {
        run: async () => {
          attempts += 1;
          return failure.run();
        },
        reportFailure: (result) => reported.push(result.error),
      },
    );
    assert.equal(firstExecution.status, "failed");
    if (firstExecution.status !== "failed") return;
    assert.match(firstExecution.error, failure.expected);
    assert.deepEqual(reported, [firstExecution.error]);

    const siteAnalysis = completedSiteAnalysis(firstExecution);
    assert.deepEqual([siteAnalysis.ok, siteAnalysis.stage], [true, "complete"]);

    const identity = buildOfferingMonitorJobIdentity(siteAnalysis, {
      now: "2026-09-10T00:00:00.000Z",
    });
    assert.ok(identity, "a separate Monitor failure must not suppress Offering O/S sidecar identity");
    const enqueueCalls: string[] = [];
    const sidecar = await enqueueOfferingMonitorJobWithDependencies(identity, {
      reserveJob: async () => {
        enqueueCalls.push("reserve");
        return { reserved: true, jobId: identity.jobId };
      },
      startWorkflow: async () => {
        enqueueCalls.push("start");
        return { runId: "offering-os-sidecar-run" };
      },
      attachWorkflowRun: async () => {
        enqueueCalls.push("attach");
      },
      markFailed: async () => {
        enqueueCalls.push("failed");
      },
    });
    assert.equal(sidecar.status, "enqueued");
    assert.deepEqual(enqueueCalls, ["reserve", "start", "attach"]);

    const retry = await runOfferingMonitorSiteAnalysisExecution(
      { eventId: EVENT_ID },
      {
        run: async () => {
          attempts += 1;
          return completedAutomaticExecution();
        },
        reportFailure: (result) => reported.push(result.error),
      },
    );
    assert.equal(retry.status, "completed");
    assert.equal(attempts, 2);
    assert.equal(reported.length, 1);
  });
}

test("product order keeps O/S sidecar work ahead of the isolated Monitor result", () => {
  const ingest = readFileSync(new URL("../secFilingAnalysisIngest.ts", import.meta.url), "utf8");
  const route = readFileSync(
    new URL("../../app/api/sources/sec/analyze/route.ts", import.meta.url),
    "utf8",
  );
  assert.ok(
    ingest.indexOf("const genericMonitorChildren = await")
      < ingest.indexOf("const offeringMonitorRegistryExecution ="),
  );
  assert.match(ingest, /await runOfferingMonitorSiteAnalysisExecution/);
  assert.ok(
    route.indexOf("await runSecFilingAnalysisIngest")
      < route.indexOf("await enqueueOfferingMonitorAfterPrimary"),
  );
  assert.match(route, /status: result\.ok \? 200/);
});

function completedSiteAnalysis(offeringMonitorRegistryExecution: unknown) {
  return {
    ok: true,
    stage: "complete",
    event: { id: EVENT_ID },
    sourceItem: {
      id: RAW_ITEM_ID,
      source_unique_id: ACCESSION,
      form_type: "424B5",
    },
    input: {
      filing_package: {
        accession_number: ACCESSION,
        form_type: "424B5",
      },
    },
    prompt: { key: "sec_424b_analysis", version: "test-v1" },
    primaryAiRunId: PRIMARY_RUN_ID,
    offeringMonitorRegistryExecution,
  };
}

function notReady(
  reason: Extract<RegistryBackedOfferingFactReadResult, { status: "not_ready" }>["reason"],
): RegistryBackedOfferingFactReadResult {
  return { status: "not_ready", version: "registry_backed_offering_fact_adapter_v1", reason };
}

function mappedFacts(): RegistryBackedOfferingFactReadResult {
  return {
    status: "available",
    version: "registry_backed_offering_fact_adapter_v1",
    mappingStatus: "mapped",
    eventId: EVENT_ID,
    rawItemId: RAW_ITEM_ID,
    issuerCik: "0001840317",
    accession: ACCESSION,
    registrySnapshotId: "41",
    registrySourceIdentity: `registry:${ACCESSION}:41`,
    canonical: {} as never,
    materialized: {} as never,
  };
}

function completedConsumer(): OfferingMonitorAlertConsumerResult {
  return {
    version: "offering_monitor_alert_consumer_v1",
    status: "completed",
    eventId: EVENT_ID,
    readerStatus: "available",
    monitorCount: 0,
    diagnostics: [],
    evaluations: [],
    writes: [],
    createdCount: 0,
    existingCount: 0,
    failedCount: 0,
  };
}

function completedAutomaticExecution(): OfferingMonitorAutomaticEventResult {
  return {
    version: "offering_monitor_automatic_trigger_v1",
    status: "completed",
    eventId: EVENT_ID,
    readerStatus: "available",
    consumer: completedConsumer(),
  };
}
