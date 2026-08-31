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
  rawCalls: number;
  rawFormTypes: string[];
  bridgeCalls: string[][];
  analysisCalls: string[];
  releaseCalls: number;
  order: string[];
};

declare global {
  var __secWorkflowExecutionState: ExecutionState | undefined;
}

const actualBridgeUrl = pathToFileURL(
  path.resolve(process.cwd(), "lib/secPeriodicOsTriggerBridge.ts"),
).href;

const mocks = new Map<string, string>([
  ["workflow", dataModule(`
    export class FatalError extends Error {}
    export class RetryableError extends Error {
      constructor(message, options) { super(message); this.options = options; }
    }
    export function getStepMetadata() {
      return { stepId: "step_execution_test", attempt: 1 };
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
      return { ok: true, stage: "complete", event: { id: "event:" + rawItemId } };
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
  ["@/lib/offeringMonitorJobFoundation", dataModule(`
    export function buildOfferingMonitorJobIdentity() { return null; }
  `)],
  ["@/lib/offeringMonitorJobStarter", dataModule(`
    export async function enqueueOfferingMonitorJob() { return null; }
  `)],
  ["@/lib/secIngest", dataModule(`
    export async function runSecRawIngest(options) {
      const state = globalThis.__secWorkflowExecutionState;
      state.rawCalls += 1;
      state.rawFormTypes = [...(options.formTypes || [])];
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
    export const SEC_FORM_ROOM_MANIFEST = [{
      slug: "periodic-reports",
      forms: ["10-Q", "10-Q/A", "8-K", "S-3", "424B5"],
    }];
    export const SEC_PRODUCTION_INGEST_SCHEDULE = [{
      id: "execution-test-group",
      rooms: ["periodic-reports"],
      countPerForm: 1,
      attachmentLimit: 1,
    }];
  `)],
  ["@/lib/sourceWorkflowConfig", dataModule(`
    export const SEC_WORKFLOW_CONFIG = { lockTtlSeconds: 7200 };
    export const SOURCE_INGEST_WORKFLOW_SOURCES = {};
  `)],
  ["@/lib/supabase", dataModule(`
    export async function supabaseSelect(table, filters) {
      const state = globalThis.__secWorkflowExecutionState;
      if (table === "events") return { ok: true, status: 200, data: [] };
      if (table === "raw_items") {
        const requested = String(filters.id ?? "");
        const rows = state.items
          .filter((item) => requested.includes(item.raw_item_id))
          .map((item) => ({ id: item.raw_item_id, metadata: {} }));
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

test("periodic VEEA 10-Q executes raw, normalized O/S bridge, then analysis", async () => {
  const state = setup([stored("raw-veea-q2", "10-Q", "1840317")]);

  const result = await secSourceIngestWorkflow(workflowInput());

  assert.deepEqual(state.bridgeCalls, [["0001840317"]]);
  assert.deepEqual(state.rawFormTypes, ["10-Q", "10-Q/A", "8-K", "S-3", "424B5", "40-F", "40-F/A"]);
  assert.deepEqual(state.analysisCalls, ["raw-veea-q2"]);
  assert.deepEqual(state.order, ["raw", "os:0001840317", "analysis:raw-veea-q2"]);
  assert.equal(result.osCollection.status, "completed");
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

test("40-F raw items invoke only the O/S collector and do not enter the unsupported report-analysis parser", async () => {
  const state = setup([stored("raw-barrick-40f", "40-F", "756894")]);

  const result = await secSourceIngestWorkflow(workflowInput());

  assert.deepEqual(state.bridgeCalls, [["0000756894"]]);
  assert.deepEqual(state.analysisCalls, []);
  assert.deepEqual(state.order, ["raw", "os:0000756894"]);
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

test("actual exported workflow keeps analysis running when periodic O/S returns BASELINE_REQUIRED", async () => {
  const state = setup(
    [stored("raw-gure-periodic", "10-Q", "885462")],
    { osBaselineRequired: true },
  );

  const result = await secSourceIngestWorkflow(workflowInput());

  assert.deepEqual(state.bridgeCalls, [["0000885462"]]);
  assert.deepEqual(state.analysisCalls, ["raw-gure-periodic"]);
  assert.deepEqual(state.order, ["raw", "os:0000885462", "analysis:raw-gure-periodic"]);
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

function setup(
  items: RawItem[],
  failures: Partial<Pick<ExecutionState,
    "rawFailure" | "analysisFailure" | "osFailure" | "osBaselineRequired">> = {},
) {
  const state: ExecutionState = {
    items,
    rawFailure: failures.rawFailure ?? false,
    analysisFailure: failures.analysisFailure ?? false,
    osFailure: failures.osFailure ?? false,
    osBaselineRequired: failures.osBaselineRequired ?? false,
    rawCalls: 0,
    rawFormTypes: [],
    bridgeCalls: [],
    analysisCalls: [],
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
