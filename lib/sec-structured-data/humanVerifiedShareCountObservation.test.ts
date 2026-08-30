import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type { DilutionRegistryOsSourceBundle } from "../dilution-registry/osPreview.ts";
import type { DilutionRegistryPayload } from "../dilution-registry/preview.ts";
import { resolveClassShareCountAt } from "./classShareCountResolver.ts";
import { InMemorySecFilingXbrlArtifactRepository } from "./filingXbrlContext.ts";
import {
  InMemoryIssuerCommonClassUniverseRepository,
  type IssuerCommonClassUniverseSnapshot,
} from "./issuerCommonClassUniverse.ts";
import {
  type HumanVerifiedSecFilingLedger,
  writeHumanVerifiedShareCountObservation,
} from "./humanVerifiedShareCountObservation.ts";
import {
  InMemoryShareCountHistoryRepository,
  readShareCountHistory,
} from "./shareCountHistory.ts";

const CIK = "0001840317";
const S3_ACCESSION = "0001213900-26-072701";
const S3_DOCUMENT = "ea0295954-s3_veea.htm";
const S3_URL = `https://www.sec.gov/Archives/edgar/data/1840317/000121390026072701/${S3_DOCUMENT}`;
const S3_EVIDENCE = "The aggregate market value of our outstanding common stock held by non-affiliates was calculated based on 55,116,953 shares of common stock outstanding, as of June 24, 2026.";
const APPROVAL = {
  approverUserId: "6fcb1048-5f2d-4ef0-9f8b-c35a8db393bd",
  approvedAt: "2026-06-26T21:30:00.000Z",
};
const LEDGER: HumanVerifiedSecFilingLedger = {
  issuerCik: CIK,
  accessionNumber: S3_ACCESSION,
  form: "S-3",
  filedDate: "2026-06-26",
  acceptedAt: "2026-06-26T21:09:26.000Z",
  primaryDocument: S3_DOCUMENT,
  sourceRawId: "10d91f32-879e-43d7-a0aa-2c5d33ddad58",
};

test("Verified VEEA S-3 persists exact SEC artifact/history once and resolves from the existing resolver", async () => {
  const harness = await createHarness();
  const first = await write(harness);
  const replay = await write(harness);

  assert.deepEqual(first, {
    status: "INSERTED", inserted: 1, deduped: 0, verifierStatus: "Verified", reasons: [],
  });
  assert.deepEqual(replay, {
    status: "REPLAY", inserted: 0, deduped: 1, verifierStatus: "Verified", reasons: [],
  });
  const history = await readShareCountHistory(harness.history, CIK);
  assert.equal(history.length, 1);
  assert.equal(history[0]?.sourceType, "sec_filing_text_human_verified");
  assert.equal(history[0]?.sharesOutstanding, "55116953");
  assert.equal(history[0]?.acceptedAt, "2026-06-26T21:09:26.000Z");
  assert.equal(history[0]?.acceptedAtSource, "sec_filing_ledger");
  assert.equal(history[0]?.filingLedgerRawSourceId, LEDGER.sourceRawId);
  assert.notEqual(history[0]?.sourceArtifactId, LEDGER.sourceRawId);
  assert.deepEqual(history[0]?.sourceProvenance.approval, {
    approver_user_id: APPROVAL.approverUserId,
    approved_at: APPROVAL.approvedAt,
  });
  assert.equal(
    (history[0]?.sourceProvenance.classUniverse as Record<string, unknown> | undefined)?.futureSnapshotUsed,
    false,
  );

  const artifacts = await harness.artifacts.readArtifacts(CIK, S3_ACCESSION);
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0]?.documentName, S3_DOCUMENT);
  assert.equal(artifacts[0]?.sourceUrl, S3_URL);
  assert.equal(artifacts[0]?.rawContent, html(S3_EVIDENCE));
  assert.equal(history[0]?.sourceArtifactId, artifacts[0]?.id);

  const resolution = await resolveClassShareCountAt({
    repository: harness.history,
    cik: CIK,
    securityClassId: `sc:v1:${CIK}:common_stock:single`,
    targetAt: "2026-06-27T00:00:00.000Z",
  });
  assert.equal(resolution.status, "RESOLVED");
  assert.equal(resolution.sharesOutstanding, "55116953");
});

