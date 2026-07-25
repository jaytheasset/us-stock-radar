import { timingSafeEqual } from "node:crypto";

type HeaderRequest = {
  headers: Headers;
};

export type SourceIngestAuthorization =
  | { ok: true }
  | { ok: false; status: 401 | 500; error: "UNAUTHORIZED" | "SOURCE_INGEST_SECRET_MISSING" };

export function authorizeSourceIngestRequest(
  request: HeaderRequest,
  secret = readSourceIngestSecret(),
): SourceIngestAuthorization {
  if (!secret) {
    return {
      ok: false,
      status: 500,
      error: "SOURCE_INGEST_SECRET_MISSING",
    };
  }

  const authorization = request.headers.get("authorization") || "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  const headerSecret =
    request.headers.get("x-source-ingest-secret") ||
    request.headers.get("x-cron-secret") ||
    "";
  if (safeSecretEqual(bearer, secret) || safeSecretEqual(headerSecret, secret)) {
    return { ok: true };
  }

  return { ok: false, status: 401, error: "UNAUTHORIZED" };
}

export function sourceIngestAuthResponse(request: HeaderRequest) {
  const authorization = authorizeSourceIngestRequest(request);
  return authorization.ok
    ? null
    : Response.json(
        { ok: false, error: authorization.error },
        {
          status: authorization.status,
          headers: {
            "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
          },
        },
      );
}

export function readSourceIngestDryRun(
  method: "GET" | "POST",
  queryValue: string | null,
  bodyValue: unknown,
) {
  return method === "GET"
    ? queryValue !== "false"
    : queryValue === "true" || bodyValue === true;
}

export function sourceIngestAuthorizationHeaders(): Record<string, string> {
  const secret = readSourceIngestSecret();
  return secret
    ? { Authorization: `Bearer ${secret}` }
    : {};
}

function readSourceIngestSecret() {
  return (
    process.env.SOURCE_INGEST_INTERNAL_SECRET ||
    process.env.CRON_SECRET ||
    ""
  );
}

function safeSecretEqual(candidate: string, expected: string) {
  if (!candidate) return false;
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  if (candidateBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(candidateBuffer, expectedBuffer);
}
