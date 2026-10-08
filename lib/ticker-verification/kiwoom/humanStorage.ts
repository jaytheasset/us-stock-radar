import "server-only";
import { randomUUID } from "node:crypto";
import { readSecTickerResolutionByDecisionId, type SecTickerResolutionRepository } from "../../sec-ticker-resolution/persistence.ts";
import { secVisibleText, type VerifiedSecResolutionSource } from "../../sec-ticker-resolution/canonical.ts";
import { candidateRevision, type ManualKiwoomRow } from "./candidateLink.ts";
import { createHumanExceptionComparison, checkHumanExceptionComparison, humanJudgmentSha256, type SecHumanJudgment, type HumanExceptionComparison } from "./humanException.ts";
import { getKiwoomReview } from "./service.ts";
import { isUuid } from "./review.ts";
import { fetchKiwoomSnapshot, KiwoomError, record, sha256, type KiwoomSnapshot } from "./source.ts";

export type HumanFields = Pick<SecHumanJudgment, "status" | "reason" | "values" | "eventStatus" | "security" | "proofs" | "exchangeTransfer">;
export type HumanStorageDraft = {
  action: "append" | "withdraw"; caseId: string; expectedRevision: number; previousId: string | null;
  decisionId: string; expectedDecisionSha256: string; expectedCandidateRevisionSha256: string;
  source: SecHumanJudgment["source"];
  reviewId: string; expectedReviewRevision: number; expectedSnapshotSha256: string; expectedImageSha256: string;
  human: HumanFields; row: ManualKiwoomRow;
};
export type SavedHumanComparison = {
  id: string; caseId: string; revision: number; previousId: string | null;
  actorUserId: string; auditLogId: string; requestId: string; requestHash: string; createdAt: string;
  draft: HumanStorageDraft; judgment: SecHumanJudgment; comparison: HumanExceptionComparison; tickerAuthority: "none";
};
export type HumanStorageDependencies = {
  repository?: SecTickerResolutionRepository;
  fetchSnapshot?: (id: string) => Promise<KiwoomSnapshot>;
};
export type CurrentHumanComparison = {
  status: "current" | "stale" | "withdrawn" | "unavailable" | "not_found";
  reasons: string[]; saved: SavedHumanComparison | null;
};
const HUMAN = "kiwoom_sec_human_judgments", COMPARISON = "kiwoom_sec_human_comparisons";
function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const r = value as Record<string, unknown>;
  return `{${Object.keys(r).sort().map(k => `${JSON.stringify(k)}:${stable(r[k])}`).join(",")}}`;
}
export const humanStorageHash = (value: unknown) => sha256(stable(value));
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
function requireInput(ok: unknown): asserts ok { if (!ok) throw new KiwoomError("KIWOOM_HUMAN_INPUT_INVALID", 400); }
function exact(v: unknown, keys: string[]) {
  requireInput(v && typeof v === "object" && !Array.isArray(v));
  requireInput(Object.keys(v).sort().join() === [...keys].sort().join());
}
export function parseHumanStorageDraft(value: unknown): HumanStorageDraft {
  exact(value, ["action", "caseId", "expectedRevision", "previousId", "decisionId", "expectedDecisionSha256", "expectedCandidateRevisionSha256", "source",
    "reviewId", "expectedReviewRevision", "expectedSnapshotSha256", "expectedImageSha256", "human", "row"]);
  const d = value as HumanStorageDraft;
  requireInput(["append", "withdraw"].includes(d.action) && isUuid(d.caseId) && isUuid(d.decisionId) && isUuid(d.reviewId));
  requireInput(Number.isSafeInteger(d.expectedRevision) && d.expectedRevision >= 0 && Number.isSafeInteger(d.expectedReviewRevision) && d.expectedReviewRevision > 0);
  requireInput(d.expectedRevision === 0 ? d.previousId === null && d.action === "append" : isUuid(d.previousId));
  requireInput([d.expectedDecisionSha256, d.expectedCandidateRevisionSha256, d.expectedSnapshotSha256, d.expectedImageSha256].every(hash));
  exact(d.human, ["status", "reason", "values", "eventStatus", "security", "proofs", "exchangeTransfer"]);
  requireInput(typeof d.human.reason === "string" && d.human.reason.trim().length >= 4 && d.human.reason.length <= 2000);
  requireInput(d.action === "withdraw" ? d.human.status === "withdrawn" : ["confirmed", "unconfirmed"].includes(d.human.status));
  requireInput(d.row && d.row.dateBasis !== "broker_account");
  // The existing pure validators check nested assertions and exact row/proof references.
  return structuredClone(d);
}
async function repository(deps: HumanStorageDependencies) {
  const base = deps.repository ?? await (async () => {
    const { supabaseSelect, supabaseRpc } = await import("../../supabase.ts");
    return { select: supabaseSelect, rpc: supabaseRpc };
  })();
  // Existing SEC readers expect row arrays. Never let a malformed success become not_found.
  return { rpc: base.rpc.bind(base), select: async (table: string, query: Record<string, string>) => {
    const r = await base.select(table, query);
    if (!r.ok || !Array.isArray(r.data) || r.data.some(x => !x || typeof x !== "object" || Array.isArray(x)))
      throw new KiwoomError("KIWOOM_HUMAN_STORE_UNAVAILABLE", 503);
    return r;
  } };
}
async function selectRows(repo: SecTickerResolutionRepository, table: string, query: Record<string, string>) {
  return (await repo.select(table, query)).data as Record<string, unknown>[];
}
export async function loadHumanCandidate(decisionId: string, deps: HumanStorageDependencies = {}) {
  requireInput(isUuid(decisionId));
  const repo = await repository(deps);
  const result = await readSecTickerResolutionByDecisionId({ decisionId, repository: repo });
  if (result.status !== "available") {
    if (result.status === "not_found") throw new KiwoomError("KIWOOM_CANDIDATE_NOT_FOUND", 404);
    const stale = /conflict|mismatch|invalid/.test(result.reason);
    throw new KiwoomError(stale ? "KIWOOM_CANDIDATE_STALE" : "KIWOOM_CANDIDATE_UNAVAILABLE", stale ? 409 : 503);
  }
  const candidate = candidateRevision(result.evaluation), input = record(record(result.decision.decision_payload).input);
  requireInput(isUuid(input.sourceRawId));
  const raw = await selectRows(repo, "sec_structured_raw_sources", { select: "*", id: `eq.${input.sourceRawId}`, limit: "2" });
  if (raw.length !== 1 || raw[0].id !== input.sourceRawId || typeof raw[0].raw_content !== "string") throw new KiwoomError("KIWOOM_SEC_SOURCE_UNAVAILABLE", 503);
  const observation = [...result.sourceObservations.before, ...result.sourceObservations.after].find(o => o.resultId === input.sourceResultId);
  // Evidence need not be one of the before/after documents: exact cover reader supplies its identity.
  const { readExactCover } = await import("../../sec-ticker-resolution/persistence.ts");
  const cover = await readExactCover(candidate.accession, candidate.sourceSha256, repo, String(input.sourceResultId));
  if (!cover.ok) throw new KiwoomError("KIWOOM_SEC_SOURCE_UNAVAILABLE", 503);
  const p = cover.value.payload;
  if (!p.source.rawSourceId || !p.source.url || !p.source.documentName || !p.source.sha256) throw new KiwoomError("KIWOOM_SEC_SOURCE_UNAVAILABLE", 503);
  const source: VerifiedSecResolutionSource = { resultId: String(input.sourceResultId), accessionNumber: p.identity.accessionNumber,
    issuerCik: p.identity.issuerCik, rawSourceId: p.source.rawSourceId, url: p.source.url!, documentName: p.source.documentName!,
    sha256: p.source.sha256!, rawContent: raw[0].raw_content };
  if (sha256(source.rawContent) !== candidate.sourceSha256 || (observation && observation.sourceSha256 !== source.sha256)) throw new KiwoomError("KIWOOM_CANDIDATE_STALE", 409);
  return { evaluation: result.evaluation, candidate, source };
}
export async function humanCandidateDisplay(id: string, deps: HumanStorageDependencies = {}) {
  const { candidate, evaluation, source } = await loadHumanCandidate(id, deps);
  const { rawContent, ...reference } = source;
  return { candidate, reasons: evaluation.reasons, source: reference, sourceText: secVisibleText(rawContent) };
}
async function latestReview(reviewId: string, revision: number, repo: SecTickerResolutionRepository) {
  const review = await getKiwoomReview(reviewId, repo);
  const latest = await selectRows(repo, "kiwoom_ticker_evidence_reviews", { select: "id,revision,verdict", case_id: `eq.${review.caseId}`, order: "revision.desc", limit: "1" });
  if (latest[0]?.verdict === "withdrawn") throw new KiwoomError("KIWOOM_LINK_REVIEW_WITHDRAWN", 409);
  if (review.revision !== revision || latest[0]?.id !== review.id || latest[0]?.revision !== revision) throw new KiwoomError("KIWOOM_LINK_REVIEW_STALE", 409);
  return review;
}
function decode(h: Record<string, unknown>, c: Record<string, unknown>): SavedHumanComparison {
  try {
    const d = parseHumanStorageDraft(h.draft), j = h.judgment as SecHumanJudgment, out = c.comparison as HumanExceptionComparison;
    const { comparisonSha256, ...body } = out;
    requireInput(isUuid(h.id) && isUuid(h.actor_user_id) && isUuid(h.audit_log_id) && isUuid(h.request_id));
    requireInput(h.case_id === d.caseId && h.revision === d.expectedRevision + 1 && h.previous_id === d.previousId && h.request_hash === humanStorageHash(d));
    requireInput(h.id === j.id && h.case_id === j.caseId && h.revision === j.revision && h.actor_user_id === j.actor.id && j.actor.provenance === "caller_supplied_unverified");
    requireInput(h.judgment_sha256 === humanJudgmentSha256(j) && c.judgment_id === h.id && c.comparison_sha256 === comparisonSha256 && humanStorageHash(body) === comparisonSha256);
    requireInput(humanStorageHash(out.secHuman) === humanStorageHash(j) && out.humanJudgmentSha256 === h.judgment_sha256);
    requireInput(h.decision_id === d.decisionId && h.review_id === d.reviewId && out.originalLink.candidate.decisionId === d.decisionId
      && out.originalLink.candidate.decisionSha256 === d.expectedDecisionSha256 && out.originalLink.candidate.revisionSha256 === d.expectedCandidateRevisionSha256);
    requireInput(humanStorageHash(out.originalLink.observed) === humanStorageHash(d.row) && humanStorageHash(j.source) === humanStorageHash(d.source));
    requireInput(j.status === d.human.status && h.ticker_authority === "none" && out.tickerAuthority === "none" && typeof h.created_at === "string" && Number.isFinite(Date.parse(h.created_at)));
    for (const key of Object.keys(d.human) as (keyof HumanFields)[]) requireInput(humanStorageHash(j[key]) === humanStorageHash(d.human[key]));
    return { id: h.id, caseId: d.caseId, revision: Number(h.revision), previousId: d.previousId, actorUserId: h.actor_user_id,
      auditLogId: h.audit_log_id, requestId: h.request_id, requestHash: String(h.request_hash), createdAt: new Date(h.created_at).toISOString(),
      draft: d, judgment: j, comparison: out, tickerAuthority: "none" };
  } catch { throw new KiwoomError("KIWOOM_HUMAN_SAVED_INVALID", 503); }
}
async function readOne(id: string, repo: SecTickerResolutionRepository) {
  requireInput(isUuid(id));
  const h = await selectRows(repo, HUMAN, { select: "*", id: `eq.${id}`, limit: "2" });
  if (!h.length) return null;
  const c = await selectRows(repo, COMPARISON, { select: "*", judgment_id: `eq.${id}`, limit: "2" });
  if (h.length !== 1 || h[0].id !== id || c.length !== 1) throw new KiwoomError("KIWOOM_HUMAN_SAVED_INVALID", 503);
  return decode(h[0], c[0]);
}
export async function listHumanComparisons(deps: HumanStorageDependencies = {}) {
  const repo = await repository(deps), rows = await selectRows(repo, HUMAN, { select: "id", order: "created_at.desc,id.desc", limit: "30" });
  return Promise.all(rows.map(async r => {
    const s = await readOne(String(r.id), repo);
    if (!s) throw new KiwoomError("KIWOOM_HUMAN_STORE_UNAVAILABLE", 503);
    return { id: s.id, caseId: s.caseId, revision: s.revision, status: s.judgment.status, createdAt: s.createdAt, decisionId: s.draft.decisionId };
  }));
}
async function previous(d: HumanStorageDraft, repo: SecTickerResolutionRepository) {
  const latest = await selectRows(repo, HUMAN, { select: "id,revision", case_id: `eq.${d.caseId}`, order: "revision.desc", limit: "1" });
  if ((latest[0]?.revision ?? 0) !== d.expectedRevision || (latest[0]?.id ?? null) !== d.previousId) throw new KiwoomError("KIWOOM_HUMAN_REVISION_CONFLICT", 409);
  return d.previousId ? readOne(d.previousId, repo) : null;
}
async function build(actorUserId: string, draft: HumanStorageDraft, deps: HumanStorageDependencies, repo: SecTickerResolutionRepository) {
  const prior = await previous(draft, repo);
  if (prior && (prior.draft.decisionId !== draft.decisionId || prior.judgment.status === "withdrawn")) throw new KiwoomError("KIWOOM_HUMAN_REVISION_CONFLICT", 409);
  const judgment: SecHumanJudgment = { ...draft.human, version: "sec-human-change-v1", id: randomUUID(), caseId: draft.caseId,
    revision: draft.expectedRevision + 1, previousJudgmentSha256: prior?.comparison.humanJudgmentSha256 ?? null,
    recordedAt: new Date().toISOString(), actor: { id: actorUserId, provenance: "caller_supplied_unverified" },
    candidateRevisionSha256: draft.expectedCandidateRevisionSha256, source: draft.source, textBasis: "secVisibleText" };
  if (draft.action === "withdraw") {
    if (!prior) throw new KiwoomError("KIWOOM_HUMAN_REVISION_CONFLICT", 409);
    const expected = { ...prior.draft, action: "withdraw", previousId: prior.id, expectedRevision: prior.revision,
      human: { ...prior.draft.human, status: "withdrawn", reason: draft.human.reason } };
    if (humanStorageHash(expected) !== humanStorageHash(draft)) throw new KiwoomError("KIWOOM_HUMAN_WITHDRAWAL_CHANGED", 409);
    // Withdrawal records retained historical values, not a fresh interpretation; no upstream needed.
    const { comparisonSha256: _hash, ...old } = prior.comparison;
    const content = { ...old, secHuman: judgment, humanJudgmentSha256: humanJudgmentSha256(judgment), humanStatus: "withdrawn" as const,
      assessment: { eligible: false, reasons: ["human_withdrawn", ...old.assessment.reasons.filter(r => r !== "human_unconfirmed" && r !== "human_withdrawn")] } };
    return { judgment, comparison: { ...content, comparisonSha256: humanStorageHash(content) } };
  }
  const loaded = await loadHumanCandidate(draft.decisionId, { repository: repo });
  const { rawContent: _raw, ...source } = loaded.source;
  if (loaded.candidate.decisionSha256 !== draft.expectedDecisionSha256 || loaded.candidate.revisionSha256 !== draft.expectedCandidateRevisionSha256
    || humanStorageHash(source) !== humanStorageHash(draft.source)) throw new KiwoomError("KIWOOM_CANDIDATE_STALE", 409);
  const review = await latestReview(draft.reviewId, draft.expectedReviewRevision, repo);
  if (review.snapshot.sourceHash !== draft.expectedSnapshotSha256 || review.draft.proof.imageSha256 !== draft.expectedImageSha256) throw new KiwoomError("KIWOOM_LINK_REVIEW_STALE", 409);
  const current = await (deps.fetchSnapshot ?? fetchKiwoomSnapshot)(review.snapshot.id);
  const { validateSnapshot } = await import("./source.ts");
  if (!validateSnapshot(current)) throw new KiwoomError("KIWOOM_SOURCE_UNAVAILABLE", 503);
  if (current.id !== review.snapshot.id || current.sourceHash !== review.snapshot.sourceHash) throw new KiwoomError("KIWOOM_SOURCE_CHANGED", 409);
  try {
    const comparison = createHumanExceptionComparison({ evaluation: loaded.evaluation, secSource: loaded.source, judgment, review, row: draft.row });
    return { judgment, comparison };
  } catch { throw new KiwoomError("KIWOOM_HUMAN_INPUT_INVALID", 400); }
}
export async function previewHumanComparison(actorUserId: string, value: unknown, deps: HumanStorageDependencies = {}) {
  requireInput(isUuid(actorUserId));
  const d = parseHumanStorageDraft(value), repo = await repository(deps);
  return (await build(actorUserId, d, deps, repo)).comparison;
}
export async function saveHumanComparison(input: { actorUserId: string; requestId: string; draft: unknown }, deps: HumanStorageDependencies = {}) {
  requireInput(isUuid(input.actorUserId) && isUuid(input.requestId));
  const draft = parseHumanStorageDraft(input.draft), requestHash = humanStorageHash(draft), repo = await repository(deps);
  async function replay() {
    const retries = await selectRows(repo, HUMAN, { select: "id", actor_user_id: `eq.${input.actorUserId}`, request_id: `eq.${input.requestId}`, limit: "2" });
    if (!retries.length) return null;
    if (retries.length !== 1) throw new KiwoomError("KIWOOM_HUMAN_SAVED_INVALID", 503);
    const saved = await readOne(String(retries[0].id), repo);
    if (!saved || saved.actorUserId !== input.actorUserId || saved.requestId !== input.requestId || saved.requestHash !== requestHash) throw new KiwoomError("KIWOOM_HUMAN_IDEMPOTENCY_CONFLICT", 409);
    return { status: "replayed" as const, saved }; // Historical replay, never a current-state claim.
  }
  const existing = await replay();
  if (existing) return existing;
  let built: Awaited<ReturnType<typeof build>>;
  try { built = await build(input.actorUserId, draft, deps, repo); }
  catch (error) {
    // The original request may have committed after our first replay lookup.
    // Re-read only; never retry a write or substitute another case/revision.
    const concurrent = await replay();
    if (concurrent) return concurrent;
    throw error;
  }
  const r = await repo.rpc("admin_record_kiwoom_human_comparison", { p_actor_user_id: input.actorUserId, p_request_id: input.requestId,
    p_request_hash: requestHash, p_draft: draft, p_judgment: built.judgment, p_comparison: built.comparison });
  if (!r.ok) {
    const code = ["ADMIN_PERMISSION_REQUIRED", "KIWOOM_HUMAN_REVISION_CONFLICT", "KIWOOM_HUMAN_IDEMPOTENCY_CONFLICT", "KIWOOM_HUMAN_INPUT_STALE", "KIWOOM_HUMAN_INPUT_INVALID"].find(c => r.error?.includes(c));
    throw new KiwoomError(code ?? "KIWOOM_HUMAN_STORE_UNAVAILABLE", code === "ADMIN_PERMISSION_REQUIRED" ? 403 : code ? 409 : 503);
  }
  const data = record(r.data);
  if (!["inserted", "replayed"].includes(String(data.status))) throw new KiwoomError("KIWOOM_HUMAN_SAVED_INVALID", 503);
  const saved = decode(record(data.judgment), record(data.comparison));
  if (saved.requestHash !== requestHash || saved.actorUserId !== input.actorUserId || saved.requestId !== input.requestId) throw new KiwoomError("KIWOOM_HUMAN_SAVED_INVALID", 503);
  return { status: data.status as "inserted" | "replayed", saved };
}
export async function readHumanComparison(id: string, deps: HumanStorageDependencies = {}): Promise<CurrentHumanComparison> {
  let saved: SavedHumanComparison | null = null;
  try {
    const repo = await repository(deps); saved = await readOne(id, repo);
    if (!saved) return { status: "not_found", reasons: ["judgment_not_found"], saved: null };
    const latest = await selectRows(repo, HUMAN, { select: "id,revision", case_id: `eq.${saved.caseId}`, order: "revision.desc", limit: "1" });
    if (!latest.length) return { status: "unavailable", reasons: ["current_judgment_unavailable"], saved };
    const newest = await readOne(String(latest[0].id), repo);
    if (!newest) return { status: "unavailable", reasons: ["current_judgment_unavailable"], saved };
    if (newest.judgment.status === "withdrawn") return { status: "withdrawn", reasons: ["human_withdrawn"], saved };
    if (newest.id !== saved.id) return { status: "stale", reasons: ["human_revision_changed"], saved };
    const loaded = await loadHumanCandidate(saved.draft.decisionId, { repository: repo });
    const review = await latestReview(saved.draft.reviewId, saved.draft.expectedReviewRevision, repo);
    const snapshot = await (deps.fetchSnapshot ?? fetchKiwoomSnapshot)(review.snapshot.id);
    const { validateSnapshot } = await import("./source.ts");
    if (!validateSnapshot(snapshot)) throw new KiwoomError("KIWOOM_SOURCE_UNAVAILABLE", 503);
    const check = checkHumanExceptionComparison(saved.comparison, { evaluation: loaded.evaluation, secSource: loaded.source,
      judgment: newest.judgment, review, row: newest.draft.row, snapshot });
    return { status: check.reusable ? "current" : "stale", reasons: check.reasons, saved };
  } catch (e) {
    const code = e instanceof KiwoomError ? e.code : "KIWOOM_HUMAN_STORE_UNAVAILABLE";
    const status = code === "KIWOOM_LINK_REVIEW_WITHDRAWN" ? "withdrawn" : code.endsWith("_NOT_FOUND") ? "not_found"
      : code.endsWith("_STALE") || code === "KIWOOM_SOURCE_CHANGED" ? "stale" : "unavailable";
    return { status, reasons: [code], saved };
  }
}
