import { shouldClearAuthSessionForStatus } from "./authFailure.ts";
import { getServerEnv } from "../env.ts";
import { supabaseApiKeyHeaders } from "../supabaseKeys.ts";

export type ProxyAuthSession = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  user?: {
    id?: string;
  } | null;
};

export class ProxyAuthRefreshError extends Error {
  readonly status: number | null;
  readonly clearSession: boolean;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "ProxyAuthRefreshError";
    this.status = status;
    this.clearSession = shouldClearAuthSessionForStatus(status);
  }
}

export async function refreshProxyAuthSession(
  refreshToken: string,
): Promise<ProxyAuthSession> {
  const env = getServerEnv();
  const baseUrl = env.supabaseUrl
    .replace(/\/rest\/v1\/?$/i, "")
    .replace(/\/$/, "");
  const publishableKey = env.supabasePublishableKey;

  if (!baseUrl || !publishableKey) {
    throw new ProxyAuthRefreshError("Auth refresh is unavailable.");
  }
  if (!refreshToken) {
    throw new ProxyAuthRefreshError("Refresh token is missing.", 401);
  }

  let response: Response;
  try {
    response = await fetch(
      `${baseUrl}/auth/v1/token?grant_type=refresh_token`,
      {
        method: "POST",
        cache: "no-store",
        headers: supabaseApiKeyHeaders({
          apiKey: publishableKey,
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }),
        body: JSON.stringify({
          refresh_token: refreshToken,
        }),
      },
    );
  } catch {
    throw new ProxyAuthRefreshError("Auth refresh is temporarily unavailable.");
  }

  if (!response.ok) {
    throw new ProxyAuthRefreshError("Auth refresh failed.", response.status);
  }

  const session = (await response.json()) as Partial<ProxyAuthSession>;
  if (
    !session.access_token ||
    !session.refresh_token ||
    !session.user?.id
  ) {
    throw new ProxyAuthRefreshError(
      "Auth refresh returned an invalid session.",
    );
  }

  return session as ProxyAuthSession;
}
