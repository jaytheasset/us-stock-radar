import assert from "node:assert/strict";
import { Client } from "pg";
import {
  PostgresSecFilingXbrlArtifactRepository,
  SecFilingXbrlContextService,
} from "../lib/sec-structured-data/filingXbrlContext.ts";
import {
  PostgresIssuerCommonClassUniverseRepository,
  readIssuerCommonClassUniverseAt,
} from "../lib/sec-structured-data/issuerCommonClassUniverse.ts";
import { resolveClassShareCountAt } from "../lib/sec-structured-data/classShareCountResolver.ts";
import { resolveIssuerTotalCommonSharesAt } from "../lib/sec-structured-data/issuerTotalCommonSharesAggregator.ts";
import { SecOsProductionCollector } from "../lib/sec-structured-data/osProductionCollector.ts";
import { PostgresSecStructuredRepository } from "../lib/sec-structured-data/repository.ts";
import { PostgresShareCountHistoryRepository } from "../lib/sec-structured-data/shareCountHistory.ts";
import type { StockSplitExecutionReadInput } from "../lib/sec-structured-data/stockSplitShareBasisNormalizer.ts";
import type { SecIssuerIngestResult, SecRefreshMode } from "../lib/sec-structured-data/types.ts";
import {
  assertHistoricalReplayMigrationPrerequisites,
  isHistoricalReplayMigrationPrecheckOnly,
} from "./historicalReplayMigrationGate.ts";

const CIK = "0001652044";
const EXPECTED_CANDIDATES = 26;
const EXPECTED_CLASS_OBSERVATIONS = 78;
const EXPECTED_TIMEPOINTS = [
  {
    asOf: "2026-03-31",
    accession: "0001652044-26-000048",
    total: "12116000000",
    acceptedAt: "2026-04-30T01:02:11.000Z",
  },
  {
    asOf: "2026-06-30",
    accession: "0001652044-26-000071",
    total: "12230000000",
    acceptedAt: "2026-07-23T01:15:54.000Z",
  },
] as const;

const connectionString = process.env.SUPABASE_LOCAL_DB_URL
  || "postgresql://postgres:postgres@127.0.0.1:56322/postgres";
const databaseUrl = new URL(connectionString);
if (!new Set(["127.0.0.1", "localhost", "::1"]).has(databaseUrl.hostname)) {
  throw new Error("Refusing non-local database");
}

