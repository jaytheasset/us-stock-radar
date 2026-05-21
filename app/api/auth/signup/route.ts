import { NextRequest, NextResponse } from "next/server";
import { AuthError, signUpWithEmail } from "@/lib/auth/supabaseAuth";
import { setAuthSessionCookies } from "@/lib/auth/sessionCookies";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const { email, password } = normalizeAuthBody(body);
    const session = await signUpWithEmail(email, password);

    const response = NextResponse.json(
      {
        ok: true,
        emailConfirmationRequired: !session.access_token,
      },
      { headers: NO_STORE_HEADERS },
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
    return authErrorResponse(error, "SIGNUP_FAILED", "Failed to create account.");
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

function authErrorResponse(error: unknown, fallbackCode: string, fallbackMessage: string) {
  const status = error instanceof AuthError ? error.status : 500;
  return NextResponse.json(
    {
      ok: false,
      error: error instanceof AuthError ? error.code : fallbackCode,
      message: error instanceof Error ? error.message : fallbackMessage,
    },
    { status, headers: NO_STORE_HEADERS },
  );
}
