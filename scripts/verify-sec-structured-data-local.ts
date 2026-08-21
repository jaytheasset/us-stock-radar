import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
// @ts-expect-error The project uses pg from JavaScript scripts without bundled declarations.
import { Client } from "pg";
import { PostgresSecStructuredRepository } from "../lib/sec-structured-data/repository.ts";
import { SecStructuredDataService } from "../lib/sec-structured-data/service.ts";
import {
  PostgresSecFilingXbrlArtifactRepository,
  createSecFilingXbrlFixtureArtifact,
} from "../lib/sec-structured-data/filingXbrlContext.ts";
import type { SecStructuredSourceClient, SecStructuredSourceDocument } from "../lib/sec-structured-data/types.ts";

const fixture = JSON.parse(await readFile(new URL("../lib/sec-structured-data/fixtures/three-issuer-minimal.json", import.meta.url), "utf8"));
const connectionString = process.env.SUPABASE_LOCAL_DB_URL || "postgresql://postgres:postgres@127.0.0.1:56322/postgres";
const databaseUrl = new URL(connectionString);
if (!new Set(["127.0.0.1", "localhost", "::1"]).has(databaseUrl.hostname)) throw new Error("Refusing non-local database");

const client = new Client({ connectionString });
const samples = fixture.issuers;
const sourceClient: SecStructuredSourceClient = {
  async fetchSubmissions(cik: string) { return [documents(samples.find((sample: any) => sample.cik === cik))[0]]; },
  async fetchCompanyFacts(cik: string) { return documents(samples.find((sample: any) => sample.cik === cik), evolvedCik === cik)[1]; },
};
let evolvedCik: string | null = null;
await client.connect();
let rolledBack = false;
try {
  await client.query("begin");
  await client.query("set local statement_timeout = '30s'");
  const repository = new PostgresSecStructuredRepository(client, "external");
  const service = new SecStructuredDataService(sourceClient, repository, () => new Date("2026-08-21T14:00:00Z"));
  const first = [];
  const replay = [];
  for (const sample of fixture.issuers) first.push(await service.ingestIssuer({ cik: sample.cik, mode: "backfill" }));
  for (const sample of fixture.issuers) replay.push(await service.ingestIssuer({ cik: sample.cik, mode: "incremental" }));
  const evolvedTargetCik: string = fixture.issuers[0].cik;
  evolvedCik = evolvedTargetCik;
  const evolved = await service.ingestIssuer({ cik: evolvedTargetCik, mode: "incremental" });
  const filingXbrlRepository = new PostgresSecFilingXbrlArtifactRepository(client);
  const filingXbrlArtifact = createSecFilingXbrlFixtureArtifact({
    issuerCik: evolvedTargetCik,
    accession: "0000320193-26-000020",
    documentName: "aapl-20260627.htm",
    sourceUrl: "https://www.sec.gov/Archives/edgar/data/320193/000032019326000020/aapl-20260627.htm",
    role: "inline_xbrl",
    rawContent: '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:ix="http://www.xbrl.org/2013/inlineXBRL" xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:dei="http://xbrl.sec.gov/dei/2025"><body><ix:header><ix:resources><xbrli:context id="c-9"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">0000320193</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>2026-07-17</xbrli:instant></xbrli:period></xbrli:context></ix:resources></ix:header><ix:nonFraction name="dei:EntityCommonStockSharesOutstanding" contextRef="c-9" unitRef="shares">14594180000</ix:nonFraction></body></html>\n',
  });
  const filingXbrlFirst = await filingXbrlRepository.ingestArtifacts([filingXbrlArtifact]);
  const filingXbrlReplay = await filingXbrlRepository.ingestArtifacts([filingXbrlArtifact]);
  const filingXbrlStored = await filingXbrlRepository.readArtifacts(evolvedTargetCik, filingXbrlArtifact.accession);

  assert.equal(first.reduce((sum, item) => sum + item.factsInserted, 0), 6);
  assert.equal(replay.reduce((sum, item) => sum + item.inserted, 0), 0);
  assert.equal(replay.reduce((sum, item) => sum + item.factsInserted, 0), 0);
  assert.equal(evolved.factsInserted, 1);
  assert.equal(evolved.rawSourcesInserted, 1);
  assert.deepEqual(filingXbrlFirst, { inserted: 1, deduped: 0 });
  assert.deepEqual(filingXbrlReplay, { inserted: 0, deduped: 1 });
  assert.equal(filingXbrlStored.length, 1);
  assert.deepEqual(filingXbrlStored, [filingXbrlArtifact]);
  assert.equal(filingXbrlStored[0]?.contentHash, filingXbrlArtifact.contentHash);
  assert.equal(filingXbrlStored[0]?.rawContent, filingXbrlArtifact.rawContent);
  for (const sample of fixture.issuers) {
    assert.equal((await repository.readIssuerTickers(sample.cik)).length, 1);
    assert.equal((await repository.readFilings(sample.cik)).length, 1);
    const facts = await repository.readFacts({ cik: sample.cik });
    assert.equal(facts.length, sample.cik === evolvedCik ? 3 : 2);
    assert.equal(facts.some((fact) => fact.instantDate !== null), true);
    assert.equal(facts.some((fact) => fact.startDate !== null && fact.endDate !== null), true);
  }

  const exactCompanyFacts = documents(fixture.issuers[0], true)[1];
  const storedRaw = await client.query(
    `select raw_content, raw_content_kind, content_hash
     from public.sec_structured_raw_sources
     where source_kind = 'companyfacts' and cik = $1
     order by fetched_at desc, id desc limit 1`,
    [fixture.issuers[0].cik],
  );
  assert.equal(storedRaw.rows[0].raw_content, exactCompanyFacts.rawBody);
  assert.equal(storedRaw.rows[0].raw_content_kind, "injected_exact_body");
  const expectedHash = (await import("node:crypto")).createHash("sha256").update(exactCompanyFacts.rawBody!, "utf8").digest("hex");
  assert.equal(storedRaw.rows[0].content_hash, expectedHash);
  await client.query("rollback");
  rolledBack = true;
  const cleanup = await client.query(
    `select
       (select count(*)::integer from public.sec_structured_raw_sources) as raw_count,
       (select count(*)::integer from public.sec_issuers) as issuer_count,
       (select count(*)::integer from public.sec_issuer_source_observations) as issuer_observation_count,
       (select count(*)::integer from public.sec_issuer_ticker_observations) as ticker_observation_count,
       (select count(*)::integer from public.sec_company_facts) as fact_count,
       (select count(*)::integer from public.sec_filing_ledger) as filing_count`,
  );
  assert.deepEqual(cleanup.rows[0], { raw_count: 0, issuer_count: 0, issuer_observation_count: 0, ticker_observation_count: 0, fact_count: 0, filing_count: 0 });
  console.log(JSON.stringify({
    ok: true,
    issuers: first.map((item) => ({ cik: item.cik, inserted: item.inserted, facts: item.factsInserted, rejected: item.rejected })),
    replayInserted: replay.reduce((sum, item) => sum + item.inserted, 0),
    evolvedFactsInserted: evolved.factsInserted,
    filingXbrl: {
      inserted: filingXbrlFirst.inserted,
      replayInserted: filingXbrlReplay.inserted,
      exactRawRoundTrip: filingXbrlStored[0]?.rawContent === filingXbrlArtifact.rawContent,
    },
    cleanup: cleanup.rows[0],
    llmCalls: 0,
    publicSecCalls: 0,
  }, null, 2));
} finally {
  if (!rolledBack) await client.query("rollback").catch(() => undefined);
  await client.end();
}

