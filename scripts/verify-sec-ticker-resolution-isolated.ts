import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire, registerHooks } from "node:module";

type Row = Record<string, any>;
type QueryResult = { rows: Row[]; rowCount: number | null };
type PgClient = {
  connect(): Promise<void>;
  end(): Promise<void>;
  query(sql: string, values?: unknown[]): Promise<QueryResult>;
};

const pgModule = createRequire(import.meta.url)("pg") as {
  Client: new (options: { connectionString: string }) => PgClient;
  types: { setTypeParser(oid: number, parser: (value: string) => string): void };
};
pgModule.types.setTypeParser(1082, (value) => value);
const PgClient = pgModule.Client;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { shortCircuit: true, url: "data:text/javascript,export%20%7B%7D;" };
    if (specifier.startsWith("@/")) {
      const candidate = new URL(`../${specifier.slice(2)}`, import.meta.url);
      for (const suffix of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
        const resolved = new URL(`${candidate.href}${suffix}`);
        if (existsSync(resolved)) return { shortCircuit: true, url: resolved.href };
      }
    }
    if (specifier.startsWith(".") && context.parentURL) {
      const candidate = new URL(specifier, context.parentURL);
      for (const suffix of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
        const resolved = new URL(`${candidate.href}${suffix}`);
        if (existsSync(resolved)) return { shortCircuit: true, url: resolved.href };
      }
    }
    return nextResolve(specifier, context);
  },
});

const dbUrl = requiredEnv("SEC_TICKER_RESOLUTION_ISOLATED_DB_URL");
const evidenceDirectory = requiredEnv("SEC_TICKER_RESOLUTION_EVIDENCE_DIR");
const sourceDirectory = requiredEnv("SEC_TICKER_RESOLUTION_SOURCE_DIR");
const veeaSourcePath = requiredEnv("SEC_TICKER_RESOLUTION_VEEA_SOURCE");
const outputPath = requiredEnv("SEC_TICKER_RESOLUTION_OUTPUT");
const parsedDbUrl = new URL(dbUrl);
assert.equal(parsedDbUrl.hostname, "127.0.0.1");
assert.equal(parsedDbUrl.port, "59422");
assert.ok(!new Set(["56322", "59122", "59222", "59322"]).has(parsedDbUrl.port));

let networkCalls = 0;
globalThis.fetch = async () => {
  networkCalls += 1;
  throw new Error("network is forbidden during isolated ticker-resolution verification");
};

const [coverPersistence, resolutionPersistence, filingXbrl] = await Promise.all([
  import("../lib/sec-cover-observations/persistence.ts"),
  import("../lib/sec-ticker-resolution/persistence.ts"),
  import("../lib/sec-structured-data/filingXbrlContext.ts"),
]);
const {
  persistSecCoverObservationsForRawItem,
  persistSecCoverObservationsForStructuredArtifact,
  readSecCoverObservations,
} = coverPersistence;
const { resolveAndPersistSecTickerChange, readCurrentSecTickerResolution } = resolutionPersistence;
const { createSecFilingXbrlArtifactFromStoredHttpBody } = filingXbrl;

const expectations = JSON.parse(await readFile(`${sourceDirectory}\\source-expectations.json`, "utf8"));
const client = new PgClient({ connectionString: dbUrl });
await client.connect();
const repository = createRepository(client);
const actualRows = new Map<string, { sha256: string; rawItemId: string; source: string }>();
const report: Row = {
  schemaVersion: "sec-ticker-resolution-isolated-e2e-v1",
  repositoryHead: process.env.SEC_TICKER_RESOLUTION_REPOSITORY_HEAD ?? null,
  database: {
    host: parsedDbUrl.hostname,
    port: parsedDbUrl.port,
    protectedPortsUntouched: ["56322", "59122", "59222", "59322"],
    network: "stockradar_ticker_resolution_44a1_isolated",
    subnet: "10.250.44.0/24",
    alias: "ticker-resolution-db",
  },
  actualSecCases: [],
  actualResolutions: [],
  actualSecBoundaries: [],
  syntheticRegressions: [],
  calls: { network: 0, llm: 0, cron: 0, alerts: 0, monitor: 0, backfill: 0 },
};

