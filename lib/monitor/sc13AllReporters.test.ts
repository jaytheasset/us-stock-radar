import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildSc13CanonicalPayload } from "../sec-sc13-xml/canonical.ts";
import { readSc13IssuerCurrentState } from "../sec-sc13-xml/currentState.ts";
import { buildStockSc13OwnershipSnapshot } from "../watchlist/stockSc13Ownership.ts";
import { evaluateSc13FilingReporters, evaluateSc13Monitor, type Sc13FilingReporterMatchEvidence } from "../sc13MonitorMatcher.ts";
import { validateSc13MonitorTarget, createSc13Monitor, listSc13MonitorsForOwner, type Sc13Monitor } from "./sc13MonitorPersistence.ts";
import { parseSc13MonitorCreateRequest } from "./sc13MonitorApi.ts";
import { consumeSc13MonitorAlertsForIssuer, listSc13MonitorAlertsForOwner } from "./sc13MonitorAlertConsumer.ts";
import { sc13AllReporterTargetChoices, sc13TargetChoices, isSc13AlertEvidenceConsistent } from "./sc13MonitorDisplay.ts";
import { buildSc13AlertDisplay } from "./sc13MonitorAlertDisplayServer.ts";

const raw = JSON.parse(readFileSync(new URL("../sec-sc13-xml/fixtures/lexeo-13g-two-reporters.json", import.meta.url), "utf8"));
const ID = "99000000-0000-4000-8000-000000000001";
const OWNER = "99000000-0000-4000-8000-000000000002";
const stored = buildSc13CanonicalPayload(ID, raw)!;
for (const reporter of stored.reporters) {
  for (const key of ["sole_voting_power", "shared_voting_power", "sole_dispositive_power", "shared_dispositive_power", "aggregate_amount_owned", "percent_of_class"]) reporter[key] = reporter[`${key}_raw`];
  reporter.aggregate_excludes_certain_shares = reporter.aggregate_excludes_certain_shares_flag_raw === "Y" ? true : reporter.aggregate_excludes_certain_shares_flag_raw === "N" ? false : null;
}
const source = { accessionNumber: raw.source_unique_id as string, sourceSha256: stored.filing.source_sha256 as string };
const issuer = stored.filing.issuer_cik as string;
const state = await readSc13IssuerCurrentState(issuer, { repository: {
  async rpc() { throw new Error("read-only"); },
  async select(table, query) {
    if (table === "sec_sc13_filings") return { ok: true, status: 200, data: [query.select === "accession_number" ? { accession_number: source.accessionNumber } : stored.filing], count: 1 };
    assert.equal(table, "sec_sc13_reporting_persons"); return { ok: true, status: 200, data: stored.reporters, count: 2 };
  },
} });
assert.equal(state.status, "available");
const snapshot = buildStockSc13OwnershipSnapshot({ currentState: state, symbol: "LXEO" });
const target = sc13AllReporterTargetChoices(snapshot)[0]!.target;
function monitor(value = "1"): Sc13Monitor { return { id: ID, userId: OWNER, domain: "sc13", target, conditions: [{ key: "sc13.percent_of_class", operator: "gte", value }], isActive: true, createdAt: "2026-10-14T00:00:00Z", updatedAt: "2026-10-14T00:00:00Z" }; }
const matches = () => evaluateSc13FilingReporters(state, monitor(), source);

