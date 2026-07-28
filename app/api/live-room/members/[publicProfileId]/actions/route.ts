import { NextRequest, NextResponse } from "next/server";
import { assertSameOriginAuthRequest } from "@/lib/auth/authRequest";
import {
  LIVE_ROOM_PRIVATE_HEADERS,
  liveRoomErrorResponse,
} from "@/lib/live-room/apiResponse";
import {
  getLiveRoomPublicMemberActions,
  updateLiveRoomPublicMemberFollow,
} from "@/lib/live-room/memberActionServerRepository";
import {
  applyLiveRoomActorCookies,
  resolveLiveRoomActor,
} from "@/lib/live-room/serverActor";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ publicProfileId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  let resolution: Awaited<
    ReturnType<typeof resolveLiveRoomActor>
  > | null = null;
  try {
    const { publicProfileId } = await context.params;
    resolution = await resolveLiveRoomActor(request);
    const data = await getLiveRoomPublicMemberActions({
      actor: resolution.actor,
      publicProfileId,
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

export async function PATCH(
  request: NextRequest,
  context: RouteContext,
) {
  let resolution: Awaited<
    ReturnType<typeof resolveLiveRoomActor>
  > | null = null;
  try {
    assertSameOriginAuthRequest(request);
    const { publicProfileId } = await context.params;
    const input = (await request.json().catch(() => null)) as {
      followed?: unknown;
    } | null;
    resolution = await resolveLiveRoomActor(request);
    const data = await updateLiveRoomPublicMemberFollow({
      actor: resolution.actor,
      followed: input?.followed,
      publicProfileId,
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
