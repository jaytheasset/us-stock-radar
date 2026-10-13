import { NextRequest, NextResponse } from "next/server";
import {
  AUTH_ACCESS_COOKIE,
  AUTH_REFRESH_COOKIE,
} from "@/lib/auth/authCookies";
import {
  LIVE_ROOM_PRIVATE_HEADERS,
  liveRoomErrorResponse,
} from "@/lib/live-room/apiResponse";
import { LIVE_ROOM_GUEST_COOKIE } from "@/lib/live-room/guestIdentity";
import {
  applyLiveRoomActorCookies,
  resolveExistingLiveRoomActor,
} from "@/lib/live-room/serverActor";
import { getLiveRoomUnreadSummary } from "@/lib/live-room/serverRepository";
import type { LiveRoomUnreadSummary } from "@/lib/live-room/types";

export const dynamic = "force-dynamic";

const emptySummary: LiveRoomUnreadSummary = {
  activity: [],
  activityUnreadCount: 0,
  followedPeople: [],
  hasMemberFollows: false,
  isAuthenticated: false,
  people: [],
  peopleUnreadCount: 0,
  rooms: [],
  totalUnreadCount: 0,
};

export async function GET(request: NextRequest) {
  let resolution: Awaited<
    ReturnType<typeof resolveExistingLiveRoomActor>
  > | null = null;
  try {
    const hasExistingIdentity =
      request.cookies.has(AUTH_ACCESS_COOKIE) ||
      request.cookies.has(AUTH_REFRESH_COOKIE) ||
      request.cookies.has(LIVE_ROOM_GUEST_COOKIE);
    if (!hasExistingIdentity) {
      return NextResponse.json(
        { ok: true, data: emptySummary },
        { headers: LIVE_ROOM_PRIVATE_HEADERS },
      );
    }

    resolution = await resolveExistingLiveRoomActor(request);
    const summary = resolution.actor
      ? await getLiveRoomUnreadSummary(resolution.actor)
      : emptySummary;
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
