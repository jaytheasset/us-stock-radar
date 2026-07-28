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
  getLiveRoomMessageChanges,
  getLiveRoomMessagePage,
  sendLiveRoomMessage,
} from "@/lib/live-room/serverRepository";
import { normalizeOptionalLiveRoomReplyMessageId } from "@/lib/live-room/policy";

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
    const changesMode =
      request.nextUrl.searchParams.get("mode") === "changes";
    const page = changesMode
      ? await getLiveRoomMessageChanges({
          actor: resolution.actor,
          slug,
          afterChange:
            request.nextUrl.searchParams.get("changesAfter"),
          limit: Number(
            request.nextUrl.searchParams.get("limit") || 100,
          ),
        })
      : await getLiveRoomMessagePage({
          actor: resolution.actor,
          slug,
          after: request.nextUrl.searchParams.get("after"),
          before: request.nextUrl.searchParams.get("before"),
          limit: Number(
            request.nextUrl.searchParams.get("limit") || 50,
          ),
        });
    const response = NextResponse.json(
      {
        ok: true,
        data: page,
        transport: "realtime-broadcast-with-polling-fallback",
      },
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
      body?: unknown;
      replyToMessageId?: unknown;
    } | null;
    resolution = await resolveLiveRoomActor(request);
    const message = await sendLiveRoomMessage({
      actor: resolution.actor,
      body: typeof input?.body === "string" ? input.body : "",
      eventId: null,
      replyToMessageId: normalizeOptionalLiveRoomReplyMessageId(
        input?.replyToMessageId,
      ),
      slug,
    });
    const response = NextResponse.json(
      { ok: true, data: message },
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
