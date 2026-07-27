import { NextRequest, NextResponse } from "next/server";
import { LIVE_ROOM_PRIVATE_HEADERS } from "@/lib/live-room/apiResponse";
import { socialVerificationErrorResponse } from "@/lib/social-verification/apiResponse";
import { listSocialVerificationReviews } from "@/lib/social-verification/serverRepository";
import {
  applySocialAuthCookies,
  resolveSocialMember,
} from "@/lib/social-verification/serverSession";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  let resolution: Awaited<ReturnType<typeof resolveSocialMember>> | null =
    null;
  try {
    resolution = await resolveSocialMember(request);
    const result = await listSocialVerificationReviews({
      cursor: request.nextUrl.searchParams.get("cursor"),
      limit: Number(request.nextUrl.searchParams.get("limit")) || 25,
      userId: resolution.userId,
    });
    const response = NextResponse.json(
      { ok: true, data: result },
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
