import {
  resolveClassShareCountAt,
  type ClassShareCountResolution,
  type ClassShareCountResolved,
} from "./classShareCountResolver.ts";
import type { ShareCountHistoryRepository } from "./shareCountHistory.ts";
import {
  readReverseSplitExecutions,
  reverseSplitExecutionActivationDecision,
  reverseSplitExecutionId,
  type ReverseSplitExecution,
  type ReverseSplitExecutionActivationDecision,
  type ReverseSplitExecutionConflict,
  type ReverseSplitExecutionObservation,
  type ReverseSplitExecutionReadResult,
} from "../monitor/reverseSplitExecution.ts";

export const REVERSE_SPLIT_SHARE_BASIS_NORMALIZER_VERSION =
  "reverse-split-share-basis-normalization-v1" as const;

export type ExactShareCount = {
  numerator: string;
  denominator: string;
};

export type AppliedReverseSplitExecution = {
  executionId: string;
  effectiveDate: string;
  exactRatio: {
    oldShareUnits: string;
    newShareUnits: string;
  };
  activation: Extract<ReverseSplitExecutionActivationDecision, { status: "APPLIED" }>;
  observations: ReverseSplitExecutionObservation[];
};

type ReverseSplitShareBasisNormalizationBase = {
  normalizerVersion: typeof REVERSE_SPLIT_SHARE_BASIS_NORMALIZER_VERSION;
  cik: string;
  securityClassId: string;
  targetAt: string;
  targetDate: string;
  coverage: "reverse_split_only";
  originalShares: string | null;
  originalAsOf: string | null;
  originalResolution: ClassShareCountResolution;
  normalizedExactShares: ExactShareCount | null;
  normalizedIntegerShares: string | null;
  appliedExecutionIds: string[];
  appliedExecutions: AppliedReverseSplitExecution[];
  executionConflicts: ReverseSplitExecutionConflict[];
};

export type ReverseSplitShareBasisNormalized = ReverseSplitShareBasisNormalizationBase & {
  status: "NORMALIZED";
  originalShares: string;
  originalAsOf: string;
  originalResolution: ClassShareCountResolved;
  normalizedExactShares: ExactShareCount;
  reason: "NO_APPLICABLE_REVERSE_SPLIT_EXECUTION" | "REVERSE_SPLIT_EXECUTIONS_APPLIED";
};

export type ReverseSplitShareBasisNormalizationUnavailable =
  ReverseSplitShareBasisNormalizationBase & {
    status: "NORMALIZATION_UNAVAILABLE";
    normalizedExactShares: null;
    normalizedIntegerShares: null;
    reason:
      | "SHARE_COUNT_UNAVAILABLE"
      | "SHARE_COUNT_CONFLICT"
      | "EXECUTION_READ_FAILED"
      | "SPLIT_MATERIALIZATION_FAILED"
      | "EXECUTION_READER_INVALID"
      | "EXECUTION_CONFLICT"
      | "EXECUTION_TIMING_INDETERMINATE"
      | "EXECUTION_RATIO_INVALID"
      | "EXECUTION_PROVENANCE_INVALID";
  };

export type ReverseSplitShareBasisNormalization =
  | ReverseSplitShareBasisNormalized
  | ReverseSplitShareBasisNormalizationUnavailable;

type ReverseSplitExecutionReadInput = {
  cik: string;
  canonicalSecurityClassId?: string;
  from: string;
  to: string;
  targetAt: string;
};

export type ReverseSplitShareBasisNormalizerDependencies = {
  resolveShareCount?: typeof resolveClassShareCountAt;
  readExecutions?: (input: ReverseSplitExecutionReadInput) => Promise<ReverseSplitExecutionReadResult>;
};

