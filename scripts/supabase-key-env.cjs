function resolveSupabaseSecretKey(env = process.env) {
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

function assertNotPublishable(key, source) {
  if (key.startsWith("sb_publishable_") || readJwtRole(key) === "anon") {
    throw new Error(`${source} contains a public Supabase key; refusing privileged access`);
  }
}

function readJwtRole(key) {
  try {
    const parts = key.split(".");
    if (parts.length !== 3 || parts[1].length > 8192) return "";
    const role = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")).role;
    return typeof role === "string" ? role : "";
  } catch {
    return "";
  }
}

module.exports = { resolveSupabaseSecretKey };
