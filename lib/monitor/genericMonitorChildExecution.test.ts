import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildGenericMonitorChildIdentities,
  reserveGenericMonitorChildren,
  type GenericMonitorChildIdentity,
  type GenericMonitorPrimaryExecutionContext,
} from "./genericMonitorChildExecution.ts";
import {
  createGenericMonitorChildRepository,
  type GenericMonitorChildStore,
} from "./genericMonitorChildRepository.ts";

const EVENT_ID = "69606800-ee16-4a75-9bbf-3b64bdc56d69";
const RAW_ID = "efea3384-9eef-4e6b-9e63-60dc1cd3090e";
const PARENT_A = "5e56353f-e700-4c3f-89c1-0d7c6faf851a";
const PARENT_B = "6e56353f-e700-4c3f-89c1-0d7c6faf851b";
const LISTING_ROUTE = { monitor_routes: [{ monitor_analyzer_key: "listing_risk" }] } as const;

test("no routes reserve zero children and listing route reserves exactly one", async () => {
  const store = new MemoryStore();
  const repository = createGenericMonitorChildRepository(store);
  assert.deepEqual(await reserveGenericMonitorChildren({
    primary: newsPrimary(),
    monitorRouting: { monitor_routes: [] },
    now: "2026-08-13T00:00:00.000Z",
  }, repository), []);
  assert.equal(store.table("ai_runs").length, 0);

  const reservations = await reserveGenericMonitorChildren({
    primary: newsPrimary(),
    monitorRouting: LISTING_ROUTE,
    now: "2026-08-13T00:00:00.000Z",
  }, repository);
  assert.equal(reservations.length, 1);
  assert.equal(reservations[0].reserved, true);
  assert.equal(store.table("ai_runs").length, 1);
  assert.equal(store.table("ai_outputs").length, 0);
});

test("same automatic parent/analyzer/contract reservation is idempotent with no duplicate run or output", async () => {
  const store = new MemoryStore();
  const repository = createGenericMonitorChildRepository(store);
  const input = {
    primary: newsPrimary(),
    monitorRouting: LISTING_ROUTE,
    now: "2026-08-13T00:00:00.000Z",
  };
  const first = await reserveGenericMonitorChildren(input, repository);
  const duplicate = await reserveGenericMonitorChildren(input, repository);
  assert.equal(first[0].jobId, duplicate[0].jobId);
  assert.equal(first[0].reserved, true);
  assert.equal(duplicate[0].reserved, false);
  assert.equal(store.table("ai_runs").length, 1);
  assert.equal(store.table("ai_outputs").length, 0);
});

test("workflow-start CAS grants one concurrent owner and start failure release enables retry", async () => {
  const store = new MemoryStore();
  const repository = createGenericMonitorChildRepository(store);
  const child = identity(newsPrimary());
  await repository.reserve(child);
  const claims = await Promise.all([
    repository.claimWorkflowStart(child),
    repository.claimWorkflowStart(child),
  ]);
  assert.deepEqual(claims.sort(), [false, true]);
  assert.equal(metadata(store.table("ai_runs")[0]).workflow_start_state, "starting");
  assert.equal(await repository.releaseWorkflowStart(child, new Error("fake start failure")), true);
  assert.equal(metadata(store.table("ai_runs")[0]).workflow_start_state, "ready");
  assert.equal(await repository.claimWorkflowStart(child), true);
  await repository.attachWorkflowRun(child, "wrun_123");
  assert.equal(metadata(store.table("ai_runs")[0]).workflow_start_state, "started");
  assert.equal(metadata(store.table("ai_runs")[0]).workflow_run_id, "wrun_123");
});

