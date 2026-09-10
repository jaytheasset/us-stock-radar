import {
  SEC_PERIODIC_FINANCIAL_DECISION_VERSION,
  type SecPeriodicFinancialEvidence,
  type SecPeriodicFinancialMetric,
  type SecPeriodicFinancialMetricDecision,
  type SecPeriodicFinancialObservation,
  type SecPeriodicFinancialResolution,
} from "../sec-structured-data/periodicFinancialResolver.ts";

export const PERIODIC_FINANCIAL_MONITOR_ANALYZER_KEY = "periodic_financial" as const;
export const PERIODIC_FINANCIAL_MONITOR_CONTRACT_VERSION =
  "periodic_financial_monitor_v1" as const;
export const PERIODIC_FINANCIAL_MONITOR_SCHEMA_VERSION =
  "periodic_financial_monitor_analysis_v1" as const;

export type PeriodicFinancialChangeDirection =
  | "INCREASED"
  | "DECREASED"
  | "IMPROVED"
  | "WORSENED"
  | "UNCHANGED";

export type PeriodicFinancialMonitorComparison = {
  status: "AVAILABLE";
  metric: SecPeriodicFinancialMetric;
  basis: SecPeriodicFinancialObservation["basis"];
  current: SecPeriodicFinancialEvidence;
  priorYear: SecPeriodicFinancialEvidence | null;
  change:
    | {
        status: "AVAILABLE";
        absoluteChange: string;
        direction: PeriodicFinancialChangeDirection;
      }
    | {
        status: "UNAVAILABLE";
        reason:
          | "PRIOR_YEAR_COMPARABLE_NOT_FOUND"
          | "LIKE_FOR_LIKE_MISMATCH"
          | "INVALID_CANONICAL_PROVENANCE";
      };
  resolverReason: SecPeriodicFinancialObservation["reason"];
  rejectedDimensionalFactKeys: string[];
};

export type PeriodicFinancialMonitorUnavailable = {
  status: "UNAVAILABLE" | "AMBIGUOUS";
  metric: SecPeriodicFinancialMetric;
  basis: SecPeriodicFinancialMetricDecision["basis"];
  reason: string;
  detail: string;
  rejectedDimensionalFactKeys: string[];
};

export type PeriodicFinancialMonitorAnalysis = {
  schemaVersion: typeof PERIODIC_FINANCIAL_MONITOR_SCHEMA_VERSION;
  analyzerKey: typeof PERIODIC_FINANCIAL_MONITOR_ANALYZER_KEY;
  analyzerContractVersion: typeof PERIODIC_FINANCIAL_MONITOR_CONTRACT_VERSION;
  calculationSource: typeof SEC_PERIODIC_FINANCIAL_DECISION_VERSION;
  gptDependency: false;
  issuerCik: string;
  targetAccession: string;
  filing: SecPeriodicFinancialResolution["filing"];
  currentness: SecPeriodicFinancialResolution["currentness"];
  resultStatus: "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
  comparisons: PeriodicFinancialMonitorComparison[];
  unavailable: PeriodicFinancialMonitorUnavailable[];
};

export type PeriodicFinancialFilingIdentity = {
  accession: string;
  issuerCik: string;
  form: "10-Q" | "10-Q/A" | "10-K" | "10-K/A" | "20-F" | "20-F/A" | "40-F" | "40-F/A";
};

const PERIODIC_FINANCIAL_ACCESSION_PATTERN = /^\d{10}-\d{2}-\d{6}$/;
const PERIODIC_FINANCIAL_CIK_PATTERN = /^\d{10}$/;
const PERIODIC_FINANCIAL_FORMS = new Set<PeriodicFinancialFilingIdentity["form"]>([
  "10-Q", "10-Q/A", "10-K", "10-K/A", "20-F", "20-F/A", "40-F", "40-F/A",
]);

export function readPeriodicFinancialRawFilingIdentity(
  rawItem: Record<string, unknown>,
  expectedSourceAccession: string,
): PeriodicFinancialFilingIdentity {
  const rawPayload = record(rawItem.raw_payload);
  const metadata = record(rawItem.metadata);
  const sourceAccession = exactAccession(rawItem.source_unique_id);
  const payloadAccession = exactAccession(rawPayload?.accession_number);
  const expectedAccession = exactAccession(expectedSourceAccession);
  if (
    !sourceAccession
    || !payloadAccession
    || !expectedAccession
    || sourceAccession !== expectedAccession
    || payloadAccession !== expectedAccession
  ) {
    throw new Error("Periodic Financial Monitor filing accession identity mismatch");
  }

  const cikCandidates = [rawPayload?.cik, rawPayload?.issuer_cik, metadata?.cik]
    .map(text)
    .filter(Boolean)
    .map((candidate) => /^\d{1,10}$/.test(candidate) ? candidate.padStart(10, "0") : "");
  const formCandidates = [rawPayload?.form_type, rawPayload?.form, metadata?.formType, metadata?.form_type]
    .map(normalizePeriodicFinancialForm)
    .filter((candidate): candidate is PeriodicFinancialFilingIdentity["form"] => Boolean(candidate));
  const issuerCik = cikCandidates.length > 0 && new Set(cikCandidates).size === 1 ? cikCandidates[0]! : "";
  const form = formCandidates.length > 0 && new Set(formCandidates).size === 1 ? formCandidates[0]! : null;
  if (!PERIODIC_FINANCIAL_CIK_PATTERN.test(issuerCik) || !form) {
    throw new Error("Stored periodic SEC source lacks an exact CIK/form identity");
  }
  return { accession: expectedAccession, issuerCik, form };
}

