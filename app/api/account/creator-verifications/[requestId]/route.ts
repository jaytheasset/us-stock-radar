import { NextRequest, NextResponse } from "next/server";
import { assertSameOriginAuthRequest } from "@/lib/auth/authRequest";
import { LIVE_ROOM_PRIVATE_HEADERS } from "@/lib/live-room/apiResponse";
import { socialVerificationErrorResponse } from "@/lib/social-verification/apiResponse";
import { mutateSocialVerificationRequest } from "@/lib/social-verification/serverRepository";
import {
  applySocialAuthCookies,
  resolveSocialMember,
} from "@/lib/social-verification/serverSession";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ requestId: string }>;
};

export async function PATCH(
  request: NextRequest,
  context: RouteContext,
) {
  let resolution: Awaited<ReturnType<typeof resolveSocialMember>> | null =
    null;
  try {
    assertSameOriginAuthRequest(request);
    resolution = await resolveSocialMember(request);
    const { requestId } = await context.params;
    const input = (await request.json().catch(() => null)) as {
      action?: unknown;
      proofUrl?: unknown;
      showOnProfile?: unknown;
    } | null;
    const item = await mutateSocialVerificationRequest({
      action: input?.action,
      proofUrl: input?.proofUrl,
      publicRequestId: requestId,
      showOnProfile: input?.showOnProfile,
      userId: resolution.userId,
    });
    const response = NextResponse.json(
      { ok: true, data: { item } },
      { headers: LIVE_ROOM_PRIVATE_HEADERS },
    );
    applySocialAuthCookies(response, resolution);
    return response;
  } catch (error) {
    const response = socialVerificationErrorResponse(error);
    if (resolution) applySocialAuthCookies(response, resolution);
    return response;
  }
}
