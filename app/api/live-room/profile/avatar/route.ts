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
  LIVE_ROOM_AVATAR_MAX_INPUT_BYTES,
} from "@/lib/live-room/profileAvatarImage";
import {
  removeLiveRoomProfileAvatar,
  updateLiveRoomProfileAvatar,
} from "@/lib/live-room/serverRepository";
import { LiveRoomPolicyError } from "@/lib/live-room/policy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let resolution: Awaited<
    ReturnType<typeof resolveLiveRoomActor>
  > | null = null;
  try {
    assertSameOriginAuthRequest(request);
    resolution = await resolveLiveRoomActor(request);
    const form = await request.formData();
    const photo = form.get("photo");
    if (!(photo instanceof File)) {
      throw new LiveRoomPolicyError(
        "LIVE_ROOM_AVATAR_REQUIRED",
        "Choose a profile photo to upload.",
        400,
      );
    }
    if (photo.size > LIVE_ROOM_AVATAR_MAX_INPUT_BYTES) {
      throw new LiveRoomPolicyError(
        "LIVE_ROOM_AVATAR_TOO_LARGE",
        "Profile photos can be up to 5 MB.",
        413,
      );
    }
    const profile = await updateLiveRoomProfileAvatar(
      resolution.actor,
      {
        bytes: new Uint8Array(await photo.arrayBuffer()),
        declaredMimeType: photo.type,
      },
    );
    const response = NextResponse.json(
      { ok: true, data: profile },
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

export async function DELETE(request: NextRequest) {
  let resolution: Awaited<
    ReturnType<typeof resolveLiveRoomActor>
  > | null = null;
  try {
    assertSameOriginAuthRequest(request);
    resolution = await resolveLiveRoomActor(request);
    const profile = await removeLiveRoomProfileAvatar(
      resolution.actor,
    );
    const response = NextResponse.json(
      { ok: true, data: profile },
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
