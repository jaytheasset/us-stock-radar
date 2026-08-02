const DEFAULT_DEVELOPMENT_ORIGINS = [
  "http://127.0.0.1:3110",
  "http://localhost:3110",
  "http://127.0.0.1:56321",
  "http://localhost:56321",
] as const;

export function getDevelopmentAllowedOrigins({
  nodeEnv,
  value,
}: {
  nodeEnv?: string;
  value?: string;
}) {
  if (nodeEnv === "production") return [];

  const configured = (value || "")
    .split(",")
    .map((candidate) => candidate.trim())
    .filter(Boolean);

  return uniqueOrigins(
    [...DEFAULT_DEVELOPMENT_ORIGINS, ...configured].filter(
      isSafeDevelopmentOrigin,
    ),
  );
}

export function getAllowedDevHostnames(options: {
  nodeEnv?: string;
  value?: string;
}) {
  return [
    ...new Set(
      getDevelopmentAllowedOrigins(options).map(
        (origin) => new URL(origin).hostname,
      ),
    ),
  ];
}

export function isAllowedDevelopmentOrigin(
  candidate: string,
  options: { nodeEnv?: string; value?: string },
) {
  if (options.nodeEnv === "production") return false;

  try {
    return getDevelopmentAllowedOrigins(options).includes(
      new URL(candidate).origin,
    );
  } catch {
    return false;
  }
}

export function toWebSocketOrigin(origin: string) {
  const parsed = new URL(origin);
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  return parsed.origin;
}

export function isHttpsOrAllowedDevelopmentUrl(
  candidate: string,
  developmentAllowedOrigins: readonly string[] = [],
) {
  try {
    const url = new URL(candidate);
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        developmentAllowedOrigins.includes(url.origin))
    );
  } catch {
    return false;
  }
}

function isSafeDevelopmentOrigin(candidate: string) {
  if (candidate.includes("*")) return false;

  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:") return false;
    if (url.username || url.password) return false;
    if (url.pathname !== "/" || url.search || url.hash) return false;
    if (!url.port) return false;
    return isLoopbackOrPrivateHostname(url.hostname);
  } catch {
    return false;
  }
}

function isLoopbackOrPrivateHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  if (normalized === "localhost" || normalized === "127.0.0.1") return true;

  const parts = normalized.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }

  return (
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

function uniqueOrigins(values: readonly string[]) {
  const origins: string[] = [];
  for (const value of values) {
    try {
      const origin = new URL(value).origin;
      if (!origins.includes(origin)) origins.push(origin);
    } catch {
      // Invalid entries are deliberately ignored instead of broadening access.
    }
  }
  return origins;
}
