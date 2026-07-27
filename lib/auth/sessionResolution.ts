import "server-only";

import {
  ensureUserBootstrap,
  getSupabaseAuthUserStrict,
  refreshSupabaseSession,
  type SupabaseAuthSession,
  type SupabaseAuthUser,
} from "@/lib/auth/supabaseAuth";
import { shouldClearAuthSessionForError } from "@/lib/auth/authFailure";

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
  let currentUser: SupabaseAuthUser | null = null;
  if (accessToken) {
    try {
      currentUser = await getSupabaseAuthUserStrict(accessToken);
    } catch (error) {
      if (!shouldClearAuthSessionForError(error)) {
        return unavailableSession();
      }
    }
  }

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
    let refreshedUser: SupabaseAuthUser | null = null;
    try {
      refreshedUser = refreshedSession.access_token
        ? await getSupabaseAuthUserStrict(refreshedSession.access_token)
        : null;
    } catch (error) {
      return shouldClearAuthSessionForError(error)
        ? invalidSession()
        : unavailableSession();
    }

    if (!refreshedUser?.id || refreshedUser.id !== refreshedSession.user?.id) {
      return invalidSession();
    }

    if (bootstrap) await ensureUserBootstrap(refreshedUser);
    return {
      user: refreshedUser,
      refreshedSession,
      shouldClearCookies: false,
    };
  } catch (error) {
    return shouldClearAuthSessionForError(error)
      ? invalidSession()
      : unavailableSession();
  }
}

function invalidSession(): ResolvedAuthSession {
  return {
    user: null,
    refreshedSession: null,
    shouldClearCookies: true,
  };
}

function unavailableSession(): ResolvedAuthSession {
  return {
    user: null,
    refreshedSession: null,
    shouldClearCookies: false,
  };
}
