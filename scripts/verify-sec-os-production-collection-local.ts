import assert from "node:assert/strict";
// @ts-expect-error The project uses pg from JavaScript scripts without bundled declarations.
import { Client } from "pg";
import {
  InMemorySecFilingXbrlArtifactRepository,
  SecFilingXbrlContextService,
} from "../lib/sec-structured-data/filingXbrlContext.ts";
import {
  FiveIssuerAcceptanceFilingSource,
  FiveIssuerAcceptanceSourceClient,
  acceptanceAudits,
} from "../lib/sec-structured-data/osProductionCollectorAcceptanceFixture.ts";
import { SecOsProductionCollector } from "../lib/sec-structured-data/osProductionCollector.ts";
import { PostgresSecStructuredRepository } from "../lib/sec-structured-data/repository.ts";
import { SecStructuredDataService } from "../lib/sec-structured-data/service.ts";
import { PostgresShareCountHistoryRepository } from "../lib/sec-structured-data/shareCountHistory.ts";
import { PostgresIssuerCommonClassUniverseRepository } from "../lib/sec-structured-data/issuerCommonClassUniverse.ts";
import {
  assertHistoricalReplayMigrationPrerequisites,
  isHistoricalReplayMigrationPrecheckOnly,
} from "./historicalReplayMigrationGate.ts";

const connectionString = process.env.SUPABASE_LOCAL_DB_URL || "postgresql://postgres:postgres@127.0.0.1:56322/postgres";
const databaseUrl = new URL(connectionString);
if (!new Set(["127.0.0.1", "localhost", "::1"]).has(databaseUrl.hostname)) throw new Error("Refusing non-local database");

