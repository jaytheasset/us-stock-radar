import {
  readIssuerCommonClassUniverseAt,
  type IssuerCommonClassUniverseAt,
  type IssuerCommonClassUniverseAvailable,
  type IssuerCommonClassUniverseRepository,
} from "./issuerCommonClassUniverse.ts";
import {
  resolveClassShareCountAt,
  type ClassShareCountResolution,
} from "./classShareCountResolver.ts";
import {
  normalizeClassShareCountForStockSplitsAt,
  type AppliedStockSplitExecution,
  type ExactShareCount,
  type StockSplitShareBasisNormalization,
  type StockSplitShareBasisNormalizerDependencies,
} from "./stockSplitShareBasisNormalizer.ts";
import type { AppliedReverseSplitExecution } from "./reverseSplitShareBasisNormalizer.ts";
import type {
  ShareCountHistoryObservation,
  ShareCountHistoryRepository,
} from "./shareCountHistory.ts";

export const ISSUER_TOTAL_COMMON_SHARES_AGGREGATOR_VERSION =
  "issuer-total-common-shares-aggregator-v1" as const;

export const ISSUER_TOTAL_COMMON_SHARES_COVERAGE = [
  "complete_common_class_universe",
  "event_time_observations",
  "stock_split_basis_normalization",
] as const;

export type IssuerTotalCommonSharesCoverage =
  (typeof ISSUER_TOTAL_COMMON_SHARES_COVERAGE)[number];

export type IssuerTotalCommonSharesExact = ExactShareCount & {
  isInteger: boolean;
  integerShares: string | null;
};

export type IssuerTotalCommonSharesClassComponent = {
  status: "RESOLVED" | "UNAVAILABLE";
  reason:
    | "CLASS_RESOLVED_AND_NORMALIZED"
    | "CLASS_RESOLUTION_FAILED"
    | "CLASS_RESOLUTION_UNAVAILABLE"
    | "CLASS_RESOLUTION_CONFLICT"
    | "CLASS_NORMALIZATION_FAILED"
    | "CLASS_NORMALIZATION_UNAVAILABLE"
    | "CLASS_COMPONENT_IDENTITY_MISMATCH";
  securityClassId: string;
  resolvedShares: string | null;
  normalizedShares: ExactShareCount | null;
  normalizedIntegerShares: string | null;
  observationAsOf: string | null;
  acceptedAt: string | null;
  ageDays: number | null;
  resolution: ClassShareCountResolution | null;
  normalization: StockSplitShareBasisNormalization | null;
  appliedStockSplitExecutions: AppliedStockSplitExecution[];
  /** @deprecated Use appliedStockSplitExecutions. */
  appliedReverseSplitExecutions: AppliedReverseSplitExecution[];
  selectedObservation: ShareCountHistoryObservation | null;
  supportingObservations: ShareCountHistoryObservation[];
};

type IssuerTotalCommonSharesBase = {
  aggregatorVersion: typeof ISSUER_TOTAL_COMMON_SHARES_AGGREGATOR_VERSION;
  view: "EVENT_TIME";
  cik: string;
  targetAt: string;
  coverage: readonly IssuerTotalCommonSharesCoverage[];
  universe: IssuerCommonClassUniverseAt | null;
  universeSnapshotIdentity: {
    snapshotId: string | null;
    sourceIdentityHash: string;
    sourceAccession: string;
  } | null;
  universeAsOf: string | null;
  requiredCanonicalSecurityClassIds: string[];
  classComponents: IssuerTotalCommonSharesClassComponent[];
  totalCommonShares: IssuerTotalCommonSharesExact | null;
};

export type IssuerTotalCommonSharesResolved = IssuerTotalCommonSharesBase & {
  status: "RESOLVED";
  reason: "ALL_REQUIRED_COMMON_CLASSES_RESOLVED";
  universe: IssuerCommonClassUniverseAvailable;
  universeSnapshotIdentity: NonNullable<IssuerTotalCommonSharesBase["universeSnapshotIdentity"]>;
  universeAsOf: string;
  totalCommonShares: IssuerTotalCommonSharesExact;
};

export type IssuerTotalCommonSharesUnavailable = IssuerTotalCommonSharesBase & {
  status: "UNAVAILABLE";
  reason:
    | "UNIVERSE_READER_FAILED"
    | "COMMON_CLASS_UNIVERSE_NOT_AVAILABLE"
    | "UNIVERSE_RESULT_INVALID"
    | "INCOMPLETE_CLASS_RESOLUTION"
    | "CLASS_RESOLUTION_CONFLICT"
    | "CLASS_NORMALIZATION_UNAVAILABLE"
    | "CLASS_COMPONENT_INVALID";
  totalCommonShares: null;
};

