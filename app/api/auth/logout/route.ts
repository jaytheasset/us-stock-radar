import { NextRequest, NextResponse } from "next/server";
import {
  clearAuthSessionCookies,
  getAuthTokensFromCookies,
} from "@/lib/auth/sessionCookies";
import { AUTH_PRIVATE_HEADERS } from "@/lib/auth/authPolicy";
import { assertSameOriginAuthRequest } from "@/lib/auth/authRequest";
import { revokeSupabaseSession } from "@/lib/auth/supabaseAuth";
import { resolveAuthSession } from "@/lib/auth/sessionResolution";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginAuthRequest(request);
  } catch {
    return NextResponse.json(
      { error: "INVALID_REQUEST" },
      { status: 403, headers: AUTH_PRIVATE_HEADERS },
    );
  }

  const response = NextResponse.json(
    { ok: true },
    { headers: AUTH_PRIVATE_HEADERS },
  );

  try {
    const tokens = await getAuthTokensFromCookies();
    const resolved = await resolveAuthSession({
      ...tokens,
      bootstrap: false,
    });
    const accessToken =
      resolved.refreshedSession?.access_token || tokens.accessToken;
    if (resolved.user && accessToken) {
      await revokeSupabaseSession(accessToken);
    }
  } catch {
    // Local sign-out must succeed even when the remote session is already gone.
  }

  clearAuthSessionCookies(response);
  return response;
}
