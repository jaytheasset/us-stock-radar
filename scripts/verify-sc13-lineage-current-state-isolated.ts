import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire, registerHooks } from "node:module";

type Row = Record<string, any>;
type DbClient = {
  connect(): Promise<void>;
  end(): Promise<void>;
  query(sql: string, values?: unknown[]): Promise<{ rows: Row[] }>;
};

const PgClient = (createRequire(import.meta.url)("pg") as {
  Client: new (options: { connectionString: string }) => DbClient;
}).Client;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { shortCircuit: true, url: "data:text/javascript,export%20%7B%7D;" };
    return nextResolve(specifier, context);
  },
});

const FOUR_CASE_ARTIFACT_SHA256 = "48c46e453b9cd46e5d1a6640082dd399230a78b35e1e7b770feea9bd4f401e5e";
const PAIR_ARTIFACT_SHA256 = "9f9c849994beba4628fa2d297906a3d6f9ebee008ac33f8b0fc2b56e148bdcf6";
const fourCaseArtifactPath = process.env.SC13_E2E_SOURCE_ARTIFACT
  ?? "C:/Users/PC/AppData/Local/Temp/stockradar-sc13-b058cd-live-verification.json";
const pairArtifactPath = process.env.SC13_LINEAGE_PAIR_ARTIFACT
  ?? "C:/Users/PC/AppData/Local/Temp/sc13-lineage-main-explicit-pair.json";
const outputPath = process.env.SC13_LINEAGE_E2E_OUTPUT
  ?? "C:/Users/PC/AppData/Local/Temp/stockradar-sc13-lineage-7f4b-e2e.json";
const dbUrl = requiredEnv("SC13_ISOLATED_DB_URL");
const expectedDbPort = requiredEnv("SC13_ISOLATED_DB_PORT");
const apiUrl = requiredEnv("SUPABASE_URL");
const secretKey = requiredEnv("SUPABASE_SECRET_KEY");

assertIsolatedTargets(new URL(dbUrl), expectedDbPort, new URL(apiUrl));
process.env.SUPABASE_DB_URL = dbUrl;
process.env.SEC_ANALYSIS_ALLOW_OPENAI = "false";
delete process.env.OPENAI_API_KEY;
delete process.env.GEMINI_API_KEY;
process.env.ALERT_DELIVERY_SEND_TELEGRAM = "false";
process.env.ALERT_DELIVERY_SEND_TELEGRAM_PUBLIC = "false";
process.env.ALERT_DELIVERY_SEND_EMAIL = "false";

const isolatedOrigin = new URL(apiUrl).origin;
const nativeFetch = globalThis.fetch.bind(globalThis);
const networkLedger: Array<{ method: string; origin: string; pathname: string; allowed: boolean }> = [];
globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
  const request = input instanceof Request ? input : new Request(input, init);
  const url = new URL(request.url);
  const allowed = url.origin === isolatedOrigin;
  networkLedger.push({ method: request.method, origin: url.origin, pathname: url.pathname, allowed });
  if (!allowed) throw new Error(`isolated E2E network guard blocked ${url.origin}`);
  return nativeFetch(request);
};

const [fourCaseText, pairText] = await Promise.all([
  readFile(fourCaseArtifactPath, "utf8"),
  readFile(pairArtifactPath, "utf8"),
]);
assert.equal(sha256(fourCaseText), FOUR_CASE_ARTIFACT_SHA256);
assert.equal(sha256(pairText), PAIR_ARTIFACT_SHA256);
const fourCaseArtifact = JSON.parse(fourCaseText) as Row;
const pairArtifact = JSON.parse(pairText) as Row;
assert.equal(fourCaseArtifact.overallPass, true);

