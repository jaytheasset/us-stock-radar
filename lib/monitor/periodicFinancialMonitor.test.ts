import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildPeriodicFinancialMonitorChildIdentity } from "./genericMonitorChildExecution.ts";
import {
  createGenericMonitorChildRepository,
  type GenericMonitorChildStore,
} from "./genericMonitorChildRepository.ts";
import { processPeriodicFinancialMonitorChild } from "./genericMonitorChildRuntime.ts";
import {
  assertPeriodicFinancialMonitorAnalysisIdentity,
  buildPeriodicFinancialMonitorAnalysis,
  PERIODIC_FINANCIAL_MONITOR_ANALYZER_KEY,
  readPeriodicFinancialRawFilingIdentity,
  subtractExactDecimals,
  type PeriodicFinancialMonitorAnalysis,
} from "./periodicFinancialMonitor.ts";
import {
  periodicFinancialAuditSample,
  preparePeriodicFinancialAuditSample,
} from "./periodicFinancialAuditFixture.testSupport.ts";
import { resolvePeriodicFinancials } from "../sec-structured-data/periodicFinancialResolver.ts";

const EVENT_ID = "92000000-0000-4000-8000-000000000001";
const RAW_ID = "92000000-0000-4000-8000-000000000002";
const PARENT_ID = "92000000-0000-4000-8000-000000000003";

test("official Apple 10-Q enters Monitor as separate quarter/YTD comparisons without inventing quarter OCF", () => {
  const analysis = analyze("AAPL 2026 Q3 10-Q");
  assert.equal(analysis.gptDependency, false);
  assert.equal(analysis.calculationSource, "periodic-financial-resolver-v1");
  assert.deepEqual(
    comparisons(analysis, "REVENUE").map((row) => row.basis).sort(),
    ["QUARTER", "YEAR_TO_DATE"],
  );
  assert.deepEqual(
    comparisons(analysis, "REVENUE").map((row) => row.change).map((change) =>
      change.status === "AVAILABLE" ? [change.absoluteChange, change.direction] : null),
    [["15381000000", "INCREASED"], ["50662000000", "INCREASED"]],
  );
  const ocf = comparisons(analysis, "OPERATING_CASH_FLOW");
  assert.equal(ocf.length, 1);
  assert.equal(ocf[0]!.basis, "YEAR_TO_DATE");
  assert.equal(analysis.comparisons.some((row) =>
    row.metric === "OPERATING_CASH_FLOW" && row.basis === "QUARTER"), false);
  const cash = onlyComparison(analysis, "CASH");
  assert.equal(cash.current.normalizedValue, "39544000000");
  assert.deepEqual(cash.change, {
    status: "UNAVAILABLE",
    reason: "PRIOR_YEAR_COMPARABLE_NOT_FOUND",
  });
});

test("official Apple 10-K preserves annual/instant facts and exact source provenance", () => {
  const analysis = analyze("AAPL 2025 10-K");
  assert.equal(analysis.resultStatus, "AVAILABLE");
  assert.equal(analysis.comparisons.length, 5);
  assert.deepEqual(onlyComparison(analysis, "REVENUE").change, {
    status: "AVAILABLE",
    absoluteChange: "25126000000",
    direction: "INCREASED",
  });
  assert.deepEqual(onlyComparison(analysis, "OPERATING_INCOME_LOSS").change, {
    status: "AVAILABLE",
    absoluteChange: "9834000000",
    direction: "IMPROVED",
  });
  assert.deepEqual(onlyComparison(analysis, "OPERATING_CASH_FLOW").change, {
    status: "AVAILABLE",
    absoluteChange: "-6772000000",
    direction: "DECREASED",
  });
  const cash = onlyComparison(analysis, "CASH");
  assert.equal(cash.basis, "INSTANT");
  assert.equal(cash.current.currency, "USD");
  assert.equal(cash.current.filingFacts[0]!.source.accession, analysis.targetAccession);
  assert.equal(cash.current.filingFacts[0]!.source.contentHash.length, 64);
  assert.match(cash.current.companyFacts[0]!.sourceFactPath, /^facts\.us-gaap\./);
});

