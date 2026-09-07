import { NextRequest, NextResponse } from "next/server";
import {
  AUTH_PRIVATE_HEADERS,
  buildGoogleOAuthAuthorizeUrl,
  buildGoogleOAuthCallbackUrl,
  sanitizeAuthRedirect,
} from "@/lib/auth/authPolicy";
import { assertSameOriginAuthRequest } from "@/lib/auth/authRequest";
import {
  createOAuthPkcePair,
  setOAuthPkceCookie,
} from "@/lib/auth/oauthPkce";
import { AuthError } from "@/lib/auth/supabaseAuth";
import { getServerEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginAuthRequest(request);
    const body = await request.json().catch(() => null);
    const next = sanitizeAuthRedirect(readNext(body), "/alerts");
    const env = getServerEnv();

    if (!env.supabaseUrl || !env.supabasePublishableKey) {
      throw new AuthError(
        "SUPABASE_AUTH_ENV_MISSING",
        "Authentication is not configured.",
        500,
      );
    }

    const { challenge, verifier } = createOAuthPkcePair();
    const redirectTo = buildGoogleOAuthCallbackUrl({
      devAllowedOrigins: process.env.DEV_ALLOWED_ORIGINS,
      localOrigin: env.appBaseUrl || request.nextUrl.origin,
      next,
      production: process.env.NODE_ENV === "production",
    });
    const url = buildGoogleOAuthAuthorizeUrl({
      codeChallenge: challenge,
      redirectTo,
      supabaseUrl: env.supabaseUrl,
    });
    const response = NextResponse.json(
      { ok: true, url },
      { headers: AUTH_PRIVATE_HEADERS },
    );
    setOAuthPkceCookie(response, verifier);
    return response;
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 500;
    return NextResponse.json(
      {
        ok: false,
        error: "OAUTH_START_FAILED",
        message: "Google sign-in is temporarily unavailable.",
      },
      { status, headers: AUTH_PRIVATE_HEADERS },
    );
  }
}

function readNext(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  return (body as Record<string, unknown>).next;
}
