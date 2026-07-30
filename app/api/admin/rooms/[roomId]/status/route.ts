import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  applyAdminAuthCookies,
  normalizeAdminError,
  resolveAdminApiAccess,
} from "@/lib/admin/api";
import { setAdminRoomStatus } from "@/lib/admin/rooms";
import { assertSameOriginAuthRequest } from "@/lib/auth/authRequest";

export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store" };
type RouteContext = { params: Promise<{ roomId: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  let resolution: Awaited<ReturnType<typeof resolveAdminApiAccess>> | null =
    null;
  try {
    assertSameOriginAuthRequest(request);
    resolution = await resolveAdminApiAccess(request, "rooms.manage");
    const { roomId } = await context.params;
    const input = (await request.json().catch(() => null)) as {
      action?: unknown;
      reason?: unknown;
    } | null;
    const state = await setAdminRoomStatus({
      action: input?.action,
      actorUserId: resolution.access.userId,
      reason: input?.reason,
      requestId:
        request.headers.get("x-request-id")?.trim().slice(0, 240) ||
        randomUUID(),
      roomId,
    });
    const response = NextResponse.json(
      { ok: true, data: state },
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