test("official Wix 20-F uses resolver-proven US-GAAP and sign-aware income worsening", () => {
  const analysis = analyze("WIX 2025 20-F US-GAAP FPI");
  assert.equal(analysis.comparisons.length, 5);
  assert.equal(analysis.comparisons.every((row) => row.current.taxonomy === "us-gaap"), true);
  assert.deepEqual(onlyComparison(analysis, "OPERATING_INCOME_LOSS").change, {
    status: "AVAILABLE",
    absoluteChange: "-98389000",
    direction: "WORSENED",
  });
  assert.deepEqual(onlyComparison(analysis, "NET_INCOME_LOSS").change, {
    status: "AVAILABLE",
    absoluteChange: "-87676000",
    direction: "WORSENED",
  });
});

test("official TD 40-F keeps unsupported operating income unavailable and does not mask an OCF sign change", () => {
  const analysis = analyze("Toronto-Dominion Bank 2025 40-F IFRS");
  assert.equal(analysis.resultStatus, "PARTIAL");
  assert.deepEqual(analysis.comparisons.map((row) => row.metric).sort(), [
    "CASH", "NET_INCOME_LOSS", "OPERATING_CASH_FLOW", "REVENUE",
  ]);
  const operating = analysis.unavailable.find((row) => row.metric === "OPERATING_INCOME_LOSS")!;
  assert.equal(operating.reason, "STANDARD_OR_REVIEWED_CONCEPT_NOT_FOUND");
  const ocf = onlyComparison(analysis, "OPERATING_CASH_FLOW");
  assert.deepEqual(ocf.change, {
    status: "AVAILABLE",
    absoluteChange: "-124583000000",
    direction: "DECREASED",
  });
  assert.doesNotMatch(JSON.stringify(ocf), /percent/i);
  const cash = onlyComparison(analysis, "CASH");
  assert.deepEqual(
    cash.current.filingFacts.map((fact) => fact.source.documentName).sort(),
    ["ex992.htm", "ex993.htm"],
  );
});

test("normalization fails closed for period and source-provenance mismatches", () => {
  const resolved = resolution("AAPL 2025 10-K");
  const revenue = resolved.decisions.find((row) => row.status === "RESOLVED" && row.metric === "REVENUE")!;
  assert.equal(revenue.status, "RESOLVED");
  const mismatchedPeriod = structuredClone(resolved);
  const periodRevenue = mismatchedPeriod.decisions.find((row) => row.status === "RESOLVED" && row.metric === "REVENUE")!;
  if (periodRevenue.status === "RESOLVED" && periodRevenue.priorYear) {
    periodRevenue.priorYear.basis = "YEAR_TO_DATE";
  }
  assert.deepEqual(onlyComparison(buildPeriodicFinancialMonitorAnalysis(mismatchedPeriod), "REVENUE").change, {
    status: "UNAVAILABLE",
    reason: "LIKE_FOR_LIKE_MISMATCH",
  });

  const mismatchedSource = structuredClone(resolved);
  const sourceRevenue = mismatchedSource.decisions.find((row) => row.status === "RESOLVED" && row.metric === "REVENUE")!;
  if (sourceRevenue.status === "RESOLVED") {
    sourceRevenue.current.filingFacts[0]!.source.contentHash = "";
  }
  assert.deepEqual(onlyComparison(buildPeriodicFinancialMonitorAnalysis(mismatchedSource), "REVENUE").change, {
    status: "UNAVAILABLE",
    reason: "INVALID_CANONICAL_PROVENANCE",
  });
});

