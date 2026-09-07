import type { SecFilingXbrlDocumentSetResult, SecXbrlPeriod } from "./filingXbrlContext.ts";
import {
  SEC_PERIODIC_FINANCIAL_METRICS,
  resolvePeriodicFinancials,
  type SecPeriodicFinancialBasis,
  type SecPeriodicFinancialCurrentness,
  type SecPeriodicFinancialEvidence,
  type SecPeriodicFinancialFailure,
  type SecPeriodicFinancialMetric,
  type SecPeriodicFinancialObservation,
  type SecPeriodicFinancialReason,
  type SecPeriodicFinancialResolution,
  type SecReviewedFinancialConceptMapping,
  type SecReviewedFinancialFilingSelection,
} from "./periodicFinancialResolver.ts";
import type { SecCompanyFactRow, SecFilingRow } from "./types.ts";

export const SEC_PERIODIC_FINANCIAL_HISTORY_VERSION =
  "periodic-financial-history-v1" as const;

export type SecPeriodicFinancialHistoryCategory = "QUARTERLY" | "ANNUAL";

export const SEC_PERIODIC_FINANCIAL_HISTORY_REASONS = [
  "EXACT_COMPATIBLE_CLAIMS",
  "CROSS_ACCESSION_VALUE_CONFLICT",
  "DUPLICATE_ACCESSION_INPUT",
  "YEAR_TO_DATE_IS_NOT_QUARTERLY_HISTORY",
] as const;
export type SecPeriodicFinancialHistoryReason =
  (typeof SEC_PERIODIC_FINANCIAL_HISTORY_REASONS)[number];

export type SecPeriodicFinancialHistoryFilingInput = {
  targetAccession: string;
  filingXbrl: SecFilingXbrlDocumentSetResult;
};

export type SecPeriodicFinancialSeriesIdentity = {
  issuerCik: string;
  category: SecPeriodicFinancialHistoryCategory;
  formFamily: "10-Q" | "10-K" | "20-F" | "40-F";
  metric: SecPeriodicFinancialMetric;
  basis: Exclude<SecPeriodicFinancialBasis, "YEAR_TO_DATE">;
  financialScope: "UNDIMENSIONED";
  unitKind: "ISO_4217_CURRENCY";
  unit: string;
  taxonomy: string;
  concept: string;
  conceptNamespaceUri: string;
  reviewedMapping: SecReviewedFinancialConceptMapping | null;
};

export type SecPeriodicFinancialSeriesClaim = {
  sourceRole: "CURRENT" | "PRIOR_YEAR";
  resolver: {
    decisionVersion: SecPeriodicFinancialResolution["decisionVersion"];
    targetAccession: string;
    filing: SecFilingRow;
    currentness: SecPeriodicFinancialCurrentness;
    observation: SecPeriodicFinancialObservation;
  };
  evidence: SecPeriodicFinancialEvidence;
};

export type SecPeriodicFinancialResolvedSeriesPoint = {
  status: "RESOLVED";
  reason: "EXACT_COMPATIBLE_CLAIMS";
  period: SecXbrlPeriod;
  normalizedValue: string;
  claims: SecPeriodicFinancialSeriesClaim[];
};

export type SecPeriodicFinancialUnavailableSeriesPoint = {
  status: "UNAVAILABLE";
  reason: "CROSS_ACCESSION_VALUE_CONFLICT";
  detail: string;
  period: SecXbrlPeriod;
  conflictingValues: string[];
  claims: SecPeriodicFinancialSeriesClaim[];
};

export type SecPeriodicFinancialSeriesPoint =
  | SecPeriodicFinancialResolvedSeriesPoint
  | SecPeriodicFinancialUnavailableSeriesPoint;

export type SecPeriodicFinancialSeries = {
  identity: SecPeriodicFinancialSeriesIdentity;
  points: SecPeriodicFinancialSeriesPoint[];
};