test("new Primary and new contract are semantic reanalysis while retry keeps the logical job", () => {
  const automatic = identity(newsPrimary());
  assert.equal(automatic.analyzerContractVersion, "listing_risk_domain_analyzer_v9");
  const automaticDuplicate = identity(newsPrimary());
  const newPrimary = identity(newsPrimary({ parentPrimaryAiRunId: PARENT_B }));
  const oldContract = identity(newsPrimary(), {
    analyzerContractVersions: { listing_risk: "listing_risk_domain_analyzer_v2" },
  });
  const retry = identity(newsPrimary(), {
    attempt: { kind: "retry", key: "retry:1" },
  });

  assert.equal(automatic.logicalJobId, automaticDuplicate.logicalJobId);
  assert.equal(automatic.executionId, automaticDuplicate.executionId);
  assert.notEqual(automatic.logicalJobId, newPrimary.logicalJobId);
  assert.notEqual(automatic.executionId, newPrimary.executionId);
  assert.notEqual(automatic.logicalJobId, oldContract.logicalJobId);
  assert.notEqual(automatic.executionId, oldContract.executionId);
  assert.equal(automatic.logicalJobId, retry.logicalJobId);
  assert.notEqual(automatic.executionId, retry.executionId);
  assert.deepEqual(JSON.parse(JSON.stringify(automatic)), automatic);
  for (const forbiddenIdentityKey of ["user", "monitor", "subscription"].map((key) => `${key}_id`)) {
    assert.equal(Object.hasOwn(automatic, forbiddenIdentityKey), false);
  }
});

test("News, Nasdaq Corporate Actions, and SEC 8-K/6-K are mechanically authorized", () => {
  assert.equal(identity(newsPrimary()).sourceFamily, "news");
  assert.equal(identity(nasdaqPrimary()).sourceFamily, "nasdaq_corporate_actions");
  assert.equal(identity(secPrimary()).sourceFamily, "sec_8k_6k");
});

test("unsupported analyzer and source families fail closed without semantic content checks", () => {
  assert.throws(() => buildGenericMonitorChildIdentities({
    primary: newsPrimary(),
    monitorRouting: { monitor_routes: [{ monitor_analyzer_key: "financial_risk" }] },
  }), /validated before reservation/);
  assert.throws(() => identity({
    ...secPrimary(),
    parentPromptKey: "sec_form25_analysis",
  }), /not mechanically authorized/);
  assert.throws(() => identity({
    ...newsPrimary(),
    sourceCode: "nasdaq_corporate_actions",
  }), /not mechanically authorized/);
});

test("exact parent loader reads only the specified run/output and uses latest only for stale authority", async () => {
  const store = parentStore();
  addParent(store, newsPrimary(), PARENT_A, "2026-08-13T00:00:00.000Z", "exact-parent-A");
  store.table("ai_outputs").push({
    id: "9e56353f-e700-4c3f-89c1-0d7c6faf851d",
    ai_run_id: PARENT_A,
    event_id: EVENT_ID,
    output_type: "unrelated_auxiliary_output",
    payload: { analysis: { marker: "unrelated-sibling", monitor_routes: LISTING_ROUTE.monitor_routes } },
    created_at: "2026-08-13T00:00:01.000Z",
  });
  addParent(
    store,
    newsPrimary({ parentPrimaryAiRunId: PARENT_B }),
    PARENT_B,
    "2026-08-13T01:00:00.000Z",
    "newer-parent-B",
  );
  const repository = createGenericMonitorChildRepository(store);
  const exactA = await repository.loadExactParent(identity(newsPrimary()));

  assert.equal(exactA.currentness.status, "stale");
  assert.equal(exactA.currentness.latestPrimaryAiRunId, PARENT_B);
  assert.equal(exactA.analysis.marker, "exact-parent-A");
  assert.notEqual(exactA.analysis.marker, "newer-parent-B");
  assert.ok(store.selectCalls.some((call) =>
    call.table === "ai_runs" && call.search.id === `eq.${PARENT_A}`));
  assert.ok(store.selectCalls.some((call) =>
    call.table === "ai_outputs"
    && call.search.ai_run_id === `eq.${PARENT_A}`
    && call.search.output_type === "eq.news_event_analysis"));
  const latestCall = store.selectCalls.find((call) =>
    call.table === "ai_runs" && call.search.order?.startsWith("finished_at.desc"));
  assert.equal(latestCall?.search.select, "id");
});

