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
    const status = error instanceof AuthError ? error.status : 500;
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof AuthError ? error.code : "LOGIN_FAILED",
        message: error instanceof Error ? error.message : "Failed to log in.",
      },
      { status, headers: NO_STORE_HEADERS },
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
