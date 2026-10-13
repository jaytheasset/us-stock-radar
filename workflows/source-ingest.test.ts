import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

type RawItem = {
  ok: boolean;
  raw_item_id: string;
  form_type: string;
  cik: string;
};

type ExecutionState = {
  items: RawItem[];
  rawFailure: boolean;
  analysisFailure: boolean;
  osFailure: boolean;
  osBaselineRequired: boolean;
  prospectusOsFailure: boolean;
  rawCalls: number;
  rawFormTypes: string[];
  rawSourceRuns: Array<Record<string, unknown>>;
  stepAttempt: number;
  workflowRunId: string;
  bridgeCalls: string[][];
  prospectusBridgeCalls: string[][];
  analysisCalls: string[];
  offeringPlanCalls: string[];
  completedEvents: Record<string, string>;
  monitorIdentityEnabled: boolean;
  monitorRegistryState: "none" | "pending" | "failed" | "completed";
  monitorRegistryRetryCalls: string[];
  monitorRegistryStateWrites: Array<{ jobId: string; status: string }>;
  monitorRegistryStateWriteFailure: boolean;
  sidecarEnqueueCalls: number;
  releaseCalls: number;
  order: string[];
};

declare global {
  var __secWorkflowExecutionState: ExecutionState | undefined;
}

const actualBridgeUrl = pathToFileURL(
  path.resolve(process.cwd(), "lib/secPeriodicOsTriggerBridge.ts"),
).href;
const actualFormsUrl = pathToFileURL(path.resolve(process.cwd(), "lib/sources/sec/forms/common/forms.ts")).href;

