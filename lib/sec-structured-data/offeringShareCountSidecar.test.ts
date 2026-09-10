import assert from "node:assert/strict";
import test from "node:test";
import type { OfferingMonitorJobIdentity } from "../offeringMonitorJobFoundation.ts";
import { extractLevel2ShareCountSidecar } from "./level2ShareCountObservation.ts";
import {
  extractOfferingShareCountFromSecRawItem,
  processOfferingShareCountSidecar,
} from "./offeringShareCountSidecar.ts";

const REAL_SEC_CASES = [
  {
    label: "S-1",
    form: "S-1",
    cik: "0001086757",
    accession: "0000950131-00-001602",
    filedDate: "2000-03-06",
    document: "0000950131-00-001602-d1.html",
    evidence: "As of March 3, 2000, there were 17,398,907 shares of Braun Consulting common stock outstanding",
    shares: "17398907",
    asOf: "2000-03-03",
  },
  {
    label: "S-3",
    form: "S-3",
    cik: "0001007587",
    accession: "0000950135-01-000362",
    filedDate: "2001-02-09",
    document: "b38262kvs-3.htm",
    evidence: "based upon the 8,619,075 shares of common stock outstanding as of January 22, 2001",
    shares: "8619075",
    asOf: "2001-01-22",
  },
  {
    label: "F-3",
    form: "F-3",
    cik: "0001907184",
    accession: "0001171843-25-004175",
    filedDate: "2025-06-27",
    document: "f3_062625.htm",
    evidence: "based on 17,962,173 Common Shares outstanding as of June 25, 2025",
    shares: "17962173",
    asOf: "2025-06-25",
  },
  {
    label: "424B5",
    form: "424B5",
    cik: "0001832483",
    accession: "0001213900-24-095468",
    filedDate: "2024-11-07",
    document: "ea0220317-424b5_serve.htm",
    evidence: "based on 44,298,197 shares of our Common Stock outstanding as of November 5, 2024",
    shares: "44298197",
    asOf: "2024-11-05",
  },
] as const;

for (const fixture of REAL_SEC_CASES) {
  test(`${fixture.label} actual SEC clause extracts deterministically with exact identity and evidence`, () => {
    const rawItem = rawFixture(fixture);
    const decision = extractOfferingShareCountFromSecRawItem(rawItem);
    assert.equal(decision.status, "eligible");
    if (decision.status !== "eligible") return;
    assert.equal(decision.candidate.sharesOutstanding, fixture.shares);
    assert.equal(decision.candidate.asOf, fixture.asOf);
    assert.equal(decision.candidate.evidence, fixture.evidence);
    assert.equal(decision.candidate.accessionNumber, fixture.accession);
    assert.equal(decision.candidate.sourceDocument, fixture.document);
    assert.match(decision.candidate.sourceContentHash, /^[0-9a-f]{64}$/);
  });
}

test("deterministic candidate is equivalent to the former validated Gemini sidecar contract", () => {
  const rawItem = rawFixture(REAL_SEC_CASES[1]);
  const decision = extractOfferingShareCountFromSecRawItem(rawItem);
  assert.equal(decision.status, "eligible");
  if (decision.status !== "eligible") return;
  const rawPayload = rawItem.raw_payload as Record<string, unknown>;
  const legacy = extractLevel2ShareCountSidecar({
    payload: {
      share_count_observation: {
        observation_type: decision.candidate.observationType,
        shares_outstanding: decision.candidate.sharesOutstanding,
        as_of: decision.candidate.asOf,
        security_class_kind: decision.candidate.securityClassKind,
        security_class_title: decision.candidate.securityClassTitle,
        source_ref: decision.candidate.sourceRef,
        evidence: decision.candidate.evidence,
      },
    },
    accessionNumber: decision.candidate.accessionNumber,
    sourceDocumentUrl: decision.candidate.sourceDocumentUrl,
    sourceDocuments: [{
      source_ref: decision.candidate.sourceRef,
      text: rawPayload.primary_document_html as string,
      document_name: decision.candidate.sourceDocument,
    }],
  });
  assert.deepEqual(legacy.errors, []);
  assert.deepEqual(legacy.candidate, decision.candidate);
});