test("+1, future/expected, pro forma, missing baseline, and ADS Review each insert zero rows", async () => {
  const cases: Array<{
    name: string;
    payload?: DilutionRegistryPayload;
    evidence?: string;
    baseline?: "missing" | "complete";
    expectedStatus: "Review" | "Not Verified";
  }> = [
    {
      name: "+1 share",
      payload: payload({ shares_outstanding: "55116954" }),
      expectedStatus: "Not Verified",
    },
    {
      name: "following-offering expected",
      evidence: "Following the offering, 55,116,953 shares of common stock are expected to be outstanding, as of June 24, 2026.",
      expectedStatus: "Not Verified",
    },
    {
      name: "pro forma future",
      evidence: "Pro forma shares of common stock outstanding will be 55,116,953, as of June 24, 2026.",
      expectedStatus: "Not Verified",
    },
    {
      name: "missing baseline",
      baseline: "missing",
      expectedStatus: "Review",
    },
    {
      name: "+1 share with missing baseline",
      payload: payload({ shares_outstanding: "55116954" }),
      baseline: "missing",
      expectedStatus: "Not Verified",
    },
    {
      name: "ADS Review",
      evidence: "There were 55,116,953 American Depositary Shares outstanding, as of June 24, 2026.",
      expectedStatus: "Review",
    },
  ];

  for (const fixture of cases) {
    const evidence = fixture.evidence ?? (fixture.name === "ADS Review"
      ? "There were 55,116,953 American Depositary Shares outstanding, as of June 24, 2026."
      : S3_EVIDENCE);
    const harness = await createHarness({ baseline: fixture.baseline, evidence });
    const sourcePayload = fixture.name === "ADS Review"
      ? payload({ security_class_title: "American Depositary Shares", evidence })
      : fixture.payload ?? payload({ evidence });
    const result = await write(harness, sourcePayload);
    assert.equal(result.status, "REJECTED", fixture.name);
    assert.equal(result.verifierStatus, fixture.expectedStatus, fixture.name);
    assert.equal((await readShareCountHistory(harness.history, CIK)).length, 0, fixture.name);
    assert.equal((await harness.artifacts.readArtifacts(CIK, S3_ACCESSION)).length, 0, fixture.name);
  }
});

test("multi-class and ambiguous universes insert zero rows", async () => {
  for (const snapshot of [multiSnapshot(), ambiguousSnapshot()]) {
    const history = new InMemoryShareCountHistoryRepository();
    const artifacts = new InMemorySecFilingXbrlArtifactRepository();
    const universe = new InMemoryIssuerCommonClassUniverseRepository();
    await universe.insertSnapshot(snapshot);
    const result = await writeHumanVerifiedShareCountObservation({
      payload: payload(), approval: APPROVAL, ingestedAt: "2026-06-26T21:31:00.000Z",
    }, {
      historyRepository: history,
      artifactRepository: artifacts,
      universeRepository: universe,
      readLedger: async () => LEDGER,
      readSourceBundle: async () => sourceBundle(S3_EVIDENCE),
    });
    assert.equal(result.status, "REJECTED");
    assert.equal(result.verifierStatus, "Review");
    assert.equal(result.inserted, 0);
    assert.equal((await readShareCountHistory(history, CIK)).length, 0);
  }
});

async function createHarness(options: { baseline?: "missing" | "complete"; evidence?: string } = {}) {
  const history = new InMemoryShareCountHistoryRepository();
  const artifacts = new InMemorySecFilingXbrlArtifactRepository();
  const universe = new InMemoryIssuerCommonClassUniverseRepository();
  if (options.baseline !== "missing") await universe.insertSnapshot(q1Snapshot());
  const evidence = options.evidence ?? S3_EVIDENCE;
  return {
    history,
    artifacts,
    universe,
    readLedger: async () => structuredClone(LEDGER),
    readSourceBundle: async () => sourceBundle(evidence),
  };
}

async function write(
  harness: Awaited<ReturnType<typeof createHarness>>,
  sourcePayload = payload(),
) {
  return writeHumanVerifiedShareCountObservation({
    payload: sourcePayload,
    approval: APPROVAL,
    ingestedAt: "2026-06-26T21:31:00.000Z",
  }, {
    historyRepository: harness.history,
    artifactRepository: harness.artifacts,
    universeRepository: harness.universe,
    readLedger: harness.readLedger,
    readSourceBundle: harness.readSourceBundle,
  });
}

function payload(override: Record<string, unknown> = {}): DilutionRegistryPayload {
  return {
    issuer: { issuer_cik: CIK, ticker: "VEEA" },
    instruments: [], snapshots: [], activities: [], totals: [],
    os_observations: [{
      observation_type: "source_stated",
      shares_outstanding: "55116953",
      as_of: "2026-06-24",
      security_class_kind: "common_stock",
      security_class_title: "common stock",
      source_accession: S3_ACCESSION,
      source_form: "S-3",
      source_ref: S3_DOCUMENT,
      evidence: S3_EVIDENCE,
      ...override,
    }],
  };
}

