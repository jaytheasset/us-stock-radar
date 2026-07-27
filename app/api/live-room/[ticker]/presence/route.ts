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
import {
  getLiveRoomPresenceSummary,
  heartbeatLiveRoomPresence,
} from "@/lib/live-room/serverRepository";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ ticker: string }>;
};

export async function POST(
  request: NextRequest,
  context: RouteContext,
) {
  let resolution: Awaited<
    ReturnType<typeof resolveLiveRoomActor>
  > | null = null;
  try {
    assertSameOriginAuthRequest(request);
    const { ticker } = await context.params;
    const input = (await request.json().catch(() => null)) as {
      messageIds?: unknown;
    } | null;
    resolution = await resolveLiveRoomActor(request);
    const summary = await getLiveRoomPresenceSummary({
      actor: resolution.actor,
      messageIds: input?.messageIds,
      ticker,
    });
    const response = NextResponse.json(
      { ok: true, data: summary },
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

export async function PUT(
  request: NextRequest,
  context: RouteContext,
) {
  let resolution: Awaited<
    ReturnType<typeof resolveLiveRoomActor>
  > | null = null;
  try {
    assertSameOriginAuthRequest(request);
    const { ticker } = await context.params;
    resolution = await resolveLiveRoomActor(request);
    const heartbeat = await heartbeatLiveRoomPresence(
      resolution.actor,
      ticker,
    );
    const response = NextResponse.json(
      { ok: true, data: heartbeat },
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
