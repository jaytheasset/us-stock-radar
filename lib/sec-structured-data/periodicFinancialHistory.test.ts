import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  SEC_PERIODIC_FINANCIAL_HISTORY_VERSION,
  resolvePeriodicFinancialHistory,
  type SecPeriodicFinancialSeries,
} from "./periodicFinancialHistory.ts";
import type { SecPeriodicFinancialMetric } from "./periodicFinancialResolver.ts";
import type {
  SecFilingXbrlDocumentSet,
  SecFilingXbrlFact,
  SecXbrlDimension,
} from "./filingXbrlContext.ts";
import type { SecCompanyFactRow, SecFilingRow } from "./types.ts";

type AuditTuple = [
  metric: SecPeriodicFinancialMetric,
  concept: string,
  contextRef: string,
  startDate: string | null,
  endOrInstant: string,
  lexical: string,
  numeric: string,
  fiscalPeriod: string,
  frame: string | null,
  dimensionCount: number,
  sign?: string,
];

type AuditFiling = {
  label: string;
  cik: string;
  accession: string;
  form: string;
  filedDate: string;
  acceptedAt: string;
  reportDate: string;
  document: string;
  sourceUrl: string;
  contentHash: string;
  taxonomy: string;
  namespaceUri: string;
  currency: string;
  facts: AuditTuple[];
  duplicateDocument?: string;
  duplicateSourceUrl?: string;
  duplicateContentHash?: string;
};

const fixture = JSON.parse(await readFile(
  new URL("./fixtures/periodic-financial-four-form-audit.json", import.meta.url),
  "utf8",
)) as { attribution: Record<string, unknown>; filings: AuditFiling[] };

test("official AAPL accessions produce separate deterministic quarterly and annual history", () => {
  const prepared = prepareMany([
    sample("AAPL 2026 Q3 10-Q"),
    sample("AAPL 2025 Q3 10-Q"),
    sample("AAPL 2025 10-K"),
    sample("AAPL 2024 10-K"),
  ]);
  const result = resolvePrepared(prepared);

  assert.equal(result.decisionVersion, SEC_PERIODIC_FINANCIAL_HISTORY_VERSION);
  assert.equal(result.gptDependency, false);
  assert.equal(result.filingResolutions.length, 4);
  assert.equal(result.unavailable.filter((row) =>
    row.targetAccession === "0000320193-25-000073"
    && row.reason === "PERIOD_BASIS_AMBIGUOUS"
  ).length, 3);
  assert.equal(result.quarterly.every((series) => series.identity.formFamily === "10-Q"), true);
  assert.equal(result.annual.every((series) => series.identity.formFamily === "10-K"), true);
  const emittedBases: string[] = [...result.quarterly, ...result.annual].map((series) => series.identity.basis);
  assert.equal(emittedBases.includes("YEAR_TO_DATE"), false);
  assert.equal(result.nonSeriesDecisions.length, 5);
  assert.equal(result.nonSeriesDecisions.every((row) => row.observation.basis === "YEAR_TO_DATE"), true);

  const q2024TaxonomyCash = findSeries(result.quarterly, {
    metric: "CASH",
    basis: "INSTANT",
    namespace: "http://fasb.org/us-gaap/2024",
  });
  assert.deepEqual(values(q2024TaxonomyCash), ["36269000000"]);
  assert.deepEqual(periodEnds(q2024TaxonomyCash), ["2025-06-28"]);

  const q2025Taxonomy = findSeries(result.quarterly, {
    metric: "REVENUE",
    basis: "QUARTER",
    namespace: "http://fasb.org/us-gaap/2025",
  });
  assert.deepEqual(values(q2025Taxonomy), ["94036000000", "109417000000"]);
  assert.deepEqual(periodEnds(q2025Taxonomy), ["2025-06-28", "2026-06-27"]);

  const annual2024Taxonomy = findSeries(result.annual, {
    metric: "REVENUE",
    basis: "ANNUAL",
    namespace: "http://fasb.org/us-gaap/2024",
  });
  assert.deepEqual(values(annual2024Taxonomy), ["383285000000", "391035000000"]);
  assert.equal(annual2024Taxonomy.points[1]!.claims[0]!.evidence.filingFacts[0]!.source.contentHash,
    "24a830a0f1256e371d36a1f7f72e5e85a38037d1de2f6f966eb8457db42ff6d6");
  assert.equal(annual2024Taxonomy.points[1]!.claims[0]!.evidence.companyFacts[0]!.frame, null);
  const annual2025Taxonomy = findSeries(result.annual, {
    metric: "REVENUE",
    basis: "ANNUAL",
    namespace: "http://fasb.org/us-gaap/2025",
  });
  assert.deepEqual(values(annual2025Taxonomy), ["391035000000", "416161000000"]);

  const linked2025Quarter = q2025Taxonomy.points[0]!;
  assert.equal(linked2025Quarter.status, "RESOLVED");
  assert.equal(linked2025Quarter.claims[0]!.sourceRole, "PRIOR_YEAR");
  assert.equal(linked2025Quarter.claims[0]!.resolver.targetAccession, "0000320193-26-000020");
  assert.equal(linked2025Quarter.claims[0]!.resolver.currentness.status, "CURRENT");
  assert.equal(linked2025Quarter.claims[0]!.evidence.companyFacts.length > 0, true);
  assert.equal(linked2025Quarter.claims[0]!.evidence.filingFacts[0]!.source.contentHash,
    "4ad5bea67cedfa7542d623900355cc8d143ef95c1acc135a597f2eedabdb9177");
});