try {
  await client.query(`insert into public.sources (code,name,source_group,runtime_owner,enabled,metadata)
    values ('sec_edgar','SEC EDGAR','filings','external',true,'{}'::jsonb) on conflict (code) do nothing`);
  const files: Record<string, string> = {
    "0001493152-26-006951": "0001493152-26-006951-form10-q.htm",
    "0001493152-26-023049": "0001493152-26-023049-form10-q.htm",
    "0001493152-26-039128": "0001493152-26-039128-form8-k.htm",
    "0001493152-26-042421": "0001493152-26-042421-form8-k.htm",
  };
  const rawIds: Record<string, string> = {
    "0001493152-26-006951": "44006951-0000-4000-8000-000000000001",
    "0001493152-26-023049": "44023049-0000-4000-8000-000000000002",
    "0001493152-26-039128": "44039128-0000-4000-8000-000000000003",
    "0001493152-26-042421": "44042421-0000-4000-8000-000000000004",
  };
  for (const expected of expectations.documents as Row[]) {
    const fileName = files[expected.accessionNumber]!;
    const source = await readFile(`${sourceDirectory}\\${fileName}`, "utf8");
    assert.equal(sha256(source), expected.sourceSha256);
    const raw = rawItem({
      id: rawIds[expected.accessionNumber]!,
      accession: expected.accessionNumber,
      form: expected.form,
      filedAt: expected.filingDate,
      acceptedAt: expected.acceptedAt,
      fetchedAt: expected.sourceFetchedAt,
      source,
      fileName: fileName.includes("10-q") ? "form10-q.htm" : "form8-k.htm",
    });
    await insertRawItem(client, raw);
    const first = await persistSecCoverObservationsForRawItem({ rawItemId: raw.id, rawItem: raw, repository });
    const replay = await persistSecCoverObservationsForRawItem({ rawItemId: raw.id, rawItem: raw, repository });
    assert.equal(first.status, "available");
    assert.equal(first.writeStatus, "inserted");
    assert.equal(replay.status, "available");
    assert.equal(replay.writeStatus, "replayed");
    const read = await readSecCoverObservations({ accessionNumber: expected.accessionNumber, sourceSha256: expected.sourceSha256, repository });
    assert.equal(read.status, "available");
    assert.equal(read.results.length, 1);
    assert.equal(read.results[0]!.payload.observations[0]!.tradingSymbol.parsedTextValue, expected.tradingSymbol.replace(/\s+/g, " "));
    actualRows.set(expected.accessionNumber, { sha256: expected.sourceSha256, rawItemId: raw.id, source });
    report.actualSecCases.push({
      accessionNumber: expected.accessionNumber,
      sourceSha256: expected.sourceSha256,
      coverWrite: first.writeStatus,
      coverReplay: replay.writeStatus,
      reader: read.status,
      symbol: read.results[0]!.payload.observations[0]!.tradingSymbol.parsedTextValue,
      title: read.results[0]!.payload.observations[0]!.securityTitle.parsedTextValue,
      contextRef: read.results[0]!.payload.observations[0]!.contextRef,
    });
  }

  const veeaSource = await readFile(veeaSourcePath, "utf8");
  const veeaSha256 = sha256(veeaSource);
  assert.equal(veeaSha256, "10e0bab4937f3b7ff87c6856638430f7e8645e5eabfe3349403dd31666c5f65a");
  const veeaRaw = rawItem({
    id: "44010026-0000-4000-8000-000000000005",
    accession: "0001213900-24-100269",
    cik: "0001840317",
    form: "10-Q",
    filedAt: "2024-11-20",
    acceptedAt: "2024-11-19T22:55:58Z",
    fetchedAt: "2024-11-20T00:00:00Z",
    source: veeaSource,
    fileName: "ea0221355-10q_veeainc.htm",
  });
  await insertRawItem(client, veeaRaw);
  const veeaWrite = await persistSecCoverObservationsForRawItem({ rawItemId: veeaRaw.id, rawItem: veeaRaw, repository });
  const veeaReplay = await persistSecCoverObservationsForRawItem({ rawItemId: veeaRaw.id, rawItem: veeaRaw, repository });
  assert.equal(veeaWrite.status, "available", JSON.stringify(veeaWrite));
  assert.equal(veeaWrite.writeStatus, "inserted");
  assert.equal(veeaReplay.status, "available", JSON.stringify(veeaReplay));
  assert.equal(veeaReplay.writeStatus, "replayed");
  const veeaRead = await readSecCoverObservations({ accessionNumber: veeaRaw.raw_payload.accession_number, sourceSha256: veeaSha256, repository });
  assert.equal(veeaRead.status, "available", JSON.stringify(veeaRead));
  assert.deepEqual(veeaRead.results[0]!.payload.observations.map((row) => row.contextRef), ["c1", "c2"]);
  assert.deepEqual(veeaRead.results[0]!.payload.observations.map((row) => row.tradingSymbol.rawLexicalValue), ["VEEA", "VEEAW"]);
  assert.ok(veeaRead.results[0]!.payload.observations.every((row) => row.context.dimensions.length === 1));
  const veeaResolutionRequest = {
    issuerCik: "0001840317",
    evidenceAccessionNumber: "0001213900-24-100269",
    evidenceSourceSha256: veeaSha256,
    beforeAccessionNumber: "0001213900-24-100269",
    beforeSourceSha256: veeaSha256,
    afterAccessionNumber: "0001213900-24-100269",
    afterSourceSha256: veeaSha256,
  };
  const veeaResolution = await resolveAndPersistSecTickerChange({ ...veeaResolutionRequest, repository });
  assert.equal(veeaResolution.status, "available", JSON.stringify(veeaResolution));
  assert.equal(veeaResolution.resolutionState, "REVIEW");
  assert.ok(veeaResolution.evaluation.reasons.includes("BEFORE_COVER_MULTIPLE_SECURITY_CANDIDATES"));
  assert.ok(veeaResolution.evaluation.reasons.includes("AFTER_COVER_MULTIPLE_SECURITY_CANDIDATES"));
  assert.equal(veeaResolution.evaluation.identity, null);
  assert.equal(veeaResolution.evaluation.evidence, null);
  const veeaResolutionRead = await readCurrentSecTickerResolution({ ...veeaResolutionRequest, repository });
  assert.equal(veeaResolutionRead.status, "available", JSON.stringify(veeaResolutionRead));
  assert.equal(veeaResolutionRead.evaluation.resolutionState, "REVIEW");
  report.actualSecBoundaries.push({
    scope: "actual_sec_primary_document",
    accessionNumber: "0001213900-24-100269",
    sourceSha256: veeaSha256,
    contexts: ["c1", "c2"],
    symbols: ["VEEA", "VEEAW"],
    coverWrite: veeaWrite.writeStatus,
    coverReplay: veeaReplay.writeStatus,
    reader: veeaRead.status,
    resolutionState: veeaResolution.resolutionState,
    resolutionReader: veeaResolutionRead.status,
    reasons: veeaResolution.evaluation.reasons,
    relationshipInvented: false,
  });

  const immutableBefore = await observationDigest(client);
  const firstRequest = request("0001493152-26-023049", "0001493152-26-006951", "0001493152-26-023049");
  const first = await resolveAndPersistSecTickerChange({ ...firstRequest, repository });
  assert.equal(first.status, "available", JSON.stringify(first));
  assert.equal(first.writeStatus, "inserted");
  assert.equal(first.resolutionState, "AUTO");
  assert.deepEqual(first.evaluation.summary.oldTicker, "VRAR");
  assert.deepEqual(first.evaluation.summary.newTicker, "GGRP");
  assert.deepEqual(first.evaluation.summary.effectiveDate, "2026-02-19");
  assert.deepEqual(first.evaluation.summary.effectivePrecision, "date");
  const firstRead = await readCurrentSecTickerResolution({
    issuerCik: expectations.issuerCik,
    evidenceAccessionNumber: firstRequest.evidenceAccessionNumber,
    beforeAccessionNumber: firstRequest.beforeAccessionNumber,
    afterAccessionNumber: firstRequest.afterAccessionNumber,
    repository,
  });
  assert.equal(firstRead.status, "available");
  assert.equal(firstRead.evaluation.resolutionState, "AUTO");
  report.actualResolutions.push(summary(first, firstRead));

  const secondRequest = request("0001493152-26-039128", "0001493152-26-039128", "0001493152-26-042421");
  const raced = await Promise.all(Array.from({ length: 12 }, async () => {
    const raceClient = new PgClient({ connectionString: dbUrl });
    await raceClient.connect();
    try {
      return await resolveAndPersistSecTickerChange({ ...secondRequest, repository: createRepository(raceClient) });
    } finally {
      await raceClient.end();
    }
  }));
  assert.equal(raced.filter((row) => row.status === "available" && row.writeStatus === "inserted").length, 1);
  assert.equal(raced.filter((row) => row.status === "available" && row.writeStatus === "replayed").length, 11);
  assert.ok(raced.every((row) => row.status === "available" && row.resolutionState === "AUTO"));
  const second = raced.find((row) => row.status === "available")!;
  assert.equal(second.evaluation.summary.oldTicker, "GGRP");
  assert.equal(second.evaluation.summary.newTicker, "BTLN");
  assert.equal(second.evaluation.summary.effectiveDate, "2026-08-20");
  assert.equal(second.evaluation.summary.effectivePrecision, "market_open");
  assert.equal(second.evaluation.evidence?.effective_at, null);
  const secondRead = await readCurrentSecTickerResolution({
    issuerCik: expectations.issuerCik,
    evidenceAccessionNumber: secondRequest.evidenceAccessionNumber,
    beforeAccessionNumber: secondRequest.beforeAccessionNumber,
    afterAccessionNumber: secondRequest.afterAccessionNumber,
    repository,
  });
  assert.equal(secondRead.status, "available");
  report.actualResolutions.push({ ...summary(second, secondRead), concurrency: { inserted: 1, replayed: 11 } });

  const firstReplay = await resolveAndPersistSecTickerChange({ ...firstRequest, repository });
  assert.equal(firstReplay.status, "available");
  assert.equal(firstReplay.writeStatus, "replayed");
  assert.deepEqual(await observationDigest(client), immutableBefore);

  const missingSource = inlineCover("MISS", "Common Stock, par value $0.001 per share", "No supported ticker-change claim is present.");
  const missing = await insertSyntheticCover({
    id: "44900001-0000-4000-8000-000000000011",
    accession: "0001493152-26-900001",
    acceptedAt: "2026-05-15T12:00:00Z",
    source: missingSource,
  });
  await persistAndReadNegative("missing_evidence", {
    issuerCik: expectations.issuerCik,
    evidenceAccessionNumber: missing.accession,
    evidenceSourceSha256: missing.sha256,
    beforeAccessionNumber: "0001493152-26-006951",
    beforeSourceSha256: actualRows.get("0001493152-26-006951")!.sha256,
    afterAccessionNumber: missing.accession,
    afterSourceSha256: missing.sha256,
  }, "UNRESOLVED", "SUPPORTED_CHANGE_EVIDENCE_MISSING");

  const conflictText = "Effective February 19, 2026, we changed our ticker symbol on Nasdaq from \"VRAR\" to \"CNFL\". The change did not alter other terms of our common stock. The effective date of this ticker symbol change is February 20, 2026, not February 19, 2026.";
  const conflict = await insertSyntheticCover({
    id: "44900002-0000-4000-8000-000000000012",
    accession: "0001493152-26-900002",
    acceptedAt: "2026-05-16T12:00:00Z",
    source: inlineCover("CNFL", "Common Stock, par value $0.001 per share", conflictText),
  });
  await persistAndReadNegative("conflicting_effective_date", {
    issuerCik: expectations.issuerCik,
    evidenceAccessionNumber: conflict.accession,
    evidenceSourceSha256: conflict.sha256,
    beforeAccessionNumber: "0001493152-26-006951",
    beforeSourceSha256: actualRows.get("0001493152-26-006951")!.sha256,
    afterAccessionNumber: conflict.accession,
    afterSourceSha256: conflict.sha256,
  }, "REVIEW", "TARGET_EVIDENCE_CONFLICT");

  const classBefore = await insertSyntheticCover({
    id: "44900003-0000-4000-8000-000000000013",
    accession: "0001493152-26-900003",
    acceptedAt: "2026-02-17T12:00:00Z",
    source: inlineCover("CLA", "Common Stock", "Class A observation.", "ClassAMember"),
  });
  const classAfter = await insertSyntheticCover({
    id: "44900004-0000-4000-8000-000000000014",
    accession: "0001493152-26-900004",
    acceptedAt: "2026-05-14T12:00:00Z",
    source: inlineCover("CLB", "Common Stock", "Effective February 19, 2026, we changed our ticker symbol on Nasdaq from \"CLA\" to \"CLB\". The change did not alter other terms of our common stock.", "ClassBMember"),
  });
  await persistAndReadNegative("same_title_different_class_dimension", {
    issuerCik: expectations.issuerCik,
    evidenceAccessionNumber: classAfter.accession,
    evidenceSourceSha256: classAfter.sha256,
    beforeAccessionNumber: classBefore.accession,
    beforeSourceSha256: classBefore.sha256,
    afterAccessionNumber: classAfter.accession,
    afterSourceSha256: classAfter.sha256,
  }, "REVIEW", "SECURITY_DIMENSIONS_CONFLICT");

  await verifySecurityAndImmutability(client);
  await assert.rejects(
    () => client.query("select public.persist_sec_ticker_resolution($1::jsonb,$2::jsonb,$3::jsonb)", [
      json(first.evaluation.identity),
      json({ ...first.evaluation.evidence, source_sha256: "0".repeat(64) }),
      json(first.evaluation.decision),
    ]),
    /source mismatch/i,
  );

  await client.query("begin");
  const revisionBody = actualRows.get("0001493152-26-023049")!.source.replace(
    /Effective\s+February 19, 2026,[\s\S]{0,1600}?other terms of our common stock\./i,
    "Hypothetical example only; this is not an actual issuer change. Effective February 19, 2026, we changed our ticker symbol from VRAR to GGRP. The change did not alter other terms of our common stock.",
  );
  assert.notEqual(revisionBody, actualRows.get("0001493152-26-023049")!.source);
  const ledgerRawId = "44999999-0000-4000-8000-000000000099";
  await client.query(`insert into public.sec_structured_raw_sources (
      id,source_kind,source_url,source_identity,cik,fetched_at,content_hash,source_schema_version,raw_content_kind,raw_content,payload
    ) values ($1,'submissions',$2,$3,$4,$5,$6,'sec-submissions-v1','authoritative_http_body',$7,'{}'::jsonb)`, [
    ledgerRawId,
    "https://data.sec.gov/submissions/CIK0001854445.json",
    "CIK0001854445.json:stale-reader-probe",
    expectations.issuerCik,
    "2026-09-13T01:30:00Z",
    sha256("stale-reader-ledger-source"),
    "stale-reader-ledger-source",
  ]);
  await client.query(`insert into public.sec_filing_ledger (
      accession_number,issuer_cik,form,filed_date,accepted_at,report_date,primary_document,is_xbrl,is_inline_xbrl,source_raw_id,source_kind
    ) values ($1,$2,'10-Q','2026-05-14','2026-05-14T20:02:06Z','2026-03-31','form10-q.htm',true,true,$3,'submissions')`, [
    "0001493152-26-023049", expectations.issuerCik, ledgerRawId,
  ]);
  const revisionArtifact = createSecFilingXbrlArtifactFromStoredHttpBody({
    issuerCik: expectations.issuerCik,
    accession: "0001493152-26-023049",
    documentName: "form10-q.htm",
    sourceUrl: "https://www.sec.gov/Archives/edgar/data/1854445/000149315226023049/form10-q.htm",
    role: "inline_xbrl",
    rawContent: revisionBody,
    fetchedAt: "2026-09-13T01:31:00Z",
    contentType: "text/html",
  });
  const revisionWrite = await persistSecCoverObservationsForStructuredArtifact({
    filing: {
      accessionNumber: "0001493152-26-023049",
      issuerCik: expectations.issuerCik,
      formType: "10-Q",
      filedDate: "2026-05-14",
      acceptedAt: "2026-05-14T20:02:06Z",
      sourceRawId: ledgerRawId,
    },
    artifact: revisionArtifact,
    repository,
  });
  assert.equal(revisionWrite.writeStatus, "inserted");
  const staleRead = await readCurrentSecTickerResolution({
    issuerCik: expectations.issuerCik,
    evidenceAccessionNumber: firstRequest.evidenceAccessionNumber,
    beforeAccessionNumber: firstRequest.beforeAccessionNumber,
    afterAccessionNumber: firstRequest.afterAccessionNumber,
    repository,
  });
  assert.deepEqual(staleRead, { status: "unavailable", reason: "source_revision_conflict_requires_review" });
  assert.equal(await scalar(client, "select count(*)::int from public.sec_ticker_resolution_decisions where id=$1", [first.decisionId]), 1);
  report.staleAutoProtection = {
    priorDecisionPreserved: true,
    newerRevisionWrite: revisionWrite.writeStatus,
    readerStatus: staleRead.status,
    readerReason: staleRead.reason,
  };
  await client.query("rollback");
  const restoredFirstRead = await readCurrentSecTickerResolution({
    issuerCik: expectations.issuerCik,
    evidenceAccessionNumber: firstRequest.evidenceAccessionNumber,
    beforeAccessionNumber: firstRequest.beforeAccessionNumber,
    afterAccessionNumber: firstRequest.afterAccessionNumber,
    repository,
  });
  assert.equal(restoredFirstRead.status, "available", JSON.stringify(restoredFirstRead));
  assert.equal(restoredFirstRead.evaluation.resolutionState, "AUTO");
  report.staleAutoProtection.postRollbackCurrentReader = restoredFirstRead.status;

  assert.equal(networkCalls, 0);
  report.calls.network = networkCalls;
  report.counts = {
    coverResults: await scalar(client, "select count(*)::int from public.sec_cover_observation_results"),
    coverObservations: await scalar(client, "select count(*)::int from public.sec_cover_security_observations"),
    identities: await scalar(client, "select count(*)::int from public.sec_ticker_security_identities"),
    evidence: await scalar(client, "select count(*)::int from public.sec_ticker_change_evidence"),
    decisions: await scalar(client, "select count(*)::int from public.sec_ticker_resolution_decisions"),
  };
  report.ok = true;
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
} finally {
  await client.end();
}