export type IssuerTotalCommonShares =
  | IssuerTotalCommonSharesResolved
  | IssuerTotalCommonSharesUnavailable;

export type IssuerTotalCommonSharesAggregatorDependencies = {
  readUniverse?: typeof readIssuerCommonClassUniverseAt;
  resolveShareCount?: typeof resolveClassShareCountAt;
  normalizeShareCount?: typeof normalizeClassShareCountForStockSplitsAt;
  readExecutions?: StockSplitShareBasisNormalizerDependencies["readExecutions"];
};

export async function resolveIssuerTotalCommonSharesAt(
  input: {
    universeRepository: IssuerCommonClassUniverseRepository;
    repository: ShareCountHistoryRepository;
    cik: string;
    targetAt: string;
  },
  dependencies: IssuerTotalCommonSharesAggregatorDependencies = {},
): Promise<IssuerTotalCommonShares> {
  validateInput(input.cik, input.targetAt);
  const targetAt = new Date(input.targetAt).toISOString();
  const readUniverse = dependencies.readUniverse ?? readIssuerCommonClassUniverseAt;
  const resolveShareCount = dependencies.resolveShareCount ?? resolveClassShareCountAt;
  const normalizeShareCount = dependencies.normalizeShareCount ?? normalizeClassShareCountForStockSplitsAt;

  let universe: IssuerCommonClassUniverseAt;
  try {
    universe = await readUniverse({
      repository: input.universeRepository,
      shareCountHistoryRepository: input.repository,
      cik: input.cik,
      targetAt,
    });
  } catch {
    return unavailableBase(input.cik, targetAt, "UNIVERSE_READER_FAILED");
  }
  if (universe.status !== "AVAILABLE") {
    return unavailableBase(input.cik, targetAt, "COMMON_CLASS_UNIVERSE_NOT_AVAILABLE", universe);
  }
  if (!validAvailableUniverse(universe, input.cik, targetAt)) {
    return unavailableBase(input.cik, targetAt, "UNIVERSE_RESULT_INVALID", universe);
  }

  const requiredIds = [...universe.requiredCanonicalSecurityClassIds].sort();
  const classComponents: IssuerTotalCommonSharesClassComponent[] = [];
  for (const securityClassId of requiredIds) {
    classComponents.push(await resolveClassComponent({
      repository: input.repository,
      cik: input.cik,
      securityClassId,
      targetAt,
      resolveShareCount,
      normalizeShareCount,
      readExecutions: dependencies.readExecutions,
    }));
  }

  const componentFailure = classifyComponentFailure(classComponents);
  if (componentFailure) {
    return unavailableFromUniverse(universe, classComponents, componentFailure);
  }

  let total: ExactShareCount = { numerator: "0", denominator: "1" };
  for (const component of classComponents) {
    total = addExact(total, component.normalizedShares!);
  }
  if (BigInt(total.numerator) <= BigInt(0)) {
    return unavailableFromUniverse(universe, classComponents, "CLASS_COMPONENT_INVALID");
  }

  return {
    ...baseFromUniverse(universe, classComponents),
    status: "RESOLVED",
    reason: "ALL_REQUIRED_COMMON_CLASSES_RESOLVED",
    totalCommonShares: presentExact(total),
  };
}

