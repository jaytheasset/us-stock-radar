import "server-only";
import { fetchKiwoomSnapshot, KiwoomError, record, type KiwoomSnapshot } from "./source.ts";
import { isUuid, parseReviewDraft, readSavedReview, reviewRequestHash, validateReviewProof, type SavedReview } from "./review.ts";

type Result = { ok: boolean; data: unknown; error?: string };
export type KiwoomReviewRepository = {
  select(table: string, query: Record<string, string>): Promise<Result>;
  rpc(name: string, payload: Record<string, unknown>): Promise<Result>;
};
export type ReviewSummary = { id: string; caseId: string; revision: number; verdict: string; createdAt: string; draft: SavedReview["draft"]; sourceHash: string };
const TABLE = "kiwoom_ticker_evidence_reviews";
async function defaultRepository(): Promise<KiwoomReviewRepository> {
  const { supabaseSelect, supabaseRpc } = await import("../../supabase.ts");
  return { select: supabaseSelect, rpc: supabaseRpc };
}
function rows(result: Result) {
  if (!result.ok || !Array.isArray(result.data)) throw new KiwoomError("KIWOOM_REVIEW_STORE_UNAVAILABLE", 503);
  return result.data.map(record);
}
export async function listKiwoomReviews(repository?: KiwoomReviewRepository): Promise<ReviewSummary[]> {
  const repo = repository ?? await defaultRepository();
  return rows(await repo.select(TABLE, { select: "id,case_id,revision,verdict,created_at,draft,source_hash", order: "created_at.desc,id.desc", limit: "30" })).map(row => {
    const draft = parseReviewDraft(row.draft);
    if (!isUuid(row.id) || row.case_id !== draft.caseId || row.revision !== draft.expectedRevision + 1 || row.source_hash !== draft.expectedSourceHash ||
        row.verdict !== draft.verdict || typeof row.created_at !== "string" || !Number.isFinite(Date.parse(row.created_at))) throw new KiwoomError("KIWOOM_SAVED_REVIEW_INVALID");
    return { id: row.id, caseId: draft.caseId, revision: Number(row.revision), verdict: draft.verdict, createdAt: row.created_at, draft, sourceHash: draft.expectedSourceHash };
  });
}
export async function getKiwoomReview(id: string, repository?: KiwoomReviewRepository): Promise<SavedReview> {
  if (!isUuid(id)) throw new KiwoomError("KIWOOM_REVIEW_ID_INVALID", 400);
  const repo = repository ?? await defaultRepository();
  const matches = rows(await repo.select(TABLE, { select: "*", id: `eq.${id}`, limit: "2" }));
  if (!matches.length) throw new KiwoomError("KIWOOM_REVIEW_NOT_FOUND", 404);
  if (matches.length !== 1 || matches[0].id !== id) throw new KiwoomError("KIWOOM_SAVED_REVIEW_INVALID");
  return readSavedReview(matches[0]);
}
export async function saveKiwoomReview(input: { actorUserId: string; requestId: string; draft: unknown }, dependencies: {
  repository?: KiwoomReviewRepository; fetchSnapshot?: (id: string) => Promise<KiwoomSnapshot>;
} = {}) {
  if (!isUuid(input.actorUserId) || !isUuid(input.requestId)) throw new KiwoomError("KIWOOM_REVIEW_REQUEST_INVALID", 400);
  const draft = parseReviewDraft(input.draft), requestHash = reviewRequestHash(draft);
  const repo = dependencies.repository ?? await defaultRepository();
  const prior = rows(await repo.select(TABLE, { select: "*", actor_user_id: `eq.${input.actorUserId}`, request_id: `eq.${input.requestId}`, limit: "2" }));
  if (prior.length > 1) throw new KiwoomError("KIWOOM_SAVED_REVIEW_INVALID");
  if (prior.length) {
    const review = readSavedReview(prior[0]);
    if (review.actorUserId !== input.actorUserId || review.requestId !== input.requestId || review.requestHash !== requestHash)
      throw new KiwoomError("KIWOOM_IDEMPOTENCY_CONFLICT", 409);
    return { status: "replayed" as const, review };
  }
  let snapshot: KiwoomSnapshot;
  if (draft.verdict === "withdrawn") {
    const previous = rows(await repo.select(TABLE, { select: "*", case_id: `eq.${draft.caseId}`, order: "revision.desc", limit: "1" }));
    if (previous.length !== 1) throw new KiwoomError("KIWOOM_REVISION_CONFLICT", 409);
    const review = readSavedReview(previous[0]);
    if (review.caseId !== draft.caseId || review.revision !== draft.expectedRevision || review.draft.verdict === "withdrawn" ||
        JSON.stringify(review.draft.facts) !== JSON.stringify(draft.facts)) throw new KiwoomError("KIWOOM_REVISION_CONFLICT", 409);
    snapshot = review.snapshot; // Withdrawal must still work when the publisher is down.
  } else snapshot = await (dependencies.fetchSnapshot ?? fetchKiwoomSnapshot)(draft.noticeId);
  validateReviewProof(draft, snapshot);
  const saved = await repo.rpc("admin_record_kiwoom_ticker_evidence", {
    p_actor_user_id: input.actorUserId, p_request_id: input.requestId, p_request_hash: requestHash, p_draft: draft, p_snapshot: snapshot,
  });
  if (!saved.ok) {
    const code = ["KIWOOM_REVISION_CONFLICT", "KIWOOM_IDEMPOTENCY_CONFLICT", "KIWOOM_REVIEW_INVALID", "ADMIN_PERMISSION_REQUIRED"].find(code => saved.error?.includes(code));
    throw new KiwoomError(code ?? "KIWOOM_REVIEW_STORE_UNAVAILABLE", code === "ADMIN_PERMISSION_REQUIRED" ? 403 : code ? 409 : 503);
  }
  const result = record(saved.data);
  if (result.status !== "inserted" && result.status !== "replayed") throw new KiwoomError("KIWOOM_SAVED_REVIEW_INVALID");
  const review = readSavedReview(result.review);
  if (review.requestHash !== requestHash || review.actorUserId !== input.actorUserId || review.requestId !== input.requestId) throw new KiwoomError("KIWOOM_SAVED_REVIEW_INVALID");
  return { status: result.status, review };
}
