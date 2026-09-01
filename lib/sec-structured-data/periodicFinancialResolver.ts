import type {
  SecFilingXbrlDocumentSetResult,
  SecFilingXbrlFact,
  SecFilingXbrlFactRejection,
  SecXbrlPeriod,
} from "./filingXbrlContext.ts";
import type { SecCompanyFactRow, SecFilingRow } from "./types.ts";

export const SEC_PERIODIC_FINANCIAL_DECISION_VERSION =
  "periodic-financial-resolver-v1" as const;

export const SEC_PERIODIC_FINANCIAL_METRICS = [
  "REVENUE",
  "OPERATING_INCOME_LOSS",
  "NET_INCOME_LOSS",
  "OPERATING_CASH_FLOW",
  "CASH",
] as const;
export type SecPeriodicFinancialMetric =
  (typeof SEC_PERIODIC_FINANCIAL_METRICS)[number];

export type SecPeriodicFinancialBasis =
  | "QUARTER"
  | "QUARTER_AND_YEAR_TO_DATE"
  | "YEAR_TO_DATE"
  | "ANNUAL"
  | "INSTANT";

export const SEC_PERIODIC_FINANCIAL_REASONS = [
  "RESOLVED_EXACT_SOURCE_PAIR",
  "RESOLVED_CURRENT_WITHOUT_PRIOR_YEAR_COMPARABLE",
  "TARGET_FILING_NOT_FOUND",
  "TARGET_FILING_IDENTITY_INVALID",
  "UNSUPPORTED_PERIODIC_FORM",
  "AMENDMENT_LINEAGE_MISSING",
  "AMENDMENT_CURRENTNESS_REQUIRES_REVIEW",
  "INVALID_REVIEWED_FILING_SELECTION",
  "TARGET_SUPERSEDED_BY_REVIEWED_AMENDMENT",
  "DUPLICATE_FILING_REQUIRES_REVIEW",
  "FILING_CURRENTNESS_AMBIGUOUS",
  "FILING_XBRL_UNAVAILABLE",
  "FILING_XBRL_ACCESSION_MISMATCH",
  "FILING_FACT_SOURCE_MISMATCH",
  "RELEVANT_XBRL_FACT_REJECTED",
  "STANDARD_OR_REVIEWED_CONCEPT_NOT_FOUND",
  "ISSUER_EXTENSION_MAPPING_REQUIRED",
  "INVALID_REVIEWED_MAPPING",
  "FILING_FACT_CIK_MISMATCH",
  "FILING_FACT_NIL_OR_NON_NUMERIC",
  "FILING_FACT_VALUE_UNSUPPORTED",
  "FILING_FACT_UNIT_NOT_ISO_CURRENCY",
  "DIMENSIONAL_FACT_REJECTED",
  "COMPANYFACTS_LINK_NOT_FOUND",
  "COMPANYFACTS_CONFLICT",
  "COMPANYFACTS_METADATA_CONFLICT",
  "FILING_FACT_MATERIAL_CONFLICT",
  "MULTIPLE_METRIC_CONCEPTS",
  "PERIOD_BASIS_AMBIGUOUS",
  "CURRENT_PERIOD_NOT_FOUND",
  "PRIOR_YEAR_COMPARABLE_NOT_FOUND",
  "PRIOR_YEAR_COMPARABLE_CONFLICT",
  "LIKE_FOR_LIKE_MISMATCH",
] as const;
export type SecPeriodicFinancialReason =
  (typeof SEC_PERIODIC_FINANCIAL_REASONS)[number];

export type SecReviewedFinancialConceptMapping = {
  mappingVersion: "periodic-financial-reviewed-concept-v1";
  reviewId: string;
  reviewedAt: string;
  issuerCik: string;
  metric: SecPeriodicFinancialMetric;
  namespaceUri: string;
  taxonomy: string;
  concept: string;
  equivalentTo: `${"us-gaap" | "ifrs-full"}:${string}`;
};

export type SecReviewedFinancialFilingSelection = {
  selectionVersion: "periodic-financial-reviewed-filing-selection-v1";
  reviewId: string;
  reviewedAt: string;
  issuerCik: string;
  baseForm: "10-Q" | "10-K" | "20-F" | "40-F";
  reportDate: string;
  selectedAccession: string;
  supersededAccessions: string[];
};

export type SecPeriodicFinancialEvidence = {
  metric: SecPeriodicFinancialMetric;
  basis: SecPeriodicFinancialBasis;
  period: SecXbrlPeriod;
  financialScope: "UNDIMENSIONED";
  currency: string;
  taxonomy: string;
  concept: string;
  conceptNamespaceUri: string;
  normalizedValue: string;
  filingLexicalValues: string[];
  filingFacts: SecFilingXbrlFact[];
  companyFacts: SecCompanyFactRow[];
  reviewedMapping: SecReviewedFinancialConceptMapping | null;
  accession: string;
  form: string;
  filedDate: string;
  reportDate: string;
};

export type SecPeriodicFinancialObservation = {
  status: "RESOLVED";
  reason:
    | "RESOLVED_EXACT_SOURCE_PAIR"
    | "RESOLVED_CURRENT_WITHOUT_PRIOR_YEAR_COMPARABLE";
  metric: SecPeriodicFinancialMetric;
  basis: SecPeriodicFinancialBasis;
  current: SecPeriodicFinancialEvidence;
  priorYear: SecPeriodicFinancialEvidence | null;
  priorYearStatus:
    | { status: "RESOLVED"; reason: "RESOLVED_EXACT_SOURCE_PAIR" }
    | { status: "UNAVAILABLE"; reason: "PRIOR_YEAR_COMPARABLE_NOT_FOUND" };
  rejectedDimensionalFactKeys: string[];
};