function request(evidenceAccessionNumber: string, beforeAccessionNumber: string, afterAccessionNumber: string) {
  return {
    issuerCik: expectations.issuerCik as string,
    evidenceAccessionNumber,
    evidenceSourceSha256: actualRows.get(evidenceAccessionNumber)!.sha256,
    beforeAccessionNumber,
    beforeSourceSha256: actualRows.get(beforeAccessionNumber)!.sha256,
    afterAccessionNumber,
    afterSourceSha256: actualRows.get(afterAccessionNumber)!.sha256,
  };
}

async function insertSyntheticCover(input: { id: string; accession: string; acceptedAt: string; source: string }) {
  const raw = rawItem({
    id: input.id,
    accession: input.accession,
    form: "10-Q",
    filedAt: input.acceptedAt.slice(0, 10),
    acceptedAt: input.acceptedAt,
    fetchedAt: "2026-09-13T01:00:00Z",
    source: input.source,
    fileName: "synthetic.htm",
  });
  await insertRawItem(client, raw);
  const write = await persistSecCoverObservationsForRawItem({ rawItemId: raw.id, rawItem: raw, repository });
  assert.equal(write.status, "available", JSON.stringify(write));
  assert.equal(write.writeStatus, "inserted");
  return { accession: input.accession, sha256: sha256(input.source) };
}