export function assertPeriodicFinancialMonitorAnalysisIdentity(
  analysis: PeriodicFinancialMonitorAnalysis,
  expected: PeriodicFinancialFilingIdentity,
) {
  const filing = analysis.filing;
  if (
    analysis.targetAccession !== expected.accession
    || analysis.issuerCik !== expected.issuerCik
    || !filing
    || filing.accessionNumber !== expected.accession
    || filing.issuerCik !== expected.issuerCik
    || normalizePeriodicFinancialForm(filing.form) !== expected.form
  ) {
    throw new Error("Periodic Financial Monitor analysis filing identity mismatch");
  }
}

/**
 * Monitor normalization is intentionally downstream of the canonical resolver.
 * It never reads Primary/GPT fields and derives only an exact decimal delta and
 * a deterministic direction from a resolver-approved like-for-like pair.
 */
export function buildPeriodicFinancialMonitorAnalysis(
  resolution: SecPeriodicFinancialResolution,
): PeriodicFinancialMonitorAnalysis {
  if (
    resolution.decisionVersion !== SEC_PERIODIC_FINANCIAL_DECISION_VERSION
    || resolution.gptDependency !== false
  ) {
    throw new Error("Periodic Financial Monitor requires the canonical resolver V1 output");
  }

  const comparisons: PeriodicFinancialMonitorComparison[] = [];
  const unavailable: PeriodicFinancialMonitorUnavailable[] = [];
  for (const decision of resolution.decisions) {
    if (decision.status !== "RESOLVED") {
      unavailable.push(copyUnavailable(decision));
      continue;
    }
    comparisons.push(normalizeComparison(resolution, decision));
  }

  return {
    schemaVersion: PERIODIC_FINANCIAL_MONITOR_SCHEMA_VERSION,
    analyzerKey: PERIODIC_FINANCIAL_MONITOR_ANALYZER_KEY,
    analyzerContractVersion: PERIODIC_FINANCIAL_MONITOR_CONTRACT_VERSION,
    calculationSource: SEC_PERIODIC_FINANCIAL_DECISION_VERSION,
    gptDependency: false,
    issuerCik: resolution.issuerCik,
    targetAccession: resolution.targetAccession,
    filing: resolution.filing,
    currentness: resolution.currentness,
    resultStatus: comparisons.length === 0
      ? "UNAVAILABLE"
      : unavailable.length > 0 || comparisons.some((row) => row.change.status === "UNAVAILABLE")
        ? "PARTIAL"
        : "AVAILABLE",
    comparisons,
    unavailable,
  };
}

function normalizeComparison(
  resolution: SecPeriodicFinancialResolution,
  decision: SecPeriodicFinancialObservation,
): PeriodicFinancialMonitorComparison {
  const common = {
    status: "AVAILABLE" as const,
    metric: decision.metric,
    basis: decision.basis,
    current: decision.current,
    priorYear: decision.priorYear,
    resolverReason: decision.reason,
    rejectedDimensionalFactKeys: [...decision.rejectedDimensionalFactKeys],
  };
  if (!validEvidenceProvenance(resolution, decision.current)
    || (decision.priorYear && !validEvidenceProvenance(resolution, decision.priorYear))) {
    return {
      ...common,
      change: { status: "UNAVAILABLE", reason: "INVALID_CANONICAL_PROVENANCE" },
    };
  }
  if (!decision.priorYear) {
    return {
      ...common,
      change: { status: "UNAVAILABLE", reason: "PRIOR_YEAR_COMPARABLE_NOT_FOUND" },
    };
  }
  if (!likeForLike(decision.current, decision.priorYear)) {
    return {
      ...common,
      change: { status: "UNAVAILABLE", reason: "LIKE_FOR_LIKE_MISMATCH" },
    };
  }
  const absoluteChange = subtractExactDecimals(
    decision.current.normalizedValue,
    decision.priorYear.normalizedValue,
  );
  return {
    ...common,
    change: {
      status: "AVAILABLE",
      absoluteChange,
      direction: directionFor(decision.metric, absoluteChange),
    },
  };
}

