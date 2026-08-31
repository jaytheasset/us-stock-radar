import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  SEC_AUTHORITATIVE_OS_DECISION_VERSION,
  SEC_AUTHORITATIVE_OS_STATUSES,
  SEC_US_LISTED_FOREIGN_OS_EVIDENCE_VERSION,
  normalizeFilingInteger,
  readAuthoritativeOsCandidates,
  resolveAuthoritativeOsFromFiling,
} from "./authoritativeOsExtraction.ts";
import {
  InMemorySecFilingXbrlArtifactRepository,
  createSecFilingXbrlFixtureArtifact,
  parseSecFilingXbrlArtifacts,
  readOsCandidateFilingContexts,
  type SecFilingXbrlFact,
} from "./filingXbrlContext.ts";
import { extractCompanyFactsOs, type SecOsFilingContextCandidate } from "./osCandidateExtraction.ts";
import type { SecCompanyFactRow, SecFactReadFilter, SecFilingRow } from "./types.ts";

type CompanySample = {
  sampleKind: string;
  cik: string;
  facts: SecCompanyFactRow[];
  filings: SecFilingRow[];
};
type AuditSample = {
  ticker: string;
  sample_kind: string;
  cik: string;
  accession: string;
  document: string;
  source_url: string;
  full_document_sha256: string;
  companyfacts_value: string;
  filing_lexical_value: string;
  as_of: string;
  context_ref: string;
  expected_status: string;
};
type ForeignAuditSample = AuditSample & {
  form: "20-F" | "40-F";
  filed_date: string;
  accepted_at: string;
  trading_context_ref: string;
  security_title: string;
  trading_symbol: string;
  exchange_name: string;
};

const companyFixture = JSON.parse(await readFile(
  new URL("./fixtures/sec-os-five-issuer-audit.json", import.meta.url),
  "utf8",
)) as { issuers: CompanySample[] };
const auditFixture = JSON.parse(await readFile(
  new URL("./fixtures/authoritative-os-five-issuer-audit.json", import.meta.url),
  "utf8",
)) as { issuers: AuditSample[] };
const foreignAuditFixture = JSON.parse(await readFile(
  new URL("./fixtures/foreign-listed-os-audit.json", import.meta.url),
  "utf8",
)) as { issuers: ForeignAuditSample[] };

const NS = [
  'xmlns="http://www.w3.org/1999/xhtml"',
  'xmlns:ix="http://www.xbrl.org/2013/inlineXBRL"',
  'xmlns:xbrli="http://www.xbrl.org/2003/instance"',
  'xmlns:xbrldi="http://xbrl.org/2006/xbrldi"',
  'xmlns:dei="http://xbrl.sec.gov/dei/2025"',
  'xmlns:us-gaap="http://fasb.org/us-gaap/2025"',
  'xmlns:ixt="http://www.xbrl.org/inlineXBRL/transformation/2020-02-12"',
].join(" ");

test("authoritative status contract is exactly bounded and versioned", () => {
  assert.deepEqual(SEC_AUTHORITATIVE_OS_STATUSES, ["ELIGIBLE", "REQUIRES_FURTHER_CONTEXT", "UNAVAILABLE"]);
  assert.equal(SEC_AUTHORITATIVE_OS_DECISION_VERSION, "authoritative-os-extraction-v1");
});

