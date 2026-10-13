import assert from "node:assert/strict";
import test from "node:test";
import { evaluateFinancialMonitorConditions } from "../financialMonitorMatcher.ts";
import { resolvePeriodicFinancials } from "../sec-structured-data/periodicFinancialResolver.ts";
import { getReadyMonitorCondition } from "./conditionRegistry.ts";
import { buildPeriodicFinancialMonitorChildIdentity } from "./genericMonitorChildExecution.ts";
import { consumeFinancialMonitorAlertsForEvent } from "./financialMonitorAlertConsumer.ts";
import { validateCanonicalFinancialConditions } from "./financialMonitorPersistence.ts";
import { buildPeriodicFinancialMonitorAnalysis, compareExactDecimals, readPeriodicFinancialRawFilingIdentity } from "./periodicFinancialMonitor.ts";
import { periodicFinancialAuditSample, preparePeriodicFinancialAuditSample } from "./periodicFinancialAuditFixture.testSupport.ts";
import { processPeriodicFinancialMonitorChild } from "./genericMonitorChildRuntime.ts";

const EVENT_ID = "97000000-0000-4000-8000-000000000001";
const MONITOR_ID = "97000000-0000-4000-8000-000000000002";
const USER_ID = "97000000-0000-4000-8000-000000000003";

test("financial condition registry exposes only resolver-supported metric and period pairs", () => {
  const supported = getReadyMonitorCondition("financial.revenue.quarter.current");
  assert.equal(supported?.valueType, "decimal");
  assert.deepEqual(supported?.monitorDomains, ["financial"]);
  assert.equal(supported?.source.reader, "read_current_event_periodic_financial");
  assert.equal(getReadyMonitorCondition("financial.operating_cash_flow.quarter.current"), null);
});

test("official 10-Q, 10-K, and 20-F resolver facts match current and strict YoY exact-decimal conditions", () => {
  for (const label of ["AAPL 2026 Q3 10-Q", "AAPL 2025 10-K", "WIX 2025 20-F US-GAAP FPI"]) {
    const facts = availableFacts(label);
    const revenue = facts.analysis.comparisons.find((row) => row.metric === "REVENUE" && row.change.status === "AVAILABLE")!;
    const basis = revenue.basis.toLowerCase();
    const conditions = [
      condition(`financial.revenue.${basis}.current`, "eq", revenue.current.normalizedValue, revenue.current.currency),
      condition(`financial.revenue.${basis}.yoy_change`, "eq", revenue.change.status === "AVAILABLE" ? revenue.change.absoluteChange : "0", revenue.current.currency),
    ];
    const result = evaluateFinancialMonitorConditions(facts, conditions, EVENT_ID);
    assert.equal(result.status, "match", `${label}: ${JSON.stringify(result)}`);
  }
});

test("current conditions reject invalid canonical provenance and currency disagreement", () => {
  const facts = structuredClone(availableFacts("AAPL 2025 10-K"));
  const revenue = facts.analysis.comparisons.find((row) => row.metric === "REVENUE")!;
  revenue.current.companyFacts[0]!.unit = "CAD";
  const result = evaluateFinancialMonitorConditions(facts, [
    condition("financial.revenue.annual.current", "gt", "0", "USD"),
  ], EVENT_ID);
  assert.equal(result.status, "ineligible");
  assert.equal(result.reasonCode, "current_provenance_invalid");
});

test("YoY conditions reject same-kind but wrong exact period and current-only stays distinct", () => {
  const facts = structuredClone(availableFacts("AAPL 2025 10-K"));
  const revenue = facts.analysis.comparisons.find((row) => row.metric === "REVENUE")!;
  assert.ok(revenue.priorYear);
  revenue.priorYear.period = structuredClone(revenue.current.period);
  const yoy = evaluateFinancialMonitorConditions(facts, [
    condition("financial.revenue.annual.yoy_change", "gt", "0", "USD"),
  ], EVENT_ID);
  assert.equal(yoy.status, "ineligible");
  assert.equal(yoy.reasonCode, "comparison_identity_mismatch");
  const current = evaluateFinancialMonitorConditions(facts, [
    condition("financial.revenue.annual.current", "gt", "0", "USD"),
  ], EVENT_ID);
  assert.equal(current.status, "match");
});

