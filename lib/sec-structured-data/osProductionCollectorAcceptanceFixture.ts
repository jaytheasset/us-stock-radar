import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createSecFilingXbrlFixtureArtifact,
  type SecFilingXbrlFetchResult,
  type SecFilingXbrlRawArtifact,
} from "./filingXbrlContext.ts";
import { SecRequestError } from "./secRequestPolicy.ts";
import type {
  SecCompanyFactRow,
  SecFilingRow,
  SecRefreshMode,
  SecStructuredSourceClient,
  SecStructuredSourceDocument,
} from "./types.ts";

export type SecOsAcceptanceCompanySample = {
  sampleKind: string;
  cik: string;
  facts: SecCompanyFactRow[];
  filings: SecFilingRow[];
};

export type SecOsAcceptanceAuditSample = {
  ticker: string;
  sample_kind: string;
  cik: string;
  accession: string;
  document: string;
  source_url: string;
  filing_lexical_value: string;
  as_of: string;
  context_ref: string;
  expected_status: "ELIGIBLE" | "REQUIRES_FURTHER_CONTEXT";
};

const companyFixture = JSON.parse(await readFile(
  new URL("./fixtures/sec-os-five-issuer-audit.json", import.meta.url),
  "utf8",
)) as { issuers: SecOsAcceptanceCompanySample[] };
const auditFixture = JSON.parse(await readFile(
  new URL("./fixtures/authoritative-os-five-issuer-audit.json", import.meta.url),
  "utf8",
)) as { issuers: SecOsAcceptanceAuditSample[] };

const NS = [
  'xmlns="http://www.w3.org/1999/xhtml"',
  'xmlns:ix="http://www.xbrl.org/2013/inlineXBRL"',
  'xmlns:xbrli="http://www.xbrl.org/2003/instance"',
  'xmlns:xbrldi="http://xbrl.org/2006/xbrldi"',
  'xmlns:dei="http://xbrl.sec.gov/dei/2025"',
  'xmlns:us-gaap="http://fasb.org/us-gaap/2025"',
  'xmlns:ixt="http://www.xbrl.org/inlineXBRL/transformation/2020-02-12"',
].join(" ");

export class FiveIssuerAcceptanceSourceClient implements SecStructuredSourceClient {
  readonly modeCalls: Array<{ kind: "submissions" | "companyfacts"; cik: string; mode: SecRefreshMode }> = [];
  failCompanyFactsCik: string | null = null;

  async fetchSubmissions(cik: string, mode: SecRefreshMode) {
    this.modeCalls.push({ kind: "submissions", cik, mode });
    return [sourceDocuments(acceptanceCompany(cik), acceptanceAuditByCik(cik))[0]];
  }

  async fetchCompanyFacts(cik: string, mode: SecRefreshMode) {
    this.modeCalls.push({ kind: "companyfacts", cik, mode });
    if (cik === this.failCompanyFactsCik) {
      throw new SecRequestError("fixture SEC network failure", new TypeError("offline"));
    }
    return sourceDocuments(acceptanceCompany(cik), acceptanceAuditByCik(cik))[1];
  }
}

export class FiveIssuerAcceptanceFilingSource {
  private readonly calls = new Map<string, number>();
  networkFailureAccession: string | null = null;

  async fetchFilingArtifacts(filing: SecFilingRow): Promise<SecFilingXbrlFetchResult> {
    this.calls.set(filing.accessionNumber, (this.calls.get(filing.accessionNumber) ?? 0) + 1);
    if (filing.accessionNumber === this.networkFailureAccession) {
      throw new SecRequestError("fixture filing network failure", new TypeError("offline"));
    }
    const audited = acceptanceAuditByCik(filing.issuerCik);
    const role = audited.ticker === "NEOM" ? "instance_xml" : "inline_xbrl";
    const inventory = inventoryArtifacts(audited, filing, role);
    if (audited.ticker === "ARM") {
      return {
        status: "UNAVAILABLE",
        reason: "PRIMARY_IXDS_INCOMPLETE",
        detail: "fixture omits the required primary IXDS member",
        artifacts: inventory,
      };
    }
    const artifacts = [...inventory, filingArtifact(audited, filingBody(audited), role)];
    return { status: "AVAILABLE", discovery: {} as never, artifacts };
  }

  callsByAccession() {
    return Object.fromEntries([...this.calls.entries()].sort(([left], [right]) => left.localeCompare(right)));
  }
}

export function acceptanceAudits() {
  return structuredClone(auditFixture.issuers);
}

export function acceptanceAudit(ticker: string) {
  const found = auditFixture.issuers.find((sample) => sample.ticker === ticker);
  assert.ok(found, ticker);
  return structuredClone(found);
}

export function acceptanceAuditByCik(cik: string) {
  const found = auditFixture.issuers.find((sample) => sample.cik === cik);
  assert.ok(found, cik);
  return structuredClone(found);
}

