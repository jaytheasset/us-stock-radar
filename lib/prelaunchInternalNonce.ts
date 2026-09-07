import { getServerEnv } from "./env.ts";
import { supabaseApiKeyHeaders } from "./supabaseKeys.ts";

export async function consumePrelaunchInternalNonce(input: {
  expiresAt: number;
  nonceDigest: string;
  scopeDigest: string;
}) {
  const env = getServerEnv();
  const baseUrl = env.supabaseUrl
    .replace(/\/rest\/v1\/?$/i, "")
    .replace(/\/$/, "");
  if (!baseUrl || !env.supabaseSecretKey) return false;

  try {
    const response = await fetch(
      `${baseUrl}/rest/v1/rpc/consume_prelaunch_internal_nonce`,
      {
        method: "POST",
        cache: "no-store",
        headers: supabaseApiKeyHeaders({
          apiKey: env.supabaseSecretKey,
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }),
        body: JSON.stringify({
          p_expires_at: new Date(input.expiresAt * 1000).toISOString(),
          p_nonce_hash: input.nonceDigest,
          p_scope_hash: input.scopeDigest,
        }),
      },
    );
    const consumed = await response.json().catch(() => false);
    return response.ok && consumed === true;
  } catch {
    return false;
  }
}
