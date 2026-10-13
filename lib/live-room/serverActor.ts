import "server-only";

import type { NextRequest, NextResponse } from "next/server";
import {
  AUTH_ACCESS_COOKIE,
  AUTH_REFRESH_COOKIE,
  clearAuthSessionCookies,
  setAuthSessionCookies,
} from "@/lib/auth/authCookies";
import { resolveAuthSession } from "@/lib/auth/sessionResolution";
import { supabaseSelect, supabaseUpdate, supabaseUpsert } from "@/lib/supabase";
import {
  createLiveRoomGuestToken,
  hashLiveRoomGuestToken,
  isValidLiveRoomGuestToken,
  LIVE_ROOM_GUEST_COOKIE,
  LIVE_ROOM_GUEST_MAX_AGE_SECONDS,
} from "./guestIdentity";
import {
  LIVE_ROOM_GUEST_LAST_SEEN_INTERVAL_MS,
  shouldRefreshLiveRoomGuestLastSeen,
  LiveRoomPolicyError,
  type LiveRoomActor,
} from "./policy";

type ActorResolution = {
  actor: LiveRoomActor;
  auth: Awaited<ReturnType<typeof resolveAuthSession>>;
  guestCookieToken: string | null;
};

type ExistingActorResolution = Omit<ActorResolution, "actor"> & {
  actor: LiveRoomActor | null;
};

// Header reads must never create a guest or update its last-seen timestamp.
// Keep the initializing resolver below for actual chat entry and mutations.
export async function resolveExistingLiveRoomActor(
  request: NextRequest,
): Promise<ExistingActorResolution> {
  const accessToken = request.cookies.get(AUTH_ACCESS_COOKIE)?.value || "";
  const refreshToken = request.cookies.get(AUTH_REFRESH_COOKIE)?.value || "";
  const auth = await resolveAuthSession({ accessToken, refreshToken, bootstrap: false });
  if (auth.user?.id) {
    return {
      actor: { kind: "member", userId: auth.user.id, email: auth.user.email || null },
      auth,
      guestCookieToken: null,
    };
  }
  // With credentials supplied, an unresolved session that must be retained is
  // an Auth outage, not evidence that the viewer is anonymous.
  if ((accessToken || refreshToken) && !auth.shouldClearCookies) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_AUTH_UNAVAILABLE",
      "Live Room authentication is temporarily unavailable.",
      503,
    );
  }
  const anonymous = { actor: null, auth, guestCookieToken: null };
  const token = request.cookies.get(LIVE_ROOM_GUEST_COOKIE)?.value || "";
  if (!isValidLiveRoomGuestToken(token)) return anonymous;
  const result = await supabaseSelect("live_room_guest_sessions", {
    select: "id",
    token_hash: `eq.${hashLiveRoomGuestToken(token)}`,
    expires_at: `gt.${new Date().toISOString()}`,
    limit: "1",
  });
  if (!result.ok) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_IDENTITY_UNAVAILABLE",
      "The Live Room identity could not be loaded.",
      result.status || 502,
    );
  }
  const guestSessionId = readString(readFirstRow(result.data)?.id);
  return guestSessionId
    ? { actor: { kind: "guest", guestSessionId }, auth, guestCookieToken: null }
    : anonymous;
}

export async function resolveLiveRoomActor(
  request: NextRequest,
): Promise<ActorResolution> {
  const auth = await resolveAuthSession({
    accessToken: request.cookies.get(AUTH_ACCESS_COOKIE)?.value || "",
    refreshToken: request.cookies.get(AUTH_REFRESH_COOKIE)?.value || "",
    bootstrap: false,
  });

  if (auth.user?.id) {
    return {
      actor: {
        kind: "member",
        userId: auth.user.id,
        email: auth.user.email || null,
      },
      auth,
      guestCookieToken: null,
    };
  }

  const suppliedToken =
    request.cookies.get(LIVE_ROOM_GUEST_COOKIE)?.value || "";
  if (isValidLiveRoomGuestToken(suppliedToken)) {
    const tokenHash = hashLiveRoomGuestToken(suppliedToken);
    const now = new Date();
    const result = await supabaseSelect("live_room_guest_sessions", {
      select: "id,last_seen_at",
      token_hash: `eq.${tokenHash}`,
      expires_at: `gt.${now.toISOString()}`,
      limit: "1",
    });
    const row = readFirstRow(result.data);
    const guestSessionId = readString(row?.id);

    if (result.ok && guestSessionId) {
      if (shouldRefreshLiveRoomGuestLastSeen(row?.last_seen_at, now)) {
        await supabaseUpdate(
          "live_room_guest_sessions",
          {
            id: `eq.${guestSessionId}`,
            last_seen_at: `lte.${new Date(
              now.getTime() - LIVE_ROOM_GUEST_LAST_SEEN_INTERVAL_MS,
            ).toISOString()}`,
          },
          { last_seen_at: now.toISOString() },
          { prefer: "return=minimal" },
        );
      }
      return {
        actor: { kind: "guest", guestSessionId },
        auth,
        guestCookieToken: null,
      };
    }
  }

  const guestCookieToken = createLiveRoomGuestToken();
  const created = await supabaseUpsert(
    "live_room_guest_sessions",
    {
      token_hash: hashLiveRoomGuestToken(guestCookieToken),
      expires_at: new Date(
        Date.now() + LIVE_ROOM_GUEST_MAX_AGE_SECONDS * 1_000,
      ).toISOString(),
    },
    { prefer: "return=representation" },
  );
  const row = readFirstRow(created.data);
  const guestSessionId = readString(row?.id);

  if (!created.ok || !guestSessionId) {
    throw new Error(
      created.error || "Could not create a Live Room guest session.",
    );
  }

  return {
    actor: { kind: "guest", guestSessionId },
    auth,
    guestCookieToken,
  };
}

export function applyLiveRoomActorCookies(
  response: NextResponse,
  resolution: ExistingActorResolution,
) {
  if (resolution.auth.refreshedSession?.access_token) {
    setAuthSessionCookies(response, {
      accessToken: resolution.auth.refreshedSession.access_token,
      refreshToken: resolution.auth.refreshedSession.refresh_token,
      expiresIn: resolution.auth.refreshedSession.expires_in,
    });
  } else if (resolution.auth.shouldClearCookies) {
    clearAuthSessionCookies(response);
  }

  if (resolution.guestCookieToken) {
    response.cookies.set(
      LIVE_ROOM_GUEST_COOKIE,
      resolution.guestCookieToken,
      {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: LIVE_ROOM_GUEST_MAX_AGE_SECONDS,
      },
    );
  }
}

function readFirstRow(value: unknown) {
  return Array.isArray(value) && value[0] && typeof value[0] === "object"
    ? (value[0] as Record<string, unknown>)
    : null;
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}
