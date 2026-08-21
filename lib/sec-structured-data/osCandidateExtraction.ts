import type {
  SecCompanyFactRow,
  SecFilingRow,
  SecStructuredRepository,
} from "./types.ts";

export const SEC_OS_EXTRACTION_STATUSES = [
  "COMPANY_FACTS_ELIGIBLE",
  "REQUIRES_FILING_CONTEXT",
  "UNAVAILABLE",
] as const;

export type SecOsExtractionStatus = (typeof SEC_OS_EXTRACTION_STATUSES)[number];

export const SEC_OS_REJECTION_REASONS = [
  "ADS_OR_ORDINARY_SHARES_REQUIRE_FILING_CONTEXT",
  "BALANCE_SHEET_CONCEPT_NOT_CANDIDATE",
  "DIMENSION_SENSITIVE_FACT_REQUIRES_FILING_CONTEXT",
  "FACT_ACCESSION_INVALID",
  "FACT_CIK_MISMATCH",
  "FACT_FORM_NOT_ALLOWED",
  "FACT_LINEAGE_INVALID",
  "FACT_PERIOD_NOT_INSTANT",
  "FACT_UNIT_NOT_SHARES",
  "FACT_VALUE_NOT_POSITIVE_INTEGER",
  "FILING_LEDGER_ACCEPTED_AT_MISSING",
  "FILING_LEDGER_IDENTITY_MISSING",
  "FILING_LEDGER_LINEAGE_INVALID",
  "MISSING_COMPANYFACTS_SECURITY_CLASS_CONTEXT",
  "MULTIPLE_SECURITY_CLASSES_REQUIRE_FILING_CONTEXT",
  "NO_RELEVANT_COMPANYFACTS_FACT",
  "SAME_DATE_CONFLICT_REQUIRES_FILING_CONTEXT",
] as const;

export type SecOsRejectionReason = (typeof SEC_OS_REJECTION_REASONS)[number];

export const SEC_OS_ALLOWED_FORMS = ["10-K", "10-K/A", "10-Q", "10-Q/A"] as const;
export type SecOsAllowedForm = (typeof SEC_OS_ALLOWED_FORMS)[number];

export const SEC_OS_CANDIDATE_CONCEPT = {
  taxonomy: "dei",
  concept: "EntityCommonStockSharesOutstanding",
  unit: "shares",
} as const;

export const SEC_OS_ESCALATION_CONCEPT = {
  taxonomy: "us-gaap",
  concept: "CommonStockSharesOutstanding",
  unit: "shares",
} as const;

export type SecOsSourceFactIdentity = {
  sourceFactKey: string;
  sourceFactPath: string;
  sourceRawId: string;
};

type SecOsObservationBase = {
  issuerCik: string;
  sharesOutstanding: string | null;
  asOf: string | null;
  accession: string | null;
  form: string | null;
  filedDate: string | null;
  acceptedAt: string | null;
  taxonomy: string | null;
  concept: string | null;
  unit: string | null;
  sourceKind: "companyfacts" | null;
  contextKind: "companyfacts_implicit" | null;
  sourceFacts: SecOsSourceFactIdentity[];
  filingLedgerRawSourceId: string | null;
};

export type SecOsEligibleCandidate = SecOsObservationBase & {
  sharesOutstanding: string;
  asOf: string;
  accession: string;
  form: SecOsAllowedForm;
  filedDate: string;
  acceptedAt: string;
  taxonomy: "dei";
  concept: "EntityCommonStockSharesOutstanding";
  unit: "shares";
  sourceKind: "companyfacts";
  contextKind: "companyfacts_implicit";
  filingLedgerRawSourceId: string;
  extractionStatus: "COMPANY_FACTS_ELIGIBLE";
  rejectionReason: null;
};

export type SecOsRejectedObservation = SecOsObservationBase & {
  extractionStatus: "REQUIRES_FILING_CONTEXT" | "UNAVAILABLE";
  rejectionReason: SecOsRejectionReason;
};

export type SecOsObservation = SecOsEligibleCandidate | SecOsRejectedObservation;

export type SecOsExtractionResult = {
  issuerCik: string;
  extractionStatus: SecOsExtractionStatus;
  candidates: SecOsEligibleCandidate[];
  rejected: SecOsRejectedObservation[];
};

