import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { ADMIN_PRIVATE_RESPONSE_HEADERS, applyAdminAuthCookies, normalizeAdminError, resolveAdminApiAccess } from "@/lib/admin/api";
import { assertSameOriginAuthRequest } from "@/lib/auth/authRequest";
import { applyListingDateReview, readReviewedSecListingObservation } from "@/lib/sec-listing-status/review";

export const dynamic = "force-dynamic";
export async function POST(request: NextRequest, context: { params: Promise<{ observationId: string }> }) {
  let access: Awaited<ReturnType<typeof resolveAdminApiAccess>> | null = null;
  try {
    assertSameOriginAuthRequest(request);
    access = await resolveAdminApiAccess(request, "data.run");
    const { observationId } = await context.params, body = await request.json();
    const result = await applyListingDateReview({ observationId, actorUserId: access.access.userId,
      action: String(body.action ?? ""), dates: body.dates, reason: String(body.reason ?? ""),
      expectedVersion: String(body.expectedVersion ?? ""), expectedRevision: body.expectedRevision,
      requestId: request.headers.get("x-request-id")?.slice(0, 220) || randomUUID() });
    const response = NextResponse.json({ ok: true, result, data: await readReviewedSecListingObservation({ observationId }) }, { headers: ADMIN_PRIVATE_RESPONSE_HEADERS });
    applyAdminAuthCookies(response, access); return response;
  } catch (error) {
    const normalized = normalizeAdminError(error);
    const response = NextResponse.json({ ok: false, error: normalized }, { status: normalized.status, headers: ADMIN_PRIVATE_RESPONSE_HEADERS });
    if (access) applyAdminAuthCookies(response, access); return response;
  }
}
