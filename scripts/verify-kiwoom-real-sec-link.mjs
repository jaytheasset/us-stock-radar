// Offline verification only. Inputs are retained HTTP bodies, not synthetic SEC claims.
// Run with the existing resolve-server-only/resolve-ts-paths loaders (see receipt).
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";

const [manifestPath, outputPath] = process.argv.slice(2);
assert.ok(manifestPath && outputPath, "Usage: <manifest.json> <output.json>");
let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw new Error("Offline replay forbids network access"); };
const { buildSecCoverObservationPayload, validateSecCoverStoredPayload } = await import("../lib/sec-cover-observations/canonical.ts");
const { coverObservations } = await import("../lib/sec-ticker-resolution/persistence.ts");
const { evaluateSecTickerResolution } = await import("../lib/sec-ticker-resolution/canonical.ts");
const { candidateRevision, createCandidateEvidenceLink, checkCandidateEvidenceLink } = await import("../lib/ticker-verification/kiwoom/candidateLink.ts");
const { reviewRequestHash } = await import("../lib/ticker-verification/kiwoom/review.ts");
const { validateSnapshot } = await import("../lib/ticker-verification/kiwoom/source.ts");
const { manualRows, retainedNotice } = await import("../lib/ticker-verification/kiwoom/candidateLink.samples.ts");
const hash = value => createHash("sha256").update(value).digest("hex");
const base = dirname(resolve(manifestPath));
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
assert.equal(manifest.version, 1);
const report = {
  scope: "real_SEC_sources_and_real_Kiwoom_snapshot_with_test_only_review_metadata",
  inputManifestSha256: hash(await readFile(manifestPath)),
  productCodeModified: false, databaseConnections: 0, authenticatedApproval: false,
  sourceAcquisition: manifest.fetches, captureNote: manifest.captureNote,
  coverResults: [], candidate: null, linkage: null,
};
async function readVerified(entry) {
  const bytes = await readFile(resolve(base, entry.file));
  assert.equal(hash(bytes), entry.sha256, `Source hash mismatch: ${entry.file}`);
  return bytes.toString("utf8");
}
const submissions = JSON.parse(await readVerified(manifest.submissions));
const recent = submissions.filings.recent;
const covers = [];
for (const entry of manifest.filings) {
  const index = recent.accessionNumber.indexOf(entry.accession);
  assert.ok(index >= 0, "Accession must come from retained official Submissions metadata");
  const metadata = Object.fromEntries(["accessionNumber", "filingDate", "acceptanceDateTime", "form", "primaryDocument"].map(k => [k, recent[k][index]]));
  const cik = String(submissions.cik).padStart(10, "0");
  const url = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${entry.accession.replaceAll("-", "")}/${metadata.primaryDocument}`;
  const rawContent = await readVerified(entry);
  // Local row envelope only, explicitly NOT an existing database raw-item identifier.
  const rawItemId = entry.role === "before" ? "10000000-0000-4000-8000-000000000001" : "20000000-0000-4000-8000-000000000002";
  const built = buildSecCoverObservationPayload(rawItemId, {
    id: rawItemId, source_code: "sec_edgar", source_group: "filings", source_unique_id: metadata.accessionNumber,
    source_url: url, fetched_at: entry.capturedAt,
    raw_payload: { accession_number: metadata.accessionNumber, cik, form_type: metadata.form,
      filing_date: metadata.filingDate, accepted_at: metadata.acceptanceDateTime,
      primary_document_url: url, primary_document_html: rawContent,
      primary_document_html_char_count: rawContent.length, primary_document_html_truncated: false },
  });
  if (!built) {
    report.coverResults.push({ role: entry.role, metadata, url, sourceSha256: entry.sha256, status: "not_applicable" });
    continue;
  }
  const validation = validateSecCoverStoredPayload({ result: built.result, observations: built.observations, rawSource: built.sourceRaw });
  assert.equal(validation.ok, true, JSON.stringify(validation));
  const observations = coverObservations({ result: built.result, observations: built.observations, payload: built.payload });
  report.coverResults.push({ role: entry.role, metadata, url, sourceSha256: entry.sha256,
    status: built.payload.extractionStatus, replayValidation: validation.ok,
    resultId: built.resultId, issues: built.payload.issues, observations });
  covers.push({ role: entry.role, built, observations, rawContent });
}
const snapshot = JSON.parse(await readFile(resolve(base, manifest.kiwoom.file), "utf8"));
assert.ok(validateSnapshot(snapshot));
assert.equal(snapshot.sourceHash, manifest.kiwoom.sourceHash);
assert.equal(snapshot.images[0].sha256, manifest.kiwoom.imageSha256);
assert.equal(snapshot.id, retainedNotice.id);
assert.equal(snapshot.sourceHash, retainedNotice.sourceHash);
assert.equal(snapshot.images[0].sha256, retainedNotice.imageSha256);
const sample = structuredClone(manualRows[manifest.kiwoom.manualSample]);
assert.ok(sample, "An explicitly manually transcribed sample is required");
report.kiwoom = { id: snapshot.id, sourceUrl: snapshot.sourceUrl, postedDate: snapshot.postedDate,
  capturedAt: snapshot.capturedAt, sourceHash: snapshot.sourceHash, imageSha256: snapshot.images[0].sha256,
  transcription: sample, method: "manual_reading_of_retained_original_image_not_OCR" };
const before = covers.find(c => c.role === "before"), after = covers.find(c => c.role === "after");
if (!before || !after) {
  report.inputBoundary = "existing_cover_builder_not_applicable; no invented observations or candidate";
} else {
  const p = after.built.payload;
  const evaluation = evaluateSecTickerResolution({
    issuerCik: p.identity.issuerCik, evidenceAccessionNumber: p.identity.accessionNumber,
    beforeAccessionNumber: before.built.payload.identity.accessionNumber,
    afterAccessionNumber: p.identity.accessionNumber,
    beforeSourceSha256: before.built.payload.source.sha256, afterSourceSha256: p.source.sha256,
    beforeObservations: before.observations, afterObservations: after.observations,
    source: { resultId: after.built.resultId, accessionNumber: p.identity.accessionNumber, issuerCik: p.identity.issuerCik,
      rawSourceId: p.source.rawSourceId, url: p.source.url, documentName: p.source.documentName,
      sha256: p.source.sha256, rawContent: after.rawContent },
  });
  report.candidate = evaluation; // Keep original state, nulls and all rejection reasons.
  const revision = candidateRevision(evaluation);
  const testId = "30000000-0000-4000-8000-000000000003";
  const draft = { caseId: testId, expectedRevision: 0, noticeId: snapshot.id, expectedSourceHash: snapshot.sourceHash,
    verdict: "unclear", facts: { market: "US", kind: "symbol_change",
      securityName: after.observations[0]?.securityTitle ?? "Unresolved SEC security", ...revision.values },
    proof: { imageSha256: snapshot.images[0].sha256, locator: sample.locator, quote: null },
    usMarketRowReviewed: true,
    reason: "Offline research transcription only. Synthetic review envelope; no authenticated administrator approval." };
  const review = { id: testId, caseId: testId, revision: 1, actorUserId: testId, createdAt: manifest.filings[1].capturedAt,
    requestId: testId, requestHash: reviewRequestHash(draft), draft, snapshot, tickerAuthority: "none" };
  const row = { ...sample, method: "manual_transcription", candidateRevisionSha256: revision.revisionSha256,
    reviewId: review.id, caseId: review.caseId, reviewRevision: review.revision,
    noticeId: snapshot.id, sourceHash: snapshot.sourceHash, imageSha256: snapshot.images[0].sha256,
    dateBasis: "market_effective", rowCorrespondence: "unconfirmed",
    correspondenceReason: "Research-selected same ticker/name row; no authenticated security-class or continuity approval. Kiwoom row omits class." };
  const link = createCandidateEvidenceLink({ evaluation, review, row });
  // Inspect replay against these same historical inputs, not a current/live freshness assertion.
  const replay = checkCandidateEvidenceLink(link, { evaluation, snapshot, review, row });
  report.linkage = { link, historicalInputReplay: replay,
    caveat: "reusable here means equal supplied historical inputs, NOT latest source or an approval" };
  report.testOnlyMetadata = { rawItemIds: "local in-memory envelopes, never inserted", reviewId: testId,
    actorUserId: testId, requestId: testId, verdict: "unclear", authenticated: false,
    rowCorrespondence: "unconfirmed", noCandidateValueSubstitution: true };
  assert.deepEqual(link.candidate.values, { oldTicker: evaluation.summary.oldTicker, newTicker: evaluation.summary.newTicker, effectiveDate: evaluation.summary.effectiveDate });
  assert.deepEqual(link.observed.values, sample.values);
}
report.offlineNetworkAttempts = networkAttempts;
assert.equal(networkAttempts, 0);
await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ outputPath, covers: report.coverResults.map(x => ({ role: x.role, status: x.status, observations: x.observations })),
  candidate: report.candidate && { state: report.candidate.resolutionState, reasons: report.candidate.reasons, values: report.candidate.summary },
  comparison: report.linkage?.link.comparison, offlineNetworkAttempts: networkAttempts }, null, 2));