export type SecPeriodicFinancialFailure = {
  status: "UNAVAILABLE" | "AMBIGUOUS";
  reason: SecPeriodicFinancialReason;
  metric: SecPeriodicFinancialMetric;
  basis: SecPeriodicFinancialBasis | null;
  detail: string;
  rejectedDimensionalFactKeys: string[];
};

export type SecPeriodicFinancialMetricDecision =
  | SecPeriodicFinancialObservation
  | SecPeriodicFinancialFailure;

export type SecPeriodicFinancialCurrentness = {
  status: "CURRENT" | "UNAVAILABLE" | "AMBIGUOUS";
  reason: SecPeriodicFinancialReason | "EXPLICIT_ACCESSION_IS_CURRENT" | "REVIEWED_AMENDMENT_SELECTION";
  selectedAccession: string;
  relatedAccessions: string[];
  originalAccession: string | null;
  amendmentAccessions: string[];
};

export type SecPeriodicFinancialResolution = {
  decisionVersion: typeof SEC_PERIODIC_FINANCIAL_DECISION_VERSION;
  issuerCik: string;
  targetAccession: string;
  filing: SecFilingRow | null;
  currentness: SecPeriodicFinancialCurrentness;
  decisions: SecPeriodicFinancialMetricDecision[];
  gptDependency: false;
};

type StandardConcept = {
  metric: SecPeriodicFinancialMetric;
  taxonomy: "us-gaap" | "ifrs-full";
  concept: string;
  namespace: RegExp;
};

const US_GAAP_NAMESPACE = /^https?:\/\/fasb\.org\/us-gaap\/\d{4}$/i;
const IFRS_NAMESPACE = /^https?:\/\/xbrl\.ifrs\.org\/taxonomy\/[^/]+\/ifrs-full$/i;
const ISO_4217_NAMESPACE = /^https?:\/\/www\.xbrl\.org\/2003\/iso4217\/?$/i;
const CIK_PATTERN = /^\d{10}$/;
const ACCESSION_PATTERN = /^\d{10}-\d{2}-\d{6}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const REVIEW_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;

const STANDARD_CONCEPTS: readonly StandardConcept[] = [
  { metric: "REVENUE", taxonomy: "us-gaap", concept: "RevenueFromContractWithCustomerExcludingAssessedTax", namespace: US_GAAP_NAMESPACE },
  { metric: "REVENUE", taxonomy: "us-gaap", concept: "Revenues", namespace: US_GAAP_NAMESPACE },
  { metric: "REVENUE", taxonomy: "us-gaap", concept: "SalesRevenueNet", namespace: US_GAAP_NAMESPACE },
  { metric: "REVENUE", taxonomy: "ifrs-full", concept: "Revenue", namespace: IFRS_NAMESPACE },
  { metric: "OPERATING_INCOME_LOSS", taxonomy: "us-gaap", concept: "OperatingIncomeLoss", namespace: US_GAAP_NAMESPACE },
  { metric: "OPERATING_INCOME_LOSS", taxonomy: "ifrs-full", concept: "ProfitLossFromOperatingActivities", namespace: IFRS_NAMESPACE },
  { metric: "NET_INCOME_LOSS", taxonomy: "us-gaap", concept: "NetIncomeLoss", namespace: US_GAAP_NAMESPACE },
  { metric: "NET_INCOME_LOSS", taxonomy: "ifrs-full", concept: "ProfitLoss", namespace: IFRS_NAMESPACE },
  { metric: "OPERATING_CASH_FLOW", taxonomy: "us-gaap", concept: "NetCashProvidedByUsedInOperatingActivities", namespace: US_GAAP_NAMESPACE },
  { metric: "OPERATING_CASH_FLOW", taxonomy: "ifrs-full", concept: "CashFlowsFromUsedInOperatingActivities", namespace: IFRS_NAMESPACE },
  { metric: "CASH", taxonomy: "us-gaap", concept: "CashAndCashEquivalentsAtCarryingValue", namespace: US_GAAP_NAMESPACE },
  { metric: "CASH", taxonomy: "ifrs-full", concept: "CashAndCashEquivalents", namespace: IFRS_NAMESPACE },
] as const;

type LinkedCandidate = {
  metric: SecPeriodicFinancialMetric;
  taxonomy: string;
  concept: string;
  namespaceUri: string;
  currency: string;
  normalizedValue: string;
  period: SecXbrlPeriod;
  basis: SecPeriodicFinancialBasis;
  filingFacts: SecFilingXbrlFact[];
  companyFacts: SecCompanyFactRow[];
  reviewedMapping: SecReviewedFinancialConceptMapping | null;
};

type CandidateFailure = {
  reason: SecPeriodicFinancialReason;
  detail: string;
  basis: SecPeriodicFinancialBasis | null;
};

