import { NextRequest, NextResponse } from "next/server";
import {
  applyAdminAuthCookies,
  normalizeAdminError,
  resolveAdminApiAccess,
} from "@/lib/admin/api";
import { listAdminModerationCases } from "@/lib/admin/moderation";

export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest) {
  let resolution: Awaited<ReturnType<typeof resolveAdminApiAccess>> | null =
    null;
  try {
    resolution = await resolveAdminApiAccess(request, "moderation.read");
    const cases = await listAdminModerationCases({
      status: request.nextUrl.searchParams.get("status") || undefined,
      severity: request.nextUrl.searchParams.get("severity") || undefined,
      type: request.nextUrl.searchParams.get("type") || undefined,
      limit: Number(request.nextUrl.searchParams.get("limit")) || 100,
    });
    const response = NextResponse.json(
      { ok: true, data: { cases } },
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
