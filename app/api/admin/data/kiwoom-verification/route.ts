import { NextRequest, NextResponse } from "next/server";
import { ADMIN_PRIVATE_RESPONSE_HEADERS, applyAdminAuthCookies, normalizeAdminError, resolveAdminApiAccess, respondToAdminReadHead } from "@/lib/admin/api";
import { assertSameOriginAuthRequest } from "@/lib/auth/authRequest";
import { fetchKiwoomNoticeList, fetchKiwoomSnapshot, KiwoomError } from "@/lib/ticker-verification/kiwoom/source";
import { getKiwoomReview, listKiwoomReviews, saveKiwoomReview } from "@/lib/ticker-verification/kiwoom/service";
import { compareReviewedSource } from "@/lib/ticker-verification/kiwoom/review";
import { humanCandidateDisplay, listHumanComparisons, readHumanComparison, previewHumanComparison, saveHumanComparison } from "@/lib/ticker-verification/kiwoom/humanStorage";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = ADMIN_PRIVATE_RESPONSE_HEADERS;
type Access = Awaited<ReturnType<typeof resolveAdminApiAccess>>;
function failure(error: unknown, access: Access | null) {
  const normalized = error instanceof KiwoomError ? { code: error.code, status: error.status, message: error.code } : normalizeAdminError(error);
  const response = NextResponse.json({ ok: false, error: normalized }, { status: normalized.status, headers });
  if (access) applyAdminAuthCookies(response, access);
  return response;
}
export async function HEAD(request: NextRequest) { return respondToAdminReadHead(request, "system.read"); }
export async function GET(request: NextRequest) {
  let access: Access | null = null;
  try {
    access = await resolveAdminApiAccess(request, "system.read");
    const q = request.nextUrl.searchParams, mode = q.get("mode") ?? "notices";
    let data: unknown;
    if (mode === "notices") data = await fetchKiwoomNoticeList(Number(q.get("page") ?? "1"));
    else if (mode === "notice") data = await fetchKiwoomSnapshot(q.get("noticeId") ?? "");
    else if (mode === "history") data = await listKiwoomReviews();
    else if (mode === "review") data = await getKiwoomReview(q.get("id") ?? "");
    else if (mode === "candidate") data = await humanCandidateDisplay(q.get("decisionId") ?? "");
    else if (mode === "human-history") data = await listHumanComparisons();
    else if (mode === "human") data = await readHumanComparison(q.get("id") ?? "");
    else if (mode === "recheck") {
      const review = await getKiwoomReview(q.get("id") ?? "");
      const current = await fetchKiwoomSnapshot(review.snapshot.id);
      data = { status: compareReviewedSource(review, current), current, savedSourceHash: review.snapshot.sourceHash };
    } else throw new KiwoomError("KIWOOM_MODE_INVALID", 400);
    const response = NextResponse.json({ ok: true, data }, { headers });
    applyAdminAuthCookies(response, access); return response;
  } catch (error) { return failure(error, access); }
}
async function boundedJson(request: NextRequest, limit = 16_384): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new KiwoomError("KIWOOM_REVIEW_INVALID", 400);
  const reader = request.body?.getReader(); if (!reader) throw new KiwoomError("KIWOOM_REVIEW_INVALID", 400);
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.length;
      if (bytes > limit) { await reader.cancel(); throw new KiwoomError("KIWOOM_REVIEW_TOO_LARGE", 413); } chunks.push(part.value); }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new KiwoomError("KIWOOM_REVIEW_INVALID", 400); }
  } finally { reader.releaseLock(); }
}
export async function POST(request: NextRequest) {
  let access: Access | null = null;
  try {
    assertSameOriginAuthRequest(request);
    access = await resolveAdminApiAccess(request, "data.run");
    const mode = request.nextUrl.searchParams.get("mode");
    let data: unknown;
    if (mode === "human-preview") data = await previewHumanComparison(access.access.userId, await boundedJson(request, 65_536));
    else if (mode === "human-save") data = await saveHumanComparison({ actorUserId: access.access.userId, requestId: request.headers.get("x-request-id") ?? "", draft: await boundedJson(request, 65_536) });
    else if (mode === null) data = await saveKiwoomReview({ actorUserId: access.access.userId, requestId: request.headers.get("x-request-id") ?? "", draft: await boundedJson(request) });
    else throw new KiwoomError("KIWOOM_MODE_INVALID", 400);
    const response = NextResponse.json({ ok: true, data }, { headers });
    applyAdminAuthCookies(response, access); return response;
  } catch (error) { return failure(error, access); }
}
