import assert from "node:assert/strict";
import test from "node:test";
import type { CorporateActionCanonicalFacts } from "../monitor/corporateActionCanonicalFacts.ts";
import {
  FORWARD_SPLIT_EXECUTION_VERSION,
  REVERSE_SPLIT_EXECUTION_VERSION,
  stockSplitExecutionId,
  type StockSplitExecution,
  type ForwardSplitExecution,
  type ReverseSplitExecution,
  type ReverseSplitExecutionConflict,
  type StockSplitExecutionReadResult,
} from "../monitor/reverseSplitExecution.ts";
import type { ClassShareCountResolved } from "./classShareCountResolver.ts";
import {
  normalizeClassShareCountForStockSplitsAt,
  type StockSplitActionKind,
  type StockSplitShareBasisNormalizerDependencies,
} from "./stockSplitShareBasisNormalizer.ts";
import type { ShareCountHistoryRepository } from "./shareCountHistory.ts";

const CIK = "0000000099";
const CLASS_ID = `sc:v1:${CIK}:common_stock:single`;
const TARGET_AT = "2026-08-20T23:59:59.999Z";
const UNUSED_REPOSITORY = {} as ShareCountHistoryRepository;

test("A-C. reverse, forward, and fractional stock splits use exact rational arithmetic", async () => {
  const reverse = await normalize("100000000", "2026-07-01", [execution("reverse_split", "2026-08-10", "10", "1", 1)]);
  assertNormalized(reverse, "10000000", "1");

  const forward = await normalize("100000000", "2026-07-01", [execution("forward_split", "2026-08-10", "1", "4", 2)]);
  assertNormalized(forward, "400000000", "1");
  assert.equal(forward.appliedExecutions[0]!.kind, "forward_split");

  const fractional = await normalize("100000000", "2026-07-01", [execution("forward_split", "2026-08-10", "2", "3", 3)]);
  assertNormalized(fractional, "150000000", "1");
});

test("D. mixed forward and reverse executions apply in effective chronology", async () => {
  const laterReverse = execution("reverse_split", "2026-08-12", "10", "1", 4);
  const earlierForward = execution("forward_split", "2026-08-10", "1", "4", 5);
  const result = await normalize("100000000", "2026-07-01", [laterReverse, earlierForward]);
  assertNormalized(result, "40000000", "1");
  assert.deepEqual(result.appliedExecutions.map((item) => item.kind), ["forward_split", "reverse_split"]);
  assert.deepEqual(result.appliedExecutionIds, [earlierForward.executionId, laterReverse.executionId]);
});

test("E. an observation on an on-effective-date basis does not reapply that split", async () => {
  const result = await normalize("400000000", "2026-08-10", [
    execution("forward_split", "2026-08-10", "1", "4", 6),
  ]);
  assertNormalized(result, "400000000", "1");
  assert.deepEqual(result.appliedExecutions, []);
});

test("same-date after-close forward and reverse executions roll the observation to the next day basis", async () => {
  for (const [kind, oldShares, newShares, expected, sequence] of [
    ["forward_split", "1", "4", "400000000", 10],
    ["reverse_split", "10", "1", "10000000", 11],
  ] as const) {
    const split = execution(kind, "2026-08-10", oldShares, newShares, sequence, {
      availability: "available",
      kind: "after_market_close",
      timestamp: null,
      source_ref: `same-day-${kind}`,
      evidence: { availability: "available", value: "after the close of trading" },
    });
    const result = await normalize("100000000", "2026-08-10", [split]);
    assertNormalized(result, expected, "1");
    assert.deepEqual(result.appliedExecutionIds, [split.executionId]);
  }
});

test("same-date mixed activations apply only the execution still ahead of the observation basis", async () => {
  const alreadyReflected = execution("forward_split", "2026-08-10", "1", "4", 12);
  const stillAhead = execution("reverse_split", "2026-08-10", "10", "1", 13, {
    availability: "available",
    kind: "after_market_close",
    timestamp: null,
    source_ref: "same-day-after-close",
    evidence: { availability: "available", value: "after the close of trading" },
  });
  const result = await normalize("400000000", "2026-08-10", [stillAhead, alreadyReflected]);
  assertNormalized(result, "40000000", "1");
  assert.deepEqual(result.appliedExecutionIds, [stillAhead.executionId]);
});

test("an indeterminate same-date calculation boundary fails closed", async () => {
  const split = execution("forward_split", "2026-08-10", "1", "4", 14);
  split.calculationActivation = {
    version: "stock_split_day_basis_activation_v1",
    state: "INDETERMINATE",
    source_meaning: "effective_date_unavailable",
    evidence_identity: null,
  };
  const result = await normalize("100000000", "2026-08-10", [split]);
  assert.equal(result.status, "NORMALIZATION_UNAVAILABLE");
  assert.equal(result.reason, "EXECUTION_TIMING_INDETERMINATE");
  assert.equal(result.normalizedExactShares, null);
});

