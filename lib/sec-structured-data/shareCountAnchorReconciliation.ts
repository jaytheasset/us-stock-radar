import {
  CLASS_SHARE_COUNT_RESOLVER_VERSION,
  type ClassShareCountResolved,
} from "./classShareCountResolver.ts";
import {
  readShareCountHistory,
  type AuthoritativeShareCountHistoryObservation,
  type Level2ShareCountHistoryObservation,
  type ShareCountHistoryObservation,
  type ShareCountHistoryRepository,
} from "./shareCountHistory.ts";
import {
  normalizeClassShareCountForStockSplitsAt,
  type AppliedStockSplitExecution,
  type ExactShareCount,
  type StockSplitShareBasisNormalizerDependencies,
  type StockSplitShareBasisNormalization,
} from "./stockSplitShareBasisNormalizer.ts";
import type { AppliedReverseSplitExecution } from "./reverseSplitShareBasisNormalizer.ts";

export const SHARE_COUNT_ANCHOR_RECONCILIATION_VERSION =
  "share-count-anchor-reconciliation-v1" as const;

export const SHARE_COUNT_ANCHOR_RECONCILIATION_COVERAGE = [
  "authoritative_periodic_anchor",
  "stock_split_basis_normalization",
] as const;

export type ExactSignedRational = {
  numerator: string;
  denominator: string;
};

export type ShareCountAnchorSelection = {
  asOf: string;
  sharesOutstanding: string;
  selectedObservation: AuthoritativeShareCountHistoryObservation;
  authoritativeObservations: AuthoritativeShareCountHistoryObservation[];
  sameDateLevel2Corroboration: Level2ShareCountHistoryObservation[];
};

export type ReconciledIntermediateShareCount = {
  asOf: string;
  sourceShares: string;
  normalizedExactShares: ExactShareCount;
  normalizedIntegerShares: string | null;
  supportingObservations: Level2ShareCountHistoryObservation[];
  appliedExecutionIds: string[];
  appliedExecutions: AppliedStockSplitExecution[];
};

export type ShareCountReconciliationConflict = {
  kind: "SAME_DATE_DIFFERENT_SHARES";
  asOf: string;
  sharesOutstandingValues: string[];
  observations: ShareCountHistoryObservation[];
};

type ShareCountAnchorReconciliationBase = {
  reconciliationVersion: typeof SHARE_COUNT_ANCHOR_RECONCILIATION_VERSION;
  view: "RECONCILED_HINDSIGHT";
  cik: string;
  securityClassId: string;
  interval: { startAsOf: string; endAsOf: string };
  basisTargetAt: string;
  coverage: typeof SHARE_COUNT_ANCHOR_RECONCILIATION_COVERAGE;
  startAnchor: ShareCountAnchorSelection | null;
  endAnchor: ShareCountAnchorSelection | null;
  normalizedStartShares: ExactShareCount | null;
  endShares: ExactShareCount | null;
  netChangeShares: ExactSignedRational | null;
  netChangePct: ExactSignedRational | null;
  intermediateObservations: ReconciledIntermediateShareCount[];
  appliedStockSplitExecutions: AppliedStockSplitExecution[];
  /** @deprecated Use appliedStockSplitExecutions. */
  appliedReverseSplitExecutions: AppliedReverseSplitExecution[];
  normalizationFailures: StockSplitShareBasisNormalization[];
  conflicts: ShareCountReconciliationConflict[];
  provenance: {
    historySource: "share_count_history";
    startAnchorSourceIdentities: string[];
    endAnchorSourceIdentities: string[];
    intermediateSourceIdentities: string[];
  };
};

export type ShareCountAnchorsReconciled = ShareCountAnchorReconciliationBase & {
  status: "RECONCILED";
  reason: "AUTHORITATIVE_ANCHORS_RECONCILED";
  startAnchor: ShareCountAnchorSelection;
  endAnchor: ShareCountAnchorSelection;
  normalizedStartShares: ExactShareCount;
  endShares: ExactShareCount;
  netChangeShares: ExactSignedRational;
  netChangePct: ExactSignedRational;
};