test("five official issuer audit produces exact deterministic decisions and provenance", async () => {
  for (const audited of auditFixture.issuers) {
    const candidate = companyCandidates(audited.sample_kind)
      .find((row) => row.taxonomy === (audited.ticker === "GOOG" ? "us-gaap" : "dei"))!;
    assert.ok(candidate, audited.ticker);
    const linked = await link(audited, candidate);
    const decision = resolveAuthoritativeOsFromFiling(linked);
    assert.equal(decision.status, audited.expected_status, audited.ticker);
    assert.equal(decision.candidate.sharesOutstanding, audited.companyfacts_value, audited.ticker);
    assert.equal(decision.filingFacts.some((fact) => fact.lexicalValue === audited.filing_lexical_value), true, audited.ticker);
    assert.equal(decision.filingFacts.every((fact) => fact.context.period.kind === "instant"), true, audited.ticker);
    assert.equal(decision.filingFacts.every((fact) => fact.source.accession === audited.accession), true, audited.ticker);
    assert.equal(decision.filingFacts.every((fact) => fact.source.documentName === audited.document), true, audited.ticker);
    assert.match(audited.full_document_sha256, /^[0-9a-f]{64}$/, audited.ticker);
    if (decision.status === "ELIGIBLE") {
      assert.equal(decision.authoritative.sharesOutstanding, audited.companyfacts_value);
      assert.equal(decision.authoritative.asOf, audited.as_of);
      assert.equal(decision.authoritative.contextRef, audited.context_ref);
      assert.match(decision.authoritative.conceptNamespaceUri, /^https?:\/\/xbrl\.sec\.gov\/dei\/[0-9]{4}$/);
      assert.equal(decision.authoritative.conceptLocalName, "EntityCommonStockSharesOutstanding");
      assert.equal(decision.authoritative.source.sourceUrl, audited.source_url);
      assert.match(decision.authoritative.source.artifactId, /^[0-9a-f-]{36}$/);
      assert.match(decision.authoritative.source.contentHash, /^[0-9a-f]{64}$/);
      assert.equal(decision.authoritative.source.rawContentKind, "injected_exact_body");
      assert.equal(decision.authoritative.companyFactsProvenance.length > 0, true);
      assert.equal(decision.authoritative.filingLedgerRawSourceId.length > 0, true);
    }
  }
});

test("single-class DEI required context is eligible only with an exact filing numeric link", async () => {
  const audited = audit("AAPL");
  const decision = resolveAuthoritativeOsFromFiling(await link(audited, companyCandidates(audited.sample_kind)[0]!));
  assert.equal(decision.status, "ELIGIBLE");
  if (decision.status !== "ELIGIBLE") return;
  assert.equal(decision.reason, "ELIGIBLE_SINGLE_COMMON_STOCK_DEI_CONTEXT");
  assert.deepEqual(decision.authoritative.securityClass, {
    basis: "SINGLE_COMMON_STOCK_CLASS",
    identity: "dei:EntityCommonStockSharesOutstanding@required-context",
    evidenceFactKey: decision.authoritative.factKey,
    contextRef: "c-9",
    dimensions: [],
  });
  assert.equal(decision.authoritative.filingLexicalValue, "14,594,180,000");
});

test("Alphabet aggregate and all classes remain separated without summing or selecting", async () => {
  const audited = audit("GOOG");
  const decision = resolveAuthoritativeOsFromFiling(await link(audited, companyCandidates(audited.sample_kind)[0]!));
  assert.equal(decision.status, "REQUIRES_FURTHER_CONTEXT");
  assert.equal(decision.reason, "AGGREGATE_AND_CLASS_SPECIFIC_FACTS_REQUIRE_SELECTION");
  assert.equal(decision.filingFacts.length, 4);
  assert.deepEqual(decision.filingFacts.map((fact) => fact.normalizedValue), [
    "12230000000", "5868000000", "835000000", "5527000000",
  ]);
  assert.deepEqual(
    decision.filingFacts.flatMap((fact) => fact.dimensions).map((dimension) =>
      dimension.kind === "explicit" ? dimension.member.qname : "typed"),
    ["us-gaap:CommonClassAMember", "us-gaap:CommonClassBMember", "us-gaap:CommonClassCMember"],
  );
});