test("F-G. inactive executions apply zero and a historical re-mention remains one execution", async () => {
  const inactive = await normalize("100000000", "2026-07-01", []);
  assertNormalized(inactive, "100000000", "1");

  const mentioned = execution("forward_split", "2026-08-10", "1", "4", 7);
  mentioned.observations.push({ ...structuredClone(mentioned.observations[0]!), eventId: uuid(7, 3) });
  const remention = await normalize("100000000", "2026-07-01", [mentioned]);
  assertNormalized(remention, "400000000", "1");
  assert.equal(remention.appliedExecutions.length, 1);
  assert.equal(remention.appliedExecutions[0]!.observations.length, 2);
});

test("H-I. either forward or reverse execution conflict fails closed", async () => {
  for (const conflictKind of ["forward_split", "reverse_split"] as const) {
    const result = await normalize("100000000", "2026-07-01", [], conflictKind);
    assert.equal(result.status, "NORMALIZATION_UNAVAILABLE");
    assert.equal(result.reason, "EXECUTION_CONFLICT");
    assert.equal(result.normalizedExactShares, null);
    assert.equal(result.executionConflicts.length, 1);
  }
});

test("relevant split materialization failure propagates as normalization unavailable", async () => {
  const result = await normalizeClassShareCountForStockSplitsAt(input(), {
    resolveShareCount: async () => resolution(),
    readExecutions: materializationFailureReader,
  });
  assert.equal(result.status, "NORMALIZATION_UNAVAILABLE");
  assert.equal(result.reason, "SPLIT_MATERIALIZATION_FAILED");
  assert.equal(result.normalizedExactShares, null);
});

test("effective-day timing lock and deterministic replay are preserved", async () => {
  const afterClose = execution("forward_split", "2026-08-20", "1", "4", 8,
    { availability: "available", kind: "after_market_close", timestamp: null, source_ref: "fixture", evidence: { availability: "available", value: "after close" } });
  const appliedAtOpen = execution("reverse_split", "2026-08-20", "10", "1", 9,
    { availability: "available", kind: "market_open", timestamp: null, source_ref: "fixture", evidence: { availability: "available", value: "market open" } });
  const dependencies = {
    resolveShareCount: async () => resolution(),
    ...dependenciesFor([afterClose, appliedAtOpen]),
  };
  const first = await normalizeClassShareCountForStockSplitsAt(input(), dependencies);
  const second = await normalizeClassShareCountForStockSplitsAt(input(), dependencies);
  assert.deepEqual(second, first);
  assertNormalized(first, "10000000", "1");
  assert.deepEqual(first.appliedExecutions.map((item) => item.executionId), [appliedAtOpen.executionId]);
  assert.equal(first.coverage, "stock_split_basis_normalization");
  assert.deepEqual(first.unsupportedBasisChanges, [
    "stock_dividend", "recapitalization", "ads_ratio_change", "other_non_split_basis_change",
  ]);
});

async function normalize(
  shares: string,
  asOf: string,
  executions: StockSplitExecution[],
  conflictKind?: StockSplitActionKind,
) {
  return normalizeClassShareCountForStockSplitsAt(input(), {
    resolveShareCount: async () => resolution(shares, asOf),
    ...dependenciesFor(executions, conflictKind),
  });
}

function input() {
  return { repository: UNUSED_REPOSITORY, cik: CIK, securityClassId: CLASS_ID, targetAt: TARGET_AT };
}

function dependenciesFor(
  executions: StockSplitExecution[],
  conflictKind?: StockSplitActionKind,
): Pick<StockSplitShareBasisNormalizerDependencies, "readExecutions"> {
  return { readExecutions: async (readInput): Promise<StockSplitExecutionReadResult> => {
    const selected = executions.filter((item) => item.version === (readInput.actionKind === "forward_split"
      ? FORWARD_SPLIT_EXECUTION_VERSION : REVERSE_SPLIT_EXECUTION_VERSION));
    const base = {
      status: "available" as const,
      issuerCik: readInput.cik,
      canonicalSecurityClassId: readInput.canonicalSecurityClassId ?? null,
      from: readInput.from,
      to: readInput.to,
      targetAt: readInput.targetAt,
      inactiveExecutions: [],
    };
    if (readInput.actionKind === "forward_split") return {
      ...base,
      basisChangeCoverage: "forward_split_only",
      executions: structuredClone(selected.filter((item): item is ForwardSplitExecution =>
        item.version === FORWARD_SPLIT_EXECUTION_VERSION)),
      conflicts: conflictKind === "forward_split" ? [conflict("forward_split") as
        ReverseSplitExecutionConflict<typeof FORWARD_SPLIT_EXECUTION_VERSION>] : [],
    };
    return {
      ...base,
      basisChangeCoverage: "reverse_split_only",
      executions: structuredClone(selected.filter((item): item is ReverseSplitExecution =>
        item.version === REVERSE_SPLIT_EXECUTION_VERSION)),
      conflicts: conflictKind === "reverse_split" ? [conflict("reverse_split") as
        ReverseSplitExecutionConflict<typeof REVERSE_SPLIT_EXECUTION_VERSION>] : [],
    };
  } };
}

