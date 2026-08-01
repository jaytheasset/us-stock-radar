import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  applyAdminAuthCookies,
  normalizeAdminError,
  resolveAdminApiAccess,
} from "@/lib/admin/api";
import {
  cancelAdminTelegramCampaign,
  getAdminTelegramCampaign,
  reconcileAdminTelegramCampaign,
  saveAdminTelegramCampaign,
  scheduleAdminTelegramCampaign,
} from "@/lib/admin/telegramCampaigns";
import { sendAdminTelegramCampaignNow } from "@/lib/admin/telegramCampaignDelivery";
import { etLocalDateTimeToUtc } from "@/lib/admin/telegramCampaignPolicy";
import { assertSameOriginAuthRequest } from "@/lib/auth/authRequest";

export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store" };

type Context = { params: Promise<{ campaignId: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  let resolution: Awaited<ReturnType<typeof resolveAdminApiAccess>> | null =
    null;
  try {
    assertSameOriginAuthRequest(request);
    const input = (await request.json().catch(() => null)) as {
      action?: unknown;
      content?: unknown;
      expectedVersion?: unknown;
      reason?: unknown;
      scheduledForEt?: unknown;
    } | null;
    const action = typeof input?.action === "string" ? input.action : "";
    const permission = [
      "send_now",
      "mark_delivered",
      "confirm_not_delivered",
    ].includes(action)
      ? "telegram.send"
      : "telegram.write";
    resolution = await resolveAdminApiAccess(request, permission);
    const { campaignId } = await context.params;
    const common = {
      actorUserId: resolution.access.userId,
      campaignId,
      expectedVersion: input?.expectedVersion,
      reason: input?.reason,
      requestId: requestId(request),
    };

    const data =
      action === "save"
        ? {
            campaign: await saveAdminTelegramCampaign({
              ...common,
              baseUrl: request.nextUrl.origin,
              content: input?.content,
            }),
          }
        : action === "schedule"
          ? {
              campaign: await scheduleAdminTelegramCampaign({
                ...common,
                scheduledForUtc: etLocalDateTimeToUtc(input?.scheduledForEt),
              }),
            }
          : action === "cancel"
            ? {
                campaign: await cancelAdminTelegramCampaign(common),
              }
            : action === "send_now"
              ? {
                  delivery: await sendAdminTelegramCampaignNow(common),
                  campaign: await getAdminTelegramCampaign(campaignId),
                }
              : action === "mark_delivered" ||
                  action === "confirm_not_delivered"
                ? {
                    campaign: await reconcileAdminTelegramCampaign({
                      ...common,
                      reconciliation:
                        action === "mark_delivered"
                          ? "delivered"
                          : "not_delivered",
                    }),
                  }
              : (() => {
                  throw new Error("ADMIN_TELEGRAM_ACTION_INVALID");
                })();

    const response = NextResponse.json(
      { ok: true, data },
      { headers: HEADERS },
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
