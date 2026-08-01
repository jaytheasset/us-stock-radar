import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  applyAdminAuthCookies,
  normalizeAdminError,
  resolveAdminApiAccess,
} from "@/lib/admin/api";
import {
  createLocalAdminTelegramMockTransport,
  runDueAdminTelegramCampaigns,
} from "@/lib/admin/telegramCampaignDelivery";
import { assertSameOriginAuthRequest } from "@/lib/auth/authRequest";

export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store" };

export async function POST(request: NextRequest) {
  let resolution: Awaited<ReturnType<typeof resolveAdminApiAccess>> | null =
    null;
  try {
    assertSameOriginAuthRequest(request);
    resolution = await resolveAdminApiAccess(request, "telegram.send");
    if (process.env.NODE_ENV === "production") {
      throw new Error("ADMIN_TELEGRAM_LOCAL_RUN_UNAVAILABLE");
    }
    const input = (await request.json().catch(() => null)) as {
      confirmation?: unknown;
      reason?: unknown;
    } | null;
    if (input?.confirmation !== "RUN LOCAL MOCK") {
      throw new Error("ADMIN_TELEGRAM_LOCAL_RUN_CONFIRMATION_REQUIRED");
    }
    if (typeof input.reason !== "string" || input.reason.trim().length < 4) {
      throw new Error("ADMIN_REASON_REQUIRED");
    }
    const result = await runDueAdminTelegramCampaigns({
      limit: 1,
      trigger: "local_mock",
      transport: createLocalAdminTelegramMockTransport(),
      actorUserId: resolution.access.userId,
      reason: input.reason,
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
