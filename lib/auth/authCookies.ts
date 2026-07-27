import type { NextResponse } from "next/server.js";

export const AUTH_ACCESS_COOKIE = "sr_access_token";
export const AUTH_REFRESH_COOKIE = "sr_refresh_token";
export const AUTH_REFRESH_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

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

export function setAuthSessionCookies(response: NextResponse, session: AuthCookieSession) {
  const maxAge = Math.max(60, Number(session.expiresIn || 3600));

  response.cookies.set(AUTH_ACCESS_COOKIE, session.accessToken, {
    ...COOKIE_OPTIONS,
    maxAge,
  });

  if (session.refreshToken) {
    response.cookies.set(AUTH_REFRESH_COOKIE, session.refreshToken, {
      ...COOKIE_OPTIONS,
      maxAge: AUTH_REFRESH_COOKIE_MAX_AGE,
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
