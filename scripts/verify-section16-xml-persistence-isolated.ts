import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
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

const CASES = [
  {
    formType: "3/A",
    accession: "0000891839-26-000252",
    fileName: "form3a.xml",
    attachmentSha256: "3bf16db8bcd2e49c054f816f892ebc02e26ee2a9dff547e28fede8b6434b2a1b",
    xmlSha256: "c3a49335c43da225011bd63cacbd1001efd5558e93ece1e06135df6044778ba9",
    issuerCik: "0001854445",
    sourceUrl: "https://www.sec.gov/Archives/edgar/data/1854445/000089183926000252/form3a.xml",
    expectedTransactions: 0,
    expectedHoldings: 2,
  },
  {
    formType: "5",
    accession: "0000036146-26-000004",
    fileName: "form5.xml",
    attachmentSha256: "0cc39dafc8c6126b18e556bf6fa8d9c9afd958ff7f39b3fe260306da613fbf42",
    xmlSha256: "f6e0c48d21865da3886c1739758c3085121f76bce93c90cd6f8f710d4906ee91",
    issuerCik: "0000036146",
    sourceUrl: "https://www.sec.gov/Archives/edgar/data/36146/000003614626000004/form5.xml",
    expectedTransactions: 6,
    expectedHoldings: 0,
  },
  {
    formType: "5/A",
    accession: "0000094049-26-000015",
    fileName: "form5a.xml",
    attachmentSha256: "3826c3cee0c1b0415514d53e84ab2f43386a37bdc144ed2dda00e52f67d7576f",
    xmlSha256: "3bf89e5b0054575ebcd2abb18adce9b2f539b8a095b12ae3bde373635fc64a50",
    issuerCik: "0000094049",
    sourceUrl: "https://www.sec.gov/Archives/edgar/data/94049/000009404926000015/form5a.xml",
    expectedTransactions: 5,
    expectedHoldings: 7,
  },
] as const;

const dbUrl = requiredEnv("SECTION16_ISOLATED_DB_URL");
const expectedDbPort = requiredEnv("SECTION16_ISOLATED_DB_PORT");
const apiUrl = requiredEnv("SUPABASE_URL");
const secretKey = requiredEnv("SUPABASE_SECRET_KEY");
const publishableKey = requiredEnv("SUPABASE_PUBLISHABLE_KEY");
assertIsolatedTargets(new URL(dbUrl), expectedDbPort, new URL(apiUrl));

const isolatedOrigin = new URL(apiUrl).origin;
const networkLedger: Array<{ method: string; origin: string; pathname: string; allowed: boolean }> = [];
const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
  const requestUrl = new URL(input instanceof Request ? input.url : input.toString());
  const allowed = requestUrl.origin === isolatedOrigin;
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
delete process.env.OPENAI_API_KEY;
delete process.env.GEMINI_API_KEY;
process.env.ALERT_DELIVERY_SEND_TELEGRAM = "false";
process.env.ALERT_DELIVERY_SEND_TELEGRAM_PUBLIC = "false";
process.env.ALERT_DELIVERY_SEND_EMAIL = "false";

const [rawStore, persistence, canonical, parser, { runSecRawIngest }] = await Promise.all([
  import("../lib/secStores/rawStore.ts"),
  import("../lib/sec-section16-xml/persistence.ts"),
  import("../lib/sec-section16-xml/canonical.ts"),
  import("../lib/sources/sec/forms/section16Xml/parser.ts"),
  import("../lib/secIngest.ts"),
]);

const desktop = process.env.USERPROFILE
  ? path.join(process.env.USERPROFILE, "Desktop")
  : requiredEnv("SECTION16_SOURCE_DIRECTORY");
const outputPath = process.env.SECTION16_E2E_OUTPUT
  ?? path.join(requiredEnv("TEMP"), "stockradar-section16-37dc-e2e.json");
const admin = new PgClient({ connectionString: dbUrl });
await admin.connect();

const output: Row = {
  ok: false,
  isolated: {
    databaseHost: new URL(dbUrl).hostname,
    databasePort: Number(expectedDbPort),
    apiOrigin: isolatedOrigin,
    projectId: "stock-radar-section16-37dc-20260912",
    sharedPortsRejected: [56321, 56322],
  },
  sourceFiles: [],
};