export type ShareCountAnchorReconciliationConflictResult = ShareCountAnchorReconciliationBase & {
  status: "CONFLICT";
  reason: "START_ANCHOR_CONFLICT" | "END_ANCHOR_CONFLICT" | "INTERMEDIATE_OBSERVATION_CONFLICT";
  normalizedStartShares: null;
  endShares: null;
  netChangeShares: null;
  netChangePct: null;
};

export type ShareCountAnchorReconciliationUnavailable = ShareCountAnchorReconciliationBase & {
  status: "RECONCILIATION_UNAVAILABLE";
  reason:
    | "HISTORY_READ_FAILED"
    | "SECURITY_IDENTITY_MISMATCH"
    | "START_ANCHOR_NOT_FOUND"
    | "END_ANCHOR_NOT_FOUND"
    | "ANCHOR_PROVENANCE_INVALID"
    | "INTERMEDIATE_PROVENANCE_INVALID"
    | "START_BASIS_NORMALIZATION_UNAVAILABLE"
    | "INTERMEDIATE_BASIS_NORMALIZATION_UNAVAILABLE";
  normalizedStartShares: null;
  endShares: null;
  netChangeShares: null;
  netChangePct: null;
};

export type ShareCountAnchorReconciliation =
  | ShareCountAnchorsReconciled
  | ShareCountAnchorReconciliationConflictResult
  | ShareCountAnchorReconciliationUnavailable;

export type ShareCountAnchorReconciliationDependencies = {
  normalizeShareCountAt?: typeof normalizeClassShareCountForStockSplitsAt;
  readExecutions?: NonNullable<StockSplitShareBasisNormalizerDependencies["readExecutions"]>;
};