export function resolvePeriodicFinancials(input: {
  issuerCik: string;
  targetAccession: string;
  filings: readonly SecFilingRow[];
  companyFacts: readonly SecCompanyFactRow[];
  filingXbrl: SecFilingXbrlDocumentSetResult;
  reviewedMappings?: readonly SecReviewedFinancialConceptMapping[];
  reviewedFilingSelection?: SecReviewedFinancialFilingSelection | null;
}): SecPeriodicFinancialResolution {
  const filing = input.filings.find((row) => row.accessionNumber === input.targetAccession) ?? null;
  const identityFailure = validateTargetIdentity(input.issuerCik, input.targetAccession, filing);
  if (identityFailure) return unavailableResolution(input, filing, identityFailure);
  const selected = filing!;
  const currentness = resolveCurrentness(selected, input.filings, input.reviewedFilingSelection ?? null);
  if (currentness.status !== "CURRENT") {
    return unavailableResolution(input, selected, {
      reason: currentness.reason as SecPeriodicFinancialReason,
      detail: "target accession is not proven current within its exact form/report-period filing family",
    }, currentness);
  }
  const baseForm = normalizeBaseForm(selected.form);
  if (!isSupportedBaseForm(baseForm)) {
    return unavailableResolution(input, selected, {
      reason: "UNSUPPORTED_PERIODIC_FORM",
      detail: `form ${selected.form} is outside 10-Q/10-K/20-F/40-F V1`,
    }, currentness);
  }
  if (!selected.reportDate || !DATE_PATTERN.test(selected.reportDate)) {
    return unavailableResolution(input, selected, {
      reason: "TARGET_FILING_IDENTITY_INVALID",
      detail: "filing ledger report date is required for deterministic period selection",
    }, currentness);
  }
  if (input.filingXbrl.status === "UNAVAILABLE") {
    return unavailableResolution(input, selected, {
      reason: "FILING_XBRL_UNAVAILABLE",
      detail: `${input.filingXbrl.reason}: ${input.filingXbrl.detail}`,
    }, currentness);
  }
  if (input.filingXbrl.sources.some((source) =>
    source.issuerCik !== input.issuerCik || source.accession !== input.targetAccession
  )) {
    return unavailableResolution(input, selected, {
      reason: "FILING_XBRL_ACCESSION_MISMATCH",
      detail: "filing XBRL sources do not all match the explicit issuer/accession",
    }, currentness);
  }

  const mappings = validateReviewedMappings(input.reviewedMappings ?? [], input.issuerCik);
  const decisions: SecPeriodicFinancialMetricDecision[] = [];
  for (const metric of SEC_PERIODIC_FINANCIAL_METRICS) {
    const mappingFailure = mappings.failures.find((failure) => failure.metric === metric);
    if (mappingFailure) {
      decisions.push(failure(metric, null, "UNAVAILABLE", "INVALID_REVIEWED_MAPPING", mappingFailure.detail, []));
      continue;
    }
    decisions.push(...resolveMetric({
      metric,
      filing: selected,
      companyFacts: input.companyFacts,
      filingFacts: input.filingXbrl.facts,
      filingSources: input.filingXbrl.sources,
      rejections: input.filingXbrl.rejections,
      reviewedMappings: mappings.valid.filter((mapping) => mapping.metric === metric),
    }));
  }
  return {
    decisionVersion: SEC_PERIODIC_FINANCIAL_DECISION_VERSION,
    issuerCik: input.issuerCik,
    targetAccession: input.targetAccession,
    filing: selected,
    currentness,
    decisions: decisions.sort(compareDecisions),
    gptDependency: false,
  };
}

function resolveMetric(input: {
  metric: SecPeriodicFinancialMetric;
  filing: SecFilingRow;
  companyFacts: readonly SecCompanyFactRow[];
  filingFacts: readonly SecFilingXbrlFact[];
  filingSources: readonly SecFilingXbrlFact["source"][];
  rejections: readonly SecFilingXbrlFactRejection[];
  reviewedMappings: readonly SecReviewedFinancialConceptMapping[];
}): SecPeriodicFinancialMetricDecision[] {
  const mapped = input.filingFacts.flatMap((fact) => {
    const standard = standardConceptForFact(input.metric, fact);
    const reviewed = input.reviewedMappings.find((mapping) =>
      mapping.namespaceUri === fact.concept.namespaceUri && mapping.concept === fact.concept.localName
    ) ?? null;
    return standard || reviewed ? [{ fact, standard, reviewed }] : [];
  });
  const relevantConceptNames = new Set([
    ...STANDARD_CONCEPTS.filter((row) => row.metric === input.metric).map((row) => row.concept),
    ...input.reviewedMappings.map((row) => row.concept),
  ]);
  const relevantRejection = input.rejections.find((row) =>
    row.concept && relevantConceptNames.has(row.concept.localName)
  );
  if (relevantRejection) {
    return [failure(input.metric, null, "UNAVAILABLE", "RELEVANT_XBRL_FACT_REJECTED", relevantRejection.detail, [])];
  }
  if (mapped.length === 0) {
    const extensionLike = input.filingFacts.some((fact) =>
      fact.concept.namespaceUri && !US_GAAP_NAMESPACE.test(fact.concept.namespaceUri)
      && !IFRS_NAMESPACE.test(fact.concept.namespaceUri)
      && extensionNameLooksRelevant(input.metric, fact.concept.localName)
    );
    return [failure(
      input.metric,
      null,
      "UNAVAILABLE",
      extensionLike ? "ISSUER_EXTENSION_MAPPING_REQUIRED" : "STANDARD_OR_REVIEWED_CONCEPT_NOT_FOUND",
      extensionLike
        ? "a plausible issuer-extension fact exists but no exact reviewed equivalence mapping authorizes it"
        : "no supported standard or explicitly reviewed concept exists in the filing XBRL set",
      [],
    )];
  }

  const dimensionalKeys = mapped
    .filter(({ fact }) => fact.context.dimensions.length > 0)
    .map(({ fact }) => fact.factKey)
    .sort();
  const undimensioned = mapped.filter(({ fact }) => fact.context.dimensions.length === 0);
  if (undimensioned.length === 0) {
    return [failure(input.metric, null, "UNAVAILABLE", "DIMENSIONAL_FACT_REJECTED", "V1 does not select or aggregate dimensional facts", dimensionalKeys)];
  }

  const linked = linkCandidates({ ...input, mapped: undimensioned });
  if (linked.failures.length > 0) {
    const first = linked.failures.sort(compareCandidateFailures)[0]!;
    return [failure(
      input.metric,
      first.basis,
      isAmbiguousReason(first.reason) ? "AMBIGUOUS" : "UNAVAILABLE",
      first.reason,
      first.detail,
      dimensionalKeys,
    )];
  }
  const reportDate = input.filing.reportDate!;
  const current = linked.candidates.filter((candidate) => isCurrentPeriod(candidate, reportDate));
  if (current.length === 0) {
    return [failure(input.metric, null, "UNAVAILABLE", "CURRENT_PERIOD_NOT_FOUND", "no exact linked fact matches the filing report date and a supported period basis", dimensionalKeys)];
  }

  const decisions: SecPeriodicFinancialMetricDecision[] = [];
  for (const [basis, basisCandidates] of groupBy(current, (candidate) => candidate.basis)) {
    const concepts = new Set(basisCandidates.map(conceptIdentity));
    if (concepts.size > 1) {
      decisions.push(failure(input.metric, basis, "AMBIGUOUS", "MULTIPLE_METRIC_CONCEPTS", "multiple mapped concepts compete for the same metric/basis", dimensionalKeys));
      continue;
    }
    const values = new Set(basisCandidates.map((candidate) => candidate.normalizedValue));
    if (values.size > 1) {
      decisions.push(failure(input.metric, basis, "AMBIGUOUS", "FILING_FACT_MATERIAL_CONFLICT", "same concept/unit/period has materially conflicting filing values", dimensionalKeys));
      continue;
    }
    const selected = mergeCandidates(basisCandidates);
    const priorMatches = linked.candidates.filter((candidate) => isLikeForLikePrior(selected, candidate));
    const priorValues = new Set(priorMatches.map((candidate) => candidate.normalizedValue));
    if (priorValues.size > 1) {
      decisions.push(failure(input.metric, basis, "AMBIGUOUS", "PRIOR_YEAR_COMPARABLE_CONFLICT", "multiple prior-year values satisfy the exact like-for-like identity", dimensionalKeys));
      continue;
    }
    const prior = priorMatches.length > 0 ? mergeCandidates(priorMatches) : null;
    const currentEvidence = evidence(input.filing, selected);
    const priorEvidence = prior ? evidence(input.filing, prior) : null;
    decisions.push({
      status: "RESOLVED",
      reason: prior ? "RESOLVED_EXACT_SOURCE_PAIR" : "RESOLVED_CURRENT_WITHOUT_PRIOR_YEAR_COMPARABLE",
      metric: input.metric,
      basis,
      current: currentEvidence,
      priorYear: priorEvidence,
      priorYearStatus: prior
        ? { status: "RESOLVED", reason: "RESOLVED_EXACT_SOURCE_PAIR" }
        : { status: "UNAVAILABLE", reason: "PRIOR_YEAR_COMPARABLE_NOT_FOUND" },
      rejectedDimensionalFactKeys: dimensionalKeys,
    });
  }
  return decisions;
}