test("foreign ordinary/ADS observations fail closed even when filing title text states a ratio", async () => {
  for (const ticker of ["WIT", "ARM"]) {
    const audited = audit(ticker);
    const candidate = companyCandidates(audited.sample_kind).find((row) => row.taxonomy === "dei")!;
    const decision = resolveAuthoritativeOsFromFiling(await link(audited, candidate));
    assert.equal(decision.status, "REQUIRES_FURTHER_CONTEXT", ticker);
    assert.equal(decision.authoritative, null, ticker);
    assert.equal(
      ["ADS_OR_ORDINARY_BASIS_REQUIRES_STRUCTURED_RATIO", "COMPANYFACTS_SAME_DATE_CONFLICT"].includes(decision.reason),
      true,
      ticker,
    );
  }
});

test("real SEC-backed 20-F and 40-F direct-listed common securities are eligible through one exact trading-security tuple", async () => {
  for (const ticker of ["WIX", "B"]) {
    const audited = foreignAudit(ticker);
    const candidate = foreignCompanyCandidates(audited)[0]!;
    const decision = resolveAuthoritativeOsFromFiling(await linkForeign(audited, candidate));
    assert.equal(decision.status, "ELIGIBLE", ticker);
    if (decision.status !== "ELIGIBLE") continue;
    const evidence = decision.authoritative.tradingSecurityEvidence;
    assert.ok(evidence, ticker);
    assert.equal(evidence.evidenceVersion, SEC_US_LISTED_FOREIGN_OS_EVIDENCE_VERSION, ticker);
    assert.equal(evidence.securityTitle.valueText, audited.security_title, ticker);
    assert.equal(evidence.tradingSymbol.valueText, audited.trading_symbol, ticker);
    assert.equal(evidence.exchangeName.valueText, audited.exchange_name, ticker);
    assert.equal(evidence.linkedOsFactKey, decision.authoritative.factKey, ticker);
    assert.equal(evidence.linkedOsContextRef, audited.context_ref, ticker);
    assert.equal(decision.tradingSecurityFacts.length, 3, ticker);
    assert.match(audited.full_document_sha256, /^[0-9a-f]{64}$/, ticker);
  }
});

test("foreign listing support rejects ADS titles, non-US exchanges, missing linkage, and multiple trading securities without writing a value", async () => {
  const audited = foreignAudit("WIX");
  const candidate = foreignCompanyCandidates(audited)[0]!;
  const cases: Array<[string, string, string]> = [
    [
      "ADS ratio text",
      foreignFilingBody(audited, { title: "American Depositary Shares, each representing one Ordinary Share" }),
      "ADS_OR_ORDINARY_BASIS_REQUIRES_STRUCTURED_RATIO",
    ],
    [
      "TSX-only",
      foreignFilingBody(audited, { exchange: "Toronto Stock Exchange" }),
      "FOREIGN_TRADING_SECURITY_NOT_US_EXCHANGE",
    ],
    [
      "missing title",
      foreignFilingBody(audited, { omitTitle: true }),
      "FOREIGN_LISTING_OR_CLASS_LINKAGE_UNPROVEN",
    ],
    [
      "multiple securities",
      foreignFilingBody(audited, { extraSecurity: true }),
      "FOREIGN_TRADING_SECURITY_AMBIGUOUS",
    ],
  ];
  for (const [name, body, reason] of cases) {
    const decision = resolveAuthoritativeOsFromFiling(await linkForeign(audited, candidate, body));
    assert.equal(decision.status, "REQUIRES_FURTHER_CONTEXT", name);
    assert.equal(decision.reason, reason, name);
    assert.equal(decision.authoritative, null, name);
  }
});