export async function reconcileShareCountAnchors(
  input: {
    repository: ShareCountHistoryRepository;
    cik: string;
    securityClassId: string;
    startAnchor: { asOf: string };
    endAnchor: { asOf: string };
    executionKnownAt?: string;
  },
  dependencies: ShareCountAnchorReconciliationDependencies = {},
): Promise<ShareCountAnchorReconciliation> {
  validateInput(input);
  const basisTargetAt = `${input.endAnchor.asOf}T23:59:59.999Z`;
  const interval = { startAsOf: input.startAnchor.asOf, endAsOf: input.endAnchor.asOf };
  let history: ShareCountHistoryObservation[];
  try {
    history = await readShareCountHistory(input.repository, input.cik, {
      asOfFrom: interval.startAsOf,
      asOfTo: interval.endAsOf,
      canonicalSecurityClassId: input.securityClassId,
    });
  } catch {
    return unavailable(input, basisTargetAt, "HISTORY_READ_FAILED");
  }

  if (history.some((row) => row.issuerCik !== input.cik
    || row.canonicalSecurityClassId !== input.securityClassId
    || row.canonicalSecurityClassStatus !== "mapped"
    || row.canonicalSecurityClassKind !== "common_stock")) {
    return unavailable(input, basisTargetAt, "SECURITY_IDENTITY_MISMATCH");
  }
  const orderedHistory = history.map((row) => structuredClone(row)).sort(compareObservationIdentity);
  const start = selectAnchor(orderedHistory, interval.startAsOf, input);
  if (start.status === "missing") return unavailable(input, basisTargetAt, "START_ANCHOR_NOT_FOUND");
  if (start.status === "invalid") return unavailable(input, basisTargetAt, "ANCHOR_PROVENANCE_INVALID");
  if (start.status === "conflict") {
    return conflictResult(input, basisTargetAt, "START_ANCHOR_CONFLICT", start.conflict, null, null);
  }
  const end = selectAnchor(orderedHistory, interval.endAsOf, input);
  if (end.status === "missing") return unavailable(input, basisTargetAt, "END_ANCHOR_NOT_FOUND", start.anchor);
  if (end.status === "invalid") return unavailable(input, basisTargetAt, "ANCHOR_PROVENANCE_INVALID", start.anchor);
  if (end.status === "conflict") {
    return conflictResult(input, basisTargetAt, "END_ANCHOR_CONFLICT", end.conflict, start.anchor, null);
  }

  const endpointConflict = findSameDateConflict(orderedHistory.filter((row) =>
    row.asOf === interval.startAsOf || row.asOf === interval.endAsOf));
  if (endpointConflict) {
    const reason = endpointConflict.asOf === interval.startAsOf ? "START_ANCHOR_CONFLICT" : "END_ANCHOR_CONFLICT";
    return conflictResult(input, basisTargetAt, reason, endpointConflict, start.anchor, end.anchor);
  }

  const intermediateRows = orderedHistory.filter((row): row is Level2ShareCountHistoryObservation =>
    row.sourceType === "sec_filing_text_level2"
    && row.asOf > interval.startAsOf
    && row.asOf < interval.endAsOf);
  if (intermediateRows.some((row) => !validLevel2Provenance(row))) {
    return unavailable(input, basisTargetAt, "INTERMEDIATE_PROVENANCE_INVALID", start.anchor, end.anchor);
  }
  const groupedIntermediate = groupByAsOf(intermediateRows);
  for (const rows of groupedIntermediate) {
    const pointConflict = conflictForRows(rows);
    if (pointConflict) {
      return conflictResult(
        input,
        basisTargetAt,
        "INTERMEDIATE_OBSERVATION_CONFLICT",
        pointConflict,
        start.anchor,
        end.anchor,
      );
    }
  }

  const startNormalization = await normalizeObservationGroup(
    input,
    basisTargetAt,
    start.anchor.authoritativeObservations,
    dependencies,
    input.executionKnownAt,
  );
  if (startNormalization.status !== "NORMALIZED") {
    return unavailable(
      input,
      basisTargetAt,
      "START_BASIS_NORMALIZATION_UNAVAILABLE",
      start.anchor,
      end.anchor,
      [startNormalization],
    );
  }

  const intermediateObservations: ReconciledIntermediateShareCount[] = [];
  for (const rows of groupedIntermediate) {
    const normalization = await normalizeObservationGroup(
      input,
      basisTargetAt,
      rows,
      dependencies,
      input.executionKnownAt,
    );
    if (normalization.status !== "NORMALIZED") {
      return unavailable(
        input,
        basisTargetAt,
        "INTERMEDIATE_BASIS_NORMALIZATION_UNAVAILABLE",
        start.anchor,
        end.anchor,
        [normalization],
      );
    }
    intermediateObservations.push({
      asOf: rows[0]!.asOf,
      sourceShares: rows[0]!.sharesOutstanding,
      normalizedExactShares: { ...normalization.normalizedExactShares },
      normalizedIntegerShares: normalization.normalizedIntegerShares,
      supportingObservations: structuredClone(rows),
      appliedExecutionIds: [...normalization.appliedExecutionIds],
      appliedExecutions: structuredClone(normalization.appliedExecutions),
    });
  }

  const endShares = exactPositiveInteger(end.anchor.sharesOutstanding);
  const netChangeShares = subtractExact(endShares, startNormalization.normalizedExactShares);
  const netChangePct = percentageOf(netChangeShares, startNormalization.normalizedExactShares);
  return {
    ...baseResult(input, basisTargetAt, start.anchor, end.anchor),
    status: "RECONCILED",
    reason: "AUTHORITATIVE_ANCHORS_RECONCILED",
    startAnchor: start.anchor,
    endAnchor: end.anchor,
    normalizedStartShares: { ...startNormalization.normalizedExactShares },
    endShares,
    netChangeShares,
    netChangePct,
    intermediateObservations,
    appliedStockSplitExecutions: structuredClone(startNormalization.appliedExecutions),
    appliedReverseSplitExecutions: reverseExecutions(startNormalization.appliedExecutions),
    normalizationFailures: [],
    conflicts: [],
    provenance: provenance(start.anchor, end.anchor, intermediateRows),
  };
}

