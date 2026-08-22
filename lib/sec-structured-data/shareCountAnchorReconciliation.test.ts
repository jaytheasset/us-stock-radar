import assert from "node:assert/strict";
import test from "node:test";
import type { CorporateActionCanonicalFacts } from "../monitor/corporateActionCanonicalFacts.ts";
import {
  FORWARD_SPLIT_EXECUTION_VERSION,
  REVERSE_SPLIT_EXECUTION_VERSION,
  stockSplitExecutionId,
  type ReverseSplitExecutionConflict,
  type ForwardSplitExecution,
  type ReverseSplitExecution,
  type StockSplitExecution,
  type StockSplitExecutionReadResult,
} from "../monitor/reverseSplitExecution.ts";
import { resolveClassShareCountAt } from "./classShareCountResolver.ts";
import {
  reconcileShareCountAnchors,
  type ShareCountAnchorReconciliationDependencies,
} from "./shareCountAnchorReconciliation.ts";
import type {
  AuthoritativeShareCountHistoryObservation,
  Level2ShareCountHistoryObservation,
  ShareCountHistoryObservation,
  ShareCountHistoryReadFilter,
  ShareCountHistoryRepository,
} from "./shareCountHistory.ts";

const CIK = "0000000099";
const CLASS_A = `sc:v1:${CIK}:common_stock:us-gaap:CommonClassAMember`;
const CLASS_B = `sc:v1:${CIK}:common_stock:us-gaap:CommonClassBMember`;

test("A. authoritative anchors without a split reconcile +11M and +55%", async () => {
  const repository = historyRepository([
    anchor({ asOf: "2026-06-30", shares: "20000000", sequence: 1 }),
    anchor({ asOf: "2026-09-30", shares: "31000000", sequence: 2 }),
  ]);
  const result = await reconcile(repository);
  assert.equal(result.status, "RECONCILED");
  assert.deepEqual(result.normalizedStartShares, { numerator: "20000000", denominator: "1" });
  assert.deepEqual(result.endShares, { numerator: "31000000", denominator: "1" });
  assert.deepEqual(result.netChangeShares, { numerator: "11000000", denominator: "1" });
  assert.deepEqual(result.netChangePct, { numerator: "55", denominator: "1" });
  assert.deepEqual(result.coverage, ["authoritative_periodic_anchor", "stock_split_basis_normalization"]);
});

test("B. start anchor is normalized to the end-anchor basis before calculating +2M", async () => {
  const repository = historyRepository([
    anchor({ asOf: "2026-06-30", shares: "100000000", sequence: 1 }),
    anchor({ asOf: "2026-09-30", shares: "12000000", sequence: 2 }),
  ]);
  const split = execution({ effectiveDate: "2026-07-15", oldShares: "10", newShares: "1" });
  const result = await reconcile(repository, executionReader([split]));
  assert.equal(result.status, "RECONCILED");
  assert.deepEqual(result.normalizedStartShares, { numerator: "10000000", denominator: "1" });
  assert.deepEqual(result.netChangeShares, { numerator: "2000000", denominator: "1" });
  assert.deepEqual(result.netChangePct, { numerator: "20", denominator: "1" });
  assert.deepEqual(result.appliedStockSplitExecutions.map((row) => row.executionId), [split.executionId]);
});

test("J. a 4-for-1 forward split normalizes a 100M start anchor before the 430M end anchor", async () => {
  const repository = historyRepository([
    anchor({ asOf: "2026-06-30", shares: "100000000", sequence: 1 }),
    anchor({ asOf: "2026-09-30", shares: "430000000", sequence: 2 }),
  ]);
  const split = execution({
    kind: "forward_split",
    effectiveDate: "2026-07-15",
    oldShares: "1",
    newShares: "4",
  });
  const result = await reconcile(repository, executionReader([split]));
  assert.equal(result.status, "RECONCILED");
  assert.deepEqual(result.normalizedStartShares, { numerator: "400000000", denominator: "1" });
  assert.deepEqual(result.netChangeShares, { numerator: "30000000", denominator: "1" });
  assert.deepEqual(result.netChangePct, { numerator: "15", denominator: "2" });
  assert.equal(result.appliedStockSplitExecutions[0]!.kind, "forward_split");
});

