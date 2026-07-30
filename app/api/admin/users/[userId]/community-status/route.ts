import { NextRequest, NextResponse } from "next/server";
import { assertSameOriginAuthRequest } from "@/lib/auth/authRequest";
import {
  applyAdminAuthCookies,
  normalizeAdminError,
  resolveAdminApiAccess,
} from "@/lib/admin/api";
import { applyAdminUserCommunityAction } from "@/lib/admin/users";

export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store" };
type RouteContext = { params: Promise<{ userId: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  let resolution: Awaited<ReturnType<typeof resolveAdminApiAccess>> | null =
    null;
  try {
    assertSameOriginAuthRequest(request);
    resolution = await resolveAdminApiAccess(request, "users.enforce");
    const { userId } = await context.params;
    const input = (await request.json().catch(() => null)) as {
      action?: unknown;
      reason?: unknown;
      expiresAt?: unknown;
    } | null;
    const status = await applyAdminUserCommunityAction({
      actorUserId: resolution.access.userId,
      targetUserId: userId,
      action: input?.action,
      reason: input?.reason,
      expiresAt: input?.expiresAt,
    });
    const response = NextResponse.json(
      { ok: true, data: { status } },
      { headers: HEADERS },
    );
    applyAdminAuthCookies(response, resolution);
    return response;
  } catch (error) {
    const normalized = normalizeAdminError(error);
    const response = NextResponse.json(
      { ok: false, error: normalized },
      { status: normalized.status, headers: HEADERS },
    );
    if (resolution) applyAdminAuthCookies(response, resolution);
    return response;
  }
}
