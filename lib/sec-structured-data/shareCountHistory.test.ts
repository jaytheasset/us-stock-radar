import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  resolveAuthoritativeOsFromFiling,
  type SecAuthoritativeOsDecision,
} from "./authoritativeOsExtraction.ts";
import type { SecFilingXbrlFact, SecOsCandidateFilingContextResult, SecXbrlDimension } from "./filingXbrlContext.ts";
import type { SecOsFilingContextCandidate } from "./osCandidateExtraction.ts";
import {
  InMemoryShareCountHistoryRepository,
  PostgresShareCountHistoryRepository,
  readShareCountHistory,
  toShareCountHistoryObservation,
  writeAuthoritativeShareCountObservation,
  type ShareCountHistorySqlClient,
} from "./shareCountHistory.ts";
import {
  extractLevel2ShareCountSidecar,
  writeLevel2ShareCountObservation,
} from "./level2ShareCountObservation.ts";

type AuditSample = {
  ticker: string;
  cik: string;
  accession: string;
  document: string;
  source_url: string;
  companyfacts_value: string;
  filing_lexical_value: string;
  as_of: string;
  context_ref: string;
};

const auditFixture = JSON.parse(await readFile(
  new URL("./fixtures/authoritative-os-five-issuer-audit.json", import.meta.url),
  "utf8",
)) as { issuers: AuditSample[] };

test("ELIGIBLE official extractor observations append as history and exact replay inserts zero", async () => {
  const repository = new InMemoryShareCountHistoryRepository();
  const apple = audit("AAPL");
  const firstDecision = eligibleDecision(apple);
  const secondDecision = eligibleDecision({
    ...apple,
    accession: "0000320193-26-000021",
    as_of: "2026-08-01",
    context_ref: "c-10",
    companyfacts_value: "14595000000",
    filing_lexical_value: "14,595,000,000",
  });

  assert.deepEqual(await writeAuthoritativeShareCountObservation({
    repository, decision: firstDecision, ingestedAt: "2026-08-22T01:00:00.000Z",
  }), { inserted: 1, deduped: 0 });
  assert.deepEqual(await writeAuthoritativeShareCountObservation({
    repository, decision: structuredClone(firstDecision), ingestedAt: "2026-08-22T01:00:00.000Z",
  }), { inserted: 0, deduped: 1 });
  assert.deepEqual(await writeAuthoritativeShareCountObservation({
    repository, decision: secondDecision, ingestedAt: "2026-08-22T02:00:00.000Z",
  }), { inserted: 1, deduped: 0 });

  const history = await readShareCountHistory(repository, apple.cik);
  assert.equal(history.length, 2);
  assert.deepEqual(history.map((row) => [row.asOf, row.sharesOutstanding, row.accessionNumber]), [
    ["2026-07-17", "14594180000", "0000320193-26-000020"],
    ["2026-08-01", "14595000000", "0000320193-26-000021"],
  ]);
  assert.equal(history.some((row) => "isCurrent" in row || "winner" in row || "latest" in row), false);
});

test("Class A and Class B identities remain separate under one issuer without sums or winners", async () => {
  const repository = new InMemoryShareCountHistoryRepository();
  const sample = audit("AAPL");
  const classA = eligibleDecision(sample, classDimension("CommonClassAMember"));
  const classB = eligibleDecision({
    ...sample,
    companyfacts_value: "1000000000",
    filing_lexical_value: "1,000,000,000",
  }, classDimension("CommonClassBMember"));
  await writeAuthoritativeShareCountObservation({ repository, decision: classA, ingestedAt: "2026-08-22T03:00:00Z" });
  await writeAuthoritativeShareCountObservation({ repository, decision: classB, ingestedAt: "2026-08-22T03:00:01Z" });
  const history = await readShareCountHistory(repository, sample.cik);
  assert.equal(history.length, 2);
  assert.deepEqual(history.map((row) => row.sharesOutstanding), ["14594180000", "1000000000"]);
  assert.equal(new Set(history.map((row) => row.securityClassIdentity.canonicalKey)).size, 2);
  assert.deepEqual(history.map((row) =>
    (row.securityClassIdentity.identity as { member: { localName: string } }).member.localName).sort(),
  ["CommonClassAMember", "CommonClassBMember"]);
});

