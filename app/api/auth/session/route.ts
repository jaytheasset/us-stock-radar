import { NextRequest, NextResponse } from "next/server";
import {
  AUTH_PRIVATE_HEADERS,
  normalizeAuthCallbackType,
  sanitizeAuthRedirect,
} from "@/lib/auth/authPolicy";
import { assertSameOriginAuthRequest } from "@/lib/auth/authRequest";
import {
  AuthError,
  ensureUserBootstrap,
  getSupabaseAuthUser,
  refreshSupabaseSession,
} from "@/lib/auth/supabaseAuth";
import { setAuthSessionCookies } from "@/lib/auth/sessionCookies";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginAuthRequest(request);
    const body = await request.json().catch(() => null);
    const input = normalizeSessionBody(body);

    const accessUser = await getSupabaseAuthUser(input.accessToken);
    if (!accessUser?.id) {
      throw new AuthError("INVALID_CALLBACK_SESSION", "Invalid session.", 401);
    }

    const refreshed = await refreshSupabaseSession(input.refreshToken);
    if (!refreshed.user?.id || refreshed.user.id !== accessUser.id) {
      throw new AuthError("CALLBACK_SESSION_MISMATCH", "Invalid session.", 401);
    }

    await ensureUserBootstrap(refreshed.user);
    const next = sanitizeAuthRedirect(
      input.next,
      input.type === "recovery" ? "/account/update-password" : "/account",
    );
    const response = NextResponse.json(
      { ok: true, next },
      { headers: AUTH_PRIVATE_HEADERS },
    );
    setAuthSessionCookies(response, {
      accessToken: refreshed.access_token || "",
      refreshToken: refreshed.refresh_token,
      expiresIn: refreshed.expires_in,
    });
    return response;
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: "CALLBACK_FAILED",
        message: "This sign-in link is invalid or has expired.",
      },
      { status: 401, headers: AUTH_PRIVATE_HEADERS },
    );
  }
}

function normalizeSessionBody(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AuthError("INVALID_CALLBACK_BODY", "Invalid callback.", 400);
  }

  const input = body as Record<string, unknown>;
  const accessToken =
    typeof input.accessToken === "string" ? input.accessToken.trim() : "";
  const refreshToken =
    typeof input.refreshToken === "string" ? input.refreshToken.trim() : "";
  const type = normalizeAuthCallbackType(input.type);

  if (
    !type ||
    accessToken.length < 32 ||
    refreshToken.length < 32 ||
    accessToken.length > 10_000 ||
    refreshToken.length > 10_000
  ) {
    throw new AuthError("INVALID_CALLBACK_BODY", "Invalid callback.", 400);
  }

  return {
    accessToken,
    refreshToken,
    type,
    next: input.next,
  };
}