function linkCandidates(input: {
  metric: SecPeriodicFinancialMetric;
  filing: SecFilingRow;
  companyFacts: readonly SecCompanyFactRow[];
  filingSources: readonly SecFilingXbrlFact["source"][];
  mapped: ReadonlyArray<{
    fact: SecFilingXbrlFact;
    standard: StandardConcept | null;
    reviewed: SecReviewedFinancialConceptMapping | null;
  }>;
}): { candidates: LinkedCandidate[]; failures: CandidateFailure[] } {
  const candidates: LinkedCandidate[] = [];
  const failures: CandidateFailure[] = [];
  for (const mapped of input.mapped) {
    const fact = mapped.fact;
    if (!factSourceMatchesTarget(fact.source, input.filingSources, input.filing)) {
      failures.push({
        reason: "FILING_FACT_SOURCE_MISMATCH",
        detail: `fact ${fact.factKey} source does not exactly match the target filing source set`,
        basis: null,
      });
      continue;
    }
    const basis = classifyBasis(input.metric, input.filing, fact.context.period, input.companyFacts, mapped);
    if (!basis.ok) {
      failures.push({ reason: basis.reason, detail: basis.detail, basis: null });
      continue;
    }
    if (!contextMatchesIssuer(fact, input.filing.issuerCik)) {
      failures.push({ reason: "FILING_FACT_CIK_MISMATCH", detail: `context ${fact.contextRef} does not identify the filing issuer`, basis: basis.basis });
      continue;
    }
    if (fact.isNil || fact.valueText === null) {
      failures.push({ reason: "FILING_FACT_NIL_OR_NON_NUMERIC", detail: `fact ${fact.factKey} is nil or has no lexical value`, basis: basis.basis });
      continue;
    }
    const currency = filingCurrency(fact);
    if (!currency) {
      failures.push({ reason: "FILING_FACT_UNIT_NOT_ISO_CURRENCY", detail: `fact ${fact.factKey} does not resolve to one ISO 4217 measure`, basis: basis.basis });
      continue;
    }
    const normalizedValue = normalizeFilingDecimal(fact);
    if (normalizedValue === null) {
      failures.push({ reason: "FILING_FACT_VALUE_UNSUPPORTED", detail: `fact ${fact.factKey} uses an unsupported numeric transformation`, basis: basis.basis });
      continue;
    }
    const taxonomy = mapped.standard?.taxonomy ?? mapped.reviewed!.taxonomy;
    const sameIdentity = input.companyFacts.filter((row) =>
      row.issuerCik === input.filing.issuerCik
      && row.filingAccession === input.filing.accessionNumber
      && row.form === input.filing.form
      && row.taxonomy === taxonomy
      && row.concept === fact.concept.localName
      && row.unit === currency
      && samePeriod(row, fact.context.period)
      && row.valueKind === "numeric"
    );
    if (sameIdentity.length === 0) {
      failures.push({ reason: "COMPANYFACTS_LINK_NOT_FOUND", detail: `no CompanyFacts row exactly links ${fact.concept.qname}/${fact.contextRef}/${currency}`, basis: basis.basis });
      continue;
    }
    const companyValues = new Set(sameIdentity.map((row) => row.valueNumeric));
    if (companyValues.size > 1) {
      failures.push({ reason: "COMPANYFACTS_CONFLICT", detail: "same CompanyFacts accession/concept/unit/period has conflicting values", basis: basis.basis });
      continue;
    }
    const metadata = new Set(sameIdentity.map((row) => `${row.fiscalYear ?? ""}|${row.fiscalPeriod ?? ""}|${row.frame ?? ""}`));
    if (metadata.size > 1) {
      failures.push({ reason: "COMPANYFACTS_METADATA_CONFLICT", detail: "exact CompanyFacts duplicates disagree on fiscal metadata", basis: basis.basis });
      continue;
    }
    const exact = sameIdentity.filter((row) => row.valueNumeric === normalizedValue);
    if (exact.length === 0) {
      failures.push({ reason: "COMPANYFACTS_CONFLICT", detail: "filing lexical value does not equal the exact CompanyFacts decimal", basis: basis.basis });
      continue;
    }
    candidates.push({
      metric: input.metric,
      taxonomy,
      concept: fact.concept.localName,
      namespaceUri: fact.concept.namespaceUri!,
      currency,
      normalizedValue,
      period: fact.context.period,
      basis: basis.basis,
      filingFacts: [fact],
      companyFacts: exact,
      reviewedMapping: mapped.reviewed,
    });
  }
  return {
    candidates: mergeDuplicateCandidates(candidates),
    failures: failures.filter((item, index) =>
      failures.findIndex((candidate) => candidate.reason === item.reason && candidate.detail === item.detail) === index
    ),
  };
}

