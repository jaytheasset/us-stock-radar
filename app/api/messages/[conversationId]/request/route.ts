import { NextRequest, NextResponse } from "next/server";
import { assertSameOriginAuthRequest } from "@/lib/auth/authRequest";
import { respondToDirectMessageRequest } from "@/lib/direct-messages/serverRepository";
import {
  LIVE_ROOM_PRIVATE_HEADERS,
  liveRoomErrorResponse,
} from "@/lib/live-room/apiResponse";
import {
  applyLiveRoomActorCookies,
  resolveLiveRoomActor,
} from "@/lib/live-room/serverActor";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ conversationId: string }>;
};

export async function PATCH(
  request: NextRequest,
  context: RouteContext,
) {
  let resolution: Awaited<
    ReturnType<typeof resolveLiveRoomActor>
  > | null = null;
  try {
    assertSameOriginAuthRequest(request);
    const { conversationId } = await context.params;
    const input = (await request.json().catch(() => null)) as {
      action?: unknown;
    } | null;
    resolution = await resolveLiveRoomActor(request);
    const data = await respondToDirectMessageRequest({
      action: input?.action,
      actor: resolution.actor,
      conversationId,
    });
    const response = NextResponse.json(
      { ok: true, data },
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