test("exact parent loader fails closed when only a wrong Primary output type exists", async () => {
  const store = parentStore();
  addParent(store, newsPrimary(), PARENT_A, "2026-08-13T00:00:00.000Z", "wrong-type-only");
  store.table("ai_outputs")[0].output_type = "unrelated_auxiliary_output";
  await assert.rejects(
    createGenericMonitorChildRepository(store).loadExactParent(identity(newsPrimary())),
    /exact parent ai_output must resolve to exactly one row/,
  );
});

test("expected Primary output type is mechanical for News, Nasdaq, and SEC", async () => {
  for (const primary of [newsPrimary(), nasdaqPrimary(), secPrimary()]) {
    const store = parentStore(primary);
    addParent(store, primary, PARENT_A, "2026-08-13T00:00:00.000Z", primary.sourceFamily);
    await createGenericMonitorChildRepository(store).loadExactParent(identity(primary));
    const outputCall = store.selectCalls.find((call) => call.table === "ai_outputs");
    assert.equal(
      outputCall?.search.output_type,
      `eq.${primary.sourceFamily === "sec_8k_6k" ? primary.parentPromptKey : "news_event_analysis"}`,
    );
  }
});

test("exact loader rejects mismatched output, event, raw, source, and analyzer route lineage", async () => {
  for (const mutate of [
    (store: MemoryStore) => { store.table("ai_outputs")[0].ai_run_id = PARENT_B; },
    (store: MemoryStore) => { store.table("events")[0].raw_item_id = "7e56353f-e700-4c3f-89c1-0d7c6faf851c"; },
    (store: MemoryStore) => { store.table("raw_items")[0].source_unique_id = "different-source"; },
    (store: MemoryStore) => {
      const payload = store.table("ai_outputs")[0].payload as Record<string, unknown>;
      payload.analysis = { monitor_routes: [] };
    },
  ]) {
    const store = parentStore();
    addParent(store, newsPrimary(), PARENT_A, "2026-08-13T00:00:00.000Z", "parent-A");
    mutate(store);
    await assert.rejects(
      createGenericMonitorChildRepository(store).loadExactParent(identity(newsPrimary())),
      /Generic Monitor/,
    );
  }
});

test("running and terminal state contract records applicable/not-applicable success without duplicate output", async () => {
  const store = new MemoryStore();
  const repository = createGenericMonitorChildRepository(store);
  const applicable = identity(newsPrimary());
  await repository.reserve(applicable);
  assert.equal(await repository.claim(applicable), true);
  await repository.recordTerminal(applicable, "succeeded_applicable", {
    finishedAt: "2026-08-13T01:00:00.000Z",
  });
  await repository.recordTerminal(applicable, "succeeded_applicable", {
    finishedAt: "2026-08-13T01:00:00.000Z",
  });
  assert.equal(store.table("ai_outputs").length, 1);
  assert.equal(store.table("ai_runs")[0].status, "completed");
  assert.equal(metadata(store.table("ai_runs")[0]).execution_state, "succeeded_applicable");

  const notApplicable = identity(newsPrimary(), { attempt: { kind: "retry", key: "retry:not-applicable" } });
  await repository.reserve(notApplicable);
  await repository.recordTerminal(notApplicable, "succeeded_not_applicable");
  assert.equal(store.table("ai_outputs").length, 2);
  assert.equal(store.table("ai_runs")[1].status, "completed");
  assert.equal(store.table("ai_runs")[1].error_message, null);
  assert.equal(metadata(store.table("ai_runs")[1]).execution_state, "succeeded_not_applicable");
});

test("successful terminal output failure leaves the run retryable instead of completed", async () => {
  const store = new MemoryStore();
  const repository = createGenericMonitorChildRepository(store);
  const child = identity(newsPrimary());
  await repository.reserve(child);
  await repository.claim(child);
  store.failNextAiOutputUpsert = true;

  await assert.rejects(
    repository.recordTerminal(child, "succeeded_applicable"),
    /terminal execution output write failed/,
  );
  assert.equal(store.table("ai_runs")[0].status, "running");
  assert.equal(store.table("ai_outputs").length, 0);

  await repository.recordTerminal(child, "succeeded_applicable");
  assert.equal(store.table("ai_runs")[0].status, "completed");
  assert.equal(store.table("ai_outputs").length, 1);
});

