import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluateSecTickerResolution, secVisibleText, type VerifiedSecCoverObservation, type VerifiedSecResolutionSource, type SecTickerResolutionEvaluation } from "../../sec-ticker-resolution/canonical.ts";
import { candidateRevision, createCandidateEvidenceLink, type ManualKiwoomRow } from "./candidateLink.ts";
import { createHumanExceptionComparison, checkHumanExceptionComparison, humanJudgmentSha256, type HumanExceptionInput, type SecHumanJudgment } from "./humanException.ts";
import { parseNoticeDetail, snapshotHash, validateSnapshot, sha256, type KiwoomSnapshot } from "./source.ts";
import { reviewRequestHash, type SavedReview, type ReviewDraft } from "./review.ts";
import { retainedNotice, manualRows } from "./candidateLink.samples.ts";

const dir = process.env.KIWOOM_HUMAN_TEST_DIR;
let networkCalls = 0;
globalThis.fetch = async () => { networkCalls++; throw new Error("Human exception tests forbid network or mutation HTTP calls"); };
after(() => assert.equal(networkCalls, 0));
const id = "10000000-0000-4000-8000-000000000001";
const nextId = "20000000-0000-4000-8000-000000000002";
const stamp = "2026-10-08T08:00:00Z"; // Synthetic judgment metadata, not an event or actual login time.
function setup(withoutAutomaticClass = false): HumanExceptionInput {
  const retained = dir && !withoutAutomaticClass;
  let evaluation: SecTickerResolutionEvaluation, secSource: VerifiedSecResolutionSource, snapshot: KiwoomSnapshot;
  let secValues: ManualKiwoomRow["values"], rowValues: ManualKiwoomRow["values"], quote: string;
  if (retained) {
    const r = JSON.parse(readFileSync(resolve(dir, "human-exception-automatic.json"), "utf8"));
    const manifest = JSON.parse(readFileSync(resolve(dir, "manifest.json"), "utf8"));
    const after = r.coverResults.find((x: { role: string }) => x.role === "after");
    const o = after.observations[0];
    const rawContent = readFileSync(resolve(dir, "psky-after.htm"), "utf8");
    assert.equal(sha256(rawContent), manifest.filings.find((x: { role: string }) => x.role === "after").sha256);
    evaluation = r.candidate;
    secSource = { resultId: o.resultId, accessionNumber: o.accessionNumber, issuerCik: o.issuerCik, rawSourceId: o.sourceRawId,
      url: o.sourceUrl, documentName: o.sourceDocument, sha256: o.sourceSha256, rawContent };
    snapshot = JSON.parse(readFileSync(resolve(dir, "../live-snapshot.json"), "utf8"));
    assert.ok(validateSnapshot(snapshot)); assert.equal(snapshot.sourceHash, retainedNotice.sourceHash);
    assert.equal(snapshot.images[0].sha256, retainedNotice.imageSha256);
    // Independently read from the completed SEC explanatory-note sentence, not the Kiwoom values.
    secValues = { oldTicker: "PSKY", newTicker: "SKYD", effectiveDate: "2026-10-06" };
    rowValues = structuredClone(manualRows.psky.values); // Independent retained-image transcription.
    quote = 'Additionally, in connection with the Closing, on October 6, 2026, the Company transferred the listing of the Class B Common Stock from The Nasdaq Stock Market LLC to the New York Stock Exchange and changed the ticker symbol for the Class B Common Stock from "PSKY" to "SKYD".';
  } else {
    // Entirely synthetic control. Neither SEC nor Kiwoom source is asserted to be real.
    quote = 'On October 6, 2026, Class B Common Stock changed from ALFA to BETA and transferred from The Nasdaq Stock Market LLC to the New York Stock Exchange.';
    const rawContent = `<p>${quote}</p><p>Unrelated record date: October 7, 2026.</p>`;
    const cik = "0000001234", beforeAcc = "0000001234-26-000001", afterAcc = "0000001234-26-000002";
    const cover = (ticker: string, acc: string, exchange: string): VerifiedSecCoverObservation => ({ resultId: acc, observationKey: acc, accessionNumber: acc, issuerCik: cik,
      acceptedAt: acc === beforeAcc ? "2026-10-01T00:00:00Z" : "2026-10-07T00:00:00Z", sourceRawId: id,
      sourceUrl: null, sourceDocument: "source.htm", sourceSha256: sha256(rawContent), contextRef: acc, dimensions: [],
      securityTitleStatus: "observed", securityTitle: withoutAutomaticClass ? "Common Stock" : "Class B Common Stock", tradingSymbolStatus: "observed", tradingSymbol: ticker,
      exchangeStatus: "observed", exchange });
    secSource = { resultId: afterAcc, accessionNumber: afterAcc, issuerCik: cik, rawSourceId: id,
      url: `https://www.sec.gov/Archives/edgar/data/1234/${afterAcc.replaceAll("-", "")}/source.htm`, documentName: "source.htm", sha256: sha256(rawContent), rawContent };
    evaluation = evaluateSecTickerResolution({ issuerCik: cik, evidenceAccessionNumber: afterAcc, beforeAccessionNumber: beforeAcc, afterAccessionNumber: afterAcc,
      source: secSource, beforeObservations: [cover("ALFA", beforeAcc, "The Nasdaq Stock Market LLC")], afterObservations: [cover("BETA", afterAcc, "New York Stock Exchange")] });
    const d = parseNoticeDetail({ noticeDetail: { seqid: 4611, scrnTp: "NWGCZ", ttl: "Synthetic control", makeTime: "2026.10.06", custPsdn: "Fixture",
      dtlCntn: '<p>Synthetic US row.</p><img src="/bbs/VBbsNoticeImageView?apndnm=test.png">', attcFile: [] } }, "4611");
    const { imageUrls, ...detail } = d;
    const base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ2UAAAAASUVORK5CYII=";
    const s = { ...detail, version: "kiwoom-notice-v1" as const, capturedAt: stamp, authority: "supporting_evidence_only" as const,
      images: [{ sourceUrl: imageUrls[0], mime: "image/png" as const, base64, sha256: sha256(Buffer.from(base64, "base64")) }] };
    snapshot = { ...s, sourceHash: snapshotHash(s) };
    secValues = { oldTicker: "ALFA", newTicker: "BETA", effectiveDate: "2026-10-06" };
    rowValues = { oldTicker: "ALFA", newTicker: "BETA", effectiveDate: "2026-10-06" };
  }
  const c = candidateRevision(evaluation), visible = secVisibleText(secSource.rawContent), start = visible.indexOf(quote);
  assert.ok(start >= 0, "Manually selected exact SEC quote must exist");
  const proof = { start, end: start + quote.length, quote };
  const { rawContent: _body, ...reference } = secSource;
  const judgment: SecHumanJudgment = { version: "sec-human-change-v1", id: nextId, caseId: nextId, revision: 1, previousJudgmentSha256: null, recordedAt: stamp,
    actor: { id: nextId, provenance: "test_metadata" }, status: "confirmed", reason: "Research reading of exact SEC source: completed symbol change and exchange transfer. Not administrator approval or security continuity.",
    candidateRevisionSha256: c.revisionSha256, source: reference, textBasis: "secVisibleText", values: secValues, eventStatus: "occurred",
    security: { title: "Class B Common Stock", securityClass: "B" },
    proofs: { oldTicker: proof, newTicker: proof, effectiveDate: proof, security: proof, eventStatus: proof },
    exchangeTransfer: { from: "The Nasdaq Stock Market LLC", to: "New York Stock Exchange", date: "2026-10-06", status: "occurred", proof } };
  const locator = retained ? manualRows.psky.locator : "synthetic US row 1";
  const draft: ReviewDraft = { caseId: id, expectedRevision: 0, noticeId: snapshot.id, expectedSourceHash: snapshot.sourceHash,
    verdict: "unclear", facts: { market: "US", kind: "symbol_change", securityName: "Research comparison, not administrator review", ...c.values },
    proof: { imageSha256: snapshot.images[0].sha256, locator, quote: null }, usMarketRowReviewed: true, reason: "Test-only review envelope preserving original automatic candidate values." };
  const review: SavedReview = { id, caseId: id, revision: 1, actorUserId: id, createdAt: stamp, requestId: id, requestHash: reviewRequestHash(draft), draft, snapshot, tickerAuthority: "none" };
  const row: ManualKiwoomRow = { method: "manual_transcription", candidateRevisionSha256: c.revisionSha256,
    reviewId: id, caseId: id, reviewRevision: 1, noticeId: snapshot.id, sourceHash: snapshot.sourceHash, imageSha256: snapshot.images[0].sha256, locator,
    cells: retained ? structuredClone(manualRows.psky.cells) : { country: "US", event: "symbol change", symbol: "ALFA", securityName: "Synthetic", details: "ALFA to BETA", date: "October 6, 2026" },
    market: "US", event: "symbol_change", additionalChanges: [], values: rowValues, dateBasis: "market_effective", securityType: null, securityClass: null,
    rowCorrespondence: "unconfirmed", correspondenceReason: "Same ticker row selected for field comparison only; Kiwoom CIK/class absent. No same-security approval." };
  return { evaluation, secSource, judgment, review, row };
}
const current = (s: HumanExceptionInput) => ({ ...s, snapshot: s.review.snapshot });

