import { NextRequest, NextResponse } from "next/server";
import { assertSameOriginAuthRequest } from "@/lib/auth/authRequest";
import {
  LIVE_ROOM_PRIVATE_HEADERS,
  liveRoomErrorResponse,
} from "@/lib/live-room/apiResponse";
import {
  createCommunityRoom,
  listCommunityRooms,
} from "@/lib/live-room/communityServerRepository";
import {
  applyLiveRoomActorCookies,
  resolveLiveRoomActor,
} from "@/lib/live-room/serverActor";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const page = await listCommunityRooms({
      cursor: request.nextUrl.searchParams.get("cursor"),
      focusTag: request.nextUrl.searchParams.get("tag"),
      industry: request.nextUrl.searchParams.get("industry"),
      language: request.nextUrl.searchParams.get("language"),
      roomStyle: request.nextUrl.searchParams.get("style"),
      search: request.nextUrl.searchParams.get("q"),
      sort: request.nextUrl.searchParams.get("sort"),
      topic: request.nextUrl.searchParams.get("topic"),
      theme: request.nextUrl.searchParams.get("theme"),
    });
    return NextResponse.json(
      { ok: true, data: page },
      { headers: LIVE_ROOM_PRIVATE_HEADERS },
    );
  } catch (error) {
    return liveRoomErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  let resolution: Awaited<
    ReturnType<typeof resolveLiveRoomActor>
  > | null = null;
  try {
    assertSameOriginAuthRequest(request);
    resolution = await resolveLiveRoomActor(request);
    const room = await createCommunityRoom(
      resolution.actor,
      await request.json().catch(() => null),
    );
    const response = NextResponse.json(
      { ok: true, data: room },
      { status: 201, headers: LIVE_ROOM_PRIVATE_HEADERS },
    );
    applyLiveRoomActorCookies(response, resolution);
    return response;
  } catch (error) {
    const response = liveRoomErrorResponse(error);
    if (resolution) applyLiveRoomActorCookies(response, resolution);
    return response;
  }
}