const fourCases = rows(fourCaseArtifact.results);
assert.deepEqual(fourCases.map((item) => item.ticker), ["LODE", "MTCH", "MSFT", "AAPL"]);
const pairCases = rows(pairArtifact.results);
assert.deepEqual(pairCases.map((item) => item.accession), ["0000947871-26-000814", "0000947871-26-000860"]);
for (const item of pairCases) {
  assert.equal(item.error, null);
  assert.equal(item.structural?.status, "parsed");
  assert.equal(item.structural?.provenance?.indexStatus, "verified");
  assert.equal(item.structural?.source?.format, "sec_schedule_13_xml");
}

const rawItems = new Map<string, Row>();
for (const item of fourCases) rawItems.set(String(item.accession), record(item.rawItem));
for (const item of pairCases) rawItems.set(String(item.accession), record(item.collection?.items?.[0]));
assert.equal(rawItems.size, 6);

const [rawStore, persistence, currentState, supabase] = await Promise.all([
  import("../lib/secStores/rawStore.ts"),
  import("../lib/sec-sc13-xml/persistence.ts"),
  import("../lib/sec-sc13-xml/currentState.ts"),
  import("../lib/supabase.ts"),
]);

const admin = new PgClient({ connectionString: dbUrl });
await admin.connect();
const output: Row = {
  ok: false,
  isolated: {
    apiOrigin: isolatedOrigin,
    databaseHost: new URL(dbUrl).hostname,
    databasePort: Number(expectedDbPort),
    sharedPortsRejected: [56321, 56322, 58321, 58322, 58421, 58422],
  },
  artifacts: {
    fourCases: { path: fourCaseArtifactPath, sha256: FOUR_CASE_ARTIFACT_SHA256 },
    explicitPair: { path: pairArtifactPath, sha256: PAIR_ARTIFACT_SHA256 },
  },
};

