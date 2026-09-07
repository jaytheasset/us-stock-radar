export function supabaseServiceHeaders(key, headers = {}) {
  const requestHeaders = {
    ...headers,
    apikey: key,
  };

  if (!key.startsWith("sb_secret_") && !key.startsWith("sb_publishable_")) {
    requestHeaders.Authorization = `Bearer ${key}`;
  }

  return requestHeaders;
}

export function resolveSupabaseSecretKey(env = process.env) {
  const preferred = String(env.SUPABASE_SECRET_KEY || env.SECRET_KEY || "").trim();
  if (preferred) {
    assertNotPublishable(preferred, "SUPABASE_SECRET_KEY");
    return preferred;
  }

  const legacy = String(
    env.SUPABASE_SERVICE_ROLE_KEY || env.SERVICE_ROLE_KEY || "",
  ).trim();
  if (legacy) assertNotPublishable(legacy, "SUPABASE_SERVICE_ROLE_KEY");
  return legacy;
}

export function resolveSupabasePublishableKey(env = process.env) {
  const preferred = String(
    env.SUPABASE_PUBLISHABLE_KEY || env.PUBLISHABLE_KEY || "",
  ).trim();
  if (preferred) {
    assertNotSecret(preferred, "SUPABASE_PUBLISHABLE_KEY");
    return preferred;
  }

  const legacy = String(env.SUPABASE_ANON_KEY || env.ANON_KEY || "").trim();
  if (legacy) assertNotSecret(legacy, "SUPABASE_ANON_KEY");
  return legacy;
}

function assertNotPublishable(key, source) {
  const kind = classifyKey(key);
  if (kind === "publishable" || kind === "legacy-publishable") {
    throw new Error(`${source} contains a public Supabase key; refusing privileged access`);
  }
}

function assertNotSecret(key, source) {
  const kind = classifyKey(key);
  if (kind === "secret" || kind === "legacy-secret") {
    throw new Error(`${source} contains a privileged Supabase key; refusing public exposure`);
  }
}

function classifyKey(key) {
  if (key.startsWith("sb_publishable_")) return "publishable";
  if (key.startsWith("sb_secret_")) return "secret";
  try {
    const parts = key.split(".");
    if (parts.length !== 3 || parts[1].length > 8192) return "unknown";
    const role = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")).role;
    if (role === "anon") return "legacy-publishable";
    if (role === "service_role") return "legacy-secret";
  } catch {
    // Non-JWT placeholder values remain compatible with local test harnesses.
  }
  return "unknown";
}