test("C. Level 2 values between anchors are preserved as non-conflicting intermediate points", async () => {
  const repository = historyRepository([
    anchor({ asOf: "2026-06-30", shares: "20000000", sequence: 1 }),
    level2({ asOf: "2026-07-31", shares: "24000000", sequence: 3 }),
    level2({ asOf: "2026-08-31", shares: "28000000", sequence: 4 }),
    anchor({ asOf: "2026-09-30", shares: "31000000", sequence: 2 }),
  ]);
  const result = await reconcile(repository);
  assert.equal(result.status, "RECONCILED");
  assert.deepEqual(result.intermediateObservations.map((row) => [
    row.asOf, row.sourceShares, row.normalizedIntegerShares,
  ]), [
    ["2026-07-31", "24000000", "24000000"],
    ["2026-08-31", "28000000", "28000000"],
  ]);
  assert.equal(result.conflicts.length, 0);
});

test("D. same class and as-of with different values is a conflict without a winner", async () => {
  const first = level2({ asOf: "2026-07-31", shares: "24000000", sequence: 3 });
  const second = level2({ asOf: "2026-07-31", shares: "25000000", sequence: 4 });
  const result = await reconcile(historyRepository([
    anchor({ asOf: "2026-06-30", shares: "20000000", sequence: 1 }),
    first,
    second,
    anchor({ asOf: "2026-09-30", shares: "31000000", sequence: 2 }),
  ]));
  assert.equal(result.status, "CONFLICT");
  assert.equal(result.reason, "INTERMEDIATE_OBSERVATION_CONFLICT");
  assert.deepEqual(result.conflicts[0]?.sharesOutstandingValues, ["24000000", "25000000"]);
  assert.equal(result.normalizedStartShares, null);
});

test("E. reconciliation is hindsight-only and never changes the earlier event-time resolver view", async () => {
  const repository = historyRepository([
    anchor({ asOf: "2026-06-30", shares: "20000000", sequence: 1, acceptedAt: "2026-07-10T10:00:00Z" }),
    anchor({ asOf: "2026-09-30", shares: "31000000", sequence: 2, acceptedAt: "2026-11-05T10:00:00Z" }),
  ]);
  const before = await resolveClassShareCountAt({
    repository,
    cik: CIK,
    securityClassId: CLASS_A,
    targetAt: "2026-07-20T12:00:00Z",
  });
  const reconciled = await reconcile(repository);
  const after = await resolveClassShareCountAt({
    repository,
    cik: CIK,
    securityClassId: CLASS_A,
    targetAt: "2026-07-20T12:00:00Z",
  });
  assert.equal(reconciled.status, "RECONCILED");
  assert.deepEqual(after, before);
  assert.equal(after.status === "RESOLVED" && after.sharesOutstanding, "20000000");
  assert.equal(repository.writeCount, 0);
});

test("F. unavailable reverse-split normalization fails closed without estimating numbers", async () => {
  const result = await reconcile(historyRepository([
    anchor({ asOf: "2026-06-30", shares: "100000000", sequence: 1 }),
    anchor({ asOf: "2026-09-30", shares: "12000000", sequence: 2 }),
  ]), executionReader([], [executionConflict()]));
  assert.equal(result.status, "RECONCILIATION_UNAVAILABLE");
  assert.equal(result.reason, "START_BASIS_NORMALIZATION_UNAVAILABLE");
  assert.equal(result.netChangeShares, null);
  assert.equal(result.normalizationFailures[0]?.status, "NORMALIZATION_UNAVAILABLE");
  assert.equal(result.normalizationFailures[0]?.reason, "EXECUTION_CONFLICT");
});

test("G. a change above 100% is still a valid net-change result", async () => {
  const result = await reconcile(historyRepository([
    anchor({ asOf: "2026-06-30", shares: "20000000", sequence: 1 }),
    anchor({ asOf: "2026-09-30", shares: "50000000", sequence: 2 }),
  ]));
  assert.equal(result.status, "RECONCILED");
  assert.deepEqual(result.netChangeShares, { numerator: "30000000", denominator: "1" });
  assert.deepEqual(result.netChangePct, { numerator: "150", denominator: "1" });
});