async function persistAndReadNegative(
  name: string,
  requestInput: Parameters<typeof resolveAndPersistSecTickerChange>[0],
  expectedState: "REVIEW" | "UNRESOLVED",
  expectedReason: string,
) {
  const write = await resolveAndPersistSecTickerChange({ ...requestInput, repository });
  assert.equal(write.status, "available", JSON.stringify(write));
  assert.equal(write.resolutionState, expectedState);
  assert.ok(write.evaluation.reasons.includes(expectedReason));
  const read = await readCurrentSecTickerResolution({
    issuerCik: requestInput.issuerCik,
    evidenceAccessionNumber: requestInput.evidenceAccessionNumber,
    beforeAccessionNumber: requestInput.beforeAccessionNumber,
    afterAccessionNumber: requestInput.afterAccessionNumber,
    repository,
  });
  assert.equal(read.status, "available", JSON.stringify(read));
  assert.equal(read.evaluation.resolutionState, expectedState);
  report.syntheticRegressions.push({ name, scope: "synthetic_db_regression", state: expectedState, reason: expectedReason, reader: read.status });
}

function summary(write: any, read: any) {
  return {
    scope: "actual_sec_primary_documents",
    decisionId: write.decisionId,
    write: write.writeStatus,
    state: write.resolutionState,
    reader: read.status,
    oldTicker: write.evaluation.summary.oldTicker,
    newTicker: write.evaluation.summary.newTicker,
    effectiveDate: write.evaluation.summary.effectiveDate,
    effectivePrecision: write.evaluation.summary.effectivePrecision,
    continuityBasis: write.evaluation.summary.continuityBasis,
    spanSha256: write.evaluation.summary.sourceTextSpanSha256,
  };
}

