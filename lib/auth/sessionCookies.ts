import "server-only";

import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

export const AUTH_ACCESS_COOKIE = "sr_access_token";
export const AUTH_REFRESH_COOKIE = "sr_refresh_token";

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

export type AuthCookieSession = {
  accessToken: string;
  refreshToken?: string | null;
  expiresIn?: number | null;
};

export async function getAuthAccessTokenFromCookies() {
  const store = await cookies();
  return store.get(AUTH_ACCESS_COOKIE)?.value || "";
}

export function setAuthSessionCookies(response: NextResponse, session: AuthCookieSession) {
  const maxAge = Math.max(60, Math.min(Number(session.expiresIn || 3600), 60 * 60 * 24 * 7));

  response.cookies.set(AUTH_ACCESS_COOKIE, session.accessToken, {
    ...COOKIE_OPTIONS,
    maxAge,
  });

  if (session.refreshToken) {
    response.cookies.set(AUTH_REFRESH_COOKIE, session.refreshToken, {
      ...COOKIE_OPTIONS,
      maxAge: 60 * 60 * 24 * 30,
    });
  }
}

export function clearAuthSessionCookies(response: NextResponse) {
  response.cookies.set(AUTH_ACCESS_COOKIE, "", {
    ...COOKIE_OPTIONS,
    maxAge: 0,
  });
  response.cookies.set(AUTH_REFRESH_COOKIE, "", {
    ...COOKIE_OPTIONS,
    maxAge: 0,
  });
}
