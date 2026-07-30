import "server-only";

import { createHash } from "node:crypto";
import { getServerEnv } from "@/lib/env";
import {
  KlipyProviderError,
  normalizeKlipyMediaId,
  normalizeKlipySearchInput,
  parseKlipyResponse,
} from "./policy";
import type {
  KlipyMediaAttachment,
  KlipyResolvedMediaAttachment,
  KlipySearchPage,
} from "./types";

const API_BASE_URL = "https://api.klipy.com/v2";
const CONTENT_FILTER = "high";
const FETCH_TIMEOUT_MS = 6_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const SEARCH_CACHE_TTL_MS = 10 * 60_000;
const MEDIA_CACHE_TTL_MS = 30 * 60_000;
const MAX_SEARCH_CACHE_ENTRIES = 100;
const MAX_MEDIA_CACHE_ENTRIES = 500;

type TimedValue<T> = { expiresAt: number; value: T };

const searchCache = new Map<string, TimedValue<KlipySearchPage>>();
const mediaCache = new Map<
  string,
  TimedValue<KlipyResolvedMediaAttachment>
>();

export async function searchKlipy(input: {
  cursor?: unknown;
  limit?: unknown;
  query?: unknown;
}) {
  const normalized = normalizeKlipySearchInput(input);
  const cacheKey = JSON.stringify(normalized);
  const cached = readCache(searchCache, cacheKey);
  if (cached) return cached;

  const endpoint = normalized.query ? "/search" : "/featured";
  const params = new URLSearchParams({
    contentfilter: CONTENT_FILTER,
    limit: String(normalized.limit),
  });
  if (normalized.query) params.set("q", normalized.query);
  if (normalized.cursor) params.set("pos", normalized.cursor);
  const page = await fetchKlipyPage(endpoint, params);
  writeCache(
    searchCache,
    cacheKey,
    page,
    SEARCH_CACHE_TTL_MS,
    MAX_SEARCH_CACHE_ENTRIES,
  );
  cacheMedia(page.items);
  return page;
}

export async function resolveKlipyMedia(
  mediaIdValue: unknown,
): Promise<KlipyResolvedMediaAttachment> {
  const mediaId = normalizeKlipyMediaId(mediaIdValue);
  const cached = readCache(mediaCache, mediaId);
  if (cached) return cached;

  const page = await fetchKlipyPage(
    "/posts",
    new URLSearchParams({ ids: mediaId }),
  );
  const media = page.items.find(
    (item) => item.providerMediaId === mediaId,
  );
  if (!media) {
    throw new KlipyProviderError(
      "KLIPY_MEDIA_NOT_FOUND",
      "That KLIPY GIF is no longer available.",
      404,
    );
  }
  const resolved = withFingerprint(media);
  writeCache(
    mediaCache,
    mediaId,
    resolved,
    MEDIA_CACHE_TTL_MS,
    MAX_MEDIA_CACHE_ENTRIES,
  );
  return resolved;
}

async function fetchKlipyPage(
  endpoint: "/featured" | "/posts" | "/search",
  params: URLSearchParams,
) {
  const apiKey = getServerEnv().klipyApiKey;
  if (!apiKey) {
    throw new KlipyProviderError(
      "KLIPY_NOT_CONFIGURED",
      "KLIPY search is not configured.",
      503,
    );
  }

  const url = new URL(`${API_BASE_URL}${endpoint}`);
  params.forEach((value, key) => url.searchParams.set(key, value));
  url.searchParams.set("key", apiKey);

  let response: Response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    throw new KlipyProviderError(
      timedOut ? "KLIPY_TIMEOUT" : "KLIPY_UNAVAILABLE",
      timedOut
        ? "KLIPY took too long to respond. Try again."
        : "KLIPY search is temporarily unavailable.",
      timedOut ? 504 : 502,
    );
  }

  const retryAfterSeconds = readRetryAfter(response.headers);
  if (response.status === 429) {
    throw new KlipyProviderError(
      "KLIPY_RATE_LIMITED",
      "KLIPY is busy. Try again shortly.",
      429,
      retryAfterSeconds,
    );
  }
  if (!response.ok) {
    throw new KlipyProviderError(
      "KLIPY_UNAVAILABLE",
      "KLIPY search is temporarily unavailable.",
      502,
    );
  }

  const contentLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_RESPONSE_BYTES
  ) {
    throw invalidResponse();
  }
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) throw invalidResponse();
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw invalidResponse();
  }
  return parseKlipyResponse(payload);
}

function cacheMedia(items: readonly KlipyMediaAttachment[]) {
  for (const item of items) {
    writeCache(
      mediaCache,
      item.providerMediaId,
      withFingerprint(item),
      MEDIA_CACHE_TTL_MS,
      MAX_MEDIA_CACHE_ENTRIES,
    );
  }
}

function withFingerprint(
  media: KlipyMediaAttachment,
): KlipyResolvedMediaAttachment {
  const contentFingerprint = createHash("sha256")
    .update(
      [
        media.provider,
        media.providerMediaId,
        media.displayUrl,
        media.previewUrl,
        media.itemUrl,
        media.width,
        media.height,
      ].join("\n"),
    )
    .digest("hex");
  return { ...media, contentFingerprint };
}

function readCache<T>(cache: Map<string, TimedValue<T>>, key: string) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
}

function writeCache<T>(
  cache: Map<string, TimedValue<T>>,
  key: string,
  value: T,
  ttlMs: number,
  maxEntries: number,
) {
  cache.delete(key);
  cache.set(key, { expiresAt: Date.now() + ttlMs, value });
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (typeof oldestKey !== "string") break;
    cache.delete(oldestKey);
  }
}

function readRetryAfter(headers: Headers) {
  const value = Number(headers.get("retry-after"));
  return Number.isFinite(value) && value > 0 ? Math.ceil(value) : 60;
}

function invalidResponse() {
  return new KlipyProviderError(
    "KLIPY_RESPONSE_INVALID",
    "KLIPY returned an invalid response.",
    502,
  );
}