test("terminal run update failure remains fail-closed and retry completes without duplicate output", async () => {
  const store = new MemoryStore();
  const repository = createGenericMonitorChildRepository(store);
  const child = identity(newsPrimary());
  await repository.reserve(child);
  await repository.claim(child);
  store.failNextTerminalUpdate = true;

  await assert.rejects(
    repository.recordTerminal(child, "succeeded_not_applicable"),
    /succeeded_not_applicable transition failed/,
  );
  assert.equal(store.table("ai_runs")[0].status, "running");
  assert.equal(store.table("ai_outputs").length, 1);

  await repository.recordTerminal(child, "succeeded_not_applicable");
  assert.equal(store.table("ai_runs")[0].status, "completed");
  assert.equal(store.table("ai_outputs").length, 1);
});

test("failed and stale child state mutations leave Primary event, score, signal, summary, and parent run unchanged", async () => {
  const store = parentStore();
  addParent(store, newsPrimary(), PARENT_A, "2026-08-13T00:00:00.000Z", "parent-A");
  Object.assign(store.table("events")[0], {
    score: 88,
    signal: "bullish",
    summary: "Primary stays unchanged",
  });
  const eventBefore = structuredClone(store.table("events")[0]);
  const parentBefore = structuredClone(store.table("ai_runs")[0]);
  const repository = createGenericMonitorChildRepository(store);
  const failed = identity(newsPrimary());
  await repository.reserve(failed);
  await repository.recordTerminal(failed, "failed", { error: new Error("fake handler failure") });
  const stale = identity(newsPrimary(), { attempt: { kind: "retry", key: "retry:stale" } });
  await repository.reserve(stale);
  await repository.recordTerminal(stale, "stale");

  assert.deepEqual(store.table("events")[0], eventBefore);
  assert.deepEqual(store.table("ai_runs")[0], parentBefore);
  assert.equal(store.table("ai_outputs").length, 1);
  assert.equal(store.table("ai_runs")[1].status, "failed");
  assert.equal(store.table("ai_runs")[2].status, "stale");
});

