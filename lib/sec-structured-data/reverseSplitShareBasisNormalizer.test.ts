import assert from "node:assert/strict";
import test from "node:test";
import type { CorporateActionCanonicalFacts } from "../monitor/corporateActionCanonicalFacts.ts";
import {
  REVERSE_SPLIT_EXECUTION_VERSION,
  reverseSplitExecutionId,
  type InactiveReverseSplitExecution,
  type ReverseSplitExecution,
  type ReverseSplitExecutionConflict,
  type ReverseSplitExecutionReadResult,
} from "../monitor/reverseSplitExecution.ts";
import {
  normalizeClassShareCountAt,
  type ReverseSplitShareBasisNormalizerDependencies,
} from "./reverseSplitShareBasisNormalizer.ts";
import type {
  ShareCountHistoryObservation,
  ShareCountHistoryReadFilter,
  ShareCountHistoryRepository,
} from "./shareCountHistory.ts";

const CIK = "0000000099";
const CLASS_A = `sc:v1:${CIK}:common_stock:us-gaap:CommonClassAMember`;
const CLASS_B = `sc:v1:${CIK}:common_stock:us-gaap:CommonClassBMember`;

test("A. date-only execution applies from its effective date without mutating history", async () => {
  const split = execution({ effectiveDate: "2026-08-25", oldShares: "10", newShares: "1" });
  const before = await normalize("2026-08-24T12:00:00Z", [split]);
  const onDate = await normalize("2026-08-25T12:00:00Z", [split]);
  const after = await normalize("2026-08-26T12:00:00Z", [split]);
  assertNormalized(before, "100000000", "1", []);
  assertNormalized(onDate, "10000000", "1", [split.executionId]);
  assertNormalized(after, "10000000", "1", [split.executionId]);
  assert.equal(before.originalResolution.supportingObservations[0]?.sharesOutstanding, "100000000");
});

test("B. after-market-close execution is not applied on the effective day basis", async () => {
  const split = execution({
    effectiveDate: "2026-08-25",
    oldShares: "10",
    newShares: "1",
    timing: {
      availability: "available",
      kind: "after_market_close",
      timestamp: null,
      source_ref: "split-timing",
      evidence: { availability: "available", value: "after the close of trading" },
    },
  });
  assertNormalized(await normalize("2026-08-25T23:00:00Z", [split]), "100000000", "1", []);
  assertNormalized(await normalize("2026-08-26T00:00:00Z", [split]), "10000000", "1", [split.executionId]);
});

test("an observation on an after-close effective date remains pre-split until the next day", async () => {
  const split = execution({
    effectiveDate: "2026-08-10",
    oldShares: "10",
    newShares: "1",
    timing: {
      availability: "available",
      kind: "after_market_close",
      timestamp: null,
      source_ref: "same-day-split-timing",
      evidence: { availability: "available", value: "after the close of trading" },
    },
  });
  const result = await normalize("2026-08-12T00:00:00Z", [split]);
  assertNormalized(result, "10000000", "1", [split.executionId]);
});

test("C. postponed execution applies only on the active replacement date", async () => {
  const replacement = execution({ effectiveDate: "2026-09-01", oldShares: "10", newShares: "1" });
  assertNormalized(await normalize("2026-08-31T12:00:00Z", [replacement]), "100000000", "1", []);
  assertNormalized(await normalize("2026-09-01T12:00:00Z", [replacement]), "10000000", "1", [replacement.executionId]);
});

test("D. cancelled execution is absent from the official active set and applies zero times", async () => {
  const result = await normalize("2026-08-26T12:00:00Z", []);
  assertNormalized(result, "100000000", "1", []);
});

test("E. ratio amendment applies only the active exact replacement ratio", async () => {
  const replacement = execution({ effectiveDate: "2026-08-25", oldShares: "20", newShares: "1" });
  assertNormalized(await normalize("2026-08-26T12:00:00Z", [replacement]), "5000000", "1", [replacement.executionId]);
});

test("F/G. duplicate execution objects and historical supporting observations apply once", async () => {
  const split = execution({ effectiveDate: "2026-08-25", oldShares: "10", newShares: "1", observationCount: 3 });
  const result = await normalize("2026-11-30T12:00:00Z", [split, structuredClone(split)]);
  assertNormalized(result, "10000000", "1", [split.executionId]);
  assert.equal(result.status === "NORMALIZED" && result.appliedExecutions[0]?.observations.length, 3);
});