test("resolver-wide XBRL unavailability marks all five metrics unavailable without throwing", () => {
  const audited = periodicFinancialAuditSample("AAPL 2025 10-K");
  const prepared = preparePeriodicFinancialAuditSample(audited);
  const resolved = resolvePeriodicFinancials({
    issuerCik: audited.cik,
    targetAccession: audited.accession,
    filings: prepared.filings,
    companyFacts: prepared.companyFacts,
    filingXbrl: {
      status: "UNAVAILABLE",
      reason: "FILING_ARTIFACT_MISSING",
      detail: "fixture source unavailable",
      sources: [],
    },
  });
  const analysis = buildPeriodicFinancialMonitorAnalysis(resolved);
  assert.equal(analysis.resultStatus, "UNAVAILABLE");
  assert.equal(analysis.comparisons.length, 0);
  assert.equal(analysis.unavailable.length, 5);
  assert.equal(analysis.unavailable.every((row) => row.reason === "FILING_XBRL_UNAVAILABLE"), true);
});

test("financial child persists canonical analysis with zero GPT calls and replay is duplicate-safe", async () => {
  const identity = periodicIdentity();
  const analysis = analyze("AAPL 2025 10-K");
  const primaryAnalysis = { narrative: "unchanged Primary", score: 91 };
  const primaryBefore = structuredClone(primaryAnalysis);
  let claimed = true;
  const terminal: Array<{ state: string; payload?: unknown }> = [];
  const repository = {
    async claim() {
      if (!claimed) return false;
      claimed = false;
      return true;
    },
    async loadExactParent() {
      return {
        aiRun: {}, aiOutput: {}, event: {}, analysis: primaryAnalysis,
        rawItem: periodicRawItem("AAPL 2025 10-K"),
        currentness: { status: "stale", latestPrimaryAiRunId: "new-primary-is-independent" },
      } as const;
    },
    async recordTerminal(_identity: unknown, state: string, options?: { outputPayload?: unknown }) {
      terminal.push({ state, payload: options?.outputPayload });
    },
    async releaseForRetry() {
      throw new Error("unexpected retry");
    },
  };
  const first = await processPeriodicFinancialMonitorChild(identity, {
    repository: repository as never,
    resolveAnalysis: async () => analysis,
  });
  const replay = await processPeriodicFinancialMonitorChild(identity, {
    repository: repository as never,
    resolveAnalysis: async () => { throw new Error("duplicate must not resolve"); },
  });
  assert.equal(first.providerCalls, 0);
  assert.equal(first.status, "succeeded_applicable");
  assert.equal(replay.status, "duplicate");
  assert.equal(terminal.length, 1);
  assert.equal((terminal[0]!.payload as PeriodicFinancialMonitorAnalysis).calculationSource,
    "periodic-financial-resolver-v1");
  assert.deepEqual(primaryAnalysis, primaryBefore);
});

test("Apple 10-K job rejects an Apple 10-Q raw-payload accession and later accepts the correct filing", async () => {
  const identity = periodicIdentityFor("AAPL 2025 10-K");
  const wrongRaw = periodicRawItem("AAPL 2025 10-K");
  const apple10q = periodicFinancialAuditSample("AAPL 2026 Q3 10-Q");
  const wrongPayload = wrongRaw.raw_payload as Record<string, unknown>;
  wrongPayload.accession_number = apple10q.accession;
  wrongPayload.form_type = apple10q.form;
  const harness = periodicRuntimeHarness(wrongRaw);
  let resolverCalls = 0;
  const rejected = await processPeriodicFinancialMonitorChild(identity, {
    repository: harness.repository as never,
    resolveAnalysis: async () => {
      resolverCalls += 1;
      return analyze("AAPL 2026 Q3 10-Q");
    },
  });
  assert.equal(rejected.status, "retryable_failure");
  assert.equal(rejected.jobId, identity.executionId);
  assert.match(rejected.error, /accession identity mismatch/);
  assert.equal(resolverCalls, 0);
  assert.deepEqual(harness.snapshot(), { state: "pending", outputs: 0, releases: 1 });

  harness.setRawItem(periodicRawItem("AAPL 2025 10-K"));
  const accepted = await processPeriodicFinancialMonitorChild(identity, {
    repository: harness.repository as never,
    resolveAnalysis: async () => analyze("AAPL 2025 10-K"),
  });
  assert.equal(accepted.status, "succeeded_applicable");
  assert.equal(accepted.jobId, identity.executionId);
  assert.deepEqual(harness.snapshot(), { state: "completed", outputs: 1, releases: 1 });
  assert.equal(harness.outputAnalysis()?.targetAccession, identity.sourceIdentity);
});

