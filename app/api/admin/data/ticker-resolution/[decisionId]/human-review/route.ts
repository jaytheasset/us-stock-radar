import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  applyAdminAuthCookies,
  normalizeAdminError,
  resolveAdminApiAccess,
} from "@/lib/admin/api";
import { assertSameOriginAuthRequest } from "@/lib/auth/authRequest";
import {
  applySecTickerResolutionHumanDecision,
  readEffectiveSecTickerResolutionByDecisionId,
} from "@/lib/sec-ticker-resolution/humanReview";

export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "private, no-store" };
type RouteContext = { params: Promise<{ decisionId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  let resolution: Awaited<ReturnType<typeof resolveAdminApiAccess>> | null =
    null;
  try {
    assertSameOriginAuthRequest(request);
    resolution = await resolveAdminApiAccess(request, "data.run");
    const { decisionId } = await context.params;
    const body = (await request.json().catch(() => null)) as {
      action?: unknown;
      expectedAutomaticSha256?: unknown;
      expectedRevision?: unknown;
      reason?: unknown;
    } | null;
    const write = await applySecTickerResolutionHumanDecision({
      action: body?.action,
      actorUserId: resolution.access.userId,
      automaticDecisionId: decisionId,
      expectedAutomaticSha256:
        typeof body?.expectedAutomaticSha256 === "string"
          ? body.expectedAutomaticSha256
          : "",
      expectedRevision: Number(body?.expectedRevision),
      reason: body?.reason,
      requestId:
        request.headers.get("x-request-id")?.trim().slice(0, 240) ||
        randomUUID(),
    });
    const effective = await readEffectiveSecTickerResolutionByDecisionId({
      decisionId,
    });
    if (effective.status !== "available") {
      throw new Error("ADMIN_TICKER_POST_WRITE_READ_FAILED");
    }
    const response = NextResponse.json(
      { ok: true, data: { write, effective } },
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
