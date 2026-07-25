import { redactUrl } from "./env.ts";

export type NasBridgeFetchOptions = {
  limit: number;
  sourceUniqueId?: string;
  includeArticleBody: boolean;
  articleBodyLimit: number;
};

export type NasBridgeResult<T> = {
  ok: boolean;
  status: number;
  redactedUrl: string;
  data: T | null;
  error?: string;
  timedOut?: boolean;
};

export async function runNasBridge<T>({
  bridgeUrl,
  directResult,
  fallbackFrom,
  missingError,
  options,
  source,
  token,
  timeoutMs = 120_000,
  signal,
  fetchImpl = fetch,
}: {
  bridgeUrl: string;
  directResult: unknown;
  fallbackFrom: string;
  missingError: string;
  options: NasBridgeFetchOptions;
  source: string;
  token: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<NasBridgeResult<T>> {
  const redactedUrl = redactUrl(bridgeUrl);
  if (!bridgeUrl) {
    return {
      ok: false,
      status: 0,
      redactedUrl,
      error: missingError,
      data: null,
    };
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
    headers["X-Ingest-Token"] = token;
  }

  try {
    const response = await timedFetch(
      bridgeUrl,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...options,
          source,
          fallbackFrom,
          directStatus: readRecord(directResult)?.status || null,
          directError: readRecord(directResult)?.error || null,
        }),
      },
      {
        timeoutMs,
        signal,
        fetchImpl,
      },
    );
    const data = normalizeBridgeData(
      readRecord(await response.json().catch(() => null)),
    );
    const ok = response.ok && bridgePayloadOk(data);

    return {
      ok,
      status: response.status,
      redactedUrl,
      data: data as T | null,
      error: ok
        ? undefined
        : readBridgeError(
            data,
            response.statusText || `${source} NAS bridge failed`,
          ),
    };
  } catch (error) {
    const timedOut =
      isAbortError(error) ||
      Boolean(signal?.aborted);
    return {
      ok: false,
      status: 0,
      redactedUrl,
      data: null,
      error: timedOut
        ? `${source} NAS bridge timed out after ${timeoutMs}ms`
        : error instanceof Error
          ? error.message
          : `${source} NAS bridge request failed`,
      timedOut,
    };
  }
}

async function timedFetch(
  input: string,
  init: RequestInit,
  {
    timeoutMs,
    signal,
    fetchImpl,
  }: {
    timeoutMs: number;
    signal?: AbortSignal;
    fetchImpl: typeof fetch;
  },
) {
  const controller = new AbortController();
  const combinedSignal = signal
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal;
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(1, timeoutMs),
  );

  try {
    return await fetchImpl(input, {
      ...init,
      cache: "no-store",
      signal: combinedSignal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function bridgePayloadOk(data: Record<string, unknown> | null) {
  if (
    !data ||
    data.ok === false ||
    data.status === "failed" ||
    data.status === "error"
  ) {
    return false;
  }
  return Array.isArray(data.items);
}

function normalizeBridgeData(data: Record<string, unknown> | null) {
  return readRecord(data?.result) || data;
}

function readBridgeError(
  data: Record<string, unknown> | null,
  fallback: string,
) {
  if (!data) return fallback;
  if (typeof data.message === "string" && data.message.trim()) {
    return data.message;
  }
  if (typeof data.error === "string" && data.error.trim()) {
    return data.error;
  }
  return fallback;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isAbortError(error: unknown) {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (typeof DOMException !== "undefined" &&
      error instanceof DOMException &&
      error.name === "AbortError")
  );
}
