import assert from "node:assert/strict";
import test from "node:test";

import {
  ISSUER_COMMON_CLASS_UNIVERSE_VERSION,
  type IssuerCommonClassUniverseAt,
  type IssuerCommonClassUniverseRepository,
  type IssuerCommonClassUniverseSnapshot,
} from "./issuerCommonClassUniverse.ts";
import {
  resolveIssuerTotalCommonSharesAt,
  type IssuerTotalCommonSharesAggregatorDependencies,
} from "./issuerTotalCommonSharesAggregator.ts";
import type {
  ShareCountHistoryObservation,
  ShareCountHistoryReadFilter,
  ShareCountHistoryRepository,
} from "./shareCountHistory.ts";
import {
  FORWARD_SPLIT_EXECUTION_VERSION,
  REVERSE_SPLIT_EXECUTION_VERSION,
  stockSplitExecutionId,
  type StockSplitExecution,
  type ForwardSplitExecution,
  type ReverseSplitExecution,
  type StockSplitExecutionReadResult,
} from "../monitor/reverseSplitExecution.ts";
import type { CorporateActionCanonicalFacts } from "../monitor/corporateActionCanonicalFacts.ts";

const CIK = "0000000099";
const SINGLE = `sc:v1:${CIK}:common_stock:single`;
const CLASS_A = `sc:v1:${CIK}:common_stock:us-gaap:CommonClassAMember`;
const CLASS_B = `sc:v1:${CIK}:common_stock:us-gaap:CommonClassBMember`;
const CLASS_C = `sc:v1:${CIK}:common_stock:us-gaap:CommonClassCMember`;
const TARGET_AT = "2026-08-20T12:00:00.000Z";

test("complete single-class universe resolves and normalizes its only required class", async () => {
  const repository = historyRepository([
    observation(SINGLE, "27500000", "2026-08-18", "2026-08-19T10:00:00.000Z", 1),
  ]);
  const result = await aggregate([SINGLE], repository);

  assert.equal(result.status, "RESOLVED");
  assert.deepEqual(result.totalCommonShares, {
    numerator: "27500000",
    denominator: "1",
    isInteger: true,
    integerShares: "27500000",
  });
  assert.equal(result.classComponents.length, 1);
  assert.equal(result.classComponents[0]!.securityClassId, SINGLE);
  assert.equal(repository.readCount, 1);
});

test("complete A/B/C universe resolves every class independently before exact aggregation", async () => {
  const repository = historyRepository([
    observation(CLASS_A, "60000000", "2026-08-01", "2026-08-02T10:00:00.000Z", 1),
    observation(CLASS_B, "30000000", "2026-08-02", "2026-08-03T10:00:00.000Z", 2),
    observation(CLASS_C, "10000000", "2026-08-03", "2026-08-04T10:00:00.000Z", 3),
  ]);
  const result = await aggregate([CLASS_A, CLASS_B, CLASS_C], repository);

  assert.equal(result.status, "RESOLVED");
  assert.equal(result.totalCommonShares.integerShares, "100000000");
  assert.deepEqual(result.classComponents.map((component) => component.resolvedShares), [
    "60000000", "30000000", "10000000",
  ]);
  assert.deepEqual(result.classComponents.map((component) => component.observationAsOf), [
    "2026-08-01", "2026-08-02", "2026-08-03",
  ]);
  assert.equal(repository.readCount, 3, "the cached class resolution prevents a second history read in normalization");
});

test("a class-specific reverse split is applied before the class totals are added", async () => {
  const repository = historyRepository([
    observation(CLASS_A, "60000000", "2026-07-01", "2026-07-02T10:00:00.000Z", 1),
    observation(CLASS_B, "30000000", "2026-07-01", "2026-07-02T10:00:00.000Z", 2),
    observation(CLASS_C, "10000000", "2026-07-01", "2026-07-02T10:00:00.000Z", 3),
  ]);
  const split = execution(CLASS_A, "2026-08-10", "10", "1", 1);
  const result = await aggregate([CLASS_A, CLASS_B, CLASS_C], repository, [split]);

  assert.equal(result.status, "RESOLVED");
  assert.equal(result.totalCommonShares.integerShares, "46000000");
  const classA = result.classComponents.find((component) => component.securityClassId === CLASS_A)!;
  assert.deepEqual(classA.normalizedShares, { numerator: "6000000", denominator: "1" });
  assert.deepEqual(classA.appliedStockSplitExecutions.map((item) => item.executionId), [split.executionId]);
});

