import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire, registerHooks } from "node:module";

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
const BRVE_ORIGINAL_SHA = "940969568b8bfd7c045a5e5461eb76f3827b132965bef1f13eddb3dd310729ca";
const BRVE_AMENDMENT_SHA = "8d1227025945dd6681b5042aa927f5542b92fd1c10a9d93c234aa9bdb50a3515";
const fourPath = "C:/Users/PC/AppData/Local/Temp/stockradar-sc13-b058cd-live-verification.json";
const pairPath = "C:/Users/PC/AppData/Local/Temp/sc13-lineage-main-explicit-pair.json";
const oraclePath = "C:/Users/PC/AppData/Local/Temp/sc13-monitor-main-source-oracle.json";
const outputPath = "C:/Users/PC/AppData/Local/Temp/stockradar-sc13-auto-58721-e2e.json";
const manifestPath = "C:/Users/PC/AppData/Local/Temp/stockradar-sc13-auto-58721-manifest.json";
const ORDER = [
  "0000947871-26-000814",
  "0000947871-26-000860",
  "0000921895-26-000805",
  "0000902664-26-002298",
  "0002100119-26-000820",
  "0000102909-26-000630",
];
const dbUrl = requiredEnv("SC13_AUTO_ISOLATED_DB_URL");
const apiUrl = requiredEnv("SUPABASE_URL").replace(/\/$/, "");
const secretKey = requiredEnv("SUPABASE_SECRET_KEY");
assertIsolated(new URL(dbUrl), new URL(apiUrl));

process.env.SUPABASE_DB_URL = dbUrl;
process.env.SEC_ANALYSIS_ALLOW_OPENAI = "false";
delete process.env.OPENAI_API_KEY;
delete process.env.GEMINI_API_KEY;
process.env.ALERT_DELIVERY_SEND_TELEGRAM = "false";
process.env.ALERT_DELIVERY_SEND_TELEGRAM_PUBLIC = "false";
process.env.ALERT_DELIVERY_SEND_EMAIL = "false";

type FailureMode = "none" | "reader" | "alert_write" | "begin_write" | "finish_write";
let failureMode: FailureMode = "none";
const nativeFetch = globalThis.fetch.bind(globalThis);
const networkLedger: Array<{ method: string; origin: string; pathname: string; external: boolean; injected: boolean }> = [];
globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
  const request = input instanceof Request ? input : new Request(input, init);
  const url = new URL(request.url);
  const allowedSec = ["www.sec.gov", "sec.gov"].includes(url.hostname.toLowerCase())
    && (url.pathname === "/files/company_tickers_exchange.json" || ORDER.some((accession) => url.pathname.includes(accession.replaceAll("-", ""))));
  const external = url.origin !== new URL(apiUrl).origin && !allowedSec;
  const injected = shouldInject(failureMode, request.method, url.pathname);
  networkLedger.push({ method: request.method, origin: url.origin, pathname: url.pathname, external, injected });
  if (external) throw new Error(`isolated E2E network guard blocked ${url.origin}`);
  if (injected) return Response.json({ message: `intentional_${failureMode}_failure` }, { status: 503 });
  return nativeFetch(request);
};

const [fourText, pairText, oracleText] = await Promise.all([
  readFile(fourPath, "utf8"),
  readFile(pairPath, "utf8"),
  readFile(oraclePath, "utf8"),
]);
assert.equal(sha256(fourText), FOUR_CASE_SHA);
assert.equal(sha256(pairText), PAIR_SHA);
const fourCases = rows(JSON.parse(fourText).results);
const pairCases = rows(JSON.parse(pairText).results);
const oracle = rows(JSON.parse(oracleText));
const capturedRawItems = new Map<string, Row>();
for (const item of fourCases) capturedRawItems.set(text(item.accession), record(item.rawItem));
for (const item of pairCases) capturedRawItems.set(text(item.accession), record(item.collection?.items?.[0]));
assert.equal(capturedRawItems.size, 6);
assert.equal(oracle.length, 6);