test("official 20-F history remains form-, taxonomy-, concept-, currency-, and namespace-scoped", () => {
  const prepared = prepareMany([
    sample("WIX 2025 20-F US-GAAP FPI"),
    sample("WIX 2024 20-F US-GAAP FPI"),
  ]);
  const result = resolvePrepared(prepared);
  assert.equal(result.quarterly.length, 0);
  assert.equal(result.unavailable.length, 0);
  assert.equal(result.annual.every((series) =>
    series.identity.formFamily === "20-F"
    && series.identity.unit === "USD"
    && series.identity.taxonomy === "us-gaap"
  ), true);

  const revenue2024 = findSeries(result.annual, {
    metric: "REVENUE",
    basis: "ANNUAL",
    namespace: "http://fasb.org/us-gaap/2024",
  });
  assert.deepEqual(values(revenue2024), ["1561665000", "1760650000"]);
  assert.equal(revenue2024.points[1]!.claims[0]!.evidence.filingFacts[0]!.source.contentHash,
    "b3b6a32a25e22e862eab935e00bddea4aa48dbb2857a1aee8089bffeda36203b");
  const revenue2025 = findSeries(result.annual, {
    metric: "REVENUE",
    basis: "ANNUAL",
    namespace: "http://fasb.org/us-gaap/2025",
  });
  assert.deepEqual(values(revenue2025), ["1760650000", "1993044000"]);
});

test("synthetic 40-F contract survives while its unreviewed original/amendment family contributes no point", () => {
  const current = prepareMany([sample("Synthetic IFRS 40-F contract")]);
  const original: SecFilingRow = {
    accessionNumber: "0000000001-24-000001",
    issuerCik: "0000000001",
    form: "40-F",
    filedDate: "2024-12-06",
    acceptedAt: "2024-12-05T23:22:17.000Z",
    reportDate: "2024-10-31",
    primaryDocument: "40f20241031.htm",
    isXbrl: true,
    isInlineXbrl: true,
    sourceRawId: "0000000001-submissions-source",
    sourceKind: "submissions",
    ingestedAt: "2026-09-07T00:00:00.000Z",
  };
  const amendment: SecFilingRow = {
    ...original,
    accessionNumber: "0000000001-24-000002",
    form: "40-F/A",
    filedDate: "2024-12-09",
    acceptedAt: "2024-12-09T11:30:05.000Z",
    primaryDocument: "edgar024annualreport.htm",
    sourceRawId: "0000000001-submissions-amendment-source",
  };
  const result = resolvePeriodicFinancialHistory({
    issuerCik: "0000000001",
    filings: [...current.filings, original, amendment],
    companyFacts: current.companyFacts,
    filingInputs: [...current.filingInputs, {
      targetAccession: original.accessionNumber,
      filingXbrl: {
        status: "UNAVAILABLE",
        reason: "FILING_ARTIFACT_MISSING",
        detail: "not needed because currentness fails before XBRL resolution",
        sources: [],
      },
    }],
  });

  assert.equal(result.annual.some((series) => series.identity.formFamily === "40-F"), true);
  assert.equal(result.unavailable.filter((row) =>
    row.targetAccession === original.accessionNumber
    && row.reason === "AMENDMENT_CURRENTNESS_REQUIRES_REVIEW"
  ).length, 5);
  assert.equal(result.annual.flatMap((series) => series.points)
    .flatMap((point) => point.claims)
    .some((claim) => claim.resolver.targetAccession === original.accessionNumber), false);

  const operating = result.unavailable.find((row) =>
    row.targetAccession === "0000000001-25-000001"
    && row.metric === "OPERATING_INCOME_LOSS"
  );
  assert.equal(operating?.reason, "STANDARD_OR_REVIEWED_CONCEPT_NOT_FOUND");
  const cash = findSeries(result.annual, {
    metric: "CASH",
    basis: "INSTANT",
    namespace: "https://xbrl.ifrs.org/taxonomy/2024-03-27/ifrs-full",
  });
  assert.equal(cash.points[1]!.claims[0]!.evidence.filingFacts.length, 2);
});

