import "server-only";

import { getServerEnv } from "@/lib/env";
import { supabaseApiKeyHeaders } from "@/lib/supabaseKeys";

export type ServerAuthUser = {
  id?: string;
  email?: string;
  email_confirmed_at?: string;
  confirmed_at?: string;
};

export async function getAuthUserById(userId: string): Promise<ServerAuthUser | null> {
  const env = getServerEnv();
  const baseUrl = env.supabaseUrl.replace(/\/rest\/v1\/?$/i, "").replace(/\/$/, "");
  if (!baseUrl || !env.supabaseSecretKey || !userId) return null;

  try {
    const response = await fetch(`${baseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      cache: "no-store",
      headers: supabaseApiKeyHeaders({
        apiKey: env.supabaseSecretKey,
        headers: {
          Accept: "application/json",
        },
      }),
    });
    if (!response.ok) return null;
    return (await response.json()) as ServerAuthUser;
  } catch {
    return null;
  }
}

export function getVerifiedAuthEmail(user: ServerAuthUser | null) {
  const email = user?.email?.trim().toLowerCase() || "";
  const verifiedAt = user?.email_confirmed_at || user?.confirmed_at || "";
  return email && verifiedAt ? { email, verifiedAt } : null;
}

export function maskEmailAddress(email: string) {
  const [local, domain] = email.trim().split("@");
  if (!local || !domain) return "";
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(2, Math.min(6, local.length - visible.length)))}@${domain}`;
}
