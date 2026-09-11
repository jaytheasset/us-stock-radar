import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

const SOURCE_ARTIFACT_SHA256 = "48c46e453b9cd46e5d1a6640082dd399230a78b35e1e7b770feea9bd4f401e5e";
const sourceArtifactPath = process.env.SC13_E2E_SOURCE_ARTIFACT
  ?? "C:/Users/PC/AppData/Local/Temp/stockradar-sc13-b058cd-live-verification.json";
const outputPath = process.env.SC13_TICKER_E2E_OUTPUT
  ?? "C:/Users/PC/AppData/Local/Temp/stockradar-sc13-1b65-issuer-ticker-e2e.json";
const dbUrl = requiredEnv("SC13_ISOLATED_DB_URL");
const expectedDbPort = requiredEnv("SC13_ISOLATED_DB_PORT");
const apiUrl = requiredEnv("SUPABASE_URL");
const secretKey = requiredEnv("SUPABASE_SECRET_KEY");

assertIsolatedTargets(new URL(dbUrl), expectedDbPort, new URL(apiUrl));
process.env.SUPABASE_DB_URL = dbUrl;
delete process.env.FMP_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.GEMINI_API_KEY;

const expected = [
  { ticker: "LODE", accession: "0000921895-26-000805", requestCik: "1120970", issuerCik: "0001120970", filerCik: "0001426156", reporterCount: 3 },
  { ticker: "MTCH", accession: "0000902664-26-002298", requestCik: "1517137", issuerCik: "0000891103", filerCik: "0001517137", reporterCount: 20 },
  { ticker: "MSFT", accession: "0002100119-26-000820", requestCik: "789019", issuerCik: "0000789019", filerCik: "0002100119", reporterCount: 1 },
  { ticker: "AAPL", accession: "0000102909-26-000630", requestCik: "320193", issuerCik: "0000320193", filerCik: "0000102909", reporterCount: 1 },
] as const;
const compactAccessions = new Set(expected.map((item) => item.accession.replace(/-/g, "")));
const allowedArchiveCiks = new Set(expected.flatMap((item) => [normalizeCik(item.requestCik), normalizeCik(item.issuerCik), normalizeCik(item.filerCik)]));
const isolatedApiOrigin = new URL(apiUrl).origin;
const nativeFetch = globalThis.fetch.bind(globalThis);
const networkLedger: Array<{ method: string; origin: string; pathname: string; allowed: boolean }> = [];

globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
  const requestUrl = new URL(input instanceof Request ? input.url : input.toString());
  const archiveMatch = requestUrl.pathname.match(/^\/Archives\/edgar\/data\/(\d+)\/(\d{18})(?:\/|$)/i);
  const allowedSecRequest = requestUrl.origin === "https://www.sec.gov" && (
    requestUrl.pathname === "/files/company_tickers_exchange.json" ||
    Boolean(archiveMatch && allowedArchiveCiks.has(normalizeCik(archiveMatch[1]!)) && compactAccessions.has(archiveMatch[2]!))
  );
  const allowed = requestUrl.origin === isolatedApiOrigin || allowedSecRequest;
  networkLedger.push({
    method: init?.method ?? (input instanceof Request ? input.method : "GET"),
    origin: requestUrl.origin,
    pathname: requestUrl.pathname,
    allowed,
  });
  if (!allowed) throw new Error(`SC13 ticker E2E network guard blocked ${requestUrl.origin}${requestUrl.pathname}`);
  return nativeFetch(input, init);
};

const sourceArtifactText = await readFile(sourceArtifactPath, "utf8");
assert.equal(sha256(sourceArtifactText), SOURCE_ARTIFACT_SHA256, "source artifact SHA-256");
const sourceArtifact = JSON.parse(sourceArtifactText) as Row;
const capturedCases = rows(sourceArtifact.results);
assert.equal(capturedCases.length, 4);
const capturedByTicker = new Map(capturedCases.map((item) => [stringValue(item.ticker), item]));

const [collector, ingest, persistence, sc13Parser, analysisPrompt, routerPrompt] = await Promise.all([
  import("../lib/sources/sec/parser.ts"),
  import("../lib/secIngest.ts"),
  import("../lib/sec-sc13-xml/persistence.ts"),
  import("../lib/sources/sec/forms/sc13/parser.ts"),
  import("../lib/sources/sec/forms/sc13/analysisPrompt.ts"),
  import("../lib/sources/sec/forms/sc13/routerPrompt.ts"),
]);