export type SecPeriodicFinancialHistoryUnavailable = {
  status: "UNAVAILABLE" | "AMBIGUOUS";
  reason: SecPeriodicFinancialReason | "DUPLICATE_ACCESSION_INPUT";
  detail: string;
  issuerCik: string;
  targetAccession: string;
  category: SecPeriodicFinancialHistoryCategory | null;
  formFamily: "10-Q" | "10-K" | "20-F" | "40-F" | null;
  reportDate: string | null;
  metric: SecPeriodicFinancialMetric;
  basis: SecPeriodicFinancialBasis | null;
  resolverFailure: SecPeriodicFinancialFailure | null;
};

export type SecPeriodicFinancialNonSeriesDecision = {
  reason: "YEAR_TO_DATE_IS_NOT_QUARTERLY_HISTORY";
  detail: string;
  issuerCik: string;
  targetAccession: string;
  category: "QUARTERLY";
  formFamily: "10-Q";
  reportDate: string;
  observation: SecPeriodicFinancialObservation;
};

export type SecPeriodicFinancialHistoryResolution = {
  decisionVersion: typeof SEC_PERIODIC_FINANCIAL_HISTORY_VERSION;
  issuerCik: string;
  quarterly: SecPeriodicFinancialSeries[];
  annual: SecPeriodicFinancialSeries[];
  unavailable: SecPeriodicFinancialHistoryUnavailable[];
  nonSeriesDecisions: SecPeriodicFinancialNonSeriesDecision[];
  filingResolutions: SecPeriodicFinancialResolution[];
  gptDependency: false;
};

type SeriesAccumulator = {
  identity: SecPeriodicFinancialSeriesIdentity;
  claims: SecPeriodicFinancialSeriesClaim[];
};

type FilingClassification = {
  category: SecPeriodicFinancialHistoryCategory;
  formFamily: "10-Q" | "10-K" | "20-F" | "40-F";
};

const CATEGORY_ORDER: Record<SecPeriodicFinancialHistoryCategory, number> = {
  QUARTERLY: 0,
  ANNUAL: 1,
};

const BASIS_ORDER: Record<Exclude<SecPeriodicFinancialBasis, "YEAR_TO_DATE">, number> = {
  QUARTER: 0,
  QUARTER_AND_YEAR_TO_DATE: 1,
  ANNUAL: 2,
  INSTANT: 3,
};

