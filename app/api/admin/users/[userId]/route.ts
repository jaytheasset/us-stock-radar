import { NextRequest, NextResponse } from "next/server";
import {
  applyAdminAuthCookies,
  normalizeAdminError,
  resolveAdminApiAccess,
} from "@/lib/admin/api";
import { getAdminUserDetail } from "@/lib/admin/users";

export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store" };

type RouteContext = { params: Promise<{ userId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  let resolution: Awaited<ReturnType<typeof resolveAdminApiAccess>> | null =
    null;
  try {
    resolution = await resolveAdminApiAccess(request, "users.read");
    const { userId } = await context.params;
    const user = await getAdminUserDetail(userId);
    const response = NextResponse.json(
      user
        ? { ok: true, data: { user } }
        : {
            ok: false,
            error: { code: "ADMIN_USER_NOT_FOUND", message: "User not found." },
          },
      { status: user ? 200 : 404, headers: HEADERS },
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