const mocks = new Map<string, string>([
  ["@/lib/monitor/offeringPlanTrigger", dataModule(`
    export async function consumeOfferingPlanEvent(eventId) {
      globalThis.__secWorkflowExecutionState.offeringPlanCalls.push(eventId);
      return { createdCount: 0, failedCount: 0 };
    }
  `)],
  ["workflow", dataModule(`
    export class FatalError extends Error {}
    export class RetryableError extends Error {
      constructor(message, options) { super(message); this.options = options; }
    }
    export function getStepMetadata() {
      return {
        stepId: "step_execution_test",
        attempt: globalThis.__secWorkflowExecutionState?.stepAttempt ?? 1,
      };
    }
    export function getWorkflowMetadata() {
      return {
        workflowRunId: globalThis.__secWorkflowExecutionState?.workflowRunId ?? "wrun_execution_test_123",
        workflowName: "secSourceIngestWorkflow",
        workflowStartedAt: new Date("2026-08-31T00:00:00.000Z"),
        url: "https://example.test/workflow",
      };
    }
  `)],
  ["server-only", dataModule("export {};\n")],
  ["@/lib/ingestWorkflowLock", dataModule(`
    export async function renewIngestWorkflowLock() {
      return { ok: true, renewed: true };
    }
    export async function releaseIngestWorkflowLock() {
      globalThis.__secWorkflowExecutionState.releaseCalls += 1;
      return { ok: true, released: true };
    }
  `)],
  ["@/lib/newsIngestFallbacks", dataModule(`
    export async function runAccesswireNewsIngestWithFallback() { return {}; }
    export async function runFdaNewsIngestWithFallback() { return {}; }
  `)],
  ["@/lib/newsIngest", dataModule(`
    export async function runBusinessWireNewsIngest() { return {}; }
    export async function runDeaNewsIngest() { return {}; }
    export async function runDojNewsIngest() { return {}; }
    export async function runGlobeNewsIngest() { return {}; }
    export async function runNasdaqCorporateActionsNewsIngest() { return {}; }
    export async function runNasdaqTraderNewsIngest() { return {}; }
    export async function runNewsfileNewsIngest() { return {}; }
    export async function runOfacNewsIngest() { return {}; }
    export async function runPRNewswireNewsIngest() { return {}; }
    export async function runWhiteHouseNewsIngest() { return {}; }
  `)],
  ["@/lib/secFilingAnalysisIngest", dataModule(`
    export async function runSecFilingAnalysisIngest({ rawItemId }) {
      const state = globalThis.__secWorkflowExecutionState;
      state.analysisCalls.push(rawItemId);
      state.order.push("analysis:" + rawItemId);
      if (state.analysisFailure) {
        return { ok: false, stage: "analysis", status: 500, error: "intentional analysis failure" };
      }
      const eventId = "event:" + rawItemId;
      state.completedEvents[rawItemId] = eventId;
      return {
        ok: true,
        stage: "complete",
        event: { id: eventId },
        sourceItem: { id: rawItemId, accessionNumber: "accession:" + rawItemId, formType: "S-3" },
        input: { contentSha256: "sha256:" + rawItemId },
        prompt: { key: "sec_s3_offering_analysis", version: "test" },
        primaryAiRunId: "primary:" + rawItemId,
        offeringMonitorRegistryExecution: state.monitorIdentityEnabled
          ? { status: "failed", error: "intentional Registry Monitor failure" }
          : null,
      };
    }
  `)],
  ["@/lib/secPeriodicOsTriggerBridge", dataModule(`
    export const SEC_PERIODIC_OS_TRIGGER_FORMS = ["10-Q", "10-Q/A", "10-K", "10-K/A", "20-F", "20-F/A", "40-F", "40-F/A"];
    export { extractPeriodicOsIssuerCiks } from ${JSON.stringify(actualBridgeUrl)};
    export async function runSecPeriodicOsTriggerBridge({ ciks }) {
      const state = globalThis.__secWorkflowExecutionState;
      state.bridgeCalls.push([...ciks]);
      state.order.push("os:" + ciks.join(","));
      if (state.osFailure) {
        return {
          ok: false,
          status: "failed",
          mode: "incremental",
          requestedCiks: [...ciks],
          issuerResults: [],
          failures: [{
            issuerCik: ciks[0] ?? null,
            stage: "collector",
            error: "intentional O/S collector failure",
          }],
        };
      }
      if (state.osBaselineRequired) {
        return {
          ok: true,
          status: "completed",
          mode: "incremental",
          requestedCiks: [...ciks],
          issuerResults: ciks.map((issuerCik) => ({
            issuerCik,
            status: "BASELINE_REQUIRED",
            incrementalBaseline: {
              status: "BASELINE_REQUIRED",
              cik: issuerCik,
              reason: "NO_USABLE_PERIODIC_BASELINE",
            },
          })),
          failures: [],
        };
      }
      return {
        ok: true,
        status: "completed",
        mode: "incremental",
        requestedCiks: [...ciks],
        issuerResults: ciks.map((issuerCik) => ({ issuerCik, status: "COMPLETED" })),
        failures: [],
      };
    }
  `)],
  ["@/lib/secProspectusOsTriggerBridge", dataModule(`
    export function extractProspectusOsRawItemIds(items) {
      return [...new Set(items.flatMap((item) =>
        item.ok === true && String(item.form_type).toUpperCase() === "424B4"
          && /^[0-9a-f-]{36}$/i.test(String(item.raw_item_id))
          ? [String(item.raw_item_id)] : []
      ))].sort();
    }
    export async function runSecProspectusOsTriggerBridge({ rawItemIds }) {
      const state = globalThis.__secWorkflowExecutionState;
      state.prospectusBridgeCalls.push([...rawItemIds]);
      state.order.push("prospectus-os:" + rawItemIds.join(","));
      return state.prospectusOsFailure
        ? { ok: false, status: "failed", requestedRawItemIds: [...rawItemIds], results: rawItemIds.map((rawItemId) => ({ rawItemId, persistence: "FAILED" })) }
        : { ok: true, status: "completed", requestedRawItemIds: [...rawItemIds], results: rawItemIds.map((rawItemId) => ({ rawItemId, persistence: "INSERTED" })) };
    }
  `)],
  ["@/lib/offeringMonitorJobFoundation", dataModule(`
    export function buildOfferingMonitorJobIdentity(result) {
      const state = globalThis.__secWorkflowExecutionState;
      if (!state.monitorIdentityEnabled) return null;
      const rawItemId = result.sourceItem.id;
      return {
        jobId: "job:" + rawItemId,
        eventId: result.event.id,
        rawItemId,
      };
    }
  `)],
  ["@/lib/offeringMonitorJobStarter", dataModule(`
    export async function enqueueOfferingMonitorJob(identity) {
      const state = globalThis.__secWorkflowExecutionState;
      state.sidecarEnqueueCalls += 1;
      if (state.monitorRegistryState === "none") state.monitorRegistryState = "pending";
      return { status: "enqueued", jobId: identity.jobId };
    }
  `)],
  ["@/lib/offeringMonitorJobRepository", dataModule(`
    export async function readOfferingMonitorRegistryRetryCandidate({ rawItemId }) {
      const state = globalThis.__secWorkflowExecutionState;
      return state.monitorRegistryState === "failed" || state.monitorRegistryState === "pending"
        ? { jobId: "job:" + rawItemId, state: state.monitorRegistryState }
        : null;
    }
    export async function recordOfferingMonitorRegistryExecution(jobId, execution) {
      const state = globalThis.__secWorkflowExecutionState;
      if (state.monitorRegistryStateWriteFailure) throw new Error("intentional Monitor state write failure");
      state.monitorRegistryState = execution.status === "completed"
        ? "completed"
        : execution.status === "failed" ? "failed" : "pending";
      state.monitorRegistryStateWrites.push({ jobId, status: state.monitorRegistryState });
      return { jobId, status: state.monitorRegistryState };
    }
  `)],
  ["@/lib/monitor/offeringMonitorSiteAnalysisIsolation", dataModule(`
    export async function runOfferingMonitorSiteAnalysisExecution({ eventId }) {
      const state = globalThis.__secWorkflowExecutionState;
      state.monitorRegistryRetryCalls.push(eventId);
      return { status: "completed" };
    }
  `)],
  ["@/lib/secIngest", dataModule(`
    export async function runSecRawIngest(options) {
      const state = globalThis.__secWorkflowExecutionState;
      state.rawCalls += 1;
      state.rawFormTypes = [...(options.formTypes || [])];
      state.rawSourceRuns.push(structuredClone(options.sourceRun));
      state.order.push("raw");
      if (state.rawFailure) {
        return {
          ok: false,
          stage: "raw_fetch",
          status: 500,
          error: "intentional raw failure",
          stats: {},
          items: [],
        };
      }
      return {
        ok: true,
        stage: "complete",
        runId: "source-run-execution-test",
        stats: { raw_upserted_count: state.items.length },
        items: state.items,
      };
    }
  `)],
  ["@/lib/sources/sec/forms/common/forms", dataModule(`
    export { SEC_REPORTED_HOLDING_FORMS } from ${JSON.stringify(actualFormsUrl)};
    export const SEC_FORM_ROOM_MANIFEST = [{
      slug: "periodic-reports",
      forms: ["10-Q", "10-Q/A", "8-K", "S-3", "424B5", "40-F", "40-F/A"],
    }, { slug: "ownership", forms: ["4", "4/A", "144", "144/A"] }];
    export const SEC_PRODUCTION_INGEST_SCHEDULE = [{
      id: "execution-test-group",
      rooms: ["periodic-reports"],
      countPerForm: 1,
      attachmentLimit: 1,
    }, { id: "ownership_changes", rooms: ["ownership"], countPerForm: 1, attachmentLimit: 0 }];
  `)],
  ["@/lib/sourceWorkflowConfig", dataModule(`
    export const SEC_WORKFLOW_CONFIG = { lockTtlSeconds: 7200 };
    export const SOURCE_INGEST_WORKFLOW_SOURCES = {};
  `)],
  ["@/lib/supabase", dataModule(`
    export async function supabaseSelect(table, filters) {
      const state = globalThis.__secWorkflowExecutionState;
      if (table === "events") {
        const requested = String(filters.raw_item_id ?? "");
        const requestedIds = requested.startsWith("eq.")
          ? [requested.slice(3)]
          : requested.startsWith("in.(")
            ? requested.slice(4, -1).split(",")
            : [];
        const rows = Object.entries(state.completedEvents)
          .filter(([rawItemId]) => requestedIds.includes(rawItemId))
          .map(([rawItemId, eventId]) => ({ id: eventId, raw_item_id: rawItemId }));
        return { ok: true, status: 200, data: rows };
      }
      if (table === "raw_items") {
        const requested = String(filters.id ?? "");
        const rows = state.items
          .filter((item) => requested.includes(item.raw_item_id))
          .map((item) => ({ id: item.raw_item_id, metadata: {}, form_type: item.form_type }));
        return { ok: true, status: 200, data: rows };
      }
      return { ok: true, status: 200, data: [] };
    }
    export async function supabaseUpdate() {
      return { ok: true, status: 200, data: [] };
    }
  `)],
]);

