import { NextRequest, NextResponse } from "next/server";
import { AuthError, signInWithEmail } from "@/lib/auth/supabaseAuth";
import { setAuthSessionCookies } from "@/lib/auth/sessionCookies";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const { email, password } = normalizeAuthBody(body);
    const session = await signInWithEmail(email, password);

    const response = NextResponse.json(
      {
        ok: true,
      },
      { headers: NO_STORE_HEADERS },
    );

    setAuthSessionCookies(response, {
      accessToken: session.access_token || "",
      refreshToken: session.refresh_token,
      expiresIn: session.expires_in,
    });

    return response;
  } catch (error) {
    const normalized = normalizeLoginError(error);
    return NextResponse.json(
      {
        ok: false,
        error: normalized.code,
        message: normalized.message,
      },
      { status: normalized.status, headers: NO_STORE_HEADERS },
    );
  }
}

function normalizeAuthBody(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AuthError("INVALID_AUTH_BODY", "Email and password are required.", 400);
  }

  const input = body as Record<string, unknown>;
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const password = typeof input.password === "string" ? input.password : "";

  if (!email || !password) {
    throw new AuthError("INVALID_AUTH_BODY", "Email and password are required.", 400);
  }

  return { email, password };
}

function normalizeLoginError(error: unknown) {
  if (error instanceof AuthError) {
    if (error.code === "INVALID_AUTH_BODY") {
      return {
        status: error.status,
        code: error.code,
        message: error.message,
      };
    }

    if (isRateLimited(error)) {
      return {
        status: 429,
        code: "LOGIN_RATE_LIMITED",
        message: "Too many login attempts. Please wait a few minutes and try again.",
      };
    }

    if (isEmailUnconfirmed(error)) {
      return {
        status: 403,
        code: "EMAIL_NOT_CONFIRMED",
        message: "Please confirm your email before logging in.",
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
      status: error.status >= 500 ? 502 : 401,
      code: "LOGIN_FAILED",
      message: "Email or password is incorrect.",
    };
  }

  return {
    status: 500,
    code: "LOGIN_FAILED",
    message: "Failed to log in.",
  };
}

function isRateLimited(error: AuthError) {
  const message = error.message.toLowerCase();
  return error.status === 429 || message.includes("rate limit") || message.includes("too many");
}

function isEmailUnconfirmed(error: AuthError) {
  const message = error.message.toLowerCase();
  return message.includes("email not confirmed") || message.includes("not confirmed") || message.includes("confirm your email");
}