test("production repository releases a mismatched filing for same-job recovery and one-output replay", async () => {
  const identity = periodicIdentityFor("AAPL 2025 10-K");
  const wrongRaw = periodicRawItem("AAPL 2025 10-K");
  const apple10q = periodicFinancialAuditSample("AAPL 2026 Q3 10-Q");
  Object.assign(wrongRaw.raw_payload as Record<string, unknown>, {
    accession_number: apple10q.accession,
    form_type: apple10q.form,
  });
  const store = productionRepositoryStore(identity, wrongRaw);
  const storedRaw = store.table("raw_items").find((row) => row.id === identity.rawItemId)!;
  assert.equal(storedRaw.source_unique_id, identity.sourceIdentity);
  assert.equal((storedRaw.raw_payload as Record<string, unknown>).accession_number, apple10q.accession);
  assert.notEqual((storedRaw.raw_payload as Record<string, unknown>).accession_number, identity.sourceIdentity);
  const repository = createGenericMonitorChildRepository(store);
  const reservation = await repository.reserve(identity);
  assert.equal(reservation.reserved, true);
  assert.deepEqual(childState(store, identity.executionId), {
    status: "pending",
    executionState: "reserved",
    terminalOutputs: 0,
  });

  const rejected = await processPeriodicFinancialMonitorChild(identity, {
    repository,
    resolveAnalysis: async () => analyze("AAPL 2026 Q3 10-Q"),
  });
  assert.equal(rejected.status, "retryable_failure");
  assert.equal(rejected.jobId, identity.executionId);
  assert.match(rejected.error, /accession identity mismatch/);
  assert.deepEqual(childState(store, identity.executionId), {
    status: "pending",
    executionState: "reserved",
    terminalOutputs: 0,
  });

  store.replaceRawPayload(identity.rawItemId, periodicRawItem("AAPL 2025 10-K").raw_payload);
  assert.equal(storedRaw.source_unique_id, identity.sourceIdentity);
  assert.equal((storedRaw.raw_payload as Record<string, unknown>).accession_number, identity.sourceIdentity);
  const accepted = await processPeriodicFinancialMonitorChild(identity, {
    repository,
    resolveAnalysis: async () => analyze("AAPL 2025 10-K"),
  });
  assert.equal(accepted.status, "succeeded_applicable");
  assert.equal(accepted.jobId, identity.executionId);
  assert.equal(accepted.jobId, rejected.jobId);
  assert.deepEqual(childState(store, identity.executionId), {
    status: "completed",
    executionState: "succeeded_applicable",
    terminalOutputs: 1,
  });
  assert.equal(childOutputAnalysis(store)?.targetAccession, identity.sourceIdentity);

  const replay = await processPeriodicFinancialMonitorChild(identity, {
    repository,
    resolveAnalysis: async () => { throw new Error("completed replay must not resolve"); },
  });
  assert.equal(replay.status, "duplicate");
  assert.equal(replay.jobId, identity.executionId);
  assert.equal(replay.jobId, accepted.jobId);
  assert.deepEqual(childState(store, identity.executionId), {
    status: "completed",
    executionState: "succeeded_applicable",
    terminalOutputs: 1,
  });
});

test("Wix 20-F job rejects a different raw-payload accession without writing an output", async () => {
  const identity = periodicIdentityFor("WIX 2025 20-F US-GAAP FPI");
  const wrongRaw = periodicRawItem("WIX 2025 20-F US-GAAP FPI");
  (wrongRaw.raw_payload as Record<string, unknown>).accession_number =
    periodicFinancialAuditSample("AAPL 2025 10-K").accession;
  const harness = periodicRuntimeHarness(wrongRaw);
  const result = await processPeriodicFinancialMonitorChild(identity, {
    repository: harness.repository as never,
    resolveAnalysis: async () => analyze("WIX 2025 20-F US-GAAP FPI"),
  });
  assert.equal(result.status, "retryable_failure");
  assert.equal(result.jobId, identity.executionId);
  assert.match(result.error, /accession identity mismatch/);
  assert.deepEqual(harness.snapshot(), { state: "pending", outputs: 0, releases: 1 });
});