for (const c of [
  { name: "A", automatic: "B", human: "B", kiwoom: null, conflict: false },
  { name: "B", automatic: "B", human: "A", kiwoom: null, conflict: true },
  { name: "C", automatic: "B", human: "A", kiwoom: "A", conflict: true },
  { name: "D", automatic: null, human: "A", kiwoom: null, conflict: false },
  { name: "E", automatic: "B", human: null, kiwoom: null, conflict: false },
]) {
  test(`automatic-human class ${c.name}: ${c.automatic}/${c.human}/${c.kiwoom}`, t => {
    // Controlled assertions, not approved interpretations of a real security.
    // D uses synthetic class-unspecified cover observations through the real evaluator.
    const s = setup(c.automatic === null);
    assert.equal(s.evaluation.summary.securityClass, c.automatic);
    s.judgment.security.securityClass = c.human;
    s.row.securityClass = c.kiwoom;
    s.row.rowCorrespondence = "confirmed";
    s.row.correspondenceReason = "Synthetic correspondence assertion to isolate the class guard, not an approval.";
    const before = structuredClone(s), out = createHumanExceptionComparison(s);
    t.diagnostic(JSON.stringify({ sample: c.name, automatic: out.originalLink.candidate.securityClass,
      human: out.secHuman.security.securityClass, kiwoom: out.originalLink.observed.securityClass,
      assessment: out.assessment, comparison: out.comparison.fields, tickerAuthority: out.tickerAuthority }));
    assert.equal(out.assessment.eligible, !c.conflict);
    assert.deepEqual(out.assessment.reasons, c.conflict ? ["automatic_human_security_class_conflict"] : []);
    assert.deepEqual(out.comparison.fields, { oldTicker: "match", newTicker: "match", effectiveDate: "match" });
    assert.equal(out.originalLink.candidate.securityClass, c.automatic);
    assert.equal(out.secHuman.security.securityClass, c.human);
    assert.equal(out.originalLink.observed.securityClass, c.kiwoom);
    assert.deepEqual(out.automatic, before.evaluation);
    assert.equal(out.automatic.resolutionState, "REVIEW");
    assert.ok(out.automatic.reasons.includes("EXCHANGE_CONFLICT"));
    assert.equal(out.tickerAuthority, "none");
    assert.deepEqual(s, before);
  });
}

