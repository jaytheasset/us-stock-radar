import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire, registerHooks } from "node:module";

const PgClient = (createRequire(import.meta.url)("pg") as { Client: new (options: { connectionString: string }) => any }).Client;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { shortCircuit: true, url: "data:text/javascript,export%20%7B%7D;" };
    if (specifier.startsWith("@/")) {
      const base = new URL(`../${specifier.slice(2)}`, import.meta.url);
      const file = new URL(`${base.href}.ts`);
      return nextResolve(file.href, context);
    }
    return nextResolve(specifier, context);
  },
});

const INPUT_SHA256 = "5b87fab65028745701c8d693ece5fe913d3cb6699b48aecdb32002e9dbc2f5a4";
const ORACLE_SHA256 = "0fbf6d496e6de029b5831aa7b490e85c2236feda67ca5ddd8efebda3ea1276a9";
const inputPath = process.env.SC13_PRODUCT_INPUT
  ?? "C:/Users/PC/AppData/Local/Temp/sc13-auto-shared-existing-sec-inputs.json";
const oraclePath = process.env.SC13_PRODUCT_ORACLE
  ?? "C:/Users/PC/AppData/Local/Temp/sc13-monitor-main-source-oracle.json";
const outputPath = process.env.SC13_PRODUCT_OUTPUT
  ?? "C:/Users/PC/AppData/Local/Temp/stockradar-sc13-product-candidate-verification.json";
const dbUrl = requiredEnv("SC13_ISOLATED_DB_URL");
const expectedDbPort = requiredEnv("SC13_ISOLATED_DB_PORT");
const apiUrl = requiredEnv("SUPABASE_URL").replace(/\/$/, "");

assertIsolatedTargets(new URL(dbUrl), expectedDbPort, new URL(apiUrl));
process.env.SUPABASE_DB_URL = dbUrl;
process.env.SEC_ANALYSIS_ALLOW_OPENAI = "false";
delete process.env.OPENAI_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.FMP_API_KEY;
process.env.ALERT_DELIVERY_SEND_TELEGRAM = "false";
process.env.ALERT_DELIVERY_SEND_TELEGRAM_PUBLIC = "false";
process.env.ALERT_DELIVERY_SEND_EMAIL = "false";

const isolatedOrigin = new URL(apiUrl).origin;
const nativeFetch = globalThis.fetch.bind(globalThis);
const networkLedger: Array<{ allowed: boolean; method: string; origin: string; pathname: string }> = [];
globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
  const request = input instanceof Request ? input : new Request(input, init);
  const url = new URL(request.url);
  const allowed = url.origin === isolatedOrigin || url.origin === "https://data.sec.gov";
  networkLedger.push({ allowed, method: request.method, origin: url.origin, pathname: url.pathname });
  if (!allowed) throw new Error(`isolated product verification blocked ${url.origin}`);
  return nativeFetch(request);
};

const [inputText, oracleText] = await Promise.all([
  readFile(inputPath, "utf8"),
  readFile(oraclePath, "utf8"),
]);
assert.equal(sha256(inputText), INPUT_SHA256, "frozen six-filing input manifest");
assert.equal(sha256(oracleText), ORACLE_SHA256, "frozen source oracle manifest");
const inputs = rows(JSON.parse(inputText));
const oracle = rows(JSON.parse(oracleText));
assert.equal(inputs.length, 6);
assert.equal(oracle.length, 6);

const targets = inputs.map((item) => {
  const raw = record(item.raw);
  const payload = record(raw.raw_payload);
  const ticker = stringValue(record(raw.metadata).ticker || payload.ticker).toUpperCase();
  const issuerCik = normalizeCik(payload.sc13_index_subject_cik);
  const accession = stringValue(raw.source_unique_id);
  assert.match(ticker, /^[A-Z0-9][A-Z0-9.-]{0,11}$/);
  assert.match(accession, /^\d{10}-\d{2}-\d{6}$/);
  return { accession, issuerCik, raw, sourceSha256: stringValue(item.source_sha256), ticker };
});
assert.deepEqual([...new Set(targets.map((target) => target.ticker))].sort(), ["AAPL", "BRVE", "LODE", "MSFT", "MTCH"]);
assert.deepEqual([...new Set(targets.map((target) => target.issuerCik))].sort(), [
  "0000320193", "0000789019", "0000891103", "0001120970", "0002131524",
]);

const [rawStore, persistence, structuredHttp, normalization, structuredRepository, product] = await Promise.all([
  import("../lib/secStores/rawStore.ts"),
  import("../lib/sec-sc13-xml/persistence.ts"),
  import("../lib/sec-structured-data/httpClient.ts"),
  import("../lib/sec-structured-data/normalization.ts"),
  import("../lib/sec-structured-data/repository.ts"),
  import("../lib/watchlist/stockSc13OwnershipServer.ts"),
]);

