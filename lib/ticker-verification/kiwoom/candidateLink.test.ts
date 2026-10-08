import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { evaluateSecTickerResolution, type VerifiedSecCoverObservation } from "../../sec-ticker-resolution/canonical.ts";
import { candidateRevision, createCandidateEvidenceLink, checkCandidateEvidenceLink, type ManualKiwoomRow } from "./candidateLink.ts";
import { reviewRequestHash, type SavedReview, type ReviewDraft } from "./review.ts";
import { parseNoticeDetail, sha256, snapshotHash, validateSnapshot, type KiwoomSnapshot } from "./source.ts";
import { manualRows, retainedNotice } from "./candidateLink.samples.ts";

const id = "10000000-0000-4000-8000-000000000001";
const alternateId = "20000000-0000-4000-8000-000000000002";
// Only this optional local file is read. No network/DB/environment-file access.
const retainedPath = process.env.KIWOOM_LINK_TEST_SNAPSHOT;
function source(): KiwoomSnapshot {
  if (retainedPath) {
    const s = JSON.parse(readFileSync(retainedPath, "utf8")) as KiwoomSnapshot;
    assert.ok(validateSnapshot(s)); assert.equal(s.sourceHash, retainedNotice.sourceHash);
    assert.equal(s.id, retainedNotice.id); assert.equal(s.images[0].sha256, retainedNotice.imageSha256);
    return s;
  }
  const rawHtml = '<p>SYNTHETIC test notice; not a source transcription.</p><img src="/bbs/VBbsNoticeImageView?apndnm=test.png">';
  const detail = parseNoticeDetail({ noticeDetail: { seqid: 4611, scrnTp: "NWGCZ", ttl: "Synthetic notice", makeTime: "2026.10.06", custPsdn: "Fixture", dtlCntn: rawHtml, attcFile: [] } }, "4611");
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ2UAAAAASUVORK5CYII=", "base64");
  const { imageUrls, ...d } = detail;
  const s = { ...d, version: "kiwoom-notice-v1" as const, capturedAt: "2026-10-08T00:00:00Z", authority: "supporting_evidence_only" as const,
    images: [{ sourceUrl: imageUrls[0], sha256: sha256(bytes), mime: "image/png" as const, base64: bytes.toString("base64") }] };
  return { ...s, sourceHash: snapshotHash(s) };
}
// All SEC candidates below are synthetic inputs passed through the REAL existing evaluator.
// They are not evidence that any real issuer made these statements.
function evaluate(oldTicker = "PSKY", newTicker = "SKYD", date = "2026-10-06", extra = "", title = "Common Stock, par value $0.001 per share") {
  const cik = "0000001234", beforeAcc = "0000001234-26-000001", afterAcc = "0000001234-26-000002";
  const day = Number(date.slice(-2));
  const rawContent = `<p>Effective October ${day}, 2026, we changed our ticker symbol from "${oldTicker}" to "${newTicker}". The change did not alter other terms of our common stock.</p>${extra}`;
  const cover = (resultId: string, accessionNumber: string, tradingSymbol: string, acceptedAt: string): VerifiedSecCoverObservation => ({
    resultId, observationKey: resultId, accessionNumber, issuerCik: cik, acceptedAt,
    sourceRawId: id, sourceUrl: "https://www.sec.gov/Archives/synthetic.htm", sourceDocument: "synthetic.htm", sourceSha256: "a".repeat(64),
    contextRef: resultId, dimensions: [], securityTitleStatus: "observed", securityTitle: title,
    tradingSymbolStatus: "observed", tradingSymbol, exchangeStatus: "observed", exchange: "The Nasdaq Stock Market LLC",
  });
  return evaluateSecTickerResolution({ issuerCik: cik, evidenceAccessionNumber: afterAcc, beforeAccessionNumber: beforeAcc, afterAccessionNumber: afterAcc,
    beforeSourceSha256: "a".repeat(64), afterSourceSha256: "a".repeat(64),
    beforeObservations: [cover("before", beforeAcc, oldTicker, "2026-10-01T00:00:00Z")],
    afterObservations: [cover("after", afterAcc, newTicker, "2026-10-15T00:00:00Z")],
    source: { resultId: "after", accessionNumber: afterAcc, issuerCik: cik, rawSourceId: id,
      url: "https://www.sec.gov/Archives/synthetic.htm", documentName: "synthetic.htm", sha256: sha256(rawContent), rawContent } });
}
function setup(sampleName = "psky", evaluation = evaluate()) {
  const snapshot = source(), sample = manualRows[sampleName], candidate = candidateRevision(evaluation);
  const draft: ReviewDraft = { caseId: id, expectedRevision: 0, noticeId: snapshot.id, expectedSourceHash: snapshot.sourceHash,
    verdict: "supports", facts: { market: "US", kind: "symbol_change", securityName: "Synthetic SEC candidate", ...candidate.values },
    proof: { imageSha256: snapshot.images[0].sha256, locator: sample.locator, quote: null }, usMarketRowReviewed: true,
    reason: "Synthetic test review; no real authenticated administrator assertion." };
  const review: SavedReview = { id, caseId: id, revision: 1, actorUserId: id, createdAt: "2026-10-08T00:00:00Z", requestId: id,
    requestHash: reviewRequestHash(draft), draft, snapshot, tickerAuthority: "none" };
  const row: ManualKiwoomRow = { ...structuredClone(sample), method: "manual_transcription", candidateRevisionSha256: candidate.revisionSha256,
    reviewId: review.id, caseId: review.caseId, reviewRevision: review.revision, noticeId: snapshot.id, sourceHash: snapshot.sourceHash,
    imageSha256: snapshot.images[0].sha256, dateBasis: "market_effective", rowCorrespondence: "confirmed",
    correspondenceReason: "Fixture association only: compare this exact row's fields; not identity or continuity approval." };
  return { evaluation, snapshot, review, row };
}
function current(s: ReturnType<typeof setup>) { return { evaluation: s.evaluation, snapshot: s.snapshot, review: s.review, row: s.row }; }
function revise(review: SavedReview, verdict: ReviewDraft["verdict"] = "supports"): SavedReview {
  const draft = { ...review.draft, expectedRevision: review.revision, verdict };
  return { ...review, id: alternateId, revision: review.revision + 1, draft, requestHash: reviewRequestHash(draft), requestId: alternateId };
}

