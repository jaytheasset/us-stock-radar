import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  SEC_PERIODIC_FINANCIAL_DECISION_VERSION,
  normalizeFilingDecimal,
  resolvePeriodicFinancials,
  type SecPeriodicFinancialMetric,
  type SecPeriodicFinancialObservation,
} from "./periodicFinancialResolver.ts";
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

test("decision contract is versioned and has no GPT dependency", () => {
  assert.equal(SEC_PERIODIC_FINANCIAL_DECISION_VERSION, "periodic-financial-resolver-v1");
  const result = resolveSample(sample("AAPL 2025 10-K"));
  assert.equal(result.gptDependency, false);
  assert.equal(JSON.stringify(result).toLowerCase().includes("gpt"), true);
  assert.equal(JSON.stringify(result).toLowerCase().includes("ai_output"), false);
});

test("official AAPL 10-Q separates quarter and YTD, preserves exact lineage, and does not invent quarter OCF", () => {
  const audited = sample("AAPL 2026 Q3 10-Q");
  const result = resolveSample(audited);
  assert.equal(result.currentness.status, "CURRENT");
  const revenue = resolved(result.decisions, "REVENUE");
  assert.deepEqual(revenue.map((row) => row.basis).sort(), ["QUARTER", "YEAR_TO_DATE"]);
  assert.deepEqual(revenue.map((row) => row.current.normalizedValue).sort(), ["109417000000", "364357000000"]);
  assert.deepEqual(revenue.map((row) => row.priorYear?.normalizedValue).sort(), ["313695000000", "94036000000"]);
  assert.equal(revenue.every((row) => row.current.financialScope === "UNDIMENSIONED"), true);
  assert.equal(revenue.every((row) => row.current.accession === audited.accession), true);
  assert.equal(revenue.every((row) => row.current.companyFacts.every((fact) => fact.sourceFactPath.startsWith("facts.us-gaap."))), true);
  assert.equal(revenue.every((row) => row.current.filingFacts.every((fact) => fact.source.contentHash === audited.contentHash)), true);
  assert.equal(revenue.every((row) => row.rejectedDimensionalFactKeys.length === 1), true);

  const ocf = resolved(result.decisions, "OPERATING_CASH_FLOW");
  assert.deepEqual(ocf.map((row) => row.basis), ["YEAR_TO_DATE"]);
  assert.equal(ocf[0]!.current.normalizedValue, "116996000000");
  assert.equal(result.decisions.some((row) => row.metric === "OPERATING_CASH_FLOW" && row.basis === "QUARTER"), false);

  const cash = onlyResolved(result.decisions, "CASH");
  assert.equal(cash.basis, "INSTANT");
  assert.equal(cash.current.period.kind, "instant");
  assert.equal(cash.current.normalizedValue, "39544000000");
  assert.equal(cash.priorYear, null);
  assert.equal(cash.priorYearStatus.reason, "PRIOR_YEAR_COMPARABLE_NOT_FOUND");
});

test("official AAPL 10-K isolates annual facts and returns exact annual/instant pairs", () => {
  const result = resolveSample(sample("AAPL 2025 10-K"));
  for (const metric of ["REVENUE", "OPERATING_INCOME_LOSS", "NET_INCOME_LOSS", "OPERATING_CASH_FLOW"] as const) {
    const row = onlyResolved(result.decisions, metric);
    assert.equal(row.basis, "ANNUAL", metric);
    assert.equal(row.current.period.kind, "duration", metric);
    assert.ok(row.priorYear, metric);
    assert.equal(row.priorYear?.basis, "ANNUAL", metric);
    assert.equal(row.current.currency, "USD", metric);
  }
  const cash = onlyResolved(result.decisions, "CASH");
  assert.equal(cash.current.period.kind, "instant");
  assert.equal(cash.priorYear?.period.kind, "instant");
  assert.equal(cash.current.normalizedValue, "35934000000");
  assert.equal(cash.priorYear?.normalizedValue, "29943000000");
});

test("official 20-F accepts the actual US-GAAP basis without assuming IFRS or ADS/share semantics", () => {
  const audited = sample("WIX 2025 20-F US-GAAP FPI");
  const result = resolveSample(audited);
  assert.equal(resolved(result.decisions).length, 5);
  for (const row of resolved(result.decisions)) {
    assert.equal(row.current.taxonomy, "us-gaap");
    assert.match(row.current.conceptNamespaceUri, /^http:\/\/fasb\.org\/us-gaap\/2025$/);
    assert.equal(row.current.currency, "USD");
    assert.equal(row.current.accession, audited.accession);
    assert.ok(row.priorYear);
  }
});

