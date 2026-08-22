import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveClassShareCountAt,
} from "./classShareCountResolver.ts";
import type {
  ShareCountHistoryObservation,
  ShareCountHistoryReadFilter,
  ShareCountHistoryRepository,
} from "./shareCountHistory.ts";

const CIK = "0000000099";
const SINGLE = `sc:v1:${CIK}:common_stock:single`;
const CLASS_A = `sc:v1:${CIK}:common_stock:us-gaap:CommonClassAMember`;
const CLASS_B = `sc:v1:${CIK}:common_stock:us-gaap:CommonClassBMember`;
const TARGET = "2026-08-20T12:00:00.000Z";

test("A. newer eligible Level 2 observation wins by as-of without source priority", async () => {
  const result = await resolve([
    observation({ id: "xbrl-old", sourceType: "sec_authoritative_os", shares: "20000000", asOf: "2026-06-30", acceptedAt: "2026-07-01T10:00:00Z" }),
    observation({ id: "level2-new", sourceType: "sec_filing_text_level2", shares: "27500000", asOf: "2026-08-18", acceptedAt: "2026-08-18T15:00:00Z" }),
  ]);
  assert.equal(result.status, "RESOLVED");
  assert.equal(result.sharesOutstanding, "27500000");
  assert.equal(result.asOf, "2026-08-18");
  assert.equal(result.selectedObservation?.sourceType, "sec_filing_text_level2");
});

test("B. same class, date, and value corroborate across sources without losing provenance", async () => {
  const rows = [
    observation({ id: "xbrl", sourceType: "sec_authoritative_os", shares: "27500000", asOf: "2026-08-18", acceptedAt: "2026-08-18T14:00:00Z" }),
    observation({ id: "level2", sourceType: "sec_filing_text_level2", shares: "27500000", asOf: "2026-08-18", acceptedAt: "2026-08-18T15:00:00Z" }),
  ];
  const result = await resolve(rows);
  assert.equal(result.status, "RESOLVED");
  assert.equal(result.reason, "LATEST_ELIGIBLE_AS_OF_CORROBORATED");
  assert.equal(result.supportingObservations.length, 2);
  assert.deepEqual(new Set(result.supportingObservations.map((row) => row.sourceType)),
    new Set(["sec_authoritative_os", "sec_filing_text_level2"]));
  assert.deepEqual(result.supportingObservations.map((row) => row.sourceProvenance.fixtureId).sort(),
    ["level2", "xbrl"]);
});

test("C. same latest as-of with different shares is a conflict with no winner", async () => {
  const result = await resolve([
    observation({ id: "xbrl", sourceType: "sec_authoritative_os", shares: "27500000", asOf: "2026-08-18", acceptedAt: "2026-08-18T14:00:00Z" }),
    observation({ id: "level2", sourceType: "sec_filing_text_level2", shares: "31000000", asOf: "2026-08-18", acceptedAt: "2026-08-18T15:00:00Z" }),
  ]);
  assert.equal(result.status, "CONFLICT");
  assert.equal(result.reason, "LATEST_ELIGIBLE_AS_OF_CONFLICT");
  assert.equal(result.sharesOutstanding, null);
  assert.equal(result.selectedObservation, null);
  assert.equal(result.supportingObservations.length, 2);
});

test("D. a newer observation accepted after target is excluded and the prior value resolves", async () => {
  const result = await resolve([
    observation({ id: "prior", sourceType: "sec_authoritative_os", shares: "20000000", asOf: "2026-06-30", acceptedAt: "2026-07-01T10:00:00Z" }),
    observation({ id: "look-ahead", sourceType: "sec_filing_text_level2", shares: "27500000", asOf: "2026-08-18", acceptedAt: "2026-08-25T10:00:00Z" }),
  ]);
  assert.equal(result.status, "RESOLVED");
  assert.equal(result.sharesOutstanding, "20000000");
  assert.equal(result.asOf, "2026-06-30");
});

test("E. accepted-at null is never event-time eligible", async () => {
  const result = await resolve([
    observation({ id: "unknown-acceptance", sourceType: "sec_filing_text_level2", shares: "27500000", asOf: "2026-08-18", acceptedAt: null }),
  ]);
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.reason, "NO_ELIGIBLE_OBSERVATION_AT_TARGET");
  assert.equal(result.supportingObservations.length, 0);
});