const client = new Client({ connectionString });
let secFilingRequests = 0;
let splitReaderCalls = 0;
await client.connect();
try {
  const migrationGate = await assertHistoricalReplayMigrationPrerequisites(client);

  if (isHistoricalReplayMigrationPrecheckOnly(process.argv.slice(2))) {
    console.log(JSON.stringify({ ok: true, stage: "migration_prerequisites", ...migrationGate }, null, 2));
  } else {
  const sql = createSerialSqlClient(client);
  const structuredRepository = new PostgresSecStructuredRepository(sql, "external");
  const filingRepository = new PostgresSecFilingXbrlArtifactRepository(sql);
  const historyRepository = new PostgresShareCountHistoryRepository(sql);
  const universeRepository = new PostgresIssuerCommonClassUniverseRepository(sql);
  const baseline = await liveCounts();
  assert.ok(
    baseline.history === 0 || baseline.history === EXPECTED_CLASS_OBSERVATIONS,
    `unexpected partial GOOG history baseline: ${baseline.history}`,
  );
  assert.ok(
    baseline.v2Snapshots === 0 || baseline.v2Snapshots === EXPECTED_CANDIDATES,
    `unexpected partial GOOG V2 universe baseline: ${baseline.v2Snapshots}`,
  );

  const collector = new SecOsProductionCollector({
    structuredService: {
      async ingestIssuer(input: { cik: string; mode: SecRefreshMode }) {
        assert.equal(input.cik, CIK);
        return cachedStructuredIngest(input.cik, input.mode);
      },
    },
    structuredRepository,
    filingService: new SecFilingXbrlContextService({
      async fetchFilingArtifacts() {
        secFilingRequests += 1;
        throw new Error("cached GOOG filing XBRL was incomplete; public SEC request blocked by validation");
      },
    }, filingRepository),
    filingRepository,
    historyRepository,
    universeRepository,
    now: () => new Date("2026-08-23T00:00:00.000Z"),
  });

  const bootstrap = await collector.collectIssuer({ cik: CIK, mode: "bootstrap" });
  assert.equal(bootstrap.status, "COMPLETED");
  assert.equal(bootstrap.counts.osCandidatesFound, EXPECTED_CANDIDATES);
  assert.equal(bootstrap.counts.filingContextsRequired, EXPECTED_CANDIDATES / 2);
  assert.equal(bootstrap.counts.filingContextCacheHits, EXPECTED_CANDIDATES / 2);
  assert.equal(bootstrap.counts.filingContextsFetched, 0);
  assert.equal(bootstrap.counts.universeSnapshotsEvaluated, EXPECTED_CANDIDATES);
  assert.equal(bootstrap.counts.universeSnapshotsIncomplete, 0);
  assert.equal(bootstrap.counts.universeSnapshotsAmbiguous, 0);
  assert.equal(bootstrap.counts.eligibleObservations, EXPECTED_CLASS_OBSERVATIONS);
  assert.equal(
    bootstrap.counts.persistedObservations,
    baseline.history === 0 ? EXPECTED_CLASS_OBSERVATIONS : 0,
  );
  assert.equal(
    bootstrap.counts.universeSnapshotsInserted,
    baseline.v2Snapshots === 0 ? EXPECTED_CANDIDATES : 0,
  );
  assert.equal(secFilingRequests, 0);

  const replay = await collector.collectIssuer({ cik: CIK, mode: "incremental" });
  assert.equal(replay.status, "COMPLETED");
  assert.equal(replay.counts.osCandidatesFound, 0);
  assert.equal(replay.counts.persistedObservations, 0);
  assert.equal(replay.counts.duplicates, 0);
  assert.equal(replay.counts.universeSnapshotsEvaluated, 0);
  assert.equal(replay.counts.universeSnapshotsInserted, 0);
  assert.equal(replay.counts.universeSnapshotDuplicates, 0);
  assert.equal(replay.counts.filingContextsFetched, 0);
  assert.equal(replay.counts.filingContextCacheHits, 0);
  assert.equal(secFilingRequests, 0);

  const timepoints = [];
  let wrongConfidentIssuerTotals = 0;
  for (const expected of EXPECTED_TIMEPOINTS) {
    const targetAt = new Date(Date.parse(expected.acceptedAt) + 1_000).toISOString();
    const universe = await readIssuerCommonClassUniverseAt({
      repository: universeRepository,
      shareCountHistoryRepository: historyRepository,
      cik: CIK,
      targetAt,
    });
    assert.equal(universe.status, "AVAILABLE");
    if (universe.status !== "AVAILABLE") throw new Error("unreachable unavailable universe");
    assert.equal(universe.selectedSnapshot.snapshotVersion, "issuer-common-class-universe-snapshot-v2");
    assert.equal(universe.selectedSnapshot.status, "COMPLETE_MULTI");
    assert.equal(universe.universeAsOf, expected.asOf);
    assert.equal(universe.sourceAccession, expected.accession);
    assert.equal(universe.requiredCanonicalSecurityClassIds.length, 3);

    const classes = [];
    for (const evidence of universe.selectedSnapshot.classEvidence) {
      const sourceFact = evidence.sourceFacts[0]!;
      const dimension = sourceFact.dimensions[0];
      assert.equal(dimension?.kind, "explicit");
      if (!dimension || dimension.kind !== "explicit") throw new Error("class dimension missing");
      const resolution = await resolveClassShareCountAt({
        repository: historyRepository,
        cik: CIK,
        securityClassId: evidence.canonicalSecurityClassId,
        targetAt,
      });
      assert.equal(resolution.status, "RESOLVED");
      if (resolution.status !== "RESOLVED") throw new Error("class resolution unavailable");
      assert.equal(resolution.sharesOutstanding, evidence.sharesOutstanding);
      classes.push({
        canonicalSecurityClassId: evidence.canonicalSecurityClassId,
        sharesOutstanding: resolution.sharesOutstanding,
        sourceConcept: sourceFact.concept,
        contextRef: sourceFact.contextRef,
        axis: dimension.axis,
        member: dimension.member,
        factKey: sourceFact.factKey,
      });
    }

    const issuerTotal = await resolveIssuerTotalCommonSharesAt({
      universeRepository,
      repository: historyRepository,
      cik: CIK,
      targetAt,
    }, { readExecutions: noRecordedStockSplitExecutions });
    if (issuerTotal.status === "RESOLVED"
      && issuerTotal.totalCommonShares.integerShares !== expected.total) {
      wrongConfidentIssuerTotals += 1;
    }
    assert.equal(issuerTotal.status, "RESOLVED");
    assert.equal(issuerTotal.totalCommonShares?.integerShares, expected.total);
    assert.equal(issuerTotal.classComponents.length, 3);
    assert.ok(issuerTotal.classComponents.every((component) => component.status === "RESOLVED"));

    const aggregate = universe.selectedSnapshot.aggregateEvidence[0]!;
    assert.equal(aggregate.sharesOutstanding, expected.total);
    timepoints.push({
      accession: universe.sourceAccession,
      osAsOf: universe.universeAsOf,
      acceptedAt: universe.acceptedAt,
      filingDocuments: universe.selectedSnapshot.sourceDocuments,
      universeStatus: universe.selectedSnapshot.status,
      universeReason: universe.selectedSnapshot.reason,
      aggregate: {
        sharesOutstanding: aggregate.sharesOutstanding,
        sourceConcept: aggregate.concept,
        contextRef: aggregate.contextRef,
        factKey: aggregate.factKey,
        role: "corroboration_only",
      },
      classes,
      issuerTotal: issuerTotal.totalCommonShares.integerShares,
      issuerTotalStatus: issuerTotal.status,
    });
  }

  const beforeLatestAcceptance = await readIssuerCommonClassUniverseAt({
    repository: universeRepository,
    shareCountHistoryRepository: historyRepository,
    cik: CIK,
    targetAt: new Date(Date.parse(EXPECTED_TIMEPOINTS[1].acceptedAt) - 1).toISOString(),
  });
  assert.equal(beforeLatestAcceptance.status, "AVAILABLE");
  if (beforeLatestAcceptance.status !== "AVAILABLE") throw new Error("no-lookahead reader unavailable");
  assert.equal(beforeLatestAcceptance.sourceAccession, EXPECTED_TIMEPOINTS[0].accession);
  assert.equal(wrongConfidentIssuerTotals, 0);

  const final = await liveCounts();
  assert.equal(final.history, EXPECTED_CLASS_OBSERVATIONS);
  assert.equal(final.v2Snapshots, EXPECTED_CANDIDATES);
  assert.equal(final.v1Snapshots, EXPECTED_CANDIDATES);

  console.log(JSON.stringify({
    ok: true,
    migration: migrationGate.requiredMigration,
    latestMigration: migrationGate.latestMigration,
    source: "existing local GOOG CompanyFacts, filing ledger, and complete filing-XBRL cache",
    baseline,
    bootstrapCounts: bootstrap.counts,
    replayCounts: replay.counts,
    final,
    timepoints,
    noLookahead: {
      targetAt: new Date(Date.parse(EXPECTED_TIMEPOINTS[1].acceptedAt) - 1).toISOString(),
      selectedAccession: beforeLatestAcceptance.sourceAccession,
      selectedAsOf: beforeLatestAcceptance.universeAsOf,
    },
    secRequests: {
      structuredApi: 0,
      filingArchive: secFilingRequests,
      total: secFilingRequests,
    },
    splitReaderCalls,
    replayHistoryInserts: replay.counts.persistedObservations,
    wrongConfidentIssuerTotals,
    llmCalls: 0,
  }, null, 2));
  }
} finally {
  await client.end();
}

