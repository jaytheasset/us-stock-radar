import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire, registerHooks } from "node:module";
import { execFileSync } from "node:child_process";

type Row = Record<string, any>;
type DbClient = { connect(): Promise<void>; end(): Promise<void>; query(sql: string, values?: unknown[]): Promise<{ rows: Row[] }> };
const PgClient = (createRequire(import.meta.url)("pg") as { Client: new (options: { connectionString: string }) => DbClient }).Client;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { shortCircuit: true, url: "data:text/javascript,export%20%7B%7D;" };
    return nextResolve(specifier, context);
  },
});

const FOUR_CASE_SHA = "48c46e453b9cd46e5d1a6640082dd399230a78b35e1e7b770feea9bd4f401e5e";
const PAIR_SHA = "9f9c849994beba4628fa2d297906a3d6f9ebee008ac33f8b0fc2b56e148bdcf6";
const fourPath = process.env.SC13_E2E_SOURCE_ARTIFACT ?? "C:/Users/PC/AppData/Local/Temp/stockradar-sc13-b058cd-live-verification.json";
const pairPath = process.env.SC13_LINEAGE_PAIR_ARTIFACT ?? "C:/Users/PC/AppData/Local/Temp/sc13-lineage-main-explicit-pair.json";
const outputPath = process.env.SC13_MONITOR_E2E_OUTPUT ?? "C:/Users/PC/AppData/Local/Temp/stockradar-sc13-monitor-58621-e2e.json";
const manifestPath = process.env.SC13_MONITOR_MANIFEST_OUTPUT ?? "C:/Users/PC/AppData/Local/Temp/stockradar-sc13-monitor-58621-manifest.json";
const dbUrl = requiredEnv("SC13_MONITOR_ISOLATED_DB_URL");
const apiUrl = requiredEnv("SUPABASE_URL").replace(/\/$/, "");
const appOrigin = (process.env.APP_ORIGIN ?? "http://127.0.0.1:3111").replace(/\/$/, "");
const publishableKey = requiredEnv("SUPABASE_PUBLISHABLE_KEY");
const secretKey = requiredEnv("SUPABASE_SECRET_KEY");
assertEndpoints(new URL(dbUrl), new URL(apiUrl), new URL(appOrigin));

process.env.SUPABASE_DB_URL = dbUrl;
process.env.SEC_ANALYSIS_ALLOW_OPENAI = "false";
delete process.env.OPENAI_API_KEY;
delete process.env.GEMINI_API_KEY;
process.env.ALERT_DELIVERY_SEND_TELEGRAM = "false";
process.env.ALERT_DELIVERY_SEND_TELEGRAM_PUBLIC = "false";
process.env.ALERT_DELIVERY_SEND_EMAIL = "false";

const allowedOrigins = new Set([new URL(apiUrl).origin, new URL(appOrigin).origin]);
const nativeFetch = globalThis.fetch.bind(globalThis);
const networkLedger: Array<{ method: string; origin: string; pathname: string; allowed: boolean }> = [];
globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
  const request = input instanceof Request ? input : new Request(input, init);
  const url = new URL(request.url);
  const allowed = allowedOrigins.has(url.origin);
  networkLedger.push({ method: request.method, origin: url.origin, pathname: url.pathname, allowed });
  if (!allowed) throw new Error(`isolated E2E network guard blocked ${url.origin}`);
  return nativeFetch(request);
};

const [fourText, pairText] = await Promise.all([readFile(fourPath, "utf8"), readFile(pairPath, "utf8")]);
assert.equal(sha256(fourText), FOUR_CASE_SHA);
assert.equal(sha256(pairText), PAIR_SHA);
const fourCases = rows(JSON.parse(fourText).results);
const pairCases = rows(JSON.parse(pairText).results);
assert.deepEqual(fourCases.map((item) => item.ticker), ["LODE", "MTCH", "MSFT", "AAPL"]);
assert.deepEqual(pairCases.map((item) => item.accession), ["0000947871-26-000814", "0000947871-26-000860"]);
const rawItems = new Map<string, Row>();
for (const item of fourCases) rawItems.set(String(item.accession), record(item.rawItem));
for (const item of pairCases) rawItems.set(String(item.accession), record(item.collection?.items?.[0]));
assert.equal(rawItems.size, 6);

