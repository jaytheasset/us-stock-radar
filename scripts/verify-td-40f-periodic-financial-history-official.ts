import assert from "node:assert/strict";
import {
  SecFilingXbrlHttpClient,
  parseSecFilingXbrlArtifacts,
  type SecFilingXbrlRawArtifact,
} from "../lib/sec-structured-data/filingXbrlContext.ts";
import { SecStructuredHttpClient } from "../lib/sec-structured-data/httpClient.ts";
import { normalizeSecStructuredDocuments } from "../lib/sec-structured-data/normalization.ts";
import { resolvePeriodicFinancialHistory } from "../lib/sec-structured-data/periodicFinancialHistory.ts";
import {
  resolvePeriodicFinancials,
  type SecPeriodicFinancialMetric,
  type SecPeriodicFinancialObservation,
} from "../lib/sec-structured-data/periodicFinancialResolver.ts";
import { SecRequestPolicy } from "../lib/sec-structured-data/secRequestPolicy.ts";

const CIK = "0000947263";
const ACCESSION = "0001562762-25-000289";
const FETCHED_AT = new Date().toISOString();
const USER_AGENT = process.env.SEC_USER_AGENT
  || "US-Stock-Radar official-source audit engineering@openai.com";

const EXPECTED_FILING_SOURCES = [
  {
    role: "inline_xbrl",
    documentName: "40f20251031.htm",
    sourceUrl: "https://www.sec.gov/Archives/edgar/data/947263/000156276225000289/40f20251031.htm",
    contentHash: "4f4c6b0bac6ddf871f0f357d3b2e2820c311ccb34fc4200c0e46a3ac0030956a",
    artifactId: "3acacc53-e43a-5d85-a5f8-6a9660855160",
  },
  {
    role: "inline_xbrl",
    documentName: "ex992.htm",
    sourceUrl: "https://www.sec.gov/Archives/edgar/data/947263/000156276225000289/ex992.htm",
    contentHash: "128ebfe20c9f44c416ceb07799ce08a4be99a99a2c0aae98461f0178488054a7",
    artifactId: "74f9ea43-3edb-5570-b655-29959f255086",
  },
  {
    role: "inline_xbrl",
    documentName: "ex993.htm",
    sourceUrl: "https://www.sec.gov/Archives/edgar/data/947263/000156276225000289/ex993.htm",
    contentHash: "29e0d779f65e26d355a7a43bf114f70c957666bdc21602cba689381fb2117e69",
    artifactId: "cec70801-1293-5cd9-aa6e-9fbb3fc102ac",
  },
] as const;

const EXPECTED_VALUES: Readonly<Record<Exclude<SecPeriodicFinancialMetric, "OPERATING_INCOME_LOSS">, {
  basis: "ANNUAL" | "INSTANT";
  current: string;
  prior: string;
}>> = {
  REVENUE: { basis: "ANNUAL", current: "67777000000", prior: "57223000000" },
  NET_INCOME_LOSS: { basis: "ANNUAL", current: "20538000000", prior: "8842000000" },
  OPERATING_CASH_FLOW: { basis: "ANNUAL", current: "-69646000000", prior: "54937000000" },
  CASH: { basis: "INSTANT", current: "7512000000", prior: "6437000000" },
};

const requestPolicy = new SecRequestPolicy(USER_AGENT, { minimumIntervalMs: 125 });
const now = () => new Date(FETCHED_AT);
const structuredClient = new SecStructuredHttpClient(USER_AGENT, 125, fetch, now, requestPolicy);
const filingClient = new SecFilingXbrlHttpClient(USER_AGENT, fetch, now, 125, requestPolicy);

const submissions = await structuredClient.fetchSubmissions(CIK, "incremental");
const companyFactsDocument = await structuredClient.fetchCompanyFacts(CIK, "incremental");
const normalized = normalizeSecStructuredDocuments(
  [...submissions, companyFactsDocument],
  FETCHED_AT,
);
const filing = normalized.filings.find((row) => row.accessionNumber === ACCESSION);
assert.ok(filing, "TD accession must exist in official SEC Submissions");
assert.deepEqual({
  accessionNumber: filing.accessionNumber,
  issuerCik: filing.issuerCik,
  form: filing.form,
  filedDate: filing.filedDate,
  acceptedAt: filing.acceptedAt,
  reportDate: filing.reportDate,
  primaryDocument: filing.primaryDocument,
  isXbrl: filing.isXbrl,
  isInlineXbrl: filing.isInlineXbrl,
}, {
  accessionNumber: ACCESSION,
  issuerCik: CIK,
  form: "40-F",
  filedDate: "2025-12-04",
  acceptedAt: "2025-12-04T22:28:42.000Z",
  reportDate: "2025-10-31",
  primaryDocument: "40f20251031.htm",
  isXbrl: true,
  isInlineXbrl: true,
});