function factSourceMatchesTarget(
  source: SecFilingXbrlFact["source"],
  filingSources: readonly SecFilingXbrlFact["source"][],
  filing: SecFilingRow,
) {
  if (source.issuerCik !== filing.issuerCik || source.accession !== filing.accessionNumber) return false;
  return filingSources.some((candidate) =>
    candidate.artifactId === source.artifactId
    && candidate.issuerCik === source.issuerCik
    && candidate.accession === source.accession
    && candidate.documentName === source.documentName
    && candidate.sourceUrl === source.sourceUrl
    && candidate.contentHash === source.contentHash
    && candidate.fetchedAt === source.fetchedAt
    && candidate.rawContentKind === source.rawContentKind
  );
}

function classifyBasis(
  metric: SecPeriodicFinancialMetric,
  filing: SecFilingRow,
  period: SecXbrlPeriod,
  companyFacts: readonly SecCompanyFactRow[],
  mapped: { fact: SecFilingXbrlFact; standard: StandardConcept | null; reviewed: SecReviewedFinancialConceptMapping | null },
): { ok: true; basis: SecPeriodicFinancialBasis } | { ok: false; reason: "PERIOD_BASIS_AMBIGUOUS"; detail: string } {
  if (metric === "CASH") {
    return period.kind === "instant"
      ? { ok: true, basis: "INSTANT" }
      : { ok: false, reason: "PERIOD_BASIS_AMBIGUOUS", detail: "cash must be an instant fact" };
  }
  if (period.kind !== "duration") {
    return { ok: false, reason: "PERIOD_BASIS_AMBIGUOUS", detail: "duration metric was tagged with an instant context" };
  }
  const taxonomy = mapped.standard?.taxonomy ?? mapped.reviewed!.taxonomy;
  const metadataRows = companyFacts.filter((row) =>
    row.filingAccession === filing.accessionNumber && row.taxonomy === taxonomy
    && row.concept === mapped.fact.concept.localName && samePeriod(row, period)
  );
  const fiscalPeriods = new Set(metadataRows.map((row) => row.fiscalPeriod).filter(Boolean));
  const frames = new Set(metadataRows.map((row) => row.frame).filter(Boolean));
  const baseForm = normalizeBaseForm(filing.form);
  if (["10-K", "20-F", "40-F"].includes(baseForm)) {
    if (fiscalPeriods.size !== 1 || !fiscalPeriods.has("FY")) {
      return { ok: false, reason: "PERIOD_BASIS_AMBIGUOUS", detail: "annual form fact lacks one exact FY CompanyFacts identity" };
    }
    const days = inclusiveDays(period.startDate, period.endDate);
    if (days < 330 || days > 400) {
      return { ok: false, reason: "PERIOD_BASIS_AMBIGUOUS", detail: "annual duration falls outside the deterministic 330-400 day boundary" };
    }
    return { ok: true, basis: "ANNUAL" };
  }
  if (baseForm !== "10-Q" || fiscalPeriods.size !== 1) {
    return { ok: false, reason: "PERIOD_BASIS_AMBIGUOUS", detail: "quarterly fact lacks one exact CompanyFacts fiscal-period identity" };
  }
  const fiscalPeriod = [...fiscalPeriods][0]!;
  if (!/^Q[1-4]$/.test(fiscalPeriod)) {
    return { ok: false, reason: "PERIOD_BASIS_AMBIGUOUS", detail: `unsupported quarterly fiscal period ${fiscalPeriod}` };
  }
  const days = inclusiveDays(period.startDate, period.endDate);
  if (days <= 120) {
    if (frames.size !== 1 || !/^CY\d{4}Q[1-4]$/.test([...frames][0]!)) {
      return { ok: false, reason: "PERIOD_BASIS_AMBIGUOUS", detail: "quarter duration lacks one SEC quarter frame" };
    }
    return { ok: true, basis: fiscalPeriod === "Q1" ? "QUARTER_AND_YEAR_TO_DATE" : "QUARTER" };
  }
  if (days <= 320 && frames.size === 0 && fiscalPeriod !== "Q1") {
    return { ok: true, basis: "YEAR_TO_DATE" };
  }
  return { ok: false, reason: "PERIOD_BASIS_AMBIGUOUS", detail: "duration cannot be proven quarter, YTD, or annual without mixing bases" };
}