registerHooks({
  resolve(specifier, context, nextResolve) {
    const mock = mocks.get(specifier);
    if (mock) return { shortCircuit: true, url: mock };
    return nextResolve(specifier, context);
  },
});

const { secSourceIngestWorkflow } = await import("./source-ingest.ts");

test("ownership collection includes Form3/5 originals and amendments without Primary scheduling", async () => {
  const state = setup(["3", "3/A", "5", "5/A", "4", "144"].map((form, i) => stored(`raw-ownership-${i}`, form, "94049")));
  await secSourceIngestWorkflow({ ...workflowInput(), groupId: "ownership_changes" });
  assert.deepEqual(state.rawFormTypes, ["4", "4/A", "144", "144/A", "3", "3/A", "5", "5/A"]);
  assert.deepEqual(state.analysisCalls, ["raw-ownership-4", "raw-ownership-5"]);
  assert.deepEqual(state.bridgeCalls, []);
});

test("periodic VEEA 10-Q executes raw, normalized O/S bridge, then analysis", async () => {
  const state = setup([stored("raw-veea-q2", "10-Q", "1840317")]);

  const result = await secSourceIngestWorkflow(workflowInput());

  assert.deepEqual(state.bridgeCalls, [["0001840317"]]);
  assert.deepEqual(state.rawFormTypes, ["10-Q", "10-Q/A", "8-K", "S-3", "424B5", "40-F", "40-F/A"]);
  assert.deepEqual(state.analysisCalls, ["raw-veea-q2"]);
  assert.deepEqual(state.offeringPlanCalls, ["event:raw-veea-q2"]);
  assert.deepEqual(state.order, ["raw", "os:0001840317", "analysis:raw-veea-q2"]);
  assert.equal(result.osCollection.status, "completed");
});

