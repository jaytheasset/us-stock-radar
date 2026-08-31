import type {
  SecCompanyFactRow,
  SecFilingRow,
  SecStructuredRepository,
} from "./types.ts";

export const SEC_OS_EXTRACTION_STATUSES = ["REQUIRES_FILING_CONTEXT", "UNAVAILABLE"] as const;
export type SecOsExtractionStatus = (typeof SEC_OS_EXTRACTION_STATUSES)[number];

export const SEC_OS_REJECTION_REASONS = [
  "ADS_OR_ORDINARY_SHARES_REQUIRE_FILING_CONTEXT",
  "BALANCE_SHEET_CONCEPT_NOT_CANDIDATE",
  "FACT_ACCESSION_INVALID",
  "FACT_CIK_MISMATCH",
  "FACT_FORM_NOT_SUPPORTED",
  "FACT_LINEAGE_INVALID",
  "FACT_PERIOD_NOT_INSTANT",
  "FACT_UNIT_NOT_SHARES",
  "FACT_VALUE_NOT_POSITIVE_INTEGER",
  "FILING_LEDGER_ACCEPTED_AT_MISSING",
  "FILING_LEDGER_IDENTITY_MISSING",
  "FILING_LEDGER_LINEAGE_INVALID",
  "MISSING_COMPANYFACTS_SECURITY_CLASS_CONTEXT",
  "NO_RELEVANT_COMPANYFACTS_FACT",
  "SAME_DATE_CONFLICT_REQUIRES_FILING_CONTEXT",
] as const;
export type SecOsRejectionReason = (typeof SEC_OS_REJECTION_REASONS)[number];

export const SEC_OS_SUPPORTED_DOMESTIC_FORMS = ["10-K", "10-K/A", "10-Q", "10-Q/A"] as const;
export type SecOsSupportedDomesticForm = (typeof SEC_OS_SUPPORTED_DOMESTIC_FORMS)[number];
export const SEC_OS_SUPPORTED_FOREIGN_FORMS = ["20-F", "20-F/A", "40-F", "40-F/A", "6-K", "6-K/A"] as const;
export type SecOsSupportedForeignForm = (typeof SEC_OS_SUPPORTED_FOREIGN_FORMS)[number];

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

export type SecOsFilingContextCandidate = SecOsObservationBase & {
  sharesOutstanding: string;
  asOf: string;
  accession: string;
  form: string;
  filedDate: string;
  acceptedAt: string;
  taxonomy: "dei" | "us-gaap";
  concept: "EntityCommonStockSharesOutstanding" | "CommonStockSharesOutstanding";
  unit: "shares";
  sourceKind: "companyfacts";
  contextKind: "companyfacts_implicit";
  filingLedgerRawSourceId: string;
  extractionStatus: "REQUIRES_FILING_CONTEXT";
  rejectionReason:
    | "ADS_OR_ORDINARY_SHARES_REQUIRE_FILING_CONTEXT"
    | "MISSING_COMPANYFACTS_SECURITY_CLASS_CONTEXT"
    | "SAME_DATE_CONFLICT_REQUIRES_FILING_CONTEXT";
};

export type SecOsUnavailableObservation = SecOsObservationBase & {
  extractionStatus: "UNAVAILABLE";
  rejectionReason: Exclude<
    SecOsRejectionReason,
    | "ADS_OR_ORDINARY_SHARES_REQUIRE_FILING_CONTEXT"
    | "MISSING_COMPANYFACTS_SECURITY_CLASS_CONTEXT"
    | "SAME_DATE_CONFLICT_REQUIRES_FILING_CONTEXT"
  >;
};

export type SecOsObservation = SecOsFilingContextCandidate | SecOsUnavailableObservation;
export type SecOsExtractionResult = {
  issuerCik: string;
  extractionStatus: SecOsExtractionStatus;
  candidates: SecOsFilingContextCandidate[];
  rejected: SecOsUnavailableObservation[];
};