const [rawStore, persistence, currentState, consumer, normalizers] = await Promise.all([
  import("../lib/secStores/rawStore.ts"),
  import("../lib/sec-sc13-xml/persistence.ts"),
  import("../lib/sec-sc13-xml/currentState.ts"),
  import("../lib/monitor/sc13MonitorAlertConsumer.ts"),
  import("../lib/monitor/sc13MonitorPersistence.ts"),
]);

const db = new PgClient({ connectionString: dbUrl });
await db.connect();
const identity = await db.query("select current_database() database, current_user role, to_regclass('public.sc13_monitors')::text monitor_table, to_regclass('public.sec_sc13_filings')::text canonical_table");
assert.deepEqual(identity.rows[0], { database: "postgres", role: "postgres", monitor_table: "sc13_monitors", canonical_table: "sec_sc13_filings" });
assert.equal((await fetch(`${appOrigin}/api/health`)).status, 200);

const output: Row = { status: "FAIL" };
try {
  const targetAccessions = [...rawItems.keys()];
  assert.equal((await db.query("select count(*)::int count from public.raw_items where source_unique_id=any($1::text[])", [targetAccessions])).rows[0].count, 0);
  await rawStore.ensureSecSource();
  const runId = randomUUID();
  await rawStore.createSecSourceRun({ force: false, includeDocuments: true, requestedFormTypes: ["SCHEDULE 13D", "SCHEDULE 13D/A", "SCHEDULE 13G", "SCHEDULE 13G/A"], requestedLimit: 6, runId, startedAt: new Date().toISOString(), metadata: { isolated_sc13_monitor_e2e: true, provider_calls: 0 } });

  const userA = await createUser("owner"), userB = await createUser("foreign");
  const cookieA = await login(userA), cookieB = await login(userB);
  assert.equal((await api("/api/monitors/sc13")).status, 401);
  assert.equal((await api("/api/monitors/sc13/alerts")).status, 401);

  const rawIds = new Map<string, string>();
  const persistOne = async (accession: string) => {
    const rawItem = requiredRaw(accession);
    const saved = await rawStore.saveSecRawItem(rawItem as never, runId);
    rawIds.set(accession, String(saved.id));
    const result = await persistence.persistSc13CanonicalXmlForRawItem({ rawItemId: String(saved.id), rawItem });
    assert.equal(result.status, "available", accession);
    return result;
  };

  const original = "0000947871-26-000814", amendment = "0000947871-26-000860";
  await persistOne(original);
  const originalRead = requireAvailable(await currentState.readSc13IssuerCurrentState("0002131524"));
  const originalPosition = requirePosition(originalRead);
  const originalReporter = requireReporter(originalPosition, "0001055951");
  const originalTarget = targetFor(originalPosition, originalReporter.reportingPersonCik);
  const originalMonitor = await createMonitor(cookieA, originalTarget, [{ key: "sc13.aggregate_owned", operator: "gt", value: "0" }]);
  const originalRuns = await Promise.all(Array.from({ length: 12 }, () => consumer.consumeSc13MonitorAlertsForIssuer({ issuerCik: "0002131524" })));
  assert.equal(originalRuns.reduce((sum, item) => sum + item.createdCount, 0), 1);
  assert.equal(originalRuns.reduce((sum, item) => sum + item.existingCount, 0), 11);
  assert.equal((await alertCount(originalMonitor.id)).count, 1);
  assert.equal((await alertCount(originalMonitor.id)).head, original);

  await persistOne(amendment);
  const brve = requireAvailable(await currentState.readSc13IssuerCurrentState("0002131524"));
  const brvePosition = requirePosition(brve);
  assert.equal(brvePosition.rootAccessionNumber, original);
  assert.equal(brvePosition.headAccessionNumber, amendment);
  assert.deepEqual(brvePosition.currentReporters.map((reporter: Row) => ({ cik: reporter.reportingPersonCik, aggregate: reporter.values.aggregateAmountOwnedRaw.valueRaw, percent: reporter.values.percentOfClassRaw.valueRaw })), [
    { cik: "0001055951", aggregate: "12175159.00", percent: "13.5" },
    { cik: "0001920574", aggregate: "11901826.00", percent: "13.2" },
    { cik: "0001808744", aggregate: "273333.00", percent: "0.3" },
  ]);
  const amendmentRuns = await Promise.all(Array.from({ length: 12 }, () => consumer.consumeSc13MonitorAlertsForIssuer({ issuerCik: "0002131524" })));
  assert.equal(amendmentRuns.reduce((sum, item) => sum + item.createdCount, 0), 0);
  assert.equal(amendmentRuns.reduce((sum, item) => sum + item.existingCount, 0), 12);
  const originalAfterAmendment = await alertCount(originalMonitor.id);
  assert.deepEqual(originalAfterAmendment, { count: 1, head: original });

  const brveMonitors: Row[] = [];
  for (const reporter of brvePosition.currentReporters) {
    const target = targetFor(brvePosition, reporter.reportingPersonCik);
    const conditions = allExactConditions(reporter);
    const preview = await api("/api/monitors/sc13/validate", { method: "POST", cookie: cookieA, body: { target, conditions } });
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    const monitor = await createMonitor(cookieA, target, conditions);
    brveMonitors.push(monitor);
  }
  const brveAllRun = await consumer.consumeSc13MonitorAlertsForIssuer({ issuerCik: "0002131524" });
  assert.equal(brveAllRun.evaluations.filter((item) => brveMonitors.some((monitor) => monitor.id === item.monitorId) && item.status === "match").length, 3);
  for (const monitor of brveMonitors) {
    const snapshot = await alertCount(monitor.id);
    assert.deepEqual(snapshot, { count: 1, head: amendment });
  }

  const reporterA = brvePosition.currentReporters[0]!, reporterB = brvePosition.currentReporters[1]!;
  const mixedMonitor = await createMonitor(cookieA, targetFor(brvePosition, reporterA.reportingPersonCik), [
    { key: "sc13.aggregate_owned", operator: "eq", value: requireCurrent(reporterA, "aggregateAmountOwnedRaw") },
    { key: "sc13.percent_of_class", operator: "eq", value: requireCurrent(reporterB, "percentOfClassRaw") },
  ]);
  const mixedRun = await consumer.consumeSc13MonitorAlertsForIssuer({ issuerCik: "0002131524" });
  assert.equal(mixedRun.evaluations.find((item) => item.monitorId === mixedMonitor.id)?.status, "no_match");
  assert.equal((await alertCount(mixedMonitor.id)).count, 0);

  for (const accession of targetAccessions.filter((value) => value !== original && value !== amendment)) await persistOne(accession);
  const reads = {
    LODE: requireAvailable(await currentState.readSc13IssuerCurrentState("0001120970")),
    MTCH: requireAvailable(await currentState.readSc13IssuerCurrentState("0000891103")),
    MSFT: requireAvailable(await currentState.readSc13IssuerCurrentState("0000789019")),
    AAPL: requireAvailable(await currentState.readSc13IssuerCurrentState("0000320193")),
  };
  const lodePosition = requirePosition(reads.LODE);
  assert.equal(lodePosition.currentReporters.length, 3);
  const lodeMonitors: Row[] = [];
  for (const reporter of lodePosition.currentReporters) {
    lodeMonitors.push(await createMonitor(cookieA, targetFor(lodePosition, reporter.reportingPersonCik), [{ key: "sc13.aggregate_owned", operator: "eq", value: requireCurrent(reporter, "aggregateAmountOwnedRaw") }]));
  }
  const lodeRuns = await Promise.all(Array.from({ length: 12 }, () => consumer.consumeSc13MonitorAlertsForIssuer({ issuerCik: "0001120970" })));
  assert.equal(lodeRuns.reduce((sum, item) => sum + item.createdCount, 0), 3);
  assert.equal(lodeRuns.reduce((sum, item) => sum + item.existingCount, 0), 33);
  for (const monitor of lodeMonitors) assert.equal((await alertCount(monitor.id)).count, 1);

  const unresolvedMonitors: Row[] = [];
  for (const read of [reads.MTCH, reads.MSFT, reads.AAPL]) {
    assert.equal(read.lineage.positions.every((position: Row) => position.status === "unresolved"), true);
    const filing = read.history.at(-1)!;
    const reporterCik = filing.reporters.find((reporter: Row) => /^\d{10}$/.test(String(reporter.reporting_person_cik ?? "")))?.reporting_person_cik ?? "0000000001";
    unresolvedMonitors.push(await createMonitor(cookieA, {
      issuerCik: read.issuerCik,
      reportingPersonCik: reporterCik,
      securityClass: normalizers.normalizeSc13SecurityClass(filing.filing.security_class_raw),
      cusips: normalizers.normalizeSc13Cusips(filing.filing.cusips_raw),
    }, [{ key: "sc13.aggregate_owned", operator: "gte", value: "0" }]));
    const run = await consumer.consumeSc13MonitorAlertsForIssuer({ issuerCik: read.issuerCik });
    assert.equal(run.evaluations.find((item) => item.monitorId === unresolvedMonitors.at(-1)!.id)?.status, "ineligible");
    assert.equal((await alertCount(unresolvedMonitors.at(-1)!.id)).count, 0);
  }

  const mismatchMonitors = [
    await createMonitor(cookieA, { ...targetFor(brvePosition, reporterA.reportingPersonCik), reportingPersonCik: "0000000001" }, [{ key: "sc13.aggregate_owned", operator: "gte", value: "0" }]),
    await createMonitor(cookieA, { ...targetFor(brvePosition, reporterA.reportingPersonCik), securityClass: "PREFERRED STOCK" }, [{ key: "sc13.aggregate_owned", operator: "gte", value: "0" }]),
    await createMonitor(cookieA, { ...targetFor(brvePosition, reporterA.reportingPersonCik), cusips: ["000000001"] }, [{ key: "sc13.aggregate_owned", operator: "gte", value: "0" }]),
    await createMonitor(cookieA, { ...targetFor(brvePosition, reporterA.reportingPersonCik), issuerCik: "0000320193" }, [{ key: "sc13.aggregate_owned", operator: "gte", value: "0" }]),
  ];
  await consumer.consumeSc13MonitorAlertsForIssuer({ issuerCik: "0002131524" });
  for (const monitor of mismatchMonitors) assert.equal((await alertCount(monitor.id)).count, 0);

  const inactive = await createMonitor(cookieA, targetFor(brvePosition, reporterA.reportingPersonCik), [{ key: "sc13.aggregate_owned", operator: "gte", value: "0" }]);
  const ownerToken = await supabaseLogin(userA), foreignToken = await supabaseLogin(userB);
  const inactivePatch = await fetch(`${apiUrl}/rest/v1/sc13_monitors?id=eq.${inactive.id}`, { method: "PATCH", headers: restHeaders(ownerToken, "return=representation"), body: JSON.stringify({ is_active: false }) });
  assert.equal(inactivePatch.status, 200, await inactivePatch.text());
  await consumer.consumeSc13MonitorAlertsForIssuer({ issuerCik: "0002131524" });
  assert.equal((await alertCount(inactive.id)).count, 0);

  const invalidStoredId = randomUUID();
  await db.query(`insert into public.sc13_monitors (id,user_id,issuer_cik,reporting_person_cik,security_class,cusips,conditions,is_active)
    values ($1,$2,$3,$4,$5,$6,$7::jsonb,true)`, [invalidStoredId, userA.id, "0002131524", reporterA.reportingPersonCik, "COMMON STOCK", ["10567X101"], JSON.stringify([{ key: "sc13.unknown", operator: "eq", value: "0" }])]);
  const diagnosticRun = await consumer.consumeSc13MonitorAlertsForIssuer({ issuerCik: "0002131524" });
  assert.equal(diagnosticRun.diagnostics.some((item) => item.id === invalidStoredId), true);
  assert.equal((await alertCount(invalidStoredId)).count, 0);

  const invalidNumber = await api("/api/monitors/sc13", { method: "POST", cookie: cookieA, body: { target: originalTarget, conditions: [{ key: "sc13.aggregate_owned", operator: "gt", value: 1 }] } });
  assert.equal(invalidNumber.status, 422);
  const invalidPercent = await api("/api/monitors/sc13", { method: "POST", cookie: cookieA, body: { target: originalTarget, conditions: [{ key: "sc13.percent_of_class", operator: "gt", value: "100.0001" }] } });
  assert.equal(invalidPercent.status, 422);
  const crossOrigin = await api("/api/monitors/sc13", { method: "POST", cookie: cookieA, origin: "https://foreign.example", body: { target: originalTarget, conditions: [{ key: "sc13.aggregate_owned", operator: "gt", value: "0" }] } });
  assert.equal(crossOrigin.status, 403);

  const actualZero = findActual(brvePosition, (value) => /^0(?:\.0+)?$/.test(value)) ?? findActual(lodePosition, (value) => /^0(?:\.0+)?$/.test(value));
  assert.ok(actualZero, "real BRVE/LODE canonical rows retain directly reported decimal zero");
  const zeroPosition = actualZero.positionKey === brvePosition.positionKey ? brvePosition : lodePosition;
  const zeroMonitor = await createMonitor(cookieA, targetFor(zeroPosition, actualZero.reporterCik), [{ key: conditionKeyForField(actualZero.field), operator: "eq", value: "0" }]);
  const zeroRun = await consumer.consumeSc13MonitorAlertsForIssuer({ issuerCik: zeroPosition.issuerCik });
  assert.equal(zeroRun.evaluations.find((item) => item.monitorId === zeroMonitor.id)?.status, "match");
  const zeroAlerts = await api(`/api/monitors/sc13/alerts?monitorId=${zeroMonitor.id}`, { cookie: cookieA });
  assert.equal(zeroAlerts.status, 200);
  assert.equal(zeroAlerts.body.data.alerts.length, 1);
  assert.equal(zeroAlerts.body.data.alerts[0].evidence.conditions[0].threshold, "0");
  assert.match(zeroAlerts.body.data.alerts[0].evidence.conditions[0].valueRaw, /^0\.0+$/);

  const ownerList = await api("/api/monitors/sc13", { cookie: cookieA });
  const foreignList = await api("/api/monitors/sc13", { cookie: cookieB });
  assert.equal(ownerList.status, 200);
  assert.ok(ownerList.body.data.monitors.length >= 1);
  assert.equal(foreignList.status, 200);
  assert.equal(foreignList.body.data.monitors.length, 0);
  const ownerAlerts = await api("/api/monitors/sc13/alerts", { cookie: cookieA });
  const foreignAlerts = await api("/api/monitors/sc13/alerts", { cookie: cookieB });
  assert.equal(ownerAlerts.status, 200);
  assert.ok(ownerAlerts.body.data.alerts.length >= 8);
  assert.equal(foreignAlerts.body.data.alerts.length, 0);
  assert.ok(ownerAlerts.body.data.alerts.every((alert: Row) => alert.evidence.meaning === "latest_saved_filing_value_not_realtime_ownership"));

  const directRls = await verifyDirectRls(ownerToken, foreignToken, userA.id, originalMonitor.id);
  const due = await fetch(`${apiUrl}/rest/v1/user_alert_deliveries?select=id&alert_lane=eq.sc13_monitor&delivery_status=eq.queued&scheduled_for=lte.${encodeURIComponent(new Date().toISOString())}`, { headers: { apikey: secretKey, Authorization: `Bearer ${secretKey}` } });
  assert.equal(due.status, 200);
  assert.deepEqual(await due.json(), []);
  const isolationRows = await db.query(`select
    (select count(*)::int from public.events where raw_item_id=any($1::uuid[])) event_count,
    (select count(*)::int from public.ai_runs where raw_item_id=any($1::uuid[])) ai_run_count,
    (select count(*)::int from public.user_alert_deliveries where alert_lane='sc13_monitor' and alert_event_id is not null) leaked_event_alerts,
    (select count(*)::int from public.user_alert_deliveries where alert_lane='sc13_monitor' and (scheduled_for is not null or cardinality(delivered_channels)>0 or sent_at is not null or attempted_at is not null)) externalized_alerts`, [[...rawIds.values()]]);
  assert.deepEqual(isolationRows.rows[0], { event_count: 0, ai_run_count: 0, leaked_event_alerts: 0, externalized_alerts: 0 });
  assert.equal(networkLedger.some((entry) => !entry.allowed), false);

  const replaySnapshot = await db.query("select count(*)::int alerts, count(distinct (sc13_monitor_id,sc13_root_accession,sc13_position_key,sc13_reporter_cik))::int identities from public.user_alert_deliveries where alert_lane='sc13_monitor'");
  assert.equal(replaySnapshot.rows[0].alerts, replaySnapshot.rows[0].identities);
  const canonicalStorage = await db.query(`select
    (select count(*)::int from public.raw_items where id=any($1::uuid[])) raw_items,
    (select count(*)::int from public.sec_sc13_filings where accession_number=any($2::text[])) canonical_filings,
    (select count(*)::int from public.sec_sc13_filings where accession_number=any($2::text[]) and raw_xml <> '' and raw_xml_utf8_byte_count=octet_length(raw_xml) and source_sha256 ~ '^[0-9a-f]{64}$') verified_raw_xml,
    (select count(*)::int from public.sec_sc13_reporting_persons where accession_number=any($2::text[])) reporter_rows`, [[...rawIds.values()], targetAccessions]);
  assert.deepEqual(canonicalStorage.rows[0], { raw_items: 6, canonical_filings: 6, verified_raw_xml: 6, reporter_rows: 31 });

  output.status = "PASS";
  output.isolation = { projectId: "stock-radar-sc13-monitor-58621-20260911", apiPort: 58621, dbPort: 58622, appPort: 3111, sharedPortsTouched: false };
  output.artifacts = { fourCases: { path: fourPath, sha256: FOUR_CASE_SHA }, explicitPair: { path: pairPath, sha256: PAIR_SHA }, rawAccessions: targetAccessions };
  output.auth = { loggedOutMonitor: 401, loggedOutAlerts: 401, crossOrigin: 403, ownerMonitorCount: ownerList.body.data.monitors.length, foreignMonitorCount: 0, foreignAlertCount: 0, directRls };
  output.actualAvailable = { BRVE: summarizePosition(brvePosition), LODE: summarizePosition(lodePosition), zeroIfPresent: actualZero };
  output.actualUnresolved = Object.fromEntries(Object.entries(reads).filter(([ticker]) => ticker !== "LODE").map(([ticker, read]) => [ticker, read.lineage.positions.map((position: Row) => ({ status: position.status, issues: position.issues }))]));
  output.dedupe = { originalFirstHead: original, amendmentCurrentHead: amendment, originalAlertRowsAfterAmendment: 1, originalAlertHeadRemains: original, concurrentCallsPerStage: 12, finalUniqueIdentityRows: replaySnapshot.rows[0].alerts };
  output.storage = canonicalStorage.rows[0];
  output.failClosed = { mixedReporterRows: "no_match", identityMismatchAlerts: 0, inactiveAlerts: 0, invalidStoredAlerts: 0, unresolvedAlerts: 0, actualZeroDecimalCondition: { threshold: "0", reportedRaw: actualZero.valueRaw, alertRows: 1 }, nullCurrentSyntheticRegression: "unit_test", otherHolderPositionRegression: "unit_test" };
  output.isolationEvidence = { ...isolationRows.rows[0], dueExternalDeliveryRows: 0, externalRequests: 0, llmRequests: 0, providerRequests: 0 };
  output.retainedForIndependentAudit = true;
  const changedFiles = [...new Set([
    ...execFileSync("git", ["diff", "--name-only"], { encoding: "utf8" }).split(/\r?\n/),
    ...execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { encoding: "utf8" }).split(/\r?\n/),
  ].map((value) => value.trim()).filter(Boolean))].sort();
  const manifest = {
    baseCommit: "e7461586aa4ef85d0fbaa062a14f665799cb5f77",
    files: await Promise.all(changedFiles.map(async (path) => ({ path, sha256: sha256(await readFile(path, "utf8")) }))),
  };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(manifestPath, manifestText, "utf8");
  output.manifest = { path: manifestPath, sha256: sha256(manifestText), fileCount: changedFiles.length };
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ outputPath, ...output }, null, 2)}\n`);
} finally {
  await db.end();
}

async function createMonitor(cookie: string, target: Row, conditions: Row[]) {
  const response = await api("/api/monitors/sc13", { method: "POST", cookie, body: { target, conditions } });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.data.monitor as Row;
}
async function alertCount(monitorId: string) {
  const result = await db.query("select count(*)::int count, min(sc13_head_accession) head from public.user_alert_deliveries where sc13_monitor_id=$1", [monitorId]);
  return result.rows[0] as { count: number; head: string | null };
}
function allExactConditions(reporter: Row) {
  return [
    ["sc13.aggregate_owned", "aggregateAmountOwnedRaw"], ["sc13.percent_of_class", "percentOfClassRaw"],
    ["sc13.sole_voting", "soleVotingPowerRaw"], ["sc13.shared_voting", "sharedVotingPowerRaw"],
    ["sc13.sole_dispositive", "soleDispositivePowerRaw"], ["sc13.shared_dispositive", "sharedDispositivePowerRaw"],
  ].map(([key, field]) => ({ key, operator: "eq", value: requireCurrent(reporter, field) }));
}
function requireCurrent(reporter: Row, field: string) {
  const value = reporter.values[field];
  assert.equal(value.status, "available", `${reporter.reportingPersonCik}:${field}`);
  assert.equal(value.sourceAccessionNumber, reporter.sourceAccessionNumber);
  assert.match(value.valueRaw, /^(?:0|[1-9]\d*)(?:\.\d+)?$/);
  return value.valueRaw as string;
}
function targetFor(position: Row, reportingPersonCik: string) {
  return { issuerCik: position.issuerCik, reportingPersonCik, securityClass: normalizers.normalizeSc13SecurityClass(position.securityClassRaw), cusips: normalizers.normalizeSc13Cusips(position.cusipsRaw) };
}
function requireAvailable(value: Row) { assert.equal(value.status, "available", JSON.stringify(value)); return value; }
function requirePosition(read: Row) { const positions = read.lineage.positions.filter((item: Row) => item.status === "available_stored_history"); assert.equal(positions.length, 1, JSON.stringify(read.lineage.positions)); return positions[0]!; }
function requireReporter(position: Row, cik: string) { const reporters = position.currentReporters.filter((item: Row) => item.reportingPersonCik === cik); assert.equal(reporters.length, 1); return reporters[0]!; }
function summarizePosition(position: Row) { return { rootAccessionNumber: position.rootAccessionNumber, headAccessionNumber: position.headAccessionNumber, scope: position.scope, securityClassRaw: position.securityClassRaw, cusipsRaw: position.cusipsRaw, reporters: position.currentReporters.map((reporter: Row) => ({ cik: reporter.reportingPersonCik, values: Object.fromEntries(Object.entries(reporter.values).map(([key, value]: [string, any]) => [key, { status: value.status, valueRaw: value.valueRaw, sourceAccessionNumber: value.sourceAccessionNumber }])) })) }; }
function findActual(position: Row, predicate: (value: string) => boolean) { for (const reporter of position.currentReporters) for (const [field, value] of Object.entries(reporter.values) as Array<[string, any]>) if (value.status === "available" && predicate(value.valueRaw)) return { positionKey: position.positionKey, reporterCik: reporter.reportingPersonCik, field, valueRaw: value.valueRaw, sourceAccessionNumber: value.sourceAccessionNumber }; return null; }
function conditionKeyForField(field: string) { const key = ({ aggregateAmountOwnedRaw: "sc13.aggregate_owned", percentOfClassRaw: "sc13.percent_of_class", soleVotingPowerRaw: "sc13.sole_voting", sharedVotingPowerRaw: "sc13.shared_voting", soleDispositivePowerRaw: "sc13.sole_dispositive", sharedDispositivePowerRaw: "sc13.shared_dispositive" } as Record<string, string>)[field]; if (!key) throw new Error(`unsupported SC13 field ${field}`); return key; }

async function createUser(label: string) {
  const email = `sc13-monitor-${label}-${randomUUID()}@example.test`, password = `Sc13-${randomUUID()}-aA1!`;
  const response = await fetch(`${apiUrl}/auth/v1/admin/users`, { method: "POST", headers: serviceHeaders(), body: JSON.stringify({ email, password, email_confirm: true }) });
  const body = await response.json(); assert.equal(response.ok, true, JSON.stringify(body)); return { id: body.id as string, email, password };
}
async function login(user: { email: string; password: string }) {
  const response = await fetch(`${appOrigin}/api/auth/login`, { method: "POST", headers: { Origin: appOrigin, "Content-Type": "application/json" }, body: JSON.stringify(user) });
  assert.equal(response.status, 200, await response.text());
  const cookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie") || ""];
  return cookies.map((value) => value.split(";", 1)[0]).filter(Boolean).join("; ");
}
async function api(path: string, options: { method?: string; cookie?: string; body?: unknown; origin?: string } = {}) {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.method && options.method !== "GET") { headers.Origin = options.origin || appOrigin; headers["Content-Type"] = "application/json"; }
  const response = await fetch(`${appOrigin}${path}`, { method: options.method || "GET", headers, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
  return { status: response.status, body: await response.json().catch(() => null) };
}
async function supabaseLogin(user: { email: string; password: string }) { const response = await fetch(`${apiUrl}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: publishableKey, "Content-Type": "application/json" }, body: JSON.stringify(user) }); const body = await response.json(); assert.equal(response.ok, true, JSON.stringify(body)); return body.access_token as string; }
async function verifyDirectRls(ownerToken: string, foreignToken: string, ownerId: string, monitorId: string) {
  const select = async (token: string) => { const response = await fetch(`${apiUrl}/rest/v1/sc13_monitors?select=id,user_id`, { headers: { apikey: publishableKey, Authorization: `Bearer ${token}` } }); assert.equal(response.status, 200); return await response.json() as Row[]; };
  const ownerRows = await select(ownerToken), foreignRows = await select(foreignToken);
  assert.ok(ownerRows.some((row) => row.id === monitorId) && ownerRows.every((row) => row.user_id === ownerId));
  assert.equal(foreignRows.length, 0);
  const forge = await fetch(`${apiUrl}/rest/v1/sc13_monitors`, { method: "POST", headers: restHeaders(foreignToken), body: JSON.stringify({ user_id: ownerId, issuer_cik: "0002131524", reporting_person_cik: "0001055951", security_class: "COMMON STOCK", cusips: ["10567X101"], conditions: [{ key: "sc13.aggregate_owned", operator: "gt", value: "0" }] }) });
  assert.equal(forge.status, 403);
  const alertForge = await fetch(`${apiUrl}/rest/v1/user_alert_deliveries`, { method: "POST", headers: restHeaders(ownerToken), body: JSON.stringify({ user_id: ownerId, title: "forged", alert_lane: "sc13_monitor" }) });
  assert.equal(alertForge.status, 403);
  const anon = await fetch(`${apiUrl}/rest/v1/sc13_monitors?select=id`, { headers: { apikey: publishableKey } });
  assert.ok(anon.status === 401 || (anon.status === 200 && (await anon.json()).length === 0));
  return { ownerRows: ownerRows.length, foreignRows: 0, foreignOwnerForgeStatus: forge.status, ownerAlertForgeStatus: alertForge.status, anonymousDeniedOrEmpty: true };
}
function serviceHeaders() { return { apikey: secretKey, Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" }; }
function restHeaders(token: string, prefer?: string) { return { apikey: publishableKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) }; }
function requiredRaw(accession: string) { const value = rawItems.get(accession); if (!value?.source_unique_id) throw new Error(`missing raw ${accession}`); return value; }
function requiredEnv(name: string) { const value = process.env[name]?.trim(); if (!value) throw new Error(`${name} is required`); return value; }
function assertEndpoints(db: URL, api: URL, app: URL) { for (const value of [db, api, app]) assert.ok(["127.0.0.1", "localhost"].includes(value.hostname)); assert.equal(db.port, "58622"); assert.equal(api.port, "58621"); assert.equal(app.port, "3111"); for (const port of [db.port, api.port]) assert.ok(!new Set(["56321", "56322", "58321", "58322", "58421", "58422", "58521", "58522"]).has(port)); }
function rows(value: unknown): Row[] { return Array.isArray(value) ? value.filter((item): item is Row => Boolean(item && typeof item === "object" && !Array.isArray(item))) : []; }
function record(value: unknown): Row { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }
function sha256(value: string) { return createHash("sha256").update(value, "utf8").digest("hex"); }