test("H. identical input replay returns a deterministic identical result and performs no writes", async () => {
  const repository = historyRepository([
    anchor({ asOf: "2026-06-30", shares: "20000000", sequence: 1 }),
    level2({ asOf: "2026-08-01", shares: "25000000", sequence: 3 }),
    anchor({ asOf: "2026-09-30", shares: "31000000", sequence: 2 }),
  ]);
  assert.deepEqual(await reconcile(repository), await reconcile(repository));
  assert.equal(repository.writeCount, 0);
});

test("anchor selection uses the O/S fact as-of, not the report-period or filing date", async () => {
  const start = anchor({ asOf: "2026-08-02", shares: "20000000", sequence: 1, filedDate: "2026-08-05" });
  start.sourceProvenance.reportPeriod = "2026-06-30";
  const end = anchor({ asOf: "2026-11-02", shares: "22000000", sequence: 2, filedDate: "2026-11-05" });
  const repository = historyRepository([start, end]);
  const result = await reconcileShareCountAnchors({
    repository,
    cik: CIK,
    securityClassId: CLASS_A,
    startAnchor: { asOf: "2026-08-02" },
    endAnchor: { asOf: "2026-11-02" },
  }, { readExecutions: executionReader([]) });
  assert.equal(result.status, "RECONCILED");
  assert.equal(result.startAnchor?.asOf, "2026-08-02");
  assert.equal(result.startAnchor?.selectedObservation.filedDate, "2026-08-05");
});

test("Level 2 and non-periodic filings cannot become anchors", async () => {
  const onlyLevel2 = historyRepository([
    level2({ asOf: "2026-06-30", shares: "20000000", sequence: 1 }),
    anchor({ asOf: "2026-09-30", shares: "31000000", sequence: 2 }),
  ]);
  assert.equal((await reconcile(onlyLevel2)).reason, "START_ANCHOR_NOT_FOUND");

  const nonPeriodic = anchor({ asOf: "2026-06-30", shares: "20000000", sequence: 3, form: "8-K" });
  assert.equal((await reconcile(historyRepository([
    nonPeriodic,
    anchor({ asOf: "2026-09-30", shares: "31000000", sequence: 4 }),
  ]))).reason, "START_ANCHOR_NOT_FOUND");
});

test("an already-authoritative 20-F periodic row is accepted without relaxing the foreign extractor", async () => {
  const result = await reconcile(historyRepository([
    anchor({ asOf: "2026-06-30", shares: "20000000", sequence: 1, form: "20-F" }),
    anchor({ asOf: "2026-09-30", shares: "21000000", sequence: 2, form: "20-F/A" }),
  ]));
  assert.equal(result.status, "RECONCILED");
  assert.equal(result.startAnchor?.selectedObservation.form, "20-F");
});

test("a conflicting same-date Level 2 observation also blocks an anchor boundary", async () => {
  const result = await reconcile(historyRepository([
    anchor({ asOf: "2026-06-30", shares: "20000000", sequence: 1 }),
    level2({ asOf: "2026-06-30", shares: "21000000", sequence: 3 }),
    anchor({ asOf: "2026-09-30", shares: "31000000", sequence: 2 }),
  ]));
  assert.equal(result.status, "CONFLICT");
  assert.equal(result.reason, "START_ANCHOR_CONFLICT");
});

test("untrusted intermediate acceptance provenance makes reconciliation unavailable", async () => {
  const intermediate = level2({ asOf: "2026-08-01", shares: "24000000", sequence: 3 });
  intermediate.acceptedAt = null;
  intermediate.acceptedAtSource = "unavailable";
  intermediate.acceptedAtProvenance = { source: "unavailable", reason: "source omitted acceptance timestamp" };
  const result = await reconcile(historyRepository([
    anchor({ asOf: "2026-06-30", shares: "20000000", sequence: 1 }),
    intermediate,
    anchor({ asOf: "2026-09-30", shares: "31000000", sequence: 2 }),
  ]));
  assert.equal(result.status, "RECONCILIATION_UNAVAILABLE");
  assert.equal(result.reason, "INTERMEDIATE_PROVENANCE_INVALID");
});

test("exact fractional start normalization remains exact through net change and percentage", async () => {
  const split = execution({ effectiveDate: "2026-07-15", oldShares: "15", newShares: "2" });
  const result = await reconcile(historyRepository([
    anchor({ asOf: "2026-06-30", shares: "100000000", sequence: 1 }),
    anchor({ asOf: "2026-09-30", shares: "20000000", sequence: 2 }),
  ]), executionReader([split]));
  assert.equal(result.status, "RECONCILED");
  assert.deepEqual(result.normalizedStartShares, { numerator: "40000000", denominator: "3" });
  assert.deepEqual(result.netChangeShares, { numerator: "20000000", denominator: "3" });
  assert.deepEqual(result.netChangePct, { numerator: "50", denominator: "1" });
});

