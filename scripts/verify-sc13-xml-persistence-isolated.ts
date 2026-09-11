import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire, registerHooks } from "node:module";

type DbClient = {
  connect(): Promise<void>;
  end(): Promise<void>;
  query(sql: string, values?: unknown[]): Promise<{ rows: Row[] }>;
};
const PgClient = (createRequire(import.meta.url)("pg") as { Client: new (options: { connectionString: string }) => DbClient }).Client;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export%20%7B%7D;" };
    }
    return nextResolve(specifier, context);
  },
});

const SOURCE_ARTIFACT_SHA256 = "48c46e453b9cd46e5d1a6640082dd399230a78b35e1e7b770feea9bd4f401e5e";
const sourceArtifactPath = process.env.SC13_E2E_SOURCE_ARTIFACT
  ?? "C:/Users/PC/AppData/Local/Temp/stockradar-sc13-b058cd-live-verification.json";
const outputPath = process.env.SC13_E2E_OUTPUT
  ?? "C:/Users/PC/AppData/Local/Temp/stockradar-sc13-1b65-e2e.json";
const dbUrl = requiredEnv("SC13_ISOLATED_DB_URL");
const expectedDbPort = requiredEnv("SC13_ISOLATED_DB_PORT");
const apiUrl = requiredEnv("SUPABASE_URL");
const secretKey = requiredEnv("SUPABASE_SECRET_KEY");
const publishableKey = requiredEnv("SUPABASE_PUBLISHABLE_KEY");

assertIsolatedTargets(new URL(dbUrl), expectedDbPort, new URL(apiUrl));
const isolatedApiOrigin = new URL(apiUrl).origin;
const networkLedger: Array<{ method: string; origin: string; pathname: string; allowed: boolean }> = [];
const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
  const requestUrl = new URL(input instanceof Request ? input.url : input.toString());
  const allowed = requestUrl.origin === isolatedApiOrigin;
  networkLedger.push({
    method: init?.method ?? (input instanceof Request ? input.method : "GET"),
    origin: requestUrl.origin,
    pathname: requestUrl.pathname,
    allowed,
  });
  if (!allowed) throw new Error(`E2E network guard blocked ${requestUrl.origin}`);
  return nativeFetch(input, init);
};
process.env.SUPABASE_DB_URL = dbUrl;
process.env.SEC_ANALYSIS_ALLOW_OPENAI = "true";
process.env.SEC_ANALYSIS_LLM_PROVIDER = "openai";
delete process.env.OPENAI_API_KEY;
delete process.env.GEMINI_API_KEY;
process.env.ALERT_DELIVERY_SEND_TELEGRAM = "false";
process.env.ALERT_DELIVERY_SEND_TELEGRAM_PUBLIC = "false";
process.env.ALERT_DELIVERY_SEND_EMAIL = "false";

const sourceArtifactText = await readFile(sourceArtifactPath, "utf8");
assert.equal(sha256(sourceArtifactText), SOURCE_ARTIFACT_SHA256, "source artifact SHA-256");
const sourceArtifact = JSON.parse(sourceArtifactText) as Row;
assert.equal(sourceArtifact.overallPass, true, "captured product collector verification must be passing");
const capturedCases = rows(sourceArtifact.results);
assert.equal(capturedCases.length, 4, "exactly four authorized SEC filings");
const byTicker = new Map(capturedCases.map((item) => [stringValue(item.ticker), item]));
assert.deepEqual([...byTicker.keys()], ["LODE", "MTCH", "MSFT", "AAPL"]);

const [{ runSecRawIngest }, rawStore, persistence, canonical, { runSecFilingAnalysisIngest }] = await Promise.all([
  import("../lib/secIngest.ts"),
  import("../lib/secStores/rawStore.ts"),
  import("../lib/sec-sc13-xml/persistence.ts"),
  import("../lib/sec-sc13-xml/canonical.ts"),
  import("../lib/secFilingAnalysisIngest.ts"),
]);

const admin = new PgClient({ connectionString: dbUrl });
await admin.connect();
const output: Row = {
  ok: false,
  isolated: {
    databaseHost: new URL(dbUrl).hostname,
    databasePort: Number(expectedDbPort),
    apiOrigin: new URL(apiUrl).origin,
    sharedPortsRejected: [56321, 56322],
  },
  sourceArtifact: { path: sourceArtifactPath, sha256: SOURCE_ARTIFACT_SHA256 },
};

