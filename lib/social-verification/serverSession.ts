import "server-only";

import type { NextRequest, NextResponse } from "next/server";
import {
  AUTH_ACCESS_COOKIE,
  AUTH_REFRESH_COOKIE,
  clearAuthSessionCookies,
  setAuthSessionCookies,
} from "@/lib/auth/authCookies";
import { resolveAuthSession } from "@/lib/auth/sessionResolution";
import { SocialVerificationError } from "./policy";

export async function resolveSocialMember(request: NextRequest) {
  const auth = await resolveAuthSession({
    accessToken: request.cookies.get(AUTH_ACCESS_COOKIE)?.value || "",
    refreshToken: request.cookies.get(AUTH_REFRESH_COOKIE)?.value || "",
  });
  if (!auth.user?.id) {
    throw new SocialVerificationError(
      "SOCIAL_VERIFICATION_MEMBER_REQUIRED",
      "Sign in to verify a social account.",
      401,
    );
  }
  return { auth, userId: auth.user.id };
}

export function applySocialAuthCookies(
  response: NextResponse,
  resolution: Awaited<ReturnType<typeof resolveSocialMember>>,
) {
  if (resolution.auth.refreshedSession?.access_token) {
    setAuthSessionCookies(response, {
      accessToken: resolution.auth.refreshedSession.access_token,
      refreshToken: resolution.auth.refreshedSession.refresh_token,
      expiresIn: resolution.auth.refreshedSession.expires_in,
    });
  } else if (resolution.auth.shouldClearCookies) {
    clearAuthSessionCookies(response);
  }
}
