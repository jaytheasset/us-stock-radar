import {
  resolveClassShareCountAt,
  type ClassShareCountResolution,
  type ClassShareCountResolved,
} from "./classShareCountResolver.ts";
import type { ShareCountHistoryRepository } from "./shareCountHistory.ts";
import {
  readStockSplitExecutions,
  stockSplitExecutionActivationDecision,
  stockSplitExecutionId,
  type ReverseSplitExecutionActivationDecision,
  type ReverseSplitExecutionConflict,
  type StockSplitExecution,
  type StockSplitExecutionObservation,
  type StockSplitExecutionReadResult,
} from "../monitor/reverseSplitExecution.ts";

export const STOCK_SPLIT_SHARE_BASIS_NORMALIZER_VERSION =
  "stock-split-share-basis-normalization-v2" as const;

export type StockSplitActionKind = "forward_split" | "reverse_split";
type StockSplitExecutionConflict = ReverseSplitExecutionConflict<StockSplitExecution["version"]>;

export type ExactShareCount = {
  numerator: string;
  denominator: string;
};

export type AppliedStockSplitExecution = {
  kind: StockSplitActionKind;
  executionId: string;
  effectiveDate: string;
  exactRatio: {
    oldShareUnits: string;
    newShareUnits: string;
  };
  activation: Extract<ReverseSplitExecutionActivationDecision, { status: "APPLIED" }>;
  observations: StockSplitExecutionObservation[];
};

type StockSplitShareBasisNormalizationBase = {
  normalizerVersion: typeof STOCK_SPLIT_SHARE_BASIS_NORMALIZER_VERSION;
  cik: string;
  securityClassId: string;
  targetAt: string;
  targetDate: string;
  coverage: "stock_split_basis_normalization";
  unsupportedBasisChanges: readonly [
    "stock_dividend",
    "recapitalization",
    "ads_ratio_change",
    "other_non_split_basis_change",
  ];
  originalShares: string | null;
  originalAsOf: string | null;
  originalResolution: ClassShareCountResolution;
  normalizedExactShares: ExactShareCount | null;
  normalizedIntegerShares: string | null;
  appliedExecutionIds: string[];
  appliedExecutions: AppliedStockSplitExecution[];
  executionConflicts: StockSplitExecutionConflict[];
};

export type StockSplitShareBasisNormalized = StockSplitShareBasisNormalizationBase & {
  status: "NORMALIZED";
  originalShares: string;
  originalAsOf: string;
  originalResolution: ClassShareCountResolved;
  normalizedExactShares: ExactShareCount;
  reason: "NO_APPLICABLE_STOCK_SPLIT_EXECUTION" | "STOCK_SPLIT_EXECUTIONS_APPLIED";
};

export type StockSplitShareBasisNormalizationUnavailable = StockSplitShareBasisNormalizationBase & {
  status: "NORMALIZATION_UNAVAILABLE";
  normalizedExactShares: null;
  normalizedIntegerShares: null;
  reason:
    | "SHARE_COUNT_UNAVAILABLE"
    | "SHARE_COUNT_CONFLICT"
    | "EXECUTION_READ_FAILED"
    | "EXECUTION_READER_INVALID"
    | "EXECUTION_CONFLICT"
    | "EXECUTION_TIMING_INDETERMINATE"
    | "EXECUTION_RATIO_INVALID"
    | "EXECUTION_PROVENANCE_INVALID";
};

export type StockSplitShareBasisNormalization =
  | StockSplitShareBasisNormalized
  | StockSplitShareBasisNormalizationUnavailable;

export type StockSplitExecutionReadInput = {
  actionKind: StockSplitActionKind;
  cik: string;
  canonicalSecurityClassId?: string;
  from: string;
  to: string;
  targetAt: string;
};

export type StockSplitShareBasisNormalizerDependencies = {
  resolveShareCount?: typeof resolveClassShareCountAt;
  readExecutions?: (input: StockSplitExecutionReadInput) => Promise<StockSplitExecutionReadResult>;
};

const UNSUPPORTED_BASIS_CHANGES = [
  "stock_dividend",
  "recapitalization",
  "ads_ratio_change",
  "other_non_split_basis_change",
] as const;

