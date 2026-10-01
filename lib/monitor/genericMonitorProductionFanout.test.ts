import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildGenericMonitorChildIdentities,
  type GenericMonitorChildIdentity,
} from "./genericMonitorChildExecution.ts";
import { processGenericMonitorChildWithDependencies } from "./genericMonitorChildProcessor.ts";
import {
  buildGenericMonitorPrimaryExecutionContext,
  enqueueGenericMonitorChildrenAfterPrimary,
} from "./genericMonitorChildWorkflowStarter.ts";
import type { ListingRiskAnalyzerInput, ListingRiskAnalyzerResult } from "./listingRiskAnalyzer.ts";

const EVENT_ID = "91000000-0000-4000-8000-000000000001";
const RAW_ID = "91000000-0000-4000-8000-000000000002";
const PARENT_ID = "91000000-0000-4000-8000-000000000003";
const ROUTED = { monitor_routes: [{ monitor_analyzer_key: "listing_risk" }] };

test("source-level no-route performs zero reservation, workflow, and provider work", async () => {
  const harness = starterHarness();
  const result = await enqueueGenericMonitorChildrenAfterPrimary({
    primary: newsPrimary(),
    primaryAnalysis: { monitor_routes: [] },
    dependencies: harness.dependencies,
  });
  assert.deepEqual(result, { status: "not_routed", childCount: 0 });
  assert.deepEqual(harness.calls(), { reserve: 0, claimStart: 0, start: 0, provider: 0 });
});

test("listing route reserves and durably starts exactly one logical child", async () => {
  const harness = starterHarness();
  const result = await enqueueGenericMonitorChildrenAfterPrimary({
    primary: newsPrimary(),
    primaryAnalysis: ROUTED,
    dependencies: harness.dependencies,
  });
  assert.equal(result.status, "enqueued");
  assert.equal(result.childCount, 1);
  assert.deepEqual(harness.calls(), { reserve: 1, claimStart: 1, start: 1, provider: 0 });
});

test("listing and corporate-action routes independently reserve and start two Generic Monitor children", async () => {
  const harness = starterHarness();
  const result = await enqueueGenericMonitorChildrenAfterPrimary({
    primary: newsPrimary(),
    primaryAnalysis: {
      monitor_routes: [
        { monitor_analyzer_key: "listing_risk" },
        { monitor_analyzer_key: "corporate_action" },
      ],
    },
    dependencies: harness.dependencies,
  });
  assert.equal(result.status, "enqueued");
  assert.equal(result.childCount, 2);
  assert.deepEqual(result.children?.map((child) => child.monitorAnalyzerKey).sort(), [
    "corporate_action",
    "listing_risk",
  ]);
  assert.deepEqual(harness.calls(), { reserve: 2, claimStart: 2, start: 2, provider: 0 });
});

test("Corporate Action runtime reuses the common Alert consumer after canonical persistence", () => {
  const runtime = readFileSync(new URL("./genericMonitorChildRuntime.ts", import.meta.url), "utf8");
  assert.match(
    runtime,
    /monitorAnalyzerKey === "corporate_action"[\s\S]*persistCorporateActionAnalyzerResult[\s\S]*consumeListingMonitorAlertsForEvent/,
  );
  assert.match(
    runtime,
    /afterSuccessfulPersistence[\s\S]*runDilutionCorporateActionAdjustmentForEvent/,
  );
});

test("same identity concurrent enqueue owns workflow start once and duplicate re-trigger starts zero providers", async () => {
  const harness = starterHarness();
  const input = {
    primary: newsPrimary(),
    primaryAnalysis: ROUTED,
    dependencies: harness.dependencies,
  };
  const [first, second] = await Promise.all([
    enqueueGenericMonitorChildrenAfterPrimary(input),
    enqueueGenericMonitorChildrenAfterPrimary(input),
  ]);
  assert.deepEqual([first.status, second.status].sort(), ["duplicate", "enqueued"]);
  assert.equal(harness.calls().start, 1);
  assert.equal(harness.calls().provider, 0);
});

