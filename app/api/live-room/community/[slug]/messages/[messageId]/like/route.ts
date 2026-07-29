import { NextRequest, NextResponse } from "next/server";
import { assertSameOriginAuthRequest } from "@/lib/auth/authRequest";
import {
  LIVE_ROOM_PRIVATE_HEADERS,
  liveRoomErrorResponse,
} from "@/lib/live-room/apiResponse";
import {
  applyLiveRoomActorCookies,
  resolveLiveRoomActor,
} from "@/lib/live-room/serverActor";
import { setLiveRoomMessageLike } from "@/lib/live-room/serverRepository";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ messageId: string; slug: string }>;
};

export async function PUT(
  request: NextRequest,
  context: RouteContext,
) {
  let resolution: Awaited<
    ReturnType<typeof resolveLiveRoomActor>
  > | null = null;
  try {
    assertSameOriginAuthRequest(request);
    const { messageId, slug } = await context.params;
    const input = (await request.json().catch(() => null)) as {
      liked?: unknown;
    } | null;
    resolution = await resolveLiveRoomActor(request);
    const result = await setLiveRoomMessageLike({
      actor: resolution.actor,
      liked: input?.liked,
      messageId,
      slug,
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
