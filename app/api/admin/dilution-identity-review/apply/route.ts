import { NextRequest, NextResponse } from "next/server";
import { assertSameOriginAuthRequest } from "@/lib/auth/authRequest";
import {
  ADMIN_PRIVATE_RESPONSE_HEADERS,
  AdminApiError,
  applyAdminAuthCookies,
  normalizeAdminError,
  resolveAdminApiAccess,
} from "@/lib/admin/api";
import {
  applyDilutionIdentityReviewDecision,
  DilutionIdentityReviewError,
} from "@/lib/dilution/dilutionIdentityReviewExchange";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let resolution: Awaited<ReturnType<typeof resolveAdminApiAccess>> | null = null;
  try {
    assertSameOriginAuthRequest(request);
    resolution = await resolveAdminApiAccess(request, "data.run");
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const result = await applyDilutionIdentityReviewDecision({
      observationKey: typeof body?.observationKey === "string" ? body.observationKey : "",
      pastedDecision: typeof body?.pastedDecision === "string" ? body.pastedDecision : "",
      appliedByUserId: resolution.access.userId,
    });
    const response = NextResponse.json(
      { ok: true, result },
      { headers: ADMIN_PRIVATE_RESPONSE_HEADERS },
    );
    applyAdminAuthCookies(response, resolution);
    return response;
  } catch (error) {
    const normalized = normalizeAdminError(asAdminError(error));
    const response = NextResponse.json(
      { ok: false, error: normalized },
      { status: normalized.status, headers: ADMIN_PRIVATE_RESPONSE_HEADERS },
    );
    if (resolution) applyAdminAuthCookies(response, resolution);
    return response;
  }
}

function asAdminError(error: unknown) {
  return error instanceof DilutionIdentityReviewError
    ? new AdminApiError(error.code, error.message, error.status)
    : error;
}