test("form is a gate rather than authority: foreign periodic forms still require trading-security linkage", async () => {
  const audited = audit("AAPL");
  const base = companyCandidates(audited.sample_kind)[0]!;
  for (const form of ["10-K", "10-K/A", "10-Q", "10-Q/A"]) {
    const candidate = { ...base, form };
    const decision = resolveAuthoritativeOsFromFiling(await link(audited, candidate));
    assert.equal(decision.status, "ELIGIBLE", form);
  }
  for (const form of ["20-F", "20-F/A", "40-F", "40-F/A", "6-K", "6-K/A"]) {
    const candidate = { ...base, form };
    const decision = resolveAuthoritativeOsFromFiling(await link(audited, candidate));
    assert.equal(decision.status, "REQUIRES_FURTHER_CONTEXT", form);
    assert.equal(
      decision.reason,
      form.startsWith("6-")
        ? "ADS_OR_ORDINARY_BASIS_REQUIRES_STRUCTURED_RATIO"
        : "FOREIGN_LISTING_OR_CLASS_LINKAGE_UNPROVEN",
      form,
    );
  }
  for (const form of ["F-10", "S-1", "F-1", "S-3", "F-3", "424B3", "424B5"]) {
    const candidate = { ...base, form };
    const decision = resolveAuthoritativeOsFromFiling(await link(audited, candidate));
    assert.equal(decision.status, "UNAVAILABLE", form);
    assert.equal(decision.reason, "UNSUPPORTED_FORM_FOR_AUTHORITATIVE_OS", form);
  }
});

test("class-specific DEI facts can identify a class but aggregate plus class facts cannot double count", async () => {
  const base = audit("AAPL");
  const candidate = companyCandidates(base.sample_kind)[0]!;
  const classBody = inlineBody(
    [
      context("class-a", candidate.issuerCik, candidate.asOf, explicit("us-gaap:StatementClassOfStockAxis", "us-gaap:CommonClassAMember")),
      context("class-b", candidate.issuerCik, candidate.asOf, explicit("us-gaap:StatementClassOfStockAxis", "us-gaap:CommonClassBMember")),
    ].join(""),
    [
      osFact("dei:EntityCommonStockSharesOutstanding", "class-a", "14,594,180,000"),
      osFact("dei:EntityCommonStockSharesOutstanding", "class-b", "100"),
    ].join(""),
  );
  const classDecision = resolveAuthoritativeOsFromFiling(await linkBody(base, candidate, classBody));
  assert.equal(classDecision.status, "ELIGIBLE");
  if (classDecision.status === "ELIGIBLE") {
    assert.equal(classDecision.authoritative.securityClass.basis, "CLASS_SPECIFIC_COMMON_STOCK");
  }

  const aggregateBody = inlineBody(
    `${context("aggregate", candidate.issuerCik, candidate.asOf)}${context("class-a", candidate.issuerCik, candidate.asOf, explicit("us-gaap:StatementClassOfStockAxis", "us-gaap:CommonClassAMember"))}`,
    `${osFact("dei:EntityCommonStockSharesOutstanding", "aggregate", "14,594,180,000")}${osFact("dei:EntityCommonStockSharesOutstanding", "class-a", "14,594,180,000")}`,
  );
  const aggregateDecision = resolveAuthoritativeOsFromFiling(await linkBody(base, candidate, aggregateBody));
  assert.equal(aggregateDecision.status, "REQUIRES_FURTHER_CONTEXT");
  assert.equal(aggregateDecision.reason, "AGGREGATE_AND_CLASS_SPECIFIC_FACTS_REQUIRE_SELECTION");

  const preferredMemberBody = inlineBody(
    context("preferred", candidate.issuerCik, candidate.asOf, explicit("us-gaap:StatementClassOfStockAxis", "us-gaap:PreferredStockMember")),
    osFact("dei:EntityCommonStockSharesOutstanding", "preferred", "14,594,180,000"),
  );
  const preferredDecision = resolveAuthoritativeOsFromFiling(await linkBody(base, candidate, preferredMemberBody));
  assert.equal(preferredDecision.status, "REQUIRES_FURTHER_CONTEXT");
  assert.equal(preferredDecision.reason, "SECURITY_CLASS_DIMENSION_UNSUPPORTED");
});

