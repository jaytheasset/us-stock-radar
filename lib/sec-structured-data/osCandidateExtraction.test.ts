import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  extractCompanyFactsOs,
  readOsCandidates,
  SEC_OS_CANDIDATE_CONCEPT,
  SEC_OS_ESCALATION_CONCEPT,
  SEC_OS_EXTRACTION_STATUSES,
  SEC_OS_SUPPORTED_DOMESTIC_FORMS,
  SEC_OS_SUPPORTED_FOREIGN_FORMS,
  type SecOsRejectionReason,
} from "./osCandidateExtraction.ts";
import type { SecCompanyFactRow, SecFilingRow } from "./types.ts";

type AuditSample = {
  sampleKind: string;
  cik: string;
  auditedObservation: { expectedStatus: string };
  facts: SecCompanyFactRow[];
  filings: SecFilingRow[];
};

const fixture = JSON.parse(await readFile(
  new URL("./fixtures/sec-os-five-issuer-audit.json", import.meta.url),
  "utf8",
)) as { issuers: AuditSample[] };

test("CompanyFacts-only runtime has no eligible status and all five audited issuers require filing context", () => {
  assert.deepEqual(SEC_OS_EXTRACTION_STATUSES, ["REQUIRES_FILING_CONTEXT", "UNAVAILABLE"]);
  for (const audited of fixture.issuers) {
    const extracted = extractSample(audited);
    assert.equal(extracted.extractionStatus, "REQUIRES_FILING_CONTEXT", audited.sampleKind);
    assert.equal(extracted.extractionStatus, audited.auditedObservation.expectedStatus);
    assert.equal(extracted.candidates.every((candidate) => candidate.extractionStatus === "REQUIRES_FILING_CONTEXT"), true);
  }
});

test("a validated domestic DEI fact preserves provenance but cannot prove one common security class", () => {
  const aapl = extractSample(sample("ordinary_us_common_stock"));
  assert.equal(aapl.candidates.length, 1);
  assert.deepEqual(aapl.candidates[0], {
    issuerCik: "0000320193",
    sharesOutstanding: "14594180000",
    asOf: "2026-07-17",
    accession: "0000320193-26-000020",
    form: "10-Q",
    filedDate: "2026-07-31",
    acceptedAt: "2026-07-31T10:01:02.000Z",
    taxonomy: SEC_OS_CANDIDATE_CONCEPT.taxonomy,
    concept: SEC_OS_CANDIDATE_CONCEPT.concept,
    unit: SEC_OS_CANDIDATE_CONCEPT.unit,
    sourceKind: "companyfacts",
    contextKind: "companyfacts_implicit",
    sourceFacts: [{
      sourceFactKey: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      sourceFactPath: "facts.dei.EntityCommonStockSharesOutstanding.units.shares[0]",
      sourceRawId: "11111111-1111-4111-8111-111111111111",
    }],
    filingLedgerRawSourceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    extractionStatus: "REQUIRES_FILING_CONTEXT",
    rejectionReason: "MISSING_COMPANYFACTS_SECURITY_CLASS_CONTEXT",
  });
  assert.equal(reasons(aapl).has("BALANCE_SHEET_CONCEPT_NOT_CANDIDATE"), true);
});

test("aggregate non-dimensional multi-class DEI is indistinguishable and therefore never promoted", () => {
  const base = sample("ordinary_us_common_stock");
  const aggregateDei = base.facts.find((fact) => fact.taxonomy === "dei")!;
  const adversarial = extractCompanyFactsOs({ cik: base.cik, facts: [aggregateDei], filings: base.filings });
  assert.equal(adversarial.extractionStatus, "REQUIRES_FILING_CONTEXT");
  assert.equal(adversarial.candidates[0]?.rejectionReason, "MISSING_COMPANYFACTS_SECURITY_CLASS_CONTEXT");
  assert.equal("axis" in aggregateDei || "member" in aggregateDei || "securityClass" in aggregateDei, false);
});

