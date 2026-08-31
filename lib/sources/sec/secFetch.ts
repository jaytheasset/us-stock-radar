import { getServerEnv } from "../../env.ts";

const SEC_FETCH_MAX_ATTEMPTS = 3;
export const SEC_FETCH_TIMEOUT_MS = 30_000;
const SEC_TRANSIENT_HTTP_STATUSES = new Set([403, 408, 425, 429, 500, 502, 503, 504]);

type SecFetchRuntimeOptions = {
  timeoutMs?: number;
};

export async function secFetch(input: string | URL, options: SecFetchRuntimeOptions = {}) {
  const env = getServerEnv();
  const userAgent = env.secUserAgent || "US-Stock-Radar/0.1 contact@example.com";
  const timeoutMs = options.timeoutMs ?? SEC_FETCH_TIMEOUT_MS;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < SEC_FETCH_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(input, {
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          "User-Agent": userAgent,
          Accept: "application/atom+xml, application/json, text/html, text/plain, */*",
          "Accept-Encoding": "gzip, deflate, br",
        },
      });

      const shouldRetry = SEC_TRANSIENT_HTTP_STATUSES.has(response.status) && attempt < SEC_FETCH_MAX_ATTEMPTS - 1;
      if (!shouldRetry) return response;

      await response.body?.cancel().catch(() => undefined);
      await waitForSecRetry(secRetryDelayMs(response, attempt));
    } catch (error) {
      lastError = error;
      if (attempt >= SEC_FETCH_MAX_ATTEMPTS - 1) throw error;
      await waitForSecRetry(500 * (attempt + 1));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("SEC request failed after retries.");
}

function secRetryDelayMs(response: Response, attempt: number) {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 2_000);

    const retryAt = Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) return Math.min(Math.max(retryAt - Date.now(), 0), 2_000);
  }
  return 500 * (attempt + 1);
}

function waitForSecRetry(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}