test("latest non-future direct observation wins and same-date conflicts fail closed", () => {
  const older = "1,000,000 shares of our common stock outstanding as of January 1, 2024";
  const newer = "1,200,000 shares of our common stock outstanding as of February 1, 2024";
  const latest = extractOfferingShareCountFromSecRawItem(rawFixture({
    ...REAL_SEC_CASES[0], filedDate: "2024-02-10", evidence: `${older}. ${newer}`,
  }));
  assert.equal(latest.status, "eligible");
  if (latest.status === "eligible") assert.equal(latest.candidate.sharesOutstanding, "1200000");

  const conflict = extractOfferingShareCountFromSecRawItem(rawFixture({
    ...REAL_SEC_CASES[0], filedDate: "2024-02-10",
    evidence: `${newer}. 1,300,000 shares of our common stock outstanding as of February 1, 2024`,
  }));
  assert.deepEqual(
    conflict.status === "ineligible" ? conflict.reason : null,
    "CONFLICTING_CURRENT_OS_EVIDENCE",
  );
});

test("ambiguous classes and non-exact or forward values write no candidate", () => {
  const controls = [
    { evidence: "Approximately 2,000,000 shares of our common stock outstanding as of January 1, 2024.", reason: "CURRENT_OS_NOT_EXPLICIT" },
    { evidence: "On a pro forma basis, 2,000,000 shares of our common stock outstanding as of January 1, 2024.", reason: "CURRENT_OS_NOT_EXPLICIT" },
    { evidence: "2,000,000 shares of our common stock outstanding as of January 1, 2024, on an as adjusted basis.", reason: "CURRENT_OS_NOT_EXPLICIT" },
    { evidence: "Weighted average 2,000,000 shares of our common stock outstanding as of January 1, 2024.", reason: "CURRENT_OS_NOT_EXPLICIT" },
    { evidence: "There will be 2,000,000 shares of our common stock outstanding as of January 1, 2024.", reason: "CURRENT_OS_NOT_EXPLICIT" },
    { evidence: "2,000,000 shares of our common stock will be outstanding after this offering.", reason: "CURRENT_OS_NOT_EXPLICIT" },
    { evidence: "2,000,000 shares of common stock were issued as of January 1, 2024.", reason: "CURRENT_OS_NOT_EXPLICIT" },
    { evidence: "2,000,000 shares of our common stock outstanding as of January 1, 2025.", reason: "AS_OF_DATE_INVALID" },
    { evidence: "2,000,000 ordinary shares outstanding as of January 1, 2024.", reason: "SECURITY_CLASS_AMBIGUOUS" },
    { evidence: "Our Class A common stock is voting stock. 2,000,000 shares of our common stock outstanding as of January 1, 2024.", reason: "SECURITY_CLASS_AMBIGUOUS" },
    { evidence: "Each ADS represents one common share. 2,000,000 Common Shares outstanding as of January 1, 2024.", reason: "SECURITY_CLASS_AMBIGUOUS" },
  ];
  for (const control of controls) {
    const decision = extractOfferingShareCountFromSecRawItem(rawFixture({
      ...REAL_SEC_CASES[0], filedDate: "2024-02-10", evidence: control.evidence,
    }));
    assert.equal(decision.status, "ineligible", control.evidence);
    if (decision.status === "ineligible") assert.equal(decision.reason, control.reason, control.evidence);
  }
});

test("unsupported form, truncated source, and primary-document mismatch fail closed", () => {
  const unsupported = rawFixture({ ...REAL_SEC_CASES[0], form: "8-K" });
  assert.equal(ineligibleReason(unsupported), "FORM_NOT_SUPPORTED");

  const truncated = rawFixture(REAL_SEC_CASES[0]);
  (truncated.raw_payload as Record<string, unknown>).primary_document_html_truncated = true;
  assert.equal(ineligibleReason(truncated), "PRIMARY_DOCUMENT_INCOMPLETE");

  const mismatched = rawFixture(REAL_SEC_CASES[0]);
  const documents = (mismatched.raw_payload as Record<string, unknown>).documents as Record<string, unknown>[];
  documents[0]!.document = "other.htm";
  assert.equal(ineligibleReason(mismatched), "PRIMARY_DOCUMENT_IDENTITY_INCOMPLETE");
});

