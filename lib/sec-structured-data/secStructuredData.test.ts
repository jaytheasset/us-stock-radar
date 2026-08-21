import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeCik, normalizeSecStructuredDocuments } from "./normalization.ts";
import { SecStructuredDataService } from "./service.ts";
import type {
  SecCompanyFactRow,
  SecFactReadFilter,
  SecFilingRow,
  SecNormalizedBatch,
  SecRepositoryWriteCounts,
  SecStructuredRepository,
  SecStructuredSourceClient,
  SecStructuredSourceDocument,
  SecTickerObservationRow,
} from "./types.ts";

const fixture = JSON.parse(await readFile(new URL("./fixtures/three-issuer-minimal.json", import.meta.url), "utf8"));
const now = () => new Date("2026-08-21T14:00:00.000Z");

test("CIK normalization pads valid identities and rejects the all-zero sentinel", () => {
  assert.equal(normalizeCik(1), "0000000001");
  assert.equal(normalizeCik("1"), "0000000001");
  assert.throws(() => normalizeCik(0), /invalid_cik/);
  assert.throws(() => normalizeCik("0"), /invalid_cik/);
  assert.throws(() => normalizeCik("0000000000"), /invalid_cik/);
});

test("three real SEC samples preserve CIK identity, filing provenance, periods, units, and raw links", async () => {
  const repository = new MemoryRepository();
  const client = new FixtureClient(fixture.issuers);
  const service = new SecStructuredDataService(client, repository, now);

  const first = [];
  for (const sample of fixture.issuers) first.push(await service.ingestIssuer({ cik: sample.cik, mode: "backfill" }));
  assert.deepEqual(first.map((result) => result.cik), ["0000320193", "0001022701", "0001123799"]);
  assert.equal(repository.issuers.size, 3);
  assert.equal(repository.filings.size, 3);
  assert.equal(repository.facts.size, 6);

  const aaplFacts = await repository.readFacts({ cik: "0000320193" });
  assert.equal(aaplFacts.some((fact) => fact.instantDate && !fact.startDate && !fact.endDate), true);
  assert.equal(aaplFacts.some((fact) => !fact.instantDate && fact.startDate && fact.endDate), true);
  assert.deepEqual(new Set(aaplFacts.map((fact) => fact.unit)), new Set(["shares", "USD"]));
  assert.equal(aaplFacts.every((fact) => repository.rawSources.has(fact.sourceRawId)), true);
  assert.equal(aaplFacts.every((fact) => fact.contextKind === "companyfacts_implicit"), true);
  assert.equal(aaplFacts.some((fact) => "axis" in fact || "member" in fact), false);
  const aaplFiling = (await repository.readFilings("0000320193"))[0];
  assert.equal(aaplFiling?.acceptedAt, "2026-05-01T10:01:00.000Z");
  assert.equal(aaplFiling?.isXbrl, true);
  assert.equal(aaplFiling?.isInlineXbrl, true);

  const witFacts = await repository.readFacts({ cik: "0001123799" });
  assert.equal(witFacts.some((fact) => fact.taxonomy === "ifrs-full" && fact.unit === "INR"), true);
  assert.deepEqual((await repository.readIssuerTickers("0001123799")).map((row) => [row.ticker, row.exchange]), [["WIT", "NYSE"]]);
  assert.equal((await repository.readFilings("0001123799"))[0]?.acceptedAt, null);

  const replay = [];
  for (const sample of fixture.issuers) replay.push(await service.ingestIssuer({ cik: sample.cik, mode: "incremental" }));
  assert.equal(replay.reduce((sum, result) => sum + result.inserted, 0), 0);
  assert.equal(replay.reduce((sum, result) => sum + result.factsInserted, 0), 0);
  assert.equal(repository.facts.size, 6);
});

test("evolved and reordered CompanyFacts snapshot inserts only the new SEC fact tuple", async () => {
  const repository = new MemoryRepository();
  const sample = fixture.issuers[0];
  const client = new EvolvingFixtureClient(sample);
  const service = new SecStructuredDataService(client, repository, now);
  const first = await service.ingestIssuer({ cik: sample.cik, mode: "backfill" });
  const oldKeys = new Set(repository.facts.keys());
  assert.equal(first.factsInserted, 2);

  client.evolve();
  const second = await service.ingestIssuer({ cik: sample.cik, mode: "incremental" });
  assert.equal(second.factsInserted, 1);
  assert.equal(repository.facts.size, 3);
  assert.equal([...oldKeys].every((key) => repository.facts.has(key)), true);
  assert.equal(second.rawSourcesInserted, 1);
});