test("repository class leakage fails closed and Class B never participates in Class A reconciliation", async () => {
  const repository = historyRepository([
    anchor({ asOf: "2026-06-30", shares: "20000000", sequence: 1 }),
    anchor({ asOf: "2026-08-01", shares: "90000000", sequence: 3, securityClassId: CLASS_B }),
    anchor({ asOf: "2026-09-30", shares: "31000000", sequence: 2 }),
  ], false);
  const result = await reconcile(repository);
  assert.equal(result.status, "RECONCILIATION_UNAVAILABLE");
  assert.equal(result.reason, "SECURITY_IDENTITY_MISMATCH");
});

function reconcile(
  repository: StaticHistoryRepository,
  readExecutions = executionReader([]),
) {
  return reconcileShareCountAnchors({
    repository,
    cik: CIK,
    securityClassId: CLASS_A,
    startAnchor: { asOf: "2026-06-30" },
    endAnchor: { asOf: "2026-09-30" },
  }, { readExecutions });
}

function executionReader(
  executions: StockSplitExecution[],
  conflicts: ReverseSplitExecutionConflict[] = [],
): NonNullable<ShareCountAnchorReconciliationDependencies["readExecutions"]> {
  return async (input): Promise<StockSplitExecutionReadResult> => input.actionKind === "forward_split" ? ({
    status: "available",
    issuerCik: input.cik,
    canonicalSecurityClassId: input.canonicalSecurityClassId ?? null,
    from: input.from,
    to: input.to,
    targetAt: input.targetAt,
    basisChangeCoverage: "forward_split_only",
    executions: structuredClone(executions.filter((item): item is ForwardSplitExecution =>
      item.version === FORWARD_SPLIT_EXECUTION_VERSION)),
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
    executions: structuredClone(executions.filter((item): item is ReverseSplitExecution =>
      item.version === REVERSE_SPLIT_EXECUTION_VERSION)),
    inactiveExecutions: [],
    conflicts: structuredClone(conflicts),
  });
}

function execution(input: {
  kind?: "forward_split" | "reverse_split";
  effectiveDate: string;
  oldShares: string;
  newShares: string;
}): StockSplitExecution {
  const kind = input.kind ?? "reverse_split";
  const executionId = stockSplitExecutionId({
    actionKind: kind,
    issuerCik: CIK,
    canonicalSecurityClassId: CLASS_A,
    effectiveDate: input.effectiveDate,
    oldShareUnits: input.oldShares,
    newShareUnits: input.newShares,
  });
  const accession = "0000000099-26-000090";
  return {
    version: kind === "forward_split" ? FORWARD_SPLIT_EXECUTION_VERSION : REVERSE_SPLIT_EXECUTION_VERSION,
    status: "CALCULATION_ELIGIBLE",
    executionStatus: "scheduled",
    executionId,
    issuerCik: CIK,
    canonicalSecurityClassId: CLASS_A,
    effectiveDate: input.effectiveDate,
    exactRatio: { oldShareUnits: input.oldShares, newShareUnits: input.newShares },
    effectiveTiming: { availability: "unavailable", reason: "date_only" },
    observations: [{
      eventId: uuid(90, 1),
      sourceExecutionId: uuid(90, 2),
      issuerCik: CIK,
      canonicalSecurityClassId: CLASS_A,
      accessionNumber: accession,
      acceptedAt: "2026-07-01T10:00:00.000Z",
      actionStage: "scheduled",
      exactRatio: { oldShareUnits: input.oldShares, newShareUnits: input.newShares },
      effectiveDate: input.effectiveDate,
      effectiveTiming: { availability: "unavailable", reason: "date_only" },
      sourceRef: "reverse-split-source",
      evidence: { availability: "available", value: "Exact reverse split ratio and effective date." },
      source: { source_family: "sec", source_id: accession, source_url: `https://www.sec.gov/${accession}` },
      persistedAt: "2026-08-22T00:00:00.000Z",
      facts: {} as CorporateActionCanonicalFacts,
    }],
  };
}