test("separate SEC human values compare three fields while original REVIEW/null and old validation stay unchanged", () => {
  const s = setup(), before = JSON.stringify(s), out = createHumanExceptionComparison(s);
  assert.equal(s.evaluation.resolutionState, "REVIEW"); assert.equal(s.evaluation.summary.effectiveDate, null);
  assert.ok(s.evaluation.reasons.includes("EXCHANGE_CONFLICT"));
  assert.equal(out.comparison.inputs, "sec_human_values_vs_kiwoom_transcription");
  assert.deepEqual(out.comparison.fields, { oldTicker: "match", newTicker: "match", effectiveDate: "match" });
  assert.equal(out.originalLink.comparison.fields.effectiveDate, "unconfirmed");
  assert.deepEqual(out.differencesFromAutomatic, [{ field: "effectiveDate", automatic: null, human: "2026-10-06" }]);
  assert.equal(out.humanStatus, "confirmed"); assert.equal(out.authentication, "not_verified"); assert.equal(out.tickerAuthority, "none");
  const alteredReview = structuredClone(s.review); alteredReview.draft.facts.effectiveDate = "2026-10-06";
  alteredReview.requestHash = reviewRequestHash(alteredReview.draft);
  assert.throws(() => createCandidateEvidenceLink({ ...s, review: alteredReview }));
  assert.equal(JSON.stringify(s), before);
  assert.deepEqual(createHumanExceptionComparison(s), out);
  assert.deepEqual(checkHumanExceptionComparison(out, current(s)), { reusable: true, reasons: [] });
  if (dir) writeFileSync(resolve(dir, "human-exception-result.json"), JSON.stringify(out, null, 2) + "\n");
});