export async function readOsCandidates(
  repository: Pick<SecStructuredRepository, "readFacts" | "readFilings">,
  cik: string,
): Promise<SecOsExtractionResult> {
  const [candidateFacts, balanceSheetFacts, filings] = await Promise.all([
    repository.readFacts({
      cik,
      taxonomy: SEC_OS_CANDIDATE_CONCEPT.taxonomy,
      concept: SEC_OS_CANDIDATE_CONCEPT.concept,
      limit: 1000,
    }),
    repository.readFacts({
      cik,
      taxonomy: SEC_OS_ESCALATION_CONCEPT.taxonomy,
      concept: SEC_OS_ESCALATION_CONCEPT.concept,
      limit: 1000,
    }),
    repository.readFilings(cik, 1000),
  ]);
  return extractCompanyFactsOs({ cik, facts: [...candidateFacts, ...balanceSheetFacts], filings });
}

export function extractCompanyFactsOs(input: {
  cik: string;
  facts: readonly SecCompanyFactRow[];
  filings: readonly SecFilingRow[];
}): SecOsExtractionResult {
  const issuerCik = input.cik;
  const relevantFacts = input.facts.filter(isRelevantConcept);
  if (relevantFacts.length === 0) {
    return result(issuerCik, [], [syntheticUnavailable(issuerCik, "NO_RELEVANT_COMPANYFACTS_FACT")]);
  }

  const filingsByIdentity = new Map<string, SecFilingRow[]>();
  for (const filing of input.filings) {
    const key = filingIdentity(filing.accessionNumber, filing.issuerCik, filing.form, filing.filedDate);
    const rows = filingsByIdentity.get(key) ?? [];
    rows.push(filing);
    filingsByIdentity.set(key, rows);
  }

  const candidateFactsByAccession = new Map<string, SecCompanyFactRow[]>();
  for (const fact of relevantFacts.filter(isCandidateConcept)) {
    const rows = candidateFactsByAccession.get(fact.filingAccession) ?? [];
    rows.push(fact);
    candidateFactsByAccession.set(fact.filingAccession, rows);
  }

  const candidates: SecOsEligibleCandidate[] = [];
  const rejected: SecOsRejectedObservation[] = [];
  const balanceSheetSignals: ValidatedFact[] = [];

  for (const fact of relevantFacts) {
    const validated = validateFact(issuerCik, fact, filingsByIdentity);
    if ("rejected" in validated) {
      rejected.push(validated.rejected);
      continue;
    }

    if (isCandidateConcept(fact)) {
      if (isForeignReportForm(fact.form)) {
        rejected.push(rejectValidated(
          validated,
          "REQUIRES_FILING_CONTEXT",
          "ADS_OR_ORDINARY_SHARES_REQUIRE_FILING_CONTEXT",
        ));
        continue;
      }
      if (!isAllowedForm(fact.form)) {
        rejected.push(rejectValidated(validated, "UNAVAILABLE", "FACT_FORM_NOT_ALLOWED"));
        continue;
      }
      candidates.push(eligible(validated));
      continue;
    }

    balanceSheetSignals.push(validated);
  }

  const dedupedCandidates = dedupeCandidates(candidates);
  const candidateAccessions = new Set(relevantFacts.filter(isCandidateConcept).map((fact) => fact.filingAccession));
  const sameDateConceptSignals = new Map<string, ValidatedFact[]>();

  for (const signal of balanceSheetSignals) {
    if (isForeignReportForm(signal.fact.form)) {
      rejected.push(rejectValidated(
        signal,
        "REQUIRES_FILING_CONTEXT",
        "ADS_OR_ORDINARY_SHARES_REQUIRE_FILING_CONTEXT",
      ));
      continue;
    }
    if (!isAllowedForm(signal.fact.form)) {
      rejected.push(rejectValidated(signal, "UNAVAILABLE", "BALANCE_SHEET_CONCEPT_NOT_CANDIDATE"));
      continue;
    }
    const sameDateCandidate = dedupedCandidates.some((candidate) =>
      candidate.accession === signal.fact.filingAccession && candidate.asOf === signal.fact.instantDate
    );
    if (sameDateCandidate) {
      const key = dateIdentity(issuerCik, signal.fact.instantDate!);
      const rows = sameDateConceptSignals.get(key) ?? [];
      rows.push(signal);
      sameDateConceptSignals.set(key, rows);
    } else if (!candidateAccessions.has(signal.fact.filingAccession)) {
      rejected.push(rejectValidated(
        signal,
        "REQUIRES_FILING_CONTEXT",
        "MISSING_COMPANYFACTS_SECURITY_CLASS_CONTEXT",
      ));
    } else {
      rejected.push(rejectValidated(signal, "UNAVAILABLE", "BALANCE_SHEET_CONCEPT_NOT_CANDIDATE"));
    }
  }

  const conflictDates = conflictingDates(dedupedCandidates, sameDateConceptSignals);
  const safeCandidates: SecOsEligibleCandidate[] = [];
  for (const candidate of dedupedCandidates) {
    if (!conflictDates.has(dateIdentity(candidate.issuerCik, candidate.asOf))) {
      safeCandidates.push(candidate);
      continue;
    }
    rejected.push({
      ...candidate,
      extractionStatus: "REQUIRES_FILING_CONTEXT",
      rejectionReason: "SAME_DATE_CONFLICT_REQUIRES_FILING_CONTEXT",
    });
  }
  for (const [key, signals] of sameDateConceptSignals) {
    if (!conflictDates.has(key)) continue;
    for (const signal of signals) {
      rejected.push(rejectValidated(
        signal,
        "REQUIRES_FILING_CONTEXT",
        "SAME_DATE_CONFLICT_REQUIRES_FILING_CONTEXT",
      ));
    }
  }

  return result(issuerCik, safeCandidates, rejected);
}