test("source-run identity is stable for a replayed step attempt and distinct for a retry", async () => {
  const first = setup([]);
  await secSourceIngestWorkflow(workflowInput());
  const firstAttempt = first.rawSourceRuns[0];
  await secSourceIngestWorkflow(workflowInput());
  const replayedAttempt = first.rawSourceRuns[1];

  const retry = setup([]);
  retry.stepAttempt = 2;
  await secSourceIngestWorkflow(workflowInput());
  const secondAttempt = retry.rawSourceRuns[0];

  assert.deepEqual(firstAttempt, replayedAttempt);
  assert.notEqual(firstAttempt?.sourceRunId, secondAttempt?.sourceRunId);
  assert.equal(firstAttempt?.workflowRunId, "wrun_execution_test_123");
  assert.equal(firstAttempt?.workflowStepId, "step_execution_test");
  assert.equal(firstAttempt?.workflowAttempt, 1);
  assert.equal(firstAttempt?.triggerId, "trigger-execution-test");
  assert.equal(firstAttempt?.lockKey, "lock-execution-test");
  assert.equal(firstAttempt?.lockOwner, "owner-execution-test");
  assert.equal(secondAttempt?.workflowAttempt, 2);
});

test("non-periodic-only raw batch executes analysis with zero O/S bridge calls", async () => {
  const state = setup([
    stored("raw-8k", "8-K", "1840317"),
    stored("raw-s3", "S-3", "1840317"),
    stored("raw-424b5", "424B5", "1840317"),
  ]);

  const result = await secSourceIngestWorkflow(workflowInput());

  assert.deepEqual(state.bridgeCalls, []);
  assert.deepEqual(state.analysisCalls, ["raw-8k", "raw-s3", "raw-424b5"]);
  assert.equal(result.osCollection.status, "skipped");
});

test("same-run VEEA 10-Q and 10-Q/A dedupe to one collector invocation", async () => {
  const state = setup([
    stored("raw-veea-10q", "10-Q", "1840317"),
    stored("raw-veea-10qa", "10-Q/A", "0001840317"),
  ]);

  await secSourceIngestWorkflow(workflowInput());

  assert.deepEqual(state.bridgeCalls, [["0001840317"]]);
  assert.deepEqual(state.analysisCalls, ["raw-veea-10q", "raw-veea-10qa"]);
});

test("40-F raw items invoke the independent O/S collector and periodic report analysis", async () => {
  const state = setup([stored("raw-barrick-40f", "40-F", "756894")]);

  const result = await secSourceIngestWorkflow(workflowInput());

  assert.deepEqual(state.bridgeCalls, [["0000756894"]]);
  assert.deepEqual(state.analysisCalls, ["raw-barrick-40f"]);
  assert.deepEqual(state.order, ["raw", "os:0000756894", "analysis:raw-barrick-40f"]);
  assert.equal(result.osCollection.status, "completed");
});

