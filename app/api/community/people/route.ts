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
  listCommunityHubPeople,
  setCommunityHubMemberFollow,
} from "@/lib/community-hub/serverRepository";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  let resolution: Awaited<
    ReturnType<typeof resolveLiveRoomActor>
  > | null = null;
  try {
    resolution = await resolveLiveRoomActor(request);
    const data = await listCommunityHubPeople({
      actor: resolution.actor,
      cursor: request.nextUrl.searchParams.get("cursor"),
      filter:
        request.nextUrl.searchParams.get("filter") || "following",
      limit: 30,
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

export async function PUT(request: NextRequest) {
  let resolution: Awaited<
    ReturnType<typeof resolveLiveRoomActor>
  > | null = null;
  try {
    assertSameOriginAuthRequest(request);
    const input = (await request.json().catch(() => null)) as {
      followed?: unknown;
      publicProfileId?: unknown;
    } | null;
    resolution = await resolveLiveRoomActor(request);
    const data = await setCommunityHubMemberFollow({
      actor: resolution.actor,
      followed: input?.followed,
      publicProfileId: input?.publicProfileId,
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
