import assert from "node:assert/strict";
import { Client } from "pg";
import { resolveAuthoritativeOsFromFiling } from "../lib/sec-structured-data/authoritativeOsExtraction.ts";
import {
  PostgresSecFilingXbrlArtifactRepository,
  SecFilingXbrlContextService,
  createSecFilingXbrlFixtureArtifact,
  readOsCandidateFilingContexts,
  validateCachedFilingXbrlCompleteness,
  type SecFilingXbrlRawArtifact,
} from "../lib/sec-structured-data/filingXbrlContext.ts";
import type { SecOsFilingContextCandidate } from "../lib/sec-structured-data/osCandidateExtraction.ts";
import {
  FiveIssuerAcceptanceFilingSource,
  FiveIssuerAcceptanceSourceClient,
  acceptanceAudit,
  acceptanceCompany,
} from "../lib/sec-structured-data/osProductionCollectorAcceptanceFixture.ts";
import { SecOsProductionCollector } from "../lib/sec-structured-data/osProductionCollector.ts";
import { PostgresSecStructuredRepository } from "../lib/sec-structured-data/repository.ts";
import { SecStructuredDataService } from "../lib/sec-structured-data/service.ts";
import { PostgresShareCountHistoryRepository } from "../lib/sec-structured-data/shareCountHistory.ts";
import { PostgresIssuerCommonClassUniverseRepository } from "../lib/sec-structured-data/issuerCommonClassUniverse.ts";
import type { SecFilingRow } from "../lib/sec-structured-data/types.ts";

const connectionString = process.env.SUPABASE_LOCAL_DB_URL
  || "postgresql://postgres:postgres@127.0.0.1:56322/postgres";
const databaseUrl = new URL(connectionString);
if (!new Set(["127.0.0.1", "localhost", "::1"]).has(databaseUrl.hostname)) {
  throw new Error("Refusing non-local database");
}

const cik = "0000320193";
const audit = acceptanceAudit("AAPL");
const company = acceptanceCompany(cik);
const filing = company.filings.find((row) => row.accessionNumber === audit.accession)!;
const candidate = candidateFor(filing);
const client = new Client({ connectionString });
let rolledBack = false;

