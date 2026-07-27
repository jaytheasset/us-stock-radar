import { NextRequest, NextResponse } from "next/server";
import {
  AuthError,
  ensureUserBootstrap,
  signUpWithEmail,
} from "@/lib/auth/supabaseAuth";
import { setAuthSessionCookies } from "@/lib/auth/sessionCookies";
import { AUTH_PRIVATE_HEADERS } from "@/lib/auth/authPolicy";
import {
  assertSameOriginAuthRequest,
  buildAuthCallbackUrl,
} from "@/lib/auth/authRequest";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginAuthRequest(request);
    const body = await request.json().catch(() => null);
    const { email, password } = normalizeAuthBody(body);
    const callbackUrl = buildAuthCallbackUrl(request, "signup", "/account");
    const session = await signUpWithEmail(email, password, callbackUrl);
    if (session.access_token && session.user?.id) {
      await ensureUserBootstrap(session.user);
    }

    const response = NextResponse.json(
      {
        ok: true,
        emailConfirmationRequired: !session.access_token,
      },
      { headers: AUTH_PRIVATE_HEADERS },
    );

    if (session.access_token) {
      setAuthSessionCookies(response, {
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
        expiresIn: session.expires_in,
      });
    }

    return response;
  } catch (error) {
    return signupErrorResponse(error);
  }
}

function normalizeAuthBody(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AuthError("INVALID_AUTH_BODY", "Email and password are required.", 400);
  }

  const input = body as Record<string, unknown>;
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const password = typeof input.password === "string" ? input.password : "";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AuthError("INVALID_EMAIL", "Enter a valid email address.", 400);
  }
  if (password.length < 8) {
    throw new AuthError("WEAK_PASSWORD", "Password must be at least 8 characters.", 400);
  }

  return { email, password };
}

function signupErrorResponse(error: unknown) {
  const normalized = normalizeSignupError(error);
  return NextResponse.json(
    {
      ok: false,
      error: normalized.code,
      message: normalized.message,
    },
    { status: normalized.status, headers: AUTH_PRIVATE_HEADERS },
  );
}

function normalizeSignupError(error: unknown) {
  if (error instanceof AuthError) {
    if (error.code === "INVALID_AUTH_BODY" || error.code === "INVALID_EMAIL" || error.code === "WEAK_PASSWORD") {
      return {
        status: error.status,
        code: error.code,
        message: error.message,
      };
    }

    if (isRateLimited(error)) {
      return {
        status: 429,
        code: "SIGNUP_RATE_LIMITED",
        message: "Too many signup attempts. Please wait a few minutes and try again.",
      };
    }

    if (error.code === "SUPABASE_ANON_KEY_MISSING" || error.code === "SUPABASE_URL_MISSING") {
      return {
        status: 500,
        code: "AUTH_CONFIG_ERROR",
        message: "Authentication is not configured correctly.",
      };
    }

    return {
      status: error.status >= 500 ? 502 : error.status,
      code: "SIGNUP_FAILED",
      message: "Could not create account. Please check your email and password and try again.",
    };
  }

  return {
    status: 500,
    code: "SIGNUP_FAILED",
    message: "Failed to create account.",
  };
}

function isRateLimited(error: AuthError) {
  const message = error.message.toLowerCase();
  return error.status === 429 || message.includes("rate limit") || message.includes("too many");
}