test("CompanyFacts and filing value mismatch, malformed numeric, unit, CIK, and rejected fact are never eligible", async () => {
  const audited = audit("AAPL");
  const candidate = companyCandidates(audited.sample_kind)[0]!;
  const cases: Array<[string, string, string]> = [
    ["value", osFact("dei:EntityCommonStockSharesOutstanding", "c-9", "14,594,180,001"), "COMPANYFACTS_FILING_VALUE_MISMATCH"],
    ["malformed", osFact("dei:EntityCommonStockSharesOutstanding", "c-9", "14,59x"), "FILING_FACT_MALFORMED"],
  ];
  for (const [name, fact, reason] of cases) {
    const linked = await linkBody(audited, candidate, inlineBody(context("c-9", candidate.issuerCik, candidate.asOf), fact));
    const decision = resolveAuthoritativeOsFromFiling(linked);
    assert.equal(decision.status, "UNAVAILABLE", name);
    assert.equal(decision.reason, reason, name);
  }

  const wrongUnit = inlineBody(
    `${unit("USD", "iso4217:USD")}${context("c-9", candidate.issuerCik, candidate.asOf)}`,
    osFact("dei:EntityCommonStockSharesOutstanding", "c-9", "14,594,180,000", "USD"),
    'xmlns:iso4217="http://www.xbrl.org/2003/iso4217"',
  );
  const unitDecision = resolveAuthoritativeOsFromFiling(await linkBody(audited, candidate, wrongUnit));
  assert.equal(unitDecision.status, "UNAVAILABLE");
  assert.equal(unitDecision.reason, "FILING_FACT_UNIT_NOT_SHARES");

  const wrongCik = inlineBody(context("c-9", "0000000001", candidate.asOf), osFact("dei:EntityCommonStockSharesOutstanding", "c-9", "14,594,180,000"));
  const cikDecision = resolveAuthoritativeOsFromFiling(await linkBody(audited, candidate, wrongCik));
  assert.equal(cikDecision.status, "UNAVAILABLE");
  assert.equal(cikDecision.reason, "FILING_FACT_CIK_MISMATCH");

  const broken = inlineBody(context("other", candidate.issuerCik, candidate.asOf), osFact("dei:EntityCommonStockSharesOutstanding", "missing", "14,594,180,000"));
  const brokenDecision = resolveAuthoritativeOsFromFiling(await linkBody(audited, candidate, broken));
  assert.equal(brokenDecision.status, "UNAVAILABLE");

  const rejectedRelevant = inlineBody(
    context("c-9", candidate.issuerCik, candidate.asOf),
    `${osFact("dei:EntityCommonStockSharesOutstanding", "c-9", "14,594,180,000")}<ix:fraction name="dei:EntityCommonStockSharesOutstanding" contextRef="c-9" unitRef="shares"><ix:numerator>1</ix:numerator><ix:denominator>2</ix:denominator></ix:fraction>`,
  );
  const rejectedDecision = resolveAuthoritativeOsFromFiling(await linkBody(audited, candidate, rejectedRelevant));
  assert.equal(rejectedDecision.status, "UNAVAILABLE");
  assert.equal(rejectedDecision.reason, "FILING_RELEVANT_FACT_REJECTED");
});

test("amendments remain separate eligible filing observations and chronology does not select a winner", async () => {
  const audited = audit("NEOM");
  const amended = companyCandidates(audited.sample_kind)[0]!;
  const original: SecOsFilingContextCandidate = {
    ...amended,
    accession: "0001144204-13-040001",
    form: "10-Q",
    filedDate: "2013-08-01",
    acceptedAt: "2013-08-01T12:00:00.000Z",
  };
  const amendedDecision = resolveAuthoritativeOsFromFiling(await link(audited, amended));
  const originalAudit = { ...audited, accession: original.accession, source_url: audited.source_url.replace("000114420413044345", "000114420413040001") };
  const originalDecision = resolveAuthoritativeOsFromFiling(await linkBody(
    originalAudit,
    original,
    xmlBody(original.issuerCik, original.asOf, original.sharesOutstanding, audited.context_ref),
    "instance_xml",
  ));
  assert.equal(amendedDecision.status, "ELIGIBLE");
  assert.equal(originalDecision.status, "ELIGIBLE");
  assert.notEqual(amendedDecision.candidate.accession, originalDecision.candidate.accession);
});