test("K. each class applies forward or reverse splits before the exact issuer total is added", async () => {
  const repository = historyRepository([
    observation(CLASS_A, "100000000", "2026-07-01", "2026-07-02T10:00:00.000Z", 1),
    observation(CLASS_B, "50000000", "2026-07-01", "2026-07-02T10:00:00.000Z", 2),
  ]);
  const forward = execution(CLASS_A, "2026-08-10", "1", "4", 1, "forward_split");
  const reverse = execution(CLASS_B, "2026-08-12", "10", "1", 2);
  const result = await aggregate([CLASS_A, CLASS_B], repository, [forward, reverse]);
  assert.equal(result.status, "RESOLVED");
  assert.equal(result.totalCommonShares.integerShares, "405000000");
  assert.deepEqual(result.classComponents.map((component) => component.normalizedIntegerShares), [
    "400000000", "5000000",
  ]);
  assert.deepEqual(result.classComponents.flatMap((component) =>
    component.appliedStockSplitExecutions.map((item) => item.kind)), ["forward_split", "reverse_split"]);
});

test("one unavailable required class blocks the official total and never promotes a partial sum", async () => {
  const repository = historyRepository([
    observation(CLASS_A, "60000000", "2026-08-01", "2026-08-02T10:00:00.000Z", 1),
    observation(CLASS_B, "30000000", "2026-08-01", "2026-08-02T10:00:00.000Z", 2),
  ]);
  const result = await aggregate([CLASS_A, CLASS_B, CLASS_C], repository);

  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.reason, "INCOMPLETE_CLASS_RESOLUTION");
  assert.equal(result.totalCommonShares, null);
  assert.equal(result.classComponents.find((component) => component.securityClassId === CLASS_C)!.status, "UNAVAILABLE");
  assert.equal("partialTotal" in result, false);
});

test("split materialization failure makes the issuer total unavailable", async () => {
  const repository = historyRepository([
    observation(SINGLE, "27500000", "2026-07-01", "2026-07-02T10:00:00.000Z", 1),
  ]);
  const result = await resolveIssuerTotalCommonSharesAt(baseInput(repository), {
    readUniverse: async (input) => availableUniverse([SINGLE], input.targetAt),
    readExecutions: materializationFailureReader,
  });
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.reason, "CLASS_NORMALIZATION_UNAVAILABLE");
  assert.equal(result.classComponents[0]?.normalization?.status, "NORMALIZATION_UNAVAILABLE");
  assert.equal(result.classComponents[0]?.normalization?.reason, "SPLIT_MATERIALIZATION_FAILED");
  assert.equal(result.totalCommonShares, null);
});

test("stale, incomplete, ambiguous, and future universe results block all class reads", async () => {
  for (const universe of [
    unavailableUniverse("CLASS_UNIVERSE_STALE", "LATER_CANONICAL_COMMON_CLASS_DISCOVERED"),
    unavailableUniverse("INCOMPLETE", "LATEST_SNAPSHOT_INCOMPLETE"),
    unavailableUniverse("AMBIGUOUS", "LATEST_SNAPSHOT_AMBIGUOUS"),
    unavailableUniverse("UNAVAILABLE", "NO_UNIVERSE_SNAPSHOT_AVAILABLE", null),
  ] satisfies IssuerCommonClassUniverseAt[]) {
    const repository = historyRepository([
      observation(SINGLE, "10000000", "2026-08-01", "2026-08-02T10:00:00.000Z", 1),
    ]);
    const result = await resolveIssuerTotalCommonSharesAt(
      baseInput(repository),
      { readUniverse: async () => structuredClone(universe), readExecutions: executionReader([]) },
    );
    assert.equal(result.status, "UNAVAILABLE");
    assert.equal(result.reason, "COMMON_CLASS_UNIVERSE_NOT_AVAILABLE");
    assert.equal(result.totalCommonShares, null);
    assert.equal(repository.readCount, 0);
  }
});