test("official IFRS 40-F resolves supported metrics, preserves exact duplicate sources, and leaves operating income unavailable", () => {
  const audited = sample("Toronto-Dominion Bank 2025 40-F IFRS");
  const result = resolveSample(audited);
  assert.deepEqual(resolved(result.decisions).map((row) => row.metric).sort(), [
    "CASH", "NET_INCOME_LOSS", "OPERATING_CASH_FLOW", "REVENUE",
  ]);
  const operating = result.decisions.find((row) => row.metric === "OPERATING_INCOME_LOSS")!;
  assert.equal(operating.status, "UNAVAILABLE");
  assert.equal(operating.reason, "STANDARD_OR_REVIEWED_CONCEPT_NOT_FOUND");
  const cash = onlyResolved(result.decisions, "CASH");
  assert.equal(cash.current.currency, "CAD");
  assert.equal(cash.current.taxonomy, "ifrs-full");
  assert.equal(cash.current.filingFacts.length, 2);
  assert.equal(cash.priorYear?.filingFacts.length, 2);
  assert.deepEqual(cash.current.filingFacts.map((fact) => fact.source.documentName).sort(), ["ex992.htm", "ex993.htm"]);
  const ocf = onlyResolved(result.decisions, "OPERATING_CASH_FLOW");
  assert.equal(ocf.current.normalizedValue, "-69646000000");
  assert.equal(ocf.current.filingLexicalValues[0], "69,646");
});

test("exact CompanyFacts duplicates preserve every source key; conflicts fail closed", () => {
  const prepared = prepare(sample("AAPL 2025 10-K"));
  const revenue = prepared.companyFacts.find((fact) => fact.concept === "RevenueFromContractWithCustomerExcludingAssessedTax" && fact.endDate === "2025-09-27")!;
  prepared.companyFacts.push({ ...revenue, sourceFactKey: `${revenue.sourceFactKey}-duplicate`, sourceFactPath: `${revenue.sourceFactPath}.duplicate` });
  const duplicated = resolvePrepared(prepared);
  assert.equal(onlyResolved(duplicated.decisions, "REVENUE").current.companyFacts.length, 2);

  prepared.companyFacts.push({ ...revenue, sourceFactKey: `${revenue.sourceFactKey}-conflict`, valueNumeric: "416160000000" });
  const conflict = resolvePrepared(prepared);
  const failed = conflict.decisions.find((row) => row.metric === "REVENUE")!;
  assert.equal(failed.status, "AMBIGUOUS");
  assert.equal(failed.reason, "COMPANYFACTS_CONFLICT");
});

test("a selected fact source must exactly match the target filing source set", () => {
  const mutations: Array<(source: SecFilingXbrlFact["source"]) => SecFilingXbrlFact["source"]> = [
    (source) => ({
      ...source,
      accession: "0000320193-24-000123",
      sourceUrl: "https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/wrong.htm",
    }),
    (source) => ({ ...source, issuerCik: "0000000001" }),
    (source) => ({
      ...source,
      sourceUrl: "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/unregistered.htm",
    }),
  ];

  for (const mutate of mutations) {
    const prepared = prepare(sample("AAPL 2025 10-K"));
    const currentRevenue = prepared.filingXbrl.facts.find((fact) =>
      fact.concept.localName === "RevenueFromContractWithCustomerExcludingAssessedTax"
      && fact.context.period.kind === "duration"
      && fact.context.period.endDate === prepared.filing.reportDate
      && fact.context.dimensions.length === 0
    )!;
    currentRevenue.source = mutate(currentRevenue.source);

    const result = resolvePrepared(prepared);
    const revenue = result.decisions.find((row) => row.metric === "REVENUE")!;
    assert.notEqual(revenue.status, "RESOLVED");
    assert.equal(revenue.reason, "FILING_FACT_SOURCE_MISMATCH");
    assert.equal("current" in revenue, false);
  }
});

test("artifact identity mismatch fails closed without value or provenance", () => {
  const prepared = prepare(sample("AAPL 2025 10-K"));
  const currentRevenue = prepared.filingXbrl.facts.find((fact) =>
    fact.concept.localName === "RevenueFromContractWithCustomerExcludingAssessedTax"
    && fact.context.period.kind === "duration"
    && fact.context.period.endDate === prepared.filing.reportDate
    && fact.context.dimensions.length === 0
  )!;
  currentRevenue.source = {
    ...currentRevenue.source,
    artifactId: `${currentRevenue.source.artifactId}:different`,
  };

  const result = resolvePrepared(prepared);
  const revenue = result.decisions.find((row) => row.metric === "REVENUE")!;
  assert.equal(revenue.status, "UNAVAILABLE");
  assert.equal(revenue.reason, "FILING_FACT_SOURCE_MISMATCH");
  assert.equal("current" in revenue, false);
});