type AnchorSelectionResult =
  | { status: "selected"; anchor: ShareCountAnchorSelection }
  | { status: "missing" }
  | { status: "invalid" }
  | { status: "conflict"; conflict: ShareCountReconciliationConflict };

function selectAnchor(
  history: ShareCountHistoryObservation[],
  asOf: string,
  input: { cik: string; securityClassId: string },
): AnchorSelectionResult {
  const sourceRows = history.filter((row) => row.asOf === asOf && row.sourceType === "sec_authoritative_os");
  const candidates = sourceRows.filter((row): row is AuthoritativeShareCountHistoryObservation =>
    row.observationType === "authoritative_xbrl" && PERIODIC_FORMS.has(row.form));
  if (candidates.length === 0) return { status: "missing" };
  if (candidates.some((row) => !validAnchor(row, input, asOf))) return { status: "invalid" };
  const candidateConflict = conflictForRows(candidates);
  if (candidateConflict) return { status: "conflict", conflict: candidateConflict };
  const sameDateLevel2 = history.filter((row): row is Level2ShareCountHistoryObservation =>
    row.asOf === asOf && row.sourceType === "sec_filing_text_level2");
  if (sameDateLevel2.some((row) => !validLevel2Provenance(row))) return { status: "invalid" };
  return {
    status: "selected",
    anchor: {
      asOf,
      sharesOutstanding: candidates[0]!.sharesOutstanding,
      selectedObservation: structuredClone(candidates[0]!),
      authoritativeObservations: structuredClone(candidates),
      sameDateLevel2Corroboration: structuredClone(sameDateLevel2.filter((row) =>
        row.sharesOutstanding === candidates[0]!.sharesOutstanding)),
    },
  };
}

async function normalizeObservationGroup(
  input: { repository: ShareCountHistoryRepository; cik: string; securityClassId: string },
  basisTargetAt: string,
  rows: ShareCountHistoryObservation[],
  dependencies: ShareCountAnchorReconciliationDependencies,
  executionKnownAt?: string,
): Promise<StockSplitShareBasisNormalization> {
  const normalization = dependencies.normalizeShareCountAt ?? normalizeClassShareCountForStockSplitsAt;
  const resolution = resolvedObservationGroup(input, basisTargetAt, rows);
  const normalizerDependencies: StockSplitShareBasisNormalizerDependencies = {
    resolveShareCount: async () => structuredClone(resolution),
  };
  if (dependencies.readExecutions) normalizerDependencies.readExecutions = dependencies.readExecutions;
  return normalization(
    {
      repository: input.repository,
      cik: input.cik,
      securityClassId: input.securityClassId,
      targetAt: basisTargetAt,
      ...(executionKnownAt ? { executionKnownAt } : {}),
    },
    normalizerDependencies,
  );
}

function resolvedObservationGroup(
  input: { cik: string; securityClassId: string },
  targetAt: string,
  rows: ShareCountHistoryObservation[],
): ClassShareCountResolved {
  const ordered = structuredClone(rows).sort(compareObservationIdentity);
  const asOf = ordered[0]!.asOf;
  return {
    resolverVersion: CLASS_SHARE_COUNT_RESOLVER_VERSION,
    status: "RESOLVED",
    cik: input.cik,
    securityClassId: input.securityClassId,
    targetAt,
    sharesOutstanding: ordered[0]!.sharesOutstanding,
    asOf,
    ageDays: wholeDays(asOf, targetAt.slice(0, 10)),
    selectedObservation: structuredClone(ordered[0]!),
    supportingObservations: ordered,
    reason: new Set(ordered.map((row) => row.sourceType)).size > 1
      ? "LATEST_ELIGIBLE_AS_OF_CORROBORATED"
      : "LATEST_ELIGIBLE_AS_OF_RESOLVED",
  };
}