export function resolvePeriodicFinancialHistory(input: {
  issuerCik: string;
  filings: readonly SecFilingRow[];
  companyFacts: readonly SecCompanyFactRow[];
  filingInputs: readonly SecPeriodicFinancialHistoryFilingInput[];
  reviewedMappings?: readonly SecReviewedFinancialConceptMapping[];
  reviewedFilingSelections?: readonly SecReviewedFinancialFilingSelection[];
}): SecPeriodicFinancialHistoryResolution {
  const filingInputGroups = groupBy(input.filingInputs, (row) => row.targetAccession);
  const filingResolutions: SecPeriodicFinancialResolution[] = [];
  const unavailable: SecPeriodicFinancialHistoryUnavailable[] = [];
  const nonSeriesDecisions: SecPeriodicFinancialNonSeriesDecision[] = [];
  const accumulators = new Map<string, SeriesAccumulator>();

  for (const targetAccession of [...filingInputGroups.keys()].sort()) {
    const filingInputs = filingInputGroups.get(targetAccession)!;
    const filing = input.filings.find((row) => row.accessionNumber === targetAccession) ?? null;
    const classification = filing ? classifyFiling(filing.form) : null;
    if (filingInputs.length !== 1) {
      for (const metric of SEC_PERIODIC_FINANCIAL_METRICS) {
        unavailable.push({
          status: "UNAVAILABLE",
          reason: "DUPLICATE_ACCESSION_INPUT",
          detail: "one target accession was supplied more than once; history does not choose between filing-XBRL inputs",
          issuerCik: input.issuerCik,
          targetAccession,
          category: classification?.category ?? null,
          formFamily: classification?.formFamily ?? null,
          reportDate: filing?.reportDate ?? null,
          metric,
          basis: null,
          resolverFailure: null,
        });
      }
      continue;
    }

    const reviewedFilingSelection = filing
      ? selectReviewedFilingSelection(filing, input.reviewedFilingSelections ?? [])
      : null;
    const resolution = resolvePeriodicFinancials({
      issuerCik: input.issuerCik,
      targetAccession,
      filings: input.filings,
      companyFacts: input.companyFacts,
      filingXbrl: filingInputs[0]!.filingXbrl,
      reviewedMappings: input.reviewedMappings,
      reviewedFilingSelection,
    });
    filingResolutions.push(resolution);

    const resolvedFiling = resolution.filing;
    const resolvedClassification = resolvedFiling ? classifyFiling(resolvedFiling.form) : null;
    for (const decision of resolution.decisions) {
      if (decision.status !== "RESOLVED" || !resolvedFiling || !resolvedClassification) {
        const resolverFailure = decision.status === "RESOLVED" ? null : decision;
        unavailable.push({
          status: resolverFailure?.status ?? "UNAVAILABLE",
          reason: resolverFailure?.reason ?? "UNSUPPORTED_PERIODIC_FORM",
          detail: resolverFailure?.detail ?? "resolved evidence has no supported quarterly or annual filing family",
          issuerCik: input.issuerCik,
          targetAccession,
          category: resolvedClassification?.category ?? null,
          formFamily: resolvedClassification?.formFamily ?? null,
          reportDate: resolvedFiling?.reportDate ?? null,
          metric: decision.metric,
          basis: decision.basis,
          resolverFailure,
        });
        continue;
      }

      if (decision.basis === "YEAR_TO_DATE") {
        nonSeriesDecisions.push({
          reason: "YEAR_TO_DATE_IS_NOT_QUARTERLY_HISTORY",
          detail: "the exact YTD observation is preserved but cannot enter a quarterly or annual series",
          issuerCik: input.issuerCik,
          targetAccession,
          category: "QUARTERLY",
          formFamily: "10-Q",
          reportDate: resolvedFiling.reportDate!,
          observation: decision,
        });
        continue;
      }

      addClaim(accumulators, resolvedClassification, resolution, resolvedFiling, decision, "CURRENT", decision.current);
      if (decision.priorYear) {
        addClaim(accumulators, resolvedClassification, resolution, resolvedFiling, decision, "PRIOR_YEAR", decision.priorYear);
      }
    }
  }

  const series = [...accumulators.values()]
    .map(buildSeries)
    .sort(compareSeries);
  return {
    decisionVersion: SEC_PERIODIC_FINANCIAL_HISTORY_VERSION,
    issuerCik: input.issuerCik,
    quarterly: series.filter((row) => row.identity.category === "QUARTERLY"),
    annual: series.filter((row) => row.identity.category === "ANNUAL"),
    unavailable: unavailable.sort(compareUnavailable),
    nonSeriesDecisions: nonSeriesDecisions.sort(compareNonSeriesDecisions),
    filingResolutions: filingResolutions.sort((left, right) => left.targetAccession.localeCompare(right.targetAccession)),
    gptDependency: false,
  };
}

