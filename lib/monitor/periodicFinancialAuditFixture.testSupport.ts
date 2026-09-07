import { readFile } from "node:fs/promises";
import type {
  SecFilingXbrlDocumentSet,
  SecFilingXbrlFact,
  SecXbrlDimension,
} from "../sec-structured-data/filingXbrlContext.ts";
import type { SecPeriodicFinancialMetric } from "../sec-structured-data/periodicFinancialResolver.ts";
import type { SecCompanyFactRow, SecFilingRow } from "../sec-structured-data/types.ts";

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

export type PeriodicFinancialAuditFiling = {
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
  new URL("../sec-structured-data/fixtures/periodic-financial-four-form-audit.json", import.meta.url),
  "utf8",
)) as { filings: PeriodicFinancialAuditFiling[] };

export function periodicFinancialAuditSample(label: string) {
  const audited = fixture.filings.find((row) => row.label === label);
  if (!audited) throw new Error(`Missing periodic financial audit sample: ${label}`);
  return audited;
}

export function preparePeriodicFinancialAuditSample(audited: PeriodicFinancialAuditFiling) {
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
  const filingXbrl: SecFilingXbrlDocumentSet = {
    status: "AVAILABLE",
    documentKind: "inline_xbrl_ixds",
    contexts: [],
    units: [],
    facts: filingFacts,
    rejections: [],
    sources: uniqueSources(filingFacts),
  };
  return { filing, filings: [filing], filingXbrl, companyFacts };
}

function buildFact(
  audited: PeriodicFinancialAuditFiling,
  tuple: AuditTuple,
  index: number,
  documentName: string,
  sourceUrl: string,
  contentHash: string,
) {
  const [metric, concept, contextRef, startDate, endOrInstant, lexical, numeric,
    fiscalPeriod, frame, dimensionCount, sign] = tuple;
  const instant = metric === "CASH";
  const dimensions = Array.from({ length: dimensionCount }, (_, dimensionIndex): SecXbrlDimension => ({
    kind: "explicit",
    axis: qname(`Axis${dimensionIndex}`),
    member: qname(`Member${dimensionIndex}`),
  }));
  const scale = audited.label.startsWith("WIX") ? "3" : "6";
  const filingFact: SecFilingXbrlFact = {
    factKey: `${audited.accession}:${index}:${concept}:${contextRef}:${documentName}`,
    concept: {
      qname: `${audited.taxonomy}:${concept}`,
      prefix: audited.taxonomy,
      localName: concept,
      namespaceUri: audited.namespaceUri,
    },
    valueText: lexical,
    valueTree: lexical,
    contextRef,
    unitRef: audited.currency,
    unit: {
      id: audited.currency,
      kind: "measure",
      measure: {
        qname: `iso4217:${audited.currency}`,
        prefix: "iso4217",
        localName: audited.currency,
        namespaceUri: "http://www.xbrl.org/2003/iso4217",
      },
    },
    decimals: `-${scale}`,
    precision: null,
    scale,
    sign: sign ?? null,
    inlineFormat: audited.taxonomy === "ifrs-full" ? "ixt:numdotdecimal" : "ixt:num-dot-decimal",
    isNil: false,
    context: {
      id: contextRef,
      entityIdentifier: audited.cik,
      entityScheme: "http://www.sec.gov/CIK",
      period: instant
        ? { kind: "instant", instant: endOrInstant }
        : { kind: "duration", startDate: startDate!, endDate: endOrInstant },
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

function qname(localName: string) {
  return {
    qname: `audit:${localName}`,
    prefix: "audit",
    localName,
    namespaceUri: "https://example.test/audit",
  };
}

function uniqueSources(facts: SecFilingXbrlFact[]) {
  return [...new Map(facts.map((fact) => [fact.source.artifactId, fact.source])).values()]
    .sort((left, right) => left.sourceUrl.localeCompare(right.sourceUrl));
}