test("all-reporter API target is explicit and existing specific target/rows retain their shape", async () => {
  assert.equal(target.reportingPersonScope, "all"); assert.equal(target.reportingPersonCik, undefined);
  assert.equal(parseSc13MonitorCreateRequest({ target, conditions: monitor().conditions }).ok, true);
  assert.equal(validateSc13MonitorTarget({ ...target, reportingPersonCik: null }).ok, false);
  const specific = { issuerCik: issuer, reportingPersonCik: "0001055951", securityClass: target.securityClass, cusips: target.cusips };
  assert.deepEqual(validateSc13MonitorTarget(specific).target, specific);
  const persisted: Record<string, unknown>[] = [];
  const repo = { async create(row: Record<string, unknown>) { const next = { ...row, id: ID, created_at: monitor().createdAt, updated_at: monitor().updatedAt }; persisted.push(next); return { ok: true, data: [next] }; }, async list() { return { ok: true, data: persisted }; } };
  const created = await createSc13Monitor({ ownerId: OWNER, target, conditions: monitor().conditions }, repo);
  assert.deepEqual(created.target, target); assert.equal(persisted[0]!.reporting_person_cik, null); assert.equal(persisted[0]!.reporter_scope, "all");
  const old = { ...persisted[0], reporting_person_cik: specific.reportingPersonCik, reporter_scope: "specific" };
  const read = await listSc13MonitorsForOwner(OWNER, { ...repo, async list() { return { ok: true, data: [old] }; } });
  assert.deepEqual(read.monitors[0]!.target, specific);
});

test("actual Lexeo null-CIK rows are separately selectable/matched without altering canonical history", () => {
  const before = JSON.stringify(stored);
  assert.equal(sc13TargetChoices(snapshot).length, 0); assert.equal(sc13AllReporterTargetChoices(snapshot).length, 1);
  const evaluated = matches(); assert.deepEqual(evaluated.map((item) => item.status), ["match", "match"]);
  assert.deepEqual(evaluated.map((item) => item.evidence?.conditions[0]!.valueRaw), ["4.1", "1.0"]);
  assert.deepEqual(evaluated.map((item) => item.evidence?.reportingPersonCik), [null, null]);
  assert.deepEqual(evaluated.map((item) => item.evidence?.reportingPersonIndex), [0, 1]);
  assert.equal(new Set(evaluated.map((item) => item.evidence?.positionKey)).size, 2);
  assert.equal(evaluated[0]!.evidence?.sourceSha256, "698810d36b486ef2cf48240368f2ed6b5a10e9a9e521f41d2a001b1850245d8c");
  assert.equal(evaluated[0]!.evidence?.rootAccessionNumber, null);
  assert.equal(evaluateSc13Monitor(state, { ...monitor(), target: { issuerCik: issuer, reportingPersonCik: "0001055951", securityClass: target.securityClass, cusips: target.cusips } }).status, "ineligible");
  assert.equal(JSON.stringify(stored), before);
});

test("absolute conditions never aggregate shares/percent or combine different persons' matching fields", () => {
  assert.equal(evaluateSc13FilingReporters(state, monitor("5"), source).some((result) => result.status === "match"), false);
  const mixed: Sc13Monitor = { ...monitor("4"), conditions: [...monitor("4").conditions, { key: "sc13.sole_voting", operator: "gte", value: "1" }] };
  assert.equal(evaluateSc13FilingReporters(state, mixed, source).some((result) => result.status === "match"), false);
  const zero: Sc13Monitor = { ...monitor(), conditions: [{ key: "sc13.sole_voting", operator: "eq", value: "0" }] };
  assert.deepEqual(evaluateSc13FilingReporters(state, zero, source).map((result) => result.status), ["match", "no_match"]);
});

