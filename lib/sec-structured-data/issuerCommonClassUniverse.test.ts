import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type {
  SecAuthoritativeOsDecision,
  SecAuthoritativeOsFilingFactEvidence,
  SecAuthoritativeOsReason,
  SecAuthoritativeOsStatus,
} from "./authoritativeOsExtraction.ts";
import {
  InMemoryIssuerCommonClassUniverseRepository,
  ISSUER_COMMON_CLASS_UNIVERSE_STATUSES,
  ISSUER_COMMON_CLASS_UNIVERSE_VERSION,
  ISSUER_COMMON_CLASS_UNIVERSE_VERSIONS,
  PostgresIssuerCommonClassUniverseRepository,
  deriveIssuerCommonClassUniverseSnapshot,
  readIssuerCommonClassUniverseAt,
  readLatestUsableOsIncrementalBoundary,
  readLatestUsablePeriodicOsBaseline,
  writeIssuerCommonClassUniverseSnapshot,
} from "./issuerCommonClassUniverse.ts";
import type {
  ShareCountHistoryObservation,
  ShareCountHistoryRepository,
  ShareCountHistorySqlClient,
} from "./shareCountHistory.ts";
import type { IssuerCommonClassUniverseSnapshot } from "./issuerCommonClassUniverse.ts";

const CIK = "0000000099";
const AS_OF = "2026-06-30";
const ACCEPTED_AT = "2026-08-01T12:30:45.000Z";
const US_GAAP = "http://fasb.org/us-gaap/2026";

test("universe status and version contracts are bounded", () => {
  assert.equal(ISSUER_COMMON_CLASS_UNIVERSE_VERSION, "issuer-common-class-universe-snapshot-v2");
  assert.deepEqual(ISSUER_COMMON_CLASS_UNIVERSE_VERSIONS, [
    "issuer-common-class-universe-snapshot-v1",
    "issuer-common-class-universe-snapshot-v2",
    "issuer-common-class-universe-prospectus-text-v1",
  ]);
  assert.deepEqual(ISSUER_COMMON_CLASS_UNIVERSE_STATUSES, [
    "COMPLETE_SINGLE",
    "COMPLETE_MULTI",
    "INCOMPLETE",
    "AMBIGUOUS",
  ]);
});

test("complete primary IXDS with one axis-free DEI fact produces COMPLETE_SINGLE", () => {
  const snapshot = deriveIssuerCommonClassUniverseSnapshot(decision({
    facts: [fact({ value: "20000000" })],
    status: "ELIGIBLE",
    reason: "ELIGIBLE_SINGLE_COMMON_STOCK_DEI_CONTEXT",
  }));

  assert.equal(snapshot.status, "COMPLETE_SINGLE");
  assert.equal(snapshot.reason, "COMPLETE_SINGLE_COMMON_STOCK");
  assert.deepEqual(snapshot.requiredCanonicalSecurityClassIds, [
    `sc:v1:${CIK}:common_stock:single`,
  ]);
  assert.equal(snapshot.classEvidence[0]?.sharesOutstanding, "20000000");
  assert.equal(snapshot.universeAsOf, AS_OF);
  assert.equal(snapshot.acceptedAt, ACCEPTED_AT);
  assert.equal(snapshot.completenessProvenance.historicalClassUnionUsed, false);
});

test("complete class-specific A/B/C fact set produces exact COMPLETE_MULTI universe", () => {
  const snapshot = deriveIssuerCommonClassUniverseSnapshot(classDecision([
    ["CommonClassAMember", "100"],
    ["CommonClassBMember", "200"],
    ["CommonClassCMember", "300"],
  ]));

  assert.equal(snapshot.status, "COMPLETE_MULTI");
  assert.deepEqual(snapshot.requiredCanonicalSecurityClassIds, [
    `sc:v1:${CIK}:common_stock:us-gaap:CommonClassAMember`,
    `sc:v1:${CIK}:common_stock:us-gaap:CommonClassBMember`,
    `sc:v1:${CIK}:common_stock:us-gaap:CommonClassCMember`,
  ]);
  assert.deepEqual(snapshot.classEvidence.map((row) => row.sharesOutstanding), ["100", "200", "300"]);
});