async function resolveClassComponent(input: {
  repository: ShareCountHistoryRepository;
  cik: string;
  securityClassId: string;
  targetAt: string;
  resolveShareCount: typeof resolveClassShareCountAt;
  normalizeShareCount: typeof normalizeClassShareCountForStockSplitsAt;
  readExecutions: StockSplitShareBasisNormalizerDependencies["readExecutions"];
}): Promise<IssuerTotalCommonSharesClassComponent> {
  let resolution: ClassShareCountResolution;
  try {
    resolution = await input.resolveShareCount({
      repository: input.repository,
      cik: input.cik,
      securityClassId: input.securityClassId,
      targetAt: input.targetAt,
    });
  } catch {
    return failedComponent(input.securityClassId, "CLASS_RESOLUTION_FAILED");
  }
  if (!validResolutionIdentity(resolution, input)) {
    return failedComponent(input.securityClassId, "CLASS_COMPONENT_IDENTITY_MISMATCH", resolution);
  }

  const normalizerDependencies: StockSplitShareBasisNormalizerDependencies = {
    resolveShareCount: async (normalizerInput) => {
      if (normalizerInput.cik !== input.cik
        || normalizerInput.securityClassId !== input.securityClassId
        || new Date(normalizerInput.targetAt).toISOString() !== input.targetAt) {
        throw new Error("normalizer requested a different class-resolution identity");
      }
      return structuredClone(resolution);
    },
  };
  if (input.readExecutions) normalizerDependencies.readExecutions = input.readExecutions;

  let normalization: StockSplitShareBasisNormalization;
  try {
    normalization = await input.normalizeShareCount(
      {
        repository: input.repository,
        cik: input.cik,
        securityClassId: input.securityClassId,
        targetAt: input.targetAt,
      },
      normalizerDependencies,
    );
  } catch {
    return failedComponent(input.securityClassId, "CLASS_NORMALIZATION_FAILED", resolution);
  }
  if (!validNormalizationIdentity(normalization, resolution, input)) {
    return failedComponent(
      input.securityClassId,
      "CLASS_COMPONENT_IDENTITY_MISMATCH",
      resolution,
      normalization,
    );
  }

  if (resolution.status !== "RESOLVED") {
    return componentFromUpstream(
      input.securityClassId,
      resolution.status === "CONFLICT" ? "CLASS_RESOLUTION_CONFLICT" : "CLASS_RESOLUTION_UNAVAILABLE",
      resolution,
      normalization,
    );
  }
  if (normalization.status !== "NORMALIZED" || !validExact(normalization.normalizedExactShares)) {
    return componentFromUpstream(
      input.securityClassId,
      "CLASS_NORMALIZATION_UNAVAILABLE",
      resolution,
      normalization,
    );
  }
  return componentFromUpstream(
    input.securityClassId,
    "CLASS_RESOLVED_AND_NORMALIZED",
    resolution,
    normalization,
  );
}

function componentFromUpstream(
  securityClassId: string,
  reason: IssuerTotalCommonSharesClassComponent["reason"],
  resolution: ClassShareCountResolution,
  normalization: StockSplitShareBasisNormalization,
): IssuerTotalCommonSharesClassComponent {
  const resolved = resolution.status === "RESOLVED";
  const normalized = normalization.status === "NORMALIZED";
  return {
    status: reason === "CLASS_RESOLVED_AND_NORMALIZED" ? "RESOLVED" : "UNAVAILABLE",
    reason,
    securityClassId,
    resolvedShares: resolved ? resolution.sharesOutstanding : null,
    normalizedShares: normalized ? { ...normalization.normalizedExactShares } : null,
    normalizedIntegerShares: normalized ? normalization.normalizedIntegerShares : null,
    observationAsOf: resolution.asOf,
    acceptedAt: resolved ? resolution.selectedObservation.acceptedAt : null,
    ageDays: resolution.ageDays,
    resolution: structuredClone(resolution),
    normalization: structuredClone(normalization),
    appliedStockSplitExecutions: normalized
      ? structuredClone(normalization.appliedExecutions)
      : [],
    appliedReverseSplitExecutions: normalized
      ? reverseExecutions(normalization.appliedExecutions)
      : [],
    selectedObservation: resolved ? structuredClone(resolution.selectedObservation) : null,
    supportingObservations: structuredClone(resolution.supportingObservations),
  };
}

function failedComponent(
  securityClassId: string,
  reason: Extract<IssuerTotalCommonSharesClassComponent["reason"],
    "CLASS_RESOLUTION_FAILED" | "CLASS_NORMALIZATION_FAILED" | "CLASS_COMPONENT_IDENTITY_MISMATCH">,
  resolution: ClassShareCountResolution | null = null,
  normalization: StockSplitShareBasisNormalization | null = null,
): IssuerTotalCommonSharesClassComponent {
  return {
    status: "UNAVAILABLE",
    reason,
    securityClassId,
    resolvedShares: resolution?.status === "RESOLVED" ? resolution.sharesOutstanding : null,
    normalizedShares: null,
    normalizedIntegerShares: null,
    observationAsOf: resolution?.asOf ?? null,
    acceptedAt: resolution?.status === "RESOLVED" ? resolution.selectedObservation.acceptedAt : null,
    ageDays: resolution?.ageDays ?? null,
    resolution: resolution ? structuredClone(resolution) : null,
    normalization: normalization ? structuredClone(normalization) : null,
    appliedStockSplitExecutions: [],
    appliedReverseSplitExecutions: [],
    selectedObservation: resolution?.status === "RESOLVED"
      ? structuredClone(resolution.selectedObservation)
      : null,
    supportingObservations: resolution ? structuredClone(resolution.supportingObservations) : [],
  };
}

