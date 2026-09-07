import {
  SEC_PERIODIC_FINANCIAL_HISTORY_VERSION,
  type SecPeriodicFinancialHistoryCategory,
  type SecPeriodicFinancialHistoryResolution,
  type SecPeriodicFinancialSeries,
} from "../sec-structured-data/periodicFinancialHistory.ts";
import {
  SEC_PERIODIC_FINANCIAL_DECISION_VERSION,
  SEC_PERIODIC_FINANCIAL_METRICS,
  type SecPeriodicFinancialBasis,
  type SecPeriodicFinancialEvidence,
  type SecPeriodicFinancialMetric,
  type SecPeriodicFinancialMetricDecision,
  type SecPeriodicFinancialObservation,
} from "../sec-structured-data/periodicFinancialResolver.ts";
import type { SecFilingRow } from "../sec-structured-data/types.ts";

export const STOCK_FINANCIALS_SOURCE = "SEC_XBRL" as const;

export type StockFinancialMetric = SecPeriodicFinancialMetric;
export type StockFinancialBasis = SecPeriodicFinancialBasis;

export type StockFinancialValue = {
  value: string;
  currency: string;
  period: SecPeriodicFinancialEvidence["period"];
};

export type StockFinancialProvenance = {
  accession: string;
  concept: string;
  filedDate: string;
  form: string;
  reportDate: string;
  sourceDocuments: string[];
  sourceUrls: string[];
  taxonomy: string;
};

export type StockFinancialMetricRow = {
  basis: StockFinancialBasis;
  delta: string | null;
  label: string;
  metric: StockFinancialMetric;
  priorYear: StockFinancialValue | null;
  priorYearReason: string | null;
  provenance: StockFinancialProvenance;
  status: "AVAILABLE";
  value: StockFinancialValue;
};

export type StockFinancialUnavailableRow = {
  basis: StockFinancialBasis | null;
  detail: string;
  filing: Pick<SecFilingRow, "accessionNumber" | "filedDate" | "form" | "reportDate"> | null;
  label: string;
  metric: StockFinancialMetric;
  reason: string;
  status: "UNAVAILABLE";
};

export type StockFinancialDisplayRow =
  | StockFinancialMetricRow
  | StockFinancialUnavailableRow;

export type StockFinancialCategorySnapshot = {
  category: SecPeriodicFinancialHistoryCategory;
  latestFiling: Pick<SecFilingRow, "accessionNumber" | "filedDate" | "form" | "reportDate"> | null;
  rows: StockFinancialDisplayRow[];
  ytdRows: StockFinancialDisplayRow[];
};

export type StockFinancialsSnapshot = {
  annual: StockFinancialCategorySnapshot;
  decisionVersion: typeof SEC_PERIODIC_FINANCIAL_DECISION_VERSION;
  fetchedAt: string;
  gptDependency: false;
  historyVersion: typeof SEC_PERIODIC_FINANCIAL_HISTORY_VERSION;
  issuerCik: string | null;
  quarterly: StockFinancialCategorySnapshot;
  source: typeof STOCK_FINANCIALS_SOURCE;
  symbol: string;
};

const METRIC_LABELS: Record<StockFinancialMetric, string> = {
  CASH: "Cash",
  NET_INCOME_LOSS: "Net income / loss",
  OPERATING_CASH_FLOW: "Operating cash flow",
  OPERATING_INCOME_LOSS: "Operating income / loss",
  REVENUE: "Revenue",
};

const PRIMARY_BASES: Record<
  SecPeriodicFinancialHistoryCategory,
  readonly StockFinancialBasis[]
> = {
  ANNUAL: ["ANNUAL", "INSTANT"],
  QUARTERLY: ["QUARTER", "QUARTER_AND_YEAR_TO_DATE", "INSTANT"],
};

export function buildStockFinancialsSnapshot(input: {
  fetchedAt?: string;
  history: SecPeriodicFinancialHistoryResolution;
  symbol: string;
}): StockFinancialsSnapshot {
  return {
    annual: buildCategory(input.history, "ANNUAL"),
    decisionVersion: SEC_PERIODIC_FINANCIAL_DECISION_VERSION,
    fetchedAt: input.fetchedAt ?? new Date().toISOString(),
    gptDependency: false,
    historyVersion: SEC_PERIODIC_FINANCIAL_HISTORY_VERSION,
    issuerCik: input.history.issuerCik,
    quarterly: buildCategory(input.history, "QUARTERLY"),
    source: STOCK_FINANCIALS_SOURCE,
    symbol: normalizeSymbol(input.symbol),
  };
}

