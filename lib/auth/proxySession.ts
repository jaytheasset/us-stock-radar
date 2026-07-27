export type ProxyAuthSession = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  user?: {
    id?: string;
  } | null;
};

export async function refreshProxyAuthSession(
  refreshToken: string,
): Promise<ProxyAuthSession> {
  const baseUrl = (process.env.SUPABASE_URL || "")
    .replace(/\/rest\/v1\/?$/i, "")
    .replace(/\/$/, "");
  const anonKey = process.env.SUPABASE_ANON_KEY || "";

  if (!baseUrl || !anonKey || !refreshToken) {
    throw new Error("Auth refresh is unavailable.");
  }

  const response = await fetch(
    `${baseUrl}/auth/v1/token?grant_type=refresh_token`,
    {
      method: "POST",
      cache: "no-store",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        refresh_token: refreshToken,
      }),
    },
  );

  if (!response.ok) {
    throw new Error("Auth refresh failed.");
  }

  const session = (await response.json()) as Partial<ProxyAuthSession>;
  if (
    !session.access_token ||
    !session.refresh_token ||
    !session.user?.id
  ) {
    throw new Error("Auth refresh returned an invalid session.");
  }

  return session as ProxyAuthSession;
}