const admin = new PgClient({ connectionString: dbUrl });
await admin.connect();
const output: Row = {
  ok: false,
  isolated: { databasePort: Number(expectedDbPort), apiOrigin: isolatedApiOrigin },
  sourceArtifact: { path: sourceArtifactPath, sha256: SOURCE_ARTIFACT_SHA256 },
  targets: [],
};

try {
  const accessions = expected.map((item) => item.accession);
  assert.equal((await admin.query(
    "select count(*)::integer as count from public.raw_items where source_unique_id = any($1::text[])",
    [accessions],
  )).rows[0]?.count, 0, "isolated database must start without target filings");

  const liveCollections = new Map<string, Row>();
  const protectedAnalysis: Row[] = [];
  for (const target of expected) {
    const captured = requiredCase(capturedByTicker, target.ticker);
    const capturedRaw = record(captured.rawItem);
    const capturedPayload = record(capturedRaw.raw_payload);
    const collection = await collector.fetchSecEdgarRawItems({
      accessionNumber: target.accession,
      cik: target.requestCik,
      includeDocuments: true,
    });
    assert.equal(collection.ok, true, `${target.ticker} live SEC collection: ${collection.error ?? ""}`);
    assert.equal(collection.items.length, 1, `${target.ticker} collector item count`);
    const liveRaw = collection.items[0]! as Row;
    const livePayload = record(liveRaw.raw_payload);
    assert.equal(livePayload.ticker, target.ticker, `${target.ticker} ticker resolved`);
    assert.equal(record(livePayload.ticker_resolution).source, "issuer_cik_sec");
    assert.equal(record(livePayload.ticker_resolution).confidence, "high");
    assert.equal(normalizeCik(livePayload.sc13_index_subject_cik), target.issuerCik);
    assert.equal(normalizeCik(record(captured.independentXml).issuer?.issuerCikRaw), target.issuerCik);
    assert.equal(normalizeCik(record(captured.independentXml).headerFilerCikRaw), target.filerCik);
    assert.ok(array(livePayload.sc13_index_filed_by_ciks).map(normalizeCik).includes(target.filerCik));
    assert.equal(livePayload.sc13_source_text, capturedPayload.sc13_source_text, `${target.ticker} exact canonical XML`);
    assertProtectedIdentityFields(liveRaw, capturedRaw, target.ticker);

    const tickerlessPayload = structuredClone(livePayload);
    tickerlessPayload.ticker = capturedPayload.ticker;
    tickerlessPayload.exchange = capturedPayload.exchange;
    tickerlessPayload.tickers = capturedPayload.tickers;
    tickerlessPayload.ticker_resolution = capturedPayload.ticker_resolution;
    const currentParsed = sc13Parser.parseSc13Filing({
      formType: stringValue(livePayload.form_type),
      accessionNumber: target.accession,
      sourceUrl: stringValue(liveRaw.source_url),
      text: stringValue(liveRaw.body_text),
      rawPayload: livePayload,
    });
    const capturedParsed = sc13Parser.parseSc13Filing({
      formType: stringValue(livePayload.form_type),
      accessionNumber: target.accession,
      sourceUrl: stringValue(liveRaw.source_url),
      text: stringValue(liveRaw.body_text),
      rawPayload: tickerlessPayload,
    });
    const currentAnalysisPrompt = analysisPrompt.buildSc13AnalysisPrompt(currentParsed);
    const capturedAnalysisPrompt = analysisPrompt.buildSc13AnalysisPrompt(capturedParsed);
    const currentRouterPrompt = routerPrompt.buildSc13RouterPrompt(currentParsed);
    const capturedRouterPrompt = routerPrompt.buildSc13RouterPrompt(capturedParsed);
    assert.equal(currentAnalysisPrompt, capturedAnalysisPrompt, `${target.ticker} analysis prompt unchanged`);
    assert.equal(currentRouterPrompt, capturedRouterPrompt, `${target.ticker} compatibility router prompt unchanged`);
    protectedAnalysis.push({
      ticker: target.ticker,
      comparisonBasis: "same current live collection; control differs only in ticker, exchange, tickers, and ticker_resolution",
      currentBodyChars: stringValue(liveRaw.body_text).length,
      historicalCapturedBodyChars: stringValue(capturedRaw.body_text).length,
      historicalCapturedBodyEqual: liveRaw.body_text === capturedRaw.body_text,
      analysisPromptSha256: sha256(currentAnalysisPrompt),
      routerPromptSha256: sha256(currentRouterPrompt),
      unchanged: true,
    });
    liveCollections.set(target.ticker, collection as unknown as Row);
  }

  const firstIngests: Row[] = [];
  for (const target of expected) {
    const result = await ingest.runSecRawIngest({
      accessionNumber: target.accession,
      cik: target.requestCik,
      includeDocuments: true,
      force: false,
    }) as Row;
    assert.equal(result.ok, true, `${target.ticker} product ingest`);
    assert.equal(record(result.stats).excluded_count, 0, `${target.ticker} existing gate passed`);
    assert.equal(record(result.stats).raw_upserted_count, 1, `${target.ticker} raw write`);
    assert.equal(record(result.stats).sc13_xml_available_count, 1, `${target.ticker} canonical write`);
    assert.equal(record(result.stats).sc13_xml_replayed_count, 0, `${target.ticker} first canonical insert`);
    firstIngests.push(result);
  }

  const readbacks: Row[] = [];
  for (const target of expected) {
    const captured = requiredCase(capturedByTicker, target.ticker);
    const capturedRaw = record(captured.rawItem);
    const storedRows = rows(await secretRest("raw_items", {
      select: "*",
      source_unique_id: `eq.${target.accession}`,
      limit: "1",
    }));
    assert.equal(storedRows.length, 1, `${target.ticker} stored raw row`);
    const storedRaw = storedRows[0]!;
    const storedPayload = record(storedRaw.raw_payload);
    assert.equal(storedPayload.ticker, target.ticker);
    assert.equal(record(storedPayload.ticker_resolution).source, "issuer_cik_sec");
    assertStoredMatchesCollection(storedRaw, record((liveCollections.get(target.ticker)?.items as unknown[])?.[0]), target.ticker);
    assertProtectedIdentityFields(storedRaw, capturedRaw, target.ticker);

    const readback = await persistence.readSc13FilingByAccession(target.accession);
    assert.equal(readback.status, "available", `${target.ticker} canonical readback`);
    if (readback.status !== "available") throw new Error(`${target.ticker} canonical readback unavailable`);
    assert.deepEqual(readback.structural.filing, record(captured.independentXml), `${target.ticker} exact structural fields`);
    assert.equal(readback.reporters.length, target.reporterCount, `${target.ticker} reporter count`);
    assert.equal(readback.filing.raw_xml, record(capturedRaw.raw_payload).sc13_source_text, `${target.ticker} exact raw XML readback`);
    assert.equal(normalizeCik(readback.filing.issuer_cik), target.issuerCik);
    assert.equal(normalizeCik(readback.filing.header_filer_cik), target.filerCik);
    readbacks.push({
      ticker: target.ticker,
      accession: target.accession,
      issuerCik: readback.filing.issuer_cik,
      headerFilerCik: readback.filing.header_filer_cik,
      reporterCount: readback.reporters.length,
      sourceSha256: readback.filing.source_sha256,
      exactStructuralFields: true,
    });
  }

  const replayResults: Row[] = [];
  for (const target of expected) {
    const result = await ingest.runSecRawIngest({
      accessionNumber: target.accession,
      cik: target.requestCik,
      includeDocuments: true,
      force: false,
    }) as Row;
    assert.equal(result.ok, true);
    assert.equal(record(result.stats).raw_upserted_count, 0);
    assert.equal(record(result.stats).skipped_count, 1);
    assert.equal(record(result.stats).sc13_xml_available_count, 1);
    assert.equal(record(result.stats).sc13_xml_replayed_count, 1);
    replayResults.push(result);
  }

  const lode = expected[0];
  const concurrent = await Promise.all([
    ingest.runSecRawIngest({ accessionNumber: lode.accession, cik: lode.requestCik, includeDocuments: true, force: false }),
    ingest.runSecRawIngest({ accessionNumber: lode.accession, cik: lode.requestCik, includeDocuments: true, force: false }),
  ]) as Row[];
  for (const result of concurrent) {
    assert.equal(result.ok, true);
    assert.equal(record(result.stats).skipped_count, 1);
    assert.equal(record(result.stats).sc13_xml_replayed_count, 1);
  }

  const counts = (await admin.query(`
    select
      (select count(*)::integer from public.raw_items where source_unique_id = any($1::text[])) as raw_items,
      (select count(*)::integer from public.sec_sc13_filings where accession_number = any($1::text[])) as filings,
      (select count(*)::integer from public.sec_sc13_reporting_persons where accession_number = any($1::text[])) as reporters
  `, [accessions])).rows[0]!;
  assert.deepEqual(counts, { raw_items: 4, filings: 4, reporters: 25 });
  assert.deepEqual(networkLedger.filter((entry) => !entry.allowed), [], "no unapproved network attempt");
  assert.equal(networkLedger.some((entry) => /openai|gemini|financialmodelingprep/i.test(entry.origin)), false, "zero LLM/FMP requests");

  output.ok = true;
  output.targets = readbacks;
  output.firstIngest = firstIngests.map((result, index) => ({ ticker: expected[index]!.ticker, stats: result.stats }));
  output.replay = {
    stats: replayResults.map((result, index) => ({ ticker: expected[index]!.ticker, stats: result.stats })),
    concurrentLodeReplayStatuses: concurrent.map((result) => record(result.stats).sc13_xml_replayed_count),
    rawDuplicates: 0,
    filingDuplicates: 0,
    reporterDuplicates: 0,
  };
  output.protectedAnalysis = protectedAnalysis;
  output.network = {
    totalRequests: networkLedger.length,
    secRequests: networkLedger.filter((entry) => entry.origin === "https://www.sec.gov").length,
    isolatedApiRequests: networkLedger.filter((entry) => entry.origin === isolatedApiOrigin).length,
    llmRequests: 0,
    fmpRequests: 0,
    blockedRequests: 0,
  };
  output.finalCounts = counts;
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ ok: true, outputPath, finalCounts: counts })}\n`);
} finally {
  await admin.end();
}

function assertProtectedIdentityFields(actual: Row, captured: Row, ticker: string) {
  const actualPayload = record(actual.raw_payload);
  const capturedPayload = record(captured.raw_payload);
  for (const key of [
    "form_type",
    "cik",
    "cik_padded",
    "filer_cik",
    "filer_cik_padded",
    "ownership_issuer_cik",
    "ownership_issuer_name",
    "ownership_issuer_trading_symbol",
    "company_name",
    "sc13_source_url",
    "sc13_source_format",
    "sc13_source_text",
    "sc13_source_text_char_count",
    "sc13_source_text_truncated",
    "sc13_source_capture_status",
    "sc13_index_subject_cik",
    "sc13_index_subject_cik_count",
    "sc13_index_filed_by_ciks",
    "sc13_index_canonical_xml_url",
  ]) {
    assert.deepEqual(actualPayload[key], capturedPayload[key], `${ticker} protected raw_payload.${key}`);
  }
}

function assertStoredMatchesCollection(stored: Row, collected: Row, ticker: string) {
  for (const key of ["title", "body_text", "analysis_text", "source_url"] as const) {
    assert.deepEqual(stored[key], collected[key], `${ticker} stored ${key}`);
  }
  assert.equal(Date.parse(String(stored.published_at)), Date.parse(String(collected.published_at)), `${ticker} stored published_at`);
  assert.deepEqual(stored.raw_payload, collected.raw_payload, `${ticker} stored raw payload`);
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

function requiredCase(byTicker: Map<string, Row>, ticker: string) {
  const value = byTicker.get(ticker);
  assert.ok(value, `${ticker} captured case`);
  return value;
}

function assertIsolatedTargets(database: URL, port: string, api: URL) {
  assert.equal(database.hostname, "127.0.0.1");
  assert.equal(database.port, port);
  assert.equal(api.hostname, "127.0.0.1");
  assert.notEqual(port, "5432");
  assert.notEqual(port, "56322");
  assert.notEqual(api.port, "56321");
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

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeCik(value: unknown) {
  const text = String(value ?? "").trim();
  return /^\d{1,10}$/.test(text) ? text.padStart(10, "0") : "";
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
