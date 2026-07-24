import "server-only";

import { getServerEnv, redactUrl } from "@/lib/env";
import {
  runAccesswireNewsIngestWithRawFetcher,
  runFdaNewsIngestWithRawFetcher,
} from "@/lib/newsIngest";
import {
  fetchAccesswireRawItems,
  type AccesswireRawFetchResult,
} from "@/lib/sources/accesswire/parser";
import { fetchFdaRawItems, type FdaRawFetchResult } from "@/lib/sources/fda/parser";

type NewsIngestOptions = {
  limit: number;
  dryRun: boolean;
  force: boolean;
  sourceUniqueId?: string;
};

type RawFetchOptions = {
  limit: number;
  sourceUniqueId?: string;
  includeArticleBody: boolean;
  articleBodyLimit: number;
};

export async function runAccesswireNewsIngestWithFallback(options: NewsIngestOptions) {
  let nasFallback: Record<string, unknown> | null = null;

  const result = await runAccesswireNewsIngestWithRawFetcher(async (rawOptions) => {
    const directResult = await fetchAccesswireRawItems(rawOptions);
    if (readRecord(directResult)?.ok !== false) return directResult;

    const fallbackResult = await runNasBridge<AccesswireRawFetchResult>({
      bridgeUrl: getServerEnv().accesswireIngestUrl,
      directResult,
      fallbackFrom: "next_accesswire_direct_raw_fetch",
      missingError: "ACCESSWIRE_INGEST_URL is not configured",
      options: rawOptions,
      source: "accesswire",
    });
    nasFallback = fallbackDiagnostics("ACCESSWIRE_INGEST_URL", directResult, fallbackResult);

    return fallbackResult.ok && fallbackResult.data ? fallbackResult.data : directResult;
  }, options);

  return nasFallback ? { ...readRecord(result), nas_fallback: nasFallback } : result;
}

export async function runFdaNewsIngestWithFallback(options: NewsIngestOptions) {
  let nasFallback: Record<string, unknown> | null = null;

  const result = await runFdaNewsIngestWithRawFetcher(async (rawOptions) => {
    const directResult = await fetchFdaRawItems(rawOptions);
    if (!shouldUseFdaNasFallback(directResult, rawOptions)) return directResult;

    const fallbackResult = await runNasBridge<FdaRawFetchResult>({
      bridgeUrl: getServerEnv().fdaIngestUrl,
      directResult,
      fallbackFrom: "next_fda_direct_raw_fetch",
      missingError: "FDA_INGEST_URL is not configured",
      options: rawOptions,
      source: "fda",
    });
    nasFallback = {
      ...fallbackDiagnostics("FDA_INGEST_URL", directResult, fallbackResult),
      direct_article_bodies_requested:
        readRecord(readRecord(directResult)?.diagnostics)?.articleBodiesRequested || null,
      direct_article_bodies_fetched:
        readRecord(readRecord(directResult)?.diagnostics)?.articleBodiesFetched || null,
    };

    return fallbackResult.ok && fallbackResult.data ? fallbackResult.data : directResult;
  }, options);

  return nasFallback ? { ...readRecord(result), nas_fallback: nasFallback } : result;
}

function shouldUseFdaNasFallback(result: FdaRawFetchResult, options: RawFetchOptions) {
  if (!result.ok) return true;
  if (options.sourceUniqueId && result.count === 0) return true;

  const diagnostics = readRecord(result.diagnostics);
  const requested = readNumber(diagnostics?.articleBodiesRequested);
  const fetched = readNumber(diagnostics?.articleBodiesFetched);
  if (options.includeArticleBody && requested > 0 && fetched < requested) return true;

  return result.items.some((item) => {
    const rawPayload = readRecord(item.raw_payload);
    return Boolean(
      rawPayload?.article_fetch_error ||
        (options.includeArticleBody && !item.body_text && !rawPayload?.analysis_text),
    );
  });
}

async function runNasBridge<T>({
  bridgeUrl,
  directResult,
  fallbackFrom,
  missingError,
  options,
  source,
}: {
  bridgeUrl: string;
  directResult: unknown;
  fallbackFrom: string;
  missingError: string;
  options: RawFetchOptions;
  source: string;
}) {
  const redactedUrl = redactUrl(bridgeUrl);
  if (!bridgeUrl) {
    return { ok: false, status: 0, redactedUrl, error: missingError, data: null as T | null };
  }

  const env = getServerEnv();
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (env.nasIngestToken) {
    headers.Authorization = `Bearer ${env.nasIngestToken}`;
    headers["X-Ingest-Token"] = env.nasIngestToken;
  }

  try {
    const response = await timedFetch(bridgeUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...options,
        source,
        fallbackFrom,
        directStatus: readRecord(directResult)?.status || null,
        directError: readRecord(directResult)?.error || null,
      }),
    });
    const data = normalizeBridgeData(readRecord(await response.json().catch(() => null)));
    const ok = response.ok && bridgePayloadOk(data);

    return {
      ok,
      status: response.status,
      redactedUrl,
      data: data as T | null,
      error: ok ? undefined : readBridgeError(data, response.statusText || `${source} NAS bridge failed`),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      redactedUrl,
      data: null as T | null,
      error: error instanceof Error ? error.message : `${source} NAS bridge request failed`,
    };
  }
}

function fallbackDiagnostics(
  source: string,
  directResult: unknown,
  fallbackResult: {
    ok: boolean;
    status: number;
    redactedUrl: string;
    data: unknown;
    error?: string;
  },
) {
  return {
    attempted: true,
    used: Boolean(fallbackResult.ok && fallbackResult.data),
    source,
    url: fallbackResult.redactedUrl,
    direct_stage: "raw_fetch",
    direct_status: readRecord(directResult)?.status || null,
    bridge_status: fallbackResult.status,
    ...(fallbackResult.error ? { bridge_error: fallbackResult.error } : {}),
  };
}

async function timedFetch(input: string, init: RequestInit, timeoutMs = 120_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function bridgePayloadOk(data: Record<string, unknown> | null) {
  if (!data || data.ok === false || data.status === "failed" || data.status === "error") return false;
  return Array.isArray(data.items);
}

function normalizeBridgeData(data: Record<string, unknown> | null) {
  return readRecord(data?.result) || data;
}

function readBridgeError(data: Record<string, unknown> | null, fallback: string) {
  if (!data) return fallback;
  if (typeof data.message === "string" && data.message.trim()) return data.message;
  if (typeof data.error === "string" && data.error.trim()) return data.error;
  return fallback;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