export function buildUnavailableStockFinancialsSnapshot(input: {
  detail: string;
  fetchedAt?: string;
  issuerCik?: string | null;
  reason: string;
  symbol: string;
}): StockFinancialsSnapshot {
  const category = (
    value: SecPeriodicFinancialHistoryCategory,
  ): StockFinancialCategorySnapshot => ({
    category: value,
    latestFiling: null,
    rows: SEC_PERIODIC_FINANCIAL_METRICS.map((metric) => ({
      basis: metric === "CASH"
        ? "INSTANT"
        : value === "ANNUAL"
          ? "ANNUAL"
          : "QUARTER",
      detail: input.detail,
      filing: null,
      label: METRIC_LABELS[metric],
      metric,
      reason: input.reason,
      status: "UNAVAILABLE",
    })),
    ytdRows: [],
  });
  return {
    annual: category("ANNUAL"),
    decisionVersion: SEC_PERIODIC_FINANCIAL_DECISION_VERSION,
    fetchedAt: input.fetchedAt ?? new Date().toISOString(),
    gptDependency: false,
    historyVersion: SEC_PERIODIC_FINANCIAL_HISTORY_VERSION,
    issuerCik: input.issuerCik ?? null,
    quarterly: category("QUARTERLY"),
    source: STOCK_FINANCIALS_SOURCE,
    symbol: normalizeSymbol(input.symbol),
  };
}

function buildCategory(
  history: SecPeriodicFinancialHistoryResolution,
  category: SecPeriodicFinancialHistoryCategory,
): StockFinancialCategorySnapshot {
  const resolutions = history.filingResolutions
    .filter((resolution) => classification(resolution.filing?.form) === category)
    .sort((left, right) => compareFilingsDesc(left.filing, right.filing));
  const resolution = resolutions[0] ?? null;
  const filing = filingSummary(resolution?.filing ?? null);

  if (!resolution || !resolution.filing) {
    return {
      category,
      latestFiling: null,
      rows: SEC_PERIODIC_FINANCIAL_METRICS.map((metric) => unavailableRow({
        basis: defaultBasis(metric, category),
        detail: `No stored ${category.toLowerCase()} SEC filing reached the canonical resolver.`,
        filing: null,
        metric,
        reason: "SEC_FILING_UNAVAILABLE",
      })),
      ytdRows: [],
    };
  }

  const rows = SEC_PERIODIC_FINANCIAL_METRICS.map((metric) => {
    const decisions = resolution.decisions.filter((row) => row.metric === metric);
    const primary = decisions.filter((row) =>
      row.basis !== null && PRIMARY_BASES[category].includes(row.basis)
    );
    return selectDisplayDecision({
      category,
      decisions: primary,
      fallbackDecisions: decisions,
      filing: resolution.filing!,
      history,
      metric,
    });
  });

  const ytdRows = category === "QUARTERLY"
    ? SEC_PERIODIC_FINANCIAL_METRICS.flatMap((metric) => {
        const decisions = resolution.decisions.filter((row) =>
          row.metric === metric && row.basis === "YEAR_TO_DATE"
        );
        return decisions.length
          ? [selectDisplayDecision({
              category,
              decisions,
              fallbackDecisions: decisions,
              filing: resolution.filing!,
              history,
              metric,
            })]
          : [];
      })
    : [];

  return { category, latestFiling: filing, rows, ytdRows };
}

function selectDisplayDecision(input: {
  category: SecPeriodicFinancialHistoryCategory;
  decisions: readonly SecPeriodicFinancialMetricDecision[];
  fallbackDecisions: readonly SecPeriodicFinancialMetricDecision[];
  filing: SecFilingRow;
  history: SecPeriodicFinancialHistoryResolution;
  metric: StockFinancialMetric;
}): StockFinancialDisplayRow {
  const resolved = input.decisions.filter(
    (row): row is SecPeriodicFinancialObservation => row.status === "RESOLVED",
  );
  if (resolved.length !== 1) {
    const failure = input.decisions.find((row) => row.status !== "RESOLVED")
      ?? input.fallbackDecisions.find((row) => row.status !== "RESOLVED");
    return unavailableRow({
      basis: failure?.basis ?? defaultBasis(input.metric, input.category),
      detail: resolved.length > 1
        ? "More than one canonical observation competes for the same display slot."
        : failure?.detail
          ?? `The latest filing does not contain a canonical ${defaultBasis(input.metric, input.category).toLowerCase()} observation for this metric.`,
      filing: input.filing,
      metric: input.metric,
      reason: resolved.length > 1
        ? "MULTIPLE_DISPLAY_OBSERVATIONS"
        : failure?.reason ?? "BASIS_NOT_REPORTED",
    });
  }
  return resolvedRow(input.history, input.category, input.filing, resolved[0]!);
}

