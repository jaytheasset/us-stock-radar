import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryShareCountHistoryRepository, readShareCountHistory } from "./shareCountHistory.ts";
import {
  extractLevel2ShareCountSidecar,
  writeLevel2ShareCountObservation,
} from "./level2ShareCountObservation.ts";

const exactEvidence = "As of August 18, 2026, 27,500,000 shares of common stock were outstanding.";
const source = {
  source_ref: "sec:block:cover",
  document_name: "issuer-20260818.htm",
  text: `Cover page. ${exactEvidence} End.`,
};

test("exact source-stated O/S validates, preserves stated basis, persists, and replays idempotently", async () => {
  const extraction = extractLevel2ShareCountSidecar({
    payload: {
      status: "not_applicable",
      share_count_observation: {
        observation_type: "source_stated",
        shares_outstanding: "27500000",
        as_of: "2026-08-18",
        security_class_kind: "common_stock",
        security_class_title: "common stock",
        basis: "issued and outstanding",
        source_ref: source.source_ref,
        evidence: exactEvidence,
      },
    },
    accessionNumber: "0000000099-26-000010",
    sourceDocumentUrl: "https://www.sec.gov/Archives/edgar/data/99/issuer-20260818.htm",
    sourceDocuments: [source],
  });
  assert.deepEqual(extraction.domainPayload, { status: "not_applicable" });
  assert.deepEqual(extraction.errors, []);
  assert.equal(extraction.candidate?.sharesOutstanding, "27500000");
  assert.equal(extraction.candidate?.basis, "issued and outstanding");
  assert.equal(extraction.candidate?.sourceDocument, "issuer-20260818.htm");

  const repository = new InMemoryShareCountHistoryRepository();
  const context = persistenceContext();
  assert.deepEqual(await writeLevel2ShareCountObservation({
    repository, candidate: extraction.candidate!, context,
  }), { inserted: 1, deduped: 0 });
  assert.deepEqual(await writeLevel2ShareCountObservation({
    repository, candidate: structuredClone(extraction.candidate!), context: { ...context, sourceExecutionId: "30000000-0000-5000-8000-000000000099" },
  }), { inserted: 0, deduped: 1 });
  const history = await readShareCountHistory(repository, "0000000099");
  assert.equal(history.length, 1);
  assert.equal(history[0]?.sourceType, "sec_filing_text_level2");
  assert.equal(history[0]?.observationType, "source_stated");
  assert.equal(history[0]?.sourceEvidence, exactEvidence);
  assert.equal(history[0]?.canonicalSecurityClassId, "sc:v1:0000000099:common_stock:single");
  assert.equal(history[0]?.acceptedAtSource, "sec_raw_payload_acceptance");
  assert.equal("winner" in history[0]! || "latest" in history[0]! || "isCurrent" in history[0]!, false);
});

test("absence and forbidden semantic controls produce no deterministic candidate or row", async () => {
  const repository = new InMemoryShareCountHistoryRepository();
  const controls = [
    "Weighted-average shares used in computing net loss per share were 27,500,000.",
    "The company is authorized to issue 100,000,000 shares of common stock.",
    "The company had 27,500,000 shares outstanding.",
    "As of August 18, 2026, 27,500,000 shares were outstanding across an unspecified class.",
  ];
  for (const text of controls) {
    const extraction = extractLevel2ShareCountSidecar({
      payload: { status: "not_applicable" },
      accessionNumber: "0000000099-26-000010",
      sourceDocumentUrl: "https://www.sec.gov/Archives/edgar/data/99/fixture.htm",
      sourceDocuments: [{ source_ref: "control", document_name: "fixture.htm", text }],
    });
    assert.equal(extraction.present, false);
    assert.equal(extraction.candidate, null);
  }
  assert.equal((await readShareCountHistory(repository, "0000000099")).length, 0);
});

test("missing SEC acceptance timestamp persists as unavailable without promoting fallback time", async () => {
  const extraction = extractLevel2ShareCountSidecar({
    payload: {
      share_count_observation: {
        observation_type: "source_stated",
        shares_outstanding: "27500000",
        as_of: "2026-08-18",
        security_class_kind: "common_stock",
        security_class_title: "common stock",
        source_ref: source.source_ref,
        evidence: exactEvidence,
      },
    },
    accessionNumber: "0000000099-26-000010",
    sourceDocumentUrl: "https://www.sec.gov/Archives/edgar/data/99/issuer-20260818.htm",
    sourceDocuments: [source],
  });
  const repository = new InMemoryShareCountHistoryRepository();
  const context = {
    ...persistenceContext(),
    acceptedAt: null,
    acceptedAtSource: "unavailable" as const,
    acceptedAtProvenance: {
      source: "unavailable",
      reason: "SEC_ACCEPTANCE_TIMESTAMP_UNAVAILABLE",
      rejectedFallbacks: { publishedAt: "2026-08-19T00:00:00.000Z", filedDate: "2026-08-18" },
    },
  };
  await writeLevel2ShareCountObservation({ repository, candidate: extraction.candidate!, context });
  const [stored] = await readShareCountHistory(repository, "0000000099");
  assert.equal(stored?.acceptedAt, null);
  assert.equal(stored?.acceptedAtSource, "unavailable");
});

test("deterministic validation rejects missing date, invalid integer, class omission, foreign provenance, and noncontiguous evidence", () => {
  const invalidCandidates = [
    { shares_outstanding: "27500000", security_class_title: "common stock" },
    { shares_outstanding: "27.5 million", as_of: "2026-08-18", security_class_title: "common stock" },
    { shares_outstanding: "27500000", as_of: "2026-08-18" },
    { shares_outstanding: "27500000", as_of: "2026-08-18", security_class_title: "common stock", source_ref: "foreign" },
    { shares_outstanding: "27500000", as_of: "2026-08-18", security_class_title: "common stock", evidence: "not in source" },
  ];
  for (const partial of invalidCandidates) {
    const extraction = extractLevel2ShareCountSidecar({
      payload: {
        share_count_observation: {
          observation_type: "source_stated",
          security_class_kind: "common_stock",
          source_ref: source.source_ref,
          evidence: exactEvidence,
          ...partial,
        },
      },
      accessionNumber: "0000000099-26-000010",
      sourceDocumentUrl: "https://www.sec.gov/Archives/edgar/data/99/issuer-20260818.htm",
      sourceDocuments: [source],
    });
    assert.equal(extraction.candidate, null);
    assert.ok(extraction.errors.length > 0);
  }
});

function persistenceContext() {
  return {
    issuerCik: "0000000099",
    form: "8-K",
    filedDate: "2026-08-18",
    acceptedAt: "2026-08-18T12:00:00.000Z",
    acceptedAtSource: "sec_raw_payload_acceptance",
    acceptedAtProvenance: { source: "raw_items.raw_payload.accepted_at" },
    ingestedAt: "2026-08-22T12:00:00.000Z",
    rawItemId: "10000000-0000-5000-8000-000000000001",
    eventId: "20000000-0000-5000-8000-000000000001",
    parentPrimaryAiRunId: "30000000-0000-5000-8000-000000000001",
    sourceExecutionId: "40000000-0000-5000-8000-000000000001",
    analyzerKey: "listing_risk",
    canonicalSecurityClassSupports: [{
      observationId: "1",
      canonicalSecurityClassId: "sc:v1:0000000099:common_stock:single",
      canonicalSecurityClassKind: "common_stock",
      securityClassBasis: "SINGLE_COMMON_STOCK_CLASS",
      sourceFactKey: "a".repeat(64),
      accessionNumber: "0000000099-26-000009",
    }],
  } as const;
}