const materializationFailureReader: NonNullable<StockSplitShareBasisNormalizerDependencies["readExecutions"]> =
  async (readInput): Promise<StockSplitExecutionReadResult> => readInput.actionKind === "reverse_split" ? ({
    status: "materialization_unavailable",
    materializationStatus: "SPLIT_MATERIALIZATION_FAILED",
    issuerCik: readInput.cik,
    canonicalSecurityClassId: readInput.canonicalSecurityClassId ?? null,
    from: readInput.from,
    to: readInput.to,
    targetAt: readInput.targetAt,
    basisChangeCoverage: "reverse_split_only",
    failures: [{} as never],
    executions: [],
    inactiveExecutions: [],
    conflicts: [],
  }) : ({
    status: "available",
    materializationStatus: "NO_SPLIT_EVIDENCE",
    issuerCik: readInput.cik,
    canonicalSecurityClassId: readInput.canonicalSecurityClassId ?? null,
    from: readInput.from,
    to: readInput.to,
    targetAt: readInput.targetAt,
    basisChangeCoverage: "forward_split_only",
    executions: [],
    inactiveExecutions: [],
    conflicts: [],
  });

function resolution(shares = "100000000", asOf = "2026-07-01"): ClassShareCountResolved {
  return {
    resolverVersion: "class-share-count-resolver-v1",
    status: "RESOLVED",
    reason: "LATEST_ELIGIBLE_AS_OF_RESOLVED",
    cik: CIK,
    securityClassId: CLASS_ID,
    targetAt: TARGET_AT,
    sharesOutstanding: shares,
    asOf,
    ageDays: 50,
    selectedObservation: { acceptedAt: "2026-07-02T10:00:00.000Z" } as ClassShareCountResolved["selectedObservation"],
    supportingObservations: [],
  };
}

function execution(
  kind: StockSplitActionKind,
  effectiveDate: string,
  oldShareUnits: string,
  newShareUnits: string,
  sequence: number,
  effectiveTiming: StockSplitExecution["effectiveTiming"] = { availability: "unavailable", reason: "date_only" },
): StockSplitExecution {
  const executionId = stockSplitExecutionId({
    actionKind: kind,
    issuerCik: CIK,
    canonicalSecurityClassId: CLASS_ID,
    effectiveDate,
    oldShareUnits,
    newShareUnits,
  });
  const accessionNumber = `0000000099-26-${sequence.toString().padStart(6, "0")}`;
  return {
    version: kind === "forward_split" ? FORWARD_SPLIT_EXECUTION_VERSION : REVERSE_SPLIT_EXECUTION_VERSION,
    status: "CALCULATION_ELIGIBLE",
    executionStatus: "scheduled",
    executionId,
    issuerCik: CIK,
    canonicalSecurityClassId: CLASS_ID,
    effectiveDate,
    exactRatio: { oldShareUnits, newShareUnits },
    effectiveTiming,
    observations: [{
      eventId: uuid(sequence, 1),
      sourceExecutionId: uuid(sequence, 2),
      issuerCik: CIK,
      canonicalSecurityClassId: CLASS_ID,
      accessionNumber,
      acceptedAt: "2026-08-01T10:00:00.000Z",
      actionStage: "scheduled",
      exactRatio: { oldShareUnits, newShareUnits },
      effectiveDate,
      effectiveTiming,
      sourceRef: `source-${sequence}`,
      evidence: { availability: "available", value: `Exact ${kind} evidence` },
      source: { source_family: "sec", source_id: accessionNumber, source_url: "https://www.sec.gov/fixture" },
      persistedAt: "2026-08-01T10:01:00.000Z",
      facts: {} as CorporateActionCanonicalFacts,
    }],
  };
}

function conflict(kind: StockSplitActionKind): ReverseSplitExecutionConflict<StockSplitExecution["version"]> {
  const forward = kind === "forward_split";
  return {
    version: forward ? FORWARD_SPLIT_EXECUTION_VERSION : REVERSE_SPLIT_EXECUTION_VERSION,
    status: "EXECUTION_CONFLICT" as const,
    executionStatus: "conflict" as const,
    conflictId: `${forward ? "fsec" : "rsec"}:v1:${"c".repeat(64)}`,
    issuerCik: CIK,
    canonicalSecurityClassId: CLASS_ID,
    effectiveDate: "2026-08-10",
    reasons: ["FINAL_RATIO_CONFLICT" as const],
    candidateExecutionIds: [],
    observations: [],
  };
}

function assertNormalized(
  value: Awaited<ReturnType<typeof normalizeClassShareCountForStockSplitsAt>>,
  numerator: string,
  denominator: string,
): asserts value is Extract<typeof value, { status: "NORMALIZED" }> {
  assert.equal(value.status, "NORMALIZED");
  assert.deepEqual(value.normalizedExactShares, { numerator, denominator });
}

function uuid(sequence: number, offset: number) {
  return `75000000-0000-4000-8000-${(sequence * 10 + offset).toString().padStart(12, "0")}`;
}