test("workflow start failure releases the same identity so a later trigger can start it", async () => {
  const harness = starterHarness({ failStarts: 1 });
  const input = {
    primary: newsPrimary(),
    primaryAnalysis: ROUTED,
    dependencies: harness.dependencies,
  };
  assert.equal((await enqueueGenericMonitorChildrenAfterPrimary(input)).status, "enqueue_failed");
  assert.equal((await enqueueGenericMonitorChildrenAfterPrimary(input)).status, "enqueued");
  assert.equal(harness.calls().start, 2);
});

test("new Primary produces a new child and a new durable workflow start", async () => {
  const harnessA = starterHarness();
  const first = await enqueueGenericMonitorChildrenAfterPrimary({
    primary: newsPrimary(), primaryAnalysis: ROUTED, dependencies: harnessA.dependencies,
  });
  const harnessB = starterHarness();
  const second = await enqueueGenericMonitorChildrenAfterPrimary({
    primary: newsPrimary({ parentPrimaryAiRunId: "91000000-0000-4000-8000-000000000004" }),
    primaryAnalysis: ROUTED,
    dependencies: harnessB.dependencies,
  });
  assert.notEqual("jobId" in first ? first.jobId : null, "jobId" in second ? second.jobId : null);
  assert.equal(harnessA.calls().start + harnessB.calls().start, 2);
});

test("SEC production integration guard separates routed 8-K/6-K from deterministic periodic forms", () => {
  for (const form of ["8-K", "6-K", " 8-k "]) {
    assert.equal(secPrimary(form)?.sourceFamily, "sec_8k_6k");
  }
  for (const form of ["8-K/A", "6-K/A", "S-3", ""] ) {
    assert.equal(secPrimary(form), null, `${form || "empty"} must stay outside production fan-out scope`);
  }
  for (const form of ["25", "25-NSE"]) assert.equal(secPrimary(form)?.sourceFamily, "sec_form25");
  for (const form of ["10-Q", "10-Q/A", "10-K", "10-K/A", "20-F", "20-F/A", "40-F", "40-F/A"]) {
    assert.equal(periodicPrimary(form)?.sourceFamily, "sec_periodic_reports", form);
  }
});

test("non-periodic amendments and unrelated SEC forms stay reservation/workflow/provider zero even with listing route", async () => {
  for (const form of ["8-K/A", "6-K/A", "S-3"]) {
    const harness = starterHarness();
    const result = await enqueueGenericMonitorChildrenAfterPrimary({
      primary: secPrimary(form),
      primaryAnalysis: ROUTED,
      dependencies: harness.dependencies,
    });
    assert.deepEqual(result, { status: "out_of_scope", childCount: 0 });
    assert.deepEqual(harness.calls(), { reserve: 0, claimStart: 0, start: 0, provider: 0 });
  }
});

test("periodic SEC Primary starts financial and NT lifecycle children without reading GPT routes", async () => {
  const harness = starterHarness();
  const result = await enqueueGenericMonitorChildrenAfterPrimary({
    primary: periodicPrimary("10-K"),
    primaryAnalysis: { narrative: "qualitative Primary remains unchanged", monitor_routes: [] },
    dependencies: harness.dependencies,
  });
  assert.equal(result.status, "enqueued");
  assert.equal(result.childCount, 2);
  assert.deepEqual(harness.calls(), { reserve: 2, claimStart: 2, start: 2, provider: 0 });
  assert.deepEqual("children" in result ? result.children?.map(child => child.monitorAnalyzerKey) : [], ["periodic_financial", "nt_lifecycle"]);
});

test("stale preflight blocks provider and records stale", async () => {
  const harness = processorHarness({ currentness: "stale" });
  const result = await processGenericMonitorChildWithDependencies(childIdentity(), harness.dependencies);
  assert.equal(result.status, "stale");
  assert.equal(harness.providerCalls(), 0);
  assert.deepEqual(harness.terminalStates(), ["stale"]);
});

test("exact-parent, sibling, and wrong-output failures fail closed before provider", async () => {
  const harness = processorHarness({ parentError: new Error("exact parent output missing or wrong type") });
  const result = await processGenericMonitorChildWithDependencies(childIdentity(), harness.dependencies);
  assert.equal(result.status, "failed");
  assert.equal(harness.providerCalls(), 0);
  assert.deepEqual(harness.terminalStates(), ["failed"]);
});