export async function normalizeClassShareCountForStockSplitsAt(
  input: {
    repository: ShareCountHistoryRepository;
    cik: string;
    securityClassId: string;
    targetAt: string;
  },
  dependencies: StockSplitShareBasisNormalizerDependencies = {},
): Promise<StockSplitShareBasisNormalization> {
  const resolveShareCount = dependencies.resolveShareCount ?? resolveClassShareCountAt;
  const readExecutions = dependencies.readExecutions ?? readStockSplitExecutions;
  const resolution = await resolveShareCount(input);
  const targetAt = resolution.targetAt;
  const targetDate = targetAt.slice(0, 10);

  if (resolution.status !== "RESOLVED") {
    return unavailable(input, targetAt, targetDate, resolution,
      resolution.status === "CONFLICT" ? "SHARE_COUNT_CONFLICT" : "SHARE_COUNT_UNAVAILABLE");
  }

  const firstExecutionDate = nextDate(resolution.asOf);
  if (firstExecutionDate > targetDate) {
    return normalized(resolution, targetDate, exactInteger(resolution.sharesOutstanding), []);
  }

  let reads: StockSplitExecutionReadResult[];
  try {
    reads = await Promise.all((["forward_split", "reverse_split"] as const).map((actionKind) =>
      readExecutions({
        actionKind,
        cik: input.cik,
        canonicalSecurityClassId: input.securityClassId,
        from: firstExecutionDate,
        to: targetDate,
        targetAt,
      })));
  } catch {
    return unavailable(input, targetAt, targetDate, resolution, "EXECUTION_READ_FAILED");
  }

  const kinds = ["forward_split", "reverse_split"] as const;
  if (reads.some((read, index) => !validExecutionRead(
    read, kinds[index]!, input, firstExecutionDate, targetDate, targetAt,
  ))) {
    return unavailable(input, targetAt, targetDate, resolution, "EXECUTION_READER_INVALID");
  }
  const conflicts: StockSplitExecutionConflict[] = [];
  for (const read of reads) conflicts.push(...read.conflicts as StockSplitExecutionConflict[]);
  if (conflicts.length > 0) {
    return unavailable(input, targetAt, targetDate, resolution, "EXECUTION_CONFLICT", conflicts);
  }

  const candidates = reads.flatMap((read, index) => read.executions.map((execution) => ({
    kind: kinds[index]!,
    execution,
  }))).filter(({ execution }) =>
    execution.issuerCik === input.cik
    && execution.canonicalSecurityClassId === input.securityClassId
    && execution.effectiveDate > resolution.asOf)
    .sort((left, right) => left.execution.effectiveDate.localeCompare(right.execution.effectiveDate)
      || left.execution.executionId.localeCompare(right.execution.executionId));

  let exactShares = exactInteger(resolution.sharesOutstanding);
  const applied: AppliedStockSplitExecution[] = [];
  for (const { kind, execution } of candidates) {
    const activation = stockSplitExecutionActivationDecision({ execution, targetDate, targetAt });
    if (activation.status === "NOT_APPLIED") continue;
    if (activation.status === "INDETERMINATE") {
      return unavailable(input, targetAt, targetDate, resolution, "EXECUTION_TIMING_INDETERMINATE");
    }
    const ratio = exactExecutionRatio(execution, kind);
    if (!ratio) return unavailable(input, targetAt, targetDate, resolution, "EXECUTION_RATIO_INVALID");
    if (!validExecutionProvenance(execution, kind)) {
      return unavailable(input, targetAt, targetDate, resolution, "EXECUTION_PROVENANCE_INVALID");
    }
    exactShares = multiplyAndReduce(exactShares, ratio.newShares, ratio.oldShares);
    applied.push({
      kind,
      executionId: execution.executionId,
      effectiveDate: execution.effectiveDate,
      exactRatio: { ...execution.exactRatio },
      activation,
      observations: structuredClone(execution.observations),
    });
  }
  return normalized(resolution, targetDate, exactShares, applied);
}

function normalized(
  resolution: ClassShareCountResolved,
  targetDate: string,
  exactShares: ExactShareCount,
  applied: AppliedStockSplitExecution[],
): StockSplitShareBasisNormalized {
  return {
    ...base(resolution.cik, resolution.securityClassId, resolution.targetAt, targetDate),
    status: "NORMALIZED",
    originalShares: resolution.sharesOutstanding,
    originalAsOf: resolution.asOf,
    originalResolution: structuredClone(resolution),
    normalizedExactShares: exactShares,
    normalizedIntegerShares: exactShares.denominator === "1" ? exactShares.numerator : null,
    appliedExecutionIds: applied.map((item) => item.executionId),
    appliedExecutions: applied,
    executionConflicts: [],
    reason: applied.length ? "STOCK_SPLIT_EXECUTIONS_APPLIED" : "NO_APPLICABLE_STOCK_SPLIT_EXECUTION",
  };
}

function unavailable(
  input: { cik: string; securityClassId: string },
  targetAt: string,
  targetDate: string,
  resolution: ClassShareCountResolution,
  reason: StockSplitShareBasisNormalizationUnavailable["reason"],
  conflicts: StockSplitExecutionConflict[] = [],
): StockSplitShareBasisNormalizationUnavailable {
  return {
    ...base(input.cik, input.securityClassId, targetAt, targetDate),
    status: "NORMALIZATION_UNAVAILABLE",
    originalShares: resolution.status === "RESOLVED" ? resolution.sharesOutstanding : null,
    originalAsOf: resolution.asOf,
    originalResolution: structuredClone(resolution),
    normalizedExactShares: null,
    normalizedIntegerShares: null,
    appliedExecutionIds: [],
    appliedExecutions: [],
    executionConflicts: structuredClone(conflicts),
    reason,
  };
}