const [{ runSecRawIngest }, { fetchSecEdgarRawItems }, rawStore, monitorPersistence, alertConsumer, supabase] = await Promise.all([
  import("../lib/secIngest.ts"),
  import("../lib/sources/sec/parser.ts"),
  import("../lib/secStores/rawStore.ts"),
  import("../lib/monitor/sc13MonitorPersistence.ts"),
  import("../lib/monitor/sc13MonitorAlertConsumer.ts"),
  import("../lib/supabase.ts"),
]);

const rawItems = new Map<string, Row>();
const collectionEvidence: Row[] = [];
for (const accession of ORDER) {
  const captured = requiredCapturedRaw(accession);
  const collection = await fetchSecEdgarRawItems({
    accessionNumber: accession,
    cik: text(captured.raw_payload.cik),
    formTypes: [text(captured.raw_payload.form_type)],
    includeDocuments: true,
  });
  assert.equal(collection.ok, true, `${accession}: ${collection.error || "collection failed"}`);
  assert.equal(collection.items.length, 1, accession);
  const live = collection.items[0] as Row;
  assert.equal(sha256(rawText(live.raw_payload.sc13_source_text)), sha256(rawText(captured.raw_payload.sc13_source_text)), `${accession}: canonical XML changed`);
  assert.equal(record(live.raw_payload.ticker_resolution).source, "issuer_cik_sec", `${accession}: canonical issuer ticker link`);
  assert.equal(text(live.raw_payload.ticker), text(requiredOracle(accession).ticker));
  rawItems.set(accession, guardedRaw(live));
  collectionEvidence.push({ accession, ticker: live.raw_payload.ticker, tickerResolution: live.raw_payload.ticker_resolution, sourceSha256: sha256(rawText(live.raw_payload.sc13_source_text)) });
}

const db = new PgClient({ connectionString: dbUrl });
await db.connect();
const ownerId = randomUUID();
const foreignId = randomUUID();
const createdMonitorIds: string[] = [];
const positiveMonitorIds: string[] = [];
const negativeMonitorIds: string[] = [];
const rawIds = new Map<string, string>();
const phaseEvidence: Row = {};