test("SEC exchange is not copied into Kiwoom; missing identity and review status remain explicit", () => {
  const out = createHumanExceptionComparison(setup());
  assert.equal(out.exchange.secOnly?.to, "New York Stock Exchange"); assert.equal(out.exchange.kiwoom, null); assert.equal(out.exchange.compared, false);
  assert.equal(out.originalLink.observed.securityClass, null); assert.equal(out.originalLink.observed.securityType, null);
  assert.equal(out.assessment.eligible, false); assert.ok(out.assessment.reasons.includes("row_correspondence_unconfirmed"));
});

test("ticker/date disagreement and absent source proof stay distinct without correction", () => {
  for (const key of ["newTicker", "effectiveDate"] as const) {
    const s = setup(); s.judgment.values[key] = key === "newTicker" ? "WRONG" : "2026-10-07";
    assert.equal(createHumanExceptionComparison(s).comparison.fields[key], "conflict");
    s.judgment.proofs[key] = null;
    assert.equal(createHumanExceptionComparison(s).comparison.fields[key], "unconfirmed");
  }
  const s = setup(); s.judgment.proofs.security = null; s.judgment.exchangeTransfer!.proof = null;
  const out = createHumanExceptionComparison(s);
  assert.ok(out.assessment.reasons.includes("sec_context_evidence_missing")); assert.ok(out.assessment.reasons.includes("exchange_evidence_missing"));
});