function classifyComponentFailure(
  components: IssuerTotalCommonSharesClassComponent[],
): IssuerTotalCommonSharesUnavailable["reason"] | null {
  if (components.some((component) => component.reason === "CLASS_COMPONENT_IDENTITY_MISMATCH"
    || component.reason === "CLASS_RESOLUTION_FAILED"
    || component.reason === "CLASS_NORMALIZATION_FAILED")) return "CLASS_COMPONENT_INVALID";
  if (components.some((component) => component.reason === "CLASS_RESOLUTION_CONFLICT")) {
    return "CLASS_RESOLUTION_CONFLICT";
  }
  if (components.some((component) => component.reason === "CLASS_RESOLUTION_UNAVAILABLE")) {
    return "INCOMPLETE_CLASS_RESOLUTION";
  }
  if (components.some((component) => component.reason === "CLASS_NORMALIZATION_UNAVAILABLE")) {
    return "CLASS_NORMALIZATION_UNAVAILABLE";
  }
  return components.every((component) => component.status === "RESOLVED")
    ? null
    : "CLASS_COMPONENT_INVALID";
}

function validAvailableUniverse(
  universe: IssuerCommonClassUniverseAvailable,
  cik: string,
  targetAt: string,
) {
  const ids = universe.requiredCanonicalSecurityClassIds;
  const snapshotIds = universe.selectedSnapshot.requiredCanonicalSecurityClassIds;
  const targetDate = targetAt.slice(0, 10);
  if (!validTimestamp(universe.targetAt)
    || !validTimestamp(universe.acceptedAt)
    || !validDate(universe.universeAsOf)
    || universe.cik !== cik
    || new Date(universe.targetAt).toISOString() !== targetAt
    || universe.universeAsOf > targetDate
    || new Date(universe.acceptedAt).valueOf() > new Date(targetAt).valueOf()
    || ids.length === 0
    || new Set(ids).size !== ids.length
    || ids.some((id) => !CANONICAL_SECURITY_CLASS_ID_PATTERN.test(id)
      || !id.startsWith(`sc:v1:${cik}:common_stock:`))
    || universe.selectedSnapshot.issuerCik !== cik
    || universe.selectedSnapshot.universeAsOf !== universe.universeAsOf
    || universe.selectedSnapshot.acceptedAt !== universe.acceptedAt
    || !sameStrings(ids, snapshotIds)) return false;
  if (universe.selectedSnapshot.status === "COMPLETE_SINGLE") return ids.length === 1;
  return universe.selectedSnapshot.status === "COMPLETE_MULTI" && ids.length >= 2;
}

function validResolutionIdentity(
  resolution: ClassShareCountResolution,
  input: { cik: string; securityClassId: string; targetAt: string },
) {
  return resolution.cik === input.cik
    && resolution.securityClassId === input.securityClassId
    && resolution.targetAt === input.targetAt;
}

function validNormalizationIdentity(
  normalization: StockSplitShareBasisNormalization,
  resolution: ClassShareCountResolution,
  input: { cik: string; securityClassId: string; targetAt: string },
) {
  return normalization.cik === input.cik
    && normalization.securityClassId === input.securityClassId
    && normalization.targetAt === input.targetAt
    && normalization.coverage === "stock_split_basis_normalization"
    && normalization.originalResolution.cik === resolution.cik
    && normalization.originalResolution.securityClassId === resolution.securityClassId
    && normalization.originalResolution.targetAt === resolution.targetAt
    && normalization.originalResolution.status === resolution.status;
}

function validExact(value: ExactShareCount) {
  return POSITIVE_INTEGER_PATTERN.test(value.numerator)
    && POSITIVE_INTEGER_PATTERN.test(value.denominator)
    && BigInt(value.denominator) > BigInt(0);
}

function reverseExecutions(executions: AppliedStockSplitExecution[]): AppliedReverseSplitExecution[] {
  return structuredClone(executions.filter((execution) => execution.kind === "reverse_split")
    .map(({ kind: _kind, ...execution }) => execution));
}

function addExact(left: ExactShareCount, right: ExactShareCount): ExactShareCount {
  if (!validNonNegativeExact(left) || !validExact(right)) throw new Error("invalid exact share fraction");
  return reduce({
    numerator: BigInt(left.numerator) * BigInt(right.denominator)
      + BigInt(right.numerator) * BigInt(left.denominator),
    denominator: BigInt(left.denominator) * BigInt(right.denominator),
  });
}

