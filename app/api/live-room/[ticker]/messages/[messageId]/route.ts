import { NextRequest, NextResponse } from "next/server";
import {
  LIVE_ROOM_PRIVATE_HEADERS,
  liveRoomErrorResponse,
} from "@/lib/live-room/apiResponse";
import {
  applyLiveRoomActorCookies,
  resolveLiveRoomActor,
} from "@/lib/live-room/serverActor";
import { getLiveRoomMessageAnchor } from "@/lib/live-room/serverRepository";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ messageId: string; ticker: string }>;
};

export async function GET(
  request: NextRequest,
  context: RouteContext,
) {
  let resolution: Awaited<
    ReturnType<typeof resolveLiveRoomActor>
  > | null = null;
  try {
    const { messageId, ticker } = await context.params;
    resolution = await resolveLiveRoomActor(request);
    const message = await getLiveRoomMessageAnchor({
      actor: resolution.actor,
      messageId,
      ticker,
    });
    const response = NextResponse.json(
      { ok: true, data: message },
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
