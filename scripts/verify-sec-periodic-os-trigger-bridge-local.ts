import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import nextEnv from "@next/env";
// @ts-expect-error The project uses pg without a separate declaration package.
import pg from "pg";
import {
  PostgresIssuerCommonClassUniverseRepository,
} from "../lib/sec-structured-data/issuerCommonClassUniverse.ts";
import { resolveIssuerTotalCommonSharesAt } from "../lib/sec-structured-data/issuerTotalCommonSharesAggregator.ts";
import { PostgresShareCountHistoryRepository } from "../lib/sec-structured-data/shareCountHistory.ts";
import type { StockSplitExecutionReadInput } from "../lib/sec-structured-data/stockSplitShareBasisNormalizer.ts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return {
        shortCircuit: true,
        url: "data:text/javascript,export%20%7B%7D;",
      };
    }
    return nextResolve(specifier, context);
  },
});

const { Client } = pg;
const {
  extractPeriodicOsIssuerCiks,
  runSecPeriodicOsTriggerBridge,
} = await import("../lib/secPeriodicOsTriggerBridge.ts");

nextEnv.loadEnvConfig(
  process.env.STOCK_RADAR_ENV_DIR ?? process.cwd(),
  true,
  { info() {}, error() {} },
);

const CIK = "0001840317";
const ACCESSION = "0001213900-26-087946";
const EXPECTED_OS = "62214156";
const TARGET_AT = "2026-08-14T00:00:00.000Z";
const isolated = process.argv.includes("--isolated");
const shared = process.argv.includes("--shared");
assert.notEqual(isolated, shared, "choose exactly one of --isolated or --shared");

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) throw new Error("SUPABASE_DB_URL is required");
const userAgent = process.env.SEC_USER_AGENT;
if (!userAgent) throw new Error("SEC_USER_AGENT is required");
const databaseUrl = new URL(connectionString);
assert.ok(new Set(["127.0.0.1", "localhost", "::1"]).has(databaseUrl.hostname));
assert.equal(databaseUrl.port, "56322");
assert.equal(
  databaseUrl.pathname,
  isolated ? "/periodic_os_bridge_isolated_2aaf" : "/postgres",
);

const ciks = extractPeriodicOsIssuerCiks([{
  ok: true,
  raw_item_id: `verification:${ACCESSION}`,
  source_unique_id: ACCESSION,
  form_type: "10-Q",
  cik: CIK,
}]);
assert.deepEqual(ciks, [CIK]);

const client = new Client({ connectionString });
const repositoryClient = new Client({ connectionString });
await Promise.all([client.connect(), repositoryClient.connect()]);
try {
  const sql = createSerialSqlClient(repositoryClient);
  const historyRepository = new PostgresShareCountHistoryRepository(sql);
  const universeRepository = new PostgresIssuerCommonClassUniverseRepository(sql);
  const baseline = await counts(client);
  const resolverBefore = await resolverSummary({
    historyRepository,
    universeRepository,
  });

  const first = await runSecPeriodicOsTriggerBridge({
    ciks,
    environment: {
      SUPABASE_DB_URL: connectionString,
      SEC_USER_AGENT: userAgent,
    },
  });
  assert.equal(first.requestedCiks.length, 1);
  assert.equal(first.requestedCiks[0], CIK);
  assert.equal(first.issuerResults.length, 1);
  assert.equal(first.failures.length, 0);
  assert.notEqual(first.issuerResults[0]?.status, "FAILED");

  const filing = (await client.query(
    `select accession_number, form, primary_document
       from public.sec_filing_ledger
      where issuer_cik = $1 and accession_number = $2`,
    [CIK, ACCESSION],
  )).rows;
  const afterFirst = await counts(client);
  const resolverAfterFirst = await resolverSummary({
    historyRepository,
    universeRepository,
  });
  if (isolated) {
    assert.equal(first.issuerResults[0]?.status, "BASELINE_REQUIRED");
    assert.equal(first.issuerResults[0]?.incrementalBaseline?.status, "BASELINE_REQUIRED");
    assert.deepEqual(afterFirst, baseline);
    assert.deepEqual(resolverAfterFirst, resolverBefore);
    assert.equal(first.issuerResults[0]?.counts.persistedObservations, 0);
    assert.equal(first.issuerResults[0]?.counts.universeSnapshotsInserted, 0);
  } else {
    assert.equal(filing.length, 1);
    assert.equal(filing[0]?.form, "10-Q");
    assert.equal(filing[0]?.primary_document, "ea0301195-10q_veea.htm");
    assert.deepEqual(resolverAfterFirst, {
      status: "RESOLVED",
      totalCommonShares: EXPECTED_OS,
      sourceAccession: ACCESSION,
      universeAsOf: "2026-08-10",
    });
    assert.deepEqual(afterFirst, baseline);
    assert.deepEqual(resolverAfterFirst, resolverBefore);
    assert.equal(first.issuerResults[0]?.counts.persistedObservations, 0);
    assert.equal(first.issuerResults[0]?.counts.universeSnapshotsInserted, 0);
    assert.equal(first.issuerResults[0]?.counts.duplicates, 0);
    assert.equal(first.issuerResults[0]?.counts.universeSnapshotDuplicates, 0);
  }

  const replay = isolated
    ? await runSecPeriodicOsTriggerBridge({
        ciks,
        environment: {
          SUPABASE_DB_URL: connectionString,
          SEC_USER_AGENT: userAgent,
        },
      })
    : first;
  const final = await counts(client);
  const resolverFinal = await resolverSummary({
    historyRepository,
    universeRepository,
  });
  assert.deepEqual(final, afterFirst);
  assert.deepEqual(resolverFinal, resolverAfterFirst);
  assert.equal(replay.issuerResults[0]?.counts.persistedObservations, 0);
  assert.equal(replay.issuerResults[0]?.counts.universeSnapshotsInserted, 0);
  assert.equal(replay.issuerResults[0]?.counts.duplicates, 0);
  assert.equal(replay.issuerResults[0]?.counts.universeSnapshotDuplicates, 0);

  const nonAuthoritative = (await client.query(
    `select count(*)::integer as count
       from public.share_count_history
      where issuer_cik = $1 and source_type <> 'sec_authoritative_os'`,
    [CIK],
  )).rows[0]?.count;
  if (isolated) assert.equal(Number(nonAuthoritative), 0);

  console.log(JSON.stringify({
    ok: true,
    environment: isolated
      ? "isolated_database_periodic_os_bridge_isolated_2aaf"
      : "shared_local_56322",
    filing: filing[0],
    bridgeRequestedCiks: first.requestedCiks,
    first: summarizeBridge(first),
    replay: summarizeBridge(replay),
    baseline,
    afterFirst,
    final,
    resolverBefore,
    resolverAfterFirst,
    resolverFinal,
    productHistoryWriteSource: "sec_authoritative_os",
    otherTickersProcessed: 0,
    backfillCatchupCron: 0,
  }, null, 2));
} finally {
  await Promise.all([client.end(), repositoryClient.end()]);
}