test("material filing duplicates, competing concepts, and dimensional-only facts fail closed", () => {
  const conflicting = prepare(sample("AAPL 2025 10-K"));
  const originalFact = conflicting.filingXbrl.facts.find((fact) => fact.concept.localName === "OperatingIncomeLoss" && fact.context.period.kind === "duration" && fact.context.period.endDate === "2025-09-27")!;
  const originalCompany = conflicting.companyFacts.find((fact) => fact.concept === "OperatingIncomeLoss" && fact.endDate === "2025-09-27")!;
  conflicting.filingXbrl.facts.push({ ...originalFact, factKey: `${originalFact.factKey}-conflict`, valueText: "133,049" });
  conflicting.companyFacts.push({ ...originalCompany, sourceFactKey: `${originalCompany.sourceFactKey}-conflict`, valueNumeric: "133049000000" });
  const conflictResult = resolvePrepared(conflicting);
  assert.equal(conflictResult.decisions.find((row) => row.metric === "OPERATING_INCOME_LOSS")?.reason, "COMPANYFACTS_CONFLICT");

  const competing = prepare(sample("AAPL 2025 10-K"));
  addCompetingRevenueConcept(competing);
  const competingResult = resolvePrepared(competing);
  assert.equal(competingResult.decisions.find((row) => row.metric === "REVENUE")?.reason, "MULTIPLE_METRIC_CONCEPTS");

  const dimensional = prepare(sample("AAPL 2026 Q3 10-Q"));
  dimensional.filingXbrl.facts = dimensional.filingXbrl.facts.filter((fact) =>
    fact.concept.localName !== "RevenueFromContractWithCustomerExcludingAssessedTax" || fact.context.dimensions.length > 0
  );
  const dimensionalResult = resolvePrepared(dimensional);
  assert.equal(dimensionalResult.decisions.find((row) => row.metric === "REVENUE")?.reason, "DIMENSIONAL_FACT_REJECTED");
});

test("currency mismatch never becomes a mixed prior-year pair", () => {
  const prepared = prepare(sample("AAPL 2025 10-K"));
  const priorFact = prepared.filingXbrl.facts.find((fact) => fact.concept.localName === "NetIncomeLoss" && fact.context.period.kind === "duration" && fact.context.period.endDate === "2024-09-28")!;
  const priorCompany = prepared.companyFacts.find((fact) => fact.concept === "NetIncomeLoss" && fact.endDate === "2024-09-28")!;
  priorFact.unit = { id: "EUR", kind: "measure", measure: { qname: "iso4217:EUR", prefix: "iso4217", localName: "EUR", namespaceUri: "http://www.xbrl.org/2003/iso4217" } };
  priorFact.unitRef = "EUR";
  priorCompany.unit = "EUR";
  const result = resolvePrepared(prepared);
  const netIncome = onlyResolved(result.decisions, "NET_INCOME_LOSS");
  assert.equal(netIncome.current.currency, "USD");
  assert.equal(netIncome.priorYear, null);
  assert.equal(netIncome.priorYearStatus.reason, "PRIOR_YEAR_COMPARABLE_NOT_FOUND");
});

