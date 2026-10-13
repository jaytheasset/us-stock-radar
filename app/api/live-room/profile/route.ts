import { NextRequest, NextResponse } from "next/server";
import { assertSameOriginAuthRequest } from "@/lib/auth/authRequest";
import {
  LIVE_ROOM_PRIVATE_HEADERS,
  liveRoomErrorResponse,
} from "@/lib/live-room/apiResponse";
import {
  applyLiveRoomActorCookies,
  resolveLiveRoomActor,
  resolveExistingLiveRoomActor,
} from "@/lib/live-room/serverActor";
import {
  getLiveRoomProfile,
  getExistingLiveRoomAccountProfile,
  updateLiveRoomProfile,
} from "@/lib/live-room/serverRepository";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  let resolution: Awaited<
    ReturnType<typeof resolveExistingLiveRoomActor>
  > | null = null;
  try {
    if (request.nextUrl.searchParams.get("view") === "account") {
      resolution = await resolveExistingLiveRoomActor(request);
      const profile = await getExistingLiveRoomAccountProfile(resolution.actor);
      const response = NextResponse.json(
        { ok: true, data: profile },
        { headers: LIVE_ROOM_PRIVATE_HEADERS },
      );
      applyLiveRoomActorCookies(response, resolution);
      return response;
    }
    const entryResolution = await resolveLiveRoomActor(request);
    resolution = entryResolution;
    const profile = await getLiveRoomProfile(entryResolution.actor);
    const response = NextResponse.json(
      { ok: true, data: profile },
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
    const profile = await updateLiveRoomProfile(
      resolution.actor,
      input,
    );
    const response = NextResponse.json(
      { ok: true, data: profile },
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
