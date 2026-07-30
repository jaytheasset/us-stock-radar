import { NextRequest, NextResponse } from "next/server";
import { assertSameOriginAuthRequest } from "@/lib/auth/authRequest";
import {
  applyAdminAuthCookies,
  normalizeAdminError,
  resolveAdminApiAccess,
} from "@/lib/admin/api";
import { setAdminRoleAssignment } from "@/lib/admin/audit";

export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store" };

export async function PATCH(request: NextRequest) {
  let resolution: Awaited<ReturnType<typeof resolveAdminApiAccess>> | null =
    null;
  try {
    assertSameOriginAuthRequest(request);
    resolution = await resolveAdminApiAccess(request, "roles.manage");
    const input = (await request.json().catch(() => null)) as {
      targetUserId?: unknown;
      role?: unknown;
      active?: unknown;
      reason?: unknown;
    } | null;
    const assignment = await setAdminRoleAssignment({
      actorUserId: resolution.access.userId,
      targetUserId:
        typeof input?.targetUserId === "string" ? input.targetUserId : "",
      role: input?.role,
      active: input?.active,
      reason: input?.reason,
    });
    const response = NextResponse.json(
      { ok: true, data: { assignment } },
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