function executionConflict(): ReverseSplitExecutionConflict {
  const first = execution({ effectiveDate: "2026-07-15", oldShares: "10", newShares: "1" });
  const second = execution({ effectiveDate: "2026-07-15", oldShares: "20", newShares: "1" });
  return {
    version: REVERSE_SPLIT_EXECUTION_VERSION,
    status: "EXECUTION_CONFLICT",
    executionStatus: "conflict",
    conflictId: `rsec:v1:${"c".repeat(64)}`,
    issuerCik: CIK,
    canonicalSecurityClassId: CLASS_A,
    effectiveDate: "2026-07-15",
    reasons: ["FINAL_RATIO_CONFLICT"],
    candidateExecutionIds: [first.executionId, second.executionId],
    observations: [...first.observations, ...second.observations],
  };
}

function historyRepository(rows: ShareCountHistoryObservation[], applyFilter = true) {
  return new StaticHistoryRepository(rows, applyFilter);
}

class StaticHistoryRepository implements ShareCountHistoryRepository {
  writeCount = 0;
  private readonly rows: ShareCountHistoryObservation[];
  private readonly applyFilter: boolean;

  constructor(rows: ShareCountHistoryObservation[], applyFilter = true) {
    this.rows = rows;
    this.applyFilter = applyFilter;
  }

  async insertObservation(): Promise<boolean> {
    this.writeCount += 1;
    throw new Error("reconciliation must remain read-only");
  }

  async readHistory(cik: string, filter: ShareCountHistoryReadFilter = {}) {
    return this.rows
      .filter((row) => row.issuerCik === cik)
      .filter((row) => !this.applyFilter || !filter.asOfFrom || row.asOf >= filter.asOfFrom)
      .filter((row) => !this.applyFilter || !filter.asOfTo || row.asOf <= filter.asOfTo)
      .filter((row) => !this.applyFilter || !filter.canonicalSecurityClassId
        || row.canonicalSecurityClassId === filter.canonicalSecurityClassId)
      .map((row) => structuredClone(row));
  }
}

function anchor(input: {
  asOf: string;
  shares: string;
  sequence: number;
  acceptedAt?: string;
  filedDate?: string;
  form?: string;
  securityClassId?: string;
}): AuthoritativeShareCountHistoryObservation {
  const accession = `0000000099-26-${input.sequence.toString().padStart(6, "0")}`;
  const factKey = input.sequence.toString(16).padStart(64, "a").slice(-64);
  const contentHash = input.sequence.toString(16).padStart(64, "b").slice(-64);
  const securityClassId = input.securityClassId ?? CLASS_A;
  return {
    id: `anchor-${input.sequence}`,
    observationType: "authoritative_xbrl",
    issuerCik: CIK,
    sharesOutstanding: input.shares,
    asOf: input.asOf,
    securityClassBasis: "CLASS_SPECIFIC_COMMON_STOCK",
    securityClassIdentity: { canonicalKey: "class-a", identity: { class: "A" } },
    securityClassMetadata: { evidenceFactKey: factKey, contextRef: `context-${input.sequence}`, dimensions: [] },
    canonicalSecurityClassId: securityClassId,
    canonicalSecurityClassKind: "common_stock",
    canonicalSecurityClassStatus: "mapped",
    canonicalSecurityClassProvenance: { fixture: "class-a" },
    shareBasisIdentity: "shares_outstanding:xbrli_shares",
    shareBasisMetadata: { measurement: "shares_outstanding", unit: { namespaceUri: "http://www.xbrl.org/2003/instance", localName: "shares" } },
    accessionNumber: accession,
    form: input.form ?? "10-Q",
    filingDocument: `filing-${input.sequence}.htm`,
    filedDate: input.filedDate ?? "2026-10-05",
    acceptedAt: input.acceptedAt ?? `2026-10-${Math.min(input.sequence + 5, 28).toString().padStart(2, "0")}T10:00:00.000Z`,
    acceptedAtSource: "sec_filing_ledger",
    acceptedAtProvenance: { source: "sec_filing_ledger.accepted_at" },
    ingestedAt: "2026-11-01T00:00:00.000Z",
    sourceConceptNamespaceUri: "http://xbrl.sec.gov/dei/2026",
    sourceConceptLocalName: "EntityCommonStockSharesOutstanding",
    sourceFactKey: factKey,
    sourceContextRef: `context-${input.sequence}`,
    sourceArtifactId: uuid(input.sequence, 3),
    filingLedgerRawSourceId: uuid(input.sequence, 4),
    sourceFactIdentity: { factKey },
    sourceContext: { id: `context-${input.sequence}`, period: { kind: "instant", instant: input.asOf }, entityIdentifier: CIK, dimensions: [] },
    sourceDimensions: [],
    sourceProvenance: { companyFacts: [{ sourceFactKey: factKey }], filingFactSource: { artifactId: uuid(input.sequence, 3) } },
    sourceType: "sec_authoritative_os",
    authoritativeStatus: "ELIGIBLE",
    authoritativeDecisionVersion: "authoritative-os-extraction-v1",
    authoritativeDecisionReason: "ELIGIBLE_CLASS_SPECIFIC_DEI_CONTEXT",
    authoritativeDecisionLineage: { status: "ELIGIBLE", candidate: { asOf: input.asOf, form: input.form ?? "10-Q", accession } },
    sourceDocumentUrl: `https://www.sec.gov/Archives/${accession}/filing.htm`,
    sourceContentHash: contentHash,
    sourceEvidence: null,
    sourceAnalyzer: null,
  };
}