test("a malformed AVAILABLE universe cannot authorize class resolution", async () => {
  const repository = historyRepository([
    observation(SINGLE, "10000000", "2026-08-01", "2026-08-02T10:00:00.000Z", 1),
  ]);
  const malformed = availableUniverse([SINGLE], TARGET_AT);
  assert.equal(malformed.status, "AVAILABLE");
  malformed.requiredCanonicalSecurityClassIds.push(SINGLE);
  const result = await resolveIssuerTotalCommonSharesAt(baseInput(repository), {
    readUniverse: async () => structuredClone(malformed),
    readExecutions: executionReader([]),
  });

  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.reason, "UNIVERSE_RESULT_INVALID");
  assert.equal(repository.readCount, 0);
});

test("same-class latest-date conflict blocks the total without source priority or older fallback", async () => {
  const repository = historyRepository([
    observation(SINGLE, "20000000", "2026-07-01", "2026-07-02T10:00:00.000Z", 1),
    observation(SINGLE, "25000000", "2026-08-01", "2026-08-02T10:00:00.000Z", 2),
    observation(SINGLE, "26000000", "2026-08-01", "2026-08-02T11:00:00.000Z", 3),
  ]);
  const result = await aggregate([SINGLE], repository);

  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.reason, "CLASS_RESOLUTION_CONFLICT");
  assert.equal(result.totalCommonShares, null);
  assert.equal(result.classComponents[0]!.resolution?.status, "CONFLICT");
  assert.deepEqual(
    result.classComponents[0]!.supportingObservations.map((row) => row.sharesOutstanding),
    ["25000000", "26000000"],
  );
});

test("preferred, warrant, and convertible observations outside the complete universe are never added", async () => {
  const repository = historyRepository([
    observation(SINGLE, "10000000", "2026-08-01", "2026-08-02T10:00:00.000Z", 1),
    nonCommonObservation("preferred_stock", "50000000", 2),
    nonCommonObservation("warrant", "70000000", 3),
    nonCommonObservation("convertible", "90000000", 4),
  ]);
  const result = await aggregate([SINGLE], repository);

  assert.equal(result.status, "RESOLVED");
  assert.equal(result.totalCommonShares.integerShares, "10000000");
  assert.equal(result.classComponents.length, 1);
});

test("rational class components are reduced and summed exactly without rounding", async () => {
  const repository = historyRepository([
    observation(CLASS_A, "100000000", "2026-07-01", "2026-07-02T10:00:00.000Z", 1),
    observation(CLASS_B, "5000000", "2026-07-01", "2026-07-02T10:00:00.000Z", 2),
  ]);
  const split = execution(CLASS_A, "2026-08-10", "15", "2", 1);
  const result = await aggregate([CLASS_A, CLASS_B], repository, [split]);

  assert.equal(result.status, "RESOLVED");
  assert.deepEqual(result.classComponents[0]!.normalizedShares, {
    numerator: "40000000",
    denominator: "3",
  });
  assert.deepEqual(result.totalCommonShares, {
    numerator: "55000000",
    denominator: "3",
    isInteger: false,
    integerShares: null,
  });
});