export function acceptanceCompany(cik: string) {
  const found = companyFixture.issuers.find((sample) => sample.cik === cik);
  assert.ok(found, cik);
  return structuredClone(found);
}

function sourceDocuments(
  sample: SecOsAcceptanceCompanySample,
  audited: SecOsAcceptanceAuditSample,
): [SecStructuredSourceDocument, SecStructuredSourceDocument] {
  const submission = {
    cik: sample.cik,
    name: `${audited.ticker} fixture issuer`,
    tickers: [audited.ticker],
    exchanges: [audited.ticker === "WIT" ? "NYSE" : "Nasdaq"],
    filings: {
      recent: {
        accessionNumber: sample.filings.map((row) => row.accessionNumber),
        form: sample.filings.map((row) => row.form),
        filingDate: sample.filings.map((row) => row.filedDate),
        acceptanceDateTime: sample.filings.map((row) => row.acceptedAt ?? ""),
        reportDate: sample.filings.map((row) => row.reportDate ?? ""),
        primaryDocument: sample.filings.map((row) => row.primaryDocument ?? ""),
        isXBRL: sample.filings.map((row) => row.isXbrl),
        isInlineXBRL: sample.filings.map((row) => row.isInlineXbrl),
      },
      files: [],
    },
  };
  const companyFacts = companyFactsPayload(sample);
  return [
    {
      sourceKind: "submissions",
      sourceUrl: `https://data.sec.gov/submissions/CIK${sample.cik}.json`,
      sourceIdentity: `https://data.sec.gov/submissions/CIK${sample.cik}.json`,
      cik: sample.cik,
      fetchedAt: "2026-08-22T01:00:00Z",
      payload: submission,
    },
    {
      sourceKind: "companyfacts",
      sourceUrl: `https://data.sec.gov/api/xbrl/companyfacts/CIK${sample.cik}.json`,
      sourceIdentity: `https://data.sec.gov/api/xbrl/companyfacts/CIK${sample.cik}.json`,
      cik: sample.cik,
      fetchedAt: "2026-08-22T01:00:01Z",
      payload: companyFacts.payload,
      rawBody: companyFacts.rawBody,
      rawBodyKind: "injected_exact_body",
    },
  ];
}

function companyFactsPayload(sample: SecOsAcceptanceCompanySample) {
  const facts: Record<string, Record<string, { units: Record<string, unknown[]> }>> = {};
  const replacements = new Map<string, string>();
  sample.facts.forEach((fact, index) => {
    const taxonomy = facts[fact.taxonomy] ??= {};
    const concept = taxonomy[fact.concept] ??= { units: {} };
    const entries = concept.units[fact.unit] ??= [];
    const token = `__NUMERIC_${index}__`;
    replacements.set(token, fact.valueNumeric!);
    entries.push({
      accn: fact.filingAccession,
      form: fact.form,
      filed: fact.filedDate,
      start: fact.startDate ?? undefined,
      end: fact.instantDate ?? fact.endDate,
      val: token,
      fy: fact.fiscalYear,
      fp: fact.fiscalPeriod,
      frame: fact.frame,
    });
  });
  let rawBody = JSON.stringify({ cik: sample.cik, entityName: "fixture", facts });
  for (const [token, value] of replacements) rawBody = rawBody.replace(JSON.stringify(token), value);
  return { rawBody, payload: JSON.parse(rawBody) };
}

function inventoryArtifacts(
  audited: SecOsAcceptanceAuditSample,
  filing: SecFilingRow,
  role: "inline_xbrl" | "instance_xml",
): SecFilingXbrlRawArtifact[] {
  const archive = audited.source_url.slice(0, audited.source_url.lastIndexOf("/"));
  const directoryName = new URL(archive).pathname;
  const documents = role === "inline_xbrl"
    ? [{ name: audited.document, type: filing.form, inline: true }]
    : [
        { name: filing.primaryDocument!, type: filing.form, inline: false },
        { name: audited.document, type: "EX-101.INS", inline: false },
      ];
  const filingIndex = `<html><body><div>SEC Accession No. ${filing.accessionNumber}</div><table summary="Document Format Files">${documents.map((document, index) =>
    `<tr><td>${index + 1}</td><td>${document.type}</td><td><a href="${directoryName}/${document.name}">${document.name}</a>${document.inline ? " <span>iXBRL</span>" : ""}</td><td>${document.type}</td><td>100</td></tr>`
  ).join("")}</table></body></html>`;
  const inventory = [
    createSecFilingXbrlFixtureArtifact({
      issuerCik: filing.issuerCik,
      accession: filing.accessionNumber,
      documentName: "index.json",
      sourceUrl: `${archive}/index.json`,
      role: "archive_index",
      rawContent: JSON.stringify({ directory: { name: directoryName, item: documents.map((document) => ({ name: document.name, size: 100 })) } }),
    }),
    createSecFilingXbrlFixtureArtifact({
      issuerCik: filing.issuerCik,
      accession: filing.accessionNumber,
      documentName: `${filing.accessionNumber}-index.html`,
      sourceUrl: `${archive}/${filing.accessionNumber}-index.html`,
      role: "filing_index",
      rawContent: filingIndex,
    }),
  ];
  if (role === "instance_xml") {
    inventory.push(createSecFilingXbrlFixtureArtifact({
      issuerCik: filing.issuerCik,
      accession: filing.accessionNumber,
      documentName: filing.primaryDocument!,
      sourceUrl: `${archive}/${filing.primaryDocument}`,
      role: "primary_document",
      rawContent: "<html><body>primary filing document</body></html>",
    }));
  }
  return inventory;
}