test("applicable persists typed facts before terminal success and not-applicable persists exclusion first", async () => {
  for (const result of [
    { status: "applicable", facts: {} } as ListingRiskAnalyzerResult,
    { status: "not_applicable" } as ListingRiskAnalyzerResult,
  ]) {
    const harness = processorHarness({ analyzerResult: result });
    const processed = await processGenericMonitorChildWithDependencies(childIdentity(), harness.dependencies);
    assert.equal(processed.status, result.status === "applicable" ? "succeeded_applicable" : "succeeded_not_applicable");
    assert.deepEqual(harness.order(), [
      `persist:${result.status}`,
      `terminal:succeeded_${result.status}`,
    ]);
  }
});

test("an applicable canonical result runs post-persistence effects after terminal success", async () => {
  const harness = processorHarness({
    analyzerResult: { status: "applicable", facts: {} } as ListingRiskAnalyzerResult,
  });
  const processed = await processGenericMonitorChildWithDependencies(childIdentity(), {
    ...harness.dependencies,
    afterSuccessfulPersistence: async () => {
      harness.order().push("post:persisted-split-effects");
      return { status: "completed" };
    },
  });
  assert.equal(processed.status, "succeeded_applicable");
  assert.deepEqual(processed.postPersistence, { status: "completed" });
  assert.deepEqual(harness.order(), [
    "persist:applicable",
    "terminal:succeeded_applicable",
    "post:persisted-split-effects",
  ]);
});

test("optional O/S persists after the unchanged domain result with one provider call; absence adds no persistence work", async () => {
  const candidate = {
    observationType: "source_stated",
    sharesOutstanding: "27500000",
    asOf: "2026-08-18",
    securityClassKind: "common_stock",
    securityClassTitle: "common stock",
    basis: null,
    accessionNumber: "0000000099-26-000010",
    sourceDocument: "fixture.htm",
    sourceDocumentUrl: "https://www.sec.gov/Archives/edgar/data/99/fixture.htm",
    sourceRef: "sec-cover",
    evidence: "As of August 18, 2026, 27,500,000 shares of common stock were outstanding.",
    sourceContentHash: "a".repeat(64),
  } as const;
  const withObservation = processorHarness({ shareCountObservation: candidate });
  const processed = await processGenericMonitorChildWithDependencies(childIdentity(), withObservation.dependencies);
  assert.equal(processed.status, "succeeded_not_applicable");
  assert.equal(processed.providerCalls, 1);
  assert.deepEqual(processed.shareCountPersistence, { inserted: 1, deduped: 0 });
  assert.deepEqual(withObservation.order(), [
    "persist:not_applicable",
    "persist:share_count",
    "terminal:succeeded_not_applicable",
  ]);

  const withoutObservation = processorHarness();
  const absent = await processGenericMonitorChildWithDependencies(childIdentity(), withoutObservation.dependencies);
  assert.equal(absent.providerCalls, 1);
  assert.equal("shareCountPersistence" in absent, false);
  assert.deepEqual(withoutObservation.order(), [
    "persist:not_applicable",
    "terminal:succeeded_not_applicable",
  ]);
});

test("Listing Alert consumer failure is isolated after canonical persistence and parent terminal success", async () => {
  const harness = processorHarness({
    analyzerResult: { status: "applicable", facts: {} } as ListingRiskAnalyzerResult,
    consumerFailure: true,
  });
  const processed = await processGenericMonitorChildWithDependencies(childIdentity(), harness.dependencies);
  assert.equal(processed.status, "succeeded_applicable");
  assert.equal(processed.listingMonitorAlerts?.status, "failed");
  assert.deepEqual(harness.terminalStates(), ["succeeded_applicable"]);
  assert.deepEqual(harness.order(), [
    "persist:applicable",
    "terminal:succeeded_applicable",
    "consumer",
  ]);
});

test("not-applicable canonical success never invokes the Listing Alert consumer", async () => {
  const harness = processorHarness({
    analyzerResult: { status: "not_applicable" } as ListingRiskAnalyzerResult,
    consumerFailure: true,
  });
  const processed = await processGenericMonitorChildWithDependencies(childIdentity(), harness.dependencies);
  assert.equal(processed.status, "succeeded_not_applicable");
  assert.equal("listingMonitorAlerts" in processed, false);
  assert.deepEqual(harness.order(), [
    "persist:not_applicable",
    "terminal:succeeded_not_applicable",
  ]);
});