test("numeric normalization is exact for scale and rejects fractional, negative, nil, and unknown transforms", () => {
  const fact = parsedFacts(inlineBody(context("c", "0000320193", "2026-06-30"), osFact("us-gaap:CommonStockSharesOutstanding", "c", "12,230", "shares", "6")))[0]!;
  assert.equal(normalizeFilingInteger(fact), "12230000000");
  assert.equal(normalizeFilingInteger({ ...fact, valueText: "1.25", scale: "0" }), null);
  assert.equal(normalizeFilingInteger({ ...fact, sign: "-" }), null);
  assert.equal(normalizeFilingInteger({ ...fact, isNil: true }), null);
  assert.equal(normalizeFilingInteger({ ...fact, inlineFormat: "ixt:unknown" }), null);
});

test("official composed reader is read-only and invariant to candidate/artifact input order", async () => {
  const audited = audit("AAPL");
  const company = companySample(audited.sample_kind);
  const repository = new InMemorySecFilingXbrlArtifactRepository();
  const candidate = companyCandidates(audited.sample_kind)[0]!;
  const ledger = ledgerFor(audited, candidate);
  await repository.ingestArtifacts([
    ...inventoryArtifacts(audited, ledger, "inline_xbrl"),
    artifact(audited, filingBody(audited)),
  ]);
  const calls: unknown[] = [];
  const structuredRepository = {
    async readFacts(filter: SecFactReadFilter) {
      calls.push(filter);
      return [...company.facts].reverse().filter((fact) => fact.taxonomy === filter.taxonomy && fact.concept === filter.concept);
    },
    async readFilings() {
      calls.push("filings");
      return [...company.filings].reverse();
    },
  };
  const first = await readAuthoritativeOsCandidates({ structuredRepository, filingXbrlRepository: repository, cik: audited.cik });
  const replay = await readAuthoritativeOsCandidates({ structuredRepository, filingXbrlRepository: repository, cik: audited.cik });
  assert.deepEqual(replay, first);
  assert.equal(first.status, "ELIGIBLE");
  assert.equal(calls.length, 8);
});

function audit(ticker: string) {
  const found = auditFixture.issuers.find((item) => item.ticker === ticker);
  assert.ok(found, ticker);
  return found;
}

function foreignAudit(ticker: string) {
  const found = foreignAuditFixture.issuers.find((item) => item.ticker === ticker);
  assert.ok(found, ticker);
  return found;
}

function companySample(kind: string) {
  const found = companyFixture.issuers.find((item) => item.sampleKind === kind);
  assert.ok(found, kind);
  return structuredClone(found);
}

function companyCandidates(kind: string) {
  const sample = companySample(kind);
  return extractCompanyFactsOs({ cik: sample.cik, facts: sample.facts, filings: sample.filings }).candidates;
}

