import { NextRequest, NextResponse } from "next/server";
import { assertSameOriginAuthRequest } from "@/lib/auth/authRequest";
import {
  LIVE_ROOM_PRIVATE_HEADERS,
  liveRoomErrorResponse,
} from "@/lib/live-room/apiResponse";
import {
  getLiveRoomMembership,
  updateLiveRoomMembership,
} from "@/lib/live-room/serverRepository";
import {
  applyLiveRoomActorCookies,
  resolveLiveRoomActor,
} from "@/lib/live-room/serverActor";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ slug: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  let resolution: Awaited<ReturnType<typeof resolveLiveRoomActor>> | null =
    null;
  try {
    const { slug } = await context.params;
    resolution = await resolveLiveRoomActor(request);
    const data = await getLiveRoomMembership({
      actor: resolution.actor,
      slug,
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

export async function PUT(request: NextRequest, context: RouteContext) {
  let resolution: Awaited<ReturnType<typeof resolveLiveRoomActor>> | null =
    null;
  try {
    assertSameOriginAuthRequest(request);
    const { slug } = await context.params;
    resolution = await resolveLiveRoomActor(request);
    const data = await updateLiveRoomMembership({
      actor: resolution.actor,
      joined: true,
      slug,
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

export async function DELETE(
  request: NextRequest,
  context: RouteContext,
) {
  let resolution: Awaited<ReturnType<typeof resolveLiveRoomActor>> | null =
    null;
  try {
    assertSameOriginAuthRequest(request);
    const { slug } = await context.params;
    resolution = await resolveLiveRoomActor(request);
    const data = await updateLiveRoomMembership({
      actor: resolution.actor,
      joined: false,
      slug,
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