test("exact existing SEC decision revision + separate observed row: match, no authority", () => {
  const s = setup(), link = createCandidateEvidenceLink(s);
  assert.equal(s.evaluation.resolutionState, "AUTO");
  assert.equal(link.candidate.decisionId, s.evaluation.decision.id);
  assert.equal(link.candidate.decisionSha256, s.evaluation.decision.decision_sha256);
  assert.equal(link.comparison.status, "match"); assert.equal(link.tickerAuthority, "none");
  assert.equal(link.scope, "candidate_field_comparison_not_security_identity");
  assert.deepEqual(checkCandidateEvidenceLink(link, current(s)), { reusable: true, status: "match", reasons: [] });
  s.row.values.newTicker = "WRONG"; s.evaluation = { ...s.evaluation, summary: { ...s.evaluation.summary, newTicker: "WRONG" } };
  assert.equal(link.observed.values.newTicker, "SKYD"); assert.equal(link.candidate.values.newTicker, "SKYD");
});

test("candidate, saved human assertion and observed value stay separate; ticker/date conflicts visible", () => {
  for (const evaluation of [evaluate("PSKY", "WRONG"), evaluate("PSKY", "SKYD", "2026-10-07")]) {
    const s = setup("psky", evaluation), link = createCandidateEvidenceLink(s);
    assert.equal(s.review.draft.verdict, "supports"); // Human verdict cannot override disagreement.
    assert.equal(link.comparison.status, "conflict");
    assert.deepEqual(link.candidate.values, candidateRevision(evaluation).values);
    assert.deepEqual(link.observed.values, manualRows.psky.values);
    assert.equal(checkCandidateEvidenceLink(link, current(s)).status, "conflict");
  }
});

test("manual retained-image rows: simple event compared; complex events/non-US not collapsed", t => {
  const cases = [
    ["psky", "PSKY", "SKYD", "2026-10-06", "match"],
    ["vaci", "VACI", "NSTR", "2026-10-02", "unconfirmed"],
    ["vtak", "VTAK", "VJET", "2026-10-05", "unconfirmed"],
    ["wald", "WALD", "WALDF", "2026-10-05", "unconfirmed"],
    ["waldw", "WALD", "WALDF", "2026-10-05", "unconfirmed"],
    ["hongKong", "08026", "08583", "2026-10-02", "unconfirmed"],
    ["aeth", "AETH", "SYN", "2026-10-05", "unconfirmed"],
  ];
  for (const [name, oldTicker, newTicker, date, expected] of cases) {
    const s = setup(name, evaluate(oldTicker, newTicker, date));
    if (name === "waldw") s.row.rowCorrespondence = "different";
    const link = createCandidateEvidenceLink(s);
    assert.equal(link.comparison.status, expected, name);
    t.diagnostic(JSON.stringify({ sample: name, source: retainedPath ? "retained_original_image" : "synthetic_snapshot_with_manual_row_fixture",
      candidate: link.candidate.values, observed: link.observed.values, ...link.comparison }));
  }
});

