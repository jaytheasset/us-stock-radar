import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

declare global {
  var __sc13AutoExisting: Record<string, unknown> | null;
  var __sc13AutoMonitorResult: Record<string, unknown>;
  var __sc13AutoMonitorInputs: Record<string, unknown>[];
  var __sc13AutoMonitorThrows: boolean;
}

const moduleSource = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
const mocks = new Map<string, string>([
  ["@/lib/ai/secInvestableUniverseGate", moduleSource("export function evaluateSecInvestableUniverse(){return null}")],
  ["@/lib/sources/sec/parser", moduleSource("export async function fetchSecEdgarRawItems(){throw new Error('unexpected default fetch')}")],
  ["@/lib/secStores/rawStore", moduleSource(`
    export async function ensureSecSource() {}
    export async function createSecSourceRun() { return 'running'; }
    export async function finishSecSourceRun() {}
    export async function findExistingSecRawItem() { return globalThis.__sc13AutoExisting; }
    export async function saveSecRawItem(rawItem) { return { id: 'a2000000-0000-4000-8000-000000000001', title: rawItem.title }; }
  `)],
  ["@/lib/sourceRunState", moduleSource("export function workflowSourceRunMetadata(){return {}}")],
  ["@/lib/sec-sc13-xml/persistence", moduleSource(`
    export async function persistSc13CanonicalXmlForRawItem(){return {status:'available',writeStatus:'replayed',accessionNumber:'0000947871-26-000860',issuerCik:'0002131524',reporterCount:3,sourceSha256:'${"a".repeat(64)}'}}
    export async function recordSc13CanonicalPersistenceState() {}
    export function sc13PersistenceFailureState(){return {status:'failed',errorCode:'unexpected',issueCodes:[]}}
  `)],
  ["@/lib/monitor/sc13MonitorAutomaticTrigger", moduleSource(`
    export const SC13_MONITOR_AUTOMATIC_TRIGGER_VERSION='sec_sc13_monitor_auto_v1';
    export async function runSc13MonitorAutomaticTrigger(input){globalThis.__sc13AutoMonitorInputs.push(input);if(globalThis.__sc13AutoMonitorThrows)throw new Error('unexpected helper failure');return globalThis.__sc13AutoMonitorResult}
  `)],
]);

registerHooks({
  resolve(specifier, context, nextResolve) {
    const mock = mocks.get(specifier);
    return mock ? { shortCircuit: true, url: mock } : nextResolve(specifier, context);
  },
});

const { runSecRawIngest } = await import("./secIngest.ts");
const rawItem = {
  source_code: "sec_edgar",
  source_group: "filings",
  source_unique_id: "0000947871-26-000860",
  source_url: "https://www.sec.gov/example",
  title: "SC 13G/A",
  published_at: "2026-09-11T00:00:00.000Z",
  fetched_at: "2026-09-11T00:00:00.000Z",
  body_text: "body",
  analysis_text: "analysis",
  dedupe_key: "sec:0000947871-26-000860",
  metadata: {},
  raw_payload: { form_type: "SCHEDULE 13G/A", cik: "0001055951", documents: [] },
};
const fetchRawItems = async () => ({
  ok: true as const,
  status: 200,
  items: [rawItem],
  diagnostics: { documentsRequested: 1, documentsFetched: 1, documentsFailed: 0 },
});

for (const path of ["fresh", "replay"] as const) {
  test(`${path} raw path automatically evaluates from the canonical issuer and isolates Monitor failure`, async () => {
    globalThis.__sc13AutoExisting = path === "replay"
      ? { id: "a2000000-0000-4000-8000-000000000001", title: rawItem.title }
      : null;
    globalThis.__sc13AutoMonitorInputs = [];
    globalThis.__sc13AutoMonitorThrows = false;
    globalThis.__sc13AutoMonitorResult = {
      version: "sec_sc13_monitor_auto_v1",
      status: "failed",
      rawItemId: "a2000000-0000-4000-8000-000000000001",
      issuerCik: "0002131524",
      stateRecorded: false,
      error: "intentional Alert write failure",
    };

    const result = await runSecRawIngest({ force: false }, { fetchRawItems: fetchRawItems as never });
    assert.ok(result.stats);
    assert.ok(result.items);
    const stats = result.stats;
    const items = result.items;
    assert.equal(result.ok, true);
    assert.equal(stats.failed_count, 0);
    assert.equal(stats.sc13_xml_failed_count, 0);
    assert.equal(stats.sc13_xml_available_count, 1);
    assert.equal(stats.sc13_monitor_failed_count, 1);
    assert.equal(stats.sc13_monitor_state_recording_failed_count, 1);
    assert.deepEqual(globalThis.__sc13AutoMonitorInputs, [{
      rawItemId: "a2000000-0000-4000-8000-000000000001",
      issuerCik: "0002131524",
      sourceSha256: "a".repeat(64),
    }]);
    assert.equal(items[0]?.ok, true);
    assert.equal((items[0]?.sc13_xml_persistence as Record<string, unknown>).status, "available");
  });
}

test("an unexpected helper-level exception cannot be counted as XML or raw failure", async () => {
  globalThis.__sc13AutoExisting = { id: "a2000000-0000-4000-8000-000000000001", title: rawItem.title };
  globalThis.__sc13AutoMonitorInputs = [];
  globalThis.__sc13AutoMonitorThrows = true;
  const originalError = console.error;
  console.error = () => undefined;
  try {
    const result = await runSecRawIngest({ force: false }, { fetchRawItems: fetchRawItems as never });
    assert.ok(result.stats);
    assert.ok(result.items);
    assert.equal(result.ok, true);
    assert.equal(result.stats.failed_count, 0);
    assert.equal(result.stats.sc13_xml_failed_count, 0);
    assert.equal(result.stats.sc13_monitor_failed_count, 1);
    assert.equal(result.stats.sc13_monitor_state_recording_failed_count, 1);
    assert.equal(record(record(result.items[0]?.sc13_xml_persistence).monitor).status, "failed");
  } finally {
    console.error = originalError;
    globalThis.__sc13AutoMonitorThrows = false;
  }
});

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