const fetched = await filingClient.fetchFilingArtifacts(filing);
if (fetched.status !== "AVAILABLE") throw new Error(fetched.detail);
assert.deepEqual(
  fetched.discovery.primaryIxdsDocuments.map((row) => row.documentName),
  EXPECTED_FILING_SOURCES.map((row) => row.documentName),
  "the product source client must discover the complete official IXDS",
);
const extractedInstance = fetched.discovery.documents.filter((row) => row.isInstanceCandidate);
assert.deepEqual(extractedInstance.map((row) => ({
  documentName: row.documentName,
  sourceUrl: row.sourceUrl,
})), [{
  documentName: "40f20251031_htm.xml",
  sourceUrl: "https://www.sec.gov/Archives/edgar/data/947263/000156276225000289/40f20251031_htm.xml",
}]);

for (const expected of EXPECTED_FILING_SOURCES) {
  const artifact: SecFilingXbrlRawArtifact | undefined = fetched.artifacts.find(
    (row) => row.documentName === expected.documentName,
  );
  assert.ok(artifact, `${expected.documentName} must be fetched from the official filing inventory`);
  assert.deepEqual({
    role: artifact.role,
    sourceUrl: artifact.sourceUrl,
    sourceIdentity: artifact.sourceIdentity,
    contentHash: artifact.contentHash,
    artifactId: artifact.id,
    issuerCik: artifact.issuerCik,
    accession: artifact.accession,
    rawContentKind: artifact.rawContentKind,
  }, {
    role: expected.role,
    sourceUrl: expected.sourceUrl,
    sourceIdentity: expected.sourceUrl,
    contentHash: expected.contentHash,
    artifactId: expected.artifactId,
    issuerCik: CIK,
    accession: ACCESSION,
    rawContentKind: "authoritative_http_body",
  });
}

const parsed = parseSecFilingXbrlArtifacts(fetched.artifacts);
if (parsed.status !== "AVAILABLE") throw new Error(parsed.detail);
assert.equal(parsed.documentKind, "inline_xbrl_ixds");
assert.ok(parsed.facts.length > 8_000, "the official IXDS must produce the full filing fact set");

const resolution = resolvePeriodicFinancials({
  issuerCik: CIK,
  targetAccession: ACCESSION,
  filings: normalized.filings,
  companyFacts: normalized.facts,
  filingXbrl: parsed,
});
assert.equal(resolution.currentness.status, "CURRENT");

for (const [metric, expected] of Object.entries(EXPECTED_VALUES) as Array<
  [Exclude<SecPeriodicFinancialMetric, "OPERATING_INCOME_LOSS">, (typeof EXPECTED_VALUES)[Exclude<SecPeriodicFinancialMetric, "OPERATING_INCOME_LOSS">]]
>) {
  const decision = resolution.decisions.find((row) => row.metric === metric);
  assert.ok(decision && decision.status === "RESOLVED", `${metric} must resolve from official sources`);
  const resolved = decision as SecPeriodicFinancialObservation;
  assert.equal(resolved.basis, expected.basis, metric);
  assert.equal(resolved.current.normalizedValue, expected.current, metric);
  assert.equal(resolved.priorYear?.normalizedValue, expected.prior, metric);
  assert.equal(resolved.current.accession, ACCESSION, metric);
  assert.ok(resolved.current.companyFacts.length > 0, `${metric} must link to official CompanyFacts`);
  assert.ok(resolved.current.filingFacts.length > 0, `${metric} must link to parsed filing facts`);
  for (const fact of [...resolved.current.filingFacts, ...(resolved.priorYear?.filingFacts ?? [])]) {
    const expectedSource = EXPECTED_FILING_SOURCES.find((source) => source.documentName === fact.source.documentName);
    assert.ok(expectedSource, `${metric} fact must retain an audited official document source`);
    assert.deepEqual({
      artifactId: fact.source.artifactId,
      issuerCik: fact.source.issuerCik,
      accession: fact.source.accession,
      documentName: fact.source.documentName,
      sourceUrl: fact.source.sourceUrl,
      contentHash: fact.source.contentHash,
      rawContentKind: fact.source.rawContentKind,
    }, {
      artifactId: expectedSource.artifactId,
      issuerCik: CIK,
      accession: ACCESSION,
      documentName: expectedSource.documentName,
      sourceUrl: expectedSource.sourceUrl,
      contentHash: expectedSource.contentHash,
      rawContentKind: "authoritative_http_body",
    });
  }
}

