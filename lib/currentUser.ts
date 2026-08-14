import "server-only";

import { getAuthAccessTokenFromCookies } from "@/lib/auth/sessionCookies";
import { ensureUserBootstrap, getSupabaseAuthUser } from "@/lib/auth/supabaseAuth";

export const DEVELOPMENT_USER_ID = "00000000-0000-4000-8000-000000000001";

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function getOptionalCurrentUserId() {
  const authUser = await getOptionalCurrentAuthUser();

  if (authUser?.id) {
    await ensureUserBootstrap(authUser);
    return authUser.id;
  }

  return null;
}

/** Authenticated identity read without profile/preferences bootstrap writes. */
export async function getOptionalCurrentUserIdReadOnly() {
  const authUser = await getOptionalCurrentAuthUser();
  return authUser?.id || null;
}

async function getOptionalCurrentAuthUser() {
  const accessToken = await getAuthAccessTokenFromCookies();
  const authUser = accessToken ? await getSupabaseAuthUser(accessToken) : null;

  if (authUser?.id && isUuid(authUser.id)) {
    return authUser;
  }

  return null;
}

export function getDevFallbackUserId() {
  if (process.env.NODE_ENV === "production") return null;
  if ((process.env.ALLOW_DEV_FALLBACK_USER || "false").toLowerCase() !== "true") return null;

  const configuredUserId = process.env.DEV_USER_ID?.trim();

  if (configuredUserId && isUuid(configuredUserId)) {
    return configuredUserId;
  }

  // Development fallback only. Never use this path in production.
  return DEVELOPMENT_USER_ID;
}

export async function getCurrentUserId() {
  const userId = await getOptionalCurrentUserId();
  if (userId) return userId;

  const fallbackUserId = getDevFallbackUserId();
  if (fallbackUserId) return fallbackUserId;

  throw new Error("Authentication required.");
}
