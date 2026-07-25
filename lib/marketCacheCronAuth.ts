import { timingSafeEqual } from "node:crypto";

type HeaderRequest = {
  headers: Headers;
};

export type MarketCacheCronAuthorization =
  | { ok: true }
  | {
      ok: false;
      status: 401 | 500;
      error: "UNAUTHORIZED" | "CRON_SECRET_MISSING";
    };

export function authorizeMarketCacheCron(
  request: HeaderRequest,
  secret = process.env.CRON_SECRET || "",
): MarketCacheCronAuthorization {
  if (!secret) {
    return { ok: false, status: 500, error: "CRON_SECRET_MISSING" };
  }

  const authorization = request.headers.get("authorization") || "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  return safeSecretEqual(bearer, secret)
    ? { ok: true }
    : { ok: false, status: 401, error: "UNAUTHORIZED" };
}

export function authorizeMarketCacheRefresh(
  request: HeaderRequest,
  refreshRequested: boolean,
  secret = process.env.CRON_SECRET || "",
): MarketCacheCronAuthorization {
  return refreshRequested
    ? authorizeMarketCacheCron(request, secret)
    : { ok: true };
}

function safeSecretEqual(candidate: string, expected: string) {
  if (!candidate) return false;
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  if (candidateBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(candidateBuffer, expectedBuffer);
}
