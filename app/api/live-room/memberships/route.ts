import { NextRequest, NextResponse } from "next/server";
import {
  LIVE_ROOM_PRIVATE_HEADERS,
  liveRoomErrorResponse,
} from "@/lib/live-room/apiResponse";
import { listLiveRoomMemberships } from "@/lib/live-room/serverRepository";
import {
  applyLiveRoomActorCookies,
  resolveLiveRoomActor,
} from "@/lib/live-room/serverActor";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  let resolution: Awaited<ReturnType<typeof resolveLiveRoomActor>> | null =
    null;
  try {
    resolution = await resolveLiveRoomActor(request);
    const data = await listLiveRoomMemberships(
      resolution.actor,
      request.nextUrl.searchParams.get("limit"),
    );
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
