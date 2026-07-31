import { getServerEnv } from "../env.ts";
import {
  normalizeStockFundamentals,
  type StockFundamentalsProviderResult,
  type StockFundamentalsProviderSources,
} from "./stockFundamentals.ts";

const FMP_STABLE_BASE_URL = "https://financialmodelingprep.com/stable";
const FUNDAMENTALS_TIMEOUT_MS = 15_000;
const READY_CACHE_SECONDS = 60 * 60;
const PLAN_CACHE_SECONDS = 24 * 60 * 60;
const FAILURE_CACHE_SECONDS = 10 * 60;
const CACHE_TABLE = "stock_fundamentals_provider_cache";

const staticSourceDefinitions = {
  balanceAnnual: {
    endpoint: "balance-sheet-statement",
    params: { limit: "5", period: "annual" },
  },
  balanceQuarterly: {
    endpoint: "balance-sheet-statement",
    params: { limit: "5", period: "quarter" },
  },
  beneficialOwnership: {
    endpoint: "acquisition-of-beneficial-ownership",
    params: {},
  },
  cashAnnual: {
    endpoint: "cash-flow-statement",
    params: { limit: "5", period: "annual" },
  },
  cashQuarterly: {
    endpoint: "cash-flow-statement",
    params: { limit: "5", period: "quarter" },
  },
  enterpriseValues: {
    endpoint: "enterprise-values",
    params: { limit: "8", period: "quarter" },
  },
  incomeAnnual: {
    endpoint: "income-statement",
    params: { limit: "5", period: "annual" },
  },
  incomeQuarterly: {
    endpoint: "income-statement",
    params: { limit: "5", period: "quarter" },
  },
  insiderStatistics: {
    endpoint: "insider-trading/statistics",
    params: {},
  },
  insiderTrades: {
    endpoint: "insider-trading/search",
    params: { limit: "20", page: "0" },
  },
  sharesFloat: {
    endpoint: "shares-float",
    params: {},
  },
  splits: {
    endpoint: "splits",
    params: {},
  },
} as const;

type SourceKey = keyof StockFundamentalsProviderSources;
type SourceDefinition = {
  endpoint: string;
  params: Readonly<Record<string, string>>;
};
type FetchLike = (
  input: string | URL,
  init?: RequestInit & { next?: { revalidate: number } },
) => Promise<Response>;

type CacheRow = {
  expires_at?: unknown;
  fetched_at?: unknown;
  http_status?: unknown;
  provider_state?: unknown;
  raw_payload?: unknown;
  source_key?: unknown;
};

export async function fetchStockFundamentals(
  symbol: string,
  options: {
    apiKey?: string;
    cache?: boolean;
    fetchImpl?: FetchLike;
    now?: Date;
  } = {},
) {
  const apiKey = options.apiKey ?? getServerEnv().fmpApiKey;
  const fetchImpl = options.fetchImpl ?? fetch;
  const cleanSymbol = normalizeSymbol(symbol);
  const now = options.now ?? new Date();
  const definitions = buildSourceDefinitions(now);
  const entries = Object.entries(definitions) as Array<
    [SourceKey, SourceDefinition]
  >;
  const usePersistentCache = options.cache ?? !options.fetchImpl;
  const cached = usePersistentCache
    ? await readProviderCache(cleanSymbol, now)
    : new Map<SourceKey, StockFundamentalsProviderResult>();

  const fetchedEntries = await Promise.all(
    entries.map(async ([key, definition]) => {
      const cachedSource = cached.get(key);
      if (cachedSource) return [key, cachedSource] as const;
      const source = apiKey
        ? await fetchFmpSource(
            cleanSymbol,
            definition.endpoint,
            definition.params,
            apiKey,
            fetchImpl,
            now,
          )
        : unavailableSource(now);
      return [key, source] as const;
    }),
  );

  const providerSources = Object.fromEntries(
    fetchedEntries,
  ) as StockFundamentalsProviderSources;

  if (usePersistentCache) {
    const writes = fetchedEntries
      .filter(([key]) => !cached.has(key))
      .map(([key, source]) => persistProviderCache(cleanSymbol, key, source, now));
    await Promise.allSettled(writes);
  }

  return normalizeStockFundamentals(
    cleanSymbol,
    providerSources,
    latestFetchedAt(providerSources, now),
  );
}

function buildSourceDefinitions(now: Date): Record<SourceKey, SourceDefinition> {
  const { quarter, year } = latestCompletedQuarter(now);
  return {
    ...staticSourceDefinitions,
    institutionalHolders: {
      endpoint: "institutional-ownership/extract-analytics/holder",
      params: {
        limit: "10",
        page: "0",
        quarter: String(quarter),
        year: String(year),
      },
    },
    institutionalSummary: {
      endpoint: "institutional-ownership/symbol-positions-summary",
      params: { quarter: String(quarter), year: String(year) },
    },
  };
}