function createRepository(pgClient: PgClient) {
  return {
    async select(table: string, query: Record<string, string>) {
      const specs: Record<string, { filters: string[]; order: string }> = {
        raw_items: { filters: ["id"], order: "id" },
        sec_cover_observation_results: { filters: ["accession_number", "source_sha256"], order: "created_at desc,id desc" },
        sec_cover_security_observations: { filters: ["result_id"], order: "observation_index asc" },
        sec_structured_raw_sources: { filters: ["id"], order: "id" },
        sec_ticker_resolution_decisions: { filters: ["id", "issuer_cik", "evidence_accession_number", "before_accession_number", "after_accession_number", "method_version"], order: "created_at desc,id desc" },
        sec_ticker_security_identities: { filters: ["id"], order: "id" },
        sec_ticker_change_evidence: { filters: ["id"], order: "id" },
      };
      const spec = specs[table];
      if (!spec) return { ok: false, status: 400, data: null, error: "unsupported verification table" };
      const values: unknown[] = [];
      const clauses: string[] = [];
      for (const filter of spec.filters) {
        if (!query[filter]) continue;
        if (!query[filter]!.startsWith("eq.")) return { ok: false, status: 400, data: null, error: "unsupported verification filter" };
        values.push(query[filter]!.slice(3));
        clauses.push(`${filter} = $${values.length}`);
      }
      const limit = Math.max(1, Math.min(Number(query.limit || 1000), 1000));
      const result = await pgClient.query(`select * from public.${table}${clauses.length ? ` where ${clauses.join(" and ")}` : ""} order by ${spec.order} limit ${limit}`, values);
      return { ok: true, status: 200, data: JSON.parse(JSON.stringify(result.rows)) };
    },
    async rpc(functionName: string, payload: Row) {
      try {
        if (functionName === "persist_sec_cover_observation_result") {
          const result = await pgClient.query("select public.persist_sec_cover_observation_result($1::uuid,$2::jsonb,$3::jsonb,$4::jsonb) as value", [
            payload.p_raw_item_id, payload.p_source === null ? null : json(payload.p_source), json(payload.p_result), json(payload.p_observations),
          ]);
          return { ok: true, status: 200, data: result.rows[0]!.value };
        }
        if (functionName === "persist_sec_ticker_resolution") {
          const result = await pgClient.query("select public.persist_sec_ticker_resolution($1::jsonb,$2::jsonb,$3::jsonb) as value", [
            payload.p_identity === null ? null : json(payload.p_identity),
            payload.p_evidence === null ? null : json(payload.p_evidence),
            json(payload.p_decision),
          ]);
          return { ok: true, status: 200, data: result.rows[0]!.value };
        }
        return { ok: false, status: 400, data: null, error: "unsupported verification RPC" };
      } catch (error) {
        return { ok: false, status: 500, data: null, error: error instanceof Error ? error.message : "verification RPC failed" };
      }
    },
  };
}