try {
  const target = await admin.query(`
    select current_database() as database_name, current_user as database_user,
      current_setting('server_version') as server_version,
      to_regclass('public.sec_section16_filings')::text as canonical_table
  `);
  assert.deepEqual(target.rows[0]?.database_name, "postgres");
  assert.equal(target.rows[0]?.canonical_table, "sec_section16_filings");
  output.databaseEvidence = target.rows[0];

  const accessions = CASES.map((item) => item.accession);
  assert.equal(await countByAccessions(admin, "raw_items", "source_unique_id", accessions), 0);
  assert.equal(await countByAccessions(admin, "sec_section16_filings", "accession_number", accessions), 0);
  const monitorCountBefore = Number((await admin.query("select count(*)::integer as count from public.listing_monitors")).rows[0]?.count);

  const sourceCases: Row[] = [];
  for (const fixture of CASES) {
    const attachmentPath = path.join(desktop, `${fixture.accession}.txt`);
    const attachmentBytes = await readFile(attachmentPath);
    assert.equal(sha256(attachmentBytes), fixture.attachmentSha256, `${fixture.accession} exact Desktop source file`);
    const extracted = extractOfficialXml(attachmentBytes, fixture.formType, fixture.accession, fixture.fileName);
    assert.equal(sha256(extracted.bytes), fixture.xmlSha256, `${fixture.accession} exact XML bytes`);
    const sourceText = extracted.text;
    const filingDate = secDate(extracted.completeSubmission, "FILED AS OF DATE");
    const acceptedAt = secAcceptedAt(extracted.completeSubmission);
    const issuerCik = xmlValue(sourceText, "issuerCik").padStart(10, "0");
    assert.equal(issuerCik, fixture.issuerCik);
    const ticker = xmlValue(sourceText, "issuerTradingSymbol");
    const issuerName = xmlValue(sourceText, "issuerName");
    const preserved = parser.preserveSection16XmlSource({
      formType: fixture.formType,
      sourceUrl: fixture.sourceUrl,
      text: sourceText,
      sha256: fixture.xmlSha256,
    });
    const rawItem = {
      source_code: "sec_edgar",
      source_group: "filings",
      source_unique_id: fixture.accession,
      source_url: fixture.sourceUrl.replace(/\/[^/]+$/, `/${fixture.accession}-index.html`),
      title: `SEC Form ${fixture.formType} ${issuerName}`,
      published_at: acceptedAt,
      fetched_at: new Date().toISOString(),
      body_text: sourceText,
      analysis_text: sourceText,
      dedupe_key: `sec_edgar:${fixture.accession}`,
      metadata: {},
      raw_payload: {
        form_type: fixture.formType,
        accession_number: fixture.accession,
        cik: issuerCik,
        ownership_issuer_cik: issuerCik,
        ownership_issuer_name: issuerName,
        ownership_issuer_trading_symbol: ticker,
        company_name: issuerName,
        ticker,
        exchange: "NYSE",
        ticker_resolution: { source: "issuer_trading_symbol_and_cik_sec", confidence: "high" },
        tickers: [{ ticker, exchange: "NYSE" }],
        filing_date: filingDate,
        accepted_at: acceptedAt,
        ...preserved,
      },
    };
    const parsed = parser.parseSection16XmlFiling(rawItem);
    assert.equal(parsed.source.canonicalXml, sourceText);
    assert.equal(parsed.source.sha256, fixture.xmlSha256);
    assert.equal(parsed.transactions.length, fixture.expectedTransactions);
    assert.equal(parsed.holdings.length, fixture.expectedHoldings);
    sourceCases.push({ fixture, attachmentPath, extracted, rawItem, parsed });
    output.sourceFiles.push({
      accession: fixture.accession,
      path: attachmentPath,
      attachmentSha256: fixture.attachmentSha256,
      xmlSha256: fixture.xmlSha256,
      extractionStartByte: extracted.startByte,
      xmlByteLength: extracted.bytes.length,
      formType: fixture.formType,
    });
  }

  const seedRunId = randomUUID();
  await rawStore.ensureSecSource();
  assert.equal(await rawStore.createSecSourceRun({
    force: false,
    includeDocuments: true,
    requestedFormTypes: [CASES[0].formType],
    requestedAccessionNumber: CASES[0].accession,
    runId: seedRunId,
    startedAt: new Date().toISOString(),
  }), "running");
  const firstRawItem = sourceCases[0]!.rawItem;
  const firstSaved = await rawStore.saveSecRawItem(firstRawItem, seedRunId);
  const firstRawItemId = stringValue(firstSaved.id);
  assert.ok(firstRawItemId);
  const concurrentFirstWrites = await Promise.all([
    persistence.persistSection16CanonicalXmlForRawItem({ rawItemId: firstRawItemId, rawItem: firstRawItem }),
    persistence.persistSection16CanonicalXmlForRawItem({ rawItemId: firstRawItemId, rawItem: firstRawItem }),
  ]);
  assert.deepEqual(concurrentFirstWrites.map((item) => item.writeStatus).sort(), ["inserted", "replayed"]);
  assert.equal(await countByAccessions(admin, "sec_section16_filings", "accession_number", [CASES[0].accession]), 1);

  const ingestResult = await runSecRawIngest(
    { formTypes: CASES.map((item) => item.formType), includeDocuments: true, force: false },
    {
      fetchRawItems: async () => ({
        ok: true as const,
        status: 200,
        items: sourceCases.map((item) => structuredClone(item.rawItem)),
        diagnostics: { documentsRequested: 3, documentsFetched: 3, documentsFailed: 0 },
      }) as never,
    },
  );
  assert.equal(ingestResult.ok, true, "product raw ingest remains successful");
  const ingestStats = ingestResult.stats;
  assert.ok(ingestStats);
  assert.equal(ingestStats.raw_upserted_count, 2);
  assert.equal(ingestStats.skipped_count, 1);
  assert.equal(ingestStats.section16_xml_available_count, 3);
  assert.equal(ingestStats.section16_xml_replayed_count, 1);
  assert.equal(ingestStats.section16_xml_failed_count, 0);
  assert.equal(ingestStats.sc13_xml_available_count, 0);

  const readbacks: Row[] = [];
  for (const sourceCase of sourceCases) {
    const fixture = sourceCase.fixture as typeof CASES[number];
    const readback = await persistence.readSection16FilingByAccession(fixture.accession);
    assert.equal(readback.status, "available", `${fixture.accession} product reader`);
    if (readback.status !== "available") throw new Error(`${fixture.accession} readback unavailable`);
    assert.deepEqual(readback.parsed, sourceCase.parsed, `${fixture.accession} exact parser output`);
    assert.equal(readback.filing.raw_xml, sourceCase.extracted.text, `${fixture.accession} exact raw XML`);
    assert.equal(readback.transactions.length, fixture.expectedTransactions);
    assert.equal(readback.holdings.length, fixture.expectedHoldings);
    assert.deepEqual(readback.transactions.map((row: Row) => row.structural_payload), sourceCase.parsed.transactions);
    assert.deepEqual(readback.holdings.map((row: Row) => row.structural_payload), sourceCase.parsed.holdings);
    assert.deepEqual(readback.footnotes.map((row: Row) => row.structural_payload), sourceCase.parsed.footnotes);
    assert.deepEqual(readback.reportingOwners.map((row: Row) => row.structural_payload), sourceCase.parsed.reportingOwners);
    const history = await persistence.readSection16FilingHistoryByIssuer(fixture.issuerCik);
    assert.equal(history.status, "available", `${fixture.accession} issuer history`);
    if (history.status === "available") {
      assert.ok(history.filings.some((item) => item.filing.accession_number === fixture.accession));
    }
    readbacks.push({
      accession: fixture.accession,
      formType: readback.parsed.formType,
      reportingOwners: readback.reportingOwners.length,
      transactions: readback.transactions.length,
      holdings: readback.holdings.length,
      footnotes: readback.footnotes.length,
      signatures: readback.signatures.length,
      sourceSha256: readback.filing.source_sha256,
      exactReadback: true,
    });
  }
  const form3Readback = readbacks.find((item) => item.formType === "3/A");
  assert.deepEqual({ transactions: form3Readback?.transactions, holdings: form3Readback?.holdings }, { transactions: 0, holdings: 2 });
  const form5Readback = await persistence.readSection16FilingByAccession(CASES[1].accession);
  assert.equal(form5Readback.status, "available");
  if (form5Readback.status === "available") {
    assert.equal(form5Readback.filing.filing_date_raw, "2026-02-13");
    assert.equal(form5Readback.transactions[0]?.transaction_date_raw, "2025-04-29");
  }

  const syntheticTotalValues = await verifySyntheticTotalValueRoundtrip({
    baseCase: sourceCases[2]!,
    runId: seedRunId,
    rawStore,
    persistence,
  });

  const snapshotBeforeReplay = await canonicalSnapshot(admin, accessions);
  const replayResults = await Promise.all(sourceCases.flatMap((sourceCase) => {
    const rawItemId = snapshotBeforeReplay.filings.find(
      (row: Row) => row.accession_number === sourceCase.fixture.accession,
    )?.raw_item_id;
    return [
      persistence.persistSection16CanonicalXmlForRawItem({ rawItemId, rawItem: sourceCase.rawItem }),
      persistence.persistSection16CanonicalXmlForRawItem({ rawItemId, rawItem: sourceCase.rawItem }),
    ];
  }));
  assert.ok(replayResults.every((item) => item.writeStatus === "replayed"));
  assert.deepEqual(await canonicalSnapshot(admin, accessions), snapshotBeforeReplay, "parallel replay changes zero rows");

  const wrongCaller = structuredClone(sourceCases[0]!.rawItem);
  wrongCaller.raw_payload.ownership_source_text = wrongCaller.raw_payload.ownership_source_text.replace("Glimpse", "Flimpse");
  const firstFiling = snapshotBeforeReplay.filings.find((row: Row) => row.accession_number === CASES[0].accession)!;
  await assert.rejects(
    persistence.persistSection16CanonicalXmlForRawItem({ rawItemId: firstFiling.raw_item_id, rawItem: wrongCaller }),
    (error) => error instanceof canonical.Section16CanonicalSourceError && error.code === "stored_source_mismatch",
  );
  assert.deepEqual(await canonicalSnapshot(admin, accessions), snapshotBeforeReplay, "source mismatch changes zero rows");

  const storedRaw = rows(await secretRest("raw_items", {
    select: "*", id: `eq.${firstFiling.raw_item_id}`, limit: "1",
  }))[0]!;
  const conflictingPayload = canonical.buildSection16CanonicalPayload(firstFiling.raw_item_id, storedRaw)!;
  conflictingPayload.filing.raw_xml = String(conflictingPayload.filing.raw_xml).replace("Glimpse", "Flimpse");
  const directConflict = await secretRpc("persist_sec_section16_filing", {
    p_raw_item_id: firstFiling.raw_item_id,
    p_filing: conflictingPayload.filing,
    p_reporting_owners: conflictingPayload.reportingOwners,
    p_transactions: conflictingPayload.transactions,
    p_holdings: conflictingPayload.holdings,
    p_footnotes: conflictingPayload.footnotes,
    p_signatures: conflictingPayload.signatures,
  }, false);
  assert.equal(directConflict.ok, false, "DB rejects a different source for the same accession");
  assert.deepEqual(await canonicalSnapshot(admin, accessions), snapshotBeforeReplay);

  const form5Shares = snapshotBeforeReplay.transactions.find((row: Row) => row.accession_number === CASES[1].accession)?.shares_raw;
  await admin.query(
    "update public.sec_section16_transactions set shares_raw = '999999999' where accession_number = $1 and row_ordinal = 0",
    [CASES[1].accession],
  );
  assert.deepEqual(
    await persistence.readSection16FilingByAccession(CASES[1].accession),
    { status: "unavailable", reason: "transaction_columns_mismatch" },
  );
  await admin.query(
    "update public.sec_section16_transactions set shares_raw = $2 where accession_number = $1 and row_ordinal = 0",
    [CASES[1].accession, form5Shares],
  );

  await admin.query(
    "revoke execute on function public.persist_sec_section16_filing(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) from service_role",
  );
  const failureIsolation = await runSecRawIngest(
    { accessionNumber: CASES[0].accession, includeDocuments: true, force: false },
    {
      fetchRawItems: async () => ({
        ok: true as const,
        status: 200,
        items: [structuredClone(sourceCases[0]!.rawItem)],
        diagnostics: { documentsRequested: 1, documentsFetched: 1, documentsFailed: 0 },
      }) as never,
    },
  );
  assert.equal(failureIsolation.ok, true, "canonical storage failure does not fail raw ingest");
  const failureStats = failureIsolation.stats;
  assert.ok(failureStats);
  assert.equal(failureStats.section16_xml_failed_count, 1);
  assert.equal(failureStats.raw_upserted_count, 0);
  assert.deepEqual(await canonicalSnapshot(admin, accessions), snapshotBeforeReplay);
  await admin.query(
    "grant execute on function public.persist_sec_section16_filing(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb) to service_role",
  );
  const recovery = await persistence.persistSection16CanonicalXmlForRawItem({
    rawItemId: firstFiling.raw_item_id,
    rawItem: sourceCases[0]!.rawItem,
  });
  assert.equal(recovery.writeStatus, "replayed");
  await persistence.recordSection16CanonicalPersistenceState({ rawItemId: firstFiling.raw_item_id, state: recovery });

  const privilege = await admin.query(`
    select
      has_table_privilege('anon', 'public.sec_section16_filings', 'select') as anon_select,
      has_table_privilege('authenticated', 'public.sec_section16_filings', 'select') as authenticated_select,
      has_table_privilege('service_role', 'public.sec_section16_filings', 'select') as service_select,
      has_table_privilege('service_role', 'public.sec_section16_filings', 'insert') as service_insert,
      has_table_privilege('service_role', 'public.sec_section16_filings', 'update') as service_update,
      has_function_privilege('anon', 'public.persist_sec_section16_filing(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)', 'execute') as anon_rpc,
      has_function_privilege('service_role', 'public.persist_sec_section16_filing(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)', 'execute') as service_rpc
  `);
  assert.deepEqual(privilege.rows[0], {
    anon_select: false,
    authenticated_select: false,
    service_select: true,
    service_insert: true,
    service_update: false,
    anon_rpc: false,
    service_rpc: true,
  });
  const anonymousRead = await fetch(`${apiUrl}/rest/v1/sec_section16_filings?select=accession_number&limit=1`, {
    headers: { apikey: publishableKey },
  });
  assert.equal(anonymousRead.ok, false);
  const anonymousWrite = await fetch(`${apiUrl}/rest/v1/sec_section16_filings`, {
    method: "POST",
    headers: { apikey: publishableKey, "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(anonymousWrite.ok, false);

  const monitorCountAfter = Number((await admin.query("select count(*)::integer as count from public.listing_monitors")).rows[0]?.count);
  assert.equal(monitorCountAfter, monitorCountBefore, "Section 16 persistence creates no Monitor");
  assert.equal(await countByAccessions(admin, "events", "metadata->>'accession_number'", accessions), 0);
  assert.equal(networkLedger.some((entry) => !entry.allowed), false, "no external network or LLM call");

  const finalSnapshot = await canonicalSnapshot(admin, accessions);
  output.ok = true;
  output.productIngest = {
    rawUpserted: ingestStats.raw_upserted_count,
    preexistingRaw: ingestStats.skipped_count,
    canonicalAvailable: ingestStats.section16_xml_available_count,
    canonicalReplayed: ingestStats.section16_xml_replayed_count,
    canonicalFailed: ingestStats.section16_xml_failed_count,
    llmCalls: 0,
  };
  output.concurrency = { firstWriteStatuses: concurrentFirstWrites.map((item) => item.writeStatus), duplicates: 0 };
  output.replay = { statuses: replayResults.map((item) => item.writeStatus), changedRows: 0, duplicates: 0 };
  output.failClosed = {
    callerSourceMismatchWrites: 0,
    databaseSourceMismatchWrites: 0,
    corruptedReaderStatus: "unavailable",
    storageFailureRawIngestOk: failureIsolation.ok,
    recoveryStatus: recovery.writeStatus,
  };
  output.permissions = { ...privilege.rows[0], anonymousReadStatus: anonymousRead.status, anonymousWriteStatus: anonymousWrite.status };
  output.noAutomaticMonitorWrites = monitorCountAfter - monitorCountBefore;
  output.syntheticTransactionTotalValue = syntheticTotalValues;
  output.network = { externalRequests: 0, isolatedApiRequests: networkLedger.length };
  output.readbacks = readbacks;
  output.finalCounts = {
    rawItems: await countByAccessions(admin, "raw_items", "source_unique_id", accessions),
    filings: finalSnapshot.filings.length,
    reportingOwners: finalSnapshot.reportingOwners.length,
    transactions: finalSnapshot.transactions.length,
    holdings: finalSnapshot.holdings.length,
    footnotes: finalSnapshot.footnotes.length,
    signatures: finalSnapshot.signatures.length,
  };
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ ok: true, outputPath, finalCounts: output.finalCounts })}\n`);
} finally {
  await admin.end();
}

function extractOfficialXml(bytes: Buffer, formType: string, accession: string, fileName: string) {
  const completeSubmission = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  assert.equal(completeSubmission.match(/ACCESSION NUMBER:\s*([^\s]+)/)?.[1], accession);
  assert.equal(completeSubmission.match(/CONFORMED SUBMISSION TYPE:\s*([^\s]+)/)?.[1], formType);
  const documents = [...completeSubmission.matchAll(/<DOCUMENT>([\s\S]*?)<\/DOCUMENT>/g)]
    .filter((match) => match[1]?.match(/<TYPE>([^\r\n]+)/)?.[1] === formType);
  assert.equal(documents.length, 1, `${accession} one official form document`);
  const document = documents[0]!;
  assert.equal(document[1]!.match(/<FILENAME>([^\r\n]+)/)?.[1], fileName);
  const text = document[1]!.match(/<XML>\r?\n([\s\S]*?)<\/XML>/)?.[1];
  assert.ok(text, `${accession} XML payload`);
  const characterOffset = completeSubmission.indexOf(text, document.index);
  assert.ok(characterOffset >= 0);
  const startByte = Buffer.byteLength(completeSubmission.slice(0, characterOffset), "utf8");
  const endByte = Buffer.byteLength(completeSubmission.slice(0, characterOffset + text.length), "utf8");
  const xmlBytes = bytes.subarray(startByte, endByte);
  assert.equal(xmlBytes.toString("utf8"), text);
  return { completeSubmission, text, bytes: xmlBytes, startByte };
}

async function verifySyntheticTotalValueRoundtrip(input: {
  baseCase: Row;
  runId: string;
  rawStore: Row;
  persistence: Row;
}) {
  const baseRawItem = input.baseCase.rawItem as Row;
  const baseXml = String(input.baseCase.extracted.text);
  const derivativeBlock = /<derivativeTransaction>[\s\S]*?<\/derivativeTransaction>/.exec(baseXml)?.[0];
  assert.ok(derivativeBlock, "synthetic total-value derivative transaction");
  const sharesBlock = /<transactionShares>[\s\S]*?<\/transactionShares>/.exec(derivativeBlock)?.[0];
  assert.ok(sharesBlock, "synthetic total-value source field");
  const cases = [
    {
      accession: "0000094049-26-990001",
      replacement: '<transactionTotalValue><value>500000</value><footnoteId id="F6"/></transactionTotalValue>',
      status: "exact",
      rawValue: "500000",
      footnoteIds: ["F6"],
    },
    {
      accession: "0000094049-26-990002",
      replacement: "<transactionTotalValue><value>0</value></transactionTotalValue>",
      status: "exact",
      rawValue: "0",
      footnoteIds: [],
    },
    {
      accession: "0000094049-26-990003",
      replacement: '<transactionTotalValue><footnoteId id="F6"/></transactionTotalValue>',
      status: "footnote_only",
      rawValue: "",
      footnoteIds: ["F6"],
    },
    {
      accession: "0000094049-26-990004",
      replacement: sharesBlock,
      status: "missing",
      rawValue: null,
      footnoteIds: [],
    },
  ] as const;
  const results: Row[] = [];
  try {
    for (const item of cases) {
      const sourceXml = item.status === "missing"
        ? baseXml
        : baseXml.replace(derivativeBlock, derivativeBlock.replace(sharesBlock, item.replacement));
      const sourceUrl = `https://www.sec.gov/Archives/edgar/data/94049/${item.accession.replaceAll("-", "")}/form5a.xml`;
      const rawItem = structuredClone(baseRawItem);
      rawItem.source_unique_id = item.accession;
      rawItem.source_url = sourceUrl.replace(/\/[^/]+$/, `/${item.accession}-index.html`);
      rawItem.dedupe_key = `sec_edgar:${item.accession}`;
      rawItem.title = `SYNTHETIC persistence regression ${item.status}`;
      rawItem.raw_payload.accession_number = item.accession;
      Object.assign(rawItem.raw_payload, parser.preserveSection16XmlSource({
        formType: "5/A",
        sourceUrl,
        text: sourceXml,
      }));
      const saved = await input.rawStore.saveSecRawItem(rawItem, input.runId);
      const savedId = stringValue(saved.id);
      const persisted = await input.persistence.persistSection16CanonicalXmlForRawItem({ rawItemId: savedId, rawItem });
      assert.equal(persisted.writeStatus, "inserted");
      const readback = await input.persistence.readSection16FilingByAccession(item.accession);
      assert.equal(readback.status, "available");
      if (readback.status !== "available") throw new Error(`${item.status} synthetic readback unavailable`);
      const derivative = readback.transactions.find((row: Row) => row.row_kind === "derivative");
      assert.ok(derivative);
      const field = derivative.structural_payload.transactionTotalValue;
      assert.equal(derivative.transaction_total_value_raw, item.rawValue);
      assert.equal(field.status, item.status);
      assert.equal(field.rawValue, item.rawValue);
      assert.deepEqual(field.footnoteIds, item.footnoteIds);
      results.push({
        case: item.status,
        accession: item.accession,
        transactionTotalValueRaw: derivative.transaction_total_value_raw,
        field,
        exactReadback: true,
      });
    }
    return results;
  } finally {
    const syntheticAccessions = cases.map((item) => item.accession);
    await admin.query("delete from public.sec_section16_filings where accession_number = any($1::text[])", [syntheticAccessions]);
    await admin.query("delete from public.raw_items where source_unique_id = any($1::text[])", [syntheticAccessions]);
    assert.equal(await countByAccessions(admin, "sec_section16_filings", "accession_number", syntheticAccessions), 0);
    assert.equal(await countByAccessions(admin, "raw_items", "source_unique_id", syntheticAccessions), 0);
  }
}