function sourceBundle(evidence: string): DilutionRegistryOsSourceBundle {
  const rawContent = html(evidence);
  return {
    ok: true,
    sourceMode: "official_sec_fallback",
    classUniverseMode: null,
    ledger: {
      issuer_cik: CIK,
      accession_number: S3_ACCESSION,
      form: "S-3",
      primary_document: S3_DOCUMENT,
    },
    documents: [{
      source_ref: S3_DOCUMENT,
      source_url: S3_URL,
      document_name: S3_DOCUMENT,
      label: S3_DOCUMENT,
      text: evidence,
    }],
    officialSecFallbackArtifact: {
      sourceUrl: S3_URL,
      fetchedAt: "2026-06-26T21:32:00.000Z",
      contentType: "text/html; charset=utf-8",
      rawContent,
    },
    classUniverse: null,
  };
}

function q1Snapshot(): IssuerCommonClassUniverseSnapshot {
  const canonicalSecurityClassId = `sc:v1:${CIK}:common_stock:single`;
  return {
    id: null,
    snapshotVersion: "issuer-common-class-universe-snapshot-v1",
    issuerCik: CIK,
    universeAsOf: "2026-05-13",
    acceptedAt: "2026-05-15T20:06:28.000Z",
    sourceAccession: "0001213900-26-057059",
    sourceForm: "10-Q",
    sourceFiledDate: "2026-05-15",
    sourceDocuments: ["ea0290631-10q_veea.htm"],
    status: "COMPLETE_SINGLE",
    reason: "COMPLETE_SINGLE_COMMON_STOCK",
    requiredCanonicalSecurityClassIds: [canonicalSecurityClassId],
    classEvidence: [{
      canonicalSecurityClassId,
      sharesOutstanding: "50407567",
      sourceFacts: [sourceFact("q1", "50407567")],
    }],
    aggregateEvidence: [],
    excludedEvidence: [],
    completenessProvenance: { historicalClassUnionUsed: false, fixture: "VEEA Q1" },
    sourceIdentityHash: hash("VEEA-Q1-universe"),
    createdAt: null,
  };
}

function multiSnapshot(): IssuerCommonClassUniverseSnapshot {
  const classA = `sc:v1:${CIK}:common_stock:us-gaap:CommonClassAMember`;
  const classB = `sc:v1:${CIK}:common_stock:us-gaap:CommonClassBMember`;
  return {
    ...q1Snapshot(),
    snapshotVersion: "issuer-common-class-universe-snapshot-v2",
    status: "COMPLETE_MULTI",
    reason: "COMPLETE_MULTI_COMMON_STOCK",
    requiredCanonicalSecurityClassIds: [classA, classB],
    classEvidence: [
      { canonicalSecurityClassId: classA, sharesOutstanding: "25000000", sourceFacts: [sourceFact("class-a", "25000000", "CommonClassAMember")] },
      { canonicalSecurityClassId: classB, sharesOutstanding: "25407567", sourceFacts: [sourceFact("class-b", "25407567", "CommonClassBMember")] },
    ],
    sourceIdentityHash: hash("VEEA-multi-universe"),
  };
}

function ambiguousSnapshot(): IssuerCommonClassUniverseSnapshot {
  return {
    ...q1Snapshot(),
    status: "AMBIGUOUS",
    reason: "ADS_OR_ORDINARY_AMBIGUOUS",
    requiredCanonicalSecurityClassIds: [],
    classEvidence: [],
    sourceIdentityHash: hash("VEEA-ADS-universe"),
  };
}

function sourceFact(suffix: string, sharesOutstanding: string, member?: string) {
  const dimensions = member ? [{
    kind: "explicit" as const,
    axis: qname("us-gaap:StatementClassOfStockAxis"),
    member: qname(`us-gaap:${member}`),
  }] : [];
  return {
    factKey: hash(`fact-${suffix}`),
    concept: qname("dei:EntityCommonStockSharesOutstanding", "http://xbrl.sec.gov/dei/2026"),
    contextRef: `ctx-${suffix}`,
    sharesOutstanding,
    documentName: "ea0290631-10q_veea.htm",
    sourceUrl: "https://www.sec.gov/Archives/edgar/data/1840317/000121390026057059/ea0290631-10q_veea.htm",
    contentHash: hash(`content-${suffix}`),
    artifactId: uuid(`artifact-${suffix}`),
    dimensions,
  };
}

function qname(qnameValue: string, namespaceUri = "http://fasb.org/us-gaap/2026") {
  const [prefix, localName] = qnameValue.split(":");
  return { qname: qnameValue, prefix: prefix!, localName: localName!, namespaceUri };
}

function html(evidence: string) {
  return `<html><body><p>${evidence}</p></body></html>`;
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function uuid(value: string) {
  const hex = hash(value);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