const operatingIncome = resolution.decisions.find((row) => row.metric === "OPERATING_INCOME_LOSS");
assert.ok(operatingIncome && operatingIncome.status === "UNAVAILABLE");
assert.equal(operatingIncome.reason, "STANDARD_OR_REVIEWED_CONCEPT_NOT_FOUND");

const history = resolvePeriodicFinancialHistory({
  issuerCik: CIK,
  filings: normalized.filings,
  companyFacts: normalized.facts,
  filingInputs: [{ targetAccession: ACCESSION, filingXbrl: parsed }],
});
assert.equal(history.quarterly.length, 0);
assert.equal(history.annual.length, 4);
assert.deepEqual(
  history.unavailable.map((row) => [row.metric, row.reason]),
  [["OPERATING_INCOME_LOSS", "STANDARD_OR_REVIEWED_CONCEPT_NOT_FOUND"]],
);
for (const [metric, expected] of Object.entries(EXPECTED_VALUES)) {
  const series = history.annual.find((row) => row.identity.metric === metric);
  assert.ok(series, `${metric} annual history series must exist`);
  assert.deepEqual(
    series.points.map((point) => point.status === "RESOLVED" ? point.normalizedValue : null),
    [expected.prior, expected.current],
    `${metric} history values`,
  );
}

const rawSourceAudit = normalized.rawSources.map((source) => ({
  sourceKind: source.sourceKind,
  sourceUrl: source.sourceUrl,
  sourceIdentity: source.sourceIdentity,
  sourceRawId: source.id,
  contentHash: source.contentHash,
  rawContentKind: source.rawContentKind,
}));
assert.equal(rawSourceAudit.every((source) => source.rawContentKind === "authoritative_http_body"), true);

console.log(JSON.stringify({
  status: "PASS",
  audit: "TD 2025 40-F official SEC parser -> resolver -> history",
  accession: ACCESSION,
  filing,
  structuredSources: rawSourceAudit,
  filingSources: fetched.artifacts.map((artifact) => ({
    role: artifact.role,
    documentName: artifact.documentName,
    sourceUrl: artifact.sourceUrl,
    sourceIdentity: artifact.sourceIdentity,
    contentHash: artifact.contentHash,
    artifactId: artifact.id,
    issuerCik: artifact.issuerCik,
    accession: artifact.accession,
    rawContentKind: artifact.rawContentKind,
  })),
  discoveredExtractedInstance: extractedInstance,
  parser: {
    documentKind: parsed.documentKind,
    facts: parsed.facts.length,
    rejections: parsed.rejections.length,
  },
  normalization: {
    acceptedFilings: normalized.filings.length,
    acceptedFacts: normalized.facts.length,
    rejectedHistoricalFactsWithoutIncrementalLedgerRows: normalized.rejections.length,
  },
  resolver: resolution.decisions.map((decision) => decision.status === "RESOLVED"
    ? {
        metric: decision.metric,
        status: decision.status,
        basis: decision.basis,
        current: decision.current.normalizedValue,
        priorYear: decision.priorYear?.normalizedValue ?? null,
        documents: [...new Set(decision.current.filingFacts.map((fact) => fact.source.documentName))].sort(),
      }
    : { metric: decision.metric, status: decision.status, reason: decision.reason }),
  history: history.annual.map((series) => ({
    metric: series.identity.metric,
    basis: series.identity.basis,
    points: series.points.map((point) => point.status === "RESOLVED" ? point.normalizedValue : null),
  })),
}, null, 2));