test("missing values, unconfirmed row, account/unknown dates and unclear review fail closed", () => {
  const variations: ((s: ReturnType<typeof setup>) => void)[] = [
    s => { s.row.values.newTicker = null; }, s => { s.row.values.effectiveDate = null; },
    s => { s.row.rowCorrespondence = "unconfirmed"; }, s => { s.row.market = "unknown"; },
    s => { s.row.dateBasis = "broker_account"; }, s => { s.row.dateBasis = "unknown"; },
    s => { s.review.draft.verdict = "unclear"; s.review.requestHash = reviewRequestHash(s.review.draft); },
    s => { s.review.draft.verdict = "withdrawn"; s.review.requestHash = reviewRequestHash(s.review.draft); },
  ];
  for (const mutate of variations) { const s = setup(); mutate(s); assert.equal(createCandidateEvidenceLink(s).comparison.status, "unconfirmed"); }
});

test("explicit different security type cannot match on tickers alone", () => {
  const s = setup(); s.row.securityType = "warrant";
  assert.equal(createCandidateEvidenceLink(s).comparison.status, "conflict");
  assert.ok(createCandidateEvidenceLink(s).comparison.reasons.includes("securityType_conflict"));
});

test("different explicit share classes conflict; comparison never upgrades a SEC REVIEW candidate", () => {
  const s = setup("psky", evaluate("PSKY", "SKYD", "2026-10-06", "", "Class A Common Stock"));
  s.row.securityClass = "B";
  assert.equal(createCandidateEvidenceLink(s).comparison.status, "conflict");
  assert.ok(createCandidateEvidenceLink(s).comparison.reasons.includes("securityClass_conflict"));
  const review = setup("psky", evaluate("PSKY", "SKYD", "2026-10-06", "<p>The ticker symbol will not change.</p>"));
  assert.equal(review.evaluation.resolutionState, "REVIEW");
  const link = createCandidateEvidenceLink(review);
  assert.equal(link.candidate.resolutionState, "REVIEW"); assert.equal(link.tickerAuthority, "none");
});

test("candidate values or source revision changes invalidate old verification; old row cannot silently rebind", () => {
  const s = setup(), link = createCandidateEvidenceLink(s);
  for (const evaluation of [evaluate("PSKY", "WRONG"), evaluate("PSKY", "SKYD", "2026-10-07"), evaluate("PSKY", "SKYD", "2026-10-06", "<p>Source amendment.</p>")]) {
    const result = checkCandidateEvidenceLink(link, { ...current(s), evaluation });
    assert.equal(result.reusable, false); assert.ok(result.reasons.includes("candidate_revision_changed"));
    assert.throws(() => createCandidateEvidenceLink({ ...s, evaluation }));
  }
  assert.equal(link.comparison.status, "match"); // Historical record remains intact.
});

test("notice HTML and image-only changes invalidate link; capture timestamp alone does not", () => {
  const s = setup(), link = createCandidateEvidenceLink(s);
  const html = structuredClone(s.snapshot); html.rawHtml += "<p>Revised source.</p>";
  html.text = parseNoticeDetail({ noticeDetail: { seqid: 4611, scrnTp: "NWGCZ", ttl: html.title, makeTime: html.postedDate.replaceAll("-", "."), custPsdn: html.author, dtlCntn: html.rawHtml, attcFile: [] } }, "4611").text;
  html.sourceHash = snapshotHash(html);
  const image = structuredClone(s.snapshot), bytes = Buffer.concat([Buffer.from(image.images[0].base64, "base64"), Buffer.from("changed")]);
  image.images[0].base64 = bytes.toString("base64"); image.images[0].sha256 = sha256(bytes); image.sourceHash = snapshotHash(image);
  for (const snapshot of [html, image]) {
    assert.ok(validateSnapshot(snapshot));
    assert.deepEqual(checkCandidateEvidenceLink(link, { ...current(s), snapshot }), { reusable: false, status: "unconfirmed", reasons: ["source_changed"] });
  }
  assert.equal(checkCandidateEvidenceLink(link, { ...current(s), snapshot: { ...s.snapshot, capturedAt: "2026-10-09T00:00:00Z" } }).reusable, true);
});

