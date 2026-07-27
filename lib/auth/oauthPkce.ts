import "server-only";

import { createHash, randomBytes } from "node:crypto";
import type { NextResponse } from "next/server.js";

export const AUTH_OAUTH_PKCE_COOKIE = "sr_oauth_pkce_verifier";
export const AUTH_OAUTH_PKCE_MAX_AGE = 60 * 10;

const OAUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

export function createOAuthPkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256")
    .update(verifier, "ascii")
    .digest("base64url");

  return { challenge, verifier };
}

export function setOAuthPkceCookie(
  response: NextResponse,
  verifier: string,
) {
  response.cookies.set(AUTH_OAUTH_PKCE_COOKIE, verifier, {
    ...OAUTH_COOKIE_OPTIONS,
    maxAge: AUTH_OAUTH_PKCE_MAX_AGE,
  });
}

export function clearOAuthPkceCookie(response: NextResponse) {
  response.cookies.set(AUTH_OAUTH_PKCE_COOKIE, "", {
    ...OAUTH_COOKIE_OPTIONS,
    maxAge: 0,
  });
}