test("H. multiple reverse splits apply once each in effective chronology", async () => {
  const first = execution({ effectiveDate: "2026-08-25", oldShares: "10", newShares: "1" });
  const second = execution({ effectiveDate: "2026-10-01", oldShares: "5", newShares: "1", sequence: 2 });
  const result = await normalize("2026-10-02T12:00:00Z", [second, first]);
  assertNormalized(result, "2000000", "1", [first.executionId, second.executionId]);
});

test("I. a different canonical security class is never applied", async () => {
  const classBSplit = execution({
    effectiveDate: "2026-08-25",
    oldShares: "10",
    newShares: "1",
    securityClassId: CLASS_B,
  });
  assertNormalized(await normalize("2026-08-26T12:00:00Z", [classBSplit]), "100000000", "1", []);
});

test("J. an official execution conflict fails closed without returning the historical number as current", async () => {
  const result = await normalize("2026-08-26T12:00:00Z", [], [conflict()]);
  assert.equal(result.status, "NORMALIZATION_UNAVAILABLE");
  assert.equal(result.reason, "EXECUTION_CONFLICT");
  assert.equal(result.normalizedExactShares, null);
  assert.equal(result.originalShares, "100000000");
  assert.equal(result.executionConflicts.length, 1);
});

test("K. nonstandard 2-for-15 ratio preserves the exact reduced fraction without rounding", async () => {
  const split = execution({ effectiveDate: "2026-08-25", oldShares: "15", newShares: "2" });
  const result = await normalize("2026-08-26T12:00:00Z", [split]);
  assertNormalized(result, "40000000", "3", [split.executionId]);
  assert.equal(result.normalizedIntegerShares, null);
});

test("L. identical inputs replay to the exact same deterministic result", async () => {
  const first = execution({ effectiveDate: "2026-08-25", oldShares: "10", newShares: "1" });
  const second = execution({ effectiveDate: "2026-10-01", oldShares: "5", newShares: "1", sequence: 2 });
  assert.deepEqual(
    await normalize("2026-10-02T12:00:00Z", [first, second]),
    await normalize("2026-10-02T12:00:00Z", [second, first]),
  );
});

test("fine-grained timing ambiguity uses the established effective date for day-basis calculation", async () => {
  const split = execution({
    effectiveDate: "2026-08-25",
    oldShares: "10",
    newShares: "1",
    timing: { availability: "unavailable", reason: "ambiguous" },
  });
  const sameDay = await normalize("2026-08-25T12:00:00Z", [split]);
  assertNormalized(sameDay, "10000000", "1", [split.executionId]);
  assertNormalized(await normalize("2026-08-26T12:00:00Z", [split]), "10000000", "1", [split.executionId]);
});

test("invalid exact ratio identity and missing execution provenance fail closed", async () => {
  const invalidRatio = execution({ effectiveDate: "2026-08-25", oldShares: "10", newShares: "1" });
  invalidRatio.exactRatio.oldShareUnits = "0";
  const ratioResult = await normalize("2026-08-26T12:00:00Z", [invalidRatio]);
  assert.equal(ratioResult.status, "NORMALIZATION_UNAVAILABLE");
  assert.equal(ratioResult.reason, "EXECUTION_RATIO_INVALID");

  const missingProvenance = execution({ effectiveDate: "2026-08-25", oldShares: "10", newShares: "1" });
  missingProvenance.observations = [];
  const provenanceResult = await normalize("2026-08-26T12:00:00Z", [missingProvenance]);
  assert.equal(provenanceResult.status, "NORMALIZATION_UNAVAILABLE");
  assert.equal(provenanceResult.reason, "EXECUTION_PROVENANCE_INVALID");
});

test("a malformed execution-reader result fails closed", async () => {
  const result = await normalizeClassShareCountAt(
    {
      repository: new StaticHistoryRepository([shareCountObservation()]),
      cik: CIK,
      securityClassId: CLASS_A,
      targetAt: "2026-08-26T12:00:00Z",
    },
    { readExecutions: async () => undefined as never },
  );
  assert.equal(result.status, "NORMALIZATION_UNAVAILABLE");
  assert.equal(result.reason, "EXECUTION_READER_INVALID");
  assert.equal(result.normalizedExactShares, null);
});