test("exact raw body round-trips, drives the hash, and preserves an unsafe JS integer lexeme", () => {
  const documents = sourceDocuments(fixture.issuers[0]);
  const companyFacts = structuredClone(documents[1]);
  const exactBody = JSON.stringify(companyFacts.payload).replace("14687356000", "9007199254740993");
  companyFacts.rawBody = exactBody;
  companyFacts.rawBodyKind = "injected_exact_body";
  companyFacts.payload = JSON.parse(exactBody);
  const normalized = normalizeSecStructuredDocuments([documents[0], companyFacts], now().toISOString());
  const raw = normalized.rawSources.find((row) => row.sourceKind === "companyfacts");
  assert.equal(raw?.rawContent, exactBody);
  assert.equal(raw?.rawContentKind, "injected_exact_body");
  assert.equal(raw?.contentHash, createHash("sha256").update(exactBody, "utf8").digest("hex"));
  assert.equal(normalized.facts.find((fact) => fact.unit === "shares")?.valueNumeric, "9007199254740993");

  const mismatch = structuredClone(companyFacts);
  mismatch.payload = structuredClone(documents[1].payload);
  assert.equal(normalizeSecStructuredDocuments([documents[0], mismatch], now().toISOString()).rejections[0]?.reason, "raw_body_payload_mismatch");
});

test("one CIK safely owns multiple current and later ticker observations", () => {
  const base = sourceDocuments(fixture.issuers[0]);
  const submissions = structuredClone(base[0]);
  const payload = submissions.payload as Record<string, unknown>;
  payload.tickers = ["AAA", "AAA.B"];
  payload.exchanges = ["NYSE", "NYSE"];
  const first = normalizeSecStructuredDocuments([submissions, base[1]], now().toISOString());
  assert.equal(first.issuers.length, 1);
  assert.deepEqual(first.tickerObservations.map((row) => row.ticker), ["AAA", "AAA.B"]);

  const later = structuredClone(submissions);
  later.fetchedAt = "2026-08-22T00:00:00Z";
  later.sourceIdentity = `${later.sourceIdentity}?observation=2`;
  (later.payload as Record<string, unknown>).tickers = ["NEW"];
  (later.payload as Record<string, unknown>).exchanges = ["Nasdaq"];
  const second = normalizeSecStructuredDocuments([later], now().toISOString());
  assert.equal(second.issuers[0]?.cik, first.issuers[0]?.cik);
  assert.equal(second.tickerObservations[0]?.ticker, "NEW");
});

test("accepted_at comes only from authoritative Submissions and never from collection publication time", () => {
  const documents = sourceDocuments(fixture.issuers[0]);
  const submissions = structuredClone(documents[0]);
  const recent = (((submissions.payload as Record<string, unknown>).filings as Record<string, unknown>).recent as Record<string, unknown>);
  recent.acceptanceDateTime = ["20260501123456"];
  (submissions as SecStructuredSourceDocument & { publishedAt?: string }).publishedAt = "1999-01-01T00:00:00Z";
  const normalized = normalizeSecStructuredDocuments([submissions, documents[1]], now().toISOString());
  assert.equal(normalized.filings[0]?.acceptedAt, "2026-05-01T12:34:56.000Z");
  assert.notEqual(normalized.filings[0]?.acceptedAt, "1999-01-01T00:00:00.000Z");
});

test("malformed fact values, periods, accessions, and source identities fail closed", () => {
  const documents = sourceDocuments(fixture.issuers[0]);
  const companyFacts = structuredClone(documents[1]);
  const payload = companyFacts.payload as any;
  const entries = payload.facts["us-gaap"].RevenueFromContractWithCustomerExcludingAssessedTax.units.USD;
  entries.push({ ...entries[0], end: undefined });
  entries.push({ ...entries[0], instant: "2026-03-28" });
  entries.push({ ...entries[0], accn: "bad-accession" });
  entries.push({ ...entries[0], val: { amount: 1 } });
  const normalized = normalizeSecStructuredDocuments([documents[0], companyFacts], now().toISOString());
  assert.equal(normalized.facts.length, 2);
  assert.deepEqual(new Set(normalized.rejections.map((item) => item.reason)), new Set([
    "missing_fact_end", "mixed_fact_period", "invalid_fact_accession", "invalid_fact_value",
  ]));

  const badSource = structuredClone(documents[0]);
  badSource.cik = "bad";
  const rejectedSource = normalizeSecStructuredDocuments([badSource], now().toISOString());
  assert.equal(rejectedSource.rawSources.length, 0);
  assert.equal(rejectedSource.rejections[0]?.reason, "invalid_cik");

  const badFlag = structuredClone(documents[0]);
  const recent = (((badFlag.payload as Record<string, unknown>).filings as Record<string, unknown>).recent as Record<string, unknown>);
  recent.isXBRL = [2];
  assert.equal(normalizeSecStructuredDocuments([badFlag], now().toISOString()).rejections[0]?.reason, "invalid_is_xbrl");
});