function validNonNegativeExact(value: ExactShareCount) {
  return NON_NEGATIVE_INTEGER_PATTERN.test(value.numerator)
    && POSITIVE_INTEGER_PATTERN.test(value.denominator);
}

function reduce(value: { numerator: bigint; denominator: bigint }): ExactShareCount {
  if (value.numerator < BigInt(0) || value.denominator <= BigInt(0)) {
    throw new Error("exact share fraction must be non-negative with a positive denominator");
  }
  if (value.numerator === BigInt(0)) return { numerator: "0", denominator: "1" };
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

function presentExact(value: ExactShareCount): IssuerTotalCommonSharesExact {
  return {
    ...value,
    isInteger: value.denominator === "1",
    integerShares: value.denominator === "1" ? value.numerator : null,
  };
}

function baseFromUniverse(
  universe: IssuerCommonClassUniverseAvailable,
  classComponents: IssuerTotalCommonSharesClassComponent[],
): Omit<IssuerTotalCommonSharesResolved, "status" | "reason" | "totalCommonShares"> {
  return {
    aggregatorVersion: ISSUER_TOTAL_COMMON_SHARES_AGGREGATOR_VERSION,
    view: "EVENT_TIME",
    cik: universe.cik,
    targetAt: universe.targetAt,
    coverage: ISSUER_TOTAL_COMMON_SHARES_COVERAGE,
    universe: structuredClone(universe),
    universeSnapshotIdentity: {
      snapshotId: universe.selectedSnapshot.id,
      sourceIdentityHash: universe.selectedSnapshot.sourceIdentityHash,
      sourceAccession: universe.selectedSnapshot.sourceAccession,
    },
    universeAsOf: universe.universeAsOf,
    requiredCanonicalSecurityClassIds: [...universe.requiredCanonicalSecurityClassIds].sort(),
    classComponents: structuredClone(classComponents),
  };
}

function unavailableFromUniverse(
  universe: IssuerCommonClassUniverseAvailable,
  classComponents: IssuerTotalCommonSharesClassComponent[],
  reason: IssuerTotalCommonSharesUnavailable["reason"],
): IssuerTotalCommonSharesUnavailable {
  return {
    ...baseFromUniverse(universe, classComponents),
    status: "UNAVAILABLE",
    reason,
    totalCommonShares: null,
  };
}

function unavailableBase(
  cik: string,
  targetAt: string,
  reason: IssuerTotalCommonSharesUnavailable["reason"],
  universe: IssuerCommonClassUniverseAt | null = null,
): IssuerTotalCommonSharesUnavailable {
  return {
    aggregatorVersion: ISSUER_TOTAL_COMMON_SHARES_AGGREGATOR_VERSION,
    view: "EVENT_TIME",
    status: "UNAVAILABLE",
    reason,
    cik,
    targetAt,
    coverage: ISSUER_TOTAL_COMMON_SHARES_COVERAGE,
    universe: universe ? structuredClone(universe) : null,
    universeSnapshotIdentity: null,
    universeAsOf: universe?.selectedSnapshot?.universeAsOf ?? null,
    requiredCanonicalSecurityClassIds: universe?.selectedSnapshot
      ? [...universe.selectedSnapshot.requiredCanonicalSecurityClassIds]
      : [],
    classComponents: [],
    totalCommonShares: null,
  };
}

function sameStrings(left: string[], right: string[]) {
  return [...left].sort().join("\u0000") === [...right].sort().join("\u0000");
}

function validateInput(cik: string, targetAt: string) {
  if (!CIK_PATTERN.test(cik) || cik === "0000000000") throw new Error("invalid CIK");
  if (!validTimestamp(targetAt)) {
    throw new Error("targetAt must be an exact timestamp with timezone");
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

const CIK_PATTERN = /^[0-9]{10}$/;
const CANONICAL_SECURITY_CLASS_ID_PATTERN = /^sc:v1:[0-9]{10}:common_stock:(?:single|us-gaap:[A-Za-z][A-Za-z0-9_.-]{1,127}|custom:[0-9a-f]{64}:[A-Za-z][A-Za-z0-9_.-]{1,127})$/;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;
const NON_NEGATIVE_INTEGER_PATTERN = /^(?:0|[1-9][0-9]*)$/;
const DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const TIMESTAMP_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$/;
