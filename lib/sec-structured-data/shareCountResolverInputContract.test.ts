import assert from "node:assert/strict";
import test from "node:test";
import { extractLevel2ShareCountSidecar } from "./level2ShareCountObservation.ts";
import { resolveLevel2SecAcceptanceTimestamp } from "./shareCountAcceptanceTimestamp.ts";
import {
  deriveAuthoritativeCanonicalSecurityClassIdentity,
  deriveLevel2CanonicalSecurityClassIdentity,
  type CanonicalSecurityClassSupport,
} from "./shareCountSecurityIdentity.ts";

const cik = "0000000099";
const sourceFactKey = "a".repeat(64);

test("single-class XBRL and explicit Level 2 common stock share one canonical identity", () => {
  const xbrl = deriveAuthoritativeCanonicalSecurityClassIdentity({
    issuerCik: cik,
    basis: "SINGLE_COMMON_STOCK_CLASS",
    sourceCanonicalKey: "SINGLE_COMMON_STOCK_CLASS|dei:EntityCommonStockSharesOutstanding@required-context",
    sourceIdentity: "dei:EntityCommonStockSharesOutstanding@required-context",
    sourceFactKey,
    sourceContextRef: "cover",
  });
  const level2 = deriveLevel2CanonicalSecurityClassIdentity({
    issuerCik: cik,
    securityClassKind: "common_stock",
    sourceTitle: "Common Stock, par value $0.001 per share",
    supports: [support(xbrl.canonicalSecurityClassId!, "SINGLE_COMMON_STOCK_CLASS", "1")],
  });
  assert.equal(xbrl.status, "mapped");
  assert.equal(level2.status, "mapped");
  assert.equal(level2.canonicalSecurityClassId, xbrl.canonicalSecurityClassId);

  const sameAsOfSameShares = new Set([
    `${xbrl.canonicalSecurityClassId}|2026-08-18|27500000`,
    `${level2.canonicalSecurityClassId}|2026-08-18|27500000`,
  ]);
  assert.equal(sameAsOfSameShares.size, 1);
  const sameAsOfConflict = new Set([
    `${xbrl.canonicalSecurityClassId}|2026-08-18|27500000`,
    `${level2.canonicalSecurityClassId}|2026-08-18|28000000`,
  ]);
  assert.equal(sameAsOfConflict.size, 2);
});

test("class-specific XBRL A/B/C identities remain separate and ambiguous Level 2 fails closed", () => {
  const ids = ["CommonClassAMember", "CommonClassBMember", "CommonClassCMember"].map((member) =>
    deriveAuthoritativeCanonicalSecurityClassIdentity({
      issuerCik: cik,
      basis: "CLASS_SPECIFIC_COMMON_STOCK",
      sourceCanonicalKey: `fixture-${member}`,
      sourceIdentity: {
        axis: { namespaceUri: "http://fasb.org/us-gaap/2026", localName: "StatementClassOfStockAxis" },
        member: { namespaceUri: "http://fasb.org/us-gaap/2026", localName: member },
      },
      sourceConcept: {
        namespaceUri: "http://xbrl.sec.gov/dei/2026",
        localName: "EntityCommonStockSharesOutstanding",
      },
      sourceFactKey,
      sourceContextRef: member,
    }).canonicalSecurityClassId!);
  assert.equal(new Set(ids).size, 3);
  const priorTaxonomyClassA = deriveAuthoritativeCanonicalSecurityClassIdentity({
    issuerCik: cik,
    basis: "CLASS_SPECIFIC_COMMON_STOCK",
    sourceCanonicalKey: "fixture-prior-CommonClassAMember",
    sourceIdentity: {
      axis: { namespaceUri: "http://fasb.org/us-gaap/2025", localName: "StatementClassOfStockAxis" },
      member: { namespaceUri: "http://fasb.org/us-gaap/2025", localName: "CommonClassAMember" },
    },
    sourceConcept: {
      namespaceUri: "http://xbrl.sec.gov/dei/2025",
      localName: "EntityCommonStockSharesOutstanding",
    },
    sourceFactKey,
    sourceContextRef: "prior-class-a",
  });
  assert.equal(priorTaxonomyClassA.canonicalSecurityClassId, ids[0]);
  const ambiguous = deriveLevel2CanonicalSecurityClassIdentity({
    issuerCik: cik,
    securityClassKind: "common_stock",
    sourceTitle: "common stock",
    supports: ids.map((id, index) => support(id, "CLASS_SPECIFIC_COMMON_STOCK", String(index + 1))),
  });
  assert.deepEqual(
    { status: ambiguous.status, id: ambiguous.canonicalSecurityClassId, kind: ambiguous.canonicalSecurityClassKind },
    { status: "unavailable", id: null, kind: null },
  );
});

