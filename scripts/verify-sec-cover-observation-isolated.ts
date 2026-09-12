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

const dbUrl = requiredEnv("SEC_COVER_ISOLATED_DB_URL");
const expectedPort = requiredEnv("SEC_COVER_ISOLATED_DB_PORT");
const evidenceOutput = requiredEnv("SEC_COVER_EVIDENCE_OUTPUT");
const migrationPath = requiredEnv("SEC_COVER_MIGRATION_PATH");
const sourcePaths = {
  gureCurrent: requiredEnv("SEC_COVER_GURE_CURRENT_SOURCE"),
  gureCurrentRawItemRow: requiredEnv("SEC_COVER_GURE_CURRENT_RAW_ITEM_ROW"),
  gureCurrentSourceRunRow: requiredEnv("SEC_COVER_GURE_CURRENT_SOURCE_RUN_ROW"),
  veea: requiredEnv("SEC_COVER_VEEA_SOURCE"),
  gureLegacy: requiredEnv("SEC_COVER_GURE_LEGACY_SOURCE"),
  gureLegacyLedgerSourceRow: requiredEnv("SEC_COVER_GURE_LEGACY_LEDGER_SOURCE_ROW"),
  gureLegacyLedgerRow: requiredEnv("SEC_COVER_GURE_LEGACY_LEDGER_ROW"),
  gureLegacyArtifactRow: requiredEnv("SEC_COVER_GURE_LEGACY_ARTIFACT_ROW"),
  gureLegacyPrimaryRow: requiredEnv("SEC_COVER_GURE_LEGACY_PRIMARY_ROW"),
};
const parsedUrl = new URL(dbUrl);
assert.equal(parsedUrl.hostname, "127.0.0.1");
assert.equal(parsedUrl.port, expectedPort);
assert.ok(!new Set(["54322", "56322", "59122"]).has(parsedUrl.port), `protected DB port ${parsedUrl.port} is forbidden`);

let networkCalls = 0;
globalThis.fetch = async () => {
  networkCalls += 1;
  throw new Error("isolated SEC cover verification blocks every network request");
};

const [
  {
    persistSecCoverObservationsForRawItem,
    persistSecCoverObservationsForStructuredArtifact,
    readSecCoverObservations,
    recordSecCoverObservationPersistenceState,
  },
  canonical,
  filingXbrl,
  secIngest,
] = await Promise.all([
  import("../lib/sec-cover-observations/persistence.ts"),
  import("../lib/sec-cover-observations/canonical.ts"),
  import("../lib/sec-structured-data/filingXbrlContext.ts"),
  import("../lib/secIngest.ts"),
]);

const [
  gureCurrentSource,
  gureCurrentRawItemRowText,
  gureCurrentSourceRunRowText,
  veeaSource,
  gureLegacySource,
  legacyLedgerSourceRowText,
  legacyLedgerRowText,
  legacyArtifactRowText,
  legacyPrimaryRowText,
] = await Promise.all([
  readFile(sourcePaths.gureCurrent, "utf8"),
  readFile(sourcePaths.gureCurrentRawItemRow, "utf8"),
  readFile(sourcePaths.gureCurrentSourceRunRow, "utf8"),
  readFile(sourcePaths.veea, "utf8"),
  readFile(sourcePaths.gureLegacy, "utf8"),
  readFile(sourcePaths.gureLegacyLedgerSourceRow, "utf8"),
  readFile(sourcePaths.gureLegacyLedgerRow, "utf8"),
  readFile(sourcePaths.gureLegacyArtifactRow, "utf8"),
  readFile(sourcePaths.gureLegacyPrimaryRow, "utf8"),
]);
assert.equal(sha256(gureCurrentSource), "147e7bf8479fd22ccc278876557514f30ccee21e4d015026c25bbcf333decc70");
assert.equal(sha256(veeaSource), "10e0bab4937f3b7ff87c6856638430f7e8645e5eabfe3349403dd31666c5f65a");
assert.equal(sha256(gureLegacySource), "743cd4c5acb95d02041b65f1dc4947f12f9501f1500556492aa71214b843ddf3");
const legacyLedgerSourceRow = JSON.parse(legacyLedgerSourceRowText) as Row;
const gureCurrentRawItemRow = JSON.parse(gureCurrentRawItemRowText) as Row;
const gureCurrentSourceRunRow = JSON.parse(gureCurrentSourceRunRowText) as Row;
const legacyLedgerRow = JSON.parse(legacyLedgerRowText) as Row;
const legacyArtifactRow = JSON.parse(legacyArtifactRowText) as Row;
const legacyPrimaryRow = JSON.parse(legacyPrimaryRowText) as Row;
assert.equal(legacyLedgerSourceRow.id, "d5b64c70-7e81-5966-94f5-6d293e095292");
assert.equal(sha256(legacyLedgerSourceRow.raw_content), legacyLedgerSourceRow.content_hash);
assert.equal(legacyLedgerRow.source_raw_id, legacyLedgerSourceRow.id);
assert.equal(legacyArtifactRow.content_hash, sha256(gureLegacySource));
assert.equal(legacyArtifactRow.raw_content, gureLegacySource);
assert.equal(legacyPrimaryRow.payload.role, "primary_document");
assert.equal(sha256(legacyPrimaryRow.raw_content), legacyPrimaryRow.content_hash);
assert.equal(gureCurrentRawItemRow.id, "f77b0b5c-c9a6-4add-93d6-b2626a11cf69");
assert.equal(gureCurrentRawItemRow.raw_payload.primary_document_html, gureCurrentSource);
assert.equal(gureCurrentRawItemRow.run_id, gureCurrentSourceRunRow.id);

