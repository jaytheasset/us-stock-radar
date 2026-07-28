import { NextRequest, NextResponse } from "next/server";
import { assertSameOriginAuthRequest } from "@/lib/auth/authRequest";
import {
  LIVE_ROOM_PRIVATE_HEADERS,
  liveRoomErrorResponse,
} from "@/lib/live-room/apiResponse";
import {
  createLiveRoomPost,
  listLiveRoomPosts,
} from "@/lib/live-room/postServerRepository";
import {
  applyLiveRoomActorCookies,
  resolveLiveRoomActor,
} from "@/lib/live-room/serverActor";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ ticker: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  let resolution: Awaited<ReturnType<typeof resolveLiveRoomActor>> | null =
    null;
  try {
    const { ticker } = await context.params;
    resolution = await resolveLiveRoomActor(request);
    const page = await listLiveRoomPosts({
      actor: resolution.actor,
      before: request.nextUrl.searchParams.get("before"),
      limit: Number(request.nextUrl.searchParams.get("limit") || 20),
      ticker,
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
    const { ticker } = await context.params;
    const input = await request.json().catch(() => null);
    resolution = await resolveLiveRoomActor(request);
    const post = await createLiveRoomPost({
      actor: resolution.actor,
      draft: input,
      ticker,
    });
    const response = NextResponse.json(
      { ok: true, data: post },
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
