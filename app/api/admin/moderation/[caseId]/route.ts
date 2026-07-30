import { NextRequest, NextResponse } from "next/server";
import { assertSameOriginAuthRequest } from "@/lib/auth/authRequest";
import {
  applyAdminAuthCookies,
  normalizeAdminError,
  resolveAdminApiAccess,
} from "@/lib/admin/api";
import {
  getAdminModerationCase,
  updateAdminModerationCase,
} from "@/lib/admin/moderation";

export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store" };
type RouteContext = { params: Promise<{ caseId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  let resolution: Awaited<ReturnType<typeof resolveAdminApiAccess>> | null =
    null;
  try {
    resolution = await resolveAdminApiAccess(request, "moderation.read");
    const { caseId } = await context.params;
    const item = await getAdminModerationCase(caseId);
    const response = NextResponse.json(
      item
        ? { ok: true, data: item }
        : {
            ok: false,
            error: {
              code: "ADMIN_MODERATION_CASE_NOT_FOUND",
              message: "Moderation case not found.",
            },
          },
      { status: item ? 200 : 404, headers: HEADERS },
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

export async function PATCH(request: NextRequest, context: RouteContext) {
  let resolution: Awaited<ReturnType<typeof resolveAdminApiAccess>> | null =
    null;
  try {
    assertSameOriginAuthRequest(request);
    resolution = await resolveAdminApiAccess(request, "moderation.write");
    const { caseId } = await context.params;
    const input = (await request.json().catch(() => null)) as {
      action?: unknown;
      reason?: unknown;
      status?: unknown;
      severity?: unknown;
      assignedTo?: unknown;
      suspendUntil?: unknown;
    } | null;
    const item = await updateAdminModerationCase({
      actorUserId: resolution.access.userId,
      caseId,
      action: input?.action,
      reason: input?.reason,
      status: input?.status,
      severity: input?.severity,
      assignedTo: input?.assignedTo,
      suspendUntil: input?.suspendUntil,
    });
    const response = NextResponse.json(
      { ok: true, data: { item } },
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