test("same-identity cross-accession disagreement becomes an unavailable point with both proven claims", () => {
  const prepared = prepareMany([
    sample("AAPL 2025 10-K"),
    sample("AAPL 2024 10-K"),
  ]);
  const earlier = prepared.byAccession.get("0000320193-24-000123")!;
  for (const fact of earlier.filingXbrl.facts) {
    fact.concept = { ...fact.concept, namespaceUri: "http://fasb.org/us-gaap/2025" };
  }
  const conflictingFilingFact = earlier.filingXbrl.facts.find((fact) =>
    fact.concept.localName === "RevenueFromContractWithCustomerExcludingAssessedTax"
    && fact.context.period.kind === "duration"
    && fact.context.period.endDate === "2024-09-28"
  )!;
  conflictingFilingFact.valueText = "391,034";
  const conflictingCompanyFact = earlier.companyFacts.find((fact) =>
    fact.concept === "RevenueFromContractWithCustomerExcludingAssessedTax"
    && fact.endDate === "2024-09-28"
  )!;
  conflictingCompanyFact.valueNumeric = "391034000000";

  const result = resolvePrepared(prepared);
  const series = findSeries(result.annual, {
    metric: "REVENUE",
    basis: "ANNUAL",
    namespace: "http://fasb.org/us-gaap/2025",
  });
  const conflict = series.points.find((point) => periodEnd(point.period) === "2024-09-28")!;
  assert.equal(conflict.status, "UNAVAILABLE");
  if (conflict.status !== "UNAVAILABLE") throw new Error("expected unavailable conflict");
  assert.equal(conflict.reason, "CROSS_ACCESSION_VALUE_CONFLICT");
  assert.deepEqual(conflict.conflictingValues, ["391034000000", "391035000000"]);
  assert.deepEqual(conflict.claims.map((claim) => claim.resolver.targetAccession).sort(), [
    "0000320193-24-000123",
    "0000320193-25-000079",
  ]);
});

test("same-identity exact agreement merges only the point and retains both accession lineages", () => {
  const prepared = prepareMany([
    sample("AAPL 2025 10-K"),
    sample("AAPL 2024 10-K"),
  ]);
  const earlier = prepared.byAccession.get("0000320193-24-000123")!;
  for (const fact of earlier.filingXbrl.facts) {
    fact.concept = { ...fact.concept, namespaceUri: "http://fasb.org/us-gaap/2025" };
  }

  const result = resolvePrepared(prepared);
  const series = findSeries(result.annual, {
    metric: "REVENUE",
    basis: "ANNUAL",
    namespace: "http://fasb.org/us-gaap/2025",
  });
  const overlap = series.points.find((point) => periodEnd(point.period) === "2024-09-28")!;
  assert.equal(overlap.status, "RESOLVED");
  assert.deepEqual(overlap.claims.map((claim) => ({
    accession: claim.resolver.targetAccession,
    role: claim.sourceRole,
    value: claim.evidence.normalizedValue,
  })), [
    { accession: "0000320193-24-000123", role: "CURRENT", value: "391035000000" },
    { accession: "0000320193-25-000079", role: "PRIOR_YEAR", value: "391035000000" },
  ]);
});

test("history replay is stable under reordered filing, source, fact, and accession input", () => {
  const prepared = prepareMany([
    sample("AAPL 2026 Q3 10-Q"),
    sample("AAPL 2025 Q3 10-Q"),
    sample("AAPL 2025 10-K"),
    sample("AAPL 2024 10-K"),
  ]);
  const first = resolvePrepared(prepared);
  const replay = resolvePeriodicFinancialHistory({
    issuerCik: prepared.issuerCik,
    filings: [...prepared.filings].reverse(),
    companyFacts: [...prepared.companyFacts].reverse(),
    filingInputs: [...prepared.filingInputs].reverse().map((row) => ({
      ...row,
      filingXbrl: row.filingXbrl.status === "AVAILABLE" ? {
        ...row.filingXbrl,
        facts: [...row.filingXbrl.facts].reverse(),
        sources: [...row.filingXbrl.sources].reverse(),
      } : row.filingXbrl,
    })),
  });
  assert.deepEqual(replay, first);
});

