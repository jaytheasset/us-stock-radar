import assert from "node:assert/strict";
import test from "node:test";
import { financialTargetSchema, financialTargetSelection } from "./financialMonitorTarget.ts";
import { readFinancialMonitorTarget, verifyFinancialMonitorSelection } from "./financialMonitorTargetReader.ts";
import { financialMonitorTargetFailure } from "./financialMonitorTargetGate.ts";
import { parseFinancialMonitorCreateRequest } from "./financialMonitorApi.ts";
import { createFinancialMonitor, listFinancialMonitorsForOwner } from "./financialMonitorPersistence.ts";
import { consumeFinancialMonitorAlertsForEvent } from "./financialMonitorAlertConsumer.ts";
import { buildFinancialMonitorEvidence, readFinancialMonitorEvidence } from "./financialMonitorEvidence.ts";
import { evaluateFinancialMonitorConditions } from "../financialMonitorMatcher.ts";
import { periodicFinancialAuditSample, preparePeriodicFinancialAuditSample } from "./periodicFinancialAuditFixture.testSupport.ts";
import { resolvePeriodicFinancials } from "../sec-structured-data/periodicFinancialResolver.ts";
import { buildPeriodicFinancialMonitorAnalysis } from "./periodicFinancialMonitor.ts";

const id = "97000000-0000-4000-8000-000000000001", at = "2026-10-14T00:00:00.000Z";
const target = financialTargetSchema.parse({ version: "financial_monitor_target_v1", scope: "issuer", ticker: "AAPL", issuerCik: "0000320193", companyName: "Apple Inc.", exchange: "Nasdaq", sourceRawId: id, refreshSequence: "1", contentHash: "a".repeat(64), confirmedAt: at, verifiedAt: at });
const conditions = [{ key: "financial.revenue.annual.current", operator: "gte" as const, value: "10000000", currency: "USD" }];
const current = { status: "available" as const, cik: target.issuerCik, sourceRawId: id, sourceUrl: `https://data.sec.gov/submissions/CIK${target.issuerCik}.json`, sourceIdentity: "test-current", contentHash: target.contentHash, sourceKind: "submissions" as const, entityName: target.companyName, listings: [{ ticker: "AAPL", exchange: "Nasdaq" }], refreshSequence: "1", confirmedAt: at, firstFetchedAt: at };
const catalog = { ok: true, data: [{ ticker: "AAPL", cik_str: 320193 }] };
function facts(label = "AAPL 2025 10-K") {
  const a = periodicFinancialAuditSample(label);
  return { status: "available" as const, version: "financial_monitor_fact_reader_v1" as const, eventId: id, rawItemId: id, sourceExecutionId: id, accession: a.accession, issuerCik: a.cik, form: a.form, persistedAt: at,
    analysis: buildPeriodicFinancialMonitorAnalysis(resolvePeriodicFinancials({ issuerCik: a.cik, targetAccession: a.accession, ...preparePeriodicFinancialAuditSample(a) })) };
}
test("target reader reuses exact catalog and current identity; rejects ambiguity, conflicts and missing current", async () => {
  const good = await readFinancialMonitorTarget("aapl", { readCatalog: async (_, options) => { assert.deepEqual(options, { exactTicker: true, fresh: true }); return catalog; }, readCurrent: async cik => { assert.equal(cik, target.issuerCik); return current; } });
  assert.equal(good.status, "available");
  if (good.status === "available") assert.deepEqual(financialTargetSelection(good.target), financialTargetSelection(target));
  for (const bad of [{ status: "unavailable" as const }, { status: "not-confirmed" as const }, { ...current, cik: "0000000001" }, { ...current, listings: [] }, { ...current, listings: [...current.listings, ...current.listings] }]) {
    assert.equal((await readFinancialMonitorTarget("AAPL", { readCatalog: async () => catalog, readCurrent: async () => bad })).status, "unavailable");
  }
  assert.equal((await readFinancialMonitorTarget("AAPL", { readCatalog: async () => ({ ok: true, data: [...catalog.data, ...catalog.data] }), readCurrent: async () => { throw Error("must not read ambiguous issuer"); } })).status, "unavailable");
});
test("create requires a strict selection; fresh verification rejects forged or stale fingerprints", async () => {
  const selection = financialTargetSelection(target);
  assert.equal(parseFinancialMonitorCreateRequest({ conditions }).ok, false);
  assert.equal(parseFinancialMonitorCreateRequest({ conditions, target: { ...selection, companyName: "forged" } }).ok, false);
  assert.equal(parseFinancialMonitorCreateRequest({ conditions, target: selection }).ok, true);
  for (const wrong of [{ ...selection, issuerCik: "0000000001" }, { ...selection, refreshSequence: "2" }, { ...selection, sourceRawId: "97000000-0000-4000-8000-000000000002" }]) assert.equal((await verifyFinancialMonitorSelection(wrong, async () => ({ status: "available", target }))).status, "unavailable");
  assert.equal((await verifyFinancialMonitorSelection(selection, async () => ({ status: "unavailable" }))).status, "unavailable");
});
test("legacy is explicit null; malformed stored targets never widen scope", async () => {
  const row = { id, user_id: id, domain: "financial", conditions, target: null, is_active: true, created_at: at, updated_at: at };
  const repo = { list: async () => ({ ok: true, data: [row, { ...row, target: {} }, { ...row, target: undefined }] }), create: async () => { throw Error("unexpected write"); } };
  const result = await listFinancialMonitorsForOwner(id, repo);
  assert.equal(result.monitors.length, 1); assert.equal(result.monitors[0].target, null);
  assert.deepEqual(result.diagnostics.map(d => d.reason), ["stored_target_invalid", "stored_target_invalid"]);
  await assert.rejects(createFinancialMonitor({ ownerId: id, conditions, target: null as never }, repo), /invalid/);
  assert.equal(financialMonitorTargetFailure(null, null, facts()), null);
  assert.equal(financialMonitorTargetFailure(undefined, null, facts()), "stored_target_invalid");
});
test("issuer gate excludes financially matching other issuer and permits issuer-wide share classes", () => {
  const other = facts("WIX 2025 20-F US-GAAP FPI");
  assert.equal(evaluateFinancialMonitorConditions(other, conditions).status, "match");
  assert.equal(financialMonitorTargetFailure(target, { status: "available", target }, other), "target_issuer_mismatch");
  assert.equal(financialMonitorTargetFailure(target, { status: "unavailable" }, facts()), "target_unavailable");
  assert.equal(financialMonitorTargetFailure(target, { status: "available", target: { ...target, issuerCik: other.issuerCik } }, facts()), "target_identity_changed");
  const otherClass = { ...target, ticker: "AAPL.B" };
  assert.equal(financialMonitorTargetFailure(otherClass, { status: "available", target: otherClass }, facts()), null);
});
test("consumer gates writes and shares one target read per ticker; evidence binds selected/current/fact issuers", async () => {
  const monitor = { id, userId: id, domain: "financial" as const, target, conditions, isActive: true, createdAt: at, updatedAt: at };
  let reads = 0, writes = 0;
  const deps = { listActiveMonitors: async () => ({ monitors: [monitor, { ...monitor, id: "97000000-0000-4000-8000-000000000002" }], diagnostics: [] }), readFacts: async () => facts(), readTarget: async () => { reads++; return { status: "available" as const, target }; }, createAlert: async () => { writes++; return { status: "created" as const, monitorId: id }; }, now: () => new Date(at) };
  const good = await consumeFinancialMonitorAlertsForEvent({ eventId: id }, deps);
  assert.equal(good.createdCount, 2); assert.equal(reads, 1);
  const other = await consumeFinancialMonitorAlertsForEvent({ eventId: id, preloadedFacts: facts("WIX 2025 20-F US-GAAP FPI") }, deps);
  assert.equal(other.createdCount, 0); assert.equal(writes, 2);
  assert(other.evaluations.every(e => e.reasonCode === "target_issuer_mismatch"));
  const e = buildFinancialMonitorEvidence(facts(), conditions, at, null, { selected: target, confirmed: target });
  assert.equal(e.ticker, "AAPL"); assert.equal(e.target?.selected.issuerCik, e.issuerCik);
  e.target!.confirmed.issuerCik = "0000000001";
  assert.equal(readFinancialMonitorEvidence(e, facts()).status, "invalid");
});
