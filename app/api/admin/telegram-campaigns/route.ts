import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  applyAdminAuthCookies,
  normalizeAdminError,
  resolveAdminApiAccess,
} from "@/lib/admin/api";
import { saveAdminTelegramCampaign } from "@/lib/admin/telegramCampaigns";
import { assertSameOriginAuthRequest } from "@/lib/auth/authRequest";

export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store" };

export async function POST(request: NextRequest) {
  let resolution: Awaited<ReturnType<typeof resolveAdminApiAccess>> | null =
    null;
  try {
    assertSameOriginAuthRequest(request);
    resolution = await resolveAdminApiAccess(request, "telegram.write");
    const input = (await request.json().catch(() => null)) as {
      content?: unknown;
      reason?: unknown;
    } | null;
    const campaign = await saveAdminTelegramCampaign({
      actorUserId: resolution.access.userId,
      baseUrl: request.nextUrl.origin,
      content: input?.content,
      reason: input?.reason,
      requestId: requestId(request),
    });
    const response = NextResponse.json(
      { ok: true, data: { campaign } },
      { status: 201, headers: HEADERS },
    );
    applyAdminAuthCookies(response, resolution);
    return response;
  } catch (error) {
    return errorResponse(error, resolution);
  }
}

function requestId(request: NextRequest) {
  return (
    request.headers.get("x-request-id")?.trim().slice(0, 240) || randomUUID()
  );
}

function errorResponse(
  error: unknown,
  resolution: Awaited<ReturnType<typeof resolveAdminApiAccess>> | null,
) {
  const normalized = normalizeAdminError(error);
  const response = NextResponse.json(
    { ok: false, error: normalized },
    { status: normalized.status, headers: HEADERS },
  );
  if (resolution) applyAdminAuthCookies(response, resolution);
  return response;
}