test("unbound source, malformed conditions, invalid values and contradictory security fail closed", () => {
  assert.equal(evaluateSc13FilingReporters(state, monitor()).some((result) => result.status === "match"), false);
  for (const changed of [{ ...source, sourceSha256: "0".repeat(64) }, { ...source, accessionNumber: "0000947871-26-000802" }]) assert.equal(evaluateSc13FilingReporters(state, monitor(), changed).some((result) => result.status === "match"), false);
  for (const conditions of [[null], [{ key: "sc13.percent_of_class", operator: "bogus", value: "1" }], [{ key: "sc13.percent_of_class", operator: "gte", value: "NaN" }]]) assert.equal(evaluateSc13FilingReporters(state, { ...monitor(), conditions } as Sc13Monitor, source).some((result) => result.status === "match"), false);
  const wrongClass = { ...monitor(), target: { ...target, securityClass: "PREFERRED STOCK" } };
  assert.equal(evaluateSc13FilingReporters(state, wrongClass, source).some((result) => result.status === "match"), false);
  const copy = structuredClone(state); if (copy.status !== "available") throw new Error("state");
  copy.history[0]!.reporters[0]!.percent_of_class_raw = "NaN";
  assert.equal(evaluateSc13FilingReporters(copy, monitor(), source)[0]!.status, "ineligible");
  const ambiguous = structuredClone(state); if (ambiguous.status !== "available") throw new Error("state");
  (ambiguous.history as unknown[]).push({ ...ambiguous.history[0], filing: { ...ambiguous.history[0]!.filing, accession_number: "0000947871-26-000802", security_class_raw: "Preferred stock" } });
  assert.equal(evaluateSc13FilingReporters(ambiguous, monitor(), source)[0]!.reasonCode, "position_identity_ambiguous");
});

test("index identities distinguish same-named reporters and concurrent replay creates one alert per filing row", async () => {
  const copy = structuredClone(state); if (copy.status !== "available") throw new Error("state");
  copy.history[0]!.reporters[1]!.reporting_person_name_raw = copy.history[0]!.reporters[0]!.reporting_person_name_raw;
  assert.equal(new Set(evaluateSc13FilingReporters(copy, monitor(), source).map((result) => result.evidence?.positionKey)).size, 2);
  const keys = new Set<string>();
  const dependencies = { async readCurrentState() { return state; }, async listActiveMonitors() { return { monitors: [monitor()], diagnostics: [] }; },
    async createAlert({ evidence }: { evidence: Sc13FilingReporterMatchEvidence }) { const key = `${ID}:${evidence.headAccessionNumber}:${evidence.reportingPersonIndex}`;
      if (keys.has(key)) return { status: "existing" as const, monitorId: ID }; keys.add(key); return { status: "created" as const, monitorId: ID }; }, now() { return new Date("2026-10-14T00:00:00Z"); } };
  const results = await Promise.all(Array.from({ length: 5 }, () => consumeSc13MonitorAlertsForIssuer({ issuerCik: issuer, filingSource: source }, dependencies as never)));
  assert.equal(results.reduce((sum, result) => sum + result.createdCount, 0), 2); assert.equal(results.reduce((sum, result) => sum + result.existingCount, 0), 8);
  assert.equal((await consumeSc13MonitorAlertsForIssuer({ issuerCik: issuer, filingSource: source }, dependencies as never)).createdCount, 0);
});

test("owner Alert adapter and source links bind exact reporter index, source hash and nullable CIK", async () => {
  const rows = matches().map((result, index) => { const e = result.evidence!; return { id: `99000000-0000-4000-8000-00000000000${index + 3}`, sc13_monitor_id: ID,
    sc13_root_accession: null, sc13_head_accession: e.headAccessionNumber, sc13_reporter_index: index, sc13_reporter_cik: null,
    sc13_security_class: e.securityClass, sc13_cusips: e.cusips, sc13_match_evidence: e, created_at: monitor().createdAt }; });
  const alerts = await listSc13MonitorAlertsForOwner({ ownerId: OWNER }, { async list(input) { assert.equal(input.ownerId, OWNER); return { ok: true, data: rows }; } });
  assert.equal(alerts.length, 2); assert.equal(alerts.every(isSc13AlertEvidenceConsistent), true);
  const displayed = await buildSc13AlertDisplay(alerts, async () => ({ status: "available", ...stored }));
  assert.equal(displayed.every((alert) => alert.sources[0]?.sourceUrl === stored.filing.source_url), true);
  assert.equal(isSc13AlertEvidenceConsistent({ ...alerts[0]!, reportingPersonIndex: 1 }), false);
  const badSource = await buildSc13AlertDisplay(alerts, async () => ({ status: "available", ...stored, filing: { ...stored.filing, source_sha256: "0".repeat(64) } }));
  assert.equal(badSource.every((alert) => alert.sources.length === 0), true);
});
