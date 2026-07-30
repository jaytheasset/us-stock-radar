import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  applyAdminAuthCookies,
  normalizeAdminError,
  resolveAdminApiAccess,
} from "@/lib/admin/api";
import { runAdminGlobeIngest } from "@/lib/admin/sourceRuns";
import { assertSameOriginAuthRequest } from "@/lib/auth/authRequest";

export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store" };

export async function POST(request: NextRequest) {
  let resolution: Awaited<ReturnType<typeof resolveAdminApiAccess>> | null =
    null;
  try {
    assertSameOriginAuthRequest(request);
    resolution = await resolveAdminApiAccess(request, "data.run");
    const input = (await request.json().catch(() => null)) as {
      force?: unknown;
      forceConfirmation?: unknown;
      limit?: unknown;
      reason?: unknown;
    } | null;
    const result = await runAdminGlobeIngest({
      actorUserId: resolution.access.userId,
      force: input?.force,
      forceConfirmation: input?.forceConfirmation,
      limit: input?.limit,
      reason: input?.reason,
      requestId:
        request.headers.get("x-request-id")?.trim().slice(0, 240) ||
        randomUUID(),
    });
    const response = NextResponse.json(
      { ok: true, data: result },
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