test("SEC XBRL and Level 2 observations coexist across dates and source types without winner selection", async () => {
  const repository = new InMemoryShareCountHistoryRepository();
  const xbrl = eligibleDecision({
    ...audit("AAPL"),
    cik: "0000000099",
    accession: "0000000099-26-000009",
    document: "issuer-20260630.htm",
    source_url: "https://www.sec.gov/Archives/edgar/data/99/issuer-20260630.htm",
    companyfacts_value: "20000000",
    filing_lexical_value: "20,000,000",
    as_of: "2026-06-30",
    context_ref: "xbrl-cover",
  });
  await writeAuthoritativeShareCountObservation({
    repository, decision: xbrl, ingestedAt: "2026-08-22T08:00:00Z",
  });
  const evidence = "As of August 18, 2026, 27,500,000 shares of common stock were outstanding.";
  const level2 = extractLevel2ShareCountSidecar({
    payload: {
      share_count_observation: {
        observation_type: "source_stated",
        shares_outstanding: "27500000",
        as_of: "2026-08-18",
        security_class_kind: "common_stock",
        security_class_title: "common stock",
        source_ref: "sec:cover",
        evidence,
      },
    },
    accessionNumber: "0000000099-26-000010",
    sourceDocumentUrl: "https://www.sec.gov/Archives/edgar/data/99/issuer-20260818.htm",
    sourceDocuments: [{ source_ref: "sec:cover", document_name: "issuer-20260818.htm", text: evidence }],
  }).candidate;
  assert.ok(level2);
  await writeLevel2ShareCountObservation({
    repository,
    candidate: level2,
    context: {
      issuerCik: "0000000099",
      form: "8-K",
      filedDate: "2026-08-18",
      acceptedAt: "2026-08-18T12:00:00Z",
      acceptedAtSource: "sec_raw_payload_acceptance",
      acceptedAtProvenance: { source: "raw_items.raw_payload.accepted_at" },
      ingestedAt: "2026-08-22T08:01:00Z",
      rawItemId: "10000000-0000-5000-8000-000000000001",
      eventId: "20000000-0000-5000-8000-000000000001",
      parentPrimaryAiRunId: "30000000-0000-5000-8000-000000000001",
      sourceExecutionId: "40000000-0000-5000-8000-000000000001",
      analyzerKey: "listing_risk",
      canonicalSecurityClassSupports: (await readShareCountHistory(repository, "0000000099"))
        .filter((row) => row.sourceType === "sec_authoritative_os")
        .map((row) => ({
          observationId: row.id ?? null,
          canonicalSecurityClassId: row.canonicalSecurityClassId!,
          canonicalSecurityClassKind: "common_stock" as const,
          securityClassBasis: row.securityClassBasis as "SINGLE_COMMON_STOCK_CLASS",
          sourceFactKey: row.sourceFactKey,
          accessionNumber: row.accessionNumber,
        })),
    },
  });
  const history = await readShareCountHistory(repository, "0000000099");
  assert.deepEqual(history.map((row) => [row.asOf, row.sharesOutstanding, row.sourceType]), [
    ["2026-06-30", "20000000", "sec_authoritative_os"],
    ["2026-08-18", "27500000", "sec_filing_text_level2"],
  ]);
  assert.equal(new Set(history.map((row) => row.canonicalSecurityClassId)).size, 1);
  assert.equal(history.some((row) => "winner" in row || "latest" in row || "isCurrent" in row), false);
});

test("REQUIRES_FURTHER_CONTEXT and UNAVAILABLE decisions save zero rows", async () => {
  const repository = new InMemoryShareCountHistoryRepository();
  const sample = audit("AAPL");
  const eligible = linked(sample);
  const foreignCandidate = { ...eligible.candidate, form: "20-F" } as SecOsFilingContextCandidate;
  const requires = resolveAuthoritativeOsFromFiling({ ...eligible, candidate: foreignCandidate });
  const unavailable = resolveAuthoritativeOsFromFiling({
    status: "UNAVAILABLE", candidate: eligible.candidate,
    reason: "FILING_ARTIFACT_MISSING", detail: "fixture",
  });
  assert.equal(requires.status, "REQUIRES_FURTHER_CONTEXT");
  assert.equal(unavailable.status, "UNAVAILABLE");
  await assert.rejects(() => writeAuthoritativeShareCountObservation({
    repository, decision: requires, ingestedAt: "2026-08-22T04:00:00Z",
  }), /rejects authoritative status/);
  await assert.rejects(() => writeAuthoritativeShareCountObservation({
    repository, decision: unavailable, ingestedAt: "2026-08-22T04:00:00Z",
  }), /rejects authoritative status/);
  assert.equal((await readShareCountHistory(repository, sample.cik)).length, 0);
});

