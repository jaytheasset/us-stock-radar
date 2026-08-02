import "server-only";

import type { AnalysisPeerFillerBuckets } from "@/lib/analysisPeerSelection";
import {
  ANALYSIS_PEER_PROVIDER_RESULT_LIMIT,
  analysisPeerProviderFilterKey,
  buildAnalysisPeerProviderFilters,
  mergeProviderFillerCandidate,
  normalizeAnalysisPeerProviderCompanies,
  normalizeAnalysisPeerProviderRows,
  type AnalysisPeerProviderCompany,
  type AnalysisPeerProviderClassification,
  type AnalysisPeerProviderFilter,
} from "@/lib/analysisPeerProviderContract";
import { getServerEnv } from "@/lib/env";
import { createMarketRequestCoalescer } from "@/lib/marketRequestCoalescing";

const analysisPeerProviderCacheTtlMs = 60 * 60 * 1000;
const analysisPeerProviderCacheMaxEntries = 100;
const analysisPeerProviderTimeoutMs = 10_000;
const analysisPeerProfileConcurrency = 3;
const providerCache = new Map<
  string,
  { data: unknown[]; expiresAt: number }
>();
const providerRequests = createMarketRequestCoalescer();

export async function loadAnalysisPeerProviderFillers({
  classification,
  excludeSymbols,
  limit,
}: {
  classification: AnalysisPeerProviderClassification;
  excludeSymbols: string[];
  limit: number;
}): Promise<AnalysisPeerFillerBuckets> {
  const requestedLimit = Math.max(0, Math.min(6, Math.floor(limit)));
  if (!requestedLimit) return {};

  const apiKey = getServerEnv().fmpApiKey;
  if (!apiKey) return {};

  const selected = new Set(
    excludeSymbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean),
  );
  const buckets: AnalysisPeerFillerBuckets = {};
  let added = 0;

  for (const filter of buildAnalysisPeerProviderFilters(classification)) {
    const rows = await readProviderFilter(filter, apiKey);
    for (const candidate of normalizeAnalysisPeerProviderRows(
      rows,
      filter.bucket,
    )) {
      if (selected.has(candidate.symbol)) continue;
      selected.add(candidate.symbol);
      mergeProviderFillerCandidate(buckets, candidate);
      added += 1;
      if (added >= requestedLimit) return buckets;
    }
  }

  return buckets;
}

export async function loadAnalysisPeerProviderCompanies(symbols: string[]) {
  const normalizedSymbols = Array.from(
    new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean)),
  ).slice(0, 6);
  const apiKey = getServerEnv().fmpApiKey;
  if (!apiKey || !normalizedSymbols.length) {
    return new Map<string, AnalysisPeerProviderCompany>();
  }

  const companies: AnalysisPeerProviderCompany[] = [];
  for (
    let index = 0;
    index < normalizedSymbols.length;
    index += analysisPeerProfileConcurrency
  ) {
    const batch = normalizedSymbols.slice(
      index,
      index + analysisPeerProfileConcurrency,
    );
    const results = await Promise.all(
      batch.map(async (symbol) => {
        const rows = await readProviderProfile(symbol, apiKey);
        return normalizeAnalysisPeerProviderCompanies(rows).find(
          (company) => company.symbol === symbol,
        );
      }),
    );
    companies.push(
      ...results.filter(
        (company): company is AnalysisPeerProviderCompany => Boolean(company),
      ),
    );
  }

  return new Map(companies.map((company) => [company.symbol, company]));
}

async function readProviderFilter(
  filter: AnalysisPeerProviderFilter,
  apiKey: string,
) {
  const key = analysisPeerProviderFilterKey(filter);
  const cached = providerCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  if (cached) providerCache.delete(key);

  return providerRequests.run(key, async () => {
    const current = providerCache.get(key);
    if (current && current.expiresAt > Date.now()) return current.data;
    const rows = await fetchProviderFilter(filter, apiKey);
    if (!rows) return [];
    setProviderCache(key, rows);
    return rows;
  });
}

async function readProviderProfile(symbol: string, apiKey: string) {
  const key = `profile:${symbol}`;
  const cached = providerCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  if (cached) providerCache.delete(key);

  return providerRequests.run(key, async () => {
    const current = providerCache.get(key);
    if (current && current.expiresAt > Date.now()) return current.data;
    const url = new URL("https://financialmodelingprep.com/stable/profile");
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("apikey", apiKey);
    const rows = await fetchProviderRows(url);
    if (!rows) return [];
    setProviderCache(key, rows);
    return rows;
  });
}

async function fetchProviderFilter(
  filter: AnalysisPeerProviderFilter,
  apiKey: string,
) {
  const url = new URL(
    "https://financialmodelingprep.com/stable/company-screener",
  );
  url.searchParams.set("limit", String(ANALYSIS_PEER_PROVIDER_RESULT_LIMIT));
  url.searchParams.set("isEtf", "false");
  url.searchParams.set("isFund", "false");
  url.searchParams.set("isActivelyTrading", "true");
  url.searchParams.set("marketCapMoreThan", "1000000");
  if (filter.industry) url.searchParams.set("industry", filter.industry);
  if (filter.sector) url.searchParams.set("sector", filter.sector);
  url.searchParams.set("apikey", apiKey);

  return fetchProviderRows(url);
}

async function fetchProviderRows(url: URL) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), analysisPeerProviderTimeoutMs);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    return response.ok && Array.isArray(data) ? data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function setProviderCache(key: string, data: unknown[]) {
  if (providerCache.size >= analysisPeerProviderCacheMaxEntries) {
    const oldestKey = providerCache.keys().next().value;
    if (oldestKey) providerCache.delete(oldestKey);
  }
  providerCache.set(key, {
    data,
    expiresAt: Date.now() + analysisPeerProviderCacheTtlMs,
  });
}
