import { NextResponse } from "next/server";
import {
  clearAuthSessionCookies,
  getAuthTokensFromCookies,
  setAuthSessionCookies,
} from "@/lib/auth/sessionCookies";
import { AUTH_PRIVATE_HEADERS } from "@/lib/auth/authPolicy";
import { resolveAuthSession } from "@/lib/auth/sessionResolution";

export const dynamic = "force-dynamic";

export async function GET() {
  const tokens = await getAuthTokensFromCookies();
  const resolved = await resolveAuthSession(tokens);

  const response = NextResponse.json(
    {
      ok: true,
      user: resolved.user
        ? {
            id: resolved.user.id,
            email: resolved.user.email || null,
            emailConfirmed: Boolean(
              resolved.user.email_confirmed_at || resolved.user.confirmed_at,
            ),
          }
        : null,
    },
    { headers: AUTH_PRIVATE_HEADERS },
  );

  if (resolved.refreshedSession?.access_token) {
    setAuthSessionCookies(response, {
      accessToken: resolved.refreshedSession.access_token,
      refreshToken: resolved.refreshedSession.refresh_token,
      expiresIn: resolved.refreshedSession.expires_in,
    });
  } else if (resolved.shouldClearCookies) {
    clearAuthSessionCookies(response);
  }

  return response;
}