test("returned O/S collector failure is recorded and analysis still executes", async () => {
  const state = setup(
    [stored("raw-veea-q2", "10-Q", "1840317")],
    { osFailure: true },
  );

  const result = await secSourceIngestWorkflow(workflowInput());

  assert.deepEqual(state.bridgeCalls, [["0001840317"]]);
  assert.deepEqual(state.analysisCalls, ["raw-veea-q2"]);
  assert.equal(result.osCollection.status, "failed");
  assert.deepEqual(result.osCollection.failures, [{
    issuerCik: "0001840317",
    stage: "collector",
    error: "intentional O/S collector failure",
  }]);
});

test("final 424B4 verification failure is fail-closed and ordinary SEC analysis still executes", async () => {
  const rawItemId = "11111111-1111-4111-8111-111111111111";
  const state = setup(
    [stored(rawItemId, "424B4", "2025942")],
    { prospectusOsFailure: true },
  );

  const result = await secSourceIngestWorkflow(workflowInput());

  assert.deepEqual(state.bridgeCalls, []);
  assert.deepEqual(state.prospectusBridgeCalls, [[rawItemId]]);
  assert.deepEqual(state.analysisCalls, [rawItemId]);
  assert.deepEqual(state.order, ["raw", `prospectus-os:${rawItemId}`, `analysis:${rawItemId}`]);
  assert.equal(result.prospectusOsCollection.status, "failed");
  assert.equal(result.analyses[0]?.stage, "completed");
});

test("actual exported workflow keeps analysis running when periodic O/S returns BASELINE_REQUIRED", async () => {
  const state = setup(
    [stored("raw-wit-ads-20f", "20-F", "1123799")],
    { osBaselineRequired: true },
  );

  const result = await secSourceIngestWorkflow(workflowInput());

  assert.deepEqual(state.bridgeCalls, [["0001123799"]]);
  assert.deepEqual(state.analysisCalls, ["raw-wit-ads-20f"]);
  assert.deepEqual(state.order, ["raw", "os:0001123799", "analysis:raw-wit-ads-20f"]);
  assert.equal(result.osCollection.issuerResults[0]?.status, "BASELINE_REQUIRED");
  assert.equal(result.osCollection.issuerResults[0]?.incrementalBaseline?.status, "BASELINE_REQUIRED");
  assert.equal(result.analyses[0]?.stage, "completed");
});

test("raw ingest failure propagates and is not swallowed", async () => {
  const state = setup([], { rawFailure: true });

  await assert.rejects(
    secSourceIngestWorkflow(workflowInput()),
    /intentional raw failure/,
  );

  assert.deepEqual(state.bridgeCalls, []);
  assert.deepEqual(state.analysisCalls, []);
  assert.equal(state.releaseCalls, 1);
});

test("analysis failure propagates and is not swallowed", async () => {
  const state = setup(
    [stored("raw-analysis-failure", "8-K", "1840317")],
    { analysisFailure: true },
  );

  await assert.rejects(
    secSourceIngestWorkflow(workflowInput()),
    /intentional analysis failure/,
  );

  assert.deepEqual(state.bridgeCalls, []);
  assert.deepEqual(state.analysisCalls, ["raw-analysis-failure"]);
  assert.equal(state.releaseCalls, 1);
});