function foreignCompanyCandidates(audited: ForeignAuditSample) {
  const filingRawId = audited.ticker === "B"
    ? "66666666-6666-4666-8666-666666666666"
    : "77777777-7777-4777-8777-777777777777";
  const companyFactsRawId = audited.ticker === "B"
    ? "88888888-8888-4888-8888-888888888888"
    : "99999999-9999-4999-8999-999999999999";
  const fact: SecCompanyFactRow = {
    sourceFactKey: audited.full_document_sha256,
    sourceFactPath: "facts.dei.EntityCommonStockSharesOutstanding.units.shares[0]",
    issuerCik: audited.cik,
    filingAccession: audited.accession,
    form: audited.form,
    filedDate: audited.filed_date,
    sourceRawId: companyFactsRawId,
    sourceKind: "companyfacts",
    contextKind: "companyfacts_implicit",
    taxonomy: "dei",
    concept: "EntityCommonStockSharesOutstanding",
    unit: "shares",
    valueKind: "numeric",
    valueNumeric: audited.companyfacts_value,
    valueText: null,
    instantDate: audited.as_of,
    startDate: null,
    endDate: null,
    fiscalYear: Number(audited.as_of.slice(0, 4)),
    fiscalPeriod: "FY",
    frame: null,
    ingestedAt: "2026-08-31T00:00:00.000Z",
  };
  const filing: SecFilingRow = {
    accessionNumber: audited.accession,
    issuerCik: audited.cik,
    form: audited.form,
    filedDate: audited.filed_date,
    acceptedAt: audited.accepted_at,
    reportDate: audited.as_of,
    primaryDocument: audited.document,
    isXbrl: true,
    isInlineXbrl: true,
    sourceRawId: filingRawId,
    sourceKind: "submissions",
    ingestedAt: "2026-08-31T00:00:00.000Z",
  };
  return extractCompanyFactsOs({ cik: audited.cik, facts: [fact], filings: [filing] }).candidates;
}

async function link(audited: AuditSample, candidate: SecOsFilingContextCandidate) {
  return linkBody(audited, candidate, filingBody(audited), audited.ticker === "NEOM" ? "instance_xml" : "inline_xbrl");
}

async function linkBody(
  audited: AuditSample,
  candidate: SecOsFilingContextCandidate,
  body: string,
  role: "inline_xbrl" | "instance_xml" = "inline_xbrl",
) {
  const repository = new InMemorySecFilingXbrlArtifactRepository();
  const filing = ledgerFor(audited, candidate);
  await repository.ingestArtifacts([
    ...inventoryArtifacts(audited, filing, role),
    artifact(audited, body, role),
  ]);
  return readOsCandidateFilingContexts({ candidate, filing, repository });
}

async function linkForeign(
  audited: ForeignAuditSample,
  candidate: SecOsFilingContextCandidate,
  body = foreignFilingBody(audited),
) {
  const repository = new InMemorySecFilingXbrlArtifactRepository();
  const filing: SecFilingRow = {
    accessionNumber: candidate.accession,
    issuerCik: candidate.issuerCik,
    form: candidate.form,
    filedDate: candidate.filedDate,
    acceptedAt: candidate.acceptedAt,
    reportDate: audited.as_of,
    primaryDocument: audited.document,
    isXbrl: true,
    isInlineXbrl: true,
    sourceRawId: candidate.filingLedgerRawSourceId,
    sourceKind: "submissions",
    ingestedAt: "2026-08-31T00:00:00.000Z",
  };
  await repository.ingestArtifacts([
    ...inventoryArtifacts(audited, filing, "inline_xbrl"),
    artifact(audited, body),
  ]);
  return readOsCandidateFilingContexts({ candidate, filing, repository });
}

function ledgerFor(audited: AuditSample, candidate: SecOsFilingContextCandidate): SecFilingRow {
  const base = companySample(audited.sample_kind).filings[0]!;
  return {
    ...base,
    accessionNumber: candidate.accession,
    issuerCik: candidate.issuerCik,
    form: candidate.form,
    filedDate: candidate.filedDate,
    acceptedAt: candidate.acceptedAt,
    primaryDocument: audited.ticker === "NEOM" ? "v351884_10qa.htm" : audited.document,
    sourceRawId: candidate.filingLedgerRawSourceId,
  };
}

