const APP_PORT = 3110;
const SUPABASE_API_PORT = 56321;

export function buildLanDevelopmentValues(host) {
  assertPrivateIpv4(host);
  const appOrigin = `http://${host}:${APP_PORT}`;
  const supabaseOrigin = `http://${host}:${SUPABASE_API_PORT}`;
  return {
    appOrigin,
    supabaseOrigin,
    devAllowedOrigins: `${appOrigin},${supabaseOrigin}`,
  };
}

export function rewriteLocalEnv(content, values) {
  assertExistingSupabaseUrlIsLocal(content);
  return rewriteEnvKeys(content, {
    APP_BASE_URL: values.appOrigin,
    SUPABASE_URL: values.supabaseOrigin,
    DEV_ALLOWED_ORIGINS: values.devAllowedOrigins,
  });
}

export function rewriteSupabaseAuthConfig(content, appOrigin) {
  const authSectionPattern = /(\[auth\][\s\S]*?)(?=\r?\n\[[^\]]+\]|$)/;
  const authSectionMatch = content.match(authSectionPattern);
  if (!authSectionMatch) throw new Error("supabase/config.toml is missing [auth].");

  let authSection = authSectionMatch[1];
  if (!/^site_url\s*=.*$/m.test(authSection)) {
    throw new Error("supabase/config.toml is missing auth.site_url.");
  }
  const redirectListPattern = /^additional_redirect_urls\s*=\s*\[[\s\S]*?^\]/m;
  const redirectListMatch = authSection.match(redirectListPattern);
  if (!redirectListMatch) {
    throw new Error(
      "supabase/config.toml is missing auth.additional_redirect_urls.",
    );
  }

  const currentLanCallback = `${appOrigin}/auth/callback`;
  const callbackUrls = [
    ...readTomlStringArray(redirectListMatch[0]).filter(
      (url) => isExactRedirectUrl(url) && !isManagedPrivateLanCallback(url),
    ),
    currentLanCallback,
  ].filter((value, index, values) => values.indexOf(value) === index);

  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  authSection = authSection
    .replace(/^site_url\s*=.*$/m, `site_url = ${JSON.stringify(appOrigin)}`)
    .replace(
      redirectListPattern,
      [
        "additional_redirect_urls = [",
        ...callbackUrls.map((url) => `  ${JSON.stringify(url)},`),
        "]",
      ].join(newline),
    );

  return content.replace(authSectionPattern, authSection);
}

export function assertPrivateIpv4(host) {
  const parts = String(host).trim().split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    throw new Error("--host must be one private IPv4 address.");
  }
  if (
    parts[0] !== 10 &&
    !(parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) &&
    !(parts[0] === 192 && parts[1] === 168)
  ) {
    throw new Error("--host must be an RFC1918 private IPv4 address.");
  }
}

function assertExistingSupabaseUrlIsLocal(content) {
  const raw = readEnvValue(content, "SUPABASE_URL");
  if (!raw) return;

  try {
    const url = new URL(raw.replace(/\/rest\/v1\/?$/i, ""));
    const hostname = url.hostname.toLowerCase();
    const local =
      url.protocol === "http:" &&
      (hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        isPrivateIpv4(hostname));
    if (!local) throw new Error();
  } catch {
    throw new Error(
      "Refusing to overwrite a non-local SUPABASE_URL in .env.local.",
    );
  }
}

function isPrivateIpv4(host) {
  try {
    assertPrivateIpv4(host);
    return true;
  } catch {
    return false;
  }
}

function readEnvValue(content, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const assignmentPattern = new RegExp(
    `^\\s*(?:export\\s+)?${escapedKey}\\s*=\\s*(.*)$`,
  );
  const assignments = content
    .split(/\r?\n/)
    .map((line) => line.match(assignmentPattern))
    .filter(Boolean);
  const value = assignments.at(-1)?.[1]?.trim() || "";
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function rewriteEnvKeys(content, updates) {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const trailingNewline = /\r?\n$/.test(content);
  const replaced = new Set();
  const lines = content.split(/\r?\n/).filter((line, index, values) => {
    if (index === values.length - 1 && line === "" && trailingNewline) return false;
    const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/);
    if (!match || !(match[1] in updates)) return true;
    if (replaced.has(match[1])) return false;
    replaced.add(match[1]);
    return true;
  });

  const output = lines.map((line) => {
    const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/);
    if (!match || !(match[1] in updates)) return line;
    return `${match[1]}=${updates[match[1]]}`;
  });
  for (const [key, value] of Object.entries(updates)) {
    if (!replaced.has(key)) output.push(`${key}=${value}`);
  }
  return `${output.join(newline)}${trailingNewline ? newline : ""}`;
}

function readTomlStringArray(block) {
  const values = [];
  for (const line of block.split(/\r?\n/)) {
    const match = line
      .trim()
      .match(/^("(?:\\.|[^"\\])*"|'[^']*')\s*,?\s*(?:#.*)?$/);
    if (!match) continue;
    if (match[1].startsWith("'")) {
      values.push(match[1].slice(1, -1));
      continue;
    }
    try {
      values.push(JSON.parse(match[1]));
    } catch {
      // Invalid TOML strings are not safe redirect allowlist entries.
    }
  }
  return values;
}

function isExactRedirectUrl(value) {
  if (/[*\[\]{}]/.test(value)) return false;
  try {
    const url = new URL(value);
    return !url.username && !url.password;
  } catch {
    return false;
  }
}

function isManagedPrivateLanCallback(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      url.port === String(APP_PORT) &&
      url.pathname === "/auth/callback" &&
      !url.search &&
      !url.hash &&
      isPrivateIpv4(url.hostname)
    );
  } catch {
    return false;
  }
}