test("human status separate from field equality; proposed/unknown event cannot confirm completion date", () => {
  const s = setup(); s.judgment.status = "unconfirmed";
  const pending = createHumanExceptionComparison(s);
  assert.equal(pending.comparison.status, "match"); assert.equal(pending.humanStatus, "unconfirmed"); assert.equal(pending.assessment.eligible, false);
  for (const eventStatus of ["proposed", "unknown"] as const) {
    s.judgment.eventStatus = eventStatus;
    const out = createHumanExceptionComparison(s);
    assert.equal(out.comparison.fields.effectiveDate, "unconfirmed"); assert.equal(out.eventStatus, eventStatus);
  }
  if (dir) {
    // Actual earlier SEC document: manually record its stated intention, not completion.
    const p = setup(), report = JSON.parse(readFileSync(resolve(dir, "human-exception-automatic.json"), "utf8"));
    const before = report.coverResults.find((x: { role: string }) => x.role === "before");
    const after = report.coverResults.find((x: { role: string }) => x.role === "after");
    const o = before.observations[0], rawContent = readFileSync(resolve(dir, "psky-before.htm"), "utf8");
    assert.equal(sha256(rawContent), before.sourceSha256);
    p.secSource = { resultId: o.resultId, accessionNumber: o.accessionNumber, issuerCik: o.issuerCik, rawSourceId: o.sourceRawId,
      url: o.sourceUrl, documentName: o.sourceDocument, sha256: o.sourceSha256, rawContent };
    p.evaluation = evaluateSecTickerResolution({ issuerCik: o.issuerCik, evidenceAccessionNumber: o.accessionNumber,
      beforeAccessionNumber: o.accessionNumber, afterAccessionNumber: after.observations[0].accessionNumber,
      source: p.secSource, beforeObservations: before.observations, afterObservations: after.observations });
    const c = candidateRevision(p.evaluation), { rawContent: _raw, ...source } = p.secSource;
    const quote = 'Additionally, in connection with the listing of the Class B Common Stock on the NYSE on October 6, 2026, the Company intends to change the ticker symbol for its Class B Common Stock from "PSKY" to "SKYD."';
    const start = secVisibleText(rawContent).indexOf(quote); assert.ok(start >= 0);
    const proof = { start, end: start + quote.length, quote };
    p.judgment = { ...p.judgment, candidateRevisionSha256: c.revisionSha256, source, eventStatus: "proposed", exchangeTransfer: null,
      reason: "Research reading of earlier SEC intended-change statement. Proposed date, not completed event or administrator approval.",
      proofs: { oldTicker: proof, newTicker: proof, effectiveDate: proof, security: proof, eventStatus: proof } };
    p.review.draft.facts = { ...p.review.draft.facts, ...c.values };
    p.review.requestHash = reviewRequestHash(p.review.draft); p.row.candidateRevisionSha256 = c.revisionSha256;
    const proposed = createHumanExceptionComparison(p);
    assert.equal(proposed.comparison.fields.effectiveDate, "unconfirmed");
    assert.equal(proposed.assessment.eligible, false); assert.equal(proposed.eventStatus, "proposed");
    writeFileSync(resolve(dir, "human-exception-proposed-control.json"), JSON.stringify(proposed, null, 2) + "\n");
  }
});

test("different security row/non-US/compound row prevents eligible assessment despite equal strings", () => {
  for (const patch of [{ rowCorrespondence: "different" }, { market: "non_US" }, { securityClass: "A" }, { securityType: "warrant" }, { additionalChanges: ["reverse split"] }]) {
    const s = setup(); Object.assign(s.row, patch);
    assert.equal(createHumanExceptionComparison(s).assessment.eligible, false);
  }
});

test("bad SEC hash, URL, identity, candidate reference and exact quote offsets are rejected", () => {
  const mutations: ((s: HumanExceptionInput) => void)[] = [
    s => { s.secSource = { ...s.secSource, rawContent: s.secSource.rawContent + "changed" }; },
    s => { s.judgment.source = { ...s.judgment.source, sha256: "f".repeat(64) }; }, s => { s.judgment.source = { ...s.judgment.source, issuerCik: "0000009999" }; },
    s => { s.judgment.source = { ...s.judgment.source, url: "https://example.com/source.htm" }; }, s => { s.judgment.candidateRevisionSha256 = "f".repeat(64); },
    s => { s.judgment.proofs.oldTicker = { ...s.judgment.proofs.oldTicker!, start: s.judgment.proofs.oldTicker!.start + 1 }; },
    s => { s.judgment.proofs.oldTicker = { ...s.judgment.proofs.oldTicker!, quote: "Not source text" }; },
    s => { s.judgment.revision = 2; }, s => { s.judgment.values.effectiveDate = "2026-02-30"; },
    s => { Object.assign(s.judgment.values, { accountDate: "2026-10-06" }); },
  ];
  for (const mutate of mutations) { const s = setup(); mutate(s); assert.throws(() => createHumanExceptionComparison(s)); }
});