test("raw, metadata, and SEC archive issuer CIK must resolve to one canonical issuer", async () => {
  const controls = [
    (rawItem: ReturnType<typeof rawFixture>) => {
      const payload = rawItem.raw_payload as Record<string, unknown>;
      payload.cik = "1";
      payload.cik_padded = "0000000001";
    },
    (rawItem: ReturnType<typeof rawFixture>) => {
      (rawItem.metadata as Record<string, unknown>).cik = "0000000001";
    },
    (rawItem: ReturnType<typeof rawFixture>) => replaceArchiveIssuerCik(rawItem, "1"),
    (rawItem: ReturnType<typeof rawFixture>) => {
      const payload = rawItem.raw_payload as Record<string, unknown>;
      delete payload.cik;
      delete payload.cik_padded;
    },
    (rawItem: ReturnType<typeof rawFixture>) => {
      delete (rawItem.metadata as Record<string, unknown>).cik;
    },
    (rawItem: ReturnType<typeof rawFixture>) => replaceArchiveIssuerCik(rawItem, "unknown"),
  ];

  let writes = 0;
  const identity = identityFor(REAL_SEC_CASES[3]);
  for (const mutate of controls) {
    const rawItem = rawFixture(REAL_SEC_CASES[3]);
    mutate(rawItem);
    const result = await processOfferingShareCountSidecar(identity, {
      readParentAuthority: async () => ({
        status: "current" as const,
        latestPrimaryAiRunId: identity.parentPrimaryAiRunId,
      }),
      loadRawItem: async () => rawItem,
      persist: async () => {
        writes += 1;
        return { inserted: 1, deduped: 0 };
      },
    });
    assert.equal(result.status, "ineligible");
    if (result.status === "ineligible") {
      assert.equal(result.reason, "RAW_ITEM_IDENTITY_INCOMPLETE");
    }
  }
  assert.equal(writes, 0);
});

test("standalone processor persists without any provider call and replays as a dedupe", async () => {
  const rawItem = rawFixture(REAL_SEC_CASES[3]);
  const identity = identityFor(REAL_SEC_CASES[3]);
  let providerCalls = 0;
  let inserts = 0;
  const seen = new Set<string>();
  const dependencies = {
    readParentAuthority: async () => ({ status: "current" as const, latestPrimaryAiRunId: identity.parentPrimaryAiRunId }),
    loadRawItem: async () => rawItem,
    persist: async ({ candidate }: { candidate: { sourceContentHash: string; evidence: string } }) => {
      const key = `${candidate.sourceContentHash}|${candidate.evidence}`;
      const inserted = seen.has(key) ? 0 : 1;
      seen.add(key);
      inserts += inserted;
      return { inserted, deduped: inserted ? 0 : 1 };
    },
    runProvider: async () => { providerCalls += 1; },
  };
  const first = await processOfferingShareCountSidecar(identity, dependencies);
  const replay = await processOfferingShareCountSidecar(identity, dependencies);
  assert.deepEqual(first.status === "completed" ? [first.inserted, first.deduped] : null, [1, 0]);
  assert.deepEqual(replay.status === "completed" ? [replay.inserted, replay.deduped] : null, [0, 1]);
  assert.equal(inserts, 1);
  assert.equal(providerCalls, 0);
  assert.equal(first.providerCalled, false);
  assert.equal(replay.providerCalled, false);
});