function validAnchor(
  row: AuthoritativeShareCountHistoryObservation,
  input: { cik: string; securityClassId: string },
  asOf: string,
) {
  return row.issuerCik === input.cik
    && row.canonicalSecurityClassId === input.securityClassId
    && row.canonicalSecurityClassStatus === "mapped"
    && row.canonicalSecurityClassKind === "common_stock"
    && row.authoritativeStatus === "ELIGIBLE"
    && row.authoritativeDecisionVersion === "authoritative-os-extraction-v1"
    && row.observationType === "authoritative_xbrl"
    && row.sourceType === "sec_authoritative_os"
    && row.shareBasisIdentity === "shares_outstanding:xbrli_shares"
    && row.sourceConceptLocalName === "EntityCommonStockSharesOutstanding"
    && row.acceptedAt !== null
    && validTimestamp(row.acceptedAt)
    && row.acceptedAtSource === "sec_filing_ledger"
    && row.acceptedAtProvenance.source === "sec_filing_ledger.accepted_at"
    && row.asOf === asOf
    && POSITIVE_INTEGER_PATTERN.test(row.sharesOutstanding)
    && ACCESSION_PATTERN.test(row.accessionNumber)
    && HEX_64_PATTERN.test(row.sourceFactKey)
    && HEX_64_PATTERN.test(row.sourceContentHash)
    && nonEmpty(row.sourceContextRef)
    && nonEmpty(row.filingDocument)
    && isRecord(row.authoritativeDecisionLineage)
    && isRecord(row.sourceProvenance);
}

function validLevel2Provenance(row: Level2ShareCountHistoryObservation) {
  return row.observationType === "source_stated"
    && row.sourceType === "sec_filing_text_level2"
    && row.canonicalSecurityClassStatus === "mapped"
    && row.canonicalSecurityClassKind === "common_stock"
    && row.acceptedAt !== null
    && validTimestamp(row.acceptedAt)
    && row.acceptedAtSource === "sec_raw_payload_acceptance"
    && row.acceptedAtProvenance.source === "raw_items.raw_payload.accepted_at"
    && POSITIVE_INTEGER_PATTERN.test(row.sharesOutstanding)
    && ACCESSION_PATTERN.test(row.accessionNumber)
    && HEX_64_PATTERN.test(row.sourceFactKey)
    && HEX_64_PATTERN.test(row.sourceContentHash)
    && nonEmpty(row.sourceContextRef)
    && nonEmpty(row.sourceEvidence)
    && nonEmpty(row.sourceAnalyzer)
    && isRecord(row.sourceProvenance);
}

function findSameDateConflict(rows: ShareCountHistoryObservation[]) {
  for (const group of groupByAsOf(rows)) {
    const result = conflictForRows(group);
    if (result) return result;
  }
  return null;
}

function conflictForRows(rows: ShareCountHistoryObservation[]): ShareCountReconciliationConflict | null {
  const values = [...new Set(rows.map((row) => row.sharesOutstanding))].sort(compareIntegerStrings);
  return values.length > 1 ? {
    kind: "SAME_DATE_DIFFERENT_SHARES",
    asOf: rows[0]!.asOf,
    sharesOutstandingValues: values,
    observations: structuredClone(rows).sort(compareObservationIdentity),
  } : null;
}

function groupByAsOf<Row extends ShareCountHistoryObservation>(rows: Row[]) {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const group = groups.get(row.asOf) ?? [];
    group.push(row);
    groups.set(row.asOf, group);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, group]) => group.sort(compareObservationIdentity));
}

function subtractExact(left: ExactShareCount, right: ExactShareCount): ExactSignedRational {
  return reduceSigned(
    BigInt(left.numerator) * BigInt(right.denominator) - BigInt(right.numerator) * BigInt(left.denominator),
    BigInt(left.denominator) * BigInt(right.denominator),
  );
}