function standardConceptForFact(metric: SecPeriodicFinancialMetric, fact: SecFilingXbrlFact) {
  return STANDARD_CONCEPTS.find((row) =>
    row.metric === metric && row.concept === fact.concept.localName
    && Boolean(fact.concept.namespaceUri && row.namespace.test(fact.concept.namespaceUri))
  ) ?? null;
}

function validateReviewedMappings(
  mappings: readonly SecReviewedFinancialConceptMapping[],
  issuerCik: string,
) {
  const valid: SecReviewedFinancialConceptMapping[] = [];
  const failures: Array<{ metric: SecPeriodicFinancialMetric; detail: string }> = [];
  for (const mapping of mappings) {
    const equivalent = STANDARD_CONCEPTS.some((row) =>
      `${row.taxonomy}:${row.concept}` === mapping.equivalentTo && row.metric === mapping.metric
    );
    const validMapping = mapping.mappingVersion === "periodic-financial-reviewed-concept-v1"
      && mapping.issuerCik === issuerCik
      && CIK_PATTERN.test(mapping.issuerCik)
      && REVIEW_ID_PATTERN.test(mapping.reviewId)
      && !Number.isNaN(Date.parse(mapping.reviewedAt))
      && Boolean(mapping.namespaceUri && mapping.taxonomy && mapping.concept)
      && !US_GAAP_NAMESPACE.test(mapping.namespaceUri)
      && !IFRS_NAMESPACE.test(mapping.namespaceUri)
      && equivalent;
    if (validMapping) valid.push(mapping);
    else failures.push({ metric: mapping.metric, detail: `reviewed mapping ${mapping.reviewId || "<missing>"} is incomplete, cross-issuer, standard-namespace, or not equivalent to the same V1 metric` });
  }
  return { valid, failures };
}

function resolveCurrentness(
  filing: SecFilingRow,
  filings: readonly SecFilingRow[],
  reviewedSelection: SecReviewedFinancialFilingSelection | null,
): SecPeriodicFinancialCurrentness {
  const baseForm = normalizeBaseForm(filing.form);
  const related = filings.filter((row) =>
    row.issuerCik === filing.issuerCik && normalizeBaseForm(row.form) === baseForm
    && row.reportDate === filing.reportDate
  );
  const originals = related.filter((row) => !isAmendment(row.form));
  const amendments = related.filter((row) => isAmendment(row.form));
  const base = {
    selectedAccession: filing.accessionNumber,
    relatedAccessions: related.map((row) => row.accessionNumber).sort(),
    originalAccession: originals.length === 1 ? originals[0]!.accessionNumber : null,
    amendmentAccessions: amendments.map((row) => row.accessionNumber).sort(),
  };
  if (isAmendment(filing.form) && originals.length !== 1) {
    return { status: "UNAVAILABLE", reason: "AMENDMENT_LINEAGE_MISSING", ...base };
  }
  if (originals.length > 1) {
    return { status: "AMBIGUOUS", reason: "DUPLICATE_FILING_REQUIRES_REVIEW", ...base };
  }
  if (related.length <= 1) {
    return { status: "CURRENT", reason: "EXPLICIT_ACCESSION_IS_CURRENT", ...base };
  }
  if (amendments.length === 0) {
    return { status: "AMBIGUOUS", reason: "DUPLICATE_FILING_REQUIRES_REVIEW", ...base };
  }
  if (!reviewedSelection) {
    return { status: "AMBIGUOUS", reason: "AMENDMENT_CURRENTNESS_REQUIRES_REVIEW", ...base };
  }
  const relatedSet = new Set(related.map((row) => row.accessionNumber));
  const supersededSet = new Set(reviewedSelection.supersededAccessions);
  const expectedSuperseded = related.filter((row) => row.accessionNumber !== reviewedSelection.selectedAccession)
    .map((row) => row.accessionNumber);
  const validSelection = reviewedSelection.selectionVersion === "periodic-financial-reviewed-filing-selection-v1"
    && REVIEW_ID_PATTERN.test(reviewedSelection.reviewId)
    && !Number.isNaN(Date.parse(reviewedSelection.reviewedAt))
    && reviewedSelection.issuerCik === filing.issuerCik
    && reviewedSelection.baseForm === baseForm
    && reviewedSelection.reportDate === filing.reportDate
    && relatedSet.has(reviewedSelection.selectedAccession)
    && reviewedSelection.supersededAccessions.length === supersededSet.size
    && expectedSuperseded.length === supersededSet.size
    && expectedSuperseded.every((accession) => supersededSet.has(accession));
  if (!validSelection) {
    return { status: "UNAVAILABLE", reason: "INVALID_REVIEWED_FILING_SELECTION", ...base };
  }
  if (reviewedSelection.selectedAccession !== filing.accessionNumber) {
    return { status: "UNAVAILABLE", reason: "TARGET_SUPERSEDED_BY_REVIEWED_AMENDMENT", ...base };
  }
  return { status: "CURRENT", reason: "REVIEWED_AMENDMENT_SELECTION", ...base };
}

function validateTargetIdentity(
  issuerCik: string,
  accession: string,
  filing: SecFilingRow | null,
): { reason: SecPeriodicFinancialReason; detail: string } | null {
  if (!filing) return { reason: "TARGET_FILING_NOT_FOUND", detail: "explicit target accession is absent from the filing ledger input" };
  if (!CIK_PATTERN.test(issuerCik) || !ACCESSION_PATTERN.test(accession)
    || filing.issuerCik !== issuerCik || filing.accessionNumber !== accession
    || filing.sourceKind !== "submissions" || !filing.sourceRawId) {
    return { reason: "TARGET_FILING_IDENTITY_INVALID", detail: "target filing does not preserve exact submissions-ledger identity" };
  }
  return null;
}