const client = new PgClient({ connectionString: dbUrl });
await client.connect();
const repository = createPostgresRepository(client);
const cases = {
  gureCurrent: gureCurrentRawItemRow,
  veea: rawItem({
    id: "10000000-0000-4000-8000-000000000102",
    accession: "0001213900-24-100269",
    cik: "1840317",
    form: "10-Q",
    filedAt: "2024-11-20",
    acceptedAt: "2024-11-19T22:55:58.000Z",
    fetchedAt: "2024-11-20T00:00:00.000Z",
    indexUrl: "https://www.sec.gov/Archives/edgar/data/1840317/000121390024100269/0001213900-24-100269-index.htm",
    sourceUrl: "https://www.sec.gov/Archives/edgar/data/1840317/000121390024100269/ea0221355-10q_veeainc.htm",
    source: veeaSource,
  }),
  sourceMissing: rawItem({
    id: "10000000-0000-4000-8000-000000000104",
    accession: "0001193805-26-001158",
    cik: "885462",
    form: "10-Q",
    filedAt: "2026-08-29",
    acceptedAt: "2026-08-29T20:45:51.000Z",
    fetchedAt: "2026-08-30T19:21:11.675Z",
    indexUrl: "https://www.sec.gov/Archives/edgar/data/885462/000119380526001158/0001193805-26-001158-index.htm",
    sourceUrl: null,
    source: "",
    provenanceNote: "synthetic_missing_source_state_regression",
  }),
};
const legacyFiling = {
  accessionNumber: String(legacyLedgerRow.accession_number),
  issuerCik: String(legacyLedgerRow.issuer_cik),
  formType: String(legacyLedgerRow.form),
  filedDate: String(legacyLedgerRow.filed_date),
  acceptedAt: legacyLedgerRow.accepted_at === null ? null : String(legacyLedgerRow.accepted_at),
  sourceRawId: String(legacyLedgerRow.source_raw_id),
};
const legacyArtifact = filingXbrl.createSecFilingXbrlArtifactFromStoredHttpBody({
  issuerCik: legacyFiling.issuerCik,
  accession: legacyFiling.accessionNumber,
  documentName: "gure-20110630.xml",
  sourceUrl: "https://www.sec.gov/Archives/edgar/data/885462/000119380511001703/gure-20110630.xml",
  role: "instance_xml",
  rawContent: gureLegacySource,
  fetchedAt: String(legacyArtifactRow.fetched_at),
  contentType: String(legacyArtifactRow.payload.content_type),
});
assert.equal(legacyArtifact.id, legacyArtifactRow.id);