test("event-time eligibility preserves different component as-of dates and excludes future hindsight", async () => {
  const repository = historyRepository([
    observation(CLASS_A, "10000000", "2026-06-30", "2026-07-01T10:00:00.000Z", 1),
    observation(CLASS_A, "20000000", "2026-08-15", "2026-08-25T10:00:00.000Z", 2),
    observation(CLASS_B, "5000000", "2026-08-01", "2026-08-02T10:00:00.000Z", 3),
  ]);
  const result = await aggregate([CLASS_A, CLASS_B], repository);

  assert.equal(result.status, "RESOLVED");
  assert.equal(result.totalCommonShares.integerShares, "15000000");
  assert.deepEqual(result.classComponents.map((component) => ({
    id: component.securityClassId,
    asOf: component.observationAsOf,
    acceptedAt: component.acceptedAt,
    ageDays: component.ageDays,
  })), [
    { id: CLASS_A, asOf: "2026-06-30", acceptedAt: "2026-07-01T10:00:00.000Z", ageDays: 51 },
    { id: CLASS_B, asOf: "2026-08-01", acceptedAt: "2026-08-02T10:00:00.000Z", ageDays: 19 },
  ]);
});

test("normalization conflicts and identity mismatches fail closed", async () => {
  const repository = historyRepository([
    observation(SINGLE, "10000000", "2026-07-01", "2026-07-02T10:00:00.000Z", 1),
  ]);
  const normalizationUnavailable = await resolveIssuerTotalCommonSharesAt(
    baseInput(repository),
    dependencies([SINGLE], [execution(SINGLE, "2026-08-10", "10", "1", 1)], true),
  );
  assert.equal(normalizationUnavailable.status, "UNAVAILABLE");
  assert.equal(normalizationUnavailable.reason, "CLASS_NORMALIZATION_UNAVAILABLE");

  const mismatched = await resolveIssuerTotalCommonSharesAt(baseInput(repository), {
    ...dependencies([SINGLE]),
    resolveShareCount: async (input) => ({
      resolverVersion: "class-share-count-resolver-v1",
      status: "UNAVAILABLE",
      reason: "NO_ELIGIBLE_OBSERVATION_AT_TARGET",
      cik: input.cik,
      securityClassId: CLASS_A,
      targetAt: input.targetAt,
      sharesOutstanding: null,
      asOf: null,
      ageDays: null,
      selectedObservation: null,
      supportingObservations: [],
    }),
  });
  assert.equal(mismatched.status, "UNAVAILABLE");
  assert.equal(mismatched.reason, "CLASS_COMPONENT_INVALID");
});

test("same input replay is deterministic and writes no history", async () => {
  const repository = historyRepository([
    observation(SINGLE, "27500000", "2026-08-18", "2026-08-19T10:00:00.000Z", 1),
  ]);
  const first = await aggregate([SINGLE], repository);
  const second = await aggregate([SINGLE], repository);

  assert.deepEqual(second, first);
  assert.equal(repository.writeCount, 0);
  assert.equal(repository.readCount, 2);
});

function aggregate(
  classes: string[],
  repository: StaticHistoryRepository,
  executions: StockSplitExecution[] = [],
) {
  return resolveIssuerTotalCommonSharesAt(baseInput(repository), dependencies(classes, executions));
}

function baseInput(repository: StaticHistoryRepository) {
  return {
    universeRepository: UNUSED_UNIVERSE_REPOSITORY,
    repository,
    cik: CIK,
    targetAt: TARGET_AT,
  };
}

function dependencies(
  classes: string[],
  executions: StockSplitExecution[] = [],
  conflicting = false,
): IssuerTotalCommonSharesAggregatorDependencies {
  return {
    readUniverse: async (input) => availableUniverse(classes, input.targetAt),
    readExecutions: executionReader(executions, conflicting),
  };
}

function availableUniverse(classes: string[], targetAt: string): IssuerCommonClassUniverseAt {
  const snapshot = universeSnapshot(classes);
  return {
    status: "AVAILABLE",
    reason: "LATEST_COMPLETE_UNIVERSE_SELECTED",
    cik: CIK,
    targetAt,
    universeAsOf: snapshot.universeAsOf,
    acceptedAt: snapshot.acceptedAt,
    requiredCanonicalSecurityClassIds: [...classes],
    sourceAccession: snapshot.sourceAccession,
    selectedSnapshot: snapshot,
    supportingSnapshots: [snapshot],
    laterClassEvidence: [],
  };
}

