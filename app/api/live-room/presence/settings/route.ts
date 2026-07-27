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
  getLiveRoomPresenceSetting,
  updateLiveRoomPresenceSetting,
} from "@/lib/live-room/serverRepository";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  let resolution: Awaited<
    ReturnType<typeof resolveLiveRoomActor>
  > | null = null;
  try {
    resolution = await resolveLiveRoomActor(request);
    const setting = await getLiveRoomPresenceSetting(resolution.actor);
    const response = NextResponse.json(
      { ok: true, data: setting },
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

export async function PUT(request: NextRequest) {
  let resolution: Awaited<
    ReturnType<typeof resolveLiveRoomActor>
  > | null = null;
  try {
    assertSameOriginAuthRequest(request);
    const input = await request.json().catch(() => null);
    resolution = await resolveLiveRoomActor(request);
    const setting = await updateLiveRoomPresenceSetting(
      resolution.actor,
      input,
    );
    const response = NextResponse.json(
      { ok: true, data: setting },
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