function percentageOf(change: ExactSignedRational, baseline: ExactShareCount): ExactSignedRational {
  return reduceSigned(
    BigInt(change.numerator) * BigInt(baseline.denominator) * BigInt(100),
    BigInt(change.denominator) * BigInt(baseline.numerator),
  );
}

function exactPositiveInteger(value: string): ExactShareCount {
  if (!POSITIVE_INTEGER_PATTERN.test(value)) throw new Error("anchor shares must be a positive integer");
  return { numerator: value, denominator: "1" };
}

function reduceSigned(numerator: bigint, denominator: bigint): ExactSignedRational {
  if (denominator <= BigInt(0)) throw new Error("exact denominator must be positive");
  if (numerator === BigInt(0)) return { numerator: "0", denominator: "1" };
  const divisor = greatestCommonDivisor(numerator < BigInt(0) ? -numerator : numerator, denominator);
  return { numerator: (numerator / divisor).toString(), denominator: (denominator / divisor).toString() };
}

function greatestCommonDivisor(leftValue: bigint, rightValue: bigint) {
  let left = leftValue;
  let right = rightValue;
  while (right !== BigInt(0)) {
    const remainder = left % right;
    left = right;
    right = remainder;
  }
  return left;
}

function unavailable(
  input: { cik: string; securityClassId: string; startAnchor: { asOf: string }; endAnchor: { asOf: string } },
  basisTargetAt: string,
  reason: ShareCountAnchorReconciliationUnavailable["reason"],
  startAnchor: ShareCountAnchorSelection | null = null,
  endAnchor: ShareCountAnchorSelection | null = null,
  normalizationFailures: StockSplitShareBasisNormalization[] = [],
): ShareCountAnchorReconciliationUnavailable {
  return {
    ...baseResult(input, basisTargetAt, startAnchor, endAnchor),
    status: "RECONCILIATION_UNAVAILABLE",
    reason,
    normalizedStartShares: null,
    endShares: null,
    netChangeShares: null,
    netChangePct: null,
    intermediateObservations: [],
    appliedStockSplitExecutions: [],
    appliedReverseSplitExecutions: [],
    normalizationFailures: structuredClone(normalizationFailures),
    conflicts: [],
    provenance: provenance(startAnchor, endAnchor, []),
  };
}

function conflictResult(
  input: { cik: string; securityClassId: string; startAnchor: { asOf: string }; endAnchor: { asOf: string } },
  basisTargetAt: string,
  reason: ShareCountAnchorReconciliationConflictResult["reason"],
  conflict: ShareCountReconciliationConflict,
  startAnchor: ShareCountAnchorSelection | null,
  endAnchor: ShareCountAnchorSelection | null,
): ShareCountAnchorReconciliationConflictResult {
  return {
    ...baseResult(input, basisTargetAt, startAnchor, endAnchor),
    status: "CONFLICT",
    reason,
    normalizedStartShares: null,
    endShares: null,
    netChangeShares: null,
    netChangePct: null,
    intermediateObservations: [],
    appliedStockSplitExecutions: [],
    appliedReverseSplitExecutions: [],
    normalizationFailures: [],
    conflicts: [structuredClone(conflict)],
    provenance: provenance(startAnchor, endAnchor, []),
  };
}

function baseResult(
  input: { cik: string; securityClassId: string; startAnchor: { asOf: string }; endAnchor: { asOf: string } },
  basisTargetAt: string,
  startAnchor: ShareCountAnchorSelection | null,
  endAnchor: ShareCountAnchorSelection | null,
) {
  return {
    reconciliationVersion: SHARE_COUNT_ANCHOR_RECONCILIATION_VERSION,
    view: "RECONCILED_HINDSIGHT" as const,
    cik: input.cik,
    securityClassId: input.securityClassId,
    interval: { startAsOf: input.startAnchor.asOf, endAsOf: input.endAnchor.asOf },
    basisTargetAt,
    coverage: SHARE_COUNT_ANCHOR_RECONCILIATION_COVERAGE,
    startAnchor,
    endAnchor,
  };
}