function rawItem(input: { id: string; accession: string; cik?: string; form: string; filedAt: string; acceptedAt: string; fetchedAt: string; source: string; fileName: string }) {
  const cik = (input.cik ?? "0001854445").padStart(10, "0");
  const archiveCik = cik.replace(/^0+/, "");
  return {
    id: input.id,
    run_id: null,
    source_code: "sec_edgar",
    source_group: "filings",
    source_unique_id: input.accession,
    source_url: `https://www.sec.gov/Archives/edgar/data/${archiveCik}/${input.accession.replace(/-/g, "")}/${input.accession}-index.html`,
    title: `SEC ${input.form} ${input.accession}`,
    published_at: input.acceptedAt,
    fetched_at: input.fetchedAt,
    body_text: null,
    analysis_text: null,
    raw_payload: {
      accession_number: input.accession,
      cik,
      form_type: input.form,
      filing_date: input.filedAt,
      accepted_at: input.acceptedAt,
      parser_version: "sec_edgar_raw_parser_v1",
      primary_document_url: `https://www.sec.gov/Archives/edgar/data/${archiveCik}/${input.accession.replace(/-/g, "")}/${input.fileName}`,
      primary_document_html: input.source,
      primary_document_html_char_count: input.source.length,
      primary_document_html_truncated: false,
    },
    metadata: { sentinel: "ticker-resolution-verification" },
    dedupe_key: `sec_edgar:${input.accession}`,
  };
}

