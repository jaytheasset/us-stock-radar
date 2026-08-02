import "server-only";

import type { NextRequest } from "next/server";
import { AuthError } from "@/lib/auth/supabaseAuth";
import {
  isSameOriginRequest,
  resolveDevelopmentAuthOrigin,
  sanitizeAuthRedirect,
  type AuthCallbackType,
} from "@/lib/auth/authPolicy";
import { getServerEnv } from "@/lib/env";

export function assertSameOriginAuthRequest(request: Request) {
  if (!isSameOriginRequest(request)) {
    throw new AuthError("AUTH_ORIGIN_REJECTED", "Invalid request origin.", 403);
  }
}

export function buildAuthCallbackUrl(
  request: NextRequest,
  type: AuthCallbackType,
  next?: unknown,
) {
  const origin = getTrustedAppOrigin(request);
  const callback = new URL("/auth/callback", origin);
  callback.searchParams.set("type", type);
  callback.searchParams.set(
    "next",
    sanitizeAuthRedirect(
      next,
      type === "recovery" ? "/account/update-password" : "/account",
    ),
  );
  return callback.toString();
}

function getTrustedAppOrigin(request: NextRequest) {
  const configured = getServerEnv().appBaseUrl.trim();

  if (process.env.NODE_ENV === "production") {
    if (!configured) {
      throw new AuthError(
        "APP_BASE_URL_MISSING",
        "APP_BASE_URL is required for authentication.",
        500,
      );
    }

    try {
      return new URL(configured).origin;
    } catch {
      throw new AuthError(
        "APP_BASE_URL_INVALID",
        "APP_BASE_URL is invalid.",
        500,
      );
    }
  }

  return resolveDevelopmentAuthOrigin(
    configured || request.nextUrl.origin,
    process.env.DEV_ALLOWED_ORIGINS,
  );
}