test("News trace return is exposed to both News and Nasdaq callers without changing persistence payloads", () => {
  const source = readFileSync(new URL("../newsIngest.ts", import.meta.url), "utf8");
  assert.equal((source.match(/const aiTrace = await persistAiTrace\(/g) || []).length, 2);
  assert.equal((source.match(/primary_ai_run_id: aiTrace\.aiRunId/g) || []).length, 2);
  assert.match(source, /return \{ aiRunId \};/);
  assert.match(source, /output_type: "news_event_analysis"/);
  assert.match(source, /payload: \{\s*analysis,\s*output_text: outputText,/);
});

test("SEC accepted Primary keeps alert and Offering wiring while adding isolated generic fan-out", () => {
  const sec = readFileSync(new URL("../secFilingAnalysisIngest.ts", import.meta.url), "utf8");
  const offering = readFileSync(new URL("../offeringMonitorJobStarter.ts", import.meta.url), "utf8");
  const workflow = readFileSync(new URL("../../workflows/source-ingest.ts", import.meta.url), "utf8");
  assert.match(sec, /primaryAiRunId: aiTrace\.aiRunId/);
  assert.ok(sec.indexOf("const alertDelivery =") < sec.indexOf("const genericMonitorChildren = await"));
  assert.match(sec, /enqueueGenericMonitorChildrenAfterPrimary/);
  assert.match(offering, /enqueueOfferingMonitorAfterPrimary/);
  assert.match(workflow, /enqueueOfferingMonitorJobStep/);
  assert.doesNotMatch(workflow, /genericMonitorChildRepository|reserveGenericMonitorChildren/);
});

test("Supabase adapter binds generic durable state without coupling reservation to provider semantics", () => {
  const adapter = readFileSync(new URL("./genericMonitorChildSupabaseRepository.ts", import.meta.url), "utf8");
  const foundation = readFileSync(new URL("./genericMonitorChildExecution.ts", import.meta.url), "utf8");
  const repository = readFileSync(new URL("./genericMonitorChildRepository.ts", import.meta.url), "utf8");
  assert.match(adapter, /supabaseSelect, supabaseUpdate, supabaseUpsert/);
  assert.match(repository, /resolution=ignore-duplicates,return=representation/);
  assert.match(repository, /"ai_runs"/);
  assert.match(repository, /"ai_outputs"/);
  const productionSource = `${foundation}\n${repository}\n${adapter}`;
  for (const forbiddenCall of [
    ["runStructured", "GeminiJson"].join(""),
    ["runListingRisk", "DomainAnalyzer"].join(""),
    ["use", "workflow"].join(" "),
  ]) {
    assert.equal(productionSource.includes(forbiddenCall), false);
  }
  for (const forbiddenBoundary of [
    ["listingRisk", "Facts"].join(""),
    ["event", "form"].join("_"),
    "matcher",
    ["alert", "delivery"].join("_"),
  ]) {
    assert.equal(productionSource.toLowerCase().includes(forbiddenBoundary.toLowerCase()), false);
  }
});

function identity(
  primary: GenericMonitorPrimaryExecutionContext,
  options: {
    analyzerContractVersions?: { listing_risk?: string };
    attempt?: { kind: "automatic"; key: "automatic" } | { kind: "retry"; key: string };
  } = {},
) {
  const identities = buildGenericMonitorChildIdentities({
    primary,
    monitorRouting: LISTING_ROUTE,
    analyzerContractVersions: options.analyzerContractVersions,
    attempt: options.attempt,
    now: "2026-08-13T00:00:00.000Z",
  });
  assert.equal(identities.length, 1);
  return identities[0];
}

function newsPrimary(
  overrides: Partial<GenericMonitorPrimaryExecutionContext> = {},
): GenericMonitorPrimaryExecutionContext {
  return {
    eventId: EVENT_ID,
    rawItemId: RAW_ID,
    sourceFamily: "news",
    sourceGroup: "news",
    sourceCode: "globe",
    sourceIdentity: "news-article-1",
    parentPrimaryAiRunId: PARENT_A,
    parentPromptKey: "news_event_analysis",
    parentPromptVersion: "v27-monitor-routing",
    ...overrides,
  };
}

function nasdaqPrimary(): GenericMonitorPrimaryExecutionContext {
  return {
    ...newsPrimary(),
    sourceFamily: "nasdaq_corporate_actions",
    sourceCode: "nasdaq_corporate_actions",
    sourceIdentity: "nasdaq-action-1",
    parentPromptKey: "nasdaq_corporate_action_analysis",
    parentPromptVersion: "v7-monitor-routing",
  };
}

function secPrimary(): GenericMonitorPrimaryExecutionContext {
  return {
    ...newsPrimary(),
    sourceFamily: "sec_8k_6k",
    sourceGroup: "filings",
    sourceCode: "sec_edgar",
    sourceIdentity: "0001437749-26-021738",
    parentPromptKey: "sec_8k_6k_analysis_listing_financial_risk",
    parentPromptVersion: "v44-monitor-routing",
  };
}

function parentStore(primary = newsPrimary()) {
  const store = new MemoryStore();
  store.table("events").push({
    id: primary.eventId,
    raw_item_id: primary.rawItemId,
    source_code: primary.sourceCode,
    source_group: primary.sourceGroup,
  });
  store.table("raw_items").push({
    id: primary.rawItemId,
    source_code: primary.sourceCode,
    source_group: primary.sourceGroup,
    source_unique_id: primary.sourceIdentity,
  });
  return store;
}

function addParent(
  store: MemoryStore,
  primary: GenericMonitorPrimaryExecutionContext,
  id: string,
  finishedAt: string,
  marker: string,
) {
  store.table("ai_runs").push({
    id,
    event_id: primary.eventId,
    raw_item_id: primary.rawItemId,
    prompt_key: primary.parentPromptKey,
    prompt_version: primary.parentPromptVersion,
    model: "gemini-test",
    status: "completed",
    started_at: finishedAt,
    finished_at: finishedAt,
    usage: {},
    error_message: null,
    metadata: {},
  });
  store.table("ai_outputs").push({
    id: id.replace(/^./, id[0] === "5" ? "7" : "8"),
    ai_run_id: id,
    event_id: primary.eventId,
    output_type: primary.sourceFamily === "sec_8k_6k"
      ? primary.parentPromptKey
      : "news_event_analysis",
    payload: {
      analysis: {
        marker,
        monitor_routes: [{ monitor_analyzer_key: "listing_risk" }],
      },
      output_text: marker,
    },
    created_at: finishedAt,
  });
}

function metadata(row: Record<string, unknown>) {
  return row.metadata as Record<string, unknown>;
}

class MemoryStore implements GenericMonitorChildStore {
  private readonly tables = new Map<string, Array<Record<string, unknown>>>();
  readonly selectCalls: Array<{ table: string; search: Record<string, string> }> = [];
  failNextAiOutputUpsert = false;
  failNextTerminalUpdate = false;

  table(name: string) {
    if (!this.tables.has(name)) this.tables.set(name, []);
    return this.tables.get(name)!;
  }

  async select(table: string, search: Record<string, string>) {
    this.selectCalls.push({ table, search: { ...search } });
    let candidates = this.table(table).filter((row) => matches(row, search));
    if (search.order?.startsWith("finished_at.desc")) {
      candidates = [...candidates].sort((left, right) =>
        `${right.finished_at || right.started_at || ""}`.localeCompare(`${left.finished_at || left.started_at || ""}`));
    }
    const limit = Number(search.limit || candidates.length);
    return { ok: true, status: 200, data: candidates.slice(0, limit).map((row) => structuredClone(row)) };
  }

  async upsert(
    table: string,
    payload: Record<string, unknown>,
    options: { onConflict?: string; prefer?: string } = {},
  ) {
    if (table === "ai_outputs" && this.failNextAiOutputUpsert) {
      this.failNextAiOutputUpsert = false;
      return { ok: false, status: 500, data: null, error: "fake output write failure" };
    }
    const target = this.table(table);
    const existing = target.find((row) => row.id === payload.id);
    if (existing && options.prefer?.includes("ignore-duplicates")) {
      return { ok: true, status: 200, data: [] };
    }
    if (existing) Object.assign(existing, structuredClone(payload));
    else target.push(structuredClone(payload));
    return { ok: true, status: 201, data: [structuredClone(payload)] };
  }

  async update(
    table: string,
    search: Record<string, string>,
    payload: Record<string, unknown>,
  ) {
    if (table === "ai_runs" && payload.status === "completed" && this.failNextTerminalUpdate) {
      this.failNextTerminalUpdate = false;
      return { ok: false, status: 500, data: null, error: "fake terminal update failure" };
    }
    const changed = this.table(table).filter((row) => matches(row, search));
    changed.forEach((row) => Object.assign(row, structuredClone(payload)));
    return { ok: true, status: 200, data: changed.map((row) => structuredClone(row)) };
  }
}

function matches(row: Record<string, unknown>, search: Record<string, string>) {
  return Object.entries(search).every(([key, filter]) => {
    if (["select", "order", "limit", "offset"].includes(key)) return true;
    const metadataKey = key.startsWith("metadata->>") ? key.slice("metadata->>".length) : null;
    const value = metadataKey ? metadata(row)[metadataKey] : row[key];
    if (filter.startsWith("eq.")) return String(value ?? "") === filter.slice(3);
    if (filter.startsWith("in.(") && filter.endsWith(")")) {
      return filter.slice(4, -1).split(",").includes(String(value ?? ""));
    }
    return true;
  });
}