test("matching raw identities reject an analysis for another filing before terminal output persistence", async () => {
  const identity = periodicIdentityFor("AAPL 2025 10-K");
  const harness = periodicRuntimeHarness(periodicRawItem("AAPL 2025 10-K"));
  const result = await processPeriodicFinancialMonitorChild(identity, {
    repository: harness.repository as never,
    resolveAnalysis: async () => analyze("AAPL 2026 Q3 10-Q"),
  });
  assert.equal(result.status, "retryable_failure");
  assert.equal(result.jobId, identity.executionId);
  assert.match(result.error, /analysis filing identity mismatch/);
  assert.deepEqual(harness.snapshot(), { state: "pending", outputs: 0, releases: 1 });
});

test("raw filing identity captures exact source/payload accession, CIK, and form for result reconciliation", () => {
  const rawItem = periodicRawItem("AAPL 2025 10-K");
  const expected = periodicFinancialAuditSample("AAPL 2025 10-K");
  assert.deepEqual(readPeriodicFinancialRawFilingIdentity(rawItem, expected.accession), {
    accession: expected.accession,
    issuerCik: expected.cik,
    form: expected.form,
  });
  (rawItem.raw_payload as Record<string, unknown>).cik = "0001628280";
  const wrongCik = readPeriodicFinancialRawFilingIdentity(rawItem, expected.accession);
  assert.throws(
    () => assertPeriodicFinancialMonitorAnalysisIdentity(analyze("AAPL 2025 10-K"), wrongCik),
    /analysis filing identity mismatch/,
  );
  (rawItem.raw_payload as Record<string, unknown>).cik = expected.cik;
  (rawItem.raw_payload as Record<string, unknown>).form_type = "10-Q";
  const wrongForm = readPeriodicFinancialRawFilingIdentity(rawItem, expected.accession);
  assert.throws(
    () => assertPeriodicFinancialMonitorAnalysisIdentity(analyze("AAPL 2025 10-K"), wrongForm),
    /analysis filing identity mismatch/,
  );
});

test("periodic job identity ignores Primary replay identity while preserving filing lineage", () => {
  const first = periodicIdentity();
  const replay = buildPeriodicFinancialMonitorChildIdentity({
    primary: { ...primary(), parentPrimaryAiRunId: "92000000-0000-4000-8000-000000000099" },
    now: "2026-09-01T00:01:00.000Z",
  });
  assert.equal(first.monitorAnalyzerKey, PERIODIC_FINANCIAL_MONITOR_ANALYZER_KEY);
  assert.equal(replay.executionId, first.executionId);
  assert.equal(replay.logicalJobId, first.logicalJobId);
});

test("exact decimal change never passes through JavaScript number", () => {
  assert.equal(subtractExactDecimals("9007199254740993.01", "9007199254740992.99"), "0.02");
  assert.equal(subtractExactDecimals("-5", "-10"), "5");
  assert.equal(subtractExactDecimals("-5", "5"), "-10");
});

test("stored SEC source adapter is read-only and invokes the production resolver/normalizer", () => {
  const source = readFileSync(new URL("./periodicFinancialMonitorSource.ts", import.meta.url), "utf8");
  assert.match(source, /supabaseSelect/);
  assert.match(source, /resolvePeriodicFinancials/);
  assert.match(source, /buildPeriodicFinancialMonitorAnalysis/);
  assert.doesNotMatch(source, /supabase(?:Upsert|Update|Insert|Delete|Rpc)/);
  assert.doesNotMatch(source, /runStructured|OpenAI|Gemini|GPT/);
});

