import assert from "node:assert/strict";
import test from "node:test";
import { InMemorySecFilingXbrlArtifactRepository, SecFilingXbrlContextService } from "./filingXbrlContext.ts";
import {
  FiveIssuerAcceptanceFilingSource,
  FiveIssuerAcceptanceSourceClient,
  acceptanceAudit,
  acceptanceAudits,
} from "./osProductionCollectorAcceptanceFixture.ts";
import { SecOsProductionCollector } from "./osProductionCollector.ts";
import { SecStructuredDataService } from "./service.ts";
import { InMemoryShareCountHistoryRepository } from "./shareCountHistory.ts";
import {
  InMemoryIssuerCommonClassUniverseRepository,
  readIssuerCommonClassUniverseAt,
} from "./issuerCommonClassUniverse.ts";
import type {
  SecCompanyFactRow,
  SecFactReadFilter,
  SecFilingRow,
  SecNormalizedBatch,
  SecRepositoryWriteCounts,
  SecStructuredRepository,
  SecTickerObservationRow,
} from "./types.ts";

const EXECUTED_AT = "2026-08-22T06:30:00.000Z";

test("five-issuer bootstrap, incremental replay, IXDS cache, authoritative extraction, and history persistence compose end to end", async () => {
  const harness = createHarness();
  const ciks = acceptanceAudits().map((sample) => sample.cik);
  const first = await harness.collector.collectBatch({ ciks, mode: "bootstrap" });
  assert.deepEqual(
    { completed: first.completedIssuers, partial: first.partialIssuers, failed: first.failedIssuers },
    { completed: 4, partial: 1, failed: 0 },
  );
  assert.equal(sum(first.issuers, "submissionsFetched"), 5);
  assert.equal(sum(first.issuers, "submissionsUpdated"), 5);
  assert.equal(sum(first.issuers, "companyFactsFetched"), 5);
  assert.equal(sum(first.issuers, "companyFactsUpdated"), 5);
  assert.equal(sum(first.issuers, "osCandidatesFound"), 6);
  assert.equal(sum(first.issuers, "filingContextsRequired"), 5);
  assert.equal(sum(first.issuers, "filingContextsFetched"), 5);
  assert.equal(sum(first.issuers, "filingContextCacheHits"), 0);
  assert.equal(sum(first.issuers, "eligibleObservations"), 2);
  assert.equal(sum(first.issuers, "persistedObservations"), 2);
  assert.equal(sum(first.issuers, "duplicates"), 0);
  assert.equal(sum(first.issuers, "universeSnapshotsEvaluated"), 6);
  assert.equal(sum(first.issuers, "universeSnapshotsInserted"), 5);
  assert.equal(sum(first.issuers, "universeSnapshotDuplicates"), 1);
  assert.equal(sum(first.issuers, "universeSnapshotsIncomplete"), 1);
  assert.equal(sum(first.issuers, "universeSnapshotsAmbiguous"), 3);

  const aapl = issuer(first.issuers, "AAPL");
  const neom = issuer(first.issuers, "NEOM");
  const goog = issuer(first.issuers, "GOOG");
  const wit = issuer(first.issuers, "WIT");
  const arm = issuer(first.issuers, "ARM");
  assert.equal(aapl.observations.some((row) => row.status === "ELIGIBLE" && row.persistence === "inserted"), true);
  assert.equal(neom.observations.some((row) => row.status === "ELIGIBLE" && row.persistence === "inserted"), true);
  assert.equal(goog.observations.every((row) => row.status === "REQUIRES_FURTHER_CONTEXT"), true);
  assert.equal(wit.observations.every((row) => row.status === "REQUIRES_FURTHER_CONTEXT"), true);
  assert.equal(arm.status, "PARTIAL");
  assert.equal(arm.reasonCounts.INCOMPLETE_IXDS, 1);
  assert.equal(arm.observations.every((row) => row.status === "UNAVAILABLE"), true);

  assert.deepEqual(await universeStatuses(harness, "AAPL"), ["COMPLETE_SINGLE"]);
  assert.deepEqual(await universeStatuses(harness, "NEOM"), ["COMPLETE_SINGLE"]);
  assert.deepEqual(await universeStatuses(harness, "GOOG"), ["INCOMPLETE"]);
  assert.deepEqual(await universeStatuses(harness, "WIT"), ["AMBIGUOUS"]);
  assert.deepEqual(await universeStatuses(harness, "ARM"), ["AMBIGUOUS"]);

  const aaplHistory = await harness.historyRepository.readHistory(acceptanceAudit("AAPL").cik);
  const neomHistory = await harness.historyRepository.readHistory(acceptanceAudit("NEOM").cik);
  assert.equal(aaplHistory.length, 1);
  assert.equal(neomHistory.length, 1);
  assert.deepEqual({
    issuerCik: aaplHistory[0]!.issuerCik,
    accession: aaplHistory[0]!.accessionNumber,
    sharesOutstanding: aaplHistory[0]!.sharesOutstanding,
    asOf: aaplHistory[0]!.asOf,
    filedDate: aaplHistory[0]!.filedDate,
    acceptedAt: aaplHistory[0]!.acceptedAt,
    ingestedAt: aaplHistory[0]!.ingestedAt,
    sourceContextRef: aaplHistory[0]!.sourceContextRef,
  }, {
    issuerCik: "0000320193",
    accession: "0000320193-26-000020",
    sharesOutstanding: "14594180000",
    asOf: "2026-07-17",
    filedDate: "2026-07-31",
    acceptedAt: "2026-07-31T10:01:02.000Z",
    ingestedAt: EXECUTED_AT,
    sourceContextRef: "c-9",
  });
  assert.notEqual(aaplHistory[0]!.asOf, aaplHistory[0]!.ingestedAt.slice(0, 10));
  const aaplUniverse = await readIssuerCommonClassUniverseAt({
    repository: harness.universeRepository,
    shareCountHistoryRepository: harness.historyRepository,
    cik: acceptanceAudit("AAPL").cik,
    targetAt: EXECUTED_AT,
  });
  assert.equal(aaplUniverse.status, "AVAILABLE");
  if (aaplUniverse.status !== "AVAILABLE") throw new Error("AAPL universe unavailable");
  assert.deepEqual(aaplUniverse.requiredCanonicalSecurityClassIds, [
    "sc:v1:0000320193:common_stock:single",
  ]);
  assert.deepEqual(
    [aaplHistory[0]!, neomHistory[0]!].map((row) => [
      row.issuerCik, row.accessionNumber, row.filingDocument, row.sourceContentHash,
      row.sourceFactKey, row.sourceContextRef,
    ]),
    [
      ["0000320193", "0000320193-26-000020", "aapl-20260627.htm", aaplHistory[0]!.sourceContentHash, aaplHistory[0]!.sourceFactKey, "c-9"],
      ["0001022701", "0001144204-13-044345", "neom-20130630.xml", neomHistory[0]!.sourceContentHash, neomHistory[0]!.sourceFactKey, "PAsOn08_02_2013"],
    ],
  );

  const replay = await harness.collector.collectBatch({ ciks, mode: "incremental" });
  assert.equal(sum(replay.issuers, "submissionsUpdated"), 0);
  assert.equal(sum(replay.issuers, "companyFactsUpdated"), 0);
  assert.equal(sum(replay.issuers, "filingContextsFetched"), 1);
  assert.equal(sum(replay.issuers, "filingContextCacheHits"), 4);
  assert.equal(sum(replay.issuers, "eligibleObservations"), 2);
  assert.equal(sum(replay.issuers, "persistedObservations"), 0);
  assert.equal(sum(replay.issuers, "duplicates"), 2);
  assert.equal(sum(replay.issuers, "universeSnapshotsEvaluated"), 6);
  assert.equal(sum(replay.issuers, "universeSnapshotsInserted"), 0);
  assert.equal(sum(replay.issuers, "universeSnapshotDuplicates"), 6);
  assert.equal(sum(replay.issuers, "universeSnapshotsIncomplete"), 1);
  assert.equal(sum(replay.issuers, "universeSnapshotsAmbiguous"), 3);
  assert.equal((await harness.historyRepository.readHistory(acceptanceAudit("AAPL").cik)).length, 1);
  assert.equal((await harness.historyRepository.readHistory(acceptanceAudit("NEOM").cik)).length, 1);
  assert.deepEqual(harness.filingSource.callsByAccession(), {
    "0000320193-26-000020": 1,
    "0001144204-13-044345": 1,
    "0001193125-26-253514": 1,
    "0001652044-26-000071": 1,
    "0001973239-26-000097": 2,
  });
  assert.equal(harness.sourceClient.modeCalls.filter((call) => call.mode === "bootstrap").length, 10);
  assert.equal(harness.sourceClient.modeCalls.filter((call) => call.mode === "incremental").length, 10);
});