type ValidatedFact = { fact: SecCompanyFactRow; filing: SecFilingRow };

function validateFact(
  issuerCik: string,
  fact: SecCompanyFactRow,
  filingsByIdentity: ReadonlyMap<string, SecFilingRow[]>,
): ValidatedFact | { rejected: SecOsRejectedObservation } {
  const base = observationBase(issuerCik, fact, null);
  if (!validCik(issuerCik) || fact.issuerCik !== issuerCik) {
    return { rejected: reject(base, "UNAVAILABLE", "FACT_CIK_MISMATCH") };
  }
  if (!ACCESSION_PATTERN.test(fact.filingAccession)) {
    return { rejected: reject(base, "UNAVAILABLE", "FACT_ACCESSION_INVALID") };
  }
  if (
    fact.sourceKind !== "companyfacts" || fact.contextKind !== "companyfacts_implicit"
    || !HEX_64_PATTERN.test(fact.sourceFactKey) || !fact.sourceFactPath.trim()
    || !UUID_PATTERN.test(fact.sourceRawId)
  ) {
    return { rejected: reject(base, "UNAVAILABLE", "FACT_LINEAGE_INVALID") };
  }
  if (fact.unit !== "shares") {
    return { rejected: reject(base, "UNAVAILABLE", "FACT_UNIT_NOT_SHARES") };
  }
  if (
    fact.valueKind !== "numeric" || !fact.valueNumeric
    || !POSITIVE_INTEGER_PATTERN.test(fact.valueNumeric) || fact.valueText !== null
  ) {
    return { rejected: reject(base, "UNAVAILABLE", "FACT_VALUE_NOT_POSITIVE_INTEGER") };
  }
  if (!fact.instantDate || !validDate(fact.instantDate) || fact.startDate !== null || fact.endDate !== null) {
    return { rejected: reject(base, "UNAVAILABLE", "FACT_PERIOD_NOT_INSTANT") };
  }
  if (!validDate(fact.filedDate)) {
    return { rejected: reject(base, "UNAVAILABLE", "FACT_LINEAGE_INVALID") };
  }

  const identity = filingIdentity(fact.filingAccession, fact.issuerCik, fact.form, fact.filedDate);
  const filingRows = filingsByIdentity.get(identity) ?? [];
  if (filingRows.length !== 1) {
    return { rejected: reject(base, "UNAVAILABLE", "FILING_LEDGER_IDENTITY_MISSING") };
  }
  const filing = filingRows[0]!;
  const withFiling = observationBase(issuerCik, fact, filing);
  if (
    filing.sourceKind !== "submissions" || !UUID_PATTERN.test(filing.sourceRawId)
    || filing.issuerCik !== issuerCik || filing.accessionNumber !== fact.filingAccession
    || filing.form !== fact.form || filing.filedDate !== fact.filedDate
  ) {
    return { rejected: reject(withFiling, "UNAVAILABLE", "FILING_LEDGER_LINEAGE_INVALID") };
  }
  if (!filing.acceptedAt || !validTimestamp(filing.acceptedAt)) {
    return { rejected: reject(withFiling, "UNAVAILABLE", "FILING_LEDGER_ACCEPTED_AT_MISSING") };
  }
  return { fact, filing };
}