function validEvidenceProvenance(
  resolution: SecPeriodicFinancialResolution,
  evidence: SecPeriodicFinancialEvidence,
) {
  return evidence.accession === resolution.targetAccession
    && evidence.filingFacts.length > 0
    && evidence.companyFacts.length > 0
    && evidence.filingFacts.every((fact) =>
      fact.source.issuerCik === resolution.issuerCik
      && fact.source.accession === resolution.targetAccession
      && fact.source.artifactId.length > 0
      && fact.source.sourceUrl.length > 0
      && fact.source.contentHash.length > 0
      && fact.concept.localName === evidence.concept
      && fact.concept.namespaceUri === evidence.conceptNamespaceUri
      && fact.unit?.kind === "measure"
      && fact.unit.measure.localName === evidence.currency
    )
    && evidence.companyFacts.every((fact) =>
      fact.issuerCik === resolution.issuerCik
      && fact.filingAccession === resolution.targetAccession
      && fact.form === evidence.form
      && fact.taxonomy === evidence.taxonomy
      && fact.concept === evidence.concept
      && fact.unit === evidence.currency
      && fact.sourceFactKey.length > 0
      && fact.sourceFactPath.length > 0
      && fact.sourceRawId.length > 0
    );
}

function likeForLike(
  current: SecPeriodicFinancialEvidence,
  prior: SecPeriodicFinancialEvidence,
) {
  return current.metric === prior.metric
    && current.basis === prior.basis
    && current.currency === prior.currency
    && current.taxonomy === prior.taxonomy
    && current.concept === prior.concept
    && current.conceptNamespaceUri === prior.conceptNamespaceUri
    && current.financialScope === prior.financialScope
    && current.period.kind === prior.period.kind;
}

function copyUnavailable(
  decision: Exclude<SecPeriodicFinancialMetricDecision, SecPeriodicFinancialObservation>,
): PeriodicFinancialMonitorUnavailable {
  return {
    status: decision.status,
    metric: decision.metric,
    basis: decision.basis,
    reason: decision.reason,
    detail: decision.detail,
    rejectedDimensionalFactKeys: [...decision.rejectedDimensionalFactKeys],
  };
}

function directionFor(
  metric: SecPeriodicFinancialMetric,
  absoluteChange: string,
): PeriodicFinancialChangeDirection {
  const sign = decimalSign(absoluteChange);
  if (sign === 0) return "UNCHANGED";
  if (metric === "OPERATING_INCOME_LOSS" || metric === "NET_INCOME_LOSS") {
    return sign > 0 ? "IMPROVED" : "WORSENED";
  }
  return sign > 0 ? "INCREASED" : "DECREASED";
}

export function subtractExactDecimals(left: string, right: string) {
  const leftParts = parseExactDecimal(left);
  const rightParts = parseExactDecimal(right);
  const scale = Math.max(leftParts.scale, rightParts.scale);
  const leftInteger = leftParts.integer * BigInt(10) ** BigInt(scale - leftParts.scale);
  const rightInteger = rightParts.integer * BigInt(10) ** BigInt(scale - rightParts.scale);
  return formatExactDecimal(leftInteger - rightInteger, scale);
}

export function compareExactDecimals(left: string, right: string) {
  const difference = subtractExactDecimals(left, right);
  return decimalSign(difference);
}

function parseExactDecimal(value: string) {
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    throw new Error("Canonical financial value is not an exact decimal");
  }
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = unsigned.split(".");
  const integer = BigInt(`${whole}${fraction}` || "0")
    * (negative ? BigInt(-1) : BigInt(1));
  return { integer, scale: fraction.length };
}

function formatExactDecimal(integer: bigint, scale: number) {
  const negative = integer < BigInt(0);
  let digits = (negative ? -integer : integer).toString().padStart(scale + 1, "0");
  if (scale > 0) {
    const split = digits.length - scale;
    const fraction = digits.slice(split).replace(/0+$/, "");
    digits = fraction ? `${digits.slice(0, split)}.${fraction}` : digits.slice(0, split);
  }
  if (digits === "0") return "0";
  return negative ? `-${digits}` : digits;
}

function decimalSign(value: string) {
  const parsed = parseExactDecimal(value).integer;
  return parsed === BigInt(0) ? 0 : parsed > BigInt(0) ? 1 : -1;
}

function exactAccession(value: unknown) {
  const candidate = text(value);
  return PERIODIC_FINANCIAL_ACCESSION_PATTERN.test(candidate) ? candidate : "";
}

function normalizePeriodicFinancialForm(value: unknown): PeriodicFinancialFilingIdentity["form"] | null {
  const candidate = text(value).toUpperCase().replace(/\s+/g, "");
  return PERIODIC_FINANCIAL_FORMS.has(candidate as PeriodicFinancialFilingIdentity["form"])
    ? candidate as PeriodicFinancialFilingIdentity["form"]
    : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
