import { isoDate, KiwoomError, noticeId, record, sha256, validateSnapshot, type KiwoomSnapshot } from "./source.ts";

export type ReviewFacts = {
  market: "US"; kind: "symbol_change" | "new_listing" | "merger_new_symbol" | "delisting";
  securityName: string; oldTicker: string | null; newTicker: string | null; effectiveDate: string | null;
};
export type ReviewDraft = {
  caseId: string; expectedRevision: number; noticeId: string; expectedSourceHash: string;
  verdict: "supports" | "conflicts" | "unclear" | "withdrawn";
  facts: ReviewFacts; proof: { imageSha256: string | null; locator: string; quote: string | null };
  usMarketRowReviewed: boolean; reason: string;
};
export type SavedReview = {
  id: string; caseId: string; revision: number; actorUserId: string; createdAt: string;
  requestId: string; requestHash: string; draft: ReviewDraft; snapshot: KiwoomSnapshot;
  tickerAuthority: "none";
};
export function isUuid(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
const hashPattern = /^[a-f0-9]{64}$/;
function fail(): never { throw new KiwoomError("KIWOOM_REVIEW_INVALID", 400); }
function exactKeys(row: Record<string, unknown>, keys: string[]) {
  if (Object.keys(row).sort().join() !== keys.sort().join()) fail();
}
function required(value: unknown, max: number, min = 1): string {
  if (typeof value !== "string" || value.trim().length < min || value.length > max) fail();
  return value.trim();
}
export function parseReviewDraft(value: unknown): ReviewDraft {
  const v = record(value);
  exactKeys(v, ["caseId", "expectedRevision", "noticeId", "expectedSourceHash", "verdict", "facts", "proof", "usMarketRowReviewed", "reason"]);
  if (!isUuid(v.caseId) || !Number.isInteger(v.expectedRevision) || Number(v.expectedRevision) < 0 ||
      typeof v.expectedSourceHash !== "string" || !hashPattern.test(v.expectedSourceHash) ||
      !["supports", "conflicts", "unclear", "withdrawn"].includes(String(v.verdict)) || typeof v.usMarketRowReviewed !== "boolean") fail();
  const f = record(v.facts), p = record(v.proof);
  exactKeys(f, ["market", "kind", "securityName", "oldTicker", "newTicker", "effectiveDate"]);
  exactKeys(p, ["imageSha256", "locator", "quote"]);
  if (f.market !== "US" || !["symbol_change", "new_listing", "merger_new_symbol", "delisting"].includes(String(f.kind))) fail();
  const symbol = (value: unknown) => { if (value === null) return null; const s = required(value, 12).toUpperCase(); if (!/^[A-Z0-9][A-Z0-9.-]{0,11}$/.test(s)) fail(); return s; };
  if (f.effectiveDate !== null && !isoDate(f.effectiveDate)) fail();
  if (p.imageSha256 !== null && (typeof p.imageSha256 !== "string" || !hashPattern.test(p.imageSha256))) fail();
  const facts: ReviewFacts = { market: "US", kind: f.kind as ReviewFacts["kind"], securityName: required(f.securityName, 240),
    oldTicker: symbol(f.oldTicker), newTicker: symbol(f.newTicker), effectiveDate: f.effectiveDate as string | null };
  if (facts.kind === "new_listing" && facts.oldTicker !== null) fail();
  if (facts.kind === "delisting" && facts.newTicker !== null) fail();
  if (facts.oldTicker && facts.oldTicker === facts.newTicker) fail();
  if (v.verdict === "supports" && (!facts.effectiveDate || !v.usMarketRowReviewed ||
      (facts.kind !== "new_listing" && !facts.oldTicker) || (facts.kind !== "delisting" && !facts.newTicker))) fail();
  if ((v.verdict === "supports" || v.verdict === "conflicts") && !v.usMarketRowReviewed) fail();
  return { caseId: v.caseId, expectedRevision: Number(v.expectedRevision), noticeId: noticeId(v.noticeId),
    expectedSourceHash: v.expectedSourceHash, verdict: v.verdict as ReviewDraft["verdict"], facts,
    proof: { imageSha256: p.imageSha256 as string | null, locator: required(p.locator, 500), quote: p.quote === null ? null : required(p.quote, 2000) },
    usMarketRowReviewed: v.usMarketRowReviewed, reason: required(v.reason, 2000, 4) };
}
// No semantic extraction: proof binding is checked, the human assertion is retained as such.
export function validateReviewProof(draft: ReviewDraft, snapshot: KiwoomSnapshot) {
  if (!validateSnapshot(snapshot) || snapshot.id !== draft.noticeId || snapshot.sourceHash !== draft.expectedSourceHash)
    throw new KiwoomError("KIWOOM_SOURCE_CHANGED", 409);
  const proof = draft.proof;
  if (proof.imageSha256 && !snapshot.images.some(i => i.sha256 === proof.imageSha256)) throw new KiwoomError("KIWOOM_PROOF_INVALID", 400);
  if (proof.quote && (!snapshot.text.includes(proof.quote) || /잔고|예탁결제|입고|입출고|결제\s*지시|계좌|balance posting|settlement instruction/i.test(proof.quote)))
    throw new KiwoomError("KIWOOM_PROOF_INVALID", 400);
  if (draft.verdict !== "unclear" && draft.verdict !== "withdrawn" && !proof.imageSha256 && !proof.quote)
    throw new KiwoomError("KIWOOM_PROOF_REQUIRED", 400);
}
export function reviewRequestHash(draft: ReviewDraft) { return sha256(JSON.stringify(draft)); }
export function readSavedReview(value: unknown): SavedReview {
  const row = record(value), draft = parseReviewDraft(row.draft), snapshot = row.snapshot as KiwoomSnapshot;
  validateReviewProof(draft, snapshot);
  if (!isUuid(row.id) || !isUuid(row.actor_user_id) || !isUuid(row.request_id) || row.case_id !== draft.caseId ||
      row.revision !== draft.expectedRevision + 1 || row.request_hash !== reviewRequestHash(draft) ||
      row.source_hash !== snapshot.sourceHash || row.verdict !== draft.verdict || row.ticker_authority !== "none" ||
      typeof row.created_at !== "string" || !Number.isFinite(Date.parse(row.created_at))) throw new KiwoomError("KIWOOM_SAVED_REVIEW_INVALID");
  return { id: row.id, caseId: draft.caseId, revision: Number(row.revision), actorUserId: String(row.actor_user_id), createdAt: row.created_at,
    requestId: String(row.request_id), requestHash: String(row.request_hash), draft, snapshot, tickerAuthority: "none" };
}
export function compareReviewedSource(review: SavedReview, current: KiwoomSnapshot) {
  if (!validateSnapshot(current) || current.id !== review.snapshot.id) return "unavailable" as const;
  return current.sourceHash === review.snapshot.sourceHash ? "same" as const : "changed" as const;
}