test("full fact, context, dimensions, timestamps, and decision provenance round-trip", async () => {
  const repository = new InMemoryShareCountHistoryRepository();
  const decision = eligibleDecision(audit("AAPL"), classDimension("CommonClassAMember"));
  assert.equal(decision.status, "ELIGIBLE");
  if (decision.status !== "ELIGIBLE") return;
  const expected = toShareCountHistoryObservation(decision, "2026-08-22T05:00:00+00:00");
  await writeAuthoritativeShareCountObservation({ repository, decision, ingestedAt: "2026-08-22T05:00:00+00:00" });
  const [stored] = await readShareCountHistory(repository, decision.issuerCik);
  assert.ok(stored);
  assert.deepEqual(stored.sourceFactIdentity, expected.sourceFactIdentity);
  assert.deepEqual(stored.sourceContext, expected.sourceContext);
  assert.deepEqual(stored.sourceDimensions, expected.sourceDimensions);
  assert.deepEqual(stored.sourceProvenance, expected.sourceProvenance);
  assert.deepEqual(stored.authoritativeDecisionLineage, expected.authoritativeDecisionLineage);
  assert.deepEqual(
    { asOf: stored.asOf, filedDate: stored.filedDate, acceptedAt: stored.acceptedAt, ingestedAt: stored.ingestedAt },
    {
      asOf: decision.authoritative.asOf,
      filedDate: decision.authoritative.filedDate,
      acceptedAt: decision.authoritative.acceptedAt,
      ingestedAt: "2026-08-22T05:00:00.000Z",
    },
  );
});

test("application validation fails closed for invalid values and incomplete IXDS lineage", async () => {
  const repository = new InMemoryShareCountHistoryRepository();
  const decision = eligibleDecision(audit("AAPL"));
  assert.equal(decision.status, "ELIGIBLE");
  if (decision.status !== "ELIGIBLE") return;
  const mutations: Array<[string, (copy: typeof decision) => void]> = [
    ["shares", (copy) => { copy.authoritative.sharesOutstanding = "0"; copy.candidate.sharesOutstanding = "0"; }],
    ["CIK", (copy) => { copy.authoritative.issuerCik = ""; }],
    ["as_of", (copy) => { copy.authoritative.asOf = "2026-99-99"; }],
    ["security identity", (copy) => { (copy.authoritative.securityClass as { identity: string }).identity = ""; }],
    ["accession", (copy) => { copy.authoritative.accession = ""; }],
    ["timestamp", (copy) => { copy.authoritative.acceptedAt = "not-a-timestamp"; }],
    ["provenance", (copy) => { copy.authoritative.companyFactsProvenance = []; }],
    ["IXDS", (copy) => { copy.authoritative.source.contentHash = "missing"; }],
  ];
  for (const [name, mutate] of mutations) {
    const copy = structuredClone(decision);
    mutate(copy);
    await assert.rejects(() => writeAuthoritativeShareCountObservation({
      repository, decision: copy, ingestedAt: "2026-08-22T06:00:00Z",
    }), /.+/, name);
  }
  await assert.rejects(() => writeAuthoritativeShareCountObservation({
    repository, decision, ingestedAt: "bad-time",
  }), /ingestedAt is invalid/);
  assert.equal((await readShareCountHistory(repository, decision.issuerCik)).length, 0);
});

test("Postgres repository uses canonical-source conflict handling and history-only ordering", async () => {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const client: ShareCountHistorySqlClient = {
    async query<Row extends Record<string, unknown>>(sql: string, values?: unknown[]) {
      calls.push({ sql, values });
      return { rows: [] as Row[], rowCount: 0 };
    },
  };
  const repository = new PostgresShareCountHistoryRepository(client);
  const decision = eligibleDecision(audit("AAPL"));
  assert.equal(decision.status, "ELIGIBLE");
  if (decision.status !== "ELIGIBLE") return;
  assert.equal(await repository.insertObservation(toShareCountHistoryObservation(decision, "2026-08-22T07:00:00Z")), false);
  await readShareCountHistory(repository, decision.issuerCik, { asOfFrom: "2026-01-01" });
  assert.match(calls[0]!.sql, /on conflict on constraint share_count_history_canonical_source_unique do nothing/i);
  assert.doesNotMatch(calls[0]!.sql, /do update/i);
  assert.match(calls[1]!.sql, /order by as_of, accepted_at, accession_number, id/i);
  assert.doesNotMatch(calls[1]!.sql, /distinct on|limit|current|winner/i);
});