const db = new PgClient({ connectionString: dbUrl });
await db.connect();
const output: Record<string, unknown> = {
  ok: false,
  manifests: {
    input: { path: inputPath, sha256: INPUT_SHA256 },
    oracle: { path: oraclePath, sha256: ORACLE_SHA256 },
  },
  isolated: { apiOrigin: isolatedOrigin, databasePort: Number(expectedDbPort) },
};

try {
  const empty = await db.query(`select
    (select count(*)::integer from public.raw_items) as raw_items,
    (select count(*)::integer from public.sec_sc13_filings) as sc13_filings,
    (select count(*)::integer from public.sec_issuer_ticker_observations) as ticker_observations`);
  assert.deepEqual(empty.rows[0], { raw_items: 0, sc13_filings: 0, ticker_observations: 0 });

  const structuredClient = new structuredHttp.SecStructuredHttpClient(
    "StockRadar-Candidate-Verification/1.0 contact: devnull@example.com",
  );
  const repository = new structuredRepository.PostgresSecStructuredRepository(db);
  const catalogEvidence: Record<string, unknown>[] = [];
  for (const issuerCik of [...new Set(targets.map((target) => target.issuerCik))]) {
    const documents = await structuredClient.fetchSubmissions(issuerCik, "incremental");
    const batch = normalization.normalizeSecStructuredDocuments(documents);
    assert.deepEqual(batch.rejections, [], `${issuerCik} official submissions normalization`);
    const issuerTargets = targets.filter((target) => target.issuerCik === issuerCik);
    for (const target of issuerTargets) {
      assert.ok(
        batch.tickerObservations.some((row) => row.issuerCik === issuerCik && row.ticker === target.ticker),
        `${target.ticker} official SEC ticker observation`,
      );
    }
    const identityBatch = {
      ...batch,
      facts: [],
      filings: [],
    };
    const counts = await repository.ingestBatch(identityBatch);
    catalogEvidence.push({
      cik: issuerCik,
      sourceUrl: documents[0]?.sourceUrl,
      sourceHash: batch.rawSources[0]?.contentHash,
      tickerObservations: batch.tickerObservations.map((row) => ({ exchange: row.exchange, ticker: row.ticker })),
      writes: counts,
    });
  }

  await rawStore.ensureSecSource();
  const runId = randomUUID();
  await rawStore.createSecSourceRun({
    force: false,
    includeDocuments: true,
    metadata: { external_fmp_calls: 0, external_llm_calls: 0, isolated_stock_sc13_product_verification: true },
    requestedFormTypes: ["SCHEDULE 13D", "SCHEDULE 13D/A", "SCHEDULE 13G", "SCHEDULE 13G/A"],
    requestedLimit: 6,
    runId,
    startedAt: new Date().toISOString(),
  });

  for (const target of targets) {
    const saved = await rawStore.saveSecRawItem(target.raw as never, runId);
    const persisted = await persistence.persistSc13CanonicalXmlForRawItem({
      rawItem: target.raw,
      rawItemId: String(saved.id),
    });
    assert.equal(persisted.status, "available", target.accession);
    assert.equal(persisted.sourceSha256, target.sourceSha256, target.accession);
  }

  const snapshots = new Map<string, any>();
  for (const ticker of ["LODE", "MTCH", "MSFT", "AAPL", "BRVE"]) {
    const snapshot = await product.fetchStockSc13Ownership(ticker);
    assert.equal(snapshot.status, "available", ticker);
    assert.equal(snapshot.symbol, ticker);
    assert.equal(snapshot.gptDependency, false);
    assert.equal(snapshot.scope, "complete_stored_history_not_sec_global");
    snapshots.set(ticker, snapshot);
  }

  const lode = snapshots.get("LODE");
  assert.equal(lode.positions[0].status, "available_stored_history");
  assert.equal(lode.positions[0].currentReporters.length, 3);
  assert.equal(lode.positions[0].currentReporters[0].aggregateAmountOwned.valueRaw, "5763729.00");
  assert.equal(lode.positions[0].currentReporters[0].percentOfClass.valueRaw, "8.1");

  const mtch = snapshots.get("MTCH");
  assert.equal(mtch.positions[0].status, "unresolved");
  assert.ok(mtch.positions[0].issueCodes.some((issue: string) => issue.includes("missing_predecessor")));
  assert.equal(mtch.positions[0].currentReporters.length, 0);
  assert.equal(mtch.positions[0].history[0].reporters.length, 20);

  const msft = snapshots.get("MSFT");
  assert.equal(msft.positions[0].status, "unresolved");
  assert.equal(msft.positions[0].history[0].reporters[0].reportingPersonCik, null);
  assert.equal(msft.positions[0].history[0].reporters[0].aggregateAmountOwnedRaw, "555988240");

  const aapl = snapshots.get("AAPL");
  assert.equal(aapl.positions[0].status, "unresolved");
  assert.equal(aapl.positions[0].history[0].reporters[0].aggregateAmountOwnedRaw, "0");
  assert.equal(aapl.positions[0].history[0].reporters[0].percentOfClassRaw, "0");

  const brve = snapshots.get("BRVE");
  assert.equal(brve.positions[0].status, "available_stored_history");
  assert.equal(brve.positions[0].history.length, 2);
  assert.equal(brve.positions[0].currentReporters.length, 3);
  assert.equal(brve.positions[0].currentReporters[0].aggregateAmountOwned.valueRaw, "12175159.00");
  assert.equal(brve.positions[0].currentReporters[0].percentOfClass.valueRaw, "13.5");

  for (const expected of oracle) {
    const snapshot = snapshots.get(stringValue(expected.ticker));
    assert.equal(snapshot.issuerCik, normalizeCik(expected.issuerCik));
    const filing = snapshot.positions.flatMap((position: any) => position.history)
      .find((history: any) => history.accessionNumber === stringValue(expected.accession));
    assert.ok(filing, `${expected.ticker} oracle accession`);
    assert.deepEqual(filing.reporters.map((reporter: any) => ({
      cik: reporter.reportingPersonCik,
      name: reporter.reportingPersonName,
      values: {
        aggregateAmountOwnedRaw: reporter.aggregateAmountOwnedRaw,
        percentOfClassRaw: reporter.percentOfClassRaw,
      },
    })), rows(expected.reporters).map((reporter) => ({
      cik: nullableString(reporter.cik),
      name: stringValue(reporter.name),
      values: {
        aggregateAmountOwnedRaw: nullableString(record(reporter.values).aggregateAmountOwnedRaw),
        percentOfClassRaw: nullableString(record(reporter.values).percentOfClassRaw),
      },
    })));
  }

  const counts = await db.query(`select
    (select count(*)::integer from public.raw_items where source_unique_id = any($1::text[])) as raw_items,
    (select count(*)::integer from public.sec_sc13_filings) as sc13_filings,
    (select count(*)::integer from public.sec_sc13_reporting_persons) as sc13_reporters,
    (select count(*)::integer from public.sec_issuer_ticker_observations where ticker = any($2::text[])) as target_ticker_observations`,
    [targets.map((target) => target.accession), [...new Set(targets.map((target) => target.ticker))]],
  );
  assert.deepEqual(counts.rows[0], {
    raw_items: 6,
    sc13_filings: 6,
    sc13_reporters: 31,
    target_ticker_observations: 5,
  });
  assert.equal(networkLedger.some((entry) => !entry.allowed), false);
  assert.equal(networkLedger.some((entry) => /openai|gemini|financialmodelingprep/i.test(entry.origin)), false);

  output.ok = true;
  output.catalogEvidence = catalogEvidence;
  output.counts = counts.rows[0];
  output.network = {
    blockedRequests: 0,
    fmpRequests: 0,
    llmRequests: 0,
    secSubmissionsRequests: networkLedger.filter((entry) => entry.origin === "https://data.sec.gov").length,
  };
  output.snapshots = Object.fromEntries([...snapshots].map(([ticker, snapshot]) => [ticker, summarize(snapshot)]));
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ ok: true, outputPath, counts: counts.rows[0], network: output.network })}\n`);
} finally {
  await db.end();
}

function summarize(snapshot: any) {
  return {
    issuerCik: snapshot.issuerCik,
    positions: snapshot.positions.map((position: any) => ({
      cusips: position.cusips,
      currentReporters: position.currentReporters,
      history: position.history.map((filing: any) => ({
        accessionNumber: filing.accessionNumber,
        eventDate: filing.eventDate,
        filedAt: filing.filedAt,
        formType: filing.formType,
        reporters: filing.reporters,
        sourceUrl: filing.sourceUrl,
      })),
      issueCodes: position.issueCodes,
      securityClass: position.securityClass,
      status: position.status,
    })),
    status: snapshot.status,
  };
}

function assertIsolatedTargets(db: URL, expectedPort: string, api: URL) {
  assert.ok(["127.0.0.1", "localhost"].includes(db.hostname));
  assert.equal(db.port, expectedPort);
  assert.equal(api.hostname, db.hostname);
  assert.equal(api.port, String(Number(expectedPort) - 1));
  for (const port of [db.port, api.port]) {
    assert.ok(!new Set(["56321", "56322", "58321", "58322", "58421", "58422", "58521", "58522", "58621", "58622", "58721", "58722"]).has(port));
  }
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function normalizeCik(value: unknown) {
  const text = stringValue(value);
  assert.match(text, /^\d{1,10}$/);
  return text.padStart(10, "0");
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function rows(value: unknown): Record<string, any>[] {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object" && !Array.isArray(item)) : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function nullableString(value: unknown) {
  const text = stringValue(value);
  return text || null;
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