test("positive exact integer, instant period, shares unit, and source lineage still fail closed as unavailable", () => {
  const base = sample("ordinary_us_common_stock");
  const candidate = base.facts.find((fact) => fact.taxonomy === "dei")!;
  const cases: Array<[Partial<SecCompanyFactRow>, SecOsRejectionReason]> = [
    [{ valueNumeric: "0" }, "FACT_VALUE_NOT_POSITIVE_INTEGER"],
    [{ valueNumeric: "-1" }, "FACT_VALUE_NOT_POSITIVE_INTEGER"],
    [{ valueNumeric: "1.5" }, "FACT_VALUE_NOT_POSITIVE_INTEGER"],
    [{ valueNumeric: "1e3" }, "FACT_VALUE_NOT_POSITIVE_INTEGER"],
    [{ valueKind: "text", valueNumeric: null, valueText: "100" }, "FACT_VALUE_NOT_POSITIVE_INTEGER"],
    [{ unit: "USD" }, "FACT_UNIT_NOT_SHARES"],
    [{ instantDate: null, startDate: "2026-01-01", endDate: "2026-07-17" }, "FACT_PERIOD_NOT_INSTANT"],
    [{ sourceFactKey: "bad" }, "FACT_LINEAGE_INVALID"],
    [{ sourceFactPath: "" }, "FACT_LINEAGE_INVALID"],
    [{ sourceRawId: "bad" }, "FACT_LINEAGE_INVALID"],
    [{ contextKind: "filing_xbrl" as "companyfacts_implicit" }, "FACT_LINEAGE_INVALID"],
    [{ filingAccession: "bad" }, "FACT_ACCESSION_INVALID"],
    [{ issuerCik: "0000000001" }, "FACT_CIK_MISMATCH"],
  ];

  for (const [change, reason] of cases) {
    const extracted = extractCompanyFactsOs({
      cik: base.cik,
      facts: [{ ...candidate, ...change }],
      filings: base.filings,
    });
    assert.equal(extracted.extractionStatus, "UNAVAILABLE", JSON.stringify(change));
    assert.equal(extracted.rejected[0]?.rejectionReason, reason, JSON.stringify(change));
  }
});

test("supported forms preserve chronology but do not establish class; ledger acceptance remains mandatory", () => {
  const base = sample("ordinary_us_common_stock");
  const candidate = base.facts.find((fact) => fact.taxonomy === "dei")!;
  const filing = base.filings[0]!;

  for (const form of SEC_OS_SUPPORTED_DOMESTIC_FORMS) {
    const extracted = extractCompanyFactsOs({
      cik: base.cik,
      facts: [{ ...candidate, form }],
      filings: [{ ...filing, form }],
    });
    assert.equal(extracted.extractionStatus, "REQUIRES_FILING_CONTEXT", form);
    assert.equal(extracted.candidates[0]?.rejectionReason, "MISSING_COMPANYFACTS_SECURITY_CLASS_CONTEXT");
  }

  for (const form of SEC_OS_SUPPORTED_FOREIGN_FORMS) {
    const extracted = extractCompanyFactsOs({
      cik: base.cik,
      facts: [{ ...candidate, form }],
      filings: [{ ...filing, form }],
    });
    assert.equal(extracted.extractionStatus, "REQUIRES_FILING_CONTEXT", form);
    assert.equal(extracted.candidates[0]?.rejectionReason, "ADS_OR_ORDINARY_SHARES_REQUIRE_FILING_CONTEXT");
  }

  const unsupported = extractCompanyFactsOs({
    cik: base.cik,
    facts: [{ ...candidate, form: "8-K" }],
    filings: [{ ...filing, form: "8-K" }],
  });
  assert.equal(unsupported.extractionStatus, "UNAVAILABLE");
  assert.equal(unsupported.rejected[0]?.rejectionReason, "FACT_FORM_NOT_SUPPORTED");

  const noJoin = extractCompanyFactsOs({ cik: base.cik, facts: [candidate], filings: [] });
  assert.equal(noJoin.rejected[0]?.rejectionReason, "FILING_LEDGER_IDENTITY_MISSING");
  const noAccepted = extractCompanyFactsOs({
    cik: base.cik,
    facts: [candidate],
    filings: [{ ...filing, acceptedAt: null }],
  });
  assert.equal(noAccepted.rejected[0]?.rejectionReason, "FILING_LEDGER_ACCEPTED_AT_MISSING");
});

test("identical filing-context candidates dedupe while retaining every raw source identity", () => {
  const base = sample("ordinary_us_common_stock");
  const candidate = base.facts.find((fact) => fact.taxonomy === "dei")!;
  const duplicate: SecCompanyFactRow = {
    ...candidate,
    sourceFactKey: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    sourceFactPath: "facts.dei.EntityCommonStockSharesOutstanding.units.shares[99]",
    sourceRawId: "99999999-9999-4999-8999-999999999999",
  };
  const extracted = extractCompanyFactsOs({
    cik: base.cik,
    facts: [duplicate, candidate, structuredClone(candidate)],
    filings: base.filings,
  });
  assert.equal(extracted.candidates.length, 1);
  assert.deepEqual(extracted.candidates[0]?.sourceFacts.map((row) => row.sourceFactKey), [
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
  ]);
});