test("source-backed custom member uses namespace URI plus local name without changing us-gaap IDs", () => {
  const customNamespace = "https://issuer.example/taxonomy/20260630";
  const snapshot = deriveIssuerCommonClassUniverseSnapshot(decision({
    facts: [
      fact({ value: "600", suffix: "custom-aggregate", concept: "us-gaap" }),
      fact({ value: "100", member: "CommonClassAMember", suffix: "custom-a", concept: "us-gaap" }),
      fact({ value: "200", member: "CommonClassBMember", suffix: "custom-b", concept: "us-gaap" }),
      fact({
        value: "300",
        member: "CapitalClassCMember",
        memberNamespaceUri: customNamespace,
        suffix: "custom-c",
        concept: "us-gaap",
      }),
    ],
    status: "REQUIRES_FURTHER_CONTEXT",
    reason: "AGGREGATE_AND_CLASS_SPECIFIC_FACTS_REQUIRE_SELECTION",
    taxonomy: "us-gaap",
    concept: "CommonStockSharesOutstanding",
  }));

  assert.equal(snapshot.status, "COMPLETE_MULTI");
  assert.ok(snapshot.requiredCanonicalSecurityClassIds.includes(
    `sc:v1:${CIK}:common_stock:us-gaap:CommonClassAMember`,
  ));
  assert.ok(snapshot.requiredCanonicalSecurityClassIds.includes(
    `sc:v1:${CIK}:common_stock:us-gaap:CommonClassBMember`,
  ));
  const customId = snapshot.requiredCanonicalSecurityClassIds.find((id) => id.includes(":custom:"));
  assert.match(customId ?? "", new RegExp(
    `^sc:v1:${CIK}:common_stock:custom:[0-9a-f]{64}:CapitalClassCMember$`,
  ));
  const customEvidence = snapshot.classEvidence.find((row) => row.canonicalSecurityClassId === customId);
  assert.equal(customEvidence?.sourceFacts[0]?.concept?.namespaceUri, US_GAAP);
  assert.equal(customEvidence?.sourceFacts[0]?.dimensions[0]?.kind, "explicit");
});

test("incomplete filing context never upgrades observed A/B facts into a complete universe", () => {
  const snapshot = deriveIssuerCommonClassUniverseSnapshot(decision({
    facts: [],
    status: "UNAVAILABLE",
    reason: "FILING_CONTEXT_UNAVAILABLE",
  }));

  assert.equal(snapshot.status, "INCOMPLETE");
  assert.equal(snapshot.reason, "FILING_CONTEXT_INCOMPLETE");
  assert.deepEqual(snapshot.requiredCanonicalSecurityClassIds, []);
});

test("aggregate corroborates an exact class sum but cannot fill a missing class", () => {
  const complete = deriveIssuerCommonClassUniverseSnapshot(decision({
    facts: [
      fact({ value: "600", suffix: "aggregate" }),
      fact({ value: "100", member: "CommonClassAMember", suffix: "a" }),
      fact({ value: "200", member: "CommonClassBMember", suffix: "b" }),
      fact({ value: "300", member: "CommonClassCMember", suffix: "c" }),
    ],
    status: "REQUIRES_FURTHER_CONTEXT",
    reason: "AGGREGATE_AND_CLASS_SPECIFIC_FACTS_REQUIRE_SELECTION",
  }));
  assert.equal(complete.status, "COMPLETE_MULTI");
  assert.equal(complete.aggregateEvidence[0]?.sharesOutstanding, "600");

  const incomplete = deriveIssuerCommonClassUniverseSnapshot(decision({
    facts: [
      fact({ value: "700", suffix: "aggregate-mismatch" }),
      fact({ value: "100", member: "CommonClassAMember", suffix: "a-mismatch" }),
      fact({ value: "200", member: "CommonClassBMember", suffix: "b-mismatch" }),
    ],
    status: "REQUIRES_FURTHER_CONTEXT",
    reason: "AGGREGATE_AND_CLASS_SPECIFIC_FACTS_REQUIRE_SELECTION",
  }));
  assert.equal(incomplete.status, "INCOMPLETE");
  assert.equal(incomplete.reason, "AGGREGATE_CLASS_SUM_MISMATCH");
  assert.deepEqual(incomplete.requiredCanonicalSecurityClassIds, []);
});

