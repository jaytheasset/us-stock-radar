import { NextRequest, NextResponse } from "next/server";
import { assertSameOriginAuthRequest } from "@/lib/auth/authRequest";
import {
  LIVE_ROOM_PRIVATE_HEADERS,
  liveRoomErrorResponse,
} from "@/lib/live-room/apiResponse";
import { blockLiveRoomPostAuthor } from "@/lib/live-room/postServerRepository";
import {
  applyLiveRoomActorCookies,
  resolveLiveRoomActor,
} from "@/lib/live-room/serverActor";

type RouteContext = { params: Promise<{ postId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  let resolution: Awaited<ReturnType<typeof resolveLiveRoomActor>> | null =
    null;
  try {
    assertSameOriginAuthRequest(request);
    const { postId } = await context.params;
    resolution = await resolveLiveRoomActor(request);
    const result = await blockLiveRoomPostAuthor({
      actor: resolution.actor,
      postId,
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