try {
  const accessions = capturedCases.map((item) => stringValue(item.accession));
  const clean = await admin.query(
    "select count(*)::integer as count from public.raw_items where source_unique_id = any($1::text[])",
    [accessions],
  );
  assert.equal(clean.rows[0]?.count, 0, "isolated database must start without target filings");

  const gateResults = new Map<string, Row>();
  for (const ticker of ["LODE", "MTCH", "MSFT", "AAPL"] as const) {
    const gateResult = await runCapturedIngest(runSecRawIngest, requiredCase(byTicker, ticker));
    assert.equal(gateResult.ok, true, `${ticker} product ingest gate result`);
    assert.equal(gateResult.stats.excluded_count, 1, `${ticker} is excluded before raw persistence with the unmodified captured collector result`);
    assert.equal(gateResult.stats.raw_upserted_count, 0);
    assert.equal(gateResult.stats.sc13_xml_available_count, 0, "the current hook is unreachable before the pre-raw gate");
    gateResults.set(ticker, gateResult);
  }
  assert.equal((await admin.query("select count(*)::integer as count from public.raw_items")).rows[0]?.count, 0);

  const lode = requiredCase(byTicker, "LODE");
  const savedLodeRaw = await rawStore.saveSecRawItem(
    record(lode.rawItem) as never,
    stringValue(gateResults.get("LODE")?.runId),
  );
  const lodeRawItemId = stringValue(savedLodeRaw.id);
  assert.ok(lodeRawItemId);
  await admin.query("revoke execute on function public.persist_sec_sc13_filing(uuid,jsonb,jsonb) from service_role");
  let firstStorageError: unknown;
  try {
    await persistence.persistSc13CanonicalXmlForRawItem({ rawItemId: lodeRawItemId, rawItem: record(lode.rawItem) });
  } catch (error) {
    firstStorageError = error;
  }
  assert.ok(firstStorageError instanceof Error, "revoked persistence fails independently after raw storage");
  await persistence.recordSc13CanonicalPersistenceState({
    rawItemId: lodeRawItemId,
    state: persistence.sc13PersistenceFailureState(firstStorageError),
  });
  assert.equal(await tableCount(admin, "sec_sc13_filings", "accession_number", stringValue(lode.accession)), 0);
  const failedRaw = await rawItemById(lodeRawItemId);
  assert.equal(record(record(failedRaw.metadata).sc13_xml_persistence).status, "failed");

  const analysisResult = await runSecFilingAnalysisIngest({
    rawItemId: lodeRawItemId,
    dryRun: false,
    force: true,
    suppressAlerts: true,
    llmProvider: "openai",
  });
  assert.equal(analysisResult.ok, true, "the exact captured raw item remains readable by site analysis");
  assert.equal(analysisResult.stage, "skipped", "the existing no-ticker gate skips before LLM execution");
  assert.equal(analysisResult.skipped, true);
  const blockedExternalRequests = networkLedger.filter((entry) => !entry.allowed);
  assert.deepEqual(
    blockedExternalRequests.map((entry) => `${entry.method} ${entry.origin}${entry.pathname}`),
    ["GET https://www.sec.gov/files/company_tickers_exchange.json"],
    "the only external attempt is the existing ticker catalog lookup, and the guard blocks it before transport",
  );
  assert.equal(blockedExternalRequests.some((entry) => /openai|gemini|fmp/i.test(entry.origin)), false, "no LLM or FMP attempt");
  const metadataBeforeRecovery = withoutSc13State(record((await rawItemById(lodeRawItemId)).metadata));

  await admin.query("grant execute on function public.persist_sec_sc13_filing(uuid,jsonb,jsonb) to service_role");
  const storageRecovery = await persistence.persistSc13CanonicalXmlForRawItem({
    rawItemId: lodeRawItemId,
    rawItem: record(lode.rawItem),
  });
  assert.equal(storageRecovery.status, "available");
  if (storageRecovery.status !== "available") throw new Error("LODE canonical persistence unexpectedly not applicable");
  await persistence.recordSc13CanonicalPersistenceState({ rawItemId: lodeRawItemId, state: storageRecovery });
  assert.equal(storageRecovery.writeStatus, "inserted");
  const recoveredRaw = await rawItemById(lodeRawItemId);
  assert.equal(record(record(recoveredRaw.metadata).sc13_xml_persistence).status, "available");
  assert.deepEqual(withoutSc13State(record(recoveredRaw.metadata)), metadataBeforeRecovery, "recovery preserves analysis metadata");

  const mtch = requiredCase(byTicker, "MTCH");
  const savedMtchRaw = await rawStore.saveSecRawItem(
    record(mtch.rawItem) as never,
    stringValue(gateResults.get("MTCH")?.runId),
  );
  const mtchRawItemId = stringValue(savedMtchRaw.id);
  assert.ok(mtchRawItemId);
  assert.equal(await tableCount(admin, "raw_items", "source_unique_id", stringValue(mtch.accession)), 1);
  assert.equal(await tableCount(admin, "sec_sc13_filings", "accession_number", stringValue(mtch.accession)), 0);
  const concurrentCanonicalResults = await Promise.all([
    persistence.persistSc13CanonicalXmlForRawItem({ rawItemId: mtchRawItemId, rawItem: record(mtch.rawItem) }),
    persistence.persistSc13CanonicalXmlForRawItem({ rawItemId: mtchRawItemId, rawItem: record(mtch.rawItem) }),
  ]);
  assert.deepEqual(
    concurrentCanonicalResults.map((result) => result.writeStatus).sort(),
    ["inserted", "replayed"],
    "concurrent first persistence serializes to one insert and one exact replay",
  );
  assert.equal(await tableCount(admin, "sec_sc13_filings", "accession_number", stringValue(mtch.accession)), 1);
  assert.equal(await tableCount(admin, "sec_sc13_reporting_persons", "accession_number", stringValue(mtch.accession)), 20);

  for (const ticker of ["MSFT", "AAPL"] as const) {
    const sourceCase = requiredCase(byTicker, ticker);
    const savedRaw = await rawStore.saveSecRawItem(
      record(sourceCase.rawItem) as never,
      stringValue(gateResults.get(ticker)?.runId),
    );
    const result = await persistence.persistSc13CanonicalXmlForRawItem({
      rawItemId: stringValue(savedRaw.id),
      rawItem: record(sourceCase.rawItem),
    });
    assert.equal(result.status, "available", `${ticker} canonical availability`);
  }

  const beforeExistingRawGate = await canonicalSnapshot(admin, accessions);
  const existingRawGateResult = await runCapturedIngest(runSecRawIngest, lode);
  assert.equal(existingRawGateResult.ok, true);
  assert.equal(existingRawGateResult.stats.excluded_count, 1, "the existing raw item is still excluded before lookup");
  assert.equal(existingRawGateResult.stats.skipped_count, 1);
  assert.equal(existingRawGateResult.stats.sc13_xml_available_count, 0, "the existing-raw replay hook remains unreachable");
  assert.deepEqual(await canonicalSnapshot(admin, accessions), beforeExistingRawGate, "existing-raw gate attempt changes no canonical rows");

  const criticalChecks: Row[] = [];
  const readbacks: Row[] = [];
  for (const ticker of ["LODE", "MTCH", "MSFT", "AAPL"] as const) {
    const sourceCase = requiredCase(byTicker, ticker);
    const accession = stringValue(sourceCase.accession);
    const expectedFiling = record(sourceCase.independentXml);
    const readback = await persistence.readSc13FilingByAccession(accession);
    assert.equal(readback.status, "available", `${ticker} accession readback`);
    if (readback.status !== "available") throw new Error(`${ticker} readback unavailable`);
    assert.deepEqual(readback.structural.filing, expectedFiling, `${ticker} every structural XML field`);
    const expectedCount = ({ LODE: 3, MTCH: 20, MSFT: 1, AAPL: 1 } as const)[ticker];
    assert.equal(readback.reporters.length, expectedCount, `${ticker} reporter count`);
    assert.equal(readback.filing.raw_xml, record(sourceCase.rawItem).raw_payload
      ? record(record(sourceCase.rawItem).raw_payload).sc13_source_text
      : null, `${ticker} exact source XML text`);
    const history = await persistence.readSc13FilingHistoryByIssuer(stringValue(readback.filing.issuer_cik));
    assert.equal(history.status, "available", `${ticker} issuer history read`);
    if (history.status !== "available") throw new Error(`${ticker} history unavailable`);
    assert.equal(history.filings.length, 1);
    assert.equal(history.filings[0]?.filing.accession_number, accession);
    checkCriticalValues(ticker, readback.reporters, readback.filing);
    criticalChecks.push({ ticker, accession, reporterCount: readback.reporters.length, passed: true });
    readbacks.push({ ticker, accession, filing: readback.filing, reporters: readback.reporters });
  }

  const beforeReplay = await canonicalSnapshot(admin, accessions);
  const replayResults = [];
  for (const sourceCase of capturedCases) {
    const raw = await secretRest("raw_items", {
      select: "id",
      source_unique_id: `eq.${stringValue(sourceCase.accession)}`,
      limit: "1",
    });
    replayResults.push(await persistence.persistSc13CanonicalXmlForRawItem({
      rawItemId: stringValue(rows(raw)[0]?.id),
      rawItem: record(sourceCase.rawItem),
    }));
  }
  const afterReplay = await canonicalSnapshot(admin, accessions);
  assert.deepEqual(afterReplay, beforeReplay, "exact replay performs zero canonical row changes");
  assert.equal(afterReplay.filings.length, 4);
  assert.equal(afterReplay.reporters.length, 25);

  const savedLode = await persistence.readSc13FilingByAccession(stringValue(lode.accession));
  assert.equal(savedLode.status, "available");
  if (savedLode.status !== "available") throw new Error("LODE readback unavailable before conflict test");
  const conflictingRaw = structuredClone(record(lode.rawItem));
  const conflictingPayload = record(conflictingRaw.raw_payload);
  const originalXml = stringValue(conflictingPayload.sc13_source_text);
  const conflictingXml = originalXml.replace("Comstock Inc.", "Comstock LLC.");
  assert.notEqual(conflictingXml, originalXml);
  conflictingPayload.sc13_source_text = conflictingXml;
  conflictingPayload.sc13_source_text_char_count = conflictingXml.length;
  await assert.rejects(
    persistence.persistSc13CanonicalXmlForRawItem({ rawItemId: lodeRawItemId, rawItem: conflictingRaw }),
    /conflicting canonical payload/i,
  );
  assert.deepEqual(await canonicalSnapshot(admin, accessions), beforeReplay, "conflict changes zero canonical rows");

  const unavailableRaw = structuredClone(record(lode.rawItem));
  record(unavailableRaw.raw_payload).sc13_source_text = null;
  assert.throws(
    () => canonical.buildSc13CanonicalPayload(lodeRawItemId, unavailableRaw),
    (error) => error instanceof canonical.Sc13CanonicalSourceError && error.code === "source_unavailable",
  );
  const mismatchedRaw = structuredClone(record(lode.rawItem));
  record(mismatchedRaw.raw_payload).sc13_source_url = stringValue(record(mismatchedRaw.raw_payload).sc13_source_url)
    .replace("000092189526000805", "000092189526000806");
  assert.throws(
    () => canonical.buildSc13CanonicalPayload(lodeRawItemId, mismatchedRaw),
    (error) => error instanceof canonical.Sc13CanonicalSourceError && error.code === "source_unavailable",
  );

  const lodeClass = stringValue(savedLode.filing.security_class_raw);
  await admin.query(
    "update public.sec_sc13_filings set security_class_raw = 'WRONG CLASS' where accession_number = $1",
    [stringValue(lode.accession)],
  );
  assert.deepEqual(
    await persistence.readSc13FilingByAccession(stringValue(lode.accession)),
    { status: "unavailable", reason: "filing_columns_mismatch" },
    "readback fails closed on denormalized-column corruption",
  );
  await admin.query(
    "update public.sec_sc13_filings set security_class_raw = $2 where accession_number = $1",
    [stringValue(lode.accession), lodeClass],
  );

  const privilegeRows = await admin.query(`
    select
      has_table_privilege('anon', 'public.sec_sc13_filings', 'select') as anon_select,
      has_table_privilege('authenticated', 'public.sec_sc13_filings', 'select') as authenticated_select,
      has_table_privilege('service_role', 'public.sec_sc13_filings', 'select') as service_select,
      has_table_privilege('service_role', 'public.sec_sc13_filings', 'update') as service_update,
      has_function_privilege('anon', 'public.persist_sec_sc13_filing(uuid,jsonb,jsonb)', 'execute') as anon_rpc,
      has_function_privilege('service_role', 'public.persist_sec_sc13_filing(uuid,jsonb,jsonb)', 'execute') as service_rpc
  `);
  assert.deepEqual(privilegeRows.rows[0], {
    anon_select: false,
    authenticated_select: false,
    service_select: true,
    service_update: false,
    anon_rpc: false,
    service_rpc: true,
  });
  const anonymousRead = await fetch(`${apiUrl}/rest/v1/sec_sc13_filings?select=accession_number&limit=1`, {
    headers: { apikey: publishableKey },
  });
  assert.equal(anonymousRead.ok, false, "anonymous Data API read is denied");

  output.ok = true;
  output.productIngestGate = Object.fromEntries([...gateResults].map(([ticker, result]) => [ticker, {
    excludedCount: result.stats.excluded_count,
    rawUpsertedCount: result.stats.raw_upserted_count,
    canonicalAvailableCount: result.stats.sc13_xml_available_count,
  }]));
  output.productIngestGateExistingRaw = {
    ticker: "LODE",
    excludedCount: existingRawGateResult.stats.excluded_count,
    skippedCount: existingRawGateResult.stats.skipped_count,
    canonicalAvailableCount: existingRawGateResult.stats.sc13_xml_available_count,
    canonicalRowsChanged: 0,
  };
  output.failureIsolation = {
    rawStoreWriteOk: true,
    canonicalRowsDuringFailure: 0,
    stateRecorded: record(record(failedRaw.metadata).sc13_xml_persistence).status,
    analysisAttemptOk: analysisResult.ok,
    analysisStage: analysisResult.stage,
    llmCalls: 0,
    replayRecovered: true,
    analysisMetadataPreserved: true,
  };
  output.concurrency = {
    canonicalWriteStatuses: concurrentCanonicalResults.map((result) => result.writeStatus),
    rawDuplicates: 0,
    filingDuplicates: 0,
    reporterRows: 20,
  };
  output.replay = {
    writeStatuses: replayResults.map((result) => result.writeStatus),
    duplicateFilings: 0,
    duplicateReporters: 0,
    changedCanonicalRows: 0,
  };
  output.failClosed = {
    missingSourceWrites: 0,
    mismatchedSourceWrites: 0,
    conflictingPayloadWrites: 0,
    corruptedReadStatus: "unavailable",
  };
  output.permissions = { ...privilegeRows.rows[0], anonymousDataApiStatus: anonymousRead.status };
  output.network = {
    allowedOrigin: isolatedApiOrigin,
    blockedExternalAttempts: blockedExternalRequests,
    externalResponses: 0,
    allowedRequestCount: networkLedger.filter((entry) => entry.allowed).length,
  };
  output.criticalChecks = criticalChecks;
  output.readbacks = readbacks;
  output.finalCounts = { filings: afterReplay.filings.length, reporters: afterReplay.reporters.length };
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ ok: true, outputPath, finalCounts: output.finalCounts })}\n`);
} finally {
  await admin.end();
}

type Row = Record<string, any>;

async function runCapturedIngest(runSecRawIngest: Function, sourceCase: Row) {
  const collection = record(sourceCase.collection);
  return runSecRawIngest(
    { accessionNumber: stringValue(sourceCase.accession), includeDocuments: true, force: false },
    { fetchRawItems: async () => structuredClone(collection) },
  );
}

async function rawItemById(id: string) {
  const value = await secretRest("raw_items", { select: "id,metadata", id: `eq.${id}`, limit: "1" });
  const row = rows(value)[0];
  assert.ok(row, `raw item ${id}`);
  return row;
}

async function secretRest(table: string, query: Record<string, string>) {
  const url = new URL(`${apiUrl}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const response = await fetch(url, {
    headers: { apikey: secretKey, Authorization: `Bearer ${secretKey}`, Accept: "application/json" },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`REST ${table} failed: HTTP ${response.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

async function tableCount(client: DbClient, table: string, column: string, value: string) {
  const allowed = new Set(["raw_items", "sec_sc13_filings", "sec_sc13_reporting_persons"]);
  const columns = new Set(["source_unique_id", "accession_number"]);
  assert.ok(allowed.has(table) && columns.has(column));
  const result = await client.query(`select count(*)::integer as count from public.${table} where ${column} = $1`, [value]);
  return result.rows[0]?.count as number;
}

async function canonicalSnapshot(client: DbClient, accessions: string[]) {
  const [filings, reporters] = await Promise.all([
    client.query("select * from public.sec_sc13_filings where accession_number = any($1::text[]) order by accession_number", [accessions]),
    client.query("select * from public.sec_sc13_reporting_persons where accession_number = any($1::text[]) order by accession_number, reporting_person_index", [accessions]),
  ]);
  return { filings: filings.rows, reporters: reporters.rows };
}

function checkCriticalValues(ticker: "LODE" | "MTCH" | "MSFT" | "AAPL", reporters: readonly Row[], filing: Row) {
  if (ticker === "LODE") {
    assert.ok(reporters.every((row) => row.aggregate_amount_owned_raw === "5763729.00" && row.percent_of_class_raw === "8.1"));
  } else if (ticker === "MTCH") {
    const lp = reporters.find((row) => row.reporting_person_name_raw === "Starboard Value LP");
    const master = reporters.find((row) => row.reporting_person_name_raw === "Starboard Value and Opportunity Master Fund LTD");
    assert.equal(lp?.aggregate_amount_owned_raw, "10833200.00");
    assert.equal(lp?.percent_of_class_raw, "4.6");
    assert.equal(master?.aggregate_amount_owned_raw, "3479984.00");
    assert.equal(master?.percent_of_class_raw, "1.5");
    assert.equal(filing.issuer_cik, "0000891103");
    assert.equal(filing.header_filer_cik, "0001517137");
  } else if (ticker === "MSFT") {
    assert.equal(reporters[0]?.reporting_person_name_raw, "Vanguard Capital Management");
    assert.equal(reporters[0]?.aggregate_amount_owned_raw, "555988240");
    assert.equal(reporters[0]?.percent_of_class_raw, "7.48");
    assert.equal(reporters[0]?.sole_voting_power_raw, "73430154");
    assert.equal(filing.event_date_raw, "03/31/2026");
  } else {
    assert.equal(reporters[0]?.reporting_person_name_raw, "The Vanguard Group");
    assert.equal(reporters[0]?.aggregate_amount_owned_raw, "0");
    assert.equal(reporters[0]?.percent_of_class_raw, "0");
    assert.equal(reporters[0]?.sole_voting_power_raw, "0");
    assert.equal(reporters[0]?.shared_voting_power_raw, "0");
    assert.equal(reporters[0]?.sole_dispositive_power_raw, "0");
    assert.equal(reporters[0]?.shared_dispositive_power_raw, "0");
    assert.equal(filing.amendment_number_raw, "11");
    assert.equal(filing.previous_accession_number_raw, null);
  }
}

function withoutSc13State(metadata: Row) {
  const clone = structuredClone(metadata);
  delete clone.sc13_xml_persistence;
  return clone;
}

function requiredCase(byTicker: Map<string, Row>, ticker: string) {
  const value = byTicker.get(ticker);
  if (!value) throw new Error(`Missing captured case ${ticker}`);
  return value;
}

function assertIsolatedTargets(db: URL, expectedPort: string, api: URL) {
  assert.ok(db.hostname === "127.0.0.1" || db.hostname === "localhost");
  assert.equal(db.port, expectedPort);
  assert.equal(api.hostname, db.hostname);
  assert.equal(api.port, String(Number(expectedPort) - 1));
  assert.ok(!new Set(["56321", "56322", "58321", "58322"]).has(db.port));
  assert.ok(!new Set(["56321", "56322", "58321", "58322"]).has(api.port));
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter((item): item is Row => Boolean(item && typeof item === "object" && !Array.isArray(item))) : [];
}

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