function addClaim(
  accumulators: Map<string, SeriesAccumulator>,
  classification: FilingClassification,
  resolution: SecPeriodicFinancialResolution,
  filing: SecFilingRow,
  observation: SecPeriodicFinancialObservation,
  sourceRole: SecPeriodicFinancialSeriesClaim["sourceRole"],
  evidence: SecPeriodicFinancialEvidence,
) {
  const basis = evidence.basis as Exclude<SecPeriodicFinancialBasis, "YEAR_TO_DATE">;
  const identity: SecPeriodicFinancialSeriesIdentity = {
    issuerCik: resolution.issuerCik,
    category: classification.category,
    formFamily: classification.formFamily,
    metric: evidence.metric,
    basis,
    financialScope: evidence.financialScope,
    unitKind: "ISO_4217_CURRENCY",
    unit: evidence.currency,
    taxonomy: evidence.taxonomy,
    concept: evidence.concept,
    conceptNamespaceUri: evidence.conceptNamespaceUri,
    reviewedMapping: evidence.reviewedMapping,
  };
  const key = seriesIdentityKey(identity);
  const accumulator = accumulators.get(key) ?? { identity, claims: [] };
  accumulator.claims.push({
    sourceRole,
    resolver: {
      decisionVersion: resolution.decisionVersion,
      targetAccession: resolution.targetAccession,
      filing,
      currentness: resolution.currentness,
      observation,
    },
    evidence,
  });
  accumulators.set(key, accumulator);
}

function buildSeries(accumulator: SeriesAccumulator): SecPeriodicFinancialSeries {
  const periodGroups = groupBy(accumulator.claims, (claim) => periodIdentity(claim.evidence.period));
  const points = [...periodGroups.values()].map((claims): SecPeriodicFinancialSeriesPoint => {
    const sortedClaims = [...claims].sort(compareClaims);
    const values = [...new Set(sortedClaims.map((claim) => claim.evidence.normalizedValue))].sort(compareDecimalStrings);
    const period = sortedClaims[0]!.evidence.period;
    if (values.length !== 1) {
      return {
        status: "UNAVAILABLE",
        reason: "CROSS_ACCESSION_VALUE_CONFLICT",
        detail: "compatible resolver claims for one exact period disagree; history does not choose a value",
        period,
        conflictingValues: values,
        claims: sortedClaims,
      };
    }
    return {
      status: "RESOLVED",
      reason: "EXACT_COMPATIBLE_CLAIMS",
      period,
      normalizedValue: values[0]!,
      claims: sortedClaims,
    };
  }).sort(comparePoints);
  return { identity: accumulator.identity, points };
}

function selectReviewedFilingSelection(
  filing: SecFilingRow,
  selections: readonly SecReviewedFinancialFilingSelection[],
) {
  const classification = classifyFiling(filing.form);
  if (!classification || !filing.reportDate) return null;
  const matching = selections.filter((selection) =>
    selection.issuerCik === filing.issuerCik
    && selection.baseForm === classification.formFamily
    && selection.reportDate === filing.reportDate
  );
  const unique = uniqueBy(matching, reviewedSelectionIdentity);
  return unique.length === 1 ? unique[0]! : null;
}

function classifyFiling(form: string): FilingClassification | null {
  const formFamily = form.toUpperCase().replace(/\s+/g, "").replace(/\/A$/, "");
  if (formFamily === "10-Q") return { category: "QUARTERLY", formFamily };
  if (formFamily === "10-K" || formFamily === "20-F" || formFamily === "40-F") {
    return { category: "ANNUAL", formFamily };
  }
  return null;
}

function seriesIdentityKey(identity: SecPeriodicFinancialSeriesIdentity) {
  return [
    identity.issuerCik,
    identity.category,
    identity.formFamily,
    identity.metric,
    identity.basis,
    identity.financialScope,
    identity.unitKind,
    identity.unit,
    identity.taxonomy,
    identity.concept,
    identity.conceptNamespaceUri,
    identity.reviewedMapping ? reviewedMappingIdentity(identity.reviewedMapping) : "standard",
  ].join("|");
}

function reviewedMappingIdentity(mapping: SecReviewedFinancialConceptMapping) {
  return [
    mapping.mappingVersion,
    mapping.reviewId,
    mapping.reviewedAt,
    mapping.issuerCik,
    mapping.metric,
    mapping.namespaceUri,
    mapping.taxonomy,
    mapping.concept,
    mapping.equivalentTo,
  ].join("|");
}