export async function normalizeClassShareCountAt(
  input: {
    repository: ShareCountHistoryRepository;
    cik: string;
    securityClassId: string;
    targetAt: string;
  },
  dependencies: ReverseSplitShareBasisNormalizerDependencies = {},
): Promise<ReverseSplitShareBasisNormalization> {
  const resolveShareCount = dependencies.resolveShareCount ?? resolveClassShareCountAt;
  const readExecutions = dependencies.readExecutions ?? ((filter) => readReverseSplitExecutions(filter));
  const resolution = await resolveShareCount(input);
  const targetAt = resolution.targetAt;
  const targetDate = targetAt.slice(0, 10);

  if (resolution.status !== "RESOLVED") {
    return unavailable({
      input,
      targetAt,
      targetDate,
      resolution,
      reason: resolution.status === "CONFLICT" ? "SHARE_COUNT_CONFLICT" : "SHARE_COUNT_UNAVAILABLE",
    });
  }

  // An after-market-close execution is still ahead of an observation on the
  // same calendar date, so include that date in the execution projection.
  const firstExecutionDate = resolution.asOf;
  if (firstExecutionDate > targetDate) {
    return normalized(resolution, targetDate, exactInteger(resolution.sharesOutstanding), []);
  }

  let executionRead: ReverseSplitExecutionReadResult;
  try {
    executionRead = await readExecutions({
      cik: input.cik,
      canonicalSecurityClassId: input.securityClassId,
      from: firstExecutionDate,
      to: targetDate,
      targetAt,
    });
  } catch {
    return unavailable({ input, targetAt, targetDate, resolution, reason: "EXECUTION_READ_FAILED" });
  }
  if (executionRead && executionRead.status === "materialization_unavailable"
    && executionRead.materializationStatus === "SPLIT_MATERIALIZATION_FAILED"
    && executionRead.issuerCik === input.cik
    && executionRead.canonicalSecurityClassId === input.securityClassId
    && executionRead.from === firstExecutionDate && executionRead.to === targetDate
    && executionRead.targetAt === targetAt
    && executionRead.basisChangeCoverage === "reverse_split_only") {
    return unavailable({ input, targetAt, targetDate, resolution, reason: "SPLIT_MATERIALIZATION_FAILED" });
  }
  if (!validExecutionRead(executionRead, input, firstExecutionDate, targetDate, targetAt)) {
    return unavailable({ input, targetAt, targetDate, resolution, reason: "EXECUTION_READER_INVALID" });
  }
  if (executionRead.conflicts.length > 0) {
    return unavailable({
      input,
      targetAt,
      targetDate,
      resolution,
      reason: "EXECUTION_CONFLICT",
      executionConflicts: executionRead.conflicts,
    });
  }

  const uniqueExecutions = new Map<string, ReverseSplitExecution>();
  for (const execution of executionRead.executions) {
    if (execution.issuerCik !== input.cik
      || execution.canonicalSecurityClassId !== input.securityClassId
      || execution.effectiveDate < resolution.asOf) continue;
    if (!uniqueExecutions.has(execution.executionId)) uniqueExecutions.set(execution.executionId, execution);
  }
  const candidates = [...uniqueExecutions.values()].sort((left, right) =>
    left.effectiveDate.localeCompare(right.effectiveDate)
      || left.executionId.localeCompare(right.executionId));

  let exactShares = exactInteger(resolution.sharesOutstanding);
  const applied: AppliedReverseSplitExecution[] = [];
  for (const execution of candidates) {
    if (execution.effectiveDate === resolution.asOf) {
      const observationBasis = reverseSplitExecutionActivationDecision({
        execution,
        targetDate: resolution.asOf,
      });
      if (observationBasis.status === "INDETERMINATE") {
        return unavailable({
          input,
          targetAt,
          targetDate,
          resolution,
          reason: "EXECUTION_TIMING_INDETERMINATE",
        });
      }
      if (observationBasis.status === "APPLIED") continue;
    }
    const activation = reverseSplitExecutionActivationDecision({ execution, targetDate, targetAt });
    if (activation.status === "NOT_APPLIED") continue;
    if (activation.status === "INDETERMINATE") {
      return unavailable({ input, targetAt, targetDate, resolution, reason: "EXECUTION_TIMING_INDETERMINATE" });
    }
    const ratio = exactExecutionRatio(execution);
    if (!ratio) {
      return unavailable({ input, targetAt, targetDate, resolution, reason: "EXECUTION_RATIO_INVALID" });
    }
    if (!validExecutionProvenance(execution)) {
      return unavailable({ input, targetAt, targetDate, resolution, reason: "EXECUTION_PROVENANCE_INVALID" });
    }
    exactShares = multiplyAndReduce(exactShares, ratio.newShares, ratio.oldShares);
    applied.push({
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
  applied: AppliedReverseSplitExecution[],
): ReverseSplitShareBasisNormalized {
  return {
    normalizerVersion: REVERSE_SPLIT_SHARE_BASIS_NORMALIZER_VERSION,
    status: "NORMALIZED",
    cik: resolution.cik,
    securityClassId: resolution.securityClassId,
    targetAt: resolution.targetAt,
    targetDate,
    coverage: "reverse_split_only",
    originalShares: resolution.sharesOutstanding,
    originalAsOf: resolution.asOf,
    originalResolution: structuredClone(resolution),
    normalizedExactShares: exactShares,
    normalizedIntegerShares: exactShares.denominator === "1" ? exactShares.numerator : null,
    appliedExecutionIds: applied.map((item) => item.executionId),
    appliedExecutions: applied,
    executionConflicts: [],
    reason: applied.length
      ? "REVERSE_SPLIT_EXECUTIONS_APPLIED"
      : "NO_APPLICABLE_REVERSE_SPLIT_EXECUTION",
  };
}

function unavailable(input: {
  input: { cik: string; securityClassId: string };
  targetAt: string;
  targetDate: string;
  resolution: ClassShareCountResolution;
  reason: ReverseSplitShareBasisNormalizationUnavailable["reason"];
  executionConflicts?: ReverseSplitExecutionConflict[];
}): ReverseSplitShareBasisNormalizationUnavailable {
  return {
    normalizerVersion: REVERSE_SPLIT_SHARE_BASIS_NORMALIZER_VERSION,
    status: "NORMALIZATION_UNAVAILABLE",
    cik: input.input.cik,
    securityClassId: input.input.securityClassId,
    targetAt: input.targetAt,
    targetDate: input.targetDate,
    coverage: "reverse_split_only",
    originalShares: input.resolution.status === "RESOLVED" ? input.resolution.sharesOutstanding : null,
    originalAsOf: input.resolution.asOf,
    originalResolution: structuredClone(input.resolution),
    normalizedExactShares: null,
    normalizedIntegerShares: null,
    appliedExecutionIds: [],
    appliedExecutions: [],
    executionConflicts: structuredClone(input.executionConflicts ?? []),
    reason: input.reason,
  };
}

function validExecutionRead(
  value: ReverseSplitExecutionReadResult | null | undefined,
  input: { cik: string; securityClassId: string },
  from: string,
  to: string,
  targetAt: string,
) {
  return value !== null
    && typeof value === "object"
    && value.status === "available"
    && value.issuerCik === input.cik
    && value.canonicalSecurityClassId === input.securityClassId
    && value.from === from
    && value.to === to
    && value.targetAt === targetAt
    && value.basisChangeCoverage === "reverse_split_only"
    && Array.isArray(value.executions)
    && Array.isArray(value.inactiveExecutions)
    && Array.isArray(value.conflicts);
}

function exactExecutionRatio(execution: ReverseSplitExecution) {
  const oldShares = parsePositiveDecimal(execution.exactRatio.oldShareUnits);
  const newShares = parsePositiveDecimal(execution.exactRatio.newShareUnits);
  if (!oldShares || !newShares) return null;
  let expectedId: string;
  try {
    expectedId = reverseSplitExecutionId({
      issuerCik: execution.issuerCik,
      canonicalSecurityClassId: execution.canonicalSecurityClassId,
      effectiveDate: execution.effectiveDate,
      oldShareUnits: execution.exactRatio.oldShareUnits,
      newShareUnits: execution.exactRatio.newShareUnits,
    });
  } catch {
    return null;
  }
  return expectedId === execution.executionId ? { oldShares, newShares } : null;
}

function validExecutionProvenance(execution: ReverseSplitExecution) {
  return execution.observations.length > 0 && execution.observations.every((observation) =>
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
  if (numerator <= BigInt(0)) return null;
  return reduce({ numerator, denominator });
}

function multiplyAndReduce(
  current: ExactShareCount,
  newShares: ExactShareCount,
  oldShares: ExactShareCount,
): ExactShareCount {
  return reduce({
    numerator: BigInt(current.numerator) * BigInt(newShares.numerator) * BigInt(oldShares.denominator),
    denominator: BigInt(current.denominator) * BigInt(newShares.denominator) * BigInt(oldShares.numerator),
  });
}

function reduce(value: { numerator: bigint; denominator: bigint }): ExactShareCount {
  if (value.numerator <= BigInt(0) || value.denominator <= BigInt(0)) {
    throw new Error("Exact share fraction must be positive");
  }
  const divisor = greatestCommonDivisor(value.numerator, value.denominator);
  return {
    numerator: (value.numerator / divisor).toString(),
    denominator: (value.denominator / divisor).toString(),
  };
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

function validTimestamp(value: string) {
  return TIMESTAMP_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;
const POSITIVE_DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const ACCESSION_PATTERN = /^[0-9]{10}-[0-9]{2}-[0-9]{6}$/;
const TIMESTAMP_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$/;
