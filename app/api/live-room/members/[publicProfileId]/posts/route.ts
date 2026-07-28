import { NextRequest, NextResponse } from "next/server";
import {
  LIVE_ROOM_PRIVATE_HEADERS,
  liveRoomErrorResponse,
} from "@/lib/live-room/apiResponse";
import { listPublicMemberPosts } from "@/lib/live-room/postServerRepository";
import {
  applyLiveRoomActorCookies,
  resolveLiveRoomActor,
} from "@/lib/live-room/serverActor";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ publicProfileId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  let resolution: Awaited<ReturnType<typeof resolveLiveRoomActor>> | null =
    null;
  try {
    const { publicProfileId } = await context.params;
    resolution = await resolveLiveRoomActor(request);
    const page = await listPublicMemberPosts({
      actor: resolution.actor,
      before: request.nextUrl.searchParams.get("before"),
      limit: Number(request.nextUrl.searchParams.get("limit") || 20),
      publicProfileId,
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
