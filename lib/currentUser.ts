import "server-only";

import { getAuthAccessTokenFromCookies } from "@/lib/auth/sessionCookies";
import { ensureUserBootstrap, getSupabaseAuthUser } from "@/lib/auth/supabaseAuth";

export const DEVELOPMENT_USER_ID = "00000000-0000-4000-8000-000000000001";

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function getCurrentUserId() {
  const accessToken = await getAuthAccessTokenFromCookies();
  const authUser = accessToken ? await getSupabaseAuthUser(accessToken) : null;

  if (authUser?.id && isUuid(authUser.id)) {
    await ensureUserBootstrap(authUser);
    return authUser.id;
  }

  const configuredUserId = process.env.DEV_USER_ID?.trim();

  if (configuredUserId && isUuid(configuredUserId)) {
    return configuredUserId;
  }

  // Development fallback only. Replace this helper with Supabase Auth session lookup later.
  return DEVELOPMENT_USER_ID;
}