function resolution(label: string) {
  const audited = periodicFinancialAuditSample(label);
  const prepared = preparePeriodicFinancialAuditSample(audited);
  return resolvePeriodicFinancials({
    issuerCik: audited.cik,
    targetAccession: audited.accession,
    ...prepared,
  });
}

function analyze(label: string) {
  return buildPeriodicFinancialMonitorAnalysis(resolution(label));
}

function comparisons(analysis: PeriodicFinancialMonitorAnalysis, metric: string) {
  return analysis.comparisons.filter((row) => row.metric === metric);
}

function onlyComparison(analysis: PeriodicFinancialMonitorAnalysis, metric: string) {
  const rows = comparisons(analysis, metric);
  assert.equal(rows.length, 1, metric);
  return rows[0]!;
}

function primary() {
  return {
    eventId: EVENT_ID,
    rawItemId: RAW_ID,
    sourceFamily: "sec_periodic_reports" as const,
    sourceGroup: "filings" as const,
    sourceCode: "sec_edgar",
    sourceIdentity: "0000320193-25-000079",
    parentPrimaryAiRunId: PARENT_ID,
    parentPromptKey: "sec_periodic_reports_analysis",
    parentPromptVersion: "v13-40f",
  };
}

function periodicIdentity() {
  return buildPeriodicFinancialMonitorChildIdentity({
    primary: primary(),
    now: "2026-09-01T00:00:00.000Z",
  });
}

function periodicIdentityFor(label: string) {
  const audited = periodicFinancialAuditSample(label);
  return buildPeriodicFinancialMonitorChildIdentity({
    primary: {
      ...primary(),
      sourceIdentity: audited.accession,
    },
    now: "2026-09-01T00:00:00.000Z",
  });
}

function periodicRawItem(label: string): Record<string, unknown> {
  const audited = periodicFinancialAuditSample(label);
  return {
    source_unique_id: audited.accession,
    raw_payload: {
      accession_number: audited.accession,
      cik: audited.cik,
      form_type: audited.form,
    },
    metadata: {
      cik: audited.cik,
      formType: audited.form,
    },
  };
}

function periodicRuntimeHarness(initialRawItem: Record<string, unknown>) {
  let state: "pending" | "running" | "completed" = "pending";
  let rawItem = initialRawItem;
  let releases = 0;
  const outputs: PeriodicFinancialMonitorAnalysis[] = [];
  return {
    repository: {
      async claim() {
        if (state !== "pending") return false;
        state = "running";
        return true;
      },
      async loadExactParent() {
        return {
          aiRun: {}, aiOutput: {}, event: {}, analysis: {}, rawItem,
          currentness: { status: "current", latestPrimaryAiRunId: PARENT_ID },
        } as const;
      },
      async recordTerminal(
        _identity: unknown,
        terminalState: string,
        options?: { outputPayload?: unknown },
      ) {
        if (terminalState !== "succeeded_applicable") {
          throw new Error(`unexpected terminal state: ${terminalState}`);
        }
        outputs.push(options?.outputPayload as PeriodicFinancialMonitorAnalysis);
        state = "completed";
      },
      async releaseForRetry() {
        releases += 1;
        state = "pending";
      },
    },
    setRawItem(value: Record<string, unknown>) {
      rawItem = value;
    },
    snapshot: () => ({ state, outputs: outputs.length, releases }),
    outputAnalysis: () => outputs[0],
  };
}

