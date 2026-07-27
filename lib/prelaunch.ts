import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import type { Metadata } from "next";

export const PRELAUNCH_ACCESS_COOKIE = "sr_prelaunch_access";
export const PRELAUNCH_ACCESS_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const accessProofVersion = "v1";
const accessProofContext = "us-stock-radar:prelaunch-access:v1";
const staticAssetPattern =
  /\.(?:avif|css|eot|gif|ico|jpe?g|js|json|map|mjs|mp3|mp4|pdf|png|svg|txt|ttf|webmanifest|webp|woff2?|xml)$/i;

export function isPrelaunchMode(
  env: Record<string, string | undefined> = process.env,
) {
  return env.PRELAUNCH_MODE === "1";
}

export function verifyPrelaunchPassword(
  candidate: string,
  configuredPassword: string,
) {
  if (!candidate || !configuredPassword) return false;
  return timingSafeStringEqual(candidate, configuredPassword);
}

export function createPrelaunchAccessProof(configuredPassword: string) {
  if (!configuredPassword) {
    throw new Error("PRELAUNCH_PASSWORD is required");
  }
  const signature = createHmac("sha256", configuredPassword)
    .update(accessProofContext)
    .digest("base64url");
  return `${accessProofVersion}.${signature}`;
}

export function verifyPrelaunchAccessProof(
  candidateProof: string | undefined,
  configuredPassword: string,
) {
  if (!candidateProof || !configuredPassword) return false;
  return timingSafeStringEqual(
    candidateProof,
    createPrelaunchAccessProof(configuredPassword),
  );
}

export function isPrelaunchBypassPath(pathname: string) {
  return (
    matchesPathPrefix(pathname, "/api") ||
    matchesPathPrefix(pathname, "/.well-known/workflow") ||
    matchesPathPrefix(pathname, "/_next") ||
    pathname === "/auth/callback" ||
    isComingSoonPath(pathname) ||
    staticAssetPattern.test(pathname)
  );
}

export function isComingSoonPath(pathname: string) {
  return pathname === "/coming-soon";
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