await client.connect();
try {
  const baseline = await fixtureCounts();
  await client.query("begin");
  await client.query("set local statement_timeout = '30s'");
  await clearFixtureIssuerInsideTransaction();
  const sql = createSerialSqlClient(client);
  const repository = new PostgresSecFilingXbrlArtifactRepository(sql);

  const fullRoundTrip = await withinSavepoint("full_round_trip", async () => {
    const fetched = await new FiveIssuerAcceptanceFilingSource().fetchFilingArtifacts(filing);
    assert.equal(fetched.status, "AVAILABLE");
    const artifacts = fetched.artifacts.map((artifact, index) => recreateArtifact(
      artifact,
      index === 0 ? `\n${artifact.rawContent}\n` : `${artifact.rawContent}\n`,
    ));
    assert.deepEqual(await repository.ingestArtifacts(artifacts), { inserted: 3, deduped: 0 });
    const stored = await repository.readArtifacts(cik, filing.accessionNumber);
    assert.deepEqual(stored, sortedArtifacts(artifacts));
    const linked = await readOsCandidateFilingContexts({ candidate, filing, repository });
    const decision = resolveAuthoritativeOsFromFiling(linked);
    assert.equal(decision.status, "ELIGIBLE");
    assert.equal(decision.reason, "ELIGIBLE_SINGLE_COMMON_STOCK_DEI_CONTEXT");
    return { artifacts: stored.length, exactSemanticEquality: true, decision: decision.status };
  });

  const multiDocument = await withinSavepoint("multi_document", async () => {
    const artifacts = multiDocumentArtifacts();
    assert.deepEqual(await repository.ingestArtifacts(artifacts), { inserted: 4, deduped: 0 });
    const stored = await repository.readArtifacts(cik, filing.accessionNumber);
    assert.deepEqual(stored, sortedArtifacts(artifacts));
    const completeness = validateCachedFilingXbrlCompleteness(filing, stored);
    assert.equal(completeness.status, "AVAILABLE");
    const linked = await readOsCandidateFilingContexts({ candidate, filing, repository });
    assert.equal(linked.status, "AVAILABLE");
    if (linked.status !== "AVAILABLE") throw new Error("complete multi-document IXDS unexpectedly unavailable");
    assert.equal(linked.matches.length, 2);
    const classFact = linked.matches.find((fact) => fact.context.dimensions.length === 1)!;
    assert.deepEqual(classFact.concept, {
      qname: "filingDei:EntityCommonStockSharesOutstanding",
      prefix: "filingDei",
      localName: "EntityCommonStockSharesOutstanding",
      namespaceUri: "http://xbrl.sec.gov/dei/2025",
    });
    assert.deepEqual(classFact.context.dimensions, [{
      kind: "explicit",
      axis: {
        qname: "stock:StatementClassOfStockAxis",
        prefix: "stock",
        localName: "StatementClassOfStockAxis",
        namespaceUri: "http://fasb.org/us-gaap/2025",
      },
      member: {
        qname: "stock:CommonClassAMember",
        prefix: "stock",
        localName: "CommonClassAMember",
        namespaceUri: "http://fasb.org/us-gaap/2025",
      },
    }]);
    const decision = resolveAuthoritativeOsFromFiling(linked);
    assert.equal(decision.status, "REQUIRES_FURTHER_CONTEXT");
    assert.equal(decision.reason, "AGGREGATE_AND_CLASS_SPECIFIC_FACTS_REQUIRE_SELECTION");
    return {
      artifacts: stored.length,
      primaryIxdsDocuments: 2,
      exactSemanticEquality: true,
      dimensionIdentityLossless: true,
      namespaceIdentityLossless: true,
    };
  });

  const incomplete = await withinSavepoint("incomplete_ixds", async () => {
    const artifacts = multiDocumentArtifacts().filter((artifact) => artifact.documentName !== "aapl-note.htm");
    await repository.ingestArtifacts(artifacts);
    const stored = await repository.readArtifacts(cik, filing.accessionNumber);
    const completeness = validateCachedFilingXbrlCompleteness(filing, stored);
    assert.equal(completeness.status, "UNAVAILABLE");
    if (completeness.status !== "UNAVAILABLE") throw new Error("incomplete IXDS unexpectedly available");
    assert.equal(completeness.reason, "PRIMARY_IXDS_INCOMPLETE");
    const linked = await readOsCandidateFilingContexts({ candidate, filing, repository });
    assert.equal(linked.status, "UNAVAILABLE");
    if (linked.status === "UNAVAILABLE") assert.equal(linked.reason, "PRIMARY_IXDS_INCOMPLETE");
    return { status: completeness.status, reason: completeness.reason };
  });

  const malformed = await withinSavepoint("malformed_row", async () => {
    const structuredRepository = new PostgresSecStructuredRepository(sql, "external");
    const sourceClient = new FiveIssuerAcceptanceSourceClient();
    const structuredService = new SecStructuredDataService(
      sourceClient,
      structuredRepository,
      () => new Date("2026-08-22T00:00:00.000Z"),
    );
    await structuredService.ingestIssuer({ cik, mode: "incremental" });
    const filingSource = new FiveIssuerAcceptanceFilingSource();
    const fetched = await filingSource.fetchFilingArtifacts(filing);
    await repository.ingestArtifacts(fetched.artifacts);
    await sql.query(
      `update public.sec_structured_raw_sources
          set raw_content = raw_content || E'\\nmalformed'
        where source_kind = 'filing_xbrl'
          and cik = $1
          and payload ->> 'accession' = $2
          and payload ->> 'role' = 'inline_xbrl'`,
      [cik, filing.accessionNumber],
    );
    const collector = new SecOsProductionCollector({
      structuredService,
      structuredRepository,
      filingService: new SecFilingXbrlContextService(filingSource, repository),
      filingRepository: repository,
      historyRepository: new PostgresShareCountHistoryRepository(sql),
      universeRepository: new PostgresIssuerCommonClassUniverseRepository(sql),
      now: () => new Date("2026-08-22T00:00:00.000Z"),
    });
    const result = await collector.collectIssuer({ cik, mode: "incremental" });
    const issue = result.issues.find((item) =>
      item.reason === "DB_READ_FAILURE" && item.stage === "authoritative_extraction"
    );
    assert.deepEqual(issue, {
      reason: "DB_READ_FAILURE",
      stage: "authoritative_extraction",
      accession: filing.accessionNumber,
      detail: "artifact content hash mismatch",
    });
    assert.equal(result.counts.eligibleObservations, 0);
    assert.equal(result.counts.persistedObservations, 0);
    return { status: result.status, retainedIssue: issue };
  });

  await client.query("rollback");
  rolledBack = true;
  const cleanup = await fixtureCounts();
  assert.deepEqual(cleanup, baseline);
  console.log(JSON.stringify({
    ok: true,
    baseline,
    fullRoundTrip,
    multiDocument,
    incomplete,
    malformed,
    cleanup,
    llmCalls: 0,
    publicSecCalls: 0,
  }, null, 2));
} finally {
  if (!rolledBack) await client.query("rollback").catch(() => undefined);
  await client.end();
}

