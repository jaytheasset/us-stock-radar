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
  listHiddenLiveRoomMessages,
  moderateLiveRoomMessage,
} from "@/lib/live-room/serverRepository";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ slug: string }> };

export async function GET(
  request: NextRequest,
  context: RouteContext,
) {
  let resolution: Awaited<
    ReturnType<typeof resolveLiveRoomActor>
  > | null = null;
  try {
    const { slug } = await context.params;
    resolution = await resolveLiveRoomActor(request);
    const messages = await listHiddenLiveRoomMessages(
      resolution.actor,
      { slug },
    );
    const response = NextResponse.json(
      { ok: true, data: messages },
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
      action?: unknown;
      messageId?: unknown;
      reason?: unknown;
    } | null;
    resolution = await resolveLiveRoomActor(request);
    const result = await moderateLiveRoomMessage({
      action: input?.action,
      actor: resolution.actor,
      messageId: input?.messageId,
      reason: input?.reason,
      slug,
    });
    const response = NextResponse.json(
      { ok: true, data: result },
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
