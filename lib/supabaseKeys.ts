export type SupabaseApiKeyKind =
  | "publishable"
  | "secret"
  | "legacy-publishable"
  | "legacy-secret"
  | "unknown";

export type SupabaseKeyResolution = {
  key: string;
  source: string | null;
  error: "wrong-role" | null;
};

type SupabaseKeyEnvironment = Record<string, string | undefined>;

export function classifySupabaseApiKey(value: string): SupabaseApiKeyKind {
  const key = value.trim();
  if (key.startsWith("sb_publishable_")) return "publishable";
  if (key.startsWith("sb_secret_")) return "secret";

  const role = readLegacyJwtRole(key);
  if (role === "anon") return "legacy-publishable";
  if (role === "service_role") return "legacy-secret";
  return "unknown";
}

export function resolveSupabasePublishableKey(
  env: SupabaseKeyEnvironment = process.env,
): SupabaseKeyResolution {
  return resolveKey(
    [
      ["SUPABASE_PUBLISHABLE_KEY", env.SUPABASE_PUBLISHABLE_KEY],
      ["SUPABASE_ANON_KEY", env.SUPABASE_ANON_KEY],
    ],
    new Set<SupabaseApiKeyKind>(["secret", "legacy-secret"]),
  );
}

export function resolveSupabaseSecretKey(
  env: SupabaseKeyEnvironment = process.env,
): SupabaseKeyResolution {
  return resolveKey(
    [
      ["SUPABASE_SECRET_KEY", env.SUPABASE_SECRET_KEY],
      ["SUPABASE_SERVICE_ROLE_KEY", env.SUPABASE_SERVICE_ROLE_KEY],
    ],
    new Set<SupabaseApiKeyKind>(["publishable", "legacy-publishable"]),
  );
}

export function supabaseApiKeyHeaders({
  accessToken,
  apiKey,
  headers = {},
}: {
  accessToken?: string;
  apiKey: string;
  headers?: Record<string, string>;
}) {
  const result: Record<string, string> = {
    ...headers,
    apikey: apiKey,
  };
  const kind = classifySupabaseApiKey(apiKey);
  if (accessToken) {
    result.Authorization = `Bearer ${accessToken}`;
  } else if (kind === "legacy-publishable" || kind === "legacy-secret" || kind === "unknown") {
    // Legacy keys are JWTs and older Supabase paths use the bearer value to
    // select the anon/service_role database role. New keys belong only in
    // `apikey`; Authorization is reserved for a signed-in user's JWT.
    result.Authorization = `Bearer ${apiKey}`;
  }
  return result;
}

function resolveKey(
  candidates: ReadonlyArray<readonly [string, string | undefined]>,
  forbiddenKinds: ReadonlySet<SupabaseApiKeyKind>,
): SupabaseKeyResolution {
  for (const [source, rawValue] of candidates) {
    const key = rawValue?.trim() || "";
    if (!key) continue;
    if (forbiddenKinds.has(classifySupabaseApiKey(key))) {
      return { key: "", source, error: "wrong-role" };
    }
    return { key, source, error: null };
  }
  return { key: "", source: null, error: null };
}

function readLegacyJwtRole(value: string) {
  const parts = value.split(".");
  if (parts.length !== 3 || parts[1].length > 8192) return "";
  try {
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const payload = JSON.parse(globalThis.atob(padded)) as { role?: unknown };
    return typeof payload.role === "string" ? payload.role : "";
  } catch {
    return "";
  }
}