async function withinSavepoint<T>(name: string, work: () => Promise<T>) {
  await client.query(`savepoint ${name}`);
  try {
    return await work();
  } finally {
    await client.query(`rollback to savepoint ${name}`);
    await client.query(`release savepoint ${name}`);
  }
}

function candidateFor(row: SecFilingRow): SecOsFilingContextCandidate {
  const fact = company.facts.find((item) =>
    item.filingAccession === row.accessionNumber
    && item.instantDate === audit.as_of
    && item.concept === "EntityCommonStockSharesOutstanding"
  )!;
  return {
    issuerCik: cik,
    sharesOutstanding: fact.valueNumeric!,
    asOf: audit.as_of,
    accession: row.accessionNumber,
    form: row.form,
    filedDate: row.filedDate,
    acceptedAt: row.acceptedAt!,
    taxonomy: "dei",
    concept: "EntityCommonStockSharesOutstanding",
    unit: "shares",
    sourceKind: "companyfacts",
    contextKind: "companyfacts_implicit",
    sourceFacts: [{
      sourceFactKey: fact.sourceFactKey,
      sourceFactPath: fact.sourceFactPath,
      sourceRawId: fact.sourceRawId,
    }],
    filingLedgerRawSourceId: row.sourceRawId,
    extractionStatus: "REQUIRES_FILING_CONTEXT",
    rejectionReason: "MISSING_COMPANYFACTS_SECURITY_CLASS_CONTEXT",
  };
}

function multiDocumentArtifacts() {
  const archive = audit.source_url.slice(0, audit.source_url.lastIndexOf("/"));
  const archivePath = new URL(archive).pathname;
  const primary = audit.document;
  const note = "aapl-note.htm";
  const filingIndex = `<html><body><div>SEC Accession No. ${filing.accessionNumber}</div><table summary="Document Format Files">
    <tr><td>1</td><td>10-Q</td><td><a href="${archivePath}/${primary}">${primary}</a> iXBRL</td><td>10-Q</td><td>100</td></tr>
    <tr><td>2</td><td>Class note</td><td><a href="${archivePath}/${note}">${note}</a> iXBRL</td><td>EX-99.1</td><td>100</td></tr>
    <tr><td>3</td><td>Fee exhibit</td><td><a href="${archivePath}/aapl-fee.htm">aapl-fee.htm</a> iXBRL</td><td>EX-FILING FEES</td><td>100</td></tr>
  </table></body></html>\n`;
  const inventory = JSON.stringify({ directory: {
    name: archivePath,
    item: [primary, note, "aapl-fee.htm"].map((name) => ({ name, size: 100 })),
  } });
  return [
    createSecFilingXbrlFixtureArtifact({
      issuerCik: cik,
      accession: filing.accessionNumber,
      documentName: "index.json",
      sourceUrl: `${archive}/index.json`,
      role: "archive_index",
      rawContent: `${inventory}\n`,
    }),
    createSecFilingXbrlFixtureArtifact({
      issuerCik: cik,
      accession: filing.accessionNumber,
      documentName: `${filing.accessionNumber}-index.html`,
      sourceUrl: `${archive}/${filing.accessionNumber}-index.html`,
      role: "filing_index",
      rawContent: filingIndex,
    }),
    createSecFilingXbrlFixtureArtifact({
      issuerCik: cik,
      accession: filing.accessionNumber,
      documentName: primary,
      sourceUrl: audit.source_url,
      role: "inline_xbrl",
      rawContent: inlineDocument("primaryIx", "plain", "", audit.filing_lexical_value),
    }),
    createSecFilingXbrlFixtureArtifact({
      issuerCik: cik,
      accession: filing.accessionNumber,
      documentName: note,
      sourceUrl: `${archive}/${note}`,
      role: "inline_xbrl",
      rawContent: inlineDocument(
        "noteIx",
        "class-a",
        '<xbrldi:explicitMember dimension="stock:StatementClassOfStockAxis">stock:CommonClassAMember</xbrldi:explicitMember>',
        audit.filing_lexical_value,
      ),
    }),
  ];
}

