import { NextRequest, NextResponse } from "next/server";
import { AUTH_PRIVATE_HEADERS } from "@/lib/auth/authPolicy";
import { assertSameOriginAuthRequest } from "@/lib/auth/authRequest";
import { getResolvedAuthSessionState } from "@/lib/auth/authFailure";
import {
  clearAuthSessionCookies,
  getAuthTokensFromCookies,
  setAuthSessionCookies,
} from "@/lib/auth/sessionCookies";
import { resolveAuthSession } from "@/lib/auth/sessionResolution";
import { updateSupabasePassword } from "@/lib/auth/supabaseAuth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginAuthRequest(request);
    const body = await request.json().catch(() => null);
    const password = readPassword(body);
    const tokens = await getAuthTokensFromCookies();
    const resolved = await resolveAuthSession(tokens);
    const authSessionState = getResolvedAuthSessionState({
      hasUser: Boolean(resolved.user),
      shouldClearCookies: resolved.shouldClearCookies,
    });

    if (authSessionState === "invalid") {
      const response = errorResponse(
        401,
        "AUTH_REQUIRED",
        "Open a fresh password reset link and try again.",
      );
      clearAuthSessionCookies(response);
      return response;
    }

    if (authSessionState === "unavailable") {
      return errorResponse(
        503,
        "AUTH_TEMPORARILY_UNAVAILABLE",
        "Authentication is temporarily unavailable. Please try again.",
      );
    }

    const accessToken =
      resolved.refreshedSession?.access_token || tokens.accessToken;
    await updateSupabasePassword(accessToken, password);

    const response = NextResponse.json(
      {
        ok: true,
        message: "Your password has been updated.",
      },
      { headers: AUTH_PRIVATE_HEADERS },
    );

    if (resolved.refreshedSession?.access_token) {
      setAuthSessionCookies(response, {
        accessToken: resolved.refreshedSession.access_token,
        refreshToken: resolved.refreshedSession.refresh_token,
        expiresIn: resolved.refreshedSession.expires_in,
      });
    }

    return response;
  } catch (error) {
    const message =
      error instanceof Error && error.message === "WEAK_PASSWORD"
        ? "Password must be at least 8 characters."
        : "Could not update your password. Request a new reset link and try again.";
    return errorResponse(400, "PASSWORD_UPDATE_FAILED", message);
  }
}

function readPassword(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("WEAK_PASSWORD");
  }
  const password = (body as Record<string, unknown>).password;
  if (typeof password !== "string" || password.length < 8 || password.length > 256) {
    throw new Error("WEAK_PASSWORD");
  }
  return password;
}

function errorResponse(status: number, error: string, message: string) {
  return NextResponse.json(
    { ok: false, error, message },
    { status, headers: AUTH_PRIVATE_HEADERS },
  );
}