test("class facts with different O/S instant dates cannot form one complete snapshot", () => {
  const snapshot = deriveIssuerCommonClassUniverseSnapshot(decision({
    facts: [
      fact({ value: "100", member: "CommonClassAMember", suffix: "a-date", asOf: AS_OF }),
      fact({ value: "200", member: "CommonClassBMember", suffix: "b-date", asOf: "2026-06-29" }),
    ],
    status: "ELIGIBLE",
    reason: "ELIGIBLE_CLASS_SPECIFIC_DEI_CONTEXT",
  }));
  assert.equal(snapshot.status, "INCOMPLETE");
  assert.equal(snapshot.reason, "SOURCE_PROVENANCE_INVALID");
  assert.deepEqual(snapshot.requiredCanonicalSecurityClassIds, []);
});

test("unsupported standard preferred member is excluded and forces fail-closed coverage", () => {
  const snapshot = deriveIssuerCommonClassUniverseSnapshot(decision({
    facts: [fact({ value: "100", member: "PreferredStockMember", suffix: "preferred" })],
    status: "REQUIRES_FURTHER_CONTEXT",
    reason: "SECURITY_CLASS_DIMENSION_UNSUPPORTED",
  }));

  assert.equal(snapshot.status, "INCOMPLETE");
  assert.equal(snapshot.reason, "UNSUPPORTED_CLASS_MEMBER");
  assert.deepEqual(snapshot.requiredCanonicalSecurityClassIds, []);
  assert.equal(snapshot.excludedEvidence[0]?.memberLocalName, "PreferredStockMember");
});

test("foreign/ADR basis remains AMBIGUOUS without ADS ratio inference", () => {
  const snapshot = deriveIssuerCommonClassUniverseSnapshot(decision({
    facts: [fact({ value: "100" })],
    status: "REQUIRES_FURTHER_CONTEXT",
    reason: "ADS_OR_ORDINARY_BASIS_REQUIRES_STRUCTURED_RATIO",
    form: "20-F",
  }));
  assert.equal(snapshot.status, "AMBIGUOUS");
  assert.equal(snapshot.reason, "ADS_OR_ORDINARY_AMBIGUOUS");
  assert.deepEqual(snapshot.requiredCanonicalSecurityClassIds, []);
});

test("eligible U.S.-listed 20-F and 40-F decisions produce complete single-class universes", () => {
  for (const form of ["20-F", "40-F"]) {
    const snapshot = deriveIssuerCommonClassUniverseSnapshot(decision({
      facts: [fact({ value: "20000000" })],
      status: "ELIGIBLE",
      reason: "ELIGIBLE_SINGLE_COMMON_STOCK_DEI_CONTEXT",
      form,
    }));
    assert.equal(snapshot.status, "COMPLETE_SINGLE", form);
    assert.equal(snapshot.sourceForm, form);
    assert.deepEqual(snapshot.requiredCanonicalSecurityClassIds, [
      `sc:v1:${CIK}:common_stock:single`,
    ]);
  }
});

