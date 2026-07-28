import { NextRequest, NextResponse } from "next/server";
import { assertSameOriginAuthRequest } from "@/lib/auth/authRequest";
import {
  LIVE_ROOM_PRIVATE_HEADERS,
  liveRoomErrorResponse,
} from "@/lib/live-room/apiResponse";
import {
  createLiveRoomPostComment,
  listLiveRoomPostComments,
} from "@/lib/live-room/postServerRepository";
import {
  applyLiveRoomActorCookies,
  resolveLiveRoomActor,
} from "@/lib/live-room/serverActor";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ postId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  let resolution: Awaited<ReturnType<typeof resolveLiveRoomActor>> | null =
    null;
  try {
    const { postId } = await context.params;
    const search = request.nextUrl.searchParams;
    resolution = await resolveLiveRoomActor(request);
    const page = await listLiveRoomPostComments({
      actor: resolution.actor,
      after: search.get("after"),
      limit: Number(search.get("limit") || 50),
      postId,
    });
    const response = NextResponse.json(
      { ok: true, data: page },
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

export async function POST(request: NextRequest, context: RouteContext) {
  let resolution: Awaited<ReturnType<typeof resolveLiveRoomActor>> | null =
    null;
  try {
    assertSameOriginAuthRequest(request);
    const { postId } = await context.params;
    const input = await request.json().catch(() => null);
    resolution = await resolveLiveRoomActor(request);
    const comment = await createLiveRoomPostComment({
      actor: resolution.actor,
      draft: input,
      postId,
    });
    const response = NextResponse.json(
      { ok: true, data: comment },
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