function unavailableUniverse(
  status: "UNAVAILABLE" | "INCOMPLETE" | "AMBIGUOUS" | "CLASS_UNIVERSE_STALE",
  reason:
    | "NO_UNIVERSE_SNAPSHOT_AVAILABLE"
    | "LATEST_SNAPSHOT_INCOMPLETE"
    | "LATEST_SNAPSHOT_AMBIGUOUS"
    | "LATER_CANONICAL_COMMON_CLASS_DISCOVERED",
  selectedSnapshot: IssuerCommonClassUniverseSnapshot | null = universeSnapshot([SINGLE]),
): IssuerCommonClassUniverseAt {
  return {
    status,
    reason,
    cik: CIK,
    targetAt: TARGET_AT,
    selectedSnapshot,
    supportingSnapshots: selectedSnapshot ? [selectedSnapshot] : [],
    laterClassEvidence: [],
  };
}

function universeSnapshot(classes: string[]): IssuerCommonClassUniverseSnapshot {
  return {
    id: "universe-snapshot-1",
    snapshotVersion: ISSUER_COMMON_CLASS_UNIVERSE_VERSION,
    issuerCik: CIK,
    universeAsOf: "2026-06-30",
    acceptedAt: "2026-08-01T10:00:00.000Z",
    sourceAccession: "0000000099-26-000001",
    sourceForm: "10-Q",
    sourceFiledDate: "2026-08-01",
    sourceDocuments: ["fixture.htm"],
    status: classes.length === 1 ? "COMPLETE_SINGLE" : "COMPLETE_MULTI",
    reason: classes.length === 1 ? "COMPLETE_SINGLE_COMMON_STOCK" : "COMPLETE_MULTI_COMMON_STOCK",
    requiredCanonicalSecurityClassIds: [...classes],
    classEvidence: [],
    aggregateEvidence: [],
    excludedEvidence: [],
    completenessProvenance: { fixture: true },
    sourceIdentityHash: "f".repeat(64),
    createdAt: "2026-08-01T10:01:00.000Z",
  };
}

function executionReader(executions: StockSplitExecution[], conflicting = false) {
  return async (input: {
    actionKind: "forward_split" | "reverse_split";
    cik: string;
    canonicalSecurityClassId?: string;
    from: string;
    to: string;
    targetAt: string;
  }): Promise<StockSplitExecutionReadResult> => input.actionKind === "forward_split" ? ({
    status: "available",
    issuerCik: input.cik,
    canonicalSecurityClassId: input.canonicalSecurityClassId ?? null,
    from: input.from,
    to: input.to,
    targetAt: input.targetAt,
    basisChangeCoverage: "forward_split_only",
    executions: structuredClone(executions.filter((item): item is ForwardSplitExecution => item.version === FORWARD_SPLIT_EXECUTION_VERSION
      && item.canonicalSecurityClassId === input.canonicalSecurityClassId)),
    inactiveExecutions: [],
    conflicts: [],
  }) : ({
    status: "available",
    issuerCik: input.cik,
    canonicalSecurityClassId: input.canonicalSecurityClassId ?? null,
    from: input.from,
    to: input.to,
    targetAt: input.targetAt,
    basisChangeCoverage: "reverse_split_only",
    executions: structuredClone(executions.filter((item): item is ReverseSplitExecution => item.version === REVERSE_SPLIT_EXECUTION_VERSION
      && item.canonicalSecurityClassId === input.canonicalSecurityClassId)),
    inactiveExecutions: [],
    conflicts: conflicting ? [{
      version: REVERSE_SPLIT_EXECUTION_VERSION,
      status: "EXECUTION_CONFLICT",
      executionStatus: "conflict",
      conflictId: `rsec:v1:${"c".repeat(64)}`,
      issuerCik: input.cik,
      canonicalSecurityClassId: input.canonicalSecurityClassId ?? SINGLE,
      effectiveDate: "2026-08-10",
      reasons: ["FINAL_RATIO_CONFLICT"],
      candidateExecutionIds: executions.map((item) => item.executionId),
      observations: executions.flatMap((item) => structuredClone(item.observations)),
    }] : [],
  });
}

