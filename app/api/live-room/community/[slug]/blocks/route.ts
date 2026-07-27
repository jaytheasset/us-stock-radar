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
  blockLiveRoomMessageAuthor,
  listLiveRoomBlocks,
} from "@/lib/live-room/serverRepository";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ slug: string }> };

export async function GET(request: NextRequest) {
  let resolution: Awaited<
    ReturnType<typeof resolveLiveRoomActor>
  > | null = null;
  try {
    resolution = await resolveLiveRoomActor(request);
    const blocks = await listLiveRoomBlocks(resolution.actor);
    const response = NextResponse.json(
      { ok: true, data: blocks },
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

export async function POST(
  request: NextRequest,
  context: RouteContext,
) {
  let resolution: Awaited<
    ReturnType<typeof resolveLiveRoomActor>
  > | null = null;
  try {
    assertSameOriginAuthRequest(request);
    const { slug } = await context.params;
    const input = (await request.json().catch(() => null)) as {
      messageId?: unknown;
    } | null;
    resolution = await resolveLiveRoomActor(request);
    const result = await blockLiveRoomMessageAuthor({
      actor: resolution.actor,
      messageId: input?.messageId,
      slug,
    });
    const response = NextResponse.json(
      { ok: true, data: result },
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