test("duplicate accession inputs are unavailable rather than order-selected", () => {
  const prepared = prepareMany([sample("AAPL 2025 10-K")]);
  const duplicate = prepared.filingInputs[0]!;
  const result = resolvePeriodicFinancialHistory({
    issuerCik: prepared.issuerCik,
    filings: prepared.filings,
    companyFacts: prepared.companyFacts,
    filingInputs: [duplicate, structuredClone(duplicate)],
  });
  assert.equal(result.filingResolutions.length, 0);
  assert.equal(result.annual.length, 0);
  assert.equal(result.unavailable.length, 5);
  assert.equal(result.unavailable.every((row) => row.reason === "DUPLICATE_ACCESSION_INPUT"), true);
});

test("a duplicate original filing family is rejected by the production currentness gate", () => {
  const prepared = prepareMany([sample("AAPL 2024 10-K")]);
  const duplicate: SecFilingRow = {
    ...prepared.filings[0]!,
    accessionNumber: "0000320193-24-999999",
    acceptedAt: "2024-11-01T11:01:36.000Z",
    sourceRawId: "0000320193-submissions-duplicate-source",
  };
  const result = resolvePeriodicFinancialHistory({
    issuerCik: prepared.issuerCik,
    filings: [...prepared.filings, duplicate],
    companyFacts: prepared.companyFacts,
    filingInputs: prepared.filingInputs,
  });
  assert.equal(result.annual.length, 0);
  assert.equal(result.unavailable.length, 5);
  assert.equal(result.unavailable.every((row) =>
    row.status === "AMBIGUOUS" && row.reason === "DUPLICATE_FILING_REQUIRES_REVIEW"
  ), true);
});

function resolvePrepared(prepared: ReturnType<typeof prepareMany>) {
  return resolvePeriodicFinancialHistory({
    issuerCik: prepared.issuerCik,
    filings: prepared.filings,
    companyFacts: prepared.companyFacts,
    filingInputs: prepared.filingInputs,
  });
}

function prepareMany(auditedFilings: AuditFiling[]) {
  assert.ok(auditedFilings.length > 0);
  const prepared = auditedFilings.map(prepare);
  const issuerCik = prepared[0]!.filing.issuerCik;
  assert.equal(prepared.every((row) => row.filing.issuerCik === issuerCik), true);
  return {
    issuerCik,
    filings: prepared.map((row) => row.filing),
    companyFacts: prepared.flatMap((row) => row.companyFacts),
    filingInputs: prepared.map((row) => ({
      targetAccession: row.filing.accessionNumber,
      filingXbrl: row.filingXbrl,
    })),
    byAccession: new Map(prepared.map((row) => [row.filing.accessionNumber, row])),
  };
}

function prepare(audited: AuditFiling) {
  const filing: SecFilingRow = {
    accessionNumber: audited.accession,
    issuerCik: audited.cik,
    form: audited.form,
    filedDate: audited.filedDate,
    acceptedAt: audited.acceptedAt,
    reportDate: audited.reportDate,
    primaryDocument: audited.document,
    isXbrl: true,
    isInlineXbrl: true,
    sourceRawId: `${audited.cik}-submissions-source`,
    sourceKind: "submissions",
    ingestedAt: "2026-09-07T00:00:00.000Z",
  };
  const filingFacts: SecFilingXbrlFact[] = [];
  const companyFacts: SecCompanyFactRow[] = [];
  audited.facts.forEach((tuple, index) => {
    const built = buildFact(audited, tuple, index, audited.document, audited.sourceUrl, audited.contentHash);
    filingFacts.push(built.filingFact);
    if (built.companyFact) companyFacts.push(built.companyFact);
    if (audited.duplicateDocument && tuple[0] === "CASH") {
      filingFacts.push(buildFact(
        audited,
        tuple,
        index + 10_000,
        audited.duplicateDocument,
        audited.duplicateSourceUrl!,
        audited.duplicateContentHash!,
      ).filingFact);
    }
  });
  const filingXbrl: SecFilingXbrlDocumentSet = {
    status: "AVAILABLE",
    documentKind: "inline_xbrl_ixds",
    contexts: [],
    units: [],
    facts: filingFacts,
    rejections: [],
    sources: uniqueSources(filingFacts),
  };
  return { filing, filingXbrl, companyFacts };
}