try {
  const targetAccessions = [...rawItems.keys()];
  const clean = await admin.query(
    "select count(*)::integer as count from public.raw_items where source_unique_id = any($1::text[])",
    [targetAccessions],
  );
  assert.equal(clean.rows[0]?.count, 0, "fresh isolated database target rows");

  await rawStore.ensureSecSource();
  const runId = randomUUID();
  await rawStore.createSecSourceRun({
    force: false,
    includeDocuments: true,
    requestedFormTypes: ["SCHEDULE 13D", "SCHEDULE 13D/A", "SCHEDULE 13G", "SCHEDULE 13G/A"],
    requestedLimit: 6,
    runId,
    startedAt: new Date().toISOString(),
    metadata: { isolated_sc13_lineage_e2e: true, provider_calls: 0 },
  });

  const rawIds = new Map<string, string>();
  const persistOne = async (accession: string) => {
    const rawItem = requiredRaw(rawItems, accession);
    const saved = await rawStore.saveSecRawItem(rawItem as never, runId);
    const rawItemId = String(saved.id);
    assert.match(rawItemId, /^[0-9a-f-]{36}$/i);
    rawIds.set(accession, rawItemId);
    const result = await persistence.persistSc13CanonicalXmlForRawItem({ rawItemId, rawItem });
    assert.equal(result.status, "available", accession);
    return result;
  };

  const pairAmendment = "0000947871-26-000860";
  const pairOriginal = "0000947871-26-000814";
  await persistOne(pairAmendment);
  const amendmentFirst = await currentState.readSc13IssuerCurrentState("0002131524");
  assert.equal(amendmentFirst.status, "available");
  if (amendmentFirst.status !== "available") throw new Error("amendment-first read unavailable");
  assert.equal(amendmentFirst.lineage.links[0]?.reason, "missing_predecessor");
  assert.equal(amendmentFirst.lineage.positions[0]?.status, "unresolved");

  await persistOne(pairOriginal);
  for (const accession of targetAccessions.filter((value) => value !== pairOriginal && value !== pairAmendment)) {
    await persistOne(accession);
  }

  const brve = await currentState.readSc13IssuerCurrentState("0002131524");
  assert.equal(brve.status, "available");
  if (brve.status !== "available") throw new Error("BRVE read unavailable");
  assert.equal(brve.historyComplete, true);
  assert.equal(brve.history.length, 2);
  assert.deepEqual(brve.history.map((item) => item.filing.accession_number).sort(), [pairOriginal, pairAmendment].sort());
  assert.deepEqual(brve.lineage.links, [{
    accessionNumber: pairAmendment,
    referencedAccessionNumber: pairOriginal,
    status: "linked",
    reason: null,
    evidence: "xml_previous_accession_number",
  }]);
  const brvePosition = brve.lineage.positions[0]!;
  assert.equal(brvePosition.status, "available_stored_history");
  if (brvePosition.status !== "available_stored_history") throw new Error("BRVE current unresolved");
  assert.equal(brvePosition.rootAccessionNumber, pairOriginal);
  assert.equal(brvePosition.headAccessionNumber, pairAmendment);
  assert.equal(brvePosition.currentReporters.length, 3, "reporters remain separate");
  assert.deepEqual(brvePosition.currentReporters.map((reporter) => ({
    cik: reporter.reportingPersonCik,
    aggregate: reporter.values.aggregateAmountOwnedRaw.valueRaw,
    percent: reporter.values.percentOfClassRaw.valueRaw,
  })), [
    { cik: "0001055951", aggregate: "12175159.00", percent: "13.5" },
    { cik: "0001920574", aggregate: "11901826.00", percent: "13.2" },
    { cik: "0001808744", aggregate: "273333.00", percent: "0.3" },
  ]);

  const lode = await currentState.readSc13IssuerCurrentState("0001120970");
  const mtch = await currentState.readSc13IssuerCurrentState("0000891103");
  const msft = await currentState.readSc13IssuerCurrentState("0000789019");
  const aapl = await currentState.readSc13IssuerCurrentState("0000320193");
  for (const read of [lode, mtch, msft, aapl]) assert.equal(read.status, "available");
  if (lode.status !== "available" || mtch.status !== "available" || msft.status !== "available" || aapl.status !== "available") {
    throw new Error("four-case readback unavailable");
  }
  assert.equal(lode.lineage.positions[0]?.status, "available_stored_history");
  assert.equal(msft.lineage.positions[0]?.status, "unresolved");
  assert.ok(msft.lineage.positions[0]?.issues.some((issue) => issue.startsWith("reporter_identity_unverified:")));
  assert.equal(mtch.lineage.links[0]?.referencedAccessionNumber, "0000902664-24-004719");
  assert.equal(mtch.lineage.links[0]?.reason, "missing_predecessor");
  assert.equal(mtch.lineage.positions[0]?.status, "unresolved");
  assert.equal(aapl.lineage.links[0]?.reason, "previous_accession_missing");
  assert.equal(aapl.lineage.positions[0]?.status, "unresolved");

  const beforeReplay = await snapshot(admin, targetAccessions);
  const replayResults = await Promise.all(targetAccessions.flatMap((accession) => [0, 1].map(async () => {
    const result = await persistence.persistSc13CanonicalXmlForRawItem({
      rawItemId: rawIds.get(accession)!,
      rawItem: requiredRaw(rawItems, accession),
    });
    assert.equal(result.status, "available");
    assert.equal(result.writeStatus, "replayed");
    return { accession, writeStatus: result.writeStatus };
  })));
  const afterReplay = await snapshot(admin, targetAccessions);
  assert.deepEqual(afterReplay, beforeReplay, "concurrent replay changes zero canonical rows");
  assert.equal(afterReplay.filings.length, 6);
  assert.equal(afterReplay.reporters.length, 31);

  const storedHashes = Object.fromEntries(brve.history.map((item) => [
    item.filing.accession_number,
    item.filing.source_sha256,
  ]));
  assert.deepEqual(storedHashes, {
    [pairOriginal]: "940969568b8bfd7c045a5e5461eb76f3827b132965bef1f13eddb3dd310729ca",
    [pairAmendment]: "8d1227025945dd6681b5042aa927f5542b92fd1c10a9d93c234aa9bdb50a3515",
  });
  const issuerMismatch = await currentState.readSc13IssuerCurrentState("9999999999", {
    repository: {
      rpc: supabase.supabaseRpc,
      select: async (table, query) => table === "sec_sc13_filings" && query.select === "accession_number"
        ? { ok: true, status: 200, data: [{ accession_number: pairOriginal }], count: 1 }
        : supabase.supabaseSelect(table, query),
    },
  });
  assert.equal(issuerMismatch.status, "unavailable");
  assert.equal(issuerMismatch.status === "unavailable" && issuerMismatch.reason, "history_issuer_mismatch");
  assert.equal(networkLedger.some((entry) => !entry.allowed), false);

  output.ok = true;
  output.ingestOrder = [pairAmendment, pairOriginal, ...targetAccessions.filter((item) => ![pairOriginal, pairAmendment].includes(item))];
  output.actualSecPair = {
    issuerCik: "0002131524",
    headerFilerCik: "0001055951",
    original: {
      accession: pairOriginal,
      xmlUrl: pairCases[0]?.structural?.source?.url,
      indexUrl: pairCases[0]?.collection?.items?.[0]?.source_url,
      sha256: storedHashes[pairOriginal],
    },
    amendment: {
      accession: pairAmendment,
      previousAccession: pairOriginal,
      xmlUrl: pairCases[1]?.structural?.source?.url,
      indexUrl: pairCases[1]?.collection?.items?.[0]?.source_url,
      sha256: storedHashes[pairAmendment],
    },
    current: brvePosition,
  };
  output.fourCaseReadback = {
    LODE: summarizeRead(lode),
    MTCH: summarizeRead(mtch),
    MSFT: summarizeRead(msft),
    AAPL: summarizeRead(aapl),
  };
  output.replay = {
    calls: replayResults.length,
    insertedRows: 0,
    canonicalRowDelta: 0,
    finalFilings: afterReplay.filings.length,
    finalReporters: afterReplay.reporters.length,
  };
  output.network = { requests: networkLedger.length, externalRequests: 0, llmRequests: 0 };
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ ok: true, outputPath, ...output }, null, 2)}\n`);
} finally {
  await admin.end();
}

async function snapshot(admin: DbClient, accessions: string[]) {
  const filings = await admin.query(
    "select accession_number, source_sha256, payload_sha256, raw_item_id from public.sec_sc13_filings where accession_number = any($1::text[]) order by accession_number",
    [accessions],
  );
  const reporters = await admin.query(
    "select accession_number, reporting_person_index, reporting_person_cik, aggregate_amount_owned_raw, percent_of_class_raw from public.sec_sc13_reporting_persons where accession_number = any($1::text[]) order by accession_number, reporting_person_index",
    [accessions],
  );
  return { filings: filings.rows, reporters: reporters.rows };
}

function summarizeRead(read: Extract<Awaited<ReturnType<typeof currentState.readSc13IssuerCurrentState>>, { status: "available" }>) {
  return {
    historyCount: read.history.length,
    historyComplete: read.historyComplete,
    links: read.lineage.links,
    positions: read.lineage.positions.map((position) => ({
      status: position.status,
      rootAccessionNumber: position.rootAccessionNumber,
      headAccessionNumber: position.headAccessionNumber,
      issues: position.issues,
    })),
  };
}

function assertIsolatedTargets(db: URL, expectedPort: string, api: URL) {
  assert.ok(["127.0.0.1", "localhost"].includes(db.hostname));
  assert.equal(db.port, expectedPort);
  assert.equal(api.hostname, db.hostname);
  assert.equal(api.port, String(Number(expectedPort) - 1));
  for (const port of [db.port, api.port]) {
    assert.ok(!new Set(["56321", "56322", "58321", "58322", "58421", "58422"]).has(port));
  }
}

function requiredRaw(values: Map<string, Row>, accession: string) {
  const value = values.get(accession);
  if (!value || !value.source_unique_id) throw new Error(`missing raw item ${accession}`);
  return value;
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter((item): item is Row => Boolean(item && typeof item === "object" && !Array.isArray(item))) : [];
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