export async function readOsCandidates(
  repository: Pick<SecStructuredRepository, "readFacts" | "readFilings">,
  cik: string,
  boundary?: { asOf: string; acceptedAt: string },
): Promise<SecOsExtractionResult> {
  const [candidateFacts, balanceSheetFacts, filings] = await Promise.all([
    repository.readFacts({
      cik,
      taxonomy: SEC_OS_CANDIDATE_CONCEPT.taxonomy,
      concept: SEC_OS_CANDIDATE_CONCEPT.concept,
      ...(boundary ? { instantDateAfter: boundary.asOf } : {}),
      limit: 1000,
    }),
    repository.readFacts({
      cik,
      taxonomy: SEC_OS_ESCALATION_CONCEPT.taxonomy,
      concept: SEC_OS_ESCALATION_CONCEPT.concept,
      ...(boundary ? { instantDateAfter: boundary.asOf } : {}),
      limit: 1000,
    }),
    boundary
      ? repository.readFilings(cik, 1000, { acceptedAfter: boundary.acceptedAt })
      : repository.readFilings(cik, 1000),
  ]);
  return extractCompanyFactsOs({
    cik,
    facts: [...candidateFacts, ...balanceSheetFacts].filter((fact) =>
      !boundary || (fact.instantDate !== null && fact.instantDate > boundary.asOf)),
    filings: filings.filter((filing) =>
      !boundary || (filing.acceptedAt !== null && filing.acceptedAt > boundary.acceptedAt)),
  });
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

  const candidateFactAccessions = new Set(
    relevantFacts.filter(isCandidateConcept).map((fact) => fact.filingAccession),
  );
  const candidates: SecOsFilingContextCandidate[] = [];
  const rejected: SecOsUnavailableObservation[] = [];
  const balanceSheetSignals: ValidatedFact[] = [];

  for (const fact of relevantFacts) {
    const validated = validateFact(issuerCik, fact, filingsByIdentity);
    if ("rejected" in validated) {
      rejected.push(validated.rejected);
      continue;
    }
    if (!isCandidateConcept(fact)) {
      balanceSheetSignals.push(validated);
      continue;
    }
    if (isForeignReportForm(fact.form)) {
      candidates.push(filingContextCandidate(validated, "ADS_OR_ORDINARY_SHARES_REQUIRE_FILING_CONTEXT"));
    } else if (isSupportedDomesticForm(fact.form)) {
      candidates.push(filingContextCandidate(validated, "MISSING_COMPANYFACTS_SECURITY_CLASS_CONTEXT"));
    } else {
      rejected.push(unavailableValidated(validated, "FACT_FORM_NOT_SUPPORTED"));
    }
  }

  for (const signal of balanceSheetSignals) {
    if (isForeignReportForm(signal.fact.form)) {
      candidates.push(filingContextCandidate(signal, "ADS_OR_ORDINARY_SHARES_REQUIRE_FILING_CONTEXT"));
      continue;
    }
    if (!isSupportedDomesticForm(signal.fact.form)) {
      rejected.push(unavailableValidated(signal, "BALANCE_SHEET_CONCEPT_NOT_CANDIDATE"));
      continue;
    }
    const sameDateDei = candidates.some((candidate) =>
      candidate.taxonomy === "dei"
      && candidate.accession === signal.fact.filingAccession
      && candidate.asOf === signal.fact.instantDate
    );
    if (sameDateDei) {
      candidates.push(filingContextCandidate(signal, "SAME_DATE_CONFLICT_REQUIRES_FILING_CONTEXT"));
    } else if (!candidateFactAccessions.has(signal.fact.filingAccession)) {
      candidates.push(filingContextCandidate(signal, "MISSING_COMPANYFACTS_SECURITY_CLASS_CONTEXT"));
    } else {
      rejected.push(unavailableValidated(signal, "BALANCE_SHEET_CONCEPT_NOT_CANDIDATE"));
    }
  }

  const conflictDates = conflictingDates(candidates);
  const conflictMarked = candidates.map((candidate) => conflictDates.has(dateIdentity(candidate.issuerCik, candidate.asOf))
    ? { ...candidate, rejectionReason: "SAME_DATE_CONFLICT_REQUIRES_FILING_CONTEXT" as const }
    : candidate);
  return result(issuerCik, dedupeCandidates(conflictMarked), rejected);
}