function resolvedRow(
  history: SecPeriodicFinancialHistoryResolution,
  category: SecPeriodicFinancialHistoryCategory,
  filing: SecFilingRow,
  observation: SecPeriodicFinancialObservation,
): StockFinancialDisplayRow {
  if (observation.basis === "YEAR_TO_DATE") {
    const preserved = history.nonSeriesDecisions.filter((row) =>
      row.targetAccession === filing.accessionNumber
      && row.observation.metric === observation.metric
      && sameEvidence(row.observation.current, observation.current)
    );
    if (preserved.length !== 1) {
      return unavailableRow({
        basis: observation.basis,
        detail: "The exact YTD resolver observation was not preserved uniquely by Financial History.",
        filing,
        metric: observation.metric,
        reason: "HISTORY_LINEAGE_UNAVAILABLE",
      });
    }
    return availableRow(observation, observation.priorYear);
  }

  const seriesMatches = seriesForCategory(history, category).filter((series) =>
    seriesMatchesEvidence(series, observation.current)
  );
  if (seriesMatches.length !== 1) {
    return unavailableRow({
      basis: observation.basis,
      detail: "Financial History did not produce one exact concept, currency, form, and basis series.",
      filing,
      metric: observation.metric,
      reason: "HISTORY_SERIES_UNAVAILABLE",
    });
  }
  const series = seriesMatches[0]!;
  const currentPoint = series.points.find((point) =>
    samePeriod(point.period, observation.current.period)
    && point.claims.some((claim) =>
      claim.sourceRole === "CURRENT"
      && claim.resolver.targetAccession === filing.accessionNumber
      && sameEvidence(claim.evidence, observation.current)
    )
  );
  if (!currentPoint || currentPoint.status !== "RESOLVED") {
    return unavailableRow({
      basis: observation.basis,
      detail: currentPoint?.status === "UNAVAILABLE"
        ? currentPoint.detail
        : "The current SEC observation is absent from its exact Financial History series.",
      filing,
      metric: observation.metric,
      reason: currentPoint?.status === "UNAVAILABLE"
        ? currentPoint.reason
        : "HISTORY_CURRENT_POINT_UNAVAILABLE",
    });
  }

  let priorYear: SecPeriodicFinancialEvidence | null = null;
  if (observation.priorYear) {
    const priorPoint = series.points.find((point) =>
      samePeriod(point.period, observation.priorYear!.period)
    );
    if (
      priorPoint?.status === "RESOLVED"
      && priorPoint.normalizedValue === observation.priorYear.normalizedValue
    ) {
      priorYear = observation.priorYear;
    }
  }
  return availableRow(observation, priorYear);
}

function availableRow(
  observation: SecPeriodicFinancialObservation,
  priorYear: SecPeriodicFinancialEvidence | null,
): StockFinancialMetricRow {
  const current = observation.current;
  const sourceUrls = [...new Set(current.filingFacts.map((fact) => fact.source.sourceUrl))]
    .filter(isSecUrl)
    .sort();
  const sourceDocuments = [...new Set(current.filingFacts.map((fact) => fact.source.documentName))]
    .filter(Boolean)
    .sort();
  return {
    basis: observation.basis,
    delta: priorYear
      ? subtractCanonicalDecimals(current.normalizedValue, priorYear.normalizedValue)
      : null,
    label: METRIC_LABELS[observation.metric],
    metric: observation.metric,
    priorYear: priorYear ? financialValue(priorYear) : null,
    priorYearReason: priorYear ? null : observation.priorYearStatus.reason,
    provenance: {
      accession: current.accession,
      concept: `${current.taxonomy}:${current.concept}`,
      filedDate: current.filedDate,
      form: current.form,
      reportDate: current.reportDate,
      sourceDocuments,
      sourceUrls,
      taxonomy: current.conceptNamespaceUri,
    },
    status: "AVAILABLE",
    value: financialValue(current),
  };
}

function financialValue(evidence: SecPeriodicFinancialEvidence): StockFinancialValue {
  return {
    currency: evidence.currency,
    period: evidence.period,
    value: evidence.normalizedValue,
  };
}

function unavailableRow(input: {
  basis: StockFinancialBasis | null;
  detail: string;
  filing: SecFilingRow | null;
  metric: StockFinancialMetric;
  reason: string;
}): StockFinancialUnavailableRow {
  return {
    basis: input.basis,
    detail: input.detail,
    filing: filingSummary(input.filing),
    label: METRIC_LABELS[input.metric],
    metric: input.metric,
    reason: input.reason,
    status: "UNAVAILABLE",
  };
}