function filingArtifact(
  audited: SecOsAcceptanceAuditSample,
  rawContent: string,
  role: "inline_xbrl" | "instance_xml",
) {
  return createSecFilingXbrlFixtureArtifact({
    issuerCik: audited.cik,
    accession: audited.accession,
    documentName: audited.document,
    sourceUrl: audited.source_url,
    role,
    rawContent,
  });
}

function filingBody(audited: SecOsAcceptanceAuditSample) {
  if (audited.ticker === "NEOM") {
    return `<?xml version="1.0"?><xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:dei="http://xbrl.sec.gov/dei/2012">${unit("shares", "xbrli:shares")}${context(audited.context_ref, audited.cik, audited.as_of)}<dei:EntityCommonStockSharesOutstanding contextRef="${audited.context_ref}" unitRef="shares" decimals="INF">${audited.filing_lexical_value}</dei:EntityCommonStockSharesOutstanding></xbrli:xbrl>`;
  }
  if (audited.ticker === "GOOG") {
    const contexts = [
      context("c-32", audited.cik, audited.as_of),
      context("c-35", audited.cik, audited.as_of, explicit("us-gaap:StatementClassOfStockAxis", "us-gaap:CommonClassAMember")),
      context("c-36", audited.cik, audited.as_of, explicit("us-gaap:StatementClassOfStockAxis", "us-gaap:CommonClassBMember")),
      context("c-39", audited.cik, audited.as_of, explicit("us-gaap:StatementClassOfStockAxis", "us-gaap:CommonClassCMember")),
    ].join("");
    const facts = [["c-32", "12,230"], ["c-35", "5,868"], ["c-36", "835"], ["c-39", "5,527"]]
      .map(([contextRef, value]) => osFact("us-gaap:CommonStockSharesOutstanding", contextRef!, value!, "shares", "6"))
      .join("");
    return inlineBody(contexts, facts);
  }
  const title = audited.ticker === "ARM"
    ? "American Depositary Shares, each representing one Ordinary Share"
    : audited.ticker === "WIT"
      ? "American Depositary Shares, each representing one equity share"
      : "Common Stock";
  return inlineBody(
    `${context(audited.context_ref, audited.cik, audited.as_of)}${durationContext("title", audited.cik, audited.as_of)}`,
    `<ix:nonNumeric name="dei:Security12bTitle" contextRef="title">${title}</ix:nonNumeric>${osFact("dei:EntityCommonStockSharesOutstanding", audited.context_ref, audited.filing_lexical_value)}`,
  );
}

function inlineBody(resources: string, facts: string) {
  return `<?xml version="1.0"?><html ${NS}><body><ix:header><ix:resources>${unit("shares", "xbrli:shares")}${resources}</ix:resources></ix:header>${facts}</body></html>`;
}

function unit(id: string, measure: string) {
  return `<xbrli:unit id="${id}"><xbrli:measure>${measure}</xbrli:measure></xbrli:unit>`;
}

function context(id: string, cik: string, instant: string, dimensions = "") {
  return `<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">${cik}</xbrli:identifier>${dimensions ? `<xbrli:segment>${dimensions}</xbrli:segment>` : ""}</xbrli:entity><xbrli:period><xbrli:instant>${instant}</xbrli:instant></xbrli:period></xbrli:context>`;
}

function durationContext(id: string, cik: string, end: string) {
  return `<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">${cik}</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>${end.slice(0, 4)}-01-01</xbrli:startDate><xbrli:endDate>${end}</xbrli:endDate></xbrli:period></xbrli:context>`;
}

function explicit(axis: string, member: string) {
  return `<xbrldi:explicitMember dimension="${axis}">${member}</xbrldi:explicitMember>`;
}

function osFact(concept: string, contextRef: string, value: string, unitRef = "shares", scale = "0") {
  return `<ix:nonFraction name="${concept}" contextRef="${contextRef}" unitRef="${unitRef}" decimals="0" scale="${scale}" format="ixt:num-dot-decimal">${value}</ix:nonFraction>`;
}