test("amendment and duplicate filing currentness never silently overwrites an accession", () => {
  const prepared = prepare(sample("AAPL 2025 10-K"));
  const amendment: SecFilingRow = {
    ...prepared.filing,
    accessionNumber: "0000320193-25-999999",
    form: "10-K/A",
    acceptedAt: "2025-11-15T10:00:00.000Z",
    sourceRawId: "amendment-ledger-source",
  };
  const unreviewed = resolvePeriodicFinancials({
    issuerCik: prepared.filing.issuerCik,
    targetAccession: prepared.filing.accessionNumber,
    filings: [prepared.filing, amendment],
    companyFacts: prepared.companyFacts,
    filingXbrl: prepared.filingXbrl,
  });
  assert.equal(unreviewed.currentness.reason, "AMENDMENT_CURRENTNESS_REQUIRES_REVIEW");
  assert.equal(unreviewed.decisions.every((row) => row.reason === "AMENDMENT_CURRENTNESS_REQUIRES_REVIEW"), true);

  const superseded = resolvePeriodicFinancials({
    issuerCik: prepared.filing.issuerCik,
    targetAccession: prepared.filing.accessionNumber,
    filings: [prepared.filing, amendment],
    companyFacts: prepared.companyFacts,
    filingXbrl: prepared.filingXbrl,
    reviewedFilingSelection: {
      selectionVersion: "periodic-financial-reviewed-filing-selection-v1",
      reviewId: "aapl-2025-10k-amendment-selection",
      reviewedAt: "2026-09-01T00:00:00.000Z",
      issuerCik: prepared.filing.issuerCik,
      baseForm: "10-K",
      reportDate: prepared.filing.reportDate!,
      selectedAccession: amendment.accessionNumber,
      supersededAccessions: [prepared.filing.accessionNumber],
    },
  });
  assert.equal(superseded.currentness.reason, "TARGET_SUPERSEDED_BY_REVIEWED_AMENDMENT");
  assert.equal(superseded.decisions.every((row) => row.reason === "TARGET_SUPERSEDED_BY_REVIEWED_AMENDMENT"), true);

  const duplicate: SecFilingRow = {
    ...prepared.filing,
    accessionNumber: "0000320193-25-999998",
    acceptedAt: "2025-10-31T11:00:00.000Z",
  };
  const ambiguous = resolvePeriodicFinancials({
    issuerCik: prepared.filing.issuerCik,
    targetAccession: prepared.filing.accessionNumber,
    filings: [prepared.filing, duplicate],
    companyFacts: prepared.companyFacts,
    filingXbrl: prepared.filingXbrl,
  });
  assert.equal(ambiguous.currentness.reason, "DUPLICATE_FILING_REQUIRES_REVIEW");
  assert.equal(ambiguous.decisions.every((row) => row.status === "AMBIGUOUS"), true);
});

test("issuer-extension names do not auto-map and invalid reviewed rules fail explicitly", () => {
  const prepared = prepare(sample("Toronto-Dominion Bank 2025 40-F IFRS"));
  const extension = makeExtensionFact(prepared, "IssuerOperatingProfit", "123000000", "123");
  prepared.filingXbrl.facts.push(extension.fact);
  prepared.companyFacts.push(extension.companyFact);
  const unmapped = resolvePrepared(prepared);
  assert.equal(unmapped.decisions.find((row) => row.metric === "OPERATING_INCOME_LOSS")?.reason, "ISSUER_EXTENSION_MAPPING_REQUIRED");

  const invalid = resolvePeriodicFinancials({
    issuerCik: prepared.filing.issuerCik,
    targetAccession: prepared.filing.accessionNumber,
    filings: [prepared.filing],
    companyFacts: prepared.companyFacts,
    filingXbrl: prepared.filingXbrl,
    reviewedMappings: [{
      mappingVersion: "periodic-financial-reviewed-concept-v1",
      reviewId: "td-operating-profit-review",
      reviewedAt: "2026-09-01T00:00:00.000Z",
      issuerCik: "0000000001",
      metric: "OPERATING_INCOME_LOSS",
      namespaceUri: "http://example.com/issuer/2025",
      taxonomy: "td",
      concept: "IssuerOperatingProfit",
      equivalentTo: "ifrs-full:ProfitLossFromOperatingActivities",
    }],
  });
  assert.equal(invalid.decisions.find((row) => row.metric === "OPERATING_INCOME_LOSS")?.reason, "INVALID_REVIEWED_MAPPING");
});

test("numeric transformations are exact and unsupported transforms do not guess", () => {
  assert.equal(normalizeFilingDecimal({ valueText: "(1,234)", inlineFormat: "ixt:num-dot-decimal", scale: "3", sign: null, isNil: false }), null);
  assert.equal(normalizeFilingDecimal({ valueText: "1,234.50", inlineFormat: "ixt:num-dot-decimal", scale: "3", sign: "-", isNil: false }), "-1234500");
  assert.equal(normalizeFilingDecimal({ valueText: "1.234,50", inlineFormat: "ixt:num-comma-decimal", scale: "0", sign: null, isNil: false }), "1234.5");
  assert.equal(normalizeFilingDecimal({ valueText: "0.001", inlineFormat: null, scale: "3", sign: null, isNil: false }), "1");
  assert.equal(normalizeFilingDecimal({ valueText: "0.001", inlineFormat: null, scale: "-1", sign: null, isNil: false }), "0.0001");
  assert.equal(normalizeFilingDecimal({ valueText: "—", inlineFormat: "ixt:fixed-zero", scale: "6", sign: null, isNil: false }), "0");
  assert.equal(normalizeFilingDecimal({ valueText: "123", inlineFormat: "issuer:unknown", scale: null, sign: null, isNil: false }), null);
});