function productionRepositoryStore(
  identity: ReturnType<typeof periodicIdentityFor>,
  rawItem: Record<string, unknown>,
) {
  const store = new PeriodicFinancialRepositoryMemoryStore();
  store.table("events").push({
    id: identity.eventId,
    raw_item_id: identity.rawItemId,
    source_code: identity.sourceCode,
    source_group: identity.sourceGroup,
  });
  store.table("raw_items").push({
    id: identity.rawItemId,
    source_code: identity.sourceCode,
    source_group: identity.sourceGroup,
    ...structuredClone(rawItem),
  });
  store.table("ai_runs").push({
    id: identity.parentPrimaryAiRunId,
    event_id: identity.eventId,
    raw_item_id: identity.rawItemId,
    prompt_key: identity.parentPromptKey,
    prompt_version: identity.parentPromptVersion,
    model: "fixture-primary",
    status: "completed",
    started_at: "2026-09-01T00:00:00.000Z",
    finished_at: "2026-09-01T00:00:01.000Z",
    usage: {},
    error_message: null,
    metadata: {},
  });
  store.table("ai_outputs").push({
    id: "92000000-0000-4000-8000-000000000004",
    ai_run_id: identity.parentPrimaryAiRunId,
    event_id: identity.eventId,
    output_type: identity.parentPromptKey,
    payload: { analysis: { narrative: "independent Primary" } },
    created_at: "2026-09-01T00:00:01.000Z",
  });
  return store;
}

function childState(store: PeriodicFinancialRepositoryMemoryStore, executionId: string) {
  const run = store.table("ai_runs").find((row) => row.id === executionId)!;
  const metadata = run.metadata as Record<string, unknown>;
  return {
    status: run.status,
    executionState: metadata.execution_state,
    terminalOutputs: store.table("ai_outputs").filter((row) =>
      row.output_type === "domain_monitor_child_execution_result").length,
  };
}

function childOutputAnalysis(store: PeriodicFinancialRepositoryMemoryStore) {
  const output = store.table("ai_outputs").find((row) =>
    row.output_type === "domain_monitor_child_execution_result");
  const payload = output?.payload as Record<string, unknown> | undefined;
  return payload?.analysis as PeriodicFinancialMonitorAnalysis | undefined;
}

class PeriodicFinancialRepositoryMemoryStore implements GenericMonitorChildStore {
  private readonly tables = new Map<string, Array<Record<string, unknown>>>();

  table(name: string) {
    if (!this.tables.has(name)) this.tables.set(name, []);
    return this.tables.get(name)!;
  }

  replaceRawPayload(rawItemId: string, rawPayload: unknown) {
    const rawItem = this.table("raw_items").find((row) => row.id === rawItemId);
    if (!rawItem) throw new Error("fixture raw item missing");
    rawItem.raw_payload = structuredClone(rawPayload);
  }

  async select(table: string, search: Record<string, string>) {
    let selected = this.table(table).filter((row) => repositoryStoreMatches(row, search));
    if (search.order?.startsWith("finished_at.desc")) {
      selected = [...selected].sort((left, right) =>
        `${right.finished_at || right.started_at || ""}`
          .localeCompare(`${left.finished_at || left.started_at || ""}`));
    }
    const limit = Number(search.limit || selected.length);
    return {
      ok: true,
      status: 200,
      data: selected.slice(0, limit).map((row) => structuredClone(row)),
    };
  }

  async upsert(
    table: string,
    payload: Record<string, unknown>,
    options: { onConflict?: string; prefer?: string } = {},
  ) {
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
    const changed = this.table(table).filter((row) => repositoryStoreMatches(row, search));
    changed.forEach((row) => Object.assign(row, structuredClone(payload)));
    return {
      ok: true,
      status: 200,
      data: changed.map((row) => structuredClone(row)),
    };
  }
}

function repositoryStoreMatches(row: Record<string, unknown>, search: Record<string, string>) {
  return Object.entries(search).every(([key, filter]) => {
    if (["select", "order", "limit", "offset"].includes(key)) return true;
    const metadataKey = key.startsWith("metadata->>") ? key.slice("metadata->>".length) : null;
    const metadata = row.metadata as Record<string, unknown> | undefined;
    const value = metadataKey ? metadata?.[metadataKey] : row[key];
    if (filter.startsWith("eq.")) return String(value ?? "") === filter.slice(3);
    if (filter.startsWith("in.(") && filter.endsWith(")")) {
      return filter.slice(4, -1).split(",").includes(String(value ?? ""));
    }
    return true;
  });
}
