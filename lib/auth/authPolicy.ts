export const AUTH_PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
  Expires: "0",
  Pragma: "no-cache",
} as const;

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