async function counts(sqlClient: InstanceType<typeof Client>) {
  const row = (await sqlClient.query(
    `select
       (select count(*)::integer from public.share_count_history
         where issuer_cik = $1 and source_type = 'sec_authoritative_os') as authoritative_history,
       (select count(*)::integer from public.issuer_common_class_universe_snapshots
         where issuer_cik = $1) as class_snapshots`,
    [CIK],
  )).rows[0];
  return {
    authoritativeHistory: Number(row?.authoritative_history ?? 0),
    classSnapshots: Number(row?.class_snapshots ?? 0),
  };
}

async function resolverSummary(input: {
  historyRepository: PostgresShareCountHistoryRepository;
  universeRepository: PostgresIssuerCommonClassUniverseRepository;
}) {
  const result = await resolveIssuerTotalCommonSharesAt({
    universeRepository: input.universeRepository,
    repository: input.historyRepository,
    cik: CIK,
    targetAt: TARGET_AT,
  }, { readExecutions: noRecordedStockSplitExecutions });
  return {
    status: result.status,
    totalCommonShares: result.totalCommonShares?.integerShares ?? null,
    sourceAccession: result.universeSnapshotIdentity?.sourceAccession ?? null,
    universeAsOf: result.universeAsOf,
  };
}

async function noRecordedStockSplitExecutions(input: StockSplitExecutionReadInput) {
  return {
    status: "available" as const,
    issuerCik: input.cik,
    canonicalSecurityClassId: input.canonicalSecurityClassId ?? null,
    from: input.from,
    to: input.to,
    targetAt: input.targetAt,
    basisChangeCoverage: input.actionKind === "forward_split"
      ? "forward_split_only" as const
      : "reverse_split_only" as const,
    executions: [],
    inactiveExecutions: [],
    conflicts: [],
  };
}

function summarizeBridge(result: Awaited<ReturnType<typeof runSecPeriodicOsTriggerBridge>>) {
  return {
    status: result.status,
    mode: result.mode,
    requestedCiks: result.requestedCiks,
    issuerStatus: result.issuerResults[0]?.status ?? null,
    counts: result.issuerResults[0]?.counts ?? null,
    failures: result.failures,
  };
}

function createSerialSqlClient(sqlClient: InstanceType<typeof Client>) {
  let queue: Promise<void> = Promise.resolve();
  return {
    query<Row extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      values?: unknown[],
    ) {
      const execution = queue.then(() => sqlClient.query(text, values));
      queue = execution.then(() => undefined, () => undefined);
      return execution as Promise<{ rows: Row[]; rowCount: number | null }>;
    },
  };
}
