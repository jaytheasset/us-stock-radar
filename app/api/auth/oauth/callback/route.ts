import { NextRequest, NextResponse } from "next/server";
import {
  AUTH_PRIVATE_HEADERS,
  sanitizeAuthRedirect,
} from "@/lib/auth/authPolicy";
import { assertSameOriginAuthRequest } from "@/lib/auth/authRequest";
import {
  AUTH_OAUTH_PKCE_COOKIE,
  clearOAuthPkceCookie,
} from "@/lib/auth/oauthPkce";
import {
  AuthError,
  exchangeSupabaseAuthCode,
} from "@/lib/auth/supabaseAuth";
import { setAuthSessionCookies } from "@/lib/auth/sessionCookies";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginAuthRequest(request);
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 403;
    return NextResponse.json(
      {
        ok: false,
        error: "OAUTH_CALLBACK_FAILED",
        message: "Google sign-in could not be completed.",
      },
      { status, headers: AUTH_PRIVATE_HEADERS },
    );
  }

  try {
    const body = await request.json().catch(() => null);
    const { code, next } = normalizeOAuthCallbackBody(body);
    const verifier =
      request.cookies.get(AUTH_OAUTH_PKCE_COOKIE)?.value || "";

    if (
      verifier.length < 43 ||
      verifier.length > 128 ||
      !/^[A-Za-z0-9_-]+$/.test(verifier)
    ) {
      throw new AuthError(
        "OAUTH_VERIFIER_MISSING",
        "OAuth verifier is missing or expired.",
        401,
      );
    }

    const session = await exchangeSupabaseAuthCode(code, verifier);
    const response = NextResponse.json(
      { ok: true, next },
      { headers: AUTH_PRIVATE_HEADERS },
    );
    setAuthSessionCookies(response, {
      accessToken: session.access_token || "",
      refreshToken: session.refresh_token,
      expiresIn: session.expires_in,
    });
    clearOAuthPkceCookie(response);
    return response;
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 401;
    const response = NextResponse.json(
      {
        ok: false,
        error: "OAUTH_CALLBACK_FAILED",
        message: "Google sign-in could not be completed.",
      },
      { status, headers: AUTH_PRIVATE_HEADERS },
    );
    clearOAuthPkceCookie(response);
    return response;
  }
}

function normalizeOAuthCallbackBody(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AuthError("INVALID_OAUTH_CALLBACK", "Invalid callback.", 400);
  }

  const input = body as Record<string, unknown>;
  const code = typeof input.code === "string" ? input.code.trim() : "";

  if (
    code.length < 16 ||
    code.length > 2_048 ||
    /[\u0000-\u001f\u007f]/.test(code)
  ) {
    throw new AuthError("INVALID_OAUTH_CALLBACK", "Invalid callback.", 400);
  }

  return {
    code,
    next: sanitizeAuthRedirect(input.next, "/alerts"),
  };
}