test("an eligible 40-F history row is a usable incremental periodic baseline", async () => {
  const repository = new InMemoryIssuerCommonClassUniverseRepository();
  const foreignDecision = decision({
    facts: [fact({ value: "20000000" })],
    status: "ELIGIBLE",
    reason: "ELIGIBLE_SINGLE_COMMON_STOCK_DEI_CONTEXT",
    form: "40-F",
  });
  const snapshot = deriveIssuerCommonClassUniverseSnapshot(foreignDecision);
  await repository.insertSnapshot(snapshot);
  const classId = snapshot.requiredCanonicalSecurityClassIds[0]!;
  const history = [{
    sourceType: "sec_authoritative_os",
    observationType: "authoritative_xbrl",
    authoritativeStatus: "ELIGIBLE",
    canonicalSecurityClassStatus: "mapped",
    canonicalSecurityClassKind: "common_stock",
    canonicalSecurityClassId: classId,
    shareBasisIdentity: "shares_outstanding:xbrli_shares",
    acceptedAtSource: "sec_filing_ledger",
    acceptedAt: ACCEPTED_AT,
    asOf: AS_OF,
    accessionNumber: "0000000099-26-000001",
    form: "40-F",
    sharesOutstanding: "20000000",
    sourceFactKey: fact({ value: "20000000" }).factKey,
  }] as unknown as ShareCountHistoryObservation[];
  const baseline = await readLatestUsablePeriodicOsBaseline({
    repository,
    shareCountHistoryRepository: historyRepository(history),
    cik: CIK,
    targetAt: "2026-08-02T00:00:00.000Z",
  });
  assert.equal(baseline.status, "AVAILABLE");
  if (baseline.status === "AVAILABLE") {
    assert.equal(baseline.form, "40-F");
    assert.deepEqual(baseline.requiredCanonicalSecurityClassIds, [classId]);
  }
});

test("a dedicated 424B4 prospectus seed is an incremental discovery boundary but not a periodic baseline", async () => {
  const repository = new InMemoryIssuerCommonClassUniverseRepository();
  const classId = `sc:v1:${CIK}:common_stock:single`;
  const factKey = "a".repeat(64);
  const snapshot = {
    id: null,
    snapshotVersion: "issuer-common-class-universe-prospectus-text-v1",
    issuerCik: CIK,
    universeAsOf: AS_OF,
    acceptedAt: ACCEPTED_AT,
    sourceAccession: "0000000099-26-000001",
    sourceForm: "424B4",
    sourceFiledDate: "2026-08-01",
    sourceDocuments: ["form424b4.htm"],
    status: "COMPLETE_SINGLE",
    reason: "COMPLETE_SINGLE_COMMON_STOCK",
    requiredCanonicalSecurityClassIds: [classId],
    classEvidence: [{
      canonicalSecurityClassId: classId,
      sharesOutstanding: "24000000",
      sourceFacts: [{
        factKey,
        contextRef: "prospectus-current-os:aaaaaaaa",
        sharesOutstanding: "24000000",
        documentName: "form424b4.htm",
        sourceUrl: "https://www.sec.gov/Archives/edgar/data/99/form424b4.htm",
        contentHash: "b".repeat(64),
        artifactId: "11111111-1111-4111-8111-111111111111",
        dimensions: [],
      }],
    }],
    aggregateEvidence: [],
    excludedEvidence: [],
    completenessProvenance: {
      historicalClassUnionUsed: false,
      sourceContract: "prospectus-text-os-baseline-v1",
      sourceType: "sec_prospectus_text_authoritative_os",
      evidenceBasis: "complete_primary_prospectus_text",
      finalForm: "424B4",
      automaticVerifierStatus: "AutomaticallyVerified",
      listingBasis: { status: "FINALIZED_US_EXCHANGE_TICKER", exchange: "Nasdaq", ticker: "TEST" },
      classBasisEvidence: { status: "COMPLETE_SINGLE", title: "Common Stock" },
    },
    sourceIdentityHash: "c".repeat(64),
    createdAt: null,
  } satisfies IssuerCommonClassUniverseSnapshot;
  await repository.insertSnapshot(snapshot);
  const history = [{
    sourceType: "sec_prospectus_text_authoritative_os",
    observationType: "source_stated",
    authoritativeStatus: "ELIGIBLE",
    canonicalSecurityClassStatus: "mapped",
    canonicalSecurityClassKind: "common_stock",
    canonicalSecurityClassId: classId,
    acceptedAtSource: "sec_filing_ledger",
    acceptedAt: ACCEPTED_AT,
    asOf: AS_OF,
    accessionNumber: snapshot.sourceAccession,
    form: "424B4",
    sharesOutstanding: "24000000",
    sourceFactKey: factKey,
  }] as unknown as ShareCountHistoryObservation[];
  const historyRepo = historyRepository(history);
  const periodic = await readLatestUsablePeriodicOsBaseline({
    repository,
    shareCountHistoryRepository: historyRepo,
    cik: CIK,
    targetAt: "2026-08-02T00:00:00.000Z",
  });
  assert.equal(periodic.status, "BASELINE_REQUIRED");
  const boundary = await readLatestUsableOsIncrementalBoundary({
    repository,
    shareCountHistoryRepository: historyRepo,
    cik: CIK,
    targetAt: "2026-08-02T00:00:00.000Z",
  });
  assert.equal(boundary.status, "AVAILABLE");
  if (boundary.status === "AVAILABLE") {
    assert.equal(boundary.boundaryKind, "new_listing_prospectus");
    assert.equal(boundary.form, "424B4");
    assert.equal(boundary.acceptedAt, ACCEPTED_AT);
  }
});

