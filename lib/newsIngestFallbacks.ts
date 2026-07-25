import "server-only";

import { getServerEnv } from "@/lib/env";
import {
  runNasBridge,
  type NasBridgeFetchOptions,
} from "@/lib/nasIngestBridge";
import { findMatchingAccesswireItem } from "@/lib/accesswireNasFallbackMatch";
import { findMatchingFdaItem } from "@/lib/fdaNasFallbackMatch";
import {
  runAccesswireNewsIngestWithRawFetcher,
  runFdaNewsIngestWithRawFetcher,
} from "@/lib/newsIngest";
import {
  fetchAccesswireRawItems,
  hydrateAccesswireRawItems,
  type AccesswireHydrationFallback,
  type AccesswireParsedRawItem,
  type AccesswireRawFetchResult,
} from "@/lib/sources/accesswire/parser";
import {
  fetchFdaRawItems,
  hydrateFdaRawItems,
  type FdaHydrationFallback,
  type FdaParsedRawItem,
  type FdaRawFetchResult,
} from "@/lib/sources/fda/parser";

type NewsIngestOptions = {
  limit: number;
  dryRun: boolean;
  force: boolean;
  sourceUniqueId?: string;
};

type RawFetchOptions = NasBridgeFetchOptions;

export async function runAccesswireNewsIngestWithFallback(options: NewsIngestOptions) {
  let nasFallback: Record<string, unknown> | null = null;

  const result = await runAccesswireNewsIngestWithRawFetcher(async (rawOptions) => {
    const directResult = await fetchAccesswireRawItems(rawOptions);
    if (readRecord(directResult)?.ok !== false) return directResult;

    const env = getServerEnv();
    const fallbackResult = await runNasBridge<AccesswireRawFetchResult>({
      bridgeUrl: env.accesswireIngestUrl,
      directResult,
      fallbackFrom: "next_accesswire_direct_raw_fetch",
      missingError: "ACCESSWIRE_INGEST_URL is not configured",
      options: rawOptions,
      source: "accesswire",
      token: env.nasIngestToken,
    });
    nasFallback = fallbackDiagnostics("ACCESSWIRE_INGEST_URL", directResult, fallbackResult);

    return fallbackResult.ok && fallbackResult.data ? fallbackResult.data : directResult;
  }, options, (items, hydrateOptions) =>
    hydrateAccesswireRawItems(
      items as AccesswireParsedRawItem[],
      {
        limit: hydrateOptions.limit,
        timeoutMs: 12_000,
        concurrency: 2,
        fallbackHydrator: createAccesswireNasHydrationFallback(),
      },
    ),
  );

  return nasFallback ? { ...readRecord(result), nas_fallback: nasFallback } : result;
}

export async function runFdaNewsIngestWithFallback(options: NewsIngestOptions) {
  let nasFallback: Record<string, unknown> | null = null;

  const result = await runFdaNewsIngestWithRawFetcher(async (rawOptions) => {
    const directResult = await fetchFdaRawItems(rawOptions);
    if (!shouldUseFdaNasFallback(directResult, rawOptions)) return directResult;

    const env = getServerEnv();
    const fallbackResult = await runNasBridge<FdaRawFetchResult>({
      bridgeUrl: env.fdaIngestUrl,
      directResult,
      fallbackFrom: "next_fda_direct_raw_fetch",
      missingError: "FDA_INGEST_URL is not configured",
      options: rawOptions,
      source: "fda",
      token: env.nasIngestToken,
    });
    nasFallback = {
      ...fallbackDiagnostics("FDA_INGEST_URL", directResult, fallbackResult),
      direct_article_bodies_requested:
        readRecord(readRecord(directResult)?.diagnostics)?.articleBodiesRequested || null,
      direct_article_bodies_fetched:
        readRecord(readRecord(directResult)?.diagnostics)?.articleBodiesFetched || null,
    };

    return fallbackResult.ok && fallbackResult.data ? fallbackResult.data : directResult;
  }, options, (items, hydrateOptions) =>
    hydrateFdaRawItems(
      items as FdaParsedRawItem[],
      {
        limit: hydrateOptions.limit,
        timeoutMs: 12_000,
        concurrency: 2,
        fallbackHydrator: createFdaNasHydrationFallback(),
      },
    ),
  );

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

function createAccesswireNasHydrationFallback(): AccesswireHydrationFallback {
  const env = getServerEnv();
  return async (item, context) => {
    const result = await runNasBridge<AccesswireRawFetchResult>({
      bridgeUrl: env.accesswireIngestUrl,
      directResult: {
        status: context.directStatus,
        error: context.directError,
      },
      fallbackFrom: "next_accesswire_direct_article_hydration",
      missingError: "ACCESSWIRE_INGEST_URL is not configured",
      options: {
        limit: 1,
        sourceUniqueId: item.source_unique_id || undefined,
        includeArticleBody: true,
        articleBodyLimit: 1,
      },
      source: "accesswire",
      token: env.nasIngestToken,
      timeoutMs: context.timeoutMs,
      signal: context.signal,
    });
    const fallbackItem = result.ok
      ? findMatchingAccesswireItem(result.data, item)
      : null;
    return {
      ok: Boolean(result.ok && fallbackItem),
      status: result.status,
      item: fallbackItem,
      error:
        result.error ||
        (result.ok && !fallbackItem
          ? "Access Newswire NAS bridge returned no matching hydrated item"
          : undefined),
      timedOut: result.timedOut,
    };
  };
}

function createFdaNasHydrationFallback(): FdaHydrationFallback {
  const env = getServerEnv();
  return async (item, context) => {
    const result = await runNasBridge<FdaRawFetchResult>({
      bridgeUrl: env.fdaIngestUrl,
      directResult: {
        status: context.directStatus,
        error: context.directError,
      },
      fallbackFrom: "next_fda_direct_article_hydration",
      missingError: "FDA_INGEST_URL is not configured",
      options: {
        limit: 1,
        sourceUniqueId: item.source_unique_id || item.source_url,
        includeArticleBody: true,
        articleBodyLimit: 1,
      },
      source: "fda",
      token: env.nasIngestToken,
      timeoutMs: context.timeoutMs,
      signal: context.signal,
    });
    const fallbackItem = result.ok
      ? findMatchingFdaItem(result.data, item)
      : null;
    return {
      ok: Boolean(result.ok && fallbackItem),
      status: result.status,
      item: fallbackItem,
      error:
        result.error ||
        (result.ok && !fallbackItem
          ? "FDA NAS bridge returned no matching hydrated item"
          : undefined),
      timedOut: result.timedOut,
    };
  };
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

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