test("F. canonical classes remain isolated and are never summed", async () => {
  const repository = new StaticHistoryRepository([
    observation({ id: "class-a", sourceType: "sec_authoritative_os", shares: "100000000", asOf: "2026-07-01", acceptedAt: "2026-07-02T10:00:00Z", securityClassId: CLASS_A }),
    observation({ id: "class-b", sourceType: "sec_authoritative_os", shares: "900000000", asOf: "2026-08-18", acceptedAt: "2026-08-18T10:00:00Z", securityClassId: CLASS_B }),
  ], false);
  const result = await resolveClassShareCountAt({ repository, cik: CIK, securityClassId: CLASS_A, targetAt: TARGET });
  assert.equal(result.status, "RESOLVED");
  assert.equal(result.sharesOutstanding, "100000000");
  assert.ok(result.supportingObservations.every((row) => row.canonicalSecurityClassId === CLASS_A));
});

test("G. no observation is unavailable", async () => {
  const result = await resolve([]);
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.reason, "NO_ELIGIBLE_OBSERVATION_AT_TARGET");
  assert.equal(result.asOf, null);
});

test("H. old observations remain resolved and expose age without a freshness cutoff", async () => {
  const result = await resolve([
    observation({ id: "old", sourceType: "sec_authoritative_os", shares: "20000000", asOf: "2026-04-22", acceptedAt: "2026-04-23T10:00:00Z" }),
  ]);
  assert.equal(result.status, "RESOLVED");
  assert.equal(result.ageDays, 120);
});

test("I. identical input replay produces the exact deterministic result", async () => {
  const rows = [
    observation({ id: "b", sourceType: "sec_filing_text_level2", shares: "27500000", asOf: "2026-08-18", acceptedAt: "2026-08-18T15:00:00Z" }),
    observation({ id: "a", sourceType: "sec_authoritative_os", shares: "27500000", asOf: "2026-08-18", acceptedAt: "2026-08-18T14:00:00Z" }),
  ];
  assert.deepEqual(await resolve(rows), await resolve([...rows].reverse()));
});

test("official reader receives exact class and target-date filters and fails closed on read error", async () => {
  const repository = new StaticHistoryRepository([]);
  await resolveClassShareCountAt({ repository, cik: CIK, securityClassId: SINGLE, targetAt: TARGET });
  assert.deepEqual(repository.lastFilter, { asOfTo: "2026-08-20", canonicalSecurityClassId: SINGLE });
  const failed = await resolveClassShareCountAt({
    repository: { insertObservation: async () => false, readHistory: async () => { throw new Error("DB"); } },
    cik: CIK,
    securityClassId: SINGLE,
    targetAt: TARGET,
  });
  assert.equal(failed.status, "UNAVAILABLE");
  assert.equal(failed.reason, "HISTORY_READ_FAILED");
});

test("invalid issuer, cross-issuer class ID, and timezone-free target fail before reading", async () => {
  const repository = new StaticHistoryRepository([]);
  await assert.rejects(() => resolveClassShareCountAt({ repository, cik: "99", securityClassId: SINGLE, targetAt: TARGET }), /invalid CIK/);
  await assert.rejects(() => resolveClassShareCountAt({ repository, cik: CIK, securityClassId: "sc:v1:0000000100:common_stock:single", targetAt: TARGET }), /issuer-scoped/);
  await assert.rejects(() => resolveClassShareCountAt({ repository, cik: CIK, securityClassId: SINGLE, targetAt: "2026-08-20" }), /timestamp/);
  assert.equal(repository.readCount, 0);
});

function resolve(rows: ShareCountHistoryObservation[]) {
  return resolveClassShareCountAt({
    repository: new StaticHistoryRepository(rows),
    cik: CIK,
    securityClassId: SINGLE,
    targetAt: TARGET,
  });
}

class StaticHistoryRepository implements ShareCountHistoryRepository {
  readCount = 0;
  lastFilter: ShareCountHistoryReadFilter | undefined;
  private readonly rows: ShareCountHistoryObservation[];
  private readonly honorFilter: boolean;

  constructor(rows: ShareCountHistoryObservation[], honorFilter = true) {
    this.rows = rows;
    this.honorFilter = honorFilter;
  }

  async insertObservation(): Promise<boolean> {
    throw new Error("resolver is read-only");
  }