test("the official class resolver remains the only O/S selector and normalization performs no writes", async () => {
  const repository = new StaticHistoryRepository([shareCountObservation()]);
  await normalizeClassShareCountAt(
    { repository, cik: CIK, securityClassId: CLASS_A, targetAt: "2026-08-26T12:00:00Z" },
    { readExecutions: executionReader([]) },
  );
  assert.equal(repository.readCount, 1);
  assert.equal(repository.writeCount, 0);
  assert.deepEqual(repository.lastFilter, { asOfTo: "2026-08-26", canonicalSecurityClassId: CLASS_A });
});

function normalize(
  targetAt: string,
  executions: ReverseSplitExecution[],
  conflicts: ReverseSplitExecutionConflict[] = [],
) {
  return normalizeClassShareCountAt(
    {
      repository: new StaticHistoryRepository([shareCountObservation()]),
      cik: CIK,
      securityClassId: CLASS_A,
      targetAt,
    },
    { readExecutions: executionReader(executions, conflicts) },
  );
}

function executionReader(
  executions: ReverseSplitExecution[],
  conflicts: ReverseSplitExecutionConflict[] = [],
  inactiveExecutions: InactiveReverseSplitExecution[] = [],
): NonNullable<ReverseSplitShareBasisNormalizerDependencies["readExecutions"]> {
  return async (input): Promise<ReverseSplitExecutionReadResult> => ({
    status: "available",
    issuerCik: input.cik,
    canonicalSecurityClassId: input.canonicalSecurityClassId ?? null,
    from: input.from,
    to: input.to,
    targetAt: input.targetAt,
    basisChangeCoverage: "reverse_split_only",
    executions: structuredClone(executions),
    inactiveExecutions: structuredClone(inactiveExecutions),
    conflicts: structuredClone(conflicts),
  });
}

function execution(input: {
  effectiveDate: string;
  oldShares: string;
  newShares: string;
  sequence?: number;
  securityClassId?: string;
  observationCount?: number;
  timing?: ReverseSplitExecution["effectiveTiming"];
}): ReverseSplitExecution {
  const securityClassId = input.securityClassId ?? CLASS_A;
  const executionId = reverseSplitExecutionId({
    issuerCik: CIK,
    canonicalSecurityClassId: securityClassId,
    effectiveDate: input.effectiveDate,
    oldShareUnits: input.oldShares,
    newShareUnits: input.newShares,
  });
  const timing = input.timing ?? { availability: "unavailable" as const, reason: "date_only" as const };
  const sequence = input.sequence ?? 1;
  return {
    version: REVERSE_SPLIT_EXECUTION_VERSION,
    status: "CALCULATION_ELIGIBLE",
    executionStatus: "scheduled",
    executionId,
    issuerCik: CIK,
    canonicalSecurityClassId: securityClassId,
    effectiveDate: input.effectiveDate,
    exactRatio: { oldShareUnits: input.oldShares, newShareUnits: input.newShares },
    effectiveTiming: timing,
    observations: Array.from({ length: input.observationCount ?? 1 }, (_, index) => {
      const suffix = sequence * 10 + index;
      const accession = `0000000099-26-${suffix.toString().padStart(6, "0")}`;
      return {
        eventId: uuid(suffix, 1),
        sourceExecutionId: uuid(suffix, 2),
        issuerCik: CIK,
        canonicalSecurityClassId: securityClassId,
        accessionNumber: accession,
        acceptedAt: `2026-08-${Math.min(10 + suffix, 28).toString().padStart(2, "0")}T10:00:00.000Z`,
        actionStage: "scheduled",
        exactRatio: { oldShareUnits: input.oldShares, newShareUnits: input.newShares },
        effectiveDate: input.effectiveDate,
        effectiveTiming: timing,
        sourceRef: `split-source-${suffix}`,
        evidence: { availability: "available", value: `Exact reverse split evidence ${suffix}` },
        source: { source_family: "sec", source_id: accession, source_url: `https://www.sec.gov/${accession}` },
        persistedAt: "2026-08-22T00:00:00.000Z",
        facts: {} as CorporateActionCanonicalFacts,
      };
    }),
  };
}