async function fetchFmpSource(
  symbol: string,
  endpoint: string,
  params: Readonly<Record<string, string>>,
  apiKey: string,
  fetchImpl: FetchLike,
  now: Date,
): Promise<StockFundamentalsProviderResult> {
  const url = new URL(`${FMP_STABLE_BASE_URL}/${endpoint}`);
  url.searchParams.set("symbol", symbol);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FUNDAMENTALS_TIMEOUT_MS);

  try {
    const response = await fetchImpl(url, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        apikey: apiKey,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        data: [],
        fetchedAt: now.toISOString(),
        httpStatus: response.status,
        state:
          response.status === 402 || response.status === 403
            ? "plan_unavailable"
            : "unavailable",
      };
    }
    const data = await response.json().catch(() => []);
    return {
      data: isCacheablePayload(data) ? data : [],
      fetchedAt: now.toISOString(),
      httpStatus: response.status,
      state: "ready",
    };
  } catch {
    return unavailableSource(now);
  } finally {
    clearTimeout(timeout);
  }
}

async function readProviderCache(symbol: string, now: Date) {
  const { supabaseSelect } = await import("../supabase.ts");
  const result = await supabaseSelect(CACHE_TABLE, {
    expires_at: `gt.${now.toISOString()}`,
    limit: "50",
    select:
      "source_key,provider_state,http_status,raw_payload,fetched_at,expires_at",
    symbol: `eq.${symbol}`,
  });
  const cache = new Map<SourceKey, StockFundamentalsProviderResult>();
  if (!result.ok || !Array.isArray(result.data)) return cache;

  for (const value of result.data) {
    const row = asCacheRow(value);
    const key = normalizeSourceKey(row?.source_key);
    const state = normalizeProviderState(row?.provider_state);
    const fetchedAt = readDate(row?.fetched_at);
    if (!row || !key || !state || !fetchedAt || !isCacheablePayload(row.raw_payload)) {
      continue;
    }
    cache.set(key, {
      data: row.raw_payload,
      fetchedAt,
      httpStatus: readHttpStatus(row.http_status),
      state,
    });
  }
  return cache;
}

async function persistProviderCache(
  symbol: string,
  sourceKey: SourceKey,
  source: StockFundamentalsProviderResult,
  now: Date,
) {
  const { supabaseUpsert } = await import("../supabase.ts");
  const fetchedAt = source.fetchedAt || now.toISOString();
  const ttlSeconds =
    source.state === "ready"
      ? READY_CACHE_SECONDS
      : source.state === "plan_unavailable"
        ? PLAN_CACHE_SECONDS
        : FAILURE_CACHE_SECONDS;
  const expiresAt = new Date(Date.parse(fetchedAt) + ttlSeconds * 1000);
  return supabaseUpsert(
    CACHE_TABLE,
    {
      expires_at: expiresAt.toISOString(),
      fetched_at: fetchedAt,
      http_status: source.httpStatus ?? null,
      provider: "fmp",
      provider_state: source.state,
      raw_payload: isCacheablePayload(source.data) ? source.data : [],
      source_key: sourceKey,
      symbol,
      updated_at: now.toISOString(),
    },
    { onConflict: "symbol,source_key", prefer: "resolution=merge-duplicates,return=minimal" },
  );
}

function unavailableSource(now: Date): StockFundamentalsProviderResult {
  return {
    data: [],
    fetchedAt: now.toISOString(),
    httpStatus: 0,
    state: "unavailable",
  };
}

function latestCompletedQuarter(now: Date) {
  const currentQuarter = Math.floor(now.getUTCMonth() / 3) + 1;
  return currentQuarter === 1
    ? { quarter: 4, year: now.getUTCFullYear() - 1 }
    : { quarter: currentQuarter - 1, year: now.getUTCFullYear() };
}

function latestFetchedAt(
  sources: StockFundamentalsProviderSources,
  fallback: Date,
) {
  const values = Object.values(sources)
    .map((source) => source.fetchedAt || "")
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort();
  return values.at(-1) || fallback.toISOString();
}

function normalizeSourceKey(value: unknown): SourceKey | null {
  if (typeof value !== "string") return null;
  return value in buildSourceDefinitions(new Date()) ? (value as SourceKey) : null;
}

function normalizeProviderState(
  value: unknown,
): StockFundamentalsProviderResult["state"] | null {
  return value === "ready" ||
    value === "plan_unavailable" ||
    value === "unavailable"
    ? value
    : null;
}

function isCacheablePayload(value: unknown): value is Record<string, unknown> | unknown[] {
  return Array.isArray(value) || Boolean(value && typeof value === "object");
}

function asCacheRow(value: unknown): CacheRow | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as CacheRow)
    : null;
}

function readDate(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? value
    : "";
}

function readHttpStatus(value: unknown) {
  const status = typeof value === "number" ? value : Number(value);
  return Number.isInteger(status) && status >= 0 && status <= 599
    ? status
    : undefined;
}

function normalizeSymbol(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 12);
}