async function liveCounts() {
  const result = await client.query(
    `select
       (select count(*)::integer from public.share_count_history
         where issuer_cik = $1
           and authoritative_decision_version = 'authoritative-multi-class-os-extraction-v1') as history,
       (select count(*)::integer from public.issuer_common_class_universe_snapshots
         where issuer_cik = $1
           and snapshot_version = 'issuer-common-class-universe-snapshot-v1') as v1_snapshots,
       (select count(*)::integer from public.issuer_common_class_universe_snapshots
         where issuer_cik = $1
           and snapshot_version = 'issuer-common-class-universe-snapshot-v2') as v2_snapshots`,
    [CIK],
  );
  return {
    history: Number(result.rows[0]?.history ?? 0),
    v1Snapshots: Number(result.rows[0]?.v1_snapshots ?? 0),
    v2Snapshots: Number(result.rows[0]?.v2_snapshots ?? 0),
  };
}

function cachedStructuredIngest(cik: string, mode: SecRefreshMode): SecIssuerIngestResult {
  return {
    cik,
    mode,
    inserted: 0,
    updated: 0,
    deduped: 0,
    rawSourcesInserted: 0,
    issuersInserted: 0,
    issuerObservationsInserted: 0,
    tickerObservationsInserted: 0,
    filingsInserted: 0,
    filingsUpdated: 0,
    factsInserted: 0,
    insertedRawSourceIds: [],
    sourceUpdates: {
      submissions: { fetched: 0, updated: 0, unchanged: 1 },
      companyFacts: { fetched: 0, updated: 0, unchanged: 1 },
    },
    rejected: 0,
    rejectionReasons: {},
    sourceDocuments: 2,
    normalizedFacts: 0,
  };
}

async function noRecordedStockSplitExecutions(input: StockSplitExecutionReadInput) {
  splitReaderCalls += 1;
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