test("failed Offering Monitor replays only the Monitor and completes without replaying site analysis or O/S sidecar", async () => {
  const rawItemId = "raw-offering-monitor-retry";
  const state = setup([stored(rawItemId, "S-3", "1840317")]);
  state.monitorIdentityEnabled = true;

  const initial = await secSourceIngestWorkflow(workflowInput());

  assert.equal(initial.analyses[0]?.stage, "completed");
  assert.deepEqual(state.analysisCalls, [rawItemId]);
  assert.equal(state.monitorRegistryState, "failed");
  assert.deepEqual(state.monitorRegistryStateWrites, [{
    jobId: `job:${rawItemId}`,
    status: "failed",
  }]);
  assert.equal(state.sidecarEnqueueCalls, 1);

  const replay = await secSourceIngestWorkflow(workflowInput());

  assert.equal(replay.analyses[0]?.stage, "completed");
  assert.equal(replay.analyses[0]?.reused, true);
  assert.equal(replay.analyses[0]?.offeringMonitorRegistryRetry?.status, "retried");
  assert.equal(replay.analyses[0]?.offeringMonitorRegistryRetry?.execution?.status, "completed");
  assert.deepEqual(state.analysisCalls, [rawItemId]);
  assert.deepEqual(state.monitorRegistryRetryCalls, [`event:${rawItemId}`]);
  assert.equal(state.monitorRegistryState, "completed");
  assert.deepEqual(state.monitorRegistryStateWrites, [
    { jobId: `job:${rawItemId}`, status: "failed" },
    { jobId: `job:${rawItemId}`, status: "completed" },
  ]);
  assert.equal(state.sidecarEnqueueCalls, 1);

  const noOpReplay = await secSourceIngestWorkflow(workflowInput());
  assert.deepEqual(state.offeringPlanCalls, [`event:${rawItemId}`, `event:${rawItemId}`]);
  assert.equal(noOpReplay.analyses.length, 0);
  assert.deepEqual(state.analysisCalls, [rawItemId]);
  assert.deepEqual(state.monitorRegistryRetryCalls, [`event:${rawItemId}`]);
  assert.equal(state.sidecarEnqueueCalls, 1);
});

test("failed Monitor state write leaves reservation pending so replay can still complete only Monitor", async () => {
  const rawItemId = "raw-offering-monitor-state-write-retry";
  const state = setup([stored(rawItemId, "S-3", "1840317")]);
  state.monitorIdentityEnabled = true;
  state.monitorRegistryStateWriteFailure = true;

  const initial = await secSourceIngestWorkflow(workflowInput());

  assert.equal(initial.analyses[0]?.stage, "completed");
  assert.equal(state.monitorRegistryState, "pending");
  assert.deepEqual(state.analysisCalls, [rawItemId]);
  assert.equal(state.sidecarEnqueueCalls, 1);

  state.monitorRegistryStateWriteFailure = false;
  const replay = await secSourceIngestWorkflow(workflowInput());

  assert.equal(replay.analyses[0]?.offeringMonitorRegistryRetry?.execution?.status, "completed");
  assert.equal(state.monitorRegistryState, "completed");
  assert.deepEqual(state.analysisCalls, [rawItemId]);
  assert.deepEqual(state.monitorRegistryRetryCalls, [`event:${rawItemId}`]);
  assert.equal(state.sidecarEnqueueCalls, 1);
});

function setup(
  items: RawItem[],
  failures: Partial<Pick<ExecutionState,
    "rawFailure" | "analysisFailure" | "osFailure" | "osBaselineRequired" | "prospectusOsFailure">> = {},
) {
  const state: ExecutionState = {
    items,
    rawFailure: failures.rawFailure ?? false,
    analysisFailure: failures.analysisFailure ?? false,
    osFailure: failures.osFailure ?? false,
    osBaselineRequired: failures.osBaselineRequired ?? false,
    prospectusOsFailure: failures.prospectusOsFailure ?? false,
    rawCalls: 0,
    rawFormTypes: [],
    rawSourceRuns: [],
    stepAttempt: 1,
    workflowRunId: "wrun_execution_test_123",
    bridgeCalls: [],
    prospectusBridgeCalls: [],
    analysisCalls: [],
    offeringPlanCalls: [],
    completedEvents: {},
    monitorIdentityEnabled: false,
    monitorRegistryState: "none",
    monitorRegistryRetryCalls: [],
    monitorRegistryStateWrites: [],
    monitorRegistryStateWriteFailure: false,
    sidecarEnqueueCalls: 0,
    releaseCalls: 0,
    order: [],
  };
  globalThis.__secWorkflowExecutionState = state;
  return state;
}

function stored(rawItemId: string, formType: string, cik: string): RawItem {
  return {
    ok: true,
    raw_item_id: rawItemId,
    form_type: formType,
    cik,
  };
}

function workflowInput() {
  return {
    triggerId: "trigger-execution-test",
    groupId: "execution-test-group",
    lockKey: "lock-execution-test",
    lockOwner: "owner-execution-test",
  };
}

function dataModule(source: string) {
  return `data:text/javascript,${encodeURIComponent(source)}`;
}