function secDate(text: string, label: string) {
  const raw = text.match(new RegExp(`${label}:\\s*(\\d{8})`))?.[1];
  assert.ok(raw);
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

function secAcceptedAt(text: string) {
  const raw = text.match(/<ACCEPTANCE-DATETIME>(\d{14})/)?.[1];
  assert.ok(raw);
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)} ${raw.slice(8, 10)}:${raw.slice(10, 12)}:${raw.slice(12, 14)}`;
}

function xmlValue(text: string, tag: string) {
  const value = text.match(new RegExp(`<${tag}>([^<]+)</${tag}>`))?.[1]?.trim();
  assert.ok(value, `XML ${tag}`);
  return value;
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

async function secretRpc(functionName: string, body: Row, requireOk = true) {
  const response = await fetch(`${apiUrl}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: {
      apikey: secretKey,
      Authorization: `Bearer ${secretKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (requireOk && !response.ok) throw new Error(`RPC ${functionName} failed: HTTP ${response.status} ${text}`);
  return { ok: response.ok, status: response.status, data: text ? JSON.parse(text) : null };
}

async function countByAccessions(client: DbClient, table: string, column: string, accessions: readonly string[]) {
  const tables = new Set(["raw_items", "events", "sec_section16_filings"]);
  const columns = new Set(["source_unique_id", "accession_number", "metadata->>'accession_number'"]);
  assert.ok(tables.has(table) && columns.has(column));
  const result = await client.query(`select count(*)::integer as count from public.${table} where ${column} = any($1::text[])`, [accessions]);
  return Number(result.rows[0]?.count);
}

async function canonicalSnapshot(client: DbClient, accessions: readonly string[]) {
  const specs = [
    ["filings", "sec_section16_filings", "accession_number"],
    ["reportingOwners", "sec_section16_reporting_owners", "accession_number, reporting_owner_index"],
    ["transactions", "sec_section16_transactions", "accession_number, row_ordinal"],
    ["holdings", "sec_section16_holdings", "accession_number, row_ordinal"],
    ["footnotes", "sec_section16_footnotes", "accession_number, footnote_index"],
    ["signatures", "sec_section16_signatures", "accession_number, signature_index"],
  ] as const;
  const result: Row = {};
  for (const [key, table, order] of specs) {
    result[key] = (await client.query(
      `select * from public.${table} where accession_number = any($1::text[]) order by ${order}`,
      [accessions],
    )).rows;
  }
  return result;
}

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter((item): item is Row => Boolean(item && typeof item === "object")) : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
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