const materializationFailureReader: NonNullable<IssuerTotalCommonSharesAggregatorDependencies["readExecutions"]> =
  async (input): Promise<StockSplitExecutionReadResult> => input.actionKind === "reverse_split" ? ({
    status: "materialization_unavailable",
    materializationStatus: "SPLIT_MATERIALIZATION_FAILED",
    issuerCik: input.cik,
    canonicalSecurityClassId: input.canonicalSecurityClassId ?? null,
    from: input.from,
    to: input.to,
    targetAt: input.targetAt,
    basisChangeCoverage: "reverse_split_only",
    failures: [{} as never],
    executions: [],
    inactiveExecutions: [],
    conflicts: [],
  }) : ({
    status: "available",
    materializationStatus: "NO_SPLIT_EVIDENCE",
    issuerCik: input.cik,
    canonicalSecurityClassId: input.canonicalSecurityClassId ?? null,
    from: input.from,
    to: input.to,
    targetAt: input.targetAt,
    basisChangeCoverage: "forward_split_only",
    executions: [],
    inactiveExecutions: [],
    conflicts: [],
  });

function execution(
  securityClassId: string,
  effectiveDate: string,
  oldShares: string,
  newShares: string,
  sequence: number,
  kind: "forward_split" | "reverse_split" = "reverse_split",
): StockSplitExecution {
  const executionId = stockSplitExecutionId({
    actionKind: kind,
    issuerCik: CIK,
    canonicalSecurityClassId: securityClassId,
    effectiveDate,
    oldShareUnits: oldShares,
    newShareUnits: newShares,
  });
  const accessionNumber = `0000000099-26-${sequence.toString().padStart(6, "0")}`;
  return {
    version: kind === "forward_split" ? FORWARD_SPLIT_EXECUTION_VERSION : REVERSE_SPLIT_EXECUTION_VERSION,
    status: "CALCULATION_ELIGIBLE",
    executionStatus: "scheduled",
    executionId,
    issuerCik: CIK,
    canonicalSecurityClassId: securityClassId,
    effectiveDate,
    exactRatio: { oldShareUnits: oldShares, newShareUnits: newShares },
    effectiveTiming: { availability: "unavailable", reason: "date_only" },
    observations: [{
      eventId: uuid(sequence, 1),
      sourceExecutionId: uuid(sequence, 2),
      issuerCik: CIK,
      canonicalSecurityClassId: securityClassId,
      accessionNumber,
      acceptedAt: "2026-08-05T10:00:00.000Z",
      actionStage: "scheduled",
      exactRatio: { oldShareUnits: oldShares, newShareUnits: newShares },
      effectiveDate,
      effectiveTiming: { availability: "unavailable", reason: "date_only" },
      sourceRef: `split-source-${sequence}`,
      evidence: { availability: "available", value: `Exact reverse split evidence ${sequence}` },
      source: {
        source_family: "sec",
        source_id: accessionNumber,
        source_url: `https://www.sec.gov/${accessionNumber}`,
      },
      persistedAt: "2026-08-06T00:00:00.000Z",
      facts: {} as CorporateActionCanonicalFacts,
    }],
  };
}