function unavailableResolution(
  input: { issuerCik: string; targetAccession: string; filings: readonly SecFilingRow[] },
  filing: SecFilingRow | null,
  problem: { reason: SecPeriodicFinancialReason; detail: string },
  currentness?: SecPeriodicFinancialCurrentness,
): SecPeriodicFinancialResolution {
  const fallbackCurrentness: SecPeriodicFinancialCurrentness = currentness ?? {
    status: "UNAVAILABLE",
    reason: problem.reason,
    selectedAccession: input.targetAccession,
    relatedAccessions: [],
    originalAccession: null,
    amendmentAccessions: [],
  };
  return {
    decisionVersion: SEC_PERIODIC_FINANCIAL_DECISION_VERSION,
    issuerCik: input.issuerCik,
    targetAccession: input.targetAccession,
    filing,
    currentness: fallbackCurrentness,
    decisions: SEC_PERIODIC_FINANCIAL_METRICS.map((metric) =>
      failure(metric, null, isAmbiguousReason(problem.reason) ? "AMBIGUOUS" : "UNAVAILABLE", problem.reason, problem.detail, [])
    ),
    gptDependency: false,
  };
}

function failure(
  metric: SecPeriodicFinancialMetric,
  basis: SecPeriodicFinancialBasis | null,
  status: "UNAVAILABLE" | "AMBIGUOUS",
  reason: SecPeriodicFinancialReason,
  detail: string,
  rejectedDimensionalFactKeys: string[],
): SecPeriodicFinancialFailure {
  return { status, reason, metric, basis, detail, rejectedDimensionalFactKeys };
}

function evidence(filing: SecFilingRow, candidate: LinkedCandidate): SecPeriodicFinancialEvidence {
  return {
    metric: candidate.metric,
    basis: candidate.basis,
    period: candidate.period,
    financialScope: "UNDIMENSIONED",
    currency: candidate.currency,
    taxonomy: candidate.taxonomy,
    concept: candidate.concept,
    conceptNamespaceUri: candidate.namespaceUri,
    normalizedValue: candidate.normalizedValue,
    filingLexicalValues: [...new Set(candidate.filingFacts.map((fact) => fact.valueText).filter((value): value is string => value !== null))].sort(),
    filingFacts: [...candidate.filingFacts].sort((left, right) => left.factKey.localeCompare(right.factKey)),
    companyFacts: [...candidate.companyFacts].sort((left, right) => left.sourceFactKey.localeCompare(right.sourceFactKey)),
    reviewedMapping: candidate.reviewedMapping,
    accession: filing.accessionNumber,
    form: filing.form,
    filedDate: filing.filedDate,
    reportDate: filing.reportDate!,
  };
}

function isCurrentPeriod(candidate: LinkedCandidate, reportDate: string) {
  return candidate.period.kind === "instant"
    ? candidate.period.instant === reportDate
    : candidate.period.endDate === reportDate;
}

function isLikeForLikePrior(current: LinkedCandidate, candidate: LinkedCandidate) {
  if (candidate.metric !== current.metric || candidate.basis !== current.basis
    || candidate.taxonomy !== current.taxonomy || candidate.concept !== current.concept
    || candidate.namespaceUri !== current.namespaceUri || candidate.currency !== current.currency
    || Boolean(candidate.reviewedMapping) !== Boolean(current.reviewedMapping)) return false;
  if (current.reviewedMapping && candidate.reviewedMapping?.reviewId !== current.reviewedMapping.reviewId) return false;
  if (current.period.kind !== candidate.period.kind) return false;
  if (current.period.kind === "instant" && candidate.period.kind === "instant") {
    const days = dateDifference(candidate.period.instant, current.period.instant);
    return days >= 350 && days <= 380;
  }
  if (current.period.kind === "duration" && candidate.period.kind === "duration") {
    const endDays = dateDifference(candidate.period.endDate, current.period.endDate);
    const currentDays = inclusiveDays(current.period.startDate, current.period.endDate);
    const candidateDays = inclusiveDays(candidate.period.startDate, candidate.period.endDate);
    return endDays >= 350 && endDays <= 380 && Math.abs(currentDays - candidateDays) <= 7;
  }
  return false;
}

function mergeDuplicateCandidates(candidates: readonly LinkedCandidate[]) {
  const groups = groupBy(candidates, candidateSemanticIdentity);
  return [...groups.values()].map(mergeCandidates);
}

function mergeCandidates(candidates: readonly LinkedCandidate[]): LinkedCandidate {
  const first = candidates[0]!;
  return {
    ...first,
    filingFacts: uniqueBy(candidates.flatMap((candidate) => candidate.filingFacts), (fact) => fact.factKey),
    companyFacts: uniqueBy(candidates.flatMap((candidate) => candidate.companyFacts), (fact) => fact.sourceFactKey),
  };
}

function candidateSemanticIdentity(candidate: LinkedCandidate) {
  return [
    candidate.metric,
    candidate.basis,
    conceptIdentity(candidate),
    candidate.currency,
    periodIdentity(candidate.period),
    candidate.normalizedValue,
    candidate.reviewedMapping?.reviewId ?? "standard",
  ].join("|");
}

function conceptIdentity(candidate: LinkedCandidate) {
  return `${candidate.namespaceUri}|${candidate.taxonomy}|${candidate.concept}`;
}

function periodIdentity(period: SecXbrlPeriod) {
  return period.kind === "instant" ? `I:${period.instant}` : `D:${period.startDate}:${period.endDate}`;
}

function filingCurrency(fact: SecFilingXbrlFact) {
  if (!fact.unit || fact.unit.kind !== "measure") return null;
  const measure = fact.unit.measure;
  return measure.namespaceUri && ISO_4217_NAMESPACE.test(measure.namespaceUri)
    && /^[A-Z]{3}$/.test(measure.localName) ? measure.localName : null;
}