async function insertRawItem(pgClient: PgClient, raw: Row) {
  await pgClient.query(`insert into public.raw_items (
    id,run_id,source_code,source_group,source_unique_id,source_url,title,published_at,fetched_at,
    body_text,analysis_text,raw_payload,metadata,dedupe_key
  ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14)`, [
    raw.id, raw.run_id, raw.source_code, raw.source_group, raw.source_unique_id, raw.source_url, raw.title,
    raw.published_at, raw.fetched_at, raw.body_text, raw.analysis_text, json(raw.raw_payload), json(raw.metadata), raw.dedupe_key,
  ]);
}

function inlineCover(symbol: string, title: string, narrative: string, member?: string) {
  const dimension = member
    ? `<xbrldi:explicitMember dimension="srt:SecurityAxis">test:${member}</xbrldi:explicitMember>`
    : "";
  return `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:ix="http://www.xbrl.org/2013/inlineXBRL" xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:xbrldi="http://xbrl.org/2006/xbrldi" xmlns:dei="http://xbrl.sec.gov/dei/2026" xmlns:srt="http://fasb.org/srt/2026" xmlns:test="http://example.com/test"><body><ix:header><ix:resources><xbrli:context id="cover"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">0001854445</xbrli:identifier>${dimension ? `<xbrli:segment>${dimension}</xbrli:segment>` : ""}</xbrli:entity><xbrli:period><xbrli:startDate>2026-01-01</xbrli:startDate><xbrli:endDate>2026-03-31</xbrli:endDate></xbrli:period></xbrli:context></ix:resources></ix:header><ix:nonNumeric name="dei:Security12bTitle" contextRef="cover">${title}</ix:nonNumeric><ix:nonNumeric name="dei:TradingSymbol" contextRef="cover">${symbol}</ix:nonNumeric><ix:nonNumeric name="dei:SecurityExchangeName" contextRef="cover">Nasdaq</ix:nonNumeric><p>${narrative}</p></body></html>`;
}