test("class-specific conflicts do not select a winner", () => {
  const snapshot = deriveIssuerCommonClassUniverseSnapshot(decision({
    facts: [
      fact({ value: "100", member: "CommonClassAMember", suffix: "a-1" }),
      fact({ value: "101", member: "CommonClassAMember", suffix: "a-2" }),
      fact({ value: "200", member: "CommonClassBMember", suffix: "b" }),
    ],
    status: "ELIGIBLE",
    reason: "ELIGIBLE_CLASS_SPECIFIC_DEI_CONTEXT",
  }));
  assert.equal(snapshot.status, "AMBIGUOUS");
  assert.equal(snapshot.reason, "CLASS_FACT_CONFLICT");
  assert.deepEqual(snapshot.requiredCanonicalSecurityClassIds, []);
});

test("reader selects the event-time complete snapshot without future look-ahead", async () => {
  const repository = new InMemoryIssuerCommonClassUniverseRepository();
  await writeIssuerCommonClassUniverseSnapshot({
    repository,
    decision: classDecision([
      ["CommonClassAMember", "100"],
      ["CommonClassBMember", "200"],
    ], { asOf: "2026-06-30", acceptedAt: "2026-08-01T00:00:00.000Z", accession: "0000000099-26-000001" }),
  });
  await writeIssuerCommonClassUniverseSnapshot({
    repository,
    decision: classDecision([
      ["CommonClassAMember", "110"],
      ["CommonClassBMember", "210"],
      ["CommonClassCMember", "310"],
    ], { asOf: "2026-09-30", acceptedAt: "2026-11-01T00:00:00.000Z", accession: "0000000099-26-000002" }),
  });

  const beforeFutureAcceptance = await readIssuerCommonClassUniverseAt({
    repository,
    shareCountHistoryRepository: historyRepository([]),
    cik: CIK,
    targetAt: "2026-10-15T00:00:00.000Z",
  });
  assert.equal(beforeFutureAcceptance.status, "AVAILABLE");
  if (beforeFutureAcceptance.status === "AVAILABLE") {
    assert.equal(beforeFutureAcceptance.universeAsOf, "2026-06-30");
    assert.equal(beforeFutureAcceptance.requiredCanonicalSecurityClassIds.length, 2);
  }

  const afterAcceptance = await readIssuerCommonClassUniverseAt({
    repository,
    shareCountHistoryRepository: historyRepository([]),
    cik: CIK,
    targetAt: "2026-11-02T00:00:00.000Z",
  });
  assert.equal(afterAcceptance.status, "AVAILABLE");
  if (afterAcceptance.status === "AVAILABLE") {
    assert.equal(afterAcceptance.universeAsOf, "2026-09-30");
    assert.equal(afterAcceptance.requiredCanonicalSecurityClassIds.length, 3);
  }
});

