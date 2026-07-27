export const AUTH_PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
  Expires: "0",
  Pragma: "no-cache",
} as const;

export const AUTH_GOOGLE_OAUTH_PROVIDER = "google";
export const AUTH_LOCAL_CALLBACK_ORIGIN = "http://127.0.0.1:3110";
export const AUTH_PRODUCTION_CALLBACK_ORIGIN = "https://us-stock-radar.com";

export type AuthCallbackType = "signup" | "recovery";

export function sanitizeAuthRedirect(value: unknown, fallback = "/account") {
  const safeFallback = isSafeInternalPath(fallback) ? fallback : "/account";
  if (typeof value !== "string") return safeFallback;

  const candidate = value.trim();
  if (!isSafeInternalPath(candidate)) return safeFallback;

  try {
    const base = new URL("https://auth.internal");
    const parsed = new URL(candidate, base);
    if (parsed.origin !== base.origin || parsed.pathname === "/auth/callback") {
      return safeFallback;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return safeFallback;
  }
}

export function normalizeAuthCallbackType(value: unknown): AuthCallbackType | null {
  return value === "signup" || value === "recovery" ? value : null;
}

export function buildGoogleOAuthCallbackUrl({
  next,
  production,
}: {
  next?: unknown;
  production: boolean;
}) {
  const origin = production
    ? AUTH_PRODUCTION_CALLBACK_ORIGIN
    : AUTH_LOCAL_CALLBACK_ORIGIN;
  const callback = new URL("/auth/callback", origin);
  callback.searchParams.set("next", sanitizeAuthRedirect(next, "/alerts"));
  return callback.toString();
}

export function buildGoogleOAuthAuthorizeUrl({
  codeChallenge,
  redirectTo,
  supabaseUrl,
}: {
  codeChallenge: string;
  redirectTo: string;
  supabaseUrl: string;
}) {
  const baseUrl = supabaseUrl
    .replace(/\/rest\/v1\/?$/i, "")
    .replace(/\/$/, "");
  const authorizeUrl = new URL("/auth/v1/authorize", `${baseUrl}/`);
  authorizeUrl.searchParams.set("provider", AUTH_GOOGLE_OAUTH_PROVIDER);
  authorizeUrl.searchParams.set("redirect_to", redirectTo);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "s256");
  return authorizeUrl.toString();
}

export function isSameOriginAuthRequest({
  requestUrl,
  origin,
  secFetchSite,
}: {
  requestUrl: string;
  origin: string | null;
  secFetchSite: string | null;
}) {
  if (!origin) return false;

  try {
    const expectedOrigin = new URL(requestUrl).origin;
    const suppliedOrigin = new URL(origin).origin;
    return (
      suppliedOrigin === expectedOrigin &&
      (!secFetchSite || secFetchSite === "same-origin")
    );
  } catch {
    return false;
  }
}

export function resolveAuthRequestUrl({
  forwardedHost,
  forwardedProto,
  host,
  requestUrl,
}: {
  forwardedHost: string | null;
  forwardedProto: string | null;
  host: string | null;
  requestUrl: string;
}) {
  try {
    const resolved = new URL(requestUrl);
    const externalHost = readFirstHeaderValue(host || forwardedHost);
    const externalProto = readFirstHeaderValue(forwardedProto);

    if (externalHost) {
      const protocol =
        externalProto === "http" || externalProto === "https"
          ? externalProto
          : resolved.protocol.slice(0, -1);
      const externalOrigin = new URL(`${protocol}://${externalHost}`);

      resolved.protocol = externalOrigin.protocol;
      resolved.hostname = externalOrigin.hostname;
      resolved.port = externalOrigin.port;
    } else if (externalProto === "http" || externalProto === "https") {
      resolved.protocol = `${externalProto}:`;
    }

    return resolved.toString();
  } catch {
    return requestUrl;
  }
}

export function shouldRefreshAuthSession(
  accessToken: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  leewaySeconds = 60,
) {
  if (!accessToken) return true;
  const expiry = readJwtExpiry(accessToken);
  return expiry === null || expiry <= nowSeconds + Math.max(0, leewaySeconds);
}

function readJwtExpiry(token: string) {
  const payload = token.split(".")[1];
  if (!payload) return null;

  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const decoded =
      typeof globalThis.atob === "function"
        ? globalThis.atob(padded)
        : "";
    const data = JSON.parse(decoded) as { exp?: unknown };
    return typeof data.exp === "number" && Number.isFinite(data.exp)
      ? data.exp
      : null;
  } catch {
    return null;
  }
}

function isSafeInternalPath(value: string) {
  return (
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\") &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function readFirstHeaderValue(value: string | null) {
  return value?.split(",", 1)[0]?.trim() || "";
}
