import assert from "node:assert/strict";
// @ts-expect-error The project uses pg from JavaScript scripts without bundled declarations.
import { Client } from "pg";
import {
  PostgresSecFilingXbrlArtifactRepository,
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

const connectionString = process.env.SUPABASE_LOCAL_DB_URL || "postgresql://postgres:postgres@127.0.0.1:56322/postgres";
const databaseUrl = new URL(connectionString);
if (!new Set(["127.0.0.1", "localhost", "::1"]).has(databaseUrl.hostname)) throw new Error("Refusing non-local database");

const client = new Client({ connectionString });
const audits = acceptanceAudits();
const ciks = audits.map((sample) => sample.cik);
const executedAt = "2026-08-22T06:30:00.000Z";
let rolledBack = false;
await client.connect();
try {
  const migration = await client.query(
    "select version from supabase_migrations.schema_migrations order by version desc limit 1",
  );
  assert.equal(migration.rows[0]?.version, "20260821184556");
  assert.deepEqual(await fixtureCounts(client, ciks), emptyFixtureCounts());

  await client.query("begin");
  await client.query("set local statement_timeout = '30s'");
  const serialSql = createSerialSqlClient(client);
  const structuredRepository = new PostgresSecStructuredRepository(serialSql, "external");
  const filingRepository = new PostgresSecFilingXbrlArtifactRepository(serialSql);
  const historyRepository = new PostgresShareCountHistoryRepository(serialSql);
  const sourceClient = new FiveIssuerAcceptanceSourceClient();
  const filingSource = new FiveIssuerAcceptanceFilingSource();
  const collector = new SecOsProductionCollector({
    structuredService: new SecStructuredDataService(sourceClient, structuredRepository, () => new Date(executedAt)),
    structuredRepository,
    filingService: new SecFilingXbrlContextService(filingSource, filingRepository),
    filingRepository,
    historyRepository,
    now: () => new Date(executedAt),
  });

  const bootstrap = await collector.collectBatch({ ciks, mode: "bootstrap" });
  const saved = await client.query(
    `select issuer_cik, accession_number, filing_document, shares_outstanding::text,
            as_of::text, filed_date::text, accepted_at::text, ingested_at::text,
            source_fact_key, source_context_ref, source_content_hash
       from public.share_count_history
      where issuer_cik = any($1::text[])
      order by issuer_cik, accession_number, source_fact_key`,
    [ciks],
  );
  assert.equal(saved.rows.length, 2);
  assert.deepEqual(saved.rows.map((row: Record<string, unknown>) => [
    row.issuer_cik, row.accession_number, row.shares_outstanding, row.as_of,
  ]), [
    ["0000320193", "0000320193-26-000020", "14594180000", "2026-07-17"],
    ["0001022701", "0001144204-13-044345", "4984827279", "2013-08-02"],
  ]);
  const replay = await collector.collectBatch({ ciks, mode: "incremental" });
  assert.equal(total(replay, "persistedObservations"), 0);
  assert.equal(total(replay, "duplicates"), 2);
  assert.equal(total(replay, "filingContextCacheHits"), 4);
  assert.equal(total(replay, "filingContextsFetched"), 1);
  assert.equal((await client.query(
    "select count(*)::integer as count from public.share_count_history where issuer_cik = any($1::text[])",
    [ciks],
  )).rows[0].count, 2);

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
  assert.deepEqual(cleanup, emptyFixtureCounts());
  console.log(JSON.stringify({
    ok: true,
    migration: migration.rows[0].version,
    bootstrapCounts: aggregateCounts(bootstrap),
    replayCounts: aggregateCounts(replay),
    acceptance,
    savedRows: saved.rows,
    filingFetchCalls: filingSource.callsByAccession(),
    cleanup,
    llmCalls: 0,
    publicSecCalls: 0,
  }, null, 2));
} finally {
  if (!rolledBack) await client.query("rollback").catch(() => undefined);
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
       (select count(*)::integer from public.share_count_history where issuer_cik = any($1::text[])) as share_count_history`,
    [fixtureCiks],
  );
  return result.rows[0];
}

function emptyFixtureCounts() {
  return {
    raw_sources: 0,
    issuers: 0,
    issuer_observations: 0,
    ticker_observations: 0,
    filings: 0,
    company_facts: 0,
    share_count_history: 0,
  };
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