test("reader supersedes a V1 source result with the V2 result for the same filing observation", async () => {
  const repository = new InMemoryIssuerCommonClassUniverseRepository();
  const completeV2 = deriveIssuerCommonClassUniverseSnapshot(classDecision([
    ["CommonClassAMember", "100"],
    ["CommonClassBMember", "200"],
  ]));
  const incompleteV1 = {
    ...structuredClone(completeV2),
    snapshotVersion: "issuer-common-class-universe-snapshot-v1" as const,
    status: "INCOMPLETE" as const,
    reason: "AUTHORITATIVE_SOURCE_NOT_ELIGIBLE" as const,
    requiredCanonicalSecurityClassIds: [],
    classEvidence: [],
    aggregateEvidence: [],
    excludedEvidence: [],
    sourceIdentityHash: hash("same-source-v1"),
  };
  await repository.insertSnapshot(incompleteV1);
  await repository.insertSnapshot(completeV2);

  const result = await readIssuerCommonClassUniverseAt({
    repository,
    shareCountHistoryRepository: historyRepository([]),
    cik: CIK,
    targetAt: "2026-08-02T00:00:00.000Z",
  });
  assert.equal(result.status, "AVAILABLE");
  if (result.status !== "AVAILABLE") throw new Error("V2 snapshot unavailable");
  assert.equal(result.selectedSnapshot.snapshotVersion, "issuer-common-class-universe-snapshot-v2");
  assert.equal(result.selectedSnapshot.status, "COMPLETE_MULTI");
});

test("a later canonical common class invalidates an older complete universe", async () => {
  const repository = new InMemoryIssuerCommonClassUniverseRepository();
  await writeIssuerCommonClassUniverseSnapshot({
    repository,
    decision: classDecision([
      ["CommonClassAMember", "100"],
      ["CommonClassBMember", "200"],
    ], { acceptedAt: "2026-08-01T00:00:00.000Z" }),
  });
  const result = await readIssuerCommonClassUniverseAt({
    repository,
    shareCountHistoryRepository: historyRepository([
      historyObservation(`sc:v1:${CIK}:common_stock:us-gaap:CommonClassCMember`),
    ]),
    cik: CIK,
    targetAt: "2026-09-01T00:00:00.000Z",
  });
  assert.equal(result.status, "CLASS_UNIVERSE_STALE");
  assert.equal(result.reason, "LATER_CANONICAL_COMMON_CLASS_DISCOVERED");
  assert.equal(result.laterClassEvidence.length, 1);
});

test("a newer incomplete snapshot blocks fallback to an older complete snapshot", async () => {
  const repository = new InMemoryIssuerCommonClassUniverseRepository();
  await writeIssuerCommonClassUniverseSnapshot({
    repository,
    decision: classDecision([
      ["CommonClassAMember", "100"],
      ["CommonClassBMember", "200"],
    ], { asOf: "2026-06-30", acceptedAt: "2026-08-01T00:00:00.000Z", accession: "0000000099-26-000010" }),
  });
  await writeIssuerCommonClassUniverseSnapshot({
    repository,
    decision: decision({
      facts: [],
      status: "UNAVAILABLE",
      reason: "FILING_CONTEXT_UNAVAILABLE",
      asOf: "2026-09-30",
      acceptedAt: "2026-11-01T00:00:00.000Z",
      accession: "0000000099-26-000011",
    }),
  });
  const result = await readIssuerCommonClassUniverseAt({
    repository,
    shareCountHistoryRepository: historyRepository([]),
    cik: CIK,
    targetAt: "2026-11-02T00:00:00.000Z",
  });
  assert.equal(result.status, "INCOMPLETE");
  assert.equal(result.reason, "LATEST_SNAPSHOT_INCOMPLETE");
});