test("standalone processor rechecks parent authority before persistence", async () => {
  const identity = identityFor(REAL_SEC_CASES[0]);
  let authorityReads = 0;
  let writes = 0;
  const result = await processOfferingShareCountSidecar(identity, {
    readParentAuthority: async () => {
      authorityReads += 1;
      return authorityReads === 1
        ? { status: "current" as const, latestPrimaryAiRunId: identity.parentPrimaryAiRunId }
        : { status: "stale" as const, latestPrimaryAiRunId: "11111111-1111-4111-8111-111111111111" };
    },
    loadRawItem: async () => rawFixture(REAL_SEC_CASES[0]),
    persist: async () => { writes += 1; return { inserted: 1, deduped: 0 }; },
  });
  assert.equal(result.status, "stale");
  assert.equal(writes, 0);
});

function rawFixture(fixture: {
  form: string;
  cik: string;
  accession: string;
  filedDate: string;
  document: string;
  evidence?: string;
}) {
  const html = `<html><body><p>${fixture.evidence || REAL_SEC_CASES[0].evidence}.</p></body></html>`;
  const url = `https://www.sec.gov/Archives/edgar/data/${Number(fixture.cik)}/${fixture.accession.replace(/-/g, "")}/${fixture.document}`;
  return {
    id: "efea3384-9eef-4e6b-9e63-60dc1cd3090e",
    source_code: "sec_edgar",
    source_unique_id: fixture.accession,
    raw_payload: {
      form_type: fixture.form,
      cik: fixture.cik,
      cik_padded: fixture.cik,
      accession_number: fixture.accession,
      filing_date: fixture.filedDate,
      accepted_at: `${fixture.filedDate}T12:00:00.000Z`,
      primary_document_url: url,
      primary_document_html: html,
      primary_document_html_char_count: html.length,
      primary_document_html_truncated: false,
      documents: [{
        document: fixture.document,
        url,
        isPrimary: true,
        rawHtmlPreserved: true,
        rawHtmlCharCount: html.length,
        rawHtmlTruncated: false,
      }],
    },
    metadata: { form_type: fixture.form, cik: fixture.cik, filing_date: fixture.filedDate },
  };
}

function identityFor(fixture: typeof REAL_SEC_CASES[number]): OfferingMonitorJobIdentity {
  const family = fixture.form === "S-1" ? "s1" : fixture.form === "S-3" || fixture.form === "F-3" ? "s3" : "424b";
  return {
    schemaVersion: "offering_monitor_job_v2",
    purpose: "offering_monitor_normalization",
    jobId: "c6eaecad-5d37-57da-8dcd-5cd985e03978",
    logicalJobId: "b6eaecad-5d37-57da-8dcd-5cd985e03977",
    executionId: "c6eaecad-5d37-57da-8dcd-5cd985e03978",
    executionContractVersion: "second_stage_direct_v8",
    executionAttemptKey: "automatic",
    eventId: "69606800-ee16-4a75-9bbf-3b64bdc56d69",
    rawItemId: "efea3384-9eef-4e6b-9e63-60dc1cd3090e",
    sourceIdentity: fixture.accession,
    formType: fixture.form,
    family,
    parentPrimaryAiRunId: "5b09ac72-ce61-4d75-800d-9c115977ab4c",
    parentPromptKey: family === "s1" ? "sec_s1_f1_analysis" : family === "s3" ? "sec_s3_offering_analysis" : "sec_424b_analysis",
    parentPromptVersion: "test",
    enqueuedAt: "2026-09-10T00:00:00.000Z",
  };
}

function replaceArchiveIssuerCik(rawItem: ReturnType<typeof rawFixture>, replacement: string) {
  const payload = rawItem.raw_payload as Record<string, unknown>;
  const currentUrl = String(payload.primary_document_url);
  const nextUrl = currentUrl.replace(/(\/Archives\/edgar\/data\/)[^/]+\//, `$1${replacement}/`);
  payload.primary_document_url = nextUrl;
  const documents = payload.documents as Record<string, unknown>[];
  documents[0]!.url = nextUrl;
}

function ineligibleReason(rawItem: Record<string, unknown>) {
  const decision = extractOfferingShareCountFromSecRawItem(rawItem);
  return decision.status === "ineligible" ? decision.reason : null;
}