type ValidatedFact = { fact: SecCompanyFactRow; filing: SecFilingRow };

function validateFact(
  issuerCik: string,
  fact: SecCompanyFactRow,
  filingsByIdentity: ReadonlyMap<string, SecFilingRow[]>,
): ValidatedFact | { rejected: SecOsUnavailableObservation } {
  const base = observationBase(issuerCik, fact, null);
  if (!validCik(issuerCik) || fact.issuerCik !== issuerCik) {
    return { rejected: unavailable(base, "FACT_CIK_MISMATCH") };
  }
  if (!ACCESSION_PATTERN.test(fact.filingAccession)) {
    return { rejected: unavailable(base, "FACT_ACCESSION_INVALID") };
  }
  if (
    fact.sourceKind !== "companyfacts" || fact.contextKind !== "companyfacts_implicit"
    || !HEX_64_PATTERN.test(fact.sourceFactKey) || !fact.sourceFactPath.trim()
    || !UUID_PATTERN.test(fact.sourceRawId)
  ) {
    return { rejected: unavailable(base, "FACT_LINEAGE_INVALID") };
  }
  if (fact.unit !== "shares") return { rejected: unavailable(base, "FACT_UNIT_NOT_SHARES") };
  if (
    fact.valueKind !== "numeric" || !fact.valueNumeric
    || !POSITIVE_INTEGER_PATTERN.test(fact.valueNumeric) || fact.valueText !== null
  ) {
    return { rejected: unavailable(base, "FACT_VALUE_NOT_POSITIVE_INTEGER") };
  }
  if (!fact.instantDate || !validDate(fact.instantDate) || fact.startDate !== null || fact.endDate !== null) {
    return { rejected: unavailable(base, "FACT_PERIOD_NOT_INSTANT") };
  }
  if (!validDate(fact.filedDate)) return { rejected: unavailable(base, "FACT_LINEAGE_INVALID") };

  const identity = filingIdentity(fact.filingAccession, fact.issuerCik, fact.form, fact.filedDate);
  const filingRows = filingsByIdentity.get(identity) ?? [];
  if (filingRows.length !== 1) {
    return { rejected: unavailable(base, "FILING_LEDGER_IDENTITY_MISSING") };
  }
  const filing = filingRows[0]!;
  const withFiling = observationBase(issuerCik, fact, filing);
  if (
    filing.sourceKind !== "submissions" || !UUID_PATTERN.test(filing.sourceRawId)
    || filing.issuerCik !== issuerCik || filing.accessionNumber !== fact.filingAccession
    || filing.form !== fact.form || filing.filedDate !== fact.filedDate
  ) {
    return { rejected: unavailable(withFiling, "FILING_LEDGER_LINEAGE_INVALID") };
  }
  if (!filing.acceptedAt || !validTimestamp(filing.acceptedAt)) {
    return { rejected: unavailable(withFiling, "FILING_LEDGER_ACCEPTED_AT_MISSING") };
  }
  return { fact, filing };
}