function reviewedSelectionIdentity(selection: SecReviewedFinancialFilingSelection) {
  return [
    selection.selectionVersion,
    selection.reviewId,
    selection.reviewedAt,
    selection.issuerCik,
    selection.baseForm,
    selection.reportDate,
    selection.selectedAccession,
    [...selection.supersededAccessions].sort().join(","),
  ].join("|");
}

function periodIdentity(period: SecXbrlPeriod) {
  return period.kind === "instant"
    ? `I:${period.instant}`
    : `D:${period.startDate}:${period.endDate}`;
}

function periodEnd(period: SecXbrlPeriod) {
  return period.kind === "instant" ? period.instant : period.endDate;
}

function compareClaims(left: SecPeriodicFinancialSeriesClaim, right: SecPeriodicFinancialSeriesClaim) {
  return left.resolver.targetAccession.localeCompare(right.resolver.targetAccession)
    || left.sourceRole.localeCompare(right.sourceRole)
    || left.evidence.normalizedValue.localeCompare(right.evidence.normalizedValue);
}

function comparePoints(left: SecPeriodicFinancialSeriesPoint, right: SecPeriodicFinancialSeriesPoint) {
  return periodEnd(left.period).localeCompare(periodEnd(right.period))
    || periodIdentity(left.period).localeCompare(periodIdentity(right.period))
    || left.status.localeCompare(right.status);
}

function compareSeries(left: SecPeriodicFinancialSeries, right: SecPeriodicFinancialSeries) {
  return CATEGORY_ORDER[left.identity.category] - CATEGORY_ORDER[right.identity.category]
    || left.identity.formFamily.localeCompare(right.identity.formFamily)
    || SEC_PERIODIC_FINANCIAL_METRICS.indexOf(left.identity.metric) - SEC_PERIODIC_FINANCIAL_METRICS.indexOf(right.identity.metric)
    || BASIS_ORDER[left.identity.basis] - BASIS_ORDER[right.identity.basis]
    || seriesIdentityKey(left.identity).localeCompare(seriesIdentityKey(right.identity));
}

function compareUnavailable(
  left: SecPeriodicFinancialHistoryUnavailable,
  right: SecPeriodicFinancialHistoryUnavailable,
) {
  return (left.category ? CATEGORY_ORDER[left.category] : 99) - (right.category ? CATEGORY_ORDER[right.category] : 99)
    || (left.reportDate ?? "").localeCompare(right.reportDate ?? "")
    || left.targetAccession.localeCompare(right.targetAccession)
    || SEC_PERIODIC_FINANCIAL_METRICS.indexOf(left.metric) - SEC_PERIODIC_FINANCIAL_METRICS.indexOf(right.metric)
    || (left.basis ?? "").localeCompare(right.basis ?? "")
    || left.reason.localeCompare(right.reason);
}

function compareNonSeriesDecisions(
  left: SecPeriodicFinancialNonSeriesDecision,
  right: SecPeriodicFinancialNonSeriesDecision,
) {
  return left.reportDate.localeCompare(right.reportDate)
    || left.targetAccession.localeCompare(right.targetAccession)
    || SEC_PERIODIC_FINANCIAL_METRICS.indexOf(left.observation.metric)
      - SEC_PERIODIC_FINANCIAL_METRICS.indexOf(right.observation.metric);
}

function compareDecimalStrings(left: string, right: string) {
  const leftNegative = left.startsWith("-");
  const rightNegative = right.startsWith("-");
  if (leftNegative !== rightNegative) return leftNegative ? -1 : 1;
  const [leftWhole, leftFraction = ""] = left.replace(/^-/, "").split(".");
  const [rightWhole, rightFraction = ""] = right.replace(/^-/, "").split(".");
  const magnitude = leftWhole.length - rightWhole.length
    || leftWhole.localeCompare(rightWhole)
    || leftFraction.padEnd(Math.max(leftFraction.length, rightFraction.length), "0")
      .localeCompare(rightFraction.padEnd(Math.max(leftFraction.length, rightFraction.length), "0"));
  return leftNegative ? -magnitude : magnitude;
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
