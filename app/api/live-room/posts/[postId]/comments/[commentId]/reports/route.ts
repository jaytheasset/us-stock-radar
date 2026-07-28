import { NextRequest, NextResponse } from "next/server";
import { assertSameOriginAuthRequest } from "@/lib/auth/authRequest";
import {
  LIVE_ROOM_PRIVATE_HEADERS,
  liveRoomErrorResponse,
} from "@/lib/live-room/apiResponse";
import { reportLiveRoomPostComment } from "@/lib/live-room/postServerRepository";
import {
  applyLiveRoomActorCookies,
  resolveLiveRoomActor,
} from "@/lib/live-room/serverActor";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ commentId: string; postId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  let resolution: Awaited<ReturnType<typeof resolveLiveRoomActor>> | null =
    null;
  try {
    assertSameOriginAuthRequest(request);
    const { commentId, postId } = await context.params;
    const input = await request.json().catch(() => null) as
      | { reason?: unknown }
      | null;
    resolution = await resolveLiveRoomActor(request);
    const result = await reportLiveRoomPostComment({
      actor: resolution.actor,
      commentId,
      postId,
      reason: input?.reason,
    });
    const response = NextResponse.json(
      { ok: true, data: result },
      { headers: LIVE_ROOM_PRIVATE_HEADERS },
    );
    applyLiveRoomActorCookies(response, resolution);
    return response;
  } catch (error) {
    const response = liveRoomErrorResponse(error);
    if (resolution) applyLiveRoomActorCookies(response, resolution);
    return response;
  }
}