function provenance(
  startAnchor: ShareCountAnchorSelection | null,
  endAnchor: ShareCountAnchorSelection | null,
  intermediates: ShareCountHistoryObservation[],
) {
  return {
    historySource: "share_count_history" as const,
    startAnchorSourceIdentities: sourceIdentities(startAnchor?.authoritativeObservations ?? []),
    endAnchorSourceIdentities: sourceIdentities(endAnchor?.authoritativeObservations ?? []),
    intermediateSourceIdentities: sourceIdentities(intermediates),
  };
}

function sourceIdentities(rows: ShareCountHistoryObservation[]) {
  return rows.map(sourceIdentity).sort();
}

function reverseExecutions(executions: AppliedStockSplitExecution[]): AppliedReverseSplitExecution[] {
  return structuredClone(executions.filter((execution) => execution.kind === "reverse_split")
    .map(({ kind: _kind, ...execution }) => execution));
}

function sourceIdentity(row: ShareCountHistoryObservation) {
  return [row.sourceType, row.issuerCik, row.accessionNumber, row.filingDocument,
    row.sourceContentHash, row.sourceFactKey, row.sourceContextRef].join("|");
}

function compareObservationIdentity(left: ShareCountHistoryObservation, right: ShareCountHistoryObservation) {
  return sourceIdentity(left).localeCompare(sourceIdentity(right)) || (left.id ?? "").localeCompare(right.id ?? "");
}

function compareIntegerStrings(left: string, right: string) {
  return left.length - right.length || left.localeCompare(right);
}

function wholeDays(start: string, end: string) {
  return Math.floor((new Date(`${end}T00:00:00.000Z`).valueOf()
    - new Date(`${start}T00:00:00.000Z`).valueOf()) / DAY_MS);
}

function validateInput(input: {
  cik: string;
  securityClassId: string;
  startAnchor: { asOf: string };
  endAnchor: { asOf: string };
  executionKnownAt?: string;
}) {
  if (!CIK_PATTERN.test(input.cik) || input.cik === "0000000000") throw new Error("invalid CIK");
  if (!CANONICAL_SECURITY_CLASS_ID_PATTERN.test(input.securityClassId)
    || !input.securityClassId.startsWith(`sc:v1:${input.cik}:common_stock:`)) {
    throw new Error("securityClassId must be an exact issuer-scoped canonical identity");
  }
  if (!validDate(input.startAnchor.asOf) || !validDate(input.endAnchor.asOf)
    || input.startAnchor.asOf >= input.endAnchor.asOf) {
    throw new Error("anchor asOf dates must be valid and strictly increasing");
  }
  if (input.executionKnownAt !== undefined && !validTimestamp(input.executionKnownAt)) {
    throw new Error("executionKnownAt must be a valid timestamp");
  }
}

function validDate(value: string) {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function validTimestamp(value: string) {
  return TIMESTAMP_PATTERN.test(value) && !Number.isNaN(new Date(value).valueOf());
}

function nonEmpty(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const PERIODIC_FORMS = new Set(["10-Q", "10-Q/A", "10-K", "10-K/A", "20-F", "20-F/A", "40-F", "40-F/A"]);
const DAY_MS = 24 * 60 * 60 * 1_000;
const CIK_PATTERN = /^[0-9]{10}$/;
const CANONICAL_SECURITY_CLASS_ID_PATTERN = /^sc:v1:[0-9]{10}:common_stock:(?:single|us-gaap:[A-Za-z][A-Za-z0-9_.-]{1,127}|custom:[0-9a-f]{64}:[A-Za-z][A-Za-z0-9_.-]{1,127})$/;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;
const DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const TIMESTAMP_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$/;
const ACCESSION_PATTERN = /^[0-9]{10}-[0-9]{2}-[0-9]{6}$/;
const HEX_64_PATTERN = /^[0-9a-f]{64}$/;