test("same source replay is idempotent and snapshot history is append-only", async () => {
  const repository = new InMemoryIssuerCommonClassUniverseRepository();
  const input = {
    repository,
    decision: decision({
      facts: [fact({ value: "20000000" })],
      status: "ELIGIBLE",
      reason: "ELIGIBLE_SINGLE_COMMON_STOCK_DEI_CONTEXT",
    }),
  };
  assert.deepEqual(await writeIssuerCommonClassUniverseSnapshot(input), { inserted: 1, deduped: 0 });
  assert.deepEqual(await writeIssuerCommonClassUniverseSnapshot(input), { inserted: 0, deduped: 1 });
  assert.equal((await repository.readSnapshots(CIK)).length, 1);

  await writeIssuerCommonClassUniverseSnapshot({
    repository,
    decision: decision({
      facts: [fact({ value: "21000000", suffix: "new" })],
      status: "ELIGIBLE",
      reason: "ELIGIBLE_SINGLE_COMMON_STOCK_DEI_CONTEXT",
      asOf: "2026-09-30",
      acceptedAt: "2026-11-01T00:00:00.000Z",
      accession: "0000000099-26-000020",
    }),
  });
  assert.equal((await repository.readSnapshots(CIK)).length, 2);
});

test("PostgreSQL repository preserves the typed snapshot contract on round-trip", async () => {
  const snapshot = deriveIssuerCommonClassUniverseSnapshot(decision({
    facts: [fact({ value: "20000000" })],
    status: "ELIGIBLE",
    reason: "ELIGIBLE_SINGLE_COMMON_STOCK_DEI_CONTEXT",
  }));
  let stored: Record<string, unknown> | null = null;
  const client: ShareCountHistorySqlClient = {
    async query<Row extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      values: unknown[] = [],
    ) {
      if (text.includes("insert into public.issuer_common_class_universe_snapshots")) {
        assert.equal(values.length, 16);
        stored = {
          id: "1",
          snapshot_version: values[0],
          issuer_cik: values[1],
          universe_as_of: values[2],
          accepted_at: values[3],
          source_accession: values[4],
          source_form: values[5],
          source_filed_date: values[6],
          source_documents: values[7],
          status: values[8],
          reason: values[9],
          required_canonical_security_class_ids: values[10],
          class_evidence: values[11],
          aggregate_evidence: values[12],
          excluded_evidence: values[13],
          completeness_provenance: values[14],
          source_identity_hash: values[15],
          created_at: "2026-08-22T15:00:00.000Z",
        };
        return { rows: [{ id: "1" }] as unknown as Row[], rowCount: 1 };
      }
      assert.ok(text.includes("from public.issuer_common_class_universe_snapshots"));
      return { rows: (stored ? [stored] : []) as unknown as Row[], rowCount: stored ? 1 : 0 };
    },
  };
  const repository = new PostgresIssuerCommonClassUniverseRepository(client);
  assert.equal(await repository.insertSnapshot(snapshot), true);
  const rows = await repository.readSnapshots(CIK, {
    universeAsOfTo: AS_OF,
    acceptedAtTo: ACCEPTED_AT,
  });
  assert.equal(rows.length, 1);
  assert.deepEqual({ ...rows[0], id: null, createdAt: null }, snapshot);
});

function classDecision(
  classes: Array<[string, string]>,
  overrides: Partial<DecisionOptions> = {},
) {
  return decision({
    facts: classes.map(([member, value], index) => fact({
      member,
      value,
      suffix: `${member}-${index}-${overrides.accession ?? "base"}`,
      asOf: overrides.asOf,
      accession: overrides.accession,
    })),
    status: "ELIGIBLE",
    reason: "ELIGIBLE_CLASS_SPECIFIC_DEI_CONTEXT",
    ...overrides,
  });
}

type DecisionOptions = {
  facts: SecAuthoritativeOsFilingFactEvidence[];
  status: SecAuthoritativeOsStatus;
  reason: SecAuthoritativeOsReason;
  form?: string;
  asOf?: string;
  acceptedAt?: string;
  accession?: string;
  taxonomy?: "dei" | "us-gaap";
  concept?: "EntityCommonStockSharesOutstanding" | "CommonStockSharesOutstanding";
};