test("issuer and filing failures are isolated and classified without semantic fallback", async () => {
  const harness = createHarness();
  harness.sourceClient.failCompanyFactsCik = acceptanceAudit("GOOG").cik;
  harness.filingSource.networkFailureAccession = acceptanceAudit("ARM").accession;
  const result = await harness.collector.collectBatch({
    ciks: [acceptanceAudit("GOOG").cik, acceptanceAudit("AAPL").cik, acceptanceAudit("ARM").cik, acceptanceAudit("NEOM").cik],
    mode: "backfill",
  });
  assert.equal(issuer(result.issuers, "GOOG").status, "FAILED");
  assert.equal(issuer(result.issuers, "GOOG").reasonCounts.SEC_NETWORK_FAILURE, 1);
  assert.equal(issuer(result.issuers, "ARM").status, "PARTIAL");
  assert.equal(issuer(result.issuers, "ARM").reasonCounts.SEC_NETWORK_FAILURE, 1);
  assert.equal(issuer(result.issuers, "AAPL").counts.persistedObservations, 1);
  assert.equal(issuer(result.issuers, "NEOM").counts.persistedObservations, 1);

  const persistenceHarness = createHarness({ failPersistenceCik: acceptanceAudit("AAPL").cik });
  const persistence = await persistenceHarness.collector.collectBatch({
    ciks: [acceptanceAudit("AAPL").cik, acceptanceAudit("NEOM").cik],
    mode: "bootstrap",
  });
  assert.equal(issuer(persistence.issuers, "AAPL").reasonCounts.DB_PERSISTENCE_FAILURE, 1);
  assert.equal(issuer(persistence.issuers, "AAPL").counts.persistedObservations, 0);
  assert.equal(issuer(persistence.issuers, "NEOM").counts.persistedObservations, 1);
  assert.equal(sum(persistence.issuers, "universeSnapshotsInserted"), 2);

  const universePersistenceHarness = createHarness({ failUniversePersistenceCik: acceptanceAudit("AAPL").cik });
  const universePersistence = await universePersistenceHarness.collector.collectBatch({
    ciks: [acceptanceAudit("AAPL").cik, acceptanceAudit("NEOM").cik],
    mode: "bootstrap",
  });
  assert.equal(issuer(universePersistence.issuers, "AAPL").reasonCounts.DB_PERSISTENCE_FAILURE, 1);
  assert.equal(issuer(universePersistence.issuers, "AAPL").counts.persistedObservations, 1);
  assert.equal(issuer(universePersistence.issuers, "AAPL").counts.universeSnapshotsInserted, 0);
  assert.equal(issuer(universePersistence.issuers, "NEOM").counts.universeSnapshotsInserted, 1);
});