test("provider and persistence failures preserve Primary state and remain nonterminal/retryable", async () => {
  for (const mode of ["provider", "persistence"] as const) {
    const primary = { score: 91, signal: "bearish", summary: "exact Primary remains valid" };
    const before = structuredClone(primary);
    const harness = processorHarness({ failure: mode, primaryAnalysis: primary });
    const result = await processGenericMonitorChildWithDependencies(childIdentity(), harness.dependencies);
    assert.equal(result.status, "retryable_failure");
    assert.deepEqual(primary, before);
    assert.deepEqual(harness.terminalStates(), []);
    assert.equal(harness.releaseCount(), 1);
  }
});

test("persistence stale recheck blocks an orchestration-race stale writer", async () => {
  const harness = processorHarness({ persistenceStale: true });
  const result = await processGenericMonitorChildWithDependencies(childIdentity(), harness.dependencies);
  assert.equal(result.status, "stale");
  assert.deepEqual(harness.terminalStates(), ["stale"]);
  assert.doesNotMatch(harness.order().join("|"), /succeeded_/);
});

test("production wiring awaits durable enqueue after Primary and isolates existing alert results", () => {
  const news = readFileSync(new URL("../newsIngest.ts", import.meta.url), "utf8");
  const sec = readFileSync(new URL("../secFilingAnalysisIngest.ts", import.meta.url), "utf8");
  const starter = readFileSync(new URL("./genericMonitorChildWorkflowStarter.ts", import.meta.url), "utf8");
  const processor = readFileSync(new URL("./genericMonitorChildProcessor.ts", import.meta.url), "utf8");
  assert.match(news, /const genericMonitorChildren = await enqueueGenericMonitorChildrenAfterPrimary/);
  assert.match(news, /generic_monitor_children: genericMonitorChildren/);
  assert.ok(news.indexOf("const aiTrace = await persistAiTrace") < news.indexOf("const genericMonitorChildren = await"));
  assert.ok(sec.indexOf("runSecFilingAlertDelivery") < sec.indexOf("const genericMonitorChildren = await"));
  assert.match(sec, /genericMonitorChildren,[\s\S]*validationRepairTrace/);
  assert.match(news, /enqueueGenericMonitorChildrenAfterPrimary\([\s\S]*?\)\.catch/);
  assert.match(sec, /enqueueGenericMonitorChildrenAfterPrimary\([\s\S]*?\)\.catch/);
  assert.doesNotMatch(`${starter}\n${processor}`, /headline|event_type|minimum bid|delist|listing notice/i);
});

function newsPrimary(overrides: Record<string, string> = {}) {
  return buildGenericMonitorPrimaryExecutionContext({
    eventId: EVENT_ID,
    rawItemId: RAW_ID,
    sourceGroup: "news",
    sourceCode: "globenewswire",
    sourceIdentity: "news-1",
    parentPrimaryAiRunId: PARENT_ID,
    parentPromptKey: "news_event_analysis",
    parentPromptVersion: "v28-corporate-action-routing",
    ...overrides,
  })!;
}

function secPrimary(form: string) {
  return buildGenericMonitorPrimaryExecutionContext({
    eventId: EVENT_ID,
    rawItemId: RAW_ID,
    sourceGroup: "filings",
    sourceCode: "sec_edgar",
    sourceIdentity: "0000000000-26-000001",
    parentPrimaryAiRunId: PARENT_ID,
    parentPromptKey: "sec_8k_6k_analysis_listing_financial_risk",
    parentPromptVersion: "v44-monitor-routing",
    secFormType: form,
  });
}

function periodicPrimary(form: string) {
  return buildGenericMonitorPrimaryExecutionContext({
    eventId: EVENT_ID,
    rawItemId: RAW_ID,
    sourceGroup: "filings",
    sourceCode: "sec_edgar",
    sourceIdentity: "0000320193-25-000079",
    parentPrimaryAiRunId: PARENT_ID,
    parentPromptKey: form.endsWith("/A")
      ? "sec_periodic_reports_amendment_analysis"
      : "sec_periodic_reports_analysis",
    parentPromptVersion: "v13-40f",
    secFormType: form,
  });
}

function childIdentity() {
  return buildGenericMonitorChildIdentities({
    primary: newsPrimary(),
    monitorRouting: ROUTED,
    now: "2026-08-13T00:00:00.000Z",
  })[0];
}