test("human amendment/withdrawal prevents prior reuse while keeping old historical comparison", () => {
  const s = setup(), old = createHumanExceptionComparison(s);
  for (const status of ["confirmed", "withdrawn"] as const) {
    const judgment = { ...s.judgment, id, revision: 2, previousJudgmentSha256: humanJudgmentSha256(s.judgment), status, reason: "New separately recorded human judgment revision." };
    assert.equal(checkHumanExceptionComparison(old, { ...current(s), judgment }).reusable, false);
    const replacement = createHumanExceptionComparison({ ...s, judgment });
    assert.notEqual(replacement.comparisonSha256, old.comparisonSha256);
    if (status === "withdrawn") assert.equal(checkHumanExceptionComparison(replacement, { ...current(s), judgment }).reusable, false);
  }
  assert.equal(old.comparison.status, "match"); assert.equal(old.automatic.summary.effectiveDate, null);
});

test("candidate, SEC bytes, Kiwoom image/row/review changes each prevent reuse", () => {
  const s = setup(), out = createHumanExceptionComparison(s);
  const candidate = { ...s.evaluation, reasons: [...s.evaluation.reasons, "revision control"] };
  assert.equal(checkHumanExceptionComparison(out, { ...current(s), evaluation: candidate }).reusable, false);
  assert.equal(checkHumanExceptionComparison(out, { ...current(s), secSource: { ...s.secSource, rawContent: s.secSource.rawContent + " " } }).reusable, false);
  const image = structuredClone(s.review.snapshot), b = Buffer.concat([Buffer.from(image.images[0].base64, "base64"), Buffer.from("image change")]);
  image.images[0].base64 = b.toString("base64"); image.images[0].sha256 = sha256(b); image.sourceHash = snapshotHash(image);
  assert.ok(validateSnapshot(image));
  assert.equal(checkHumanExceptionComparison(out, { ...current(s), snapshot: image }).reusable, false);
  const row = structuredClone(s.row); row.values.newTicker = "OTHER";
  assert.equal(checkHumanExceptionComparison(out, { ...current(s), row }).reusable, false);
  const review = structuredClone(s.review); review.draft.verdict = "withdrawn"; review.requestHash = reviewRequestHash(review.draft);
  assert.equal(checkHumanExceptionComparison(out, { ...current(s), review }).reusable, false);
});

test("missing current inputs and tampered output never establish reusable current evidence", () => {
  const s = setup(), out = createHumanExceptionComparison(s);
  for (const key of ["evaluation", "secSource", "judgment", "review", "row", "snapshot"] as const) {
    assert.deepEqual(checkHumanExceptionComparison(out, { ...current(s), [key]: null }), { reusable: false, reasons: ["current_inputs_unavailable"] });
  }
  out.secHuman.values.newTicker = "TAMPERED";
  assert.equal(checkHumanExceptionComparison(out, current(s)).reusable, false);
  assert.notEqual(s.judgment.values.newTicker, "TAMPERED");
});

test("semantic-error control: genuine source reference does NOT prove the typed date or approval", () => {
  const s = setup();
  // Intentionally wrong interpretation with perfectly valid source coordinates.
  s.judgment.values.effectiveDate = "2026-10-07"; s.row.values.effectiveDate = "2026-10-07";
  const out = createHumanExceptionComparison(s);
  assert.equal(out.proofReferences.fields.effectiveDate, true); assert.equal(out.comparison.status, "match");
  assert.equal(out.semanticAccuracy, "requires_human_review"); assert.equal(out.authentication, "not_verified");
  assert.equal(out.tickerAuthority, "none");
  if (dir) writeFileSync(resolve(dir, "human-exception-semantic-control.json"), JSON.stringify({
    warning: "DELIBERATE WRONG-DATE CONTROL. Not true source facts. Both manually entered dates are wrong; structural validator intentionally does not infer semantics.", result: out,
  }, null, 2) + "\n");
});
