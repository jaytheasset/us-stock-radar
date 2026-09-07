import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import type { Metadata } from "next";

export const PRELAUNCH_ACCESS_COOKIE = "sr_prelaunch_access";
export const PRELAUNCH_ACCESS_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const accessProofVersion = "v2";
const accessProofContext = "us-stock-radar:prelaunch-access:v2";
const prelaunchPublicPaths = new Set([
  "/coming-soon",
  "/api/prelaunch/access",
  "/api/prelaunch/logout",
  "/favicon.ico",
  "/robots.txt",
]);
const prelaunchOperationalPaths = new Set([
  "/api/alerts/email/unsubscribe",
  "/api/cron/alert-delivery",
  "/api/cron/dashboard-movers",
  "/api/cron/market-cache",
  "/api/telegram/webhook",
  "/api/webhooks",
  "/api/webhooks/snaptrade",
]);

export function isPrelaunchMode(
  env: Record<string, string | undefined> = process.env,
) {
  if (env.PRELAUNCH_MODE === "1") return true;
  if (env.PRELAUNCH_MODE === "0") return false;
  return env.VERCEL_ENV === "production";
}

export function verifyPrelaunchPassword(
  candidate: string,
  configuredPassword: string,
) {
  if (!candidate || !configuredPassword) return false;
  return timingSafeStringEqual(candidate, configuredPassword);
}

export function createPrelaunchAccessProof(
  configuredPassword: string,
  now = Date.now(),
) {
  if (!configuredPassword) {
    throw new Error("PRELAUNCH_PASSWORD is required");
  }
  const expiresAt =
    Math.floor(now / 1000) + PRELAUNCH_ACCESS_MAX_AGE_SECONDS;
  const signature = createHmac("sha256", configuredPassword)
    .update(`${accessProofContext}:${expiresAt}`)
    .digest("base64url");
  return `${accessProofVersion}.${expiresAt}.${signature}`;
}

export function verifyPrelaunchAccessProof(
  candidateProof: string | undefined,
  configuredPassword: string,
  now = Date.now(),
) {
  if (!candidateProof || !configuredPassword) return false;
  const match = candidateProof.match(/^v2\.(\d{10})\.([A-Za-z0-9_-]{43})$/);
  if (!match) return false;

  const expiresAt = Number(match[1]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(now / 1000)) {
    return false;
  }

  const expectedSignature = createHmac("sha256", configuredPassword)
    .update(`${accessProofContext}:${expiresAt}`)
    .digest("base64url");
  return timingSafeStringEqual(match[2], expectedSignature);
}

export function isPrelaunchBypassPath(pathname: string) {
  return (
    prelaunchPublicPaths.has(pathname) ||
    prelaunchOperationalPaths.has(pathname) ||
    /^\/api\/cron\/source-ingest\/[^/]+$/.test(pathname) ||
    /^\/api\/sources\/[^/]+\/ingest$/.test(pathname) ||
    matchesPathPrefix(pathname, "/.well-known/workflow") ||
    matchesPathPrefix(pathname, "/_next/static") ||
    matchesPathPrefix(pathname, "/_next/media")
  );
}

export function isPrelaunchApiPath(pathname: string) {
  return matchesPathPrefix(pathname, "/api");
}

export function isComingSoonPath(pathname: string) {
  return pathname === "/coming-soon";
}

export function shouldUseSecurePrelaunchCookie(request: Request) {
  return (
    process.env.NODE_ENV === "production" ||
    new URL(request.url).protocol === "https:"
  );
}

export function sanitizeInternalRedirect(
  value: unknown,
  fallback = "/",
) {
  const safeFallback =
    typeof fallback === "string" &&
    fallback.startsWith("/") &&
    !fallback.startsWith("//")
      ? fallback
      : "/";
  if (typeof value !== "string") return safeFallback;

  const candidate = value.trim();
  if (
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(candidate)
  ) {
    return safeFallback;
  }

  try {
    const base = new URL("https://prelaunch.internal");
    const parsed = new URL(candidate, base);
    if (parsed.origin !== base.origin || isComingSoonPath(parsed.pathname)) {
      return safeFallback;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return safeFallback;
  }
}

export function prelaunchRobotsMetadata(enabled: boolean): Metadata["robots"] {
  return enabled
    ? {
        follow: false,
        index: false,
        nocache: true,
        googleBot: {
          follow: false,
          index: false,
          noimageindex: true,
        },
      }
    : {
        follow: true,
        index: true,
      };
}

function timingSafeStringEqual(candidate: string, expected: string) {
  const candidateDigest = createHash("sha256").update(candidate).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(candidateDigest, expectedDigest);
}

function matchesPathPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}