function level2(input: { asOf: string; shares: string; sequence: number }): Level2ShareCountHistoryObservation {
  const accession = `0000000099-26-${input.sequence.toString().padStart(6, "0")}`;
  const factKey = input.sequence.toString(16).padStart(64, "c").slice(-64);
  return {
    id: `level2-${input.sequence}`,
    observationType: "source_stated",
    issuerCik: CIK,
    sharesOutstanding: input.shares,
    asOf: input.asOf,
    securityClassBasis: "SOURCE_STATED_SECURITY_CLASS",
    securityClassIdentity: { canonicalKey: "level2-class-a", identity: { title: "Class A common stock" } },
    securityClassMetadata: { sourceRef: `source-${input.sequence}`, evidence: "Exact source-stated O/S." },
    canonicalSecurityClassId: CLASS_A,
    canonicalSecurityClassKind: "common_stock",
    canonicalSecurityClassStatus: "mapped",
    canonicalSecurityClassProvenance: { fixture: "mapped-to-class-a" },
    shareBasisIdentity: "shares_outstanding:source_stated",
    shareBasisMetadata: { measurement: "shares_outstanding", unit: { kind: "shares", representation: "positive_integer" } },
    accessionNumber: accession,
    form: "8-K",
    filingDocument: `level2-${input.sequence}.htm`,
    filedDate: input.asOf,
    acceptedAt: `${input.asOf}T15:00:00.000Z`,
    acceptedAtSource: "sec_raw_payload_acceptance",
    acceptedAtProvenance: { source: "raw_items.raw_payload.accepted_at" },
    ingestedAt: `${input.asOf}T16:00:00.000Z`,
    sourceConceptNamespaceUri: null,
    sourceConceptLocalName: null,
    sourceFactKey: factKey,
    sourceContextRef: `source-${input.sequence}`,
    sourceArtifactId: uuid(input.sequence, 5),
    filingLedgerRawSourceId: null,
    sourceFactIdentity: { factKey, sourceRef: `source-${input.sequence}` },
    sourceContext: { sourceRef: `source-${input.sequence}`, asOf: input.asOf, issuerCik: CIK },
    sourceDimensions: [],
    sourceProvenance: { rawItemId: uuid(input.sequence, 5), eventId: uuid(input.sequence, 6) },
    sourceType: "sec_filing_text_level2",
    authoritativeStatus: null,
    authoritativeDecisionVersion: null,
    authoritativeDecisionReason: null,
    authoritativeDecisionLineage: null,
    sourceDocumentUrl: `https://www.sec.gov/Archives/${accession}/level2.htm`,
    sourceContentHash: input.sequence.toString(16).padStart(64, "d").slice(-64),
    sourceEvidence: "Exact source-stated O/S.",
    sourceAnalyzer: "sec-level2-share-count-v1",
  };
}

function uuid(sequence: number, offset: number) {
  return `73000000-0000-4000-8000-${(sequence * 10 + offset).toString().padStart(12, "0")}`;
}