export function normalizeFilingDecimal(fact: Pick<
  SecFilingXbrlFact,
  "valueText" | "inlineFormat" | "scale" | "sign" | "isNil"
>) {
  if (fact.isNil || fact.valueText === null) return null;
  const format = (fact.inlineFormat ?? "").toLowerCase();
  let lexical = decodeNumericEntities(fact.valueText).trim();
  if (format.includes("fixed-zero")) lexical = "0";
  else if (!format || format.includes("num-dot-decimal") || format.includes("numdotdecimal")) {
    lexical = lexical.replace(/[\s,]/g, "");
  } else if (format.includes("num-comma-decimal") || format.includes("numcommadecimal")) {
    lexical = lexical.replace(/[.\s]/g, "").replace(",", ".");
  } else {
    return null;
  }
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(lexical)) return null;
  if (fact.sign && fact.sign !== "+" && fact.sign !== "-") return null;
  if (fact.sign === "-" && !lexical.startsWith("-")) lexical = `-${lexical.replace(/^\+/, "")}`;
  if (fact.sign === "+") lexical = lexical.replace(/^\+/, "");
  const scale = fact.scale === null ? 0 : Number(fact.scale);
  if (!Number.isInteger(scale) || Math.abs(scale) > 100) return null;
  return shiftDecimal(canonicalDecimal(lexical), scale);
}

function shiftDecimal(value: string, scale: number) {
  const negative = value.startsWith("-");
  const unsigned = value.replace(/^[+-]/, "");
  const [whole, fraction = ""] = unsigned.split(".");
  const digits = `${whole}${fraction}`;
  const point = whole.length + scale;
  let shifted: string;
  if (/^0+$/.test(digits)) shifted = "0";
  else if (point <= 0) shifted = `0.${"0".repeat(-point)}${digits}`;
  else if (point >= digits.length) shifted = `${digits}${"0".repeat(point - digits.length)}`;
  else shifted = `${digits.slice(0, point)}.${digits.slice(point)}`;
  return canonicalDecimal(`${negative ? "-" : ""}${shifted}`);
}

function canonicalDecimal(value: string) {
  const negative = value.startsWith("-");
  const unsigned = value.replace(/^[+-]/, "");
  const [wholeValue, fractionValue = ""] = unsigned.split(".");
  const whole = wholeValue.replace(/^0+(?=\d)/, "") || "0";
  const fraction = fractionValue.replace(/0+$/, "");
  const normalized = fraction ? `${whole}.${fraction}` : whole;
  return negative && normalized !== "0" ? `-${normalized}` : normalized;
}

function decodeNumericEntities(value: string) {
  return value
    .replace(/&#(?:8211|8212);|&#x(?:2013|2014);|&(?:ndash|mdash);/gi, "0")
    .replace(/&#160;|&nbsp;/gi, " ");
}

function samePeriod(row: SecCompanyFactRow, period: SecXbrlPeriod) {
  return period.kind === "instant"
    ? row.instantDate === period.instant && row.startDate === null && row.endDate === null
    : row.instantDate === null && row.startDate === period.startDate && row.endDate === period.endDate;
}

function contextMatchesIssuer(fact: SecFilingXbrlFact, cik: string) {
  const digits = fact.context.entityIdentifier.replace(/\D/g, "");
  return digits.padStart(10, "0") === cik;
}

function normalizeBaseForm(form: string) {
  return form.toUpperCase().replace(/\s+/g, "").replace(/\/A$/, "");
}

function isAmendment(form: string) {
  return /\/A$/i.test(form.trim());
}

function isSupportedBaseForm(form: string) {
  return ["10-Q", "10-K", "20-F", "40-F"].includes(form);
}

function extensionNameLooksRelevant(metric: SecPeriodicFinancialMetric, concept: string) {
  const patterns: Record<SecPeriodicFinancialMetric, RegExp> = {
    REVENUE: /revenue|sales/i,
    OPERATING_INCOME_LOSS: /operating.*(?:income|loss|profit)|(?:income|loss|profit).*operating/i,
    NET_INCOME_LOSS: /net.*(?:income|loss)|profit.*loss/i,
    OPERATING_CASH_FLOW: /operating.*cash|cash.*operating/i,
    CASH: /cash.*equivalent/i,
  };
  return patterns[metric].test(concept);
}

function inclusiveDays(start: string, end: string) {
  return dateDifference(start, end) + 1;
}

function dateDifference(start: string, end: string) {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
}

function isAmbiguousReason(reason: SecPeriodicFinancialReason) {
  return [
    "DUPLICATE_FILING_REQUIRES_REVIEW",
    "AMENDMENT_CURRENTNESS_REQUIRES_REVIEW",
    "FILING_CURRENTNESS_AMBIGUOUS",
    "COMPANYFACTS_CONFLICT",
    "COMPANYFACTS_METADATA_CONFLICT",
    "FILING_FACT_MATERIAL_CONFLICT",
    "MULTIPLE_METRIC_CONCEPTS",
    "PERIOD_BASIS_AMBIGUOUS",
    "PRIOR_YEAR_COMPARABLE_CONFLICT",
    "LIKE_FOR_LIKE_MISMATCH",
  ].includes(reason);
}

function compareCandidateFailures(left: CandidateFailure, right: CandidateFailure) {
  return left.reason.localeCompare(right.reason) || left.detail.localeCompare(right.detail);
}

function compareDecisions(left: SecPeriodicFinancialMetricDecision, right: SecPeriodicFinancialMetricDecision) {
  return SEC_PERIODIC_FINANCIAL_METRICS.indexOf(left.metric) - SEC_PERIODIC_FINANCIAL_METRICS.indexOf(right.metric)
    || (left.basis ?? "").localeCompare(right.basis ?? "")
    || left.status.localeCompare(right.status);
}

function groupBy<T, K>(items: readonly T[], key: (item: T) => K) {
  const groups = new Map<K, T[]>();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return groups;
}

function uniqueBy<T>(items: readonly T[], key: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const identity = key(item);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}