function buildFact(
  audited: AuditFiling,
  tuple: AuditTuple,
  index: number,
  documentName: string,
  sourceUrl: string,
  contentHash: string,
) {
  const [metric, concept, contextRef, startDate, endOrInstant, lexical, numeric, fiscalPeriod, frame, dimensionCount, sign] = tuple;
  const instant = metric === "CASH";
  const dimensions = Array.from({ length: dimensionCount }, (_, dimensionIndex): SecXbrlDimension => ({
    kind: "explicit",
    axis: { qname: `audit:Axis${dimensionIndex}`, prefix: "audit", localName: `Axis${dimensionIndex}`, namespaceUri: "https://example.test/audit" },
    member: { qname: `audit:Member${dimensionIndex}`, prefix: "audit", localName: `Member${dimensionIndex}`, namespaceUri: "https://example.test/audit" },
  }));
  const scale = audited.label.startsWith("WIX") ? "3" : "6";
  const format = audited.taxonomy === "ifrs-full" ? "ixt:numdotdecimal" : "ixt:num-dot-decimal";
  const filingFact: SecFilingXbrlFact = {
    factKey: `${audited.accession}:${index}:${concept}:${contextRef}:${documentName}`,
    concept: { qname: `${audited.taxonomy}:${concept}`, prefix: audited.taxonomy, localName: concept, namespaceUri: audited.namespaceUri },
    valueText: lexical,
    valueTree: lexical,
    contextRef,
    unitRef: audited.currency,
    unit: {
      id: audited.currency,
      kind: "measure",
      measure: { qname: `iso4217:${audited.currency}`, prefix: "iso4217", localName: audited.currency, namespaceUri: "http://www.xbrl.org/2003/iso4217" },
    },
    decimals: `-${scale}`,
    precision: null,
    scale,
    sign: sign ?? null,
    inlineFormat: format,
    isNil: false,
    context: {
      id: contextRef,
      entityIdentifier: audited.cik,
      entityScheme: "http://www.sec.gov/CIK",
      period: instant ? { kind: "instant", instant: endOrInstant } : { kind: "duration", startDate: startDate!, endDate: endOrInstant },
      dimensions,
    },
    source: {
      artifactId: `artifact:${audited.accession}:${documentName}:${contentHash}`,
      issuerCik: audited.cik,
      accession: audited.accession,
      documentName,
      sourceUrl,
      contentHash,
      fetchedAt: "2026-09-07T00:00:00.000Z",
      rawContentKind: "injected_exact_body",
    },
  };
  const companyFact: SecCompanyFactRow | null = dimensionCount > 0 ? null : {
    sourceFactKey: `${audited.accession}:${index}:companyfacts`,
    sourceFactPath: `facts.${audited.taxonomy}.${concept}.units.${audited.currency}[${index}]`,
    issuerCik: audited.cik,
    filingAccession: audited.accession,
    form: audited.form,
    filedDate: audited.filedDate,
    sourceRawId: `${audited.cik}-companyfacts-source`,
    sourceKind: "companyfacts",
    contextKind: "companyfacts_implicit",
    taxonomy: audited.taxonomy,
    concept,
    unit: audited.currency,
    valueKind: "numeric",
    valueNumeric: numeric,
    valueText: null,
    instantDate: instant ? endOrInstant : null,
    startDate: instant ? null : startDate,
    endDate: instant ? null : endOrInstant,
    fiscalYear: Number(audited.reportDate.slice(0, 4)),
    fiscalPeriod,
    frame,
    ingestedAt: "2026-09-07T00:00:00.000Z",
  };
  return { filingFact, companyFact };
}

function sample(label: string) {
  const found = fixture.filings.find((filing) => filing.label === label);
  assert.ok(found, label);
  return structuredClone(found);
}

function findSeries(
  series: SecPeriodicFinancialSeries[],
  input: { metric: SecPeriodicFinancialMetric; basis: string; namespace: string },
) {
  const found = series.find((row) =>
    row.identity.metric === input.metric
    && row.identity.basis === input.basis
    && row.identity.conceptNamespaceUri === input.namespace
  );
  assert.ok(found, `${input.metric}/${input.basis}/${input.namespace}`);
  return found;
}

function values(series: SecPeriodicFinancialSeries) {
  return series.points.map((point) => point.status === "RESOLVED" ? point.normalizedValue : "UNAVAILABLE");
}

function periodEnds(series: SecPeriodicFinancialSeries) {
  return series.points.map((point) => periodEnd(point.period));
}

function periodEnd(period: SecPeriodicFinancialSeries["points"][number]["period"]) {
  return period.kind === "instant" ? period.instant : period.endDate;
}

function uniqueSources(facts: SecFilingXbrlFact[]) {
  const seen = new Set<string>();
  return facts.flatMap((fact) => {
    const key = `${fact.source.documentName}:${fact.source.contentHash}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [fact.source];
  });
}
