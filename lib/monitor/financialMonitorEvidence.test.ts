import assert from "node:assert/strict";
import test from "node:test";
import { periodicFinancialAuditSample, preparePeriodicFinancialAuditSample } from "./periodicFinancialAuditFixture.testSupport.ts";
import { resolvePeriodicFinancials } from "../sec-structured-data/periodicFinancialResolver.ts";
import { buildPeriodicFinancialMonitorAnalysis } from "./periodicFinancialMonitor.ts";
import { evaluateFinancialMonitorConditions } from "../financialMonitorMatcher.ts";
import { buildFinancialMonitorEvidence, readFinancialMonitorEvidence } from "./financialMonitorEvidence.ts";
import { formatFinancialAmount, FINANCIAL_SCOPE, FINANCIAL_FIELDS } from "./financialMonitorDisplay.ts";
import { listFinancialMonitorAlertsForOwner } from "./financialMonitorAlertConsumer.ts";

const id = "97000000-0000-4000-8000-000000000001";
function facts() {
  const a = periodicFinancialAuditSample("AAPL 2025 10-K");
  return { status: "available" as const, version: "financial_monitor_fact_reader_v1" as const, eventId: id, rawItemId: id, sourceExecutionId: id,
    accession: a.accession, issuerCik: a.cik, form: a.form, persistedAt: "2026-10-14T00:00:00Z",
    analysis: buildPeriodicFinancialMonitorAnalysis(resolvePeriodicFinancials({ issuerCik: a.cik, targetAccession: a.accession, ...preparePeriodicFinancialAuditSample(a) })) };
}
const conditions = [{ key: "financial.revenue.annual.current", operator: "gte" as const, value: "10000000", currency: "USD" }];

test("snapshot freezes exact matched values, periods, conditions and both source references", () => {
  const f = facts(), c = structuredClone(conditions);
  assert.equal(evaluateFinancialMonitorConditions(f, c).status, "match");
  const saved = buildFinancialMonitorEvidence(f, c, "2026-10-14T00:00:00Z", "Audited fixture");
  const actual = saved.matches[0].actual;
  c[0].value = "900719925474099300001";
  f.analysis.comparisons[0].current.normalizedValue = "0";
  assert.equal(saved.matches[0].condition.value, "10000000");
  assert.equal(saved.matches[0].actual, actual);
  assert(saved.matches[0].current.filingFacts[0].hash);
  assert(saved.matches[0].current.companyFacts[0].path);
  assert.equal(readFinancialMonitorEvidence(saved, { ...f }).status, "stored");
});

test("YoY copies the existing exact change and current/prior-year periods without recalculation", () => {
  const f = facts(), row = f.analysis.comparisons.find(c => c.metric === "REVENUE")!;
  assert.equal(row.change.status, "AVAILABLE");
  const c = [{ ...conditions[0], key: "financial.revenue.annual.yoy_change", value: "0" }];
  assert.equal(evaluateFinancialMonitorConditions(f, c).status, "match");
  const saved = buildFinancialMonitorEvidence(f, c, "2026-10-14T00:00:00Z", null);
  assert.equal(saved.matches[0].actual, row.change.status === "AVAILABLE" ? row.change.absoluteChange : null);
  assert.deepEqual(saved.matches[0].priorYear?.period, row.priorYear?.period);
});

test("legacy, malformed, foreign lineage and unsafe source links fail closed", () => {
  const f = facts(), saved = buildFinancialMonitorEvidence(f, conditions, "2026-10-14T00:00:00Z", null);
  assert.equal(readFinancialMonitorEvidence(null, f).status, "not_preserved");
  assert.equal(readFinancialMonitorEvidence({}, f).status, "invalid");
  assert.equal(readFinancialMonitorEvidence(saved, { ...f, accession: "0000000000-26-000001" }).status, "invalid");
  saved.matches[0].current.filingFacts[0].url = "javascript:alert(1)";
  assert.equal(readFinancialMonitorEvidence(saved, f).status, "invalid");
});

test("unavailable YoY evidence cannot fall back to the current value", () => {
  const f = facts(), row = f.analysis.comparisons.find(c => c.metric === "REVENUE")!;
  row.change = { status: "UNAVAILABLE", reason: "PRIOR_YEAR_COMPARABLE_NOT_FOUND" };
  row.priorYear = null;
  const c = [{ ...conditions[0], key: "financial.revenue.annual.yoy_change" }];
  assert.equal(evaluateFinancialMonitorConditions(f, c).status, "ineligible");
  assert.throws(() => buildFinancialMonitorEvidence(f, c, "2026-10-14T00:00:00Z", null));
});

test("owner-scoped read errors are not empty results and snapshots need no current Monitor", async () => {
  const f = facts(), evidence = buildFinancialMonitorEvidence(f, conditions, "2026-10-14T00:00:00Z", null);
  const alerts = await listFinancialMonitorAlertsForOwner({ ownerId: id }, { list: async input => {
    assert.equal(input.ownerId, id);
    return { ok: true, data: [{ id, alert_event_id: id, financial_monitor_id: id, financial_source_execution_id: id, financial_accession: f.accession, financial_issuer_cik: f.issuerCik, created_at: f.persistedAt, financial_match_evidence: evidence }] };
  } });
  assert.equal(alerts[0].display.status, "stored");
  await assert.rejects(listFinancialMonitorAlertsForOwner({ ownerId: id }, { list: async () => ({ ok: false, status: 403, data: null }) }), /403/);
});

test("financial display never rounds exact decimals or implies an issuer target", () => {
  assert.equal(formatFinancialAmount("9007199254740993.123456789", "CAD"), "CAD 9,007,199,254,740,993.123456789");
  assert.equal(formatFinancialAmount("-10925000.00", "USD"), "USD -10,925,000.00");
  assert.match(FINANCIAL_SCOPE, /does not target a particular company or ticker/);
  assert(FINANCIAL_FIELDS.every(f => f.monitorDomains?.includes("financial")));
});