test("custom common-stock member identity is prefix-independent and namespace-URI scoped", () => {
  const sourceConcept = {
    namespaceUri: "http://fasb.org/us-gaap/2026",
    localName: "CommonStockSharesOutstanding",
  };
  const first = deriveAuthoritativeCanonicalSecurityClassIdentity({
    issuerCik: cik,
    basis: "CLASS_SPECIFIC_COMMON_STOCK",
    sourceCanonicalKey: "fixture-custom-c",
    sourceIdentity: {
      axis: { namespaceUri: "http://fasb.org/us-gaap/2026", localName: "StatementClassOfStockAxis" },
      member: { namespaceUri: "https://issuer.example/taxonomy/20260630", localName: "CapitalClassCMember" },
    },
    sourceConcept,
    sourceFactKey,
    sourceContextRef: "custom-c",
  });
  const secondNamespace = deriveAuthoritativeCanonicalSecurityClassIdentity({
    issuerCik: cik,
    basis: "CLASS_SPECIFIC_COMMON_STOCK",
    sourceCanonicalKey: "fixture-custom-c-next",
    sourceIdentity: {
      axis: { namespaceUri: "http://fasb.org/us-gaap/2026", localName: "StatementClassOfStockAxis" },
      member: { namespaceUri: "https://issuer.example/taxonomy/20260930", localName: "CapitalClassCMember" },
    },
    sourceConcept,
    sourceFactKey,
    sourceContextRef: "custom-c-next",
  });
  assert.equal(first.status, "mapped");
  assert.match(first.canonicalSecurityClassId ?? "", /^sc:v1:0000000099:common_stock:custom:[0-9a-f]{64}:CapitalClassCMember$/);
  assert.notEqual(first.canonicalSecurityClassId, secondNamespace.canonicalSecurityClassId);

  const reservedPreferred = deriveAuthoritativeCanonicalSecurityClassIdentity({
    issuerCik: cik,
    basis: "CLASS_SPECIFIC_COMMON_STOCK",
    sourceCanonicalKey: "fixture-preferred",
    sourceIdentity: {
      axis: { namespaceUri: "http://fasb.org/us-gaap/2026", localName: "StatementClassOfStockAxis" },
      member: { namespaceUri: "http://fasb.org/us-gaap/2026", localName: "PreferredStockMember" },
    },
    sourceConcept,
    sourceFactKey,
    sourceContextRef: "preferred",
  });
  assert.equal(reservedPreferred.status, "unavailable");
});

test("ADR/ordinary ambiguity cannot masquerade as the common-stock sidecar enum", () => {
  const evidence = "As of August 18, 2026, 27,500,000 ordinary shares represented by ADSs were outstanding.";
  const extraction = extractLevel2ShareCountSidecar({
    payload: {
      share_count_observation: {
        observation_type: "source_stated",
        shares_outstanding: "27500000",
        as_of: "2026-08-18",
        security_class_kind: "adr",
        security_class_title: "ordinary shares represented by ADSs",
        source_ref: "sec-cover",
        evidence,
      },
    },
    accessionNumber: "0000000099-26-000010",
    sourceDocumentUrl: "https://www.sec.gov/Archives/edgar/data/99/fixture.htm",
    sourceDocuments: [{ source_ref: "sec-cover", text: evidence, document_name: "fixture.htm" }],
  });
  assert.equal(extraction.candidate, null);
  assert.ok(extraction.errors.some((error) => error.includes("security_class_kind")));
});

test("accepted_at uses only the raw SEC acceptance timestamp and rejects published/filed fallback", () => {
  const verified = resolveLevel2SecAcceptanceTimestamp({
    rawAcceptedAt: "2026-08-18T12:34:56.000Z",
    publishedAt: "2026-08-19T00:00:00.000Z",
    filedDate: "2026-08-18",
    accessionNumber: "0000000099-26-000010",
    rawItemId: "10000000-0000-5000-8000-000000000001",
  });
  assert.equal(verified.acceptedAt, "2026-08-18T12:34:56.000Z");
  assert.equal(verified.acceptedAtSource, "sec_raw_payload_acceptance");

  const unavailable = resolveLevel2SecAcceptanceTimestamp({
    rawAcceptedAt: null,
    publishedAt: "2026-08-19T00:00:00.000Z",
    filedDate: "2026-08-18",
    accessionNumber: "0000000099-26-000010",
    rawItemId: "10000000-0000-5000-8000-000000000001",
  });
  assert.equal(unavailable.acceptedAt, null);
  assert.equal(unavailable.acceptedAtSource, "unavailable");
  assert.deepEqual(unavailable.acceptedAtProvenance.rejectedFallbacks, {
    publishedAt: "2026-08-19T00:00:00.000Z",
    filedDate: "2026-08-18",
  });
});

function support(
  id: string,
  basis: CanonicalSecurityClassSupport["securityClassBasis"],
  observationId: string,
): CanonicalSecurityClassSupport {
  return {
    observationId,
    canonicalSecurityClassId: id,
    canonicalSecurityClassKind: "common_stock",
    securityClassBasis: basis,
    sourceFactKey,
    accessionNumber: "0000000099-26-000009",
  };
}