function eligible(validated: ValidatedFact): SecOsEligibleCandidate {
  const { fact, filing } = validated;
  return {
    ...observationBase(fact.issuerCik, fact, filing),
    sharesOutstanding: fact.valueNumeric!,
    asOf: fact.instantDate!,
    accession: fact.filingAccession,
    form: fact.form as SecOsAllowedForm,
    filedDate: fact.filedDate,
    acceptedAt: filing.acceptedAt!,
    taxonomy: "dei",
    concept: "EntityCommonStockSharesOutstanding",
    unit: "shares",
    sourceKind: "companyfacts",
    contextKind: "companyfacts_implicit",
    filingLedgerRawSourceId: filing.sourceRawId,
    extractionStatus: "COMPANY_FACTS_ELIGIBLE",
    rejectionReason: null,
  };
}

function observationBase(
  issuerCik: string,
  fact: SecCompanyFactRow | null,
  filing: SecFilingRow | null,
): SecOsObservationBase {
  return {
    issuerCik,
    sharesOutstanding: fact?.valueNumeric ?? null,
    asOf: fact?.instantDate ?? null,
    accession: fact?.filingAccession ?? null,
    form: fact?.form ?? null,
    filedDate: fact?.filedDate ?? null,
    acceptedAt: filing?.acceptedAt ?? null,
    taxonomy: fact?.taxonomy ?? null,
    concept: fact?.concept ?? null,
    unit: fact?.unit ?? null,
    sourceKind: fact?.sourceKind ?? null,
    contextKind: fact?.contextKind ?? null,
    sourceFacts: fact ? [{
      sourceFactKey: fact.sourceFactKey,
      sourceFactPath: fact.sourceFactPath,
      sourceRawId: fact.sourceRawId,
    }] : [],
    filingLedgerRawSourceId: filing?.sourceRawId ?? null,
  };
}

function reject(
  base: SecOsObservationBase,
  extractionStatus: "REQUIRES_FILING_CONTEXT" | "UNAVAILABLE",
  rejectionReason: SecOsRejectionReason,
): SecOsRejectedObservation {
  return { ...base, extractionStatus, rejectionReason };
}

function rejectValidated(
  validated: ValidatedFact,
  extractionStatus: "REQUIRES_FILING_CONTEXT" | "UNAVAILABLE",
  rejectionReason: SecOsRejectionReason,
) {
  return reject(observationBase(validated.fact.issuerCik, validated.fact, validated.filing), extractionStatus, rejectionReason);
}

function syntheticUnavailable(issuerCik: string, reason: SecOsRejectionReason) {
  return reject(observationBase(issuerCik, null, null), "UNAVAILABLE", reason);
}

function dedupeCandidates(candidates: readonly SecOsEligibleCandidate[]) {
  const byIdentity = new Map<string, SecOsEligibleCandidate>();
  for (const candidate of [...candidates].sort(compareObservations)) {
    const key = canonicalObservationIdentity(candidate);
    const current = byIdentity.get(key);
    if (!current) {
      byIdentity.set(key, candidate);
      continue;
    }
    const sourceFacts = uniqueSourceFacts([...current.sourceFacts, ...candidate.sourceFacts]);
    byIdentity.set(key, { ...current, sourceFacts });
  }
  return [...byIdentity.values()].sort(compareObservations);
}

function conflictingDates(
  candidates: readonly SecOsEligibleCandidate[],
  conceptSignals: ReadonlyMap<string, readonly ValidatedFact[]>,
) {
  const valuesByDate = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    const key = dateIdentity(candidate.issuerCik, candidate.asOf);
    const values = valuesByDate.get(key) ?? new Set<string>();
    values.add(`${candidate.taxonomy}:${candidate.concept}:${candidate.sharesOutstanding}`);
    valuesByDate.set(key, values);
  }
  const conflicts = new Set<string>();
  for (const [key, values] of valuesByDate) {
    if (values.size > 1 || (conceptSignals.get(key)?.length ?? 0) > 0) conflicts.add(key);
  }
  return conflicts;
}