  async readHistory(cik: string, filter: ShareCountHistoryReadFilter = {}) {
    this.readCount += 1;
    this.lastFilter = structuredClone(filter);
    return this.rows
      .filter((row) => row.issuerCik === cik)
      .filter((row) => !this.honorFilter || !filter.asOfTo || row.asOf <= filter.asOfTo)
      .filter((row) => !this.honorFilter || !filter.canonicalSecurityClassId
        || row.canonicalSecurityClassId === filter.canonicalSecurityClassId)
      .map((row) => structuredClone(row));
  }
}

function observation(input: {
  id: string;
  sourceType: "sec_authoritative_os" | "sec_filing_text_level2";
  shares: string;
  asOf: string;
  acceptedAt: string | null;
  securityClassId?: string;
}): ShareCountHistoryObservation {
  const xbrl = input.sourceType === "sec_authoritative_os";
  const acceptedAt = input.acceptedAt === null ? null : new Date(input.acceptedAt).toISOString();
  return {
    id: input.id,
    observationType: xbrl ? "authoritative_xbrl" : "source_stated",
    issuerCik: CIK,
    sharesOutstanding: input.shares,
    asOf: input.asOf,
    securityClassBasis: xbrl ? "SINGLE_COMMON_STOCK_CLASS" : "SOURCE_STATED_SECURITY_CLASS",
    securityClassIdentity: { canonicalKey: `fixture-${input.id}`, identity: { fixture: input.id } },
    securityClassMetadata: { fixture: input.id },
    canonicalSecurityClassId: input.securityClassId ?? SINGLE,
    canonicalSecurityClassKind: "common_stock",
    canonicalSecurityClassStatus: "mapped",
    canonicalSecurityClassProvenance: { fixtureId: input.id },
    shareBasisIdentity: xbrl ? "shares_outstanding:xbrli_shares" : "shares_outstanding:source_stated",
    shareBasisMetadata: { fixture: input.id },
    accessionNumber: "0000000099-26-000001",
    form: "10-Q",
    filingDocument: `${input.id}.htm`,
    filedDate: input.asOf,
    acceptedAt,
    acceptedAtSource: acceptedAt === null ? "unavailable" : xbrl ? "sec_filing_ledger" : "sec_raw_payload_acceptance",
    acceptedAtProvenance: acceptedAt === null
      ? { source: "unavailable", reason: "SEC_ACCEPTANCE_TIMESTAMP_UNAVAILABLE" }
      : { source: xbrl ? "sec_filing_ledger.accepted_at" : "raw_items.raw_payload.accepted_at" },
    ingestedAt: "2026-08-22T00:00:00.000Z",
    sourceConceptNamespaceUri: xbrl ? "http://xbrl.sec.gov/dei/2025" : null,
    sourceConceptLocalName: xbrl ? "EntityCommonStockSharesOutstanding" : null,
    sourceFactKey: hash(input.id),
    sourceContextRef: `context-${input.id}`,
    sourceArtifactId: "10000000-0000-5000-8000-000000000001",
    filingLedgerRawSourceId: xbrl ? "20000000-0000-5000-8000-000000000001" : null,
    sourceFactIdentity: { fixtureId: input.id },
    sourceContext: { fixtureId: input.id },
    sourceDimensions: [],
    sourceProvenance: { fixtureId: input.id },
    sourceType: input.sourceType,
    authoritativeStatus: xbrl ? "ELIGIBLE" : null,
    authoritativeDecisionVersion: xbrl ? "authoritative-os-extraction-v1" : null,
    authoritativeDecisionReason: xbrl ? "ELIGIBLE_SINGLE_COMMON_STOCK_DEI_CONTEXT" : null,
    authoritativeDecisionLineage: xbrl ? { fixtureId: input.id } : null,
    sourceDocumentUrl: `https://www.sec.gov/Archives/edgar/data/99/${input.id}.htm`,
    sourceContentHash: hash(`content-${input.id}`),
    sourceEvidence: xbrl ? null : `Exact source evidence for ${input.id}`,
    sourceAnalyzer: xbrl ? null : "listing_risk",
  } as ShareCountHistoryObservation;
}

function hash(value: string) {
  return Buffer.from(value).toString("hex").padEnd(64, "0").slice(0, 64);
}