const client = new Client({ connectionString });
const audits = acceptanceAudits();
const ciks = audits.map((sample) => sample.cik);
const accessions = audits.map((sample) => sample.accession);
const executedAt = "2026-08-22T06:30:00.000Z";
let rolledBack = false;
let transactionStarted = false;
await client.connect();
try {
  const migrationGate = await assertHistoricalReplayMigrationPrerequisites(client);
  if (isHistoricalReplayMigrationPrecheckOnly(process.argv.slice(2))) {
    console.log(JSON.stringify({ ok: true, stage: "migration_prerequisites", ...migrationGate }, null, 2));
  } else {
  const baseline = await fixtureCounts(client, ciks);

  await client.query("begin");
  transactionStarted = true;
  await client.query("set local statement_timeout = '30s'");
  const transactionStartedAt = (await client.query(
    "select transaction_timestamp()::text as value",
  )).rows[0].value;
  const serialSql = createSerialSqlClient(client);
  const databaseStructuredRepository = new PostgresSecStructuredRepository(serialSql, "external");
  const structuredRepository = {
    async readFacts(filter: Parameters<typeof databaseStructuredRepository.readFacts>[0]) {
      const audit = audits.find((sample) => sample.cik === filter.cik)!;
      return (await databaseStructuredRepository.readFacts(filter)).filter((row) =>
        row.filingAccession === audit.accession
        && row.instantDate === audit.as_of);
    },
    async readFilings(
      cik: string,
      limit?: number,
      filter?: Parameters<typeof databaseStructuredRepository.readFilings>[2],
    ) {
      const audit = audits.find((sample) => sample.cik === cik)!;
      return (await databaseStructuredRepository.readFilings(cik, limit, filter)).filter((row) =>
        row.accessionNumber === audit.accession);
    },
  };
  const filingRepository = new InMemorySecFilingXbrlArtifactRepository();
  const historyRepository = new PostgresShareCountHistoryRepository(serialSql);
  const universeRepository = new PostgresIssuerCommonClassUniverseRepository(serialSql);
  const sourceClient = new FiveIssuerAcceptanceSourceClient();
  const filingSource = new FiveIssuerAcceptanceFilingSource();
  const collector = new SecOsProductionCollector({
    structuredService: new SecStructuredDataService(sourceClient, databaseStructuredRepository, () => new Date(executedAt)),
    structuredRepository,
    filingService: new SecFilingXbrlContextService(filingSource, filingRepository),
    filingRepository,
    historyRepository,
    universeRepository,
    now: () => new Date(executedAt),
  });

  const bootstrap = await collector.collectBatch({ ciks, mode: "bootstrap" });
  const saved = await client.query(
    `select issuer_cik, accession_number, filing_document, shares_outstanding::text,
             as_of::text, filed_date::text, accepted_at::text, ingested_at::text,
             accepted_at_source, canonical_security_class_id,
             canonical_security_class_kind, canonical_security_class_status,
             source_fact_key, source_context_ref, source_content_hash
       from public.share_count_history
      where issuer_cik = any($1::text[])
        and accession_number = any($2::text[])
        and ingested_at = $3::timestamptz
      order by issuer_cik, accession_number, source_fact_key`,
    [ciks, accessions, executedAt],
  );
  const auditedRows = saved.rows.filter((row: Record<string, unknown>) => audits.some((audit) =>
    audit.cik === row.issuer_cik
    && audit.accession === row.accession_number
    && audit.as_of === row.as_of));
  assert.equal(auditedRows.length, 5);
  assert.deepEqual(auditedRows.map((row: Record<string, unknown>) => [
    row.issuer_cik, row.accession_number, row.shares_outstanding, row.as_of,
  ]).sort((left: unknown[], right: unknown[]) => JSON.stringify(left).localeCompare(JSON.stringify(right))), [
    ["0000320193", "0000320193-26-000020", "14594180000", "2026-07-17"],
    ["0001022701", "0001144204-13-044345", "4984827279", "2013-08-02"],
    ["0001652044", "0001652044-26-000071", "5527000000", "2026-06-30"],
    ["0001652044", "0001652044-26-000071", "5868000000", "2026-06-30"],
    ["0001652044", "0001652044-26-000071", "835000000", "2026-06-30"],
  ].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))));
  assert.ok(auditedRows.every((row: Record<string, unknown>) =>
    row.accepted_at_source === "sec_filing_ledger"
    && row.canonical_security_class_kind === "common_stock"
    && row.canonical_security_class_status === "mapped"
    && String(row.canonical_security_class_id).startsWith(`sc:v1:${row.issuer_cik}:common_stock:`)));
  const snapshots = await client.query(
    `select issuer_cik, universe_as_of::text, source_accession, status, reason,
            required_canonical_security_class_ids
       from public.issuer_common_class_universe_snapshots
      where issuer_cik = any($1::text[])
        and source_accession = any($2::text[])
        and snapshot_version = 'issuer-common-class-universe-snapshot-v2'
        and created_at >= $3::timestamptz
      order by issuer_cik, universe_as_of, accepted_at, source_identity_hash`,
    [ciks, accessions, transactionStartedAt],
  );
  const auditedSnapshots = snapshots.rows.filter((row: Record<string, unknown>) => audits.some((audit) =>
    audit.cik === row.issuer_cik
    && audit.accession === row.source_accession
    && audit.as_of === row.universe_as_of));
  const snapshotOutcomes = [...new Map<string, Record<string, unknown>>(
    auditedSnapshots.map((row: Record<string, unknown>) => [
    [row.issuer_cik, row.status, row.reason].join("|"), row,
    ]),
  ).values()];
  assert.deepEqual(snapshotOutcomes.map((row: Record<string, unknown>) => [
    row.issuer_cik, row.status, row.reason,
  ]), [
    ["0000320193", "COMPLETE_SINGLE", "COMPLETE_SINGLE_COMMON_STOCK"],
    ["0001022701", "COMPLETE_SINGLE", "COMPLETE_SINGLE_COMMON_STOCK"],
    ["0001123799", "AMBIGUOUS", "ADS_OR_ORDINARY_AMBIGUOUS"],
    ["0001652044", "COMPLETE_MULTI", "COMPLETE_MULTI_COMMON_STOCK"],
    ["0001973239", "AMBIGUOUS", "ADS_OR_ORDINARY_AMBIGUOUS"],
  ]);
  const replay = await collector.collectBatch({ ciks, mode: "incremental" });
  assert.equal(replay.completedIssuers, 3);
  assert.equal(replay.partialIssuers, 0);
  assert.equal(replay.failedIssuers, 0);
  assert.equal(replay.baselineRequiredIssuers, 2);
  assert.equal(total(replay, "persistedObservations"), 0);
  assert.equal(total(replay, "eligibleObservations"), 0);
  assert.equal(total(replay, "duplicates"), 0);
  assert.equal(total(replay, "filingContextCacheHits"), 0);
  assert.equal(total(replay, "filingContextsFetched"), 0);
  assert.equal(total(replay, "universeSnapshotsInserted"), 0);
  assert.equal(total(replay, "universeSnapshotsEvaluated"), 0);
  assert.equal(total(replay, "universeSnapshotDuplicates"), 0);
  const replayRows = (await client.query(
    `select issuer_cik, accession_number, as_of::text
       from public.share_count_history
      where issuer_cik = any($1::text[])
        and accession_number = any($2::text[])
        and ingested_at = $3::timestamptz`,
    [ciks, accessions, executedAt],
  )).rows.filter((row: Record<string, unknown>) => audits.some((audit) =>
    audit.cik === row.issuer_cik
    && audit.accession === row.accession_number
    && audit.as_of === row.as_of));
  assert.equal(replayRows.length, 5);

  const acceptance = audits.map((audit) => {
    const result = bootstrap.issuers.find((issuer) => issuer.issuerCik === audit.cik)!;
    return {
      ticker: audit.ticker,
      cik: audit.cik,
      accession: audit.accession,
      issuerStatus: result.status,
      candidateCount: result.counts.osCandidatesFound,
      companyFactsRejections: result.companyFactsRejections,
      filingContext: result.filings.find((filing) => filing.accession === audit.accession),
      observations: result.observations.map((observation) => ({
        status: observation.status,
        reason: observation.reason,
        persistence: observation.persistence,
        storedIdentity: observation.storedIdentity,
      })),
      issues: result.issues.map((issue) => ({ reason: issue.reason, detail: issue.detail })),
    };
  });

  await client.query("rollback");
  rolledBack = true;
  const cleanup = await fixtureCounts(client, ciks);
  assert.deepEqual(cleanup, baseline);
  console.log(JSON.stringify({
    ok: true,
    migration: migrationGate.requiredMigration,
    latestMigration: migrationGate.latestMigration,
    baseline,
    bootstrapCounts: aggregateCounts(bootstrap),
    replayCounts: aggregateCounts(replay),
    acceptance,
    savedRows: auditedRows,
    universeSnapshots: snapshotOutcomes,
    filingFetchCalls: filingSource.callsByAccession(),
    cleanup,
    llmCalls: 0,
    publicSecCalls: 0,
  }, null, 2));
  }
} finally {
  if (transactionStarted && !rolledBack) await client.query("rollback").catch(() => undefined);
  await client.end();
}