function createHarness(options: { failPersistenceCik?: string; failUniversePersistenceCik?: string } = {}) {
  const structuredRepository = new MemoryStructuredRepository();
  const sourceClient = new FiveIssuerAcceptanceSourceClient();
  const filingRepository = new InMemorySecFilingXbrlArtifactRepository();
  const filingSource = new FiveIssuerAcceptanceFilingSource();
  const historyRepository = new InMemoryShareCountHistoryRepository();
  const universeRepository = new InMemoryIssuerCommonClassUniverseRepository();
  const history = options.failPersistenceCik ? {
    async insertObservation(observation: Parameters<typeof historyRepository.insertObservation>[0]) {
      if (observation.issuerCik === options.failPersistenceCik) throw new Error("fixture history insert failed");
      return historyRepository.insertObservation(observation);
    },
    readHistory: historyRepository.readHistory.bind(historyRepository),
  } : historyRepository;
  const universe = options.failUniversePersistenceCik ? {
    async insertSnapshot(snapshot: Parameters<typeof universeRepository.insertSnapshot>[0]) {
      if (snapshot.issuerCik === options.failUniversePersistenceCik) throw new Error("fixture universe insert failed");
      return universeRepository.insertSnapshot(snapshot);
    },
    readSnapshots: universeRepository.readSnapshots.bind(universeRepository),
  } : universeRepository;
  const collector = new SecOsProductionCollector({
    structuredService: new SecStructuredDataService(sourceClient, structuredRepository, () => new Date(EXECUTED_AT)),
    structuredRepository,
    filingService: new SecFilingXbrlContextService(filingSource, filingRepository),
    filingRepository,
    historyRepository: history,
    universeRepository: universe,
    now: () => new Date(EXECUTED_AT),
  });
  return { collector, sourceClient, filingSource, historyRepository, universeRepository };
}