function filingContextCandidate(
  validated: ValidatedFact,
  rejectionReason: SecOsFilingContextCandidate["rejectionReason"],
): SecOsFilingContextCandidate {
  const { fact, filing } = validated;
  return {
    ...observationBase(fact.issuerCik, fact, filing),
    sharesOutstanding: fact.valueNumeric!,
    asOf: fact.instantDate!,
    accession: fact.filingAccession,
    form: fact.form,
    filedDate: fact.filedDate,
    acceptedAt: filing.acceptedAt!,
    taxonomy: fact.taxonomy as "dei" | "us-gaap",
    concept: fact.concept as "EntityCommonStockSharesOutstanding" | "CommonStockSharesOutstanding",
    unit: "shares",
    sourceKind: "companyfacts",
    contextKind: "companyfacts_implicit",
    filingLedgerRawSourceId: filing.sourceRawId,
    extractionStatus: "REQUIRES_FILING_CONTEXT",
    rejectionReason,
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

function unavailable(
  base: SecOsObservationBase,
  rejectionReason: SecOsUnavailableObservation["rejectionReason"],
): SecOsUnavailableObservation {
  return { ...base, extractionStatus: "UNAVAILABLE", rejectionReason };
}

function unavailableValidated(
  validated: ValidatedFact,
  rejectionReason: SecOsUnavailableObservation["rejectionReason"],
) {
  return unavailable(observationBase(validated.fact.issuerCik, validated.fact, validated.filing), rejectionReason);
}

function syntheticUnavailable(
  issuerCik: string,
  reason: SecOsUnavailableObservation["rejectionReason"],
) {
  return unavailable(observationBase(issuerCik, null, null), reason);
}

function dedupeCandidates(candidates: readonly SecOsFilingContextCandidate[]) {
  const byIdentity = new Map<string, SecOsFilingContextCandidate>();
  for (const candidate of [...candidates].sort(compareObservations)) {
    const key = canonicalObservationIdentity(candidate);
    const current = byIdentity.get(key);
    byIdentity.set(key, current ? {
      ...current,
      sourceFacts: uniqueSourceFacts([...current.sourceFacts, ...candidate.sourceFacts]),
    } : candidate);
  }
  return [...byIdentity.values()].sort(compareObservations);
}

function conflictingDates(candidates: readonly SecOsFilingContextCandidate[]) {
  const semanticsByDate = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    const key = dateIdentity(candidate.issuerCik, candidate.asOf);
    const semantics = semanticsByDate.get(key) ?? new Set<string>();
    semantics.add(`${candidate.taxonomy}:${candidate.concept}:${candidate.sharesOutstanding}`);
    semanticsByDate.set(key, semantics);
  }
  return new Set([...semanticsByDate].filter(([, semantics]) => semantics.size > 1).map(([key]) => key));
}

function result(
  issuerCik: string,
  candidates: readonly SecOsFilingContextCandidate[],
  rejected: readonly SecOsUnavailableObservation[],
): SecOsExtractionResult {
  const sortedCandidates = [...candidates].sort(compareObservations);
  const sortedRejected = [...rejected].sort(compareObservations);
  return {
    issuerCik,
    extractionStatus: sortedCandidates.length > 0 ? "REQUIRES_FILING_CONTEXT" : "UNAVAILABLE",
    candidates: sortedCandidates,
    rejected: sortedRejected,
  };
}

function compareObservations(left: SecOsObservation, right: SecOsObservation) {
  return chronologyKey(left).localeCompare(chronologyKey(right));
}

function chronologyKey(row: SecOsObservation) {
  return [
    row.acceptedAt ?? "", row.filedDate ?? "", row.asOf ?? "", row.accession ?? "",
    row.taxonomy ?? "", row.concept ?? "", row.sharesOutstanding ?? "",
    row.extractionStatus, row.rejectionReason,
    row.sourceFacts.map(sourceFactIdentity).sort().join(","),
  ].join("|");
}

function canonicalObservationIdentity(candidate: SecOsFilingContextCandidate) {
  return [
    candidate.issuerCik, candidate.sharesOutstanding, candidate.asOf, candidate.accession,
    candidate.form, candidate.filedDate, candidate.acceptedAt, candidate.taxonomy,
    candidate.concept, candidate.unit, candidate.filingLedgerRawSourceId,
    candidate.extractionStatus, candidate.rejectionReason,
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
function isSupportedDomesticForm(form: string): form is SecOsSupportedDomesticForm {
  return (SEC_OS_SUPPORTED_DOMESTIC_FORMS as readonly string[]).includes(form);
}
function isForeignReportForm(form: string): form is SecOsSupportedForeignForm {
  return (SEC_OS_SUPPORTED_FOREIGN_FORMS as readonly string[]).includes(form);
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
  return TIMESTAMP_PATTERN.test(value) && !Number.isNaN(new Date(value).valueOf());
}

const CIK_PATTERN = /^[0-9]{10}$/;
const ACCESSION_PATTERN = /^[0-9]{10}-[0-9]{2}-[0-9]{6}$/;
const HEX_64_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;
const DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const TIMESTAMP_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$/;