function decision(options: DecisionOptions): SecAuthoritativeOsDecision {
  const asOf = options.asOf ?? AS_OF;
  const acceptedAt = options.acceptedAt ?? ACCEPTED_AT;
  const accession = options.accession ?? "0000000099-26-000001";
  const candidate = {
    issuerCik: CIK,
    taxonomy: options.taxonomy ?? "dei",
    concept: options.concept ?? "EntityCommonStockSharesOutstanding",
    unit: "shares",
    sharesOutstanding: options.facts[0]?.normalizedValue ?? "1",
    asOf,
    accession,
    form: options.form ?? "10-Q",
    filedDate: acceptedAt.slice(0, 10),
    acceptedAt,
    filingLedgerRawSourceId: "00000000-0000-4000-8000-000000000099",
    sourceFacts: [],
    rejectionReason: null,
  };
  return {
    issuerCik: CIK,
    candidate,
    status: options.status,
    reason: options.reason,
    decisionVersion: "authoritative-os-extraction-v1",
    filingFacts: options.facts,
    authoritative: options.status === "ELIGIBLE" ? {} : null,
  } as unknown as SecAuthoritativeOsDecision;
}

function fact(input: {
  value: string;
  member?: string;
  memberNamespaceUri?: string;
  concept?: "dei" | "us-gaap";
  suffix?: string;
  asOf?: string;
  accession?: string;
}): SecAuthoritativeOsFilingFactEvidence {
  const suffix = input.suffix ?? `${input.member ?? "aggregate"}-${input.value}`;
  const axis = qname("us-gaap:StatementClassOfStockAxis", US_GAAP);
  const concept = input.concept === "us-gaap"
    ? qname("us-gaap:CommonStockSharesOutstanding", US_GAAP)
    : qname("dei:EntityCommonStockSharesOutstanding", "http://xbrl.sec.gov/dei/2026");
  const dimensions = input.member
    ? [{
        kind: "explicit" as const,
        axis,
        member: qname(
          `${input.memberNamespaceUri ? "issuer" : "us-gaap"}:${input.member}`,
          input.memberNamespaceUri ?? US_GAAP,
        ),
      }]
    : [];
  return {
    factKey: hash(`fact:${suffix}`),
    concept,
    lexicalValue: input.value,
    normalizedValue: input.value,
    contextRef: `ctx-${hash(suffix).slice(0, 12)}`,
    context: {
      id: `ctx-${hash(suffix).slice(0, 12)}`,
      entityIdentifier: CIK,
      entityScheme: "http://www.sec.gov/CIK",
      period: { kind: "instant", instant: input.asOf ?? AS_OF },
      dimensions,
    },
    dimensions,
    unitRef: "shares",
    unit: {
      id: "shares",
      kind: "measure",
      measure: qname("xbrli:shares", "http://www.xbrl.org/2003/instance"),
    },
    decimals: "0",
    precision: null,
    scale: null,
    sign: null,
    inlineFormat: null,
    isNil: false,
    source: {
      artifactId: uuid(suffix),
      issuerCik: CIK,
      accession: input.accession ?? "0000000099-26-000001",
      documentName: "issuer-20260630.htm",
      sourceUrl: `https://www.sec.gov/Archives/edgar/data/99/${hash(suffix).slice(0, 16)}.htm`,
      contentHash: hash(`content:${suffix}`),
      fetchedAt: "2026-08-01T13:00:00.000Z",
      rawContentKind: "injected_exact_body",
    },
  };
}

function qname(qnameValue: string, namespaceUri: string) {
  const [prefix, localName] = qnameValue.split(":");
  return { qname: qnameValue, prefix: prefix!, localName: localName!, namespaceUri };
}

function historyRepository(rows: ShareCountHistoryObservation[]): ShareCountHistoryRepository {
  return {
    async insertObservation() { return false; },
    async readHistory() { return structuredClone(rows); },
  };
}

function historyObservation(canonicalSecurityClassId: string): ShareCountHistoryObservation {
  return {
    issuerCik: CIK,
    canonicalSecurityClassId,
    canonicalSecurityClassKind: "common_stock",
    canonicalSecurityClassStatus: "mapped",
    acceptedAt: "2026-08-15T00:00:00.000Z",
    asOf: "2026-08-10",
    sourceFactKey: hash(canonicalSecurityClassId),
  } as unknown as ShareCountHistoryObservation;
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function uuid(value: string) {
  const hex = hash(value);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