const report: Row = { databasePort: parsedUrl.port, sourceHashes: {}, cases: {}, checks: [] };
try {
  const actualRawHook = await assertActualGureRawIngestHookRollback({
    client,
    repository,
    raw: cases.gureCurrent,
    sourceRun: gureCurrentSourceRunRow,
    runSecRawIngest: secIngest.runSecRawIngest,
  });
  await client.query("begin");
  await client.query(
    `insert into public.sources (code, name, source_group, runtime_owner, enabled, metadata)
     values ('sec_edgar', 'SEC EDGAR', 'filings', 'external', true, '{}'::jsonb)
     on conflict (code) do nothing`,
  );
  await insertSourceRun(client, gureCurrentSourceRunRow);
  for (const raw of Object.values(cases)) await insertRawItem(client, raw);
  await insertLegacyFilingLedger(client, legacyLedgerSourceRow, legacyLedgerRow);
  const currentArtifactFirst = canonical.buildSecCoverObservationPayload(cases.gureCurrent.id, cases.gureCurrent);
  assert.ok(currentArtifactFirst?.sourceRaw);
  await insertStructuredRawSource(client, currentArtifactFirst.sourceRaw);
  await client.query("commit");

  const legacyPersisted = await persistSecCoverObservationsForStructuredArtifact({
    filing: legacyFiling,
    artifact: legacyArtifact,
    repository,
  });
  assert.equal(legacyPersisted.status, "available");
  assert.equal(
    await scalar(client, "select count(*)::int from public.sec_cover_observation_results where lineage_kind='structured_filing_artifact' and raw_item_id is null"),
    1,
  );

  for (const raw of [cases.veea, cases.sourceMissing]) {
    const persisted = await persistSecCoverObservationsForRawItem({
      rawItemId: raw.id,
      rawItem: raw,
      repository,
    });
    assert.equal(persisted.status, "available");
  }

  const firstInsertRace = await runConcurrentRawPersistence(dbUrl, cases.gureCurrent, 12);
  assert.equal(firstInsertRace.filter((result) => result.writeStatus === "inserted").length, 1);
  assert.equal(firstInsertRace.filter((result) => result.writeStatus === "replayed").length, 11);
  const concurrent = await runConcurrentRawPersistence(
    dbUrl,
    { ...cases.gureCurrent, fetched_at: "2026-09-12T12:34:56.000Z" },
    12,
  );
  assert.ok(concurrent.every((result) => result.status === "available" && result.writeStatus === "replayed"));
  assert.equal(await scalar(client, "select count(*)::int from public.sec_cover_observation_results where raw_item_id=$1", [cases.gureCurrent.id]), 1);
  assert.deepEqual(
    (await client.query("select payload from public.sec_structured_raw_sources where id=$1", [currentArtifactFirst.sourceRaw.id])).rows[0]!.payload,
    currentArtifactFirst.sourceRaw.payload,
  );
  const conflictingRoleWrite = await repository.rpc("persist_sec_cover_observation_result", {
    p_raw_item_id: cases.gureCurrent.id,
    p_source: {
      ...currentArtifactFirst.sourceRaw,
      payload: { ...(currentArtifactFirst.sourceRaw.payload as Row), role: "primary_document" },
    },
    p_result: currentArtifactFirst.result,
    p_observations: currentArtifactFirst.observations,
  });
  assert.equal(conflictingRoleWrite.ok, false);
  assert.match(String(conflictingRoleWrite.error), /conflicting immutable identity/);

  const original = await readSecCoverObservations({
    accessionNumber: cases.gureCurrent.raw_payload.accession_number,
    repository,
  });
  assert.equal(original.status, "available", JSON.stringify(original));
  if (original.status !== "available") throw new Error("unreachable");
  const originalObservation = original.results[0]!.payload.observations[0]!;
  assert.deepEqual([
    originalObservation.securityTitle.rawLexicalValue,
    originalObservation.tradingSymbol.rawLexicalValue,
    originalObservation.exchange.rawLexicalValue,
  ], ["Common Stock, $0.0005 par value", "GURE", "NASDAQ"]);
  assert.equal(originalObservation.contextRef, "From2026-01-01to2026-03-31");
  assert.deepEqual(originalObservation.context.period, { kind: "duration", startDate: "2026-01-01", endDate: "2026-03-31" });

  const veeaRead = await readSecCoverObservations({ accessionNumber: cases.veea.raw_payload.accession_number, repository });
  assert.equal(veeaRead.status, "available");
  if (veeaRead.status !== "available") throw new Error("unreachable");
  const veeaObservations = veeaRead.results[0]!.payload.observations;
  assert.deepEqual(veeaObservations.map((row) => row.contextRef), ["c1", "c2"]);
  assert.deepEqual(veeaObservations.map((row) => row.context.dimensions.length), [1, 1]);
  assert.deepEqual(veeaObservations.map((row) => row.tradingSymbol.rawLexicalValue), ["VEEA", "VEEAW"]);
  assert.deepEqual(veeaObservations.map((row) => row.exchange.rawLexicalValue), ["Nasdaq", "Nasdaq"]);
  assert.ok(veeaObservations.every((row) => row.securityTitle.status === "observed" && row.tradingSymbol.status === "observed"));

  const legacyRead = await readSecCoverObservations({ accessionNumber: legacyFiling.accessionNumber, repository });
  assert.equal(legacyRead.status, "available");
  if (legacyRead.status !== "available") throw new Error("unreachable");
  const legacyObservation = legacyRead.results[0]!.payload.observations[0]!;
  assert.equal(legacyRead.results[0]!.payload.extractionStatus, "partial");
  assert.deepEqual([
    legacyObservation.securityTitle.status,
    legacyObservation.tradingSymbol.rawLexicalValue,
    legacyObservation.exchange.status,
  ], ["source_missing", "GURE", "source_missing"]);

  const missingRead = await readSecCoverObservations({ accessionNumber: cases.sourceMissing.raw_payload.accession_number, repository });
  assert.equal(missingRead.status, "available");
  if (missingRead.status !== "available") throw new Error("unreachable");
  assert.equal(missingRead.results[0]!.payload.extractionStatus, "source_missing");
  assert.equal(missingRead.results[0]!.payload.observations.length, 0);

  const originalHash = original.results[0]!.payload.source.sha256!;
  const exactContext = await readSecCoverObservations({
    accessionNumber: cases.gureCurrent.raw_payload.accession_number,
    sourceSha256: originalHash,
    contextRef: "From2026-01-01to2026-03-31",
    repository,
  });
  assert.equal(exactContext.status, "available");

  await assert.rejects(
    () => persistSecCoverObservationsForRawItem({
      rawItemId: cases.gureCurrent.id,
      rawItem: { ...cases.gureCurrent, source_unique_id: "0001193805-26-999999" },
      repository,
    }),
    (error: unknown) => error instanceof canonical.SecCoverObservationSourceError
      && error.code === "caller_stored_identity_mismatch",
  );

  const changedRaw = structuredClone(cases.gureCurrent);
  changedRaw.raw_payload.primary_document_html += "\n";
  changedRaw.raw_payload.primary_document_html_char_count += 1;
  await updateRawItem(client, changedRaw);
  const changedRawPersist = await persistSecCoverObservationsForRawItem({ rawItemId: changedRaw.id, rawItem: changedRaw, repository });
  assert.equal(changedRawPersist.status, "available");
  assert.equal(changedRawPersist.writeStatus, "inserted");

  const changedParser = structuredClone(changedRaw);
  changedParser.raw_payload.parser_version = "sec_edgar_raw_parser_v2";
  await updateRawItem(client, changedParser);
  const changedParserPersist = await persistSecCoverObservationsForRawItem({ rawItemId: changedParser.id, rawItem: changedParser, repository });
  assert.equal(changedParserPersist.status, "available");
  assert.equal(changedParserPersist.writeStatus, "inserted");
  assert.equal(await scalar(client, "select count(*)::int from public.sec_cover_observation_results where raw_item_id=$1", [cases.gureCurrent.id]), 3);
  assert.equal(await scalar(client, "select count(distinct source_sha256)::int from public.sec_cover_observation_results where raw_item_id=$1", [cases.gureCurrent.id]), 2);

  const revisionRead = await readSecCoverObservations({ accessionNumber: cases.gureCurrent.raw_payload.accession_number, repository });
  assert.equal(revisionRead.status, "available");
  if (revisionRead.status !== "available") throw new Error("unreachable");
  assert.equal(revisionRead.results.length, 3);

  await recordSecCoverObservationPersistenceState({
    rawItemId: cases.gureCurrent.id,
    state: changedParserPersist,
    repository,
  });
  const metadata = (await client.query("select metadata from public.raw_items where id=$1", [cases.gureCurrent.id])).rows[0]!.metadata;
  assert.equal(metadata.ticker, "GURE");
  assert.equal(metadata.sec_cover_observation_persistence.result_id, changedParserPersist.resultId);

  const hookChecks = await assertRawIngestHookPaths({ client, repository, runSecRawIngest: secIngest.runSecRawIngest });
  const cacheCompatibility = await assertSharedArtifactCacheCompatibility({
    client,
    repository,
    legacyPrimaryRow,
    xbrlModule: filingXbrl,
  });

  await assertDatabaseProtection(client);
  await assertMigrationRollbackReapply(client, await readFile(migrationPath, "utf8"));

  report.sourceHashes = {
    gureCurrent: sha256(gureCurrentSource),
    veea: sha256(veeaSource),
    gureLegacy: sha256(gureLegacySource),
  };
  report.cases = {
    gureCurrent: summarizeRead(original),
    veea: summarizeRead(veeaRead),
    gureLegacy: {
      ...summarizeRead(legacyRead),
      scope: "existing instance_xml structured artifact joined to the filing ledger; never represented as a raw-ingest primary document",
    },
    sourceMissing: { ...summarizeRead(missingRead), scope: "synthetic state regression" },
    gureRevisionCount: revisionRead.results.length,
  };
  report.checks = [
    "actual_source_sha256",
    "existing_parser_context_and_dimensions",
    "atomic_insert_exact_replay",
    "12_way_concurrent_duplicate_zero",
    "12_independent_connection_first_insert_race",
    "actual_shared_gure_raw_item_runSecRawIngest_save_replay_reader_rollback",
    "source_and_parser_revision_preservation",
    "identity_mismatch_fail_closed",
    "reader_source_accession_context_lookup_and_reparse",
    "append_only_triggers",
    "rls_and_service_only_grants",
    "metadata_merge_isolation",
    "structured_artifact_filing_ledger_lineage",
    "shared_artifact_cache_bidirectional_role_and_payload_immutability",
    "migration_transaction_rollback_reapply",
  ];
  report.networkCalls = networkCalls;
  report.rawIngestHook = hookChecks;
  report.actualGureRawIngestHook = actualRawHook;
  report.sharedArtifactCacheCompatibility = cacheCompatibility;
  report.tableCounts = {
    results: await scalar(client, "select count(*)::int from public.sec_cover_observation_results"),
    observations: await scalar(client, "select count(*)::int from public.sec_cover_security_observations"),
    rawSources: await scalar(client, "select count(*)::int from public.sec_structured_raw_sources where source_kind='filing_xbrl'"),
  };
  report.ok = true;
  assert.equal(networkCalls, 0);
  await writeFile(evidenceOutput, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
} finally {
  await client.end();
}

function createPostgresRepository(client: PgClient) {
  return {
  async select(table: string, query: Record<string, string>) {
    const specs: Record<string, { filters: string[]; order: string }> = {
      raw_items: { filters: ["id"], order: "id" },
      sec_cover_observation_results: { filters: ["accession_number", "source_sha256"], order: "created_at desc, id desc" },
      sec_cover_security_observations: { filters: ["result_id"], order: "observation_index asc" },
      sec_structured_raw_sources: { filters: ["id"], order: "id" },
    };
    const spec = specs[table];
    if (!spec) return { ok: false, status: 400, data: null, error: "unsupported test table" };
    const values: unknown[] = [];
    const clauses: string[] = [];
    for (const filter of spec.filters) {
      if (!query[filter]) continue;
      const raw = query[filter]!;
      if (!raw.startsWith("eq.")) return { ok: false, status: 400, data: null, error: "unsupported test filter" };
      values.push(raw.slice(3));
      clauses.push(`${filter} = $${values.length}`);
    }
    const limit = Math.max(1, Math.min(Number(query.limit || 1000), 1000));
    const result = await client.query(
      `select * from public.${table}${clauses.length ? ` where ${clauses.join(" and ")}` : ""} order by ${spec.order} limit ${limit}`,
      values,
    );
    return { ok: true, status: 200, data: jsonRows(result.rows) };
  },

  async rpc(functionName: string, payload: Row) {
    try {
      if (functionName === "persist_sec_cover_observation_result") {
        const result = await client.query(
          "select public.persist_sec_cover_observation_result($1::uuid,$2::jsonb,$3::jsonb,$4::jsonb) as value",
          [payload.p_raw_item_id, payload.p_source === null ? null : json(payload.p_source), json(payload.p_result), json(payload.p_observations)],
        );
        return { ok: true, status: 200, data: result.rows[0]!.value };
      }
      if (functionName === "record_sec_cover_observation_persistence_state") {
        const result = await client.query(
          "select public.record_sec_cover_observation_persistence_state($1::uuid,$2::jsonb) as value",
          [payload.p_raw_item_id, json(payload.p_state)],
        );
        return { ok: true, status: 200, data: result.rows[0]!.value };
      }
      return { ok: false, status: 400, data: null, error: "unsupported test RPC" };
    } catch (error) {
      return { ok: false, status: 500, data: null, error: error instanceof Error ? error.message : "test RPC failed" };
    }
  },
  };
}

function rawItem(input: {
  id: string;
  accession: string;
  cik: string;
  form: string;
  filedAt: string;
  acceptedAt: string;
  fetchedAt: string;
  indexUrl: string;
  sourceUrl: string | null;
  source: string;
  provenanceNote?: string;
}) {
  return {
    id: input.id,
    run_id: null,
    source_code: "sec_edgar",
    source_group: "filings",
    source_unique_id: input.accession,
    source_url: input.indexUrl,
    title: `SEC ${input.form} ${input.accession}`,
    published_at: input.acceptedAt,
    fetched_at: input.fetchedAt,
    body_text: null,
    analysis_text: null,
    raw_payload: {
      accession_number: input.accession,
      cik: input.cik,
      form_type: input.form,
      filing_date: input.filedAt,
      accepted_at: input.acceptedAt,
      parser_version: "sec_edgar_raw_parser_v1",
      primary_document_url: input.sourceUrl,
      primary_document_html: input.source || null,
      primary_document_html_char_count: input.source ? input.source.length : 0,
      primary_document_html_truncated: false,
      verification_provenance_note: input.provenanceNote ?? "actual_raw_item_primary_document_shape",
    },
    metadata: { sentinel: "preserved" },
    dedupe_key: `sec_edgar:${input.accession}`,
  };
}

async function insertRawItem(client: PgClient, raw: Row) {
  await client.query(
    `insert into public.raw_items (
       id, run_id, source_code, source_group, source_unique_id, source_url, title,
       published_at, fetched_at, body_text, analysis_text, raw_payload, metadata, dedupe_key
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14)`,
    [raw.id, raw.run_id, raw.source_code, raw.source_group, raw.source_unique_id, raw.source_url,
      raw.title, raw.published_at, raw.fetched_at, raw.body_text, raw.analysis_text,
      json(raw.raw_payload), json(raw.metadata), raw.dedupe_key],
  );
}

async function updateRawItem(client: PgClient, raw: Row) {
  await client.query(
    "update public.raw_items set raw_payload=$2::jsonb, fetched_at=$3::timestamptz where id=$1::uuid",
    [raw.id, json(raw.raw_payload), raw.fetched_at],
  );
}

async function insertStructuredRawSource(client: PgClient, source: Row) {
  await client.query(
    `insert into public.sec_structured_raw_sources (
       id, source_kind, source_url, source_identity, cik, fetched_at, ingested_at,
       content_hash, source_schema_version, raw_content_kind, raw_content, payload
     ) values ($1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz,$8,$9,$10,$11,$12::jsonb)`,
    [source.id, source.source_kind, source.source_url, source.source_identity, source.cik,
      source.fetched_at, source.ingested_at, source.content_hash, source.source_schema_version,
      source.raw_content_kind, source.raw_content, json(source.payload)],
  );
}

async function insertSourceRun(client: PgClient, run: Row) {
  await client.query(
    `insert into public.source_runs (
       id, source_code, source_group, run_type, status, started_at, finished_at,
       stats, error_message, metadata
     ) values ($1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz,$8::jsonb,$9,$10::jsonb)`,
    [run.id, run.source_code, run.source_group, run.run_type, run.status, run.started_at,
      run.finished_at, json(run.stats), run.error_message, json(run.metadata)],
  );
}

async function runConcurrentRawPersistence(dbConnectionString: string, raw: Row, count: number): Promise<Row[]> {
  const clients = Array.from({ length: count }, () => new PgClient({ connectionString: dbConnectionString }));
  await Promise.all(clients.map((candidate) => candidate.connect()));
  try {
    return await Promise.all(clients.map((candidate) =>
      persistSecCoverObservationsForRawItem({
        rawItemId: raw.id,
        rawItem: raw,
        repository: createPostgresRepository(candidate),
      })
    ));
  } finally {
    await Promise.all(clients.map((candidate) => candidate.end()));
  }
}

async function assertActualGureRawIngestHookRollback(input: {
  client: PgClient;
  repository: ReturnType<typeof createPostgresRepository>;
  raw: Row;
  sourceRun: Row;
  runSecRawIngest: (...args: any[]) => Promise<any>;
}) {
  await input.client.query("begin");
  try {
    await input.client.query(
      `insert into public.sources (code, name, source_group, runtime_owner, enabled, metadata)
       values ('sec_edgar', 'SEC EDGAR', 'filings', 'external', true, '{}'::jsonb)`,
    );
    await insertSourceRun(input.client, input.sourceRun);
    const dependencies = {
      fetchRawItems: async () => ({
        ok: true,
        status: 200,
        items: [input.raw],
        diagnostics: { documentsRequested: 1, documentsFetched: 1, documentsFailed: 0 },
      }),
      ensureSource: async () => undefined,
      createSourceRun: async () => "running",
      findExistingRawItem: async () => {
        const result = await input.client.query(
          "select * from public.raw_items where source_code=$1 and source_unique_id=$2 limit 1",
          [input.raw.source_code, input.raw.source_unique_id],
        );
        return jsonRows(result.rows)[0] ?? null;
      },
      saveRawItem: async () => {
        await insertRawItem(input.client, input.raw);
        return { id: input.raw.id, title: input.raw.title };
      },
      finishSourceRun: async () => undefined,
      persistCoverObservations: (request: Row) =>
        persistSecCoverObservationsForRawItem({ ...request, repository: input.repository } as any),
      recordCoverState: (request: Row) =>
        recordSecCoverObservationPersistenceState({ ...request, repository: input.repository } as any),
    };
    const saved = await input.runSecRawIngest({ includeDocuments: true }, dependencies);
    assert.equal(saved.ok, true);
    assert.equal(saved.stats.raw_upserted_count, 1);
    assert.equal(saved.stats.sec_cover_observation_available_count, 1);
    const replayed = await input.runSecRawIngest({ includeDocuments: true }, dependencies);
    assert.equal(replayed.ok, true);
    assert.equal(replayed.stats.skipped_count, 1);
    assert.equal(replayed.stats.sec_cover_observation_replayed_count, 1);
    const read = await readSecCoverObservations({
      accessionNumber: String(input.raw.source_unique_id),
      repository: input.repository,
    });
    assert.equal(read.status, "available");
    if (read.status !== "available") throw new Error("actual GURE hook reader unavailable");
    const observation = read.results[0]!.payload.observations[0]!;
    assert.deepEqual([
      observation.securityTitle.rawLexicalValue,
      observation.tradingSymbol.rawLexicalValue,
      observation.exchange.rawLexicalValue,
    ], ["Common Stock, $0.0005 par value", "GURE", "NASDAQ"]);
    return {
      rawItemId: input.raw.id,
      rawSaveBranch: "executed",
      existingRawReplayBranch: "executed",
      reader: "available_exact_source_reparsed",
      transactionDisposition: "rolled_back_before_remaining_isolated_checks",
    };
  } finally {
    await input.client.query("rollback");
  }
}

async function assertRawIngestHookPaths(input: {
  client: PgClient;
  repository: ReturnType<typeof createPostgresRepository>;
  runSecRawIngest: (...args: any[]) => Promise<any>;
}) {
  const savedRaw = rawItem({
    id: "10000000-0000-4000-8000-000000000160",
    accession: "0001193805-26-001160",
    cik: "885462",
    form: "10-Q",
    filedAt: "2026-08-30",
    acceptedAt: "2026-08-30T20:45:51.000Z",
    fetchedAt: "2026-08-30T21:00:00.000Z",
    indexUrl: "https://www.sec.gov/Archives/edgar/data/885462/000119380526001160/0001193805-26-001160-index.htm",
    sourceUrl: null,
    source: "",
    provenanceNote: "synthetic_runSecRawIngest_hook_path",
  });
  const failedRaw = rawItem({
    id: "10000000-0000-4000-8000-000000000161",
    accession: "0001193805-26-001161",
    cik: "885462",
    form: "10-Q",
    filedAt: "2026-08-31",
    acceptedAt: "2026-08-31T20:45:51.000Z",
    fetchedAt: "2026-08-31T21:00:00.000Z",
    indexUrl: "https://www.sec.gov/Archives/edgar/data/885462/000119380526001161/0001193805-26-001161-index.htm",
    sourceUrl: null,
    source: "",
    provenanceNote: "synthetic_runSecRawIngest_failure_isolation",
  });
  for (const raw of [savedRaw, failedRaw]) {
    const payload = raw.raw_payload as Row;
    payload.ticker = "GURE";
    payload.exchange = "NASDAQ";
    payload.company_name = "Gulf Resources, Inc.";
  }

  const run = async (raw: Row, failCover: boolean) => input.runSecRawIngest(
    { includeDocuments: true },
    {
      fetchRawItems: async () => ({
        ok: true,
        status: 200,
        items: [raw],
        diagnostics: { documentsRequested: 0, documentsFetched: 0, documentsFailed: 0 },
      }),
      ensureSource: async () => undefined,
      createSourceRun: async () => "running",
      findExistingRawItem: async () => {
        const result = await input.client.query(
          "select * from public.raw_items where source_code=$1 and source_unique_id=$2 limit 1",
          [raw.source_code, raw.source_unique_id],
        );
        return jsonRows(result.rows)[0] ?? null;
      },
      saveRawItem: async () => {
        await insertRawItem(input.client, raw);
        return { id: raw.id, title: raw.title };
      },
      finishSourceRun: async () => undefined,
      persistCoverObservations: failCover
        ? async () => { throw new Error("injected isolated cover-sidecar failure"); }
        : (request: Row) => persistSecCoverObservationsForRawItem({ ...request, repository: input.repository } as any),
      recordCoverState: (request: Row) => recordSecCoverObservationPersistenceState({ ...request, repository: input.repository } as any),
    },
  );

  const saved = await run(savedRaw, false);
  assert.equal(saved.ok, true);
  assert.equal(saved.stats.raw_upserted_count, 1);
  assert.equal(saved.stats.sec_cover_observation_available_count, 1);
  assert.equal(saved.items[0].sec_cover_observation_persistence.status, "available");

  const replayed = await run(savedRaw, false);
  assert.equal(replayed.ok, true);
  assert.equal(replayed.stats.skipped_count, 1);
  assert.equal(replayed.stats.sec_cover_observation_replayed_count, 1);
  assert.equal(replayed.items[0].sec_cover_observation_persistence.writeStatus, "replayed");

  const isolatedFailure = await run(failedRaw, true);
  assert.equal(isolatedFailure.ok, true);
  assert.equal(isolatedFailure.stats.raw_upserted_count, 1);
  assert.equal(isolatedFailure.stats.failed_count, 0);
  assert.equal(isolatedFailure.stats.sec_cover_observation_failed_count, 1);
  assert.equal(isolatedFailure.items[0].ok, true);
  assert.equal(isolatedFailure.items[0].sec_cover_observation_persistence.status, "failed");
  const failedMetadata = (await input.client.query("select metadata from public.raw_items where id=$1", [failedRaw.id])).rows[0]!.metadata;
  assert.equal(failedMetadata.sec_cover_observation_persistence.status, "failed");

  return {
    rawSaveBranch: "executed",
    existingRawReplayBranch: "executed",
    sidecarFailureIsolation: "executed_raw_ingest_remained_ok",
  };
}

async function assertSharedArtifactCacheCompatibility(input: {
  client: PgClient;
  repository: ReturnType<typeof createPostgresRepository>;
  legacyPrimaryRow: Row;
  xbrlModule: typeof filingXbrl;
}) {
  const source = input.legacyPrimaryRow;
  const raw = rawItem({
    id: "10000000-0000-4000-8000-000000000103",
    accession: "0001193805-11-001703",
    cik: "885462",
    form: "10-Q/A",
    filedAt: "2011-09-02",
    acceptedAt: "2011-09-02T11:44:04.000Z",
    fetchedAt: String(source.fetched_at),
    indexUrl: "https://www.sec.gov/Archives/edgar/data/885462/000119380511001703/0001193805-11-001703-index.htm",
    sourceUrl: String(source.source_url),
    source: String(source.raw_content),
    provenanceNote: "actual_cached_non_inline_primary_document",
  });
  await input.client.query("begin");
  try {
    await insertRawItem(input.client, raw);
    await input.client.query("commit");
  } catch (error) {
    await input.client.query("rollback");
    throw error;
  }
  const observed = await persistSecCoverObservationsForRawItem({ rawItemId: raw.id, rawItem: raw, repository: input.repository });
  assert.equal(observed.status, "available");
  assert.equal(observed.sourceSha256, source.content_hash);
  const before = (await input.client.query("select * from public.sec_structured_raw_sources where id=$1", [source.id])).rows[0]!;
  assert.equal(before.payload.role, "primary_document");
  assert.equal(before.payload.document_name, "e608845_10qa-gulf.htm");
  const artifact = input.xbrlModule.createSecFilingDocumentArtifact({
    issuerCik: "0000885462",
    accession: "0001193805-11-001703",
    documentName: String(source.payload.document_name),
    sourceUrl: String(source.source_url),
    rawContent: String(source.raw_content),
    fetchedAt: String(source.fetched_at),
    contentType: String(source.payload.content_type),
  });
  assert.equal(artifact.id, source.id);
  const artifactRepository = new input.xbrlModule.PostgresSecFilingXbrlArtifactRepository(input.client as any);
  assert.deepEqual(await artifactRepository.ingestArtifacts([artifact]), { inserted: 0, deduped: 1 });
  const after = (await input.client.query("select * from public.sec_structured_raw_sources where id=$1", [source.id])).rows[0]!;
  assert.deepEqual(jsonRows([after]), jsonRows([before]));
  return {
    existingInlineArtifactThenObservation: "exact_role_and_payload_preserved",
    observationThenExistingNonInlineArtifact: "primary_document_deduped_without_role_change",
    primaryArtifactId: artifact.id,
  };
}

async function insertLegacyFilingLedger(client: PgClient, source: Row, filing: Row) {
  await client.query(
    `insert into public.sec_structured_raw_sources (
       id, source_kind, source_url, source_identity, cik, fetched_at, ingested_at,
       content_hash, source_schema_version, raw_content_kind, raw_content, payload
     ) values ($1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz,$8,$9,$10,$11,$12::jsonb)`,
    [
      source.id, source.source_kind, source.source_url, source.source_identity, source.cik,
      source.fetched_at, source.ingested_at, source.content_hash, source.source_schema_version,
      source.raw_content_kind, source.raw_content, json(source.payload),
    ],
  );
  await client.query("insert into public.sec_issuers (cik) values ($1) on conflict do nothing", [filing.issuer_cik]);
  await client.query(
    `insert into public.sec_filing_ledger (
       accession_number, issuer_cik, form, filed_date, accepted_at, report_date,
       primary_document, is_xbrl, is_inline_xbrl, source_raw_id, source_kind, ingested_at
     ) values ($1,$2,$3,$4::date,$5::timestamptz,$6::date,$7,$8,$9,$10::uuid,$11,$12::timestamptz)`,
    [filing.accession_number, filing.issuer_cik, filing.form, filing.filed_date, filing.accepted_at,
      filing.report_date, filing.primary_document, filing.is_xbrl, filing.is_inline_xbrl,
      filing.source_raw_id, filing.source_kind, filing.ingested_at],
  );
}

async function assertMigrationRollbackReapply(client: PgClient, migrationSql: string) {
  const before = {
    results: await scalar(client, "select count(*)::int from public.sec_cover_observation_results"),
    observations: await scalar(client, "select count(*)::int from public.sec_cover_security_observations"),
  };
  await client.query("begin");
  try {
    await client.query("drop function public.record_sec_cover_observation_persistence_state(uuid,jsonb)");
    await client.query("drop function public.persist_sec_cover_observation_result(uuid,jsonb,jsonb,jsonb)");
    await client.query("drop table public.sec_cover_security_observations");
    await client.query("drop table public.sec_cover_observation_results");
    await client.query("drop function public.reject_sec_cover_observation_mutation()");
    await client.query(migrationSql);
    assert.equal(await scalar(client, "select count(*)::int from public.sec_cover_observation_results"), 0);
    assert.equal(await scalar(client, "select count(*)::int from public.sec_cover_security_observations"), 0);
  } finally {
    await client.query("rollback");
  }
  assert.equal(await scalar(client, "select count(*)::int from public.sec_cover_observation_results"), before.results);
  assert.equal(await scalar(client, "select count(*)::int from public.sec_cover_security_observations"), before.observations);
}

async function assertDatabaseProtection(client: PgClient) {
  await assert.rejects(
    () => client.query("update public.sec_cover_observation_results set extraction_status=extraction_status"),
    (error: any) => error?.code === "55000",
  );
  await assert.rejects(
    () => client.query("delete from public.sec_cover_security_observations"),
    (error: any) => error?.code === "55000",
  );
  const rls = await client.query(
    `select relname, relrowsecurity from pg_catalog.pg_class
     where relname in ('sec_cover_observation_results','sec_cover_security_observations')
     order by relname`,
  );
  assert.deepEqual(rls.rows.map((row) => [row.relname, row.relrowsecurity]), [
    ["sec_cover_observation_results", true],
    ["sec_cover_security_observations", true],
  ]);
  const grants = await client.query(
    `select grantee, privilege_type from information_schema.role_table_grants
     where table_schema='public'
       and table_name in ('sec_cover_observation_results','sec_cover_security_observations')
       and grantee in ('anon','authenticated','service_role')
     order by grantee, privilege_type`,
  );
  assert.ok(grants.rows.length >= 4);
  assert.ok(grants.rows.every((row) => row.grantee === "service_role" && new Set(["INSERT", "SELECT"]).has(row.privilege_type)));
}

function summarizeRead(value: Awaited<ReturnType<typeof readSecCoverObservations>>) {
  if (value.status !== "available") return { status: value.status };
  return {
    status: value.status,
    revisions: value.results.length,
    extractionStatus: value.results[0]!.payload.extractionStatus,
    sourceSha256: value.results[0]!.payload.source.sha256,
    observations: value.results[0]!.payload.observations.map((row) => ({
      contextRef: row.contextRef,
      period: row.context.period,
      dimensions: row.context.dimensions,
      issuerCikRaw: row.issuerCikRaw,
      title: { status: row.securityTitle.status, raw: row.securityTitle.rawLexicalValue },
      symbol: { status: row.tradingSymbol.status, raw: row.tradingSymbol.rawLexicalValue },
      exchange: { status: row.exchange.status, raw: row.exchange.rawLexicalValue },
    })),
  };
}

async function scalar(client: PgClient, sql: string, values: unknown[] = []) {
  return Number((await client.query(sql, values)).rows[0]!.count);
}

function jsonRows(rows: Row[]) {
  return JSON.parse(JSON.stringify(rows));
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