async function observationDigest(pgClient: PgClient) {
  const result = await pgClient.query(`select pg_catalog.md5(
      coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) order by id)::text from public.sec_cover_observation_results r),'[]') ||
      coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(o) order by result_id,observation_index)::text from public.sec_cover_security_observations o),'[]') ||
      coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(s) order by id)::text from public.sec_structured_raw_sources s where source_kind='filing_xbrl'),'[]')
    ) as digest`);
  return result.rows[0]!.digest;
}

async function verifySecurityAndImmutability(pgClient: PgClient) {
  for (const table of ["sec_ticker_security_identities", "sec_ticker_change_evidence", "sec_ticker_resolution_decisions"]) {
    assert.equal((await pgClient.query("select relrowsecurity from pg_catalog.pg_class where oid=$1::regclass", [`public.${table}`])).rows[0]!.relrowsecurity, true);
    assert.equal((await pgClient.query("select has_table_privilege('anon',$1,'select') as value", [`public.${table}`])).rows[0]!.value, false);
    assert.equal((await pgClient.query("select has_table_privilege('authenticated',$1,'select') as value", [`public.${table}`])).rows[0]!.value, false);
    assert.equal((await pgClient.query("select has_table_privilege('service_role',$1,'select,insert') as value", [`public.${table}`])).rows[0]!.value, true);
    assert.equal((await pgClient.query("select has_table_privilege('service_role',$1,'update,delete') as value", [`public.${table}`])).rows[0]!.value, false);
  }
  await assert.rejects(() => pgClient.query("update public.sec_ticker_resolution_decisions set resolution_state=resolution_state"), /append-only/i);
  await assert.rejects(() => pgClient.query("delete from public.sec_ticker_change_evidence"), /append-only/i);
  assert.equal((await pgClient.query("select has_function_privilege('anon','public.persist_sec_ticker_resolution(jsonb,jsonb,jsonb)','execute') as value")).rows[0]!.value, false);
  assert.equal((await pgClient.query("select has_function_privilege('service_role','public.persist_sec_ticker_resolution(jsonb,jsonb,jsonb)','execute') as value")).rows[0]!.value, true);
}

async function scalar(pgClient: PgClient, sql: string, values: unknown[] = []) {
  return Number((await pgClient.query(sql, values)).rows[0]!.count);
}

function json(value: unknown) {
  return JSON.stringify(value ?? null);
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