function inlineDocument(prefix: string, contextRef: string, dimension: string, value: string) {
  return `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"
    xmlns:${prefix}="http://www.xbrl.org/2013/inlineXBRL"
    xmlns:xbrli="http://www.xbrl.org/2003/instance"
    xmlns:xbrldi="http://xbrl.org/2006/xbrldi"
    xmlns:ixt="http://www.xbrl.org/inlineXBRL/transformation/2020-02-12"
    xmlns:filingDei="http://xbrl.sec.gov/dei/2025"
    xmlns:stock="http://fasb.org/us-gaap/2025">
    <body><${prefix}:header><${prefix}:resources>
      <xbrli:unit id="shares"><xbrli:measure>xbrli:shares</xbrli:measure></xbrli:unit>
      <xbrli:context id="${contextRef}"><xbrli:entity>
        <xbrli:identifier scheme="http://www.sec.gov/CIK">${cik}</xbrli:identifier>
        ${dimension ? `<xbrli:segment>${dimension}</xbrli:segment>` : ""}
      </xbrli:entity><xbrli:period><xbrli:instant>${audit.as_of}</xbrli:instant></xbrli:period></xbrli:context>
    </${prefix}:resources></${prefix}:header>
    <${prefix}:nonFraction name="filingDei:EntityCommonStockSharesOutstanding" contextRef="${contextRef}" unitRef="shares" decimals="0" format="ixt:num-dot-decimal">${value}</${prefix}:nonFraction>
    </body></html>\n`;
}

function recreateArtifact(artifact: SecFilingXbrlRawArtifact, rawContent: string) {
  return createSecFilingXbrlFixtureArtifact({
    issuerCik: artifact.issuerCik,
    accession: artifact.accession,
    documentName: artifact.documentName,
    sourceUrl: artifact.sourceUrl,
    role: artifact.role,
    rawContent,
    fetchedAt: artifact.fetchedAt,
  });
}

function sortedArtifacts(artifacts: readonly SecFilingXbrlRawArtifact[]) {
  return [...artifacts].sort((left, right) =>
    [left.sourceUrl, left.contentHash].join("|").localeCompare([right.sourceUrl, right.contentHash].join("|"))
  );
}

async function fixtureCounts() {
  const result = await client.query(
    `select
       (select count(*)::integer from public.sec_structured_raw_sources where cik = $1) as raw_sources,
       (select count(*)::integer from public.sec_issuers where cik = $1) as issuers,
       (select count(*)::integer from public.sec_issuer_source_observations where issuer_cik = $1) as issuer_observations,
       (select count(*)::integer from public.sec_issuer_ticker_observations where issuer_cik = $1) as ticker_observations,
       (select count(*)::integer from public.sec_filing_ledger where issuer_cik = $1) as filings,
       (select count(*)::integer from public.sec_company_facts where issuer_cik = $1) as company_facts,
       (select count(*)::integer from public.share_count_history where issuer_cik = $1) as share_count_history,
       (select count(*)::integer from public.issuer_common_class_universe_snapshots where issuer_cik = $1) as universe_snapshots`,
    [cik],
  );
  return result.rows[0];
}

async function clearFixtureIssuerInsideTransaction() {
  for (const statement of [
    "delete from public.issuer_common_class_universe_snapshots where issuer_cik = $1",
    "delete from public.share_count_history where issuer_cik = $1",
    "delete from public.sec_company_facts where issuer_cik = $1",
    "delete from public.sec_issuer_ticker_observations where issuer_cik = $1",
    "delete from public.sec_issuer_source_observations where issuer_cik = $1",
    "delete from public.sec_filing_ledger where issuer_cik = $1",
    "delete from public.sec_structured_raw_sources where cik = $1",
  ]) {
    await client.query(statement, [cik]);
  }
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