async function fixtureCounts(sql: typeof client, fixtureCiks: string[]) {
  const result = await sql.query(
    `select
       (select count(*)::integer from public.sec_structured_raw_sources where cik = any($1::text[])) as raw_sources,
       (select count(*)::integer from public.sec_issuers where cik = any($1::text[])) as issuers,
       (select count(*)::integer from public.sec_issuer_source_observations where issuer_cik = any($1::text[])) as issuer_observations,
       (select count(*)::integer from public.sec_issuer_ticker_observations where issuer_cik = any($1::text[])) as ticker_observations,
       (select count(*)::integer from public.sec_filing_ledger where issuer_cik = any($1::text[])) as filings,
       (select count(*)::integer from public.sec_company_facts where issuer_cik = any($1::text[])) as company_facts,
       (select count(*)::integer from public.share_count_history where issuer_cik = any($1::text[])) as share_count_history,
       (select count(*)::integer from public.issuer_common_class_universe_snapshots where issuer_cik = any($1::text[])) as universe_snapshots`,
    [fixtureCiks],
  );
  return result.rows[0];
}

function total(
  result: Awaited<ReturnType<SecOsProductionCollector["collectBatch"]>>,
  key: keyof Awaited<ReturnType<SecOsProductionCollector["collectIssuer"]>>["counts"],
) {
  return result.issuers.reduce((sum, issuer) => sum + issuer.counts[key], 0);
}

function aggregateCounts(result: Awaited<ReturnType<SecOsProductionCollector["collectBatch"]>>) {
  const keys = Object.keys(result.issuers[0]!.counts) as Array<keyof typeof result.issuers[0]["counts"]>;
  return Object.fromEntries(keys.map((key) => [key, total(result, key)]));
}

function createSerialSqlClient(sqlClient: {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}) {
  let queue: Promise<void> = Promise.resolve();
  return {
    query<Row extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]) {
      const execution = queue.then(() => sqlClient.query(text, values));
      queue = execution.then(() => undefined, () => undefined);
      return execution as Promise<{ rows: Row[]; rowCount: number | null }>;
    },
  };
}