function observation(
  securityClassId: string,
  shares: string,
  asOf: string,
  acceptedAt: string,
  sequence: number,
): ShareCountHistoryObservation {
  return {
    id: `share-count-${sequence}`,
    observationType: "authoritative_xbrl",
    issuerCik: CIK,
    sharesOutstanding: shares,
    asOf,
    securityClassBasis: securityClassId.endsWith(":single")
      ? "SINGLE_COMMON_STOCK_CLASS"
      : "CLASS_SPECIFIC_COMMON_STOCK",
    securityClassIdentity: { canonicalKey: securityClassId, identity: { securityClassId } },
    securityClassMetadata: { securityClassId },
    canonicalSecurityClassId: securityClassId,
    canonicalSecurityClassKind: "common_stock",
    canonicalSecurityClassStatus: "mapped",
    canonicalSecurityClassProvenance: { fixture: securityClassId },
    shareBasisIdentity: "shares_outstanding:xbrli_shares",
    shareBasisMetadata: { unit: "shares" },
    accessionNumber: `0000000099-26-${sequence.toString().padStart(6, "0")}`,
    form: "10-Q",
    filingDocument: `fixture-${sequence}.htm`,
    filedDate: acceptedAt.slice(0, 10),
    acceptedAt,
    acceptedAtSource: "sec_filing_ledger",
    acceptedAtProvenance: { source: "sec_filing_ledger.accepted_at" },
    ingestedAt: "2026-08-20T13:00:00.000Z",
    sourceConceptNamespaceUri: "http://xbrl.sec.gov/dei/2025",
    sourceConceptLocalName: "EntityCommonStockSharesOutstanding",
    sourceFactKey: sequence.toString(16).padStart(64, "0"),
    sourceContextRef: `context-${sequence}`,
    sourceArtifactId: uuid(sequence, 3),
    filingLedgerRawSourceId: uuid(sequence, 4),
    sourceFactIdentity: { fixture: sequence },
    sourceContext: { fixture: sequence },
    sourceDimensions: [],
    sourceProvenance: { fixture: sequence },
    sourceType: "sec_authoritative_os",
    authoritativeStatus: "ELIGIBLE",
    authoritativeDecisionVersion: "authoritative-os-extraction-v1",
    authoritativeDecisionReason: "ELIGIBLE_CLASS_SPECIFIC_DEI_CONTEXT",
    authoritativeDecisionLineage: { fixture: sequence },
    sourceDocumentUrl: `https://www.sec.gov/fixture-${sequence}.htm`,
    sourceContentHash: (sequence + 100).toString(16).padStart(64, "0"),
    sourceEvidence: null,
    sourceAnalyzer: null,
  } as ShareCountHistoryObservation;
}

function nonCommonObservation(kind: string, shares: string, sequence: number) {
  const row = observation(SINGLE, shares, "2026-08-01", "2026-08-02T10:00:00.000Z", sequence);
  return {
    ...row,
    canonicalSecurityClassId: `sc:v1:${CIK}:${kind}:fixture`,
    canonicalSecurityClassKind: kind,
    canonicalSecurityClassProvenance: { excludedNonCommonFixture: kind },
  } as unknown as ShareCountHistoryObservation;
}

class StaticHistoryRepository implements ShareCountHistoryRepository {
  readCount = 0;
  writeCount = 0;
  private readonly rows: ShareCountHistoryObservation[];

  constructor(rows: ShareCountHistoryObservation[]) {
    this.rows = structuredClone(rows);
  }

  async insertObservation(): Promise<boolean> {
    this.writeCount += 1;
    throw new Error("issuer total aggregation must remain read-only");
  }

  async readHistory(cik: string, filter: ShareCountHistoryReadFilter = {}) {
    this.readCount += 1;
    return this.rows
      .filter((row) => row.issuerCik === cik)
      .filter((row) => !filter.asOfFrom || row.asOf >= filter.asOfFrom)
      .filter((row) => !filter.asOfTo || row.asOf <= filter.asOfTo)
      .filter((row) => !filter.canonicalSecurityClassId
        || row.canonicalSecurityClassId === filter.canonicalSecurityClassId)
      .map((row) => structuredClone(row));
  }
}

function historyRepository(rows: ShareCountHistoryObservation[]) {
  return new StaticHistoryRepository(rows);
}

const UNUSED_UNIVERSE_REPOSITORY: IssuerCommonClassUniverseRepository = {
  async insertSnapshot() {
    throw new Error("aggregator must not write universe snapshots");
  },
  async readSnapshots() {
    throw new Error("the focused fixture injects the official universe reader result");
  },
};

function uuid(sequence: number, offset: number) {
  return `73000000-0000-4000-8000-${(sequence * 10 + offset).toString().padStart(12, "0")}`;
}