class FixtureClient implements SecStructuredSourceClient {
  private readonly samples: any[];
  constructor(samples: any[]) { this.samples = samples; }
  async fetchSubmissions(cik: string) { return [sourceDocuments(this.samples.find((sample) => sample.cik === cik))[0]]; }
  async fetchCompanyFacts(cik: string) { return sourceDocuments(this.samples.find((sample) => sample.cik === cik))[1]; }
}

class EvolvingFixtureClient implements SecStructuredSourceClient {
  private evolved = false;
  private readonly sample: any;
  constructor(sample: any) { this.sample = sample; }
  evolve() { this.evolved = true; }
  async fetchSubmissions() { return [sourceDocuments(this.sample)[0]]; }
  async fetchCompanyFacts() {
    const document = sourceDocuments(this.sample)[1];
    if (!this.evolved) return document;
    const entries = (document.payload as any).facts["us-gaap"].RevenueFromContractWithCustomerExcludingAssessedTax.units.USD;
    entries.unshift({ ...entries[0], start: "2025-09-28", end: "2025-12-27", val: 70000000000, frame: "CY2025Q4" });
    return document;
  }
}

class MemoryRepository implements SecStructuredRepository {
  rawSources = new Map<string, any>();
  issuers = new Map<string, any>();
  issuerObservations = new Map<string, any>();
  tickerObservations = new Map<string, SecTickerObservationRow>();
  filings = new Map<string, SecFilingRow>();
  facts = new Map<string, SecCompanyFactRow>();

  async ingestBatch(batch: SecNormalizedBatch): Promise<SecRepositoryWriteCounts> {
    const counts = { raw: 0, issuer: 0, issuerObs: 0, ticker: 0, filing: 0, fact: 0 };
    const rawIds: string[] = [];
    for (const row of batch.rawSources) if (!this.rawSources.has(row.id)) { this.rawSources.set(row.id, row); rawIds.push(row.id); counts.raw++; }
    for (const row of batch.issuers) if (!this.issuers.has(row.cik)) { this.issuers.set(row.cik, row); counts.issuer++; }
    for (const row of batch.issuerObservations) {
      const key = `${row.issuerCik}:${row.sourceRawId}`;
      if (!this.issuerObservations.has(key)) { this.issuerObservations.set(key, row); counts.issuerObs++; }
    }
    for (const row of batch.tickerObservations) {
      const key = `${row.issuerCik}:${row.ticker}:${row.exchange}:${row.sourceRawId}`;
      if (!this.tickerObservations.has(key)) { this.tickerObservations.set(key, row); counts.ticker++; }
    }
    for (const row of batch.filings) if (!this.filings.has(row.accessionNumber)) { this.filings.set(row.accessionNumber, row); counts.filing++; }
    for (const row of batch.facts) if (!this.facts.has(row.sourceFactKey)) { this.facts.set(row.sourceFactKey, row); counts.fact++; }
    const inserted = Object.values(counts).reduce((sum, value) => sum + value, 0);
    const attempted = batch.rawSources.length + batch.issuers.length + batch.issuerObservations.length
      + batch.tickerObservations.length + batch.filings.length + batch.facts.length;
    return {
      inserted, updated: 0, deduped: attempted - inserted,
      rawSourcesInserted: counts.raw, issuersInserted: counts.issuer,
      issuerObservationsInserted: counts.issuerObs, tickerObservationsInserted: counts.ticker,
      filingsInserted: counts.filing, filingsUpdated: 0, factsInserted: counts.fact,
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

function sourceDocuments(sample: any): [SecStructuredSourceDocument, SecStructuredSourceDocument] {
  return [
    {
      sourceKind: "submissions", sourceUrl: `https://data.sec.gov/submissions/CIK${sample.cik}.json`,
      sourceIdentity: `https://data.sec.gov/submissions/CIK${sample.cik}.json`, cik: sample.cik,
      fetchedAt: sample.fetched_at, payload: structuredClone(sample.submissions),
    },
    {
      sourceKind: "companyfacts", sourceUrl: `https://data.sec.gov/api/xbrl/companyfacts/CIK${sample.cik}.json`,
      sourceIdentity: `https://data.sec.gov/api/xbrl/companyfacts/CIK${sample.cik}.json`, cik: sample.cik,
      fetchedAt: sample.fetched_at, payload: structuredClone(sample.companyfacts),
    },
  ];
}