function eligibleDecision(sample: AuditSample, dimensions: SecXbrlDimension[] = []) {
  const decision = resolveAuthoritativeOsFromFiling(linked(sample, dimensions));
  assert.equal(decision.status, "ELIGIBLE");
  return decision as Extract<SecAuthoritativeOsDecision, { status: "ELIGIBLE" }>;
}

function linked(sample: AuditSample, dimensions: SecXbrlDimension[] = []): Extract<SecOsCandidateFilingContextResult, { status: "AVAILABLE" }> {
  const candidate: SecOsFilingContextCandidate = {
    issuerCik: sample.cik,
    sharesOutstanding: sample.companyfacts_value,
    asOf: sample.as_of,
    accession: sample.accession,
    form: "10-Q",
    filedDate: "2026-07-31",
    acceptedAt: "2026-07-31T12:34:56.000Z",
    taxonomy: "dei",
    concept: "EntityCommonStockSharesOutstanding",
    unit: "shares",
    sourceKind: "companyfacts",
    contextKind: "companyfacts_implicit",
    sourceFacts: [{
      sourceFactKey: "b".repeat(64),
      sourceFactPath: "facts.dei.EntityCommonStockSharesOutstanding.units.shares[0]",
      sourceRawId: "81000000-0000-5000-8000-000000000002",
    }],
    filingLedgerRawSourceId: "81000000-0000-5000-8000-000000000001",
    extractionStatus: "REQUIRES_FILING_CONTEXT",
    rejectionReason: "MISSING_COMPANYFACTS_SECURITY_CLASS_CONTEXT",
  };
  const fact = filingFact(sample, candidate, dimensions);
  return { status: "AVAILABLE", candidate, matches: [fact], relevantRejections: [], sources: [fact.source] };
}

function filingFact(sample: AuditSample, candidate: SecOsFilingContextCandidate, dimensions: SecXbrlDimension[]): SecFilingXbrlFact {
  const factKeySeed = [sample.accession, sample.document, sample.context_ref, sample.companyfacts_value,
    ...dimensions.map((dimension) => dimension.kind === "explicit" ? dimension.member.localName : "typed")].join("|");
  const factKey = createHash("sha256").update(factKeySeed).digest("hex");
  const source = {
    artifactId: dimensions[0]?.kind === "explicit" && dimensions[0].member.localName.endsWith("BMember")
      ? "92000000-0000-5000-8000-000000000002" : "92000000-0000-5000-8000-000000000001",
    issuerCik: sample.cik,
    accession: sample.accession,
    documentName: sample.document,
    sourceUrl: sample.source_url,
    contentHash: factKey,
    fetchedAt: "2026-08-22T00:00:00.000Z",
    rawContentKind: "injected_exact_body" as const,
  };
  return {
    factKey,
    concept: { qname: "dei:EntityCommonStockSharesOutstanding", prefix: "dei", localName: "EntityCommonStockSharesOutstanding", namespaceUri: "http://xbrl.sec.gov/dei/2025" },
    valueText: sample.filing_lexical_value,
    valueTree: sample.filing_lexical_value,
    contextRef: sample.context_ref,
    unitRef: "shares",
    unit: { id: "shares", kind: "measure", measure: { qname: "xbrli:shares", prefix: "xbrli", localName: "shares", namespaceUri: "http://www.xbrl.org/2003/instance" } },
    decimals: "0", precision: null, scale: "0", sign: null,
    inlineFormat: "ixt:num-dot-decimal", isNil: false,
    context: {
      id: sample.context_ref,
      entityIdentifier: sample.cik,
      entityScheme: "http://www.sec.gov/CIK",
      period: { kind: "instant", instant: sample.as_of },
      dimensions,
    },
    source,
  };
}

function classDimension(member: "CommonClassAMember" | "CommonClassBMember"): SecXbrlDimension[] {
  return [{
    kind: "explicit",
    axis: { qname: "us-gaap:StatementClassOfStockAxis", prefix: "us-gaap", localName: "StatementClassOfStockAxis", namespaceUri: "http://fasb.org/us-gaap/2025" },
    member: { qname: `us-gaap:${member}`, prefix: "us-gaap", localName: member, namespaceUri: "http://fasb.org/us-gaap/2025" },
  }];
}

function audit(ticker: string) {
  const found = auditFixture.issuers.find((sample) => sample.ticker === ticker);
  assert.ok(found, ticker);
  return found;
}