function inventoryArtifacts(
  audited: AuditSample,
  filing: SecFilingRow,
  role: "inline_xbrl" | "instance_xml",
) {
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

function artifact(audited: AuditSample, body: string, role: "inline_xbrl" | "instance_xml" = "inline_xbrl") {
  return createSecFilingXbrlFixtureArtifact({
    issuerCik: audited.cik,
    accession: audited.accession,
    documentName: audited.document,
    sourceUrl: audited.source_url,
    role,
    rawContent: body,
  });
}

function filingBody(audited: AuditSample) {
  if (audited.ticker === "NEOM") return xmlBody(audited.cik, audited.as_of, audited.filing_lexical_value, audited.context_ref);
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
    ? '<ix:nonNumeric name="dei:Security12bTitle" contextRef="title">American Depositary Shares, each representing one Ordinary Share</ix:nonNumeric>'
    : audited.ticker === "WIT"
      ? '<ix:nonNumeric name="dei:Security12bTitle" contextRef="title">American Depositary Shares, each representing one equity share</ix:nonNumeric>'
      : '<ix:nonNumeric name="dei:Security12bTitle" contextRef="title">Common Stock</ix:nonNumeric>';
  return inlineBody(
    `${context(audited.context_ref, audited.cik, audited.as_of)}${durationContext("title", audited.cik, audited.as_of)}`,
    `${title}${osFact("dei:EntityCommonStockSharesOutstanding", audited.context_ref, audited.filing_lexical_value)}`,
  );
}

function foreignFilingBody(
  audited: ForeignAuditSample,
  options: {
    title?: string;
    exchange?: string;
    omitTitle?: boolean;
    extraSecurity?: boolean;
  } = {},
) {
  const contexts = [
    context(audited.context_ref, audited.cik, audited.as_of),
    durationContext(audited.trading_context_ref, audited.cik, audited.as_of),
    ...(options.extraSecurity ? [durationContext("second-security", audited.cik, audited.as_of)] : []),
  ].join("");
  const title = options.title ?? audited.security_title;
  const securityFacts = [
    ...(options.omitTitle ? [] : [securityFact("Security12bTitle", audited.trading_context_ref, title)]),
    securityFact("TradingSymbol", audited.trading_context_ref, audited.trading_symbol),
    securityFact("SecurityExchangeName", audited.trading_context_ref, options.exchange ?? audited.exchange_name),
    ...(options.extraSecurity ? [
      securityFact("Security12bTitle", "second-security", "7.00% Notes due 2030"),
      securityFact("TradingSymbol", "second-security", "WIXN"),
      securityFact("SecurityExchangeName", "second-security", "The Nasdaq Stock Market LLC"),
    ] : []),
  ].join("");
  return inlineBody(
    contexts,
    `${securityFacts}${osFact("dei:EntityCommonStockSharesOutstanding", audited.context_ref, audited.filing_lexical_value)}`,
  );
}

function inlineBody(resources: string, facts: string, extraNamespace = "") {
  return `<?xml version="1.0"?><html ${NS} ${extraNamespace}><body><ix:header><ix:resources>${unit("shares", "xbrli:shares")}${resources}</ix:resources></ix:header>${facts}</body></html>`;
}

function xmlBody(cik: string, instant: string, value: string, contextRef: string) {
  return `<?xml version="1.0"?><xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:dei="http://xbrl.sec.gov/dei/2012">${unit("shares", "xbrli:shares")}${context(contextRef, cik, instant)}<dei:EntityCommonStockSharesOutstanding contextRef="${contextRef}" unitRef="shares" decimals="INF">${value}</dei:EntityCommonStockSharesOutstanding></xbrli:xbrl>`;
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

function securityFact(concept: string, contextRef: string, value: string) {
  return `<ix:nonNumeric name="dei:${concept}" contextRef="${contextRef}">${value}</ix:nonNumeric>`;
}

function parsedFacts(body: string): SecFilingXbrlFact[] {
  const audited = audit("AAPL");
  const parsed = parseSecFilingXbrlArtifacts([artifact(audited, body)]);
  assert.equal(parsed.status, "AVAILABLE");
  return parsed.status === "AVAILABLE" ? parsed.facts : [];
}
