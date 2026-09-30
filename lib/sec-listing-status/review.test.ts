import assert from "node:assert/strict";
import test from "node:test";
import { buildObservation, unattached } from "./observation.ts";
import { readReviewedSecListingObservation, reviewDocuments, applyListingDateReview } from "./review.ts";
import { validateReviewedDates, type ReviewedDates } from "./reviewContract.ts";
import type { SecTickerResolutionRepository } from "../sec-ticker-resolution/persistence.ts";

const id = "25000000-0000-4000-8000-000000000001";
const quote = "On June 14, 2024, the Company received notice that trading had been suspended.";
const raw = { id, source_code: "sec_edgar", source_unique_id: "0001079973-24-000891", source_url: "https://www.sec.gov/Archives/edgar/data/1476963/000107997324000891/scpx_8k.htm",
  published_at: "2024-06-17T12:44:57Z", raw_payload: { form_type: "8-K", primary_document_url: "https://www.sec.gov/Archives/edgar/data/1476963/000107997324000891/scpx_8k.htm", primary_document_html: `<p>${quote}</p>` } };
const o = buildObservation({ raw, scope: null, asOf: "2024-06-17", attachment: unattached("filing_security_scope_unavailable") });
const doc = reviewDocuments(o.sourceSnapshot)[0];
const dates: ReviewedDates = {
  notice_date: { availability: "available", value: "2024-06-14", sourceRef: doc.id, sourceHash: doc.sha256, quote },
  suspension_effective_date: { availability: "unknown", value: null, sourceRef: doc.id, sourceHash: doc.sha256, quote },
};
function setup() {
  const history: Record<string, unknown>[] = [{ id: "decision", action: "reviewed", base_version: "a".repeat(64),
    source_sha256: o.sourceHash, revision: 1, dates, created_at: "2026-10-01T00:00:00Z" }];
  const source = structuredClone(raw); let writes = 0;
  const repo: SecTickerResolutionRepository = {
    async select(table) { const data = table === "raw_items" ? [source] : table === "sec_listing_status_date_reviews" ? history
      : table === "sec_listing_status_observations" ? [{ id, raw_item_id: id, observation: o, observation_sha256: "a".repeat(64) }] : [];
      return { ok: true, status: 200, data }; },
    async rpc() { writes++; return { ok: false, status: 409, data: null, error: "LISTING_REVIEW_STALE_REVISION" }; },
  };
  return { history, source, repo, writes: () => writes };
}
test("notice date and explicitly unknown operative date remain separate from automatic/AI facts", async () => {
  const x = setup(), before = structuredClone(o);
  for (let i = 0; i < 2; i++) {
    const result = await readReviewedSecListingObservation({ observationId: id, repository: x.repo });
    assert.equal(result.reviewStatus, "reviewed"); assert.deepEqual(result.reviewedFacts, dates);
    assert.equal(result.automatic.observation.reported.suspensionDate, null);
    assert.equal(result.automatic.observation.attachment.status, "unresolved");
    assert.equal(result.automatic.observation.reported.trading, "unresolved");
  }
  assert.equal(x.writes(), 0); assert.deepEqual(o, before);
});
test("changed source or decision version is auditable but never effective", async () => {
  for (const change of ["source", "version", "hash", "quote"]) {
    const x = setup();
    if (change === "source") x.source.raw_payload.primary_document_html += " Changed";
    if (change === "version") x.history[0].base_version = "b".repeat(64);
    if (change === "hash") x.history[0].source_sha256 = "b".repeat(64);
    if (change === "quote") x.history[0].dates = { ...dates, notice_date: { ...dates.notice_date, quote: "Invented sentence with no source support." } };
    const result = await readReviewedSecListingObservation({ observationId: id, repository: x.repo });
    assert.equal(result.reviewStatus, "stale_or_invalid"); assert.equal(result.reviewedFacts, null); assert.equal(result.history.length, 1);
  }
});
test("withdrawal closes only human facts and retains all decisions", async () => {
  const x = setup(); x.history.push({ id: "withdraw", action: "withdrawn", revision: 2, dates: {} });
  const result = await readReviewedSecListingObservation({ observationId: id, repository: x.repo });
  assert.equal(result.reviewStatus, "withdrawn"); assert.equal(result.reviewedFacts, null); assert.equal(result.history.length, 2);
});
test("invalid dates, forged evidence, and extra fields are rejected", () => {
  assert.deepEqual(validateReviewedDates(dates, [doc]), dates);
  for (const patch of [{ value: "2024-02-30" }, { sourceHash: "b".repeat(64) }, { sourceRef: "other" }, { quote: "Invented passage, not present in the source." }, { availability: "unknown", value: "2024-06-14" }, { date_status: "occurred" }]) {
    assert.throws(() => validateReviewedDates({ ...dates, notice_date: { ...dates.notice_date, ...patch } }, [doc]));
  }
  assert.throws(() => validateReviewedDates({ ...dates, listing: "ACTIVE" }, [doc]));
  assert.throws(() => validateReviewedDates({ notice_date: dates.notice_date }, [doc]));
});
test("rejected revision is returned as a conflict without retry or rewrite", async () => {
  const x = setup();
  await assert.rejects(applyListingDateReview({ observationId: id, actorUserId: id, action: "reviewed", dates,
    reason: "Source review", expectedVersion: "a".repeat(64), expectedRevision: 0, requestId: "test", repository: x.repo }), /changed/);
  assert.equal(x.writes(), 1);
});
test("stale automatic observation cannot be rescued by a new date decision", async () => {
  const x = setup(); x.source.raw_payload.primary_document_html += " Changed";
  await assert.rejects(applyListingDateReview({ observationId: id, actorUserId: id, action: "reviewed", dates,
    reason: "Source review", expectedVersion: "a".repeat(64), expectedRevision: 1, requestId: "test", repository: x.repo }), /failed revalidation/);
  assert.equal(x.writes(), 0);
});
test("foreign or truncated evidence is not offered as a review source", () => {
  const snapshot = structuredClone(o.sourceSnapshot);
  const payload = snapshot.raw_payload as Record<string, unknown>;
  payload.primary_document_html_truncated = true; assert.deepEqual(reviewDocuments(snapshot), []);
  payload.primary_document_html_truncated = false; payload.primary_document_url = "https://example.com/filing";
  assert.deepEqual(reviewDocuments(snapshot), []);
});