test("amendments remain distinct chronology and never become authoritative winners", () => {
  const base = sample("small_cap_amendment_reverse_split_history");
  const amended = base.facts[0]!;
  const amendedFiling = base.filings[0]!;
  const original: SecCompanyFactRow = {
    ...amended,
    sourceFactKey: "1212121212121212121212121212121212121212121212121212121212121212",
    filingAccession: "0001144204-13-040001",
    form: "10-Q",
    filedDate: "2013-08-01",
  };
  const originalFiling: SecFilingRow = {
    ...amendedFiling,
    accessionNumber: original.filingAccession,
    form: original.form,
    filedDate: original.filedDate,
    acceptedAt: "2013-08-01T12:00:00.000Z",
  };
  const extracted = extractCompanyFactsOs({
    cik: base.cik,
    facts: [amended, original],
    filings: [amendedFiling, originalFiling],
  });
  assert.deepEqual(extracted.candidates.map((row) => row.accession), [
    "0001144204-13-040001",
    "0001144204-13-044345",
  ]);
  assert.equal(extracted.candidates.every((row) => row.extractionStatus === "REQUIRES_FILING_CONTEXT"), true);
});

test("same-date value or concept conflicts retain no winner and carry the conflict reason", () => {
  const base = sample("ordinary_us_common_stock");
  const candidate = base.facts.find((fact) => fact.taxonomy === "dei")!;
  const valueConflict: SecCompanyFactRow = {
    ...candidate,
    sourceFactKey: "3434343434343434343434343434343434343434343434343434343434343434",
    valueNumeric: "14594180001",
  };
  const conflictingValues = extractCompanyFactsOs({
    cik: base.cik,
    facts: [candidate, valueConflict],
    filings: base.filings,
  });
  assert.equal(conflictingValues.candidates.length, 2);
  assert.equal(conflictingValues.candidates.every((row) => row.rejectionReason === "SAME_DATE_CONFLICT_REQUIRES_FILING_CONTEXT"), true);

  const balanceSheet = base.facts.find((fact) => fact.taxonomy === "us-gaap")!;
  const conflictingConcept = extractCompanyFactsOs({
    cik: base.cik,
    facts: [candidate, { ...balanceSheet, instantDate: candidate.instantDate }],
    filings: base.filings,
  });
  assert.equal(conflictingConcept.candidates.length, 2);
  assert.equal(conflictingConcept.candidates.every((row) => row.rejectionReason === "SAME_DATE_CONFLICT_REQUIRES_FILING_CONTEXT"), true);
});

test("input order and deterministic replay do not change escalation output", () => {
  for (const audited of fixture.issuers) {
    const first = extractSample(audited);
    const replay = extractCompanyFactsOs({
      cik: audited.cik,
      facts: [...audited.facts].reverse(),
      filings: [...audited.filings].reverse(),
    });
    assert.deepEqual(replay, first, audited.sampleKind);
  }
});

test("official reader remains read-only and returns filing-context candidates, never authoritative O/S", async () => {
  const base = sample("ordinary_us_common_stock");
  const calls: Array<Record<string, unknown>> = [];
  const repository = {
    async readFacts(filter: Record<string, unknown>) {
      calls.push(filter);
      return base.facts.filter((fact) => fact.taxonomy === filter.taxonomy && fact.concept === filter.concept);
    },
    async readFilings(cik: string, limit?: number) {
      calls.push({ cik, limit, kind: "filings" });
      return base.filings;
    },
  };
  const extracted = await readOsCandidates(repository, base.cik);
  assert.equal(extracted.extractionStatus, "REQUIRES_FILING_CONTEXT");
  assert.deepEqual(calls, [
    { cik: base.cik, taxonomy: SEC_OS_CANDIDATE_CONCEPT.taxonomy, concept: SEC_OS_CANDIDATE_CONCEPT.concept, limit: 1000 },
    { cik: base.cik, taxonomy: SEC_OS_ESCALATION_CONCEPT.taxonomy, concept: SEC_OS_ESCALATION_CONCEPT.concept, limit: 1000 },
    { cik: base.cik, limit: 1000, kind: "filings" },
  ]);
});

test("unsupported or absent facts are unavailable rather than estimated or substituted", () => {
  const base = sample("ordinary_us_common_stock");
  const unsupported = { ...base.facts[0]!, concept: "CommonStockSharesIssued" };
  const extracted = extractCompanyFactsOs({ cik: base.cik, facts: [unsupported], filings: base.filings });
  assert.equal(extracted.extractionStatus, "UNAVAILABLE");
  assert.equal(extracted.candidates.length, 0);
  assert.equal(extracted.rejected[0]?.rejectionReason, "NO_RELEVANT_COMPANYFACTS_FACT");
});

function sample(kind: string) {
  const found = fixture.issuers.find((issuer) => issuer.sampleKind === kind);
  assert.ok(found, kind);
  return structuredClone(found);
}
function extractSample(audited: AuditSample) {
  return extractCompanyFactsOs({ cik: audited.cik, facts: audited.facts, filings: audited.filings });
}
function reasons(extracted: ReturnType<typeof extractCompanyFactsOs>) {
  return new Set([
    ...extracted.candidates.map((row) => row.rejectionReason),
    ...extracted.rejected.map((row) => row.rejectionReason),
  ]);
}