function starterHarness(options: { failStarts?: number } = {}) {
  const states = new Map<string, "ready" | "starting" | "started">();
  let reserve = 0;
  let claimStart = 0;
  let start = 0;
  let failures = options.failStarts || 0;
  const repository = {
    async reserve(identity: GenericMonitorChildIdentity) {
      reserve += 1;
      if (!states.has(identity.executionId)) states.set(identity.executionId, "ready");
      return { reserved: states.get(identity.executionId) === "ready", jobId: identity.executionId };
    },
    async claimWorkflowStart(identity: GenericMonitorChildIdentity) {
      claimStart += 1;
      if (states.get(identity.executionId) !== "ready") return false;
      states.set(identity.executionId, "starting");
      return true;
    },
    async releaseWorkflowStart(identity: GenericMonitorChildIdentity) {
      states.set(identity.executionId, "ready");
      return true;
    },
    async attachWorkflowRun(identity: GenericMonitorChildIdentity) {
      states.set(identity.executionId, "started");
    },
  };
  return {
    dependencies: {
      repository,
      startWorkflow: async () => {
        start += 1;
        if (failures > 0) {
          failures -= 1;
          throw new Error("fake start failure");
        }
        return { runId: `run-${start}` };
      },
    } as never,
    calls: () => ({ reserve, claimStart, start, provider: 0 }),
  };
}

function processorHarness(options: {
  currentness?: "current" | "stale";
  parentError?: Error;
  analyzerResult?: ListingRiskAnalyzerResult;
  failure?: "provider" | "persistence";
  persistenceStale?: boolean;
  primaryAnalysis?: Record<string, unknown>;
  consumerFailure?: boolean;
  shareCountObservation?: import("../sec-structured-data/level2ShareCountObservation.ts").Level2ShareCountValidatedCandidate;
} = {}) {
  let providers = 0;
  let releases = 0;
  const terminals: string[] = [];
  const order: string[] = [];
  const identity = childIdentity();
  const repository = {
    async claim() { return true; },
    async releaseForRetry() { releases += 1; },
    async recordTerminal(_identity: GenericMonitorChildIdentity, state: string) {
      terminals.push(state);
      order.push(`terminal:${state}`);
    },
    async loadExactParent() {
      if (options.parentError) throw options.parentError;
      return {
        aiRun: {}, aiOutput: {}, event: {}, rawItem: { body_text: "stored source" },
        analysis: options.primaryAnalysis || { monitor_routes: ROUTED.monitor_routes },
        currentness: options.currentness === "stale"
          ? { status: "stale" as const, latestPrimaryAiRunId: "91000000-0000-4000-8000-000000000004" }
          : { status: "current" as const, latestPrimaryAiRunId: identity.parentPrimaryAiRunId },
      };
    },
  };
  const analyzerResult = options.analyzerResult || { status: "not_applicable" };
  return {
    dependencies: {
      repository,
      buildAnalyzerInput: () => ({}) as ListingRiskAnalyzerInput,
      runAnalyzer: async () => {
        providers += 1;
        if (options.failure === "provider") throw new Error("fake provider failure");
        return {
          stage: "complete" as const,
          result: analyzerResult,
          shareCountObservation: options.shareCountObservation || null,
          run: {} as never,
          repair: null,
        };
      },
      persist: async ({ result }: { result: ListingRiskAnalyzerResult }) => {
        order.push(`persist:${result.status}`);
        if (options.failure === "persistence") throw new Error("fake persistence failure");
        if (options.persistenceStale) return { status: "stale" as const, reason: "new Primary won race" };
        return {
          status: "saved" as const,
          resultStatus: result.status,
          eventId: identity.eventId,
          sourceExecutionId: identity.executionId,
        };
      },
      persistShareCountObservation: async () => {
        order.push("persist:share_count");
        return { inserted: 1, deduped: 0 };
      },
      ...(options.consumerFailure ? {
        consumeListingMonitorAlerts: async () => {
          order.push("consumer");
          throw new Error("fake Alert insert failure");
        },
      } : {}),
    },
    providerCalls: () => providers,
    releaseCount: () => releases,
    terminalStates: () => terminals,
    order: () => order,
  };
}