test("new review revision, withdrawal and unrelated case invalidate historical comparison", () => {
  const s = setup(), link = createCandidateEvidenceLink(s);
  for (const verdict of ["supports", "conflicts", "withdrawn"] as const) {
    const result = checkCandidateEvidenceLink(link, { ...current(s), review: revise(s.review, verdict) });
    assert.equal(result.reusable, false); assert.ok(result.reasons.includes("review_revision_changed"));
    if (verdict === "withdrawn") assert.ok(result.reasons.includes("review_withdrawn"));
  }
  const review = structuredClone(s.review); review.caseId = alternateId; review.draft.caseId = alternateId; review.requestHash = reviewRequestHash(review.draft);
  assert.equal(checkCandidateEvidenceLink(link, { ...current(s), review }).reusable, false);
  assert.equal(link.comparison.status, "match");
});

test("missing current inputs block reuse including withdrawal without current source availability", () => {
  const s = setup(), link = createCandidateEvidenceLink(s);
  for (const key of ["snapshot", "evaluation", "review", "row"] as const) assert.deepEqual(checkCandidateEvidenceLink(link, { ...current(s), [key]: null }),
    { reusable: false, status: "unconfirmed", reasons: ["current_inputs_unavailable"] });
  assert.equal(checkCandidateEvidenceLink(link, { ...current(s), snapshot: null, review: revise(s.review, "withdrawn") }).reusable, false);
});

test("edited transcription or different saved candidate requires new explicit linkage", () => {
  const s = setup(), link = createCandidateEvidenceLink(s), row = structuredClone(s.row);
  row.values.newTicker = "WRONG";
  assert.deepEqual(checkCandidateEvidenceLink(link, { ...current(s), row }), { reusable: false, status: "unconfirmed", reasons: ["transcription_changed"] });
  s.review.draft.facts.oldTicker = "OTHER"; s.review.requestHash = reviewRequestHash(s.review.draft);
  assert.throws(() => createCandidateEvidenceLink(s));
});

test("exact row/image/review/candidate references are mandatory; transcriptions cannot float between revisions", () => {
  for (const patch of [{ locator: "another row" }, { imageSha256: "a".repeat(64) }, { noticeId: "4612" }, { sourceHash: "a".repeat(64) },
    { reviewId: alternateId }, { caseId: alternateId }, { reviewRevision: 2 }, { candidateRevisionSha256: "a".repeat(64) }]) {
    const s = setup(); Object.assign(s.row, patch); assert.throws(() => createCandidateEvidenceLink(s));
  }
});

test("malformed values and extra broker-account fields are rejected rather than corrected", () => {
  for (const mutate of [(s: ReturnType<typeof setup>) => { s.row.values.oldTicker = " psky "; },
    (s: ReturnType<typeof setup>) => { s.row.values.effectiveDate = "2026-02-30"; },
    (s: ReturnType<typeof setup>) => { Object.assign(s.row, { settlementDate: "2026-10-06" }); }]) {
    const s = setup(); mutate(s); assert.throws(() => createCandidateEvidenceLink(s));
  }
});

test("tampered candidate, saved review, link values/status or invalid current source cannot be reused", () => {
  const s = setup(), link = createCandidateEvidenceLink(s);
  for (const mutate of [(l: typeof link) => { l.comparison.status = "conflict"; }, (l: typeof link) => { l.observed.values.newTicker = "WRONG"; }]) {
    const changed = structuredClone(link); mutate(changed); assert.equal(checkCandidateEvidenceLink(changed, current(s)).reusable, false);
  }
  const evaluation = { ...s.evaluation, summary: { ...s.evaluation.summary, newTicker: "WRONG" } };
  assert.throws(() => candidateRevision(evaluation));
  const review = structuredClone(s.review); review.draft.facts.newTicker = "WRONG";
  assert.equal(checkCandidateEvidenceLink(link, { ...current(s), review }).reusable, false);
  assert.equal(checkCandidateEvidenceLink(link, { ...current(s), snapshot: { ...s.snapshot, sourceHash: "f".repeat(64) } }).reusable, false);
});

test("manual transcription correctness is NOT proven by snapshot/hash validation", () => {
  const s = setup(); s.row.values.newTicker = "WRONG";
  const link = createCandidateEvidenceLink(s); // Well-bound but incorrectly transcribed input.
  assert.equal(link.comparison.status, "conflict"); assert.equal(link.tickerAuthority, "none");
  // This is intentionally a human verification boundary, not automated OCR or source interpretation.
});