test("replay is deterministic under input reordering", () => {
  const prepared = prepare(sample("AAPL 2026 Q3 10-Q"));
  const first = resolvePrepared(prepared);
  const replay = resolvePeriodicFinancials({
    issuerCik: prepared.filing.issuerCik,
    targetAccession: prepared.filing.accessionNumber,
    filings: [prepared.filing],
    companyFacts: [...prepared.companyFacts].reverse(),
    filingXbrl: { ...prepared.filingXbrl, facts: [...prepared.filingXbrl.facts].reverse(), sources: [...prepared.filingXbrl.sources].reverse() },
  });
  assert.deepEqual(replay, first);
});

function resolveSample(audited: AuditFiling) {
  return resolvePrepared(prepare(audited));
}

function resolvePrepared(prepared: ReturnType<typeof prepare>) {
  return resolvePeriodicFinancials({
    issuerCik: prepared.filing.issuerCik,
    targetAccession: prepared.filing.accessionNumber,
    filings: [prepared.filing],
    companyFacts: prepared.companyFacts,
    filingXbrl: prepared.filingXbrl,
  });
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
    ingestedAt: "2026-09-01T00:00:00.000Z",
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
  const sources = uniqueSources(filingFacts);
  const filingXbrl: SecFilingXbrlDocumentSet = {
    status: "AVAILABLE",
    documentKind: "inline_xbrl_ixds",
    contexts: [],
    units: [],
    facts: filingFacts,
    rejections: [],
    sources,
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
      fetchedAt: "2026-09-01T00:00:00.000Z",
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
    ingestedAt: "2026-09-01T00:00:00.000Z",
  };
  return { filingFact, companyFact };
}

function addCompetingRevenueConcept(prepared: ReturnType<typeof prepare>) {
  for (const original of prepared.filingXbrl.facts.filter((fact) =>
    fact.concept.localName === "RevenueFromContractWithCustomerExcludingAssessedTax" && fact.context.dimensions.length === 0
  )) {
    prepared.filingXbrl.facts.push({
      ...original,
      factKey: `${original.factKey}:revenues`,
      concept: { ...original.concept, qname: "us-gaap:Revenues", localName: "Revenues" },
    });
  }
  for (const original of prepared.companyFacts.filter((fact) => fact.concept === "RevenueFromContractWithCustomerExcludingAssessedTax")) {
    prepared.companyFacts.push({
      ...original,
      sourceFactKey: `${original.sourceFactKey}:revenues`,
      sourceFactPath: original.sourceFactPath.replace("RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues"),
      concept: "Revenues",
    });
  }
}

function makeExtensionFact(prepared: ReturnType<typeof prepare>, concept: string, numeric: string, lexical: string) {
  const templateFact = prepared.filingXbrl.facts.find((fact) => fact.context.period.kind === "duration" && fact.context.period.endDate === prepared.filing.reportDate)!;
  const templateCompany = prepared.companyFacts.find((fact) => fact.endDate === prepared.filing.reportDate)!;
  return {
    fact: {
      ...templateFact,
      factKey: `${templateFact.factKey}:extension`,
      concept: { qname: `td:${concept}`, prefix: "td", localName: concept, namespaceUri: "http://example.com/issuer/2025" },
      valueText: lexical,
    },
    companyFact: {
      ...templateCompany,
      sourceFactKey: `${templateCompany.sourceFactKey}:extension`,
      sourceFactPath: `facts.td.${concept}.units.CAD[0]`,
      taxonomy: "td",
      concept,
      valueNumeric: numeric,
    },
  };
}

function sample(label: string) {
  const found = fixture.filings.find((filing) => filing.label === label);
  assert.ok(found, label);
  return structuredClone(found);
}

function resolved(decisions: ReturnType<typeof resolveSample>["decisions"], metric?: SecPeriodicFinancialMetric) {
  return decisions.filter((row): row is SecPeriodicFinancialObservation =>
    row.status === "RESOLVED" && (!metric || row.metric === metric)
  );
}

function onlyResolved(decisions: ReturnType<typeof resolveSample>["decisions"], metric: SecPeriodicFinancialMetric) {
  const rows = resolved(decisions, metric);
  assert.equal(rows.length, 1, metric);
  return rows[0]!;
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