function base(cik: string, securityClassId: string, targetAt: string, targetDate: string) {
  return {
    normalizerVersion: STOCK_SPLIT_SHARE_BASIS_NORMALIZER_VERSION,
    cik,
    securityClassId,
    targetAt,
    targetDate,
    coverage: "stock_split_basis_normalization" as const,
    unsupportedBasisChanges: UNSUPPORTED_BASIS_CHANGES,
  };
}

function validExecutionRead(
  value: StockSplitExecutionReadResult | null | undefined,
  kind: StockSplitActionKind,
  input: { cik: string; securityClassId: string },
  from: string,
  to: string,
  targetAt: string,
) {
  return value !== null && typeof value === "object" && value.status === "available"
    && value.issuerCik === input.cik && value.canonicalSecurityClassId === input.securityClassId
    && value.from === from && value.to === to && value.targetAt === targetAt
    && value.basisChangeCoverage === (kind === "forward_split" ? "forward_split_only" : "reverse_split_only")
    && Array.isArray(value.executions) && Array.isArray(value.inactiveExecutions)
    && Array.isArray(value.conflicts);
}

function exactExecutionRatio(execution: StockSplitExecution, kind: StockSplitActionKind) {
  const oldShares = parsePositiveDecimal(execution.exactRatio.oldShareUnits);
  const newShares = parsePositiveDecimal(execution.exactRatio.newShareUnits);
  if (!oldShares || !newShares) return null;
  try {
    const expectedId = stockSplitExecutionId({
      actionKind: kind,
      issuerCik: execution.issuerCik,
      canonicalSecurityClassId: execution.canonicalSecurityClassId,
      effectiveDate: execution.effectiveDate,
      oldShareUnits: execution.exactRatio.oldShareUnits,
      newShareUnits: execution.exactRatio.newShareUnits,
    });
    return expectedId === execution.executionId ? { oldShares, newShares } : null;
  } catch {
    return null;
  }
}

function validExecutionProvenance(execution: StockSplitExecution, kind: StockSplitActionKind) {
  const expectedVersion = kind === "forward_split" ? "forward_split_execution_v1" : "reverse_split_execution_v1";
  return execution.version === expectedVersion
    && execution.observations.length > 0 && execution.observations.every((observation) =>
    observation.issuerCik === execution.issuerCik
    && observation.canonicalSecurityClassId === execution.canonicalSecurityClassId
    && observation.effectiveDate === execution.effectiveDate
    && observation.exactRatio.oldShareUnits === execution.exactRatio.oldShareUnits
    && observation.exactRatio.newShareUnits === execution.exactRatio.newShareUnits
    && ACCESSION_PATTERN.test(observation.accessionNumber)
    && validTimestamp(observation.acceptedAt)
    && observation.source.source_family === "sec"
    && observation.source.source_id === observation.accessionNumber
    && observation.sourceRef.trim().length > 0
    && observation.evidence.availability === "available"
    && observation.evidence.value.trim().length > 0);
}

function exactInteger(value: string): ExactShareCount {
  if (!POSITIVE_INTEGER_PATTERN.test(value)) throw new Error("Resolved share count must be a positive integer");
  return { numerator: value, denominator: "1" };
}

function parsePositiveDecimal(value: string): ExactShareCount | null {
  if (!POSITIVE_DECIMAL_PATTERN.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const denominator = BigInt(10) ** BigInt(fraction.length);
  const numerator = BigInt(`${whole}${fraction}`);
  return numerator > BigInt(0) ? reduce({ numerator, denominator }) : null;
}

function multiplyAndReduce(current: ExactShareCount, next: ExactShareCount, previous: ExactShareCount) {
  return reduce({
    numerator: BigInt(current.numerator) * BigInt(next.numerator) * BigInt(previous.denominator),
    denominator: BigInt(current.denominator) * BigInt(next.denominator) * BigInt(previous.numerator),
  });
}

function reduce(value: { numerator: bigint; denominator: bigint }): ExactShareCount {
  if (value.numerator <= BigInt(0) || value.denominator <= BigInt(0)) {
    throw new Error("Exact share fraction must be positive");
  }
  const divisor = greatestCommonDivisor(value.numerator, value.denominator);
  return { numerator: (value.numerator / divisor).toString(), denominator: (value.denominator / divisor).toString() };
}

function greatestCommonDivisor(leftValue: bigint, rightValue: bigint) {
  let left = leftValue;
  let right = rightValue;
  while (right !== BigInt(0)) [left, right] = [right, left % right];
  return left;
}

function nextDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function validTimestamp(value: string) {
  return TIMESTAMP_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;
const POSITIVE_DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const ACCESSION_PATTERN = /^[0-9]{10}-[0-9]{2}-[0-9]{6}$/;
const TIMESTAMP_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$/;