function seriesForCategory(
  history: SecPeriodicFinancialHistoryResolution,
  category: SecPeriodicFinancialHistoryCategory,
) {
  return category === "QUARTERLY" ? history.quarterly : history.annual;
}

function seriesMatchesEvidence(
  series: SecPeriodicFinancialSeries,
  evidence: SecPeriodicFinancialEvidence,
) {
  return series.identity.metric === evidence.metric
    && series.identity.basis === evidence.basis
    && series.identity.unit === evidence.currency
    && series.identity.taxonomy === evidence.taxonomy
    && series.identity.concept === evidence.concept
    && series.identity.conceptNamespaceUri === evidence.conceptNamespaceUri
    && (series.identity.reviewedMapping?.reviewId ?? null)
      === (evidence.reviewedMapping?.reviewId ?? null);
}

function sameEvidence(
  left: SecPeriodicFinancialEvidence,
  right: SecPeriodicFinancialEvidence,
) {
  return left.accession === right.accession
    && left.metric === right.metric
    && left.basis === right.basis
    && left.currency === right.currency
    && left.taxonomy === right.taxonomy
    && left.concept === right.concept
    && left.conceptNamespaceUri === right.conceptNamespaceUri
    && left.normalizedValue === right.normalizedValue
    && samePeriod(left.period, right.period);
}

function samePeriod(
  left: SecPeriodicFinancialEvidence["period"],
  right: SecPeriodicFinancialEvidence["period"],
) {
  return left.kind === right.kind && (
    left.kind === "instant" && right.kind === "instant"
      ? left.instant === right.instant
      : left.kind === "duration" && right.kind === "duration"
        ? left.startDate === right.startDate && left.endDate === right.endDate
        : false
  );
}

function compareFilingsDesc(left: SecFilingRow | null, right: SecFilingRow | null) {
  return (right?.reportDate ?? "").localeCompare(left?.reportDate ?? "")
    || (right?.filedDate ?? "").localeCompare(left?.filedDate ?? "")
    || (right?.accessionNumber ?? "").localeCompare(left?.accessionNumber ?? "");
}

function filingSummary(filing: SecFilingRow | null) {
  return filing ? {
    accessionNumber: filing.accessionNumber,
    filedDate: filing.filedDate,
    form: filing.form,
    reportDate: filing.reportDate,
  } : null;
}

function classification(form: string | null | undefined): SecPeriodicFinancialHistoryCategory | null {
  const base = (form ?? "").toUpperCase().replace(/\s+/g, "").replace(/\/A$/, "");
  if (base === "10-Q") return "QUARTERLY";
  return ["10-K", "20-F", "40-F"].includes(base) ? "ANNUAL" : null;
}

function defaultBasis(
  metric: StockFinancialMetric,
  category: SecPeriodicFinancialHistoryCategory,
): StockFinancialBasis {
  if (metric === "CASH") return "INSTANT";
  return category === "ANNUAL" ? "ANNUAL" : "QUARTER";
}

function isSecUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "sec.gov" || url.hostname.endsWith(".sec.gov"));
  } catch {
    return false;
  }
}

export function subtractCanonicalDecimals(left: string, right: string) {
  const parsedLeft = parseCanonicalDecimal(left);
  const parsedRight = parseCanonicalDecimal(right);
  if (!parsedLeft || !parsedRight) return null;
  const scale = Math.max(parsedLeft.scale, parsedRight.scale);
  const leftInteger = parsedLeft.integer * BigInt(10) ** BigInt(scale - parsedLeft.scale);
  const rightInteger = parsedRight.integer * BigInt(10) ** BigInt(scale - parsedRight.scale);
  return formatScaledInteger(leftInteger - rightInteger, scale);
}

function parseCanonicalDecimal(value: string) {
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return null;
  const negative = value.startsWith("-");
  const unsigned = value.replace(/^-/, "");
  const [whole, fraction = ""] = unsigned.split(".");
  const integer = BigInt(`${whole}${fraction}`) * (negative ? BigInt(-1) : BigInt(1));
  return { integer, scale: fraction.length };
}

function formatScaledInteger(value: bigint, scale: number) {
  const negative = value < BigInt(0);
  const digits = (negative ? -value : value).toString().padStart(scale + 1, "0");
  const whole = scale ? digits.slice(0, -scale) : digits;
  const fraction = scale ? digits.slice(-scale).replace(/0+$/, "") : "";
  const normalized = fraction ? `${whole}.${fraction}` : whole;
  return negative && normalized !== "0" ? `-${normalized}` : normalized;
}

function normalizeSymbol(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 12);
}