test("YoY conditions reject tampered deltas and resolver-ineligible duration pairs", () => {
  const deltaFacts = structuredClone(availableFacts("AAPL 2025 10-K"));
  const deltaRevenue = deltaFacts.analysis.comparisons.find((row) => row.metric === "REVENUE")!;
  if (deltaRevenue.change.status !== "AVAILABLE") throw new Error("expected available delta");
  deltaRevenue.change.absoluteChange = "999999999999";
  assert.equal(evaluateFinancialMonitorConditions(deltaFacts, [
    condition("financial.revenue.annual.yoy_change", "eq", "999999999999", "USD"),
  ], EVENT_ID).status, "ineligible");

  const periodFacts = structuredClone(availableFacts("AAPL 2025 10-K"));
  const periodRevenue = periodFacts.analysis.comparisons.find((row) => row.metric === "REVENUE")!;
  assert.ok(periodRevenue.priorYear?.period.kind === "duration");
  const shifted = new Date(`${periodRevenue.priorYear.period.startDate}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + 10);
  periodRevenue.priorYear.period.startDate = shifted.toISOString().slice(0, 10);
  periodRevenue.priorYear.filingFacts.forEach((fact) => {
    if (fact.context.period.kind === "duration") fact.context.period.startDate = periodRevenue.priorYear!.period.kind === "duration" ? periodRevenue.priorYear!.period.startDate : "";
  });
  periodRevenue.priorYear.companyFacts.forEach((fact) => { fact.startDate = periodRevenue.priorYear!.period.kind === "duration" ? periodRevenue.priorYear!.period.startDate : null; });
  assert.equal(evaluateFinancialMonitorConditions(periodFacts, [
    condition("financial.revenue.annual.yoy_change", "gt", "0", "USD"),
  ], EVENT_ID).status, "ineligible");
});

test("thresholds are strict decimal strings and preserve values beyond Number safe integer", () => {
  assert.equal(validateCanonicalFinancialConditions([
    condition("financial.revenue.annual.current", "gt", "9007199254740993.01", "USD"),
  ]).ok, true);
  assert.equal(validateCanonicalFinancialConditions([
    { key: "financial.revenue.annual.current", operator: "gt", value: 9007199254740992, currency: "USD" },
  ]).ok, false);
  const facts = structuredClone(availableFacts("AAPL 2025 10-K"));
  const revenue = facts.analysis.comparisons.find((row) => row.metric === "REVENUE")!;
  assert.equal(compareExactDecimals("9007199254740993.02", "9007199254740993.01"), 1);
  const threshold = `${BigInt(revenue.current.normalizedValue) - BigInt(1)}.999999999999999999`;
  const result = evaluateFinancialMonitorConditions(facts, [
    condition("financial.revenue.annual.current", "gt", threshold, "USD"),
  ], EVENT_ID);
  assert.equal(result.status, "match", JSON.stringify(result));
});

test("stored condition consumer writes once and concurrent/replay calls are duplicate-safe", async () => {
  const facts = availableFacts("AAPL 2025 10-K");
  const monitor = {
    id: MONITOR_ID, userId: USER_ID, target: null, domain: "financial" as const,
    conditions: [condition("financial.revenue.annual.current", "gt", "0", "USD")],
    isActive: true, createdAt: "2026-09-10T00:00:00Z", updatedAt: "2026-09-10T00:00:00Z",
  };
  const ids = new Set<string>();
  const dependencies = {
    readFacts: async () => facts,
    listActiveMonitors: async () => ({ monitors: [monitor], diagnostics: [] }),
    createAlert: async (input: { monitorId: string; eventId: string }) => {
      const key = `${input.monitorId}:${input.eventId}`;
      if (ids.has(key)) return { status: "existing" as const, monitorId: input.monitorId };
      ids.add(key);
      return { status: "created" as const, monitorId: input.monitorId, alertId: "97000000-0000-4000-8000-000000000004" };
    },
    now: () => new Date("2026-09-10T00:00:00Z"),
  };
  const results = await Promise.all([
    consumeFinancialMonitorAlertsForEvent({ eventId: EVENT_ID }, dependencies),
    consumeFinancialMonitorAlertsForEvent({ eventId: EVENT_ID }, dependencies),
  ]);
  assert.equal(results.reduce((sum, item) => sum + item.createdCount, 0), 1);
  assert.equal(results.reduce((sum, item) => sum + item.existingCount, 0), 1);
  assert.equal(ids.size, 1);
});

test("completed child replay retries an isolated consumer failure without rerunning resolver", async () => {
  const audited = periodicFinancialAuditSample("AAPL 2025 10-K");
  const identity = buildPeriodicFinancialMonitorChildIdentity({
    primary: {
      eventId: EVENT_ID,
      rawItemId: "97000000-0000-4000-8000-000000000005",
      sourceFamily: "sec_periodic_reports",
      sourceGroup: "filings",
      sourceCode: "sec_edgar",
      sourceIdentity: audited.accession,
      parentPrimaryAiRunId: "97000000-0000-4000-8000-000000000006",
      parentPromptKey: "sec_periodic_reports_analysis",
      parentPromptVersion: "v13-40f",
    }, now: "2026-09-10T00:00:00Z",
  });
  let completed = false, resolverCalls = 0, consumerCalls = 0;
  const repository = {
    claim: async () => !completed,
    loadExactParent: async () => ({ rawItem: rawItem(audited), aiRun: {}, aiOutput: {}, event: {}, analysis: {}, currentness: { status: "current", latestPrimaryAiRunId: identity.parentPrimaryAiRunId } }),
    recordTerminal: async () => { completed = true; },
    releaseForRetry: async () => { throw new Error("unexpected retry"); },
  };
  const first = await processPeriodicFinancialMonitorChild(identity, {
    repository: repository as never,
    resolveAnalysis: async () => { resolverCalls += 1; return analysis("AAPL 2025 10-K"); },
    consumeFinancialMonitorAlerts: async () => { consumerCalls += 1; throw new Error("first alert write failed"); },
  });
  const replay = await processPeriodicFinancialMonitorChild(identity, {
    repository: repository as never,
    resolveAnalysis: async () => { throw new Error("resolver must not replay"); },
    consumeFinancialMonitorAlerts: async () => { consumerCalls += 1; return completedConsumer(); },
  });
  assert.equal(first.status, "succeeded_applicable");
  assert.equal(first.financialMonitorAlerts.status, "failed");
  assert.equal(replay.status, "duplicate");
  assert.equal(replay.financialMonitorAlerts.status, "completed");
  assert.equal(resolverCalls, 1);
  assert.equal(consumerCalls, 2);
});

test("raw identity fails closed when duplicate CIK or form fields conflict", () => {
  const audited = periodicFinancialAuditSample("AAPL 2025 10-K");
  const raw = rawItem(audited);
  (raw.raw_payload as Record<string, unknown>).issuer_cik = "0001628280";
  assert.throws(() => readPeriodicFinancialRawFilingIdentity(raw, audited.accession), /exact CIK\/form identity/);
  delete (raw.raw_payload as Record<string, unknown>).issuer_cik;
  (raw.metadata as Record<string, unknown>).formType = "10-Q";
  assert.throws(() => readPeriodicFinancialRawFilingIdentity(raw, audited.accession), /exact CIK\/form identity/);
});

function analysis(label: string) {
  const audited = periodicFinancialAuditSample(label);
  return buildPeriodicFinancialMonitorAnalysis(resolvePeriodicFinancials({ issuerCik: audited.cik, targetAccession: audited.accession, ...preparePeriodicFinancialAuditSample(audited) }));
}
function availableFacts(label: string) {
  const audited = periodicFinancialAuditSample(label);
  return {
    status: "available" as const, version: "financial_monitor_fact_reader_v1" as const,
    eventId: EVENT_ID, rawItemId: "97000000-0000-4000-8000-000000000005",
    sourceExecutionId: "97000000-0000-4000-8000-000000000006", persistedAt: "2026-09-10T00:00:00Z",
    accession: audited.accession, issuerCik: audited.cik, form: audited.form, analysis: analysis(label),
  };
}
function condition(key: string, operator: "eq" | "gt", value: string, currency: string) { return { key, operator, value, currency } as const; }
function rawItem(audited: ReturnType<typeof periodicFinancialAuditSample>): Record<string, unknown> {
  return { source_unique_id: audited.accession, raw_payload: { accession_number: audited.accession, cik: audited.cik, form_type: audited.form }, metadata: { cik: audited.cik, formType: audited.form } };
}
function completedConsumer() {
  return {
    version: "financial_monitor_alert_consumer_v1" as const, status: "completed" as const, eventId: EVENT_ID,
    readerStatus: "available" as const, monitorCount: 0, diagnostics: [], evaluations: [], writes: [],
    createdCount: 0, existingCount: 0, failedCount: 0,
  };
}
