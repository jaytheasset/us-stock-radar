import "server-only";

import {
  ensureUserBootstrap,
  getSupabaseAuthUser,
  refreshSupabaseSession,
  type SupabaseAuthSession,
  type SupabaseAuthUser,
} from "@/lib/auth/supabaseAuth";

export type ResolvedAuthSession = {
  user: SupabaseAuthUser | null;
  refreshedSession: SupabaseAuthSession | null;
  shouldClearCookies: boolean;
};

export async function resolveAuthSession({
  accessToken,
  refreshToken,
  bootstrap = true,
}: {
  accessToken: string;
  refreshToken: string;
  bootstrap?: boolean;
}): Promise<ResolvedAuthSession> {
  const currentUser = accessToken
    ? await getSupabaseAuthUser(accessToken)
    : null;

  if (currentUser?.id) {
    if (bootstrap) await ensureUserBootstrap(currentUser);
    return {
      user: currentUser,
      refreshedSession: null,
      shouldClearCookies: false,
    };
  }

  if (!refreshToken) {
    return {
      user: null,
      refreshedSession: null,
      shouldClearCookies: Boolean(accessToken),
    };
  }

  try {
    const refreshedSession = await refreshSupabaseSession(refreshToken);
    const refreshedUser = refreshedSession.access_token
      ? await getSupabaseAuthUser(refreshedSession.access_token)
      : null;

    if (!refreshedUser?.id || refreshedUser.id !== refreshedSession.user?.id) {
      return {
        user: null,
        refreshedSession: null,
        shouldClearCookies: true,
      };
    }

    if (bootstrap) await ensureUserBootstrap(refreshedUser);
    return {
      user: refreshedUser,
      refreshedSession,
      shouldClearCookies: false,
    };
  } catch {
    return {
      user: null,
      refreshedSession: null,
      shouldClearCookies: true,
    };
  }
}
