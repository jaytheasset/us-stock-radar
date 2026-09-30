import "server-only";
import { createHash } from "node:crypto";
import { readSecListingHistory } from "./persistence.ts";
import { uuid, type Row } from "./observation.ts";
import { record } from "../sec-delisting-state/state.ts";
import { sourceText } from "./sourceEvent.ts";
import { validateReviewedDates, type ReviewedDates, type ReviewDocument } from "./reviewContract.ts";
import type { SecTickerResolutionRepository } from "../sec-ticker-resolution/persistence.ts";
import { AdminApiError } from "../admin/errors.ts";

async function repository(): Promise<SecTickerResolutionRepository> {
  const db = await import("../supabase.ts"); return { select: db.supabaseSelect, rpc: db.supabaseRpc };
}
async function select(repo: SecTickerResolutionRepository, table: string, query: Record<string, string>) {
  const result = await repo.select(table, { select: "*", ...query });
  if (!result.ok || !Array.isArray(result.data)) throw Error("listing_review_read_unavailable");
  return result.data as Row[];
}
export function reviewDocuments(snapshot: Row): ReviewDocument[] {
  const p = record(snapshot.raw_payload);
  const docs = [{ id: "primary", url: p.primary_document_url, text: p.primary_document_html,
    truncated: p.primary_document_html_truncated },
  ...(Array.isArray(p.attachment_texts) ? p.attachment_texts.map((v, i) => {
    const d = record(v); return { id: `attachment:${i}`, url: d.url, text: d.text, truncated: d.textTruncated };
  }) : [])];
  return docs.flatMap(d => {
    if (d.truncated === true || typeof d.text !== "string" || !d.text.trim() || typeof d.url !== "string") return [];
    try { const u = new URL(d.url); if (u.protocol !== "https:" || u.hostname !== "www.sec.gov"
      || !u.pathname.includes(`/${String(snapshot.source_unique_id).replaceAll("-", "")}/`)) return []; } catch { return []; }
    return [{ id: d.id, url: d.url, sha256: createHash("sha256").update(d.text).digest("hex"), text: sourceText(d.text) }];
  });
}

/** Canonical observation readback with a separately labelled human layer.
 * Does not rewrite automatic facts, confer identity, or change the status projector/Monitor.
 * Current revalidation is mandatory; stale decisions stay in history, never effective facts. */
export async function readReviewedSecListingObservation(input: { observationId: string; repository?: SecTickerResolutionRepository }) {
  if (!uuid(input.observationId)) throw Error("invalid_listing_observation_id");
  const repo = input.repository ?? await repository();
  const row = (await select(repo, "sec_listing_status_observations", { id: `eq.${input.observationId}`, limit: "1" }))[0];
  if (!row) throw Error("listing_observation_not_found");
  const automatic = (await readSecListingHistory({ rawItemId: String(row.raw_item_id), repository: repo }))
    .find(item => item.id === input.observationId);
  if (!automatic) throw Error("listing_observation_not_found");
  const documents = reviewDocuments(automatic.observation.sourceSnapshot);
  const history = await select(repo, "sec_listing_status_date_reviews", { observation_id: `eq.${input.observationId}`, order: "revision.asc", limit: "1001" });
  if (history.length > 1000) throw Error("listing_review_history_incomplete");
  const latest = history.at(-1);
  let reviewedFacts: ReviewedDates | null = null;
  let reviewStatus = latest ? "withdrawn" : "not_reviewed";
  if (latest?.action === "reviewed") {
    reviewStatus = "stale_or_invalid";
    if (automatic.usable && latest.base_version === row.observation_sha256
      && latest.source_sha256 === automatic.observation.sourceHash) {
      try { reviewedFacts = validateReviewedDates(latest.dates, documents); reviewStatus = "reviewed"; }
      catch { /* Keep invalid decisions visible in audit history, never use them. */ }
    }
  }
  return { observationId: input.observationId, baseVersion: String(row.observation_sha256),
    revision: Number(latest?.revision ?? 0), automatic, documents, history, reviewedFacts, reviewStatus,
    decisionId: latest ? String(latest.id) : null, reviewedAt: latest ? String(latest.created_at) : null };
}
export type ListingDateReview = Awaited<ReturnType<typeof readReviewedSecListingObservation>>;

export async function listListingReviewObservations() {
  return select(await repository(), "sec_listing_status_observations", {
    select: "id,raw_item_id,filing_date,attachment_status,observation->accession,observation->form,observation->reported",
    order: "recorded_at.desc,id.desc", limit: "100",
  });
}
export async function applyListingDateReview(input: {
  observationId: string; actorUserId: string; action: string; dates: unknown; reason: string;
  expectedVersion: string; expectedRevision: number; requestId: string; repository?: SecTickerResolutionRepository;
}) {
  if (!["reviewed", "withdrawn"].includes(input.action) || !Number.isInteger(input.expectedRevision) || input.expectedRevision < 0
    || !/^[a-f0-9]{64}$/.test(input.expectedVersion) || input.reason.trim().length < 4 || input.reason.length > 2000)
    throw new AdminApiError("INVALID_LISTING_REVIEW", "Provide a reason and refresh the review before deciding.", 400);
  const repo = input.repository ?? await repository();
  const current = await readReviewedSecListingObservation({ observationId: input.observationId, repository: repo });
  if (input.action === "reviewed" && !current.automatic.usable)
    throw new AdminApiError("STALE_LISTING_OBSERVATION", "This automatic observation failed revalidation. Review a current observation.", 409);
  let dates: ReviewedDates | Record<string, never> = {};
  try { if (input.action === "reviewed") dates = validateReviewedDates(input.dates, current.documents); }
  catch (e) { throw new AdminApiError("INVALID_LISTING_DATES", e instanceof Error ? e.message : "Invalid dates.", 400); }
  const response = await repo.rpc("admin_apply_sec_listing_date_review", {
    p_observation_id: input.observationId, p_actor_user_id: input.actorUserId, p_action: input.action, p_dates: dates,
    p_reason: input.reason.trim(), p_expected_version: input.expectedVersion, p_expected_revision: input.expectedRevision,
    p_request_id: input.requestId,
  });
  if (!response.ok) {
    if (/LISTING_REVIEW_(STALE_REVISION|SOURCE_CHANGED|ANALYSIS_CHANGED|REPLAY_CONFLICT)/.test(response.error ?? ""))
      throw new AdminApiError("LISTING_REVIEW_CONFLICT", "The source, observation or review changed. Refresh before deciding.", 409);
    if (/ADMIN_PERMISSION_REQUIRED/.test(response.error ?? "") || response.status === 403)
      throw new AdminApiError("LISTING_REVIEW_FORBIDDEN", "Your administrator role does not allow this decision.", 403);
    throw new AdminApiError("LISTING_REVIEW_WRITE_UNAVAILABLE", "The review could not be stored. No successful decision is being reported; refresh the history before retrying.", 503);
  }
  return record(response.data);
}