function conflict(): ReverseSplitExecutionConflict {
  const first = execution({ effectiveDate: "2026-08-25", oldShares: "10", newShares: "1" });
  const second = execution({ effectiveDate: "2026-08-25", oldShares: "20", newShares: "1", sequence: 2 });
  return {
    version: REVERSE_SPLIT_EXECUTION_VERSION,
    status: "EXECUTION_CONFLICT",
    executionStatus: "conflict",
    conflictId: `rsec:v1:${"c".repeat(64)}`,
    issuerCik: CIK,
    canonicalSecurityClassId: CLASS_A,
    effectiveDate: "2026-08-25",
    reasons: ["FINAL_RATIO_CONFLICT"],
    candidateExecutionIds: [first.executionId, second.executionId],
    observations: [...first.observations, ...second.observations],
  };
}

function assertNormalized(
  value: Awaited<ReturnType<typeof normalize>>,
  numerator: string,
  denominator: string,
  executionIds: string[],
) {
  assert.equal(value.status, "NORMALIZED");
  assert.deepEqual(value.normalizedExactShares, { numerator, denominator });
  assert.deepEqual(value.appliedExecutionIds, executionIds);
}

class StaticHistoryRepository implements ShareCountHistoryRepository {
  readCount = 0;
  writeCount = 0;
  lastFilter: ShareCountHistoryReadFilter | undefined;
  private readonly rows: ShareCountHistoryObservation[];

  constructor(rows: ShareCountHistoryObservation[]) {
    this.rows = rows;
  }

  async insertObservation(): Promise<boolean> {
    this.writeCount += 1;
    throw new Error("normalizer must remain read-only");
  }

  async readHistory(cik: string, filter: ShareCountHistoryReadFilter = {}) {
    this.readCount += 1;
    this.lastFilter = structuredClone(filter);
    return this.rows
      .filter((row) => row.issuerCik === cik)
      .filter((row) => !filter.asOfTo || row.asOf <= filter.asOfTo)
      .filter((row) => !filter.canonicalSecurityClassId
        || row.canonicalSecurityClassId === filter.canonicalSecurityClassId)
      .map((row) => structuredClone(row));
  }
}

function shareCountObservation(): ShareCountHistoryObservation {
  return {
    id: "share-count-fixture",
    observationType: "authoritative_xbrl",
    issuerCik: CIK,
    sharesOutstanding: "100000000",
    asOf: "2026-08-10",
    securityClassBasis: "CLASS_SPECIFIC_COMMON_STOCK",
    securityClassIdentity: { canonicalKey: "class-a", identity: { class: "A" } },
    securityClassMetadata: { class: "A" },
    canonicalSecurityClassId: CLASS_A,
    canonicalSecurityClassKind: "common_stock",
    canonicalSecurityClassStatus: "mapped",
    canonicalSecurityClassProvenance: { fixture: "class-a" },
    shareBasisIdentity: "shares_outstanding:xbrli_shares",
    shareBasisMetadata: { unit: "shares" },
    accessionNumber: "0000000099-26-000001",
    form: "10-Q",
    filingDocument: "fixture.htm",
    filedDate: "2026-08-11",
    acceptedAt: "2026-08-11T10:00:00.000Z",
    acceptedAtSource: "sec_filing_ledger",
    acceptedAtProvenance: { source: "sec_filing_ledger.accepted_at" },
    ingestedAt: "2026-08-12T00:00:00.000Z",
    sourceConceptNamespaceUri: "http://xbrl.sec.gov/dei/2025",
    sourceConceptLocalName: "EntityCommonStockSharesOutstanding",
    sourceFactKey: "a".repeat(64),
    sourceContextRef: "context-class-a",
    sourceArtifactId: "10000000-0000-5000-8000-000000000001",
    filingLedgerRawSourceId: "20000000-0000-5000-8000-000000000001",
    sourceFactIdentity: { fixture: "fact" },
    sourceContext: { fixture: "context" },
    sourceDimensions: [],
    sourceProvenance: { fixture: "provenance" },
    sourceType: "sec_authoritative_os",
    authoritativeStatus: "ELIGIBLE",
    authoritativeDecisionVersion: "authoritative-os-extraction-v1",
    authoritativeDecisionReason: "ELIGIBLE_CLASS_SPECIFIC_DEI_CONTEXT",
    authoritativeDecisionLineage: { fixture: "decision" },
    sourceDocumentUrl: "https://www.sec.gov/Archives/edgar/data/99/fixture.htm",
    sourceContentHash: "b".repeat(64),
    sourceEvidence: null,
    sourceAnalyzer: null,
  } as ShareCountHistoryObservation;
}

function uuid(sequence: number, offset: number) {
  return `72000000-0000-4000-8000-${(sequence * 10 + offset).toString().padStart(12, "0")}`;
}