try {
  const identity = (await db.query("select current_database() database, current_user role, to_regclass('public.sc13_monitors')::text monitor_table, to_regprocedure('public.begin_sec_sc13_monitor_alert_attempt(uuid,text,text)')::text begin_rpc")).rows[0];
  assert.deepEqual(identity, { database: "postgres", role: "postgres", monitor_table: "sc13_monitors", begin_rpc: "begin_sec_sc13_monitor_alert_attempt(uuid,text,text)" });
  await db.query("insert into auth.users(id,email) values($1,$2),($3,$4)", [ownerId, `sc13-auto-owner-${ownerId}@example.test`, foreignId, `sc13-auto-foreign-${foreignId}@example.test`]);
  await db.query("insert into public.user_profiles(id,email) values($1,$2),($3,$4)", [ownerId, `sc13-auto-owner-${ownerId}@example.test`, foreignId, `sc13-auto-foreign-${foreignId}@example.test`]);

  const monitors = await createScenarioMonitors();
  assert.equal(createdMonitorIds.length, 15);
  assert.equal(positiveMonitorIds.length, 7);
  assert.equal(negativeMonitorIds.length, 8);

  const order = ORDER;
  const initialRuns: Row[] = [];
  for (const accession of order) {
    const result = await ingest(accession);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.stats.failed_count, 0);
    assert.equal(result.stats.sc13_xml_available_count, 1, JSON.stringify(result));
    assert.equal(result.stats.sc13_monitor_completed_count, 1, JSON.stringify(result));
    assert.equal(result.stats.sc13_monitor_failed_count, 0, JSON.stringify(result));
    const item = record(result.items[0]);
    const xml = record(item.sc13_xml_persistence);
    assert.equal(xml.status, "available");
    assert.equal(record(xml.monitor).status, "completed");
    assert.equal(text(record(xml.monitor).issuerCik), text(oracle.find((row) => row.accession === accession)?.issuerCik));
    rawIds.set(accession, text(item.raw_item_id));
    initialRuns.push({ accession, rawPath: item.skipped ? "replay" : "fresh", writeStatus: xml.writeStatus, issuerCik: record(xml.monitor).issuerCik, createdCount: record(record(xml.monitor).consumer).createdCount });
  }
  assert.notEqual(text(requiredRaw("0000947871-26-000860").raw_payload.cik), "0002131524", "raw filer CIK must not be the Monitor issuer identity");

  const baselineAlertCount = await alertCount();
  assert.equal(baselineAlertCount, 7);
  assert.equal(await alertsForMonitors(negativeMonitorIds), 0);
  assert.equal(initialRuns.find((run) => run.accession === order[0])?.createdCount, 1);
  assert.equal(initialRuns.find((run) => run.accession === order[2])?.createdCount, 3);
  const storage = (await db.query(`select
    (select count(*)::int from public.raw_items where id=any($1::uuid[])) raw_items,
    (select count(*)::int from public.sec_sc13_filings where accession_number=any($2::text[])) filings,
    (select count(*)::int from public.sec_sc13_reporting_persons where accession_number=any($2::text[])) reporters`, [[...rawIds.values()], order])).rows[0];
  assert.deepEqual(storage, { raw_items: 6, filings: 6, reporters: 31 });
  const brveHashes = (await db.query("select accession_number,source_sha256 from public.sec_sc13_filings where accession_number=any($1::text[]) order by accession_number", [[order[0], order[1]]])).rows;
  assert.deepEqual(brveHashes, [
    { accession_number: order[0], source_sha256: BRVE_ORIGINAL_SHA },
    { accession_number: order[1], source_sha256: BRVE_AMENDMENT_SHA },
  ]);
  await assertAllGuards(order, "completed");
  phaseEvidence.initial = { collection: collectionEvidence, runs: initialRuns, storedMonitors: 15, alerts: baselineAlertCount, nonTargetAlerts: 0, canonical: storage, brveHashes };
  phaseEvidence.siteAnalysisIndependence = {
    absentSiteAnalysis: { accession: order[0], automaticAlerts: 1 },
    failedSiteAnalysis: { accession: order[2], automaticAlerts: 3 },
    providerOrLlmCalls: 0,
  };

  const amendmentReplay = await ingest(order[1]);
  assertSuccessWithNoCreatedAlert(amendmentReplay);
  assert.equal(await alertCount(), baselineAlertCount);
  phaseEvidence.amendmentReplay = { additionalAlerts: 0, monitor: monitorResult(amendmentReplay) };

  const beforeConcurrent = await alertCount();
  const lode = requiredOracle(order[2]);
  const concurrentFirstMatch = await createMonitor(
    target(lode, lode.reporters[0]),
    [{ key: "sc13.aggregate_owned", operator: "gt", value: "0" }],
    true,
    true,
  );
  const concurrentRuns = await Promise.all(Array.from({ length: 12 }, () => ingest(order[2], true)));
  concurrentRuns.forEach((result) => {
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.stats.failed_count, 0);
    assert.equal(result.stats.sc13_xml_failed_count, 0);
    assert.equal(result.stats.sc13_monitor_completed_count, 1);
  });
  assert.equal(concurrentRuns.reduce((sum, result) => sum + Number(record(monitorResult(result).consumer).createdCount || 0), 0), 1);
  assert.equal(await alertsForMonitors([concurrentFirstMatch.id]), 1);
  assert.equal(await alertCount(), beforeConcurrent + 1);
  assert.equal((await rawState(order[2])).status, "completed");
  phaseEvidence.concurrentReplay = { runs: 12, firstMatchAlerts: 1, duplicateAlerts: 0, finalState: await rawState(order[2]) };

  failureMode = "reader";
  const readerFailure = await ingest(order[5]);
  failureMode = "none";
  assertIsolatedMonitorFailure(readerFailure, "failed");
  assert.equal((await rawState(order[5])).status, "failed");
  await assertGuard(order[5]);
  const readerRetry = await ingest(order[5]);
  assertSuccessWithNoCreatedAlert(readerRetry);
  assert.equal((await rawState(order[5])).status, "completed");
  phaseEvidence.readerFailureRetry = { xmlAndSiteStayedSuccessful: true, failedState: "failed", retryState: "completed", additionalAlerts: 0 };

  const brve = requiredOracle(order[1]);
  const retryMonitor = await createMonitor(
    target(brve, brve.reporters[0]),
    [{ key: "sc13.percent_of_class", operator: "gte", value: "13.5" }],
    true,
    true,
  );
  const beforeAlertFailure = await alertCount();
  failureMode = "alert_write";
  const alertFailure = await ingest(order[1]);
  failureMode = "none";
  assertIsolatedMonitorFailure(alertFailure, "partial_failure");
  assert.equal((await rawState(order[1])).status, "failed");
  assert.equal(await alertsForMonitors([retryMonitor.id]), 0);
  await assertGuard(order[1]);
  const alertRetry = await ingest(order[1]);
  assert.equal(record(monitorResult(alertRetry).consumer).createdCount, 1);
  assert.equal(await alertsForMonitors([retryMonitor.id]), 1);
  assert.equal(await alertCount(), beforeAlertFailure + 1);
  assert.equal((await rawState(order[1])).status, "completed");
  const alertReplay = await ingest(order[1]);
  assertSuccessWithNoCreatedAlert(alertReplay);
  phaseEvidence.alertFailureRetry = { failedAttemptAlerts: 0, retryAlerts: 1, replayAdditionalAlerts: 0, failedState: "failed", retryState: "completed" };

  failureMode = "finish_write";
  const finishFailure = await ingest(order[1]);
  failureMode = "none";
  assert.equal(finishFailure.ok, true);
  assert.equal(monitorResult(finishFailure).status, "failed");
  assert.equal(monitorResult(finishFailure).stateRecorded, false);
  assert.equal((await rawState(order[1])).status, "pending");
  const finishRetry = await ingest(order[1]);
  assertSuccessWithNoCreatedAlert(finishRetry);
  phaseEvidence.finishWriteFailureRetry = { observablePending: true, retryState: (await rawState(order[1])).status, additionalAlerts: 0 };

  const stateBeforeBeginFailure = await rawState(order[1]);
  failureMode = "begin_write";
  const beginFailure = await ingest(order[1]);
  failureMode = "none";
  assert.equal(beginFailure.ok, true);
  assert.equal(monitorResult(beginFailure).status, "failed");
  assert.equal(monitorResult(beginFailure).stateRecorded, false);
  assert.deepEqual(await rawState(order[1]), stateBeforeBeginFailure);
  assertSuccessWithNoCreatedAlert(await ingest(order[1]));
  phaseEvidence.beginWriteFailureRetry = { priorStatePreserved: true, consumerStillRan: true, retryState: (await rawState(order[1])).status, additionalAlerts: 0 };

  const stale = await verifyGenerationOrdering(order[2]);
  assertSuccessWithNoCreatedAlert(await ingest(order[2]));
  phaseEvidence.generationOrdering = stale;

  const beforeWholeSave = await rawRow(order[2]);
  const staleMetadata = structuredClone(record(beforeWholeSave.metadata));
  staleMetadata.sc13_monitor_alert = { ...record(staleMetadata.sc13_monitor_alert), status: "pending" };
  await rawStore.saveSecRawItem(requiredRaw(order[2]) as never, text(beforeWholeSave.run_id), { ...beforeWholeSave, metadata: staleMetadata });
  const afterWholeSave = await rawRow(order[2]);
  assert.equal(record(record(afterWholeSave.metadata).sc13_monitor_alert).status, "completed");
  await assertGuard(order[2]);
  phaseEvidence.wholeMetadataRace = { stalePendingCouldNotReplaceCompleted: true, siteAnalysisGuardPreserved: true };

  const ownerAlerts = await ownerReadback(ownerId);
  const foreignAlerts = await ownerReadback(foreignId);
  assert.equal(ownerAlerts.length, 9);
  assert.equal(foreignAlerts.length, 0);
  assert.ok(ownerAlerts.every((alert) => alert.evidence.meaning === "latest_saved_filing_value_not_realtime_ownership"));
  const originalAlert = ownerAlerts.find((alert) => alert.monitorId === monitors.original.id);
  assert.equal(originalAlert?.rootAccessionNumber, order[0]);
  assert.equal(originalAlert?.headAccessionNumber, order[0]);
  const externalized = Number((await db.query("select count(*) n from public.user_alert_deliveries where user_id=$1 and (alert_event_id is not null or scheduled_for is not null or cardinality(delivered_channels)>0 or sent_at is not null or attempted_at is not null)", [ownerId])).rows[0].n);
  assert.equal(externalized, 0);
  assert.equal(networkLedger.filter((entry) => entry.external).length, 0);
  const aiRuns = Number((await db.query("select count(*) n from public.ai_runs where raw_item_id=any($1::uuid[])", [[...rawIds.values()]])).rows[0].n);
  assert.equal(aiRuns, 0);

  const migrationRows = (await db.query("select version,name from supabase_migrations.schema_migrations order by version")).rows;
  const manifest = {
    sourceArtifacts: { [fourPath]: FOUR_CASE_SHA, [pairPath]: PAIR_SHA, [oraclePath]: sha256(oracleText) },
    implementation: Object.fromEntries(await Promise.all([
      "lib/secIngest.ts",
      "lib/sec-sc13-xml/persistence.ts",
      "lib/monitor/sc13MonitorAutomaticTrigger.ts",
      "supabase/migrations/20260911134031_sec_sc13_monitor_auto_state.sql",
      "scripts/verify-sc13-monitor-auto-ingest-isolated.ts",
    ].map(async (path) => [path, sha256(await readFile(new URL(`../${path}`, import.meta.url), "utf8"))]))),
  };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(manifestPath, manifestText, "utf8");
  const output = {
    status: "PASS",
    isolation: { projectId: "stock-radar-sc13-auto-58721-20260911", apiPort: 58721, dbPort: 58722, sharedPortsTouched: false },
    sourceHashes: manifest.sourceArtifacts,
    manifestPath,
    manifestSha256: sha256(manifestText),
    phases: phaseEvidence,
    final: { filings: 6, reporters: 31, baselineStoredMonitors: 15, finalStoredMonitors: createdMonitorIds.length, baselineOwnerAlerts: 7, ownerAlerts: ownerAlerts.length, foreignAlerts: foreignAlerts.length, nonTargetAlerts: 0, externalizedAlerts: externalized, providerOrLlmCalls: 0, aiRuns, siteAnalysisStatesUnchanged: true },
    migrations: { applied: migrationRows.length, latest: migrationRows.at(-1) },
  };
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ ok: true, outputPath, manifestPath, manifestSha256: output.manifestSha256, final: output.final })}\n`);
} finally {
  failureMode = "none";
  await db.end();
}

async function createScenarioMonitors() {
  const brveOriginal = requiredOracle("0000947871-26-000814");
  const brveAmendment = requiredOracle("0000947871-26-000860");
  const lode = requiredOracle("0000921895-26-000805");
  const original = await createMonitor(target(brveOriginal, brveOriginal.reporters[0]), [{ key: "sc13.aggregate_owned", operator: "gt", value: "0" }], true, true);
  for (const source of [brveAmendment, lode]) {
    for (const reporter of source.reporters) await createMonitor(target(source, reporter), exactConditions(reporter), true, true);
  }
  const reference = target(brveAmendment, brveAmendment.reporters[0]);
  await createMonitor({ ...reference, reportingPersonCik: "0000000001" }, [{ key: "sc13.aggregate_owned", operator: "gt", value: "0" }], true, false);
  await createMonitor({ ...reference, securityClass: "PREFERRED STOCK" }, [{ key: "sc13.aggregate_owned", operator: "gt", value: "0" }], true, false);
  await createMonitor({ ...reference, cusips: ["000000001"] }, [{ key: "sc13.aggregate_owned", operator: "gt", value: "0" }], true, false);
  await createMonitor(reference, [
    { key: "sc13.aggregate_owned", operator: "eq", value: brveAmendment.reporters[0].values.aggregateAmountOwnedRaw },
    { key: "sc13.percent_of_class", operator: "eq", value: brveAmendment.reporters[1].values.percentOfClassRaw },
  ], true, false);
  for (const accession of ["0000902664-26-002298", "0002100119-26-000820", "0000102909-26-000630"]) {
    const source = requiredOracle(accession);
    await createMonitor(target(source, source.reporters[0], text(source.reporters[0].cik) || "0000000001"), [{ key: "sc13.aggregate_owned", operator: "gte", value: "0" }], true, false);
  }
  await createMonitor(reference, [{ key: "sc13.aggregate_owned", operator: "gt", value: "0" }], false, false);
  return { original };
}

async function createMonitor(targetValue: Row, conditions: Row[], isActive: boolean, positive: boolean) {
  const created = await monitorPersistence.createSc13Monitor({ ownerId, target: targetValue, conditions, isActive });
  createdMonitorIds.push(created.id);
  (positive ? positiveMonitorIds : negativeMonitorIds).push(created.id);
  return created;
}

async function ingest(accession: string, force = false): Promise<Row> {
  const rawItem = requiredRaw(accession);
  return await runSecRawIngest({ accessionNumber: accession, includeDocuments: true, force }, {
    fetchRawItems: async () => ({ ok: true, status: 200, items: [structuredClone(rawItem)], diagnostics: { documentsRequested: 1, documentsFetched: 1, documentsFailed: 0 } }) as never,
  }) as Row;
}

function assertSuccessWithNoCreatedAlert(result: Row) {
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.stats.failed_count, 0);
  assert.equal(result.stats.sc13_xml_failed_count, 0);
  assert.equal(result.stats.sc13_monitor_completed_count, 1);
  assert.equal(record(monitorResult(result).consumer).createdCount, 0);
}

function assertIsolatedMonitorFailure(result: Row, consumerStatus: string) {
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.stats.failed_count, 0);
  assert.equal(result.stats.sc13_xml_failed_count, 0);
  assert.equal(result.stats.sc13_monitor_failed_count, 1);
  assert.equal(monitorResult(result).status, "failed");
  assert.equal(record(monitorResult(result).consumer).status, consumerStatus);
}

async function verifyGenerationOrdering(accession: string) {
  const raw = await rawRow(accession);
  const filing = (await db.query("select issuer_cik,source_sha256 from public.sec_sc13_filings where raw_item_id=$1", [raw.id])).rows[0];
  const first = record((await supabase.supabaseRpc("begin_sec_sc13_monitor_alert_attempt", { p_raw_item_id: raw.id, p_issuer_cik: filing.issuer_cik, p_source_sha256: filing.source_sha256 })).data);
  const second = record((await supabase.supabaseRpc("begin_sec_sc13_monitor_alert_attempt", { p_raw_item_id: raw.id, p_issuer_cik: filing.issuer_cik, p_source_sha256: filing.source_sha256 })).data);
  assert.equal(first.status, "started"); assert.equal(second.status, "started");
  const newer = record((await supabase.supabaseRpc("finish_sec_sc13_monitor_alert_attempt", { p_raw_item_id: raw.id, p_attempt_id: second.attempt_id, p_attempt_generation: second.attempt_generation, p_status: "completed", p_error: null, p_result: {} })).data);
  const stale = record((await supabase.supabaseRpc("finish_sec_sc13_monitor_alert_attempt", { p_raw_item_id: raw.id, p_attempt_id: first.attempt_id, p_attempt_generation: first.attempt_generation, p_status: "failed", p_error: "stale failure", p_result: {} })).data);
  assert.equal(newer.status, "updated"); assert.equal(stale.status, "preserved"); assert.equal((await rawState(accession)).status, "completed");
  const later = record((await supabase.supabaseRpc("begin_sec_sc13_monitor_alert_attempt", { p_raw_item_id: raw.id, p_issuer_cik: filing.issuer_cik, p_source_sha256: filing.source_sha256 })).data);
  await supabase.supabaseRpc("finish_sec_sc13_monitor_alert_attempt", { p_raw_item_id: raw.id, p_attempt_id: later.attempt_id, p_attempt_generation: later.attempt_generation, p_status: "failed", p_error: "later replay failure", p_result: {} });
  assert.equal((await rawState(accession)).status, "failed");
  return { olderFailureAfterNewerSuccess: stale.status, newerSequentialFailureRecorded: true };
}

async function ownerReadback(readOwnerId: string) {
  await db.query("begin");
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [readOwnerId]);
    await db.query("set local role authenticated");
    return await alertConsumer.listSc13MonitorAlertsForOwner({ ownerId: ownerId }, {
      list: async ({ ownerId: requestedOwner, monitorId }: { ownerId: string; monitorId?: string }) => {
        const result = await db.query(`select id,sc13_monitor_id,sc13_root_accession,sc13_head_accession,sc13_reporter_cik,sc13_security_class,sc13_cusips,sc13_match_evidence,created_at::text
          from public.user_alert_deliveries where user_id=$1 and alert_domain='sc13' and alert_lane='sc13_monitor'
          and ($2::uuid is null or sc13_monitor_id=$2) order by delivered_at desc,id desc limit 100`, [requestedOwner, monitorId || null]);
        return { ok: true, status: 200, data: result.rows };
      },
    });
  } finally {
    await db.query("rollback");
  }
}

async function rawRow(accession: string) {
  const result = await db.query("select * from public.raw_items where source_unique_id=$1", [accession]);
  assert.equal(result.rows.length, 1, accession);
  return result.rows[0];
}
async function rawState(accession: string) { return record(record((await rawRow(accession)).metadata).sc13_monitor_alert); }
async function assertGuard(accession: string) {
  const metadata = record((await rawRow(accession)).metadata);
  if (accession === "0000947871-26-000814") {
    assert.equal(metadata.site_analysis_guard, undefined);
    assert.equal(metadata.workflow_analysis_status, undefined);
  } else if (accession === "0000921895-26-000805") {
    assert.deepEqual(metadata.site_analysis_guard, { status: "failed", result_hash: `site-${accession}` });
    assert.equal(metadata.workflow_analysis_status, "failed");
  } else {
    assert.deepEqual(metadata.site_analysis_guard, { status: "completed", result_hash: `site-${accession}` });
    assert.equal(metadata.workflow_analysis_status, "completed");
  }
  assert.equal(record(metadata.sc13_xml_persistence).status, "available");
}
async function assertAllGuards(accessions: string[], monitorStatus: string) { for (const accession of accessions) { await assertGuard(accession); assert.equal((await rawState(accession)).status, monitorStatus); } }
async function alertCount() { return Number((await db.query("select count(*) n from public.user_alert_deliveries where user_id=$1 and alert_lane='sc13_monitor'", [ownerId])).rows[0].n); }
async function alertsForMonitors(ids: string[]) { return Number((await db.query("select count(*) n from public.user_alert_deliveries where sc13_monitor_id=any($1::uuid[])", [ids])).rows[0].n); }

function guardedRaw(value: Row) {
  const accession = text(value.source_unique_id);
  const metadata = { ...record(value.metadata) };
  delete metadata.workflow_analysis_status;
  delete metadata.site_analysis_guard;
  if (accession === "0000921895-26-000805") {
    metadata.workflow_analysis_status = "failed";
    metadata.site_analysis_guard = { status: "failed", result_hash: `site-${accession}` };
  } else if (accession !== "0000947871-26-000814") {
    metadata.workflow_analysis_status = "completed";
    metadata.site_analysis_guard = { status: "completed", result_hash: `site-${accession}` };
  }
  return { ...structuredClone(value), metadata };
}
function target(source: Row, reporter: Row, reporterCik = text(reporter.cik)) { return { issuerCik: source.issuerCik, reportingPersonCik: reporterCik, securityClass: monitorPersistence.normalizeSc13SecurityClass(source.security.classTitleRaw), cusips: monitorPersistence.normalizeSc13Cusips(source.security.cusipsRaw) }; }
function exactConditions(reporter: Row) { return [["sc13.aggregate_owned", "aggregateAmountOwnedRaw"], ["sc13.percent_of_class", "percentOfClassRaw"], ["sc13.sole_voting", "soleVotingPowerRaw"], ["sc13.shared_voting", "sharedVotingPowerRaw"], ["sc13.sole_dispositive", "soleDispositivePowerRaw"], ["sc13.shared_dispositive", "sharedDispositivePowerRaw"]].map(([key, field]) => ({ key, operator: "eq", value: /^0(?:\.0+)?$/.test(reporter.values[field]) ? "0" : reporter.values[field] })); }
function monitorResult(result: Row) { return record(record(record(result.items[0]).sc13_xml_persistence).monitor); }
function requiredRaw(accession: string) { const raw = rawItems.get(accession); if (!raw) throw new Error(`missing raw ${accession}`); return raw; }
function requiredCapturedRaw(accession: string) { const raw = capturedRawItems.get(accession); if (!raw) throw new Error(`missing captured raw ${accession}`); return raw; }
function requiredOracle(accession: string) { const value = oracle.find((row) => row.accession === accession); if (!value) throw new Error(`missing oracle ${accession}`); return value; }
function shouldInject(mode: FailureMode, method: string, path: string) { return (mode === "reader" && method === "GET" && path === "/rest/v1/sec_sc13_filings") || (mode === "alert_write" && method === "POST" && path === "/rest/v1/user_alert_deliveries") || (mode === "begin_write" && path === "/rest/v1/rpc/begin_sec_sc13_monitor_alert_attempt") || (mode === "finish_write" && path === "/rest/v1/rpc/finish_sec_sc13_monitor_alert_attempt"); }
function assertIsolated(dbTarget: URL, apiTarget: URL) { assert.ok(["127.0.0.1", "localhost"].includes(dbTarget.hostname)); assert.ok(["127.0.0.1", "localhost"].includes(apiTarget.hostname)); assert.equal(dbTarget.port, "58722"); assert.equal(apiTarget.port, "58721"); }
function requiredEnv(name: string) { const value = process.env[name]?.trim(); if (!value) throw new Error(`${name} is required`); return value; }
function sha256(value: string) { return createHash("sha256").update(value, "utf8").digest("hex"); }
function rows(value: unknown): Row[] { return Array.isArray(value) ? value.filter((item): item is Row => Boolean(item && typeof item === "object" && !Array.isArray(item))) : []; }
function record(value: unknown): Row { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }
function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function rawText(value: unknown) { return typeof value === "string" ? value : ""; }
