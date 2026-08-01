import { NextRequest, NextResponse } from "next/server";
import { assertSameOriginAuthRequest } from "@/lib/auth/authRequest";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import { getLiveRoomPost } from "@/lib/live-room/postServerRepository";
import { resolveLiveRoomActor } from "@/lib/live-room/serverActor";
import { isContentAvailable } from "@/lib/saved/server";
import {
  isSavedContentType,
  isSavedContentUuid,
  type SavedContentType,
} from "@/lib/saved/types";
import { supabaseDelete, supabaseSelect, supabaseUpsert } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
};

type RouteContext = {
  params: Promise<{ contentId: string; contentType: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  const reference = await readReference(context);
  if (!reference) return invalidReferenceResponse();
  const userId = await getOptionalCurrentUserId();
  if (!userId) {
    return NextResponse.json(
      { ok: true, authenticated: false, saved: false },
      { headers: NO_STORE_HEADERS },
    );
  }

  const result = await supabaseSelect("saved_content", {
    select: "id",
    user_id: `eq.${userId}`,
    content_type: `eq.${reference.contentType}`,
    content_id: `eq.${reference.contentId}`,
    limit: "1",
  });
  if (!result.ok) return databaseErrorResponse(result.error);

  return NextResponse.json(
    {
      ok: true,
      authenticated: true,
      saved: Array.isArray(result.data) && result.data.length > 0,
    },
    { headers: NO_STORE_HEADERS },
  );
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    assertSameOriginAuthRequest(request);
  } catch {
    return NextResponse.json(
      { ok: false, error: "SAVED_REQUEST_FORBIDDEN" },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  const reference = await readReference(context);
  if (!reference) return invalidReferenceResponse();
  const userId = await getOptionalCurrentUserId();
  if (!userId) return authenticationRequiredResponse();

  const available = await verifyViewerCanOpenContent(
    request,
    userId,
    reference.contentType,
    reference.contentId,
  );
  if (!available) {
    return NextResponse.json(
      { ok: false, error: "SAVED_CONTENT_UNAVAILABLE" },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }

  const result = await supabaseUpsert(
    "saved_content",
    {
      user_id: userId,
      content_type: reference.contentType,
      content_id: reference.contentId,
    },
    {
      onConflict: "user_id,content_type,content_id",
      prefer: "resolution=ignore-duplicates,return=representation",
    },
  );
  if (!result.ok) return databaseErrorResponse(result.error);

  return NextResponse.json(
    { ok: true, authenticated: true, saved: true },
    { headers: NO_STORE_HEADERS },
  );
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    assertSameOriginAuthRequest(request);
  } catch {
    return NextResponse.json(
      { ok: false, error: "SAVED_REQUEST_FORBIDDEN" },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  const reference = await readReference(context);
  if (!reference) return invalidReferenceResponse();
  const userId = await getOptionalCurrentUserId();
  if (!userId) return authenticationRequiredResponse();

  const result = await supabaseDelete("saved_content", {
    user_id: `eq.${userId}`,
    content_type: `eq.${reference.contentType}`,
    content_id: `eq.${reference.contentId}`,
  });
  if (!result.ok) return databaseErrorResponse(result.error);

  return NextResponse.json(
    { ok: true, authenticated: true, saved: false },
    { headers: NO_STORE_HEADERS },
  );
}

async function readReference(context: RouteContext) {
  const { contentId, contentType } = await context.params;
  if (!isSavedContentType(contentType) || !isSavedContentUuid(contentId)) {
    return null;
  }
  return { contentId: contentId.toLowerCase(), contentType };
}

async function verifyViewerCanOpenContent(
  request: NextRequest,
  userId: string,
  contentType: SavedContentType,
  contentId: string,
) {
  if (contentType !== "live_room_post") {
    return isContentAvailable(contentType, contentId);
  }

  try {
    const resolution = await resolveLiveRoomActor(request);
    if (resolution.actor.kind !== "member" || resolution.actor.userId !== userId) {
      return false;
    }
    await getLiveRoomPost(resolution.actor, contentId);
    return true;
  } catch {
    return false;
  }
}

function invalidReferenceResponse() {
  return NextResponse.json(
    { ok: false, error: "SAVED_INVALID_REFERENCE" },
    { status: 400, headers: NO_STORE_HEADERS },
  );
}

function authenticationRequiredResponse() {
  return NextResponse.json(
    { ok: false, error: "AUTHENTICATION_REQUIRED" },
    { status: 401, headers: NO_STORE_HEADERS },
  );
}

function databaseErrorResponse(message?: string) {
  return NextResponse.json(
    {
      ok: false,
      error: "SAVED_DATABASE_ERROR",
      message: message || "Saved content could not be updated.",
    },
    { status: 502, headers: NO_STORE_HEADERS },
  );
}