class MemoryStructuredRepository implements SecStructuredRepository {
  private readonly rawSources = new Map<string, SecNormalizedBatch["rawSources"][number]>();
  private readonly issuers = new Map<string, SecNormalizedBatch["issuers"][number]>();
  private readonly issuerObservations = new Map<string, SecNormalizedBatch["issuerObservations"][number]>();
  private readonly tickerObservations = new Map<string, SecTickerObservationRow>();
  private readonly filings = new Map<string, SecFilingRow>();
  private readonly facts = new Map<string, SecCompanyFactRow>();

  async ingestBatch(batch: SecNormalizedBatch): Promise<SecRepositoryWriteCounts> {
    const counts = { raw: 0, issuer: 0, issuerObservation: 0, ticker: 0, filing: 0, fact: 0 };
    const rawIds: string[] = [];
    for (const row of batch.rawSources) if (!this.rawSources.has(row.id)) {
      this.rawSources.set(row.id, row); rawIds.push(row.id); counts.raw += 1;
    }
    for (const row of batch.issuers) if (!this.issuers.has(row.cik)) {
      this.issuers.set(row.cik, row); counts.issuer += 1;
    }
    for (const row of batch.issuerObservations) {
      const key = `${row.issuerCik}:${row.sourceRawId}`;
      if (!this.issuerObservations.has(key)) { this.issuerObservations.set(key, row); counts.issuerObservation += 1; }
    }
    for (const row of batch.tickerObservations) {
      const key = `${row.issuerCik}:${row.ticker}:${row.exchange}:${row.sourceRawId}`;
      if (!this.tickerObservations.has(key)) { this.tickerObservations.set(key, row); counts.ticker += 1; }
    }
    for (const row of batch.filings) if (!this.filings.has(row.accessionNumber)) {
      this.filings.set(row.accessionNumber, row); counts.filing += 1;
    }
    for (const row of batch.facts) if (!this.facts.has(row.sourceFactKey)) {
      this.facts.set(row.sourceFactKey, row); counts.fact += 1;
    }
    const inserted = Object.values(counts).reduce((total, count) => total + count, 0);
    const attempted = batch.rawSources.length + batch.issuers.length + batch.issuerObservations.length
      + batch.tickerObservations.length + batch.filings.length + batch.facts.length;
    return {
      inserted,
      updated: 0,
      deduped: attempted - inserted,
      rawSourcesInserted: counts.raw,
      issuersInserted: counts.issuer,
      issuerObservationsInserted: counts.issuerObservation,
      tickerObservationsInserted: counts.ticker,
      filingsInserted: counts.filing,
      filingsUpdated: 0,
      factsInserted: counts.fact,
      insertedRawSourceIds: rawIds,
    };
  }

  async readIssuerTickers(cik: string) { return [...this.tickerObservations.values()].filter((row) => row.issuerCik === cik); }
  async readFilings(cik: string) { return [...this.filings.values()].filter((row) => row.issuerCik === cik); }
  async readFacts(filter: SecFactReadFilter) {
    return [...this.facts.values()].filter((row) => row.issuerCik === filter.cik
      && (!filter.taxonomy || row.taxonomy === filter.taxonomy)
      && (!filter.concept || row.concept === filter.concept)
      && (!filter.unit || row.unit === filter.unit)
      && (!filter.form || row.form === filter.form));
  }
}

function issuer(results: readonly Awaited<ReturnType<SecOsProductionCollector["collectIssuer"]>>[], ticker: string) {
  const found = results.find((result) => result.issuerCik === acceptanceAudit(ticker).cik);
  assert.ok(found, ticker);
  return found;
}

function sum(
  results: readonly Awaited<ReturnType<SecOsProductionCollector["collectIssuer"]>>[],
  key: keyof Awaited<ReturnType<SecOsProductionCollector["collectIssuer"]>>["counts"],
) {
  return results.reduce((total, result) => total + result.counts[key], 0);
}

async function universeStatuses(
  harness: ReturnType<typeof createHarness>,
  ticker: string,
) {
  return (await harness.universeRepository.readSnapshots(acceptanceAudit(ticker).cik))
    .map((snapshot) => snapshot.status);
}