function documents(sample: any, evolved = false): [SecStructuredSourceDocument, SecStructuredSourceDocument] {
  if (!sample) throw new Error("Fixture issuer missing");
  const companyFactsPayload = structuredClone(sample.companyfacts);
  if (evolved) {
    const entries = companyFactsPayload.facts["us-gaap"].RevenueFromContractWithCustomerExcludingAssessedTax.units.USD;
    entries.unshift({ ...entries[0], start: "2025-09-28", end: "2025-12-27", val: 70000000000, frame: "CY2025Q4" });
  }
  const rawBody = JSON.stringify(companyFactsPayload);
  return [
    { sourceKind: "submissions", sourceUrl: `https://data.sec.gov/submissions/CIK${sample.cik}.json`, sourceIdentity: `https://data.sec.gov/submissions/CIK${sample.cik}.json`, cik: sample.cik, fetchedAt: sample.fetched_at, payload: structuredClone(sample.submissions) },
    { sourceKind: "companyfacts", sourceUrl: `https://data.sec.gov/api/xbrl/companyfacts/CIK${sample.cik}.json`, sourceIdentity: `https://data.sec.gov/api/xbrl/companyfacts/CIK${sample.cik}.json`, cik: sample.cik, fetchedAt: evolved ? "2026-08-22T00:00:00Z" : sample.fetched_at, payload: JSON.parse(rawBody), rawBody, rawBodyKind: "injected_exact_body" },
  ];
}