function result(
  issuerCik: string,
  candidates: readonly SecOsEligibleCandidate[],
  rejected: readonly SecOsRejectedObservation[],
): SecOsExtractionResult {
  const sortedCandidates = [...candidates].sort(compareObservations);
  const sortedRejected = [...rejected].sort(compareObservations);
  const extractionStatus: SecOsExtractionStatus = sortedCandidates.length > 0
    ? "COMPANY_FACTS_ELIGIBLE"
    : sortedRejected.some((row) => row.extractionStatus === "REQUIRES_FILING_CONTEXT")
      ? "REQUIRES_FILING_CONTEXT"
      : "UNAVAILABLE";
  return { issuerCik, extractionStatus, candidates: sortedCandidates, rejected: sortedRejected };
}

function compareObservations(left: SecOsObservation, right: SecOsObservation) {
  return chronologyKey(left).localeCompare(chronologyKey(right));
}

function chronologyKey(row: SecOsObservation) {
  return [
    row.acceptedAt ?? "",
    row.filedDate ?? "",
    row.asOf ?? "",
    row.accession ?? "",
    row.taxonomy ?? "",
    row.concept ?? "",
    row.sharesOutstanding ?? "",
    row.extractionStatus,
    row.rejectionReason ?? "",
    row.sourceFacts.map(sourceFactIdentity).sort().join(","),
  ].join("|");
}

function canonicalObservationIdentity(candidate: SecOsEligibleCandidate) {
  return [
    candidate.issuerCik,
    candidate.sharesOutstanding,
    candidate.asOf,
    candidate.accession,
    candidate.form,
    candidate.filedDate,
    candidate.acceptedAt,
    candidate.taxonomy,
    candidate.concept,
    candidate.unit,
    candidate.filingLedgerRawSourceId,
  ].join("|");
}

function uniqueSourceFacts(rows: readonly SecOsSourceFactIdentity[]) {
  return [...new Map(rows.map((row) => [sourceFactIdentity(row), row])).values()]
    .sort((left, right) => sourceFactIdentity(left).localeCompare(sourceFactIdentity(right)));
}

function sourceFactIdentity(row: SecOsSourceFactIdentity) {
  return `${row.sourceFactKey}|${row.sourceFactPath}|${row.sourceRawId}`;
}

function filingIdentity(accession: string, cik: string, form: string, filedDate: string) {
  return `${accession}|${cik}|${form}|${filedDate}`;
}

function dateIdentity(cik: string, asOf: string) {
  return `${cik}|${asOf}`;
}

function isCandidateConcept(fact: SecCompanyFactRow) {
  return fact.taxonomy === SEC_OS_CANDIDATE_CONCEPT.taxonomy
    && fact.concept === SEC_OS_CANDIDATE_CONCEPT.concept;
}

function isRelevantConcept(fact: SecCompanyFactRow) {
  return isCandidateConcept(fact) || (
    fact.taxonomy === SEC_OS_ESCALATION_CONCEPT.taxonomy
    && fact.concept === SEC_OS_ESCALATION_CONCEPT.concept
  );
}

function isAllowedForm(form: string): form is SecOsAllowedForm {
  return (SEC_OS_ALLOWED_FORMS as readonly string[]).includes(form);
}

function isForeignReportForm(form: string) {
  return ["20-F", "20-F/A", "40-F", "40-F/A", "6-K", "6-K/A"].includes(form);
}

function validCik(value: string) {
  return CIK_PATTERN.test(value) && value !== "0000000000";
}

function validDate(value: string) {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function validTimestamp(value: string) {
  if (!TIMESTAMP_PATTERN.test(value)) return false;
  return !Number.isNaN(new Date(value).valueOf());
}

const CIK_PATTERN = /^[0-9]{10}$/;
const ACCESSION_PATTERN = /^[0-9]{10}-[0-9]{2}-[0-9]{6}$/;
const HEX_64_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;
const DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const TIMESTAMP_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$/;
