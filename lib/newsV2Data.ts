import "server-only";

import { unstable_cache } from "next/cache";
import { getEventTypeBadge } from "@/lib/eventTypeRegistry";
import {
  readMarketBarCacheMap,
} from "@/lib/marketDataCache";
import { readHydratedMarketQuoteMap } from "@/lib/marketQuoteHydration";
import {
  canonicalNewsSubThemeSlug,
  canonicalNewsThemeGroupSlug,
  expandNewsV2SectorFilterValues,
  expandNewsV2ThemeFilterValues,
  newsMarketScopeToCategory,
  normalizeNewsV2SectorFilterOptions,
  normalizeNewsV2Signal,
  normalizeNewsV2ThemeFilterOptions,
  type NewsV2Cursor,
  type NewsV2FilterOptions,
  type NewsV2FilterState,
  type NewsV2Item,
  type NewsV2PageData,
  type NewsV2PageResponse,
  type NewsV2SourceActivity,
  type NewsV2ThemeActivity,
} from "@/lib/newsV2";
import {
  parseNewsV2Statistics,
  parseSourceActivity,
  parseThemeActivity,
} from "@/lib/newsV2ApiContract";
import { hydrateNewsV2ItemMarketData } from "@/lib/newsV2MarketHydration";
import { supabaseRpc } from "@/lib/supabase";

type UnknownRecord = Record<string, unknown>;

type LoadNewsV2PageParams = {
  cursor?: NewsV2Cursor | null;
  filters?: NewsV2FilterState;
  includeTotal?: boolean;
  query?: string;
};

export const newsV2PageSize = 25;
const newsV2StatisticsCacheSeconds = 15;

const emptyFilterOptions: NewsV2FilterOptions = {
  eventTypes: [],
  sources: [],
  sectors: [],
  themes: [],
};

export async function getNewsV2PageData(): Promise<NewsV2PageData> {
  const [page, facets] = await Promise.all([
    loadNewsV2Page({ includeTotal: true }),
    loadNewsV2FacetsWithCache(),
  ]);

  return {
    items: page.items,
    total: page.totalCount ?? page.items.length,
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
    filterOptions: facets?.filterOptions ?? emptyFilterOptions,
    sourceActivity: page.statistics?.sourceActivity ?? facets?.sourceActivity ?? [],
    sectorActivity: [],
    signalActivity: [],
    themeActivity: page.statistics?.themeActivity ?? facets?.themeActivity ?? [],
    error: page.error,
  };
}

export async function loadNewsV2Page({
  cursor,
  filters,
  includeTotal = true,
  query = "",
}: LoadNewsV2PageParams = {}): Promise<NewsV2PageResponse> {
  const rpcPayload = {
    p_cursor_id: cursor?.id ?? null,
    p_cursor_published_at: cursor?.publishedAt ?? null,
    p_event_types: filters?.eventTypes ?? [],
    p_include_total: includeTotal,
    p_limit: newsV2PageSize,
    p_market_caps: filters?.marketCaps ?? [],
    p_query: query.trim() || null,
    p_sectors: expandNewsV2SectorFilterValues(filters?.sectors ?? []),
    p_signals: filters?.sentiments.map((value) => value.toLowerCase()) ?? [],
    p_sources: filters?.sources ?? [],
    p_themes: expandNewsV2ThemeFilterValues(filters?.themes ?? []),
  };
  const result = includeTotal && !cursor
    ? await loadNewsV2FirstPageWithCache(rpcPayload)
    : await supabaseRpc("search_news_v2", rpcPayload);
  const payload = asRecord(result.data);

  if (!result.ok || !payload) {
    return {
      error: result.error || "News data is currently unavailable.",
      hasMore: false,
      items: [],
      nextCursor: null,
      statistics: null,
      totalCount: null,
    };
  }

  const rows = Array.isArray(payload.items) ? payload.items.filter(isRecord) : [];
  const baseItems = rows
    .map(mapNewsRow)
    .filter((item): item is NewsV2Item => Boolean(item));
  const items = await enrichNewsItems(baseItems);

  return {
    hasMore: payload.has_more === true,
    items,
    nextCursor: readCursor(asRecord(payload.next_cursor)),
    statistics: parseNewsV2Statistics(payload.statistics),
    totalCount: finiteNumber(payload.total),
  };
}

async function loadNewsV2Facets() {
  const result = await supabaseRpc("get_news_v2_facets", {});
  const payload = asRecord(result.data);
  if (!result.ok || !payload) return null;

  const sourceActivity = Array.isArray(payload.source_activity)
    ? payload.source_activity
      .map(parseSourceActivity)
      .filter((item): item is NewsV2SourceActivity => Boolean(item))
    : [];
  const themeActivity = Array.isArray(payload.theme_activity)
    ? payload.theme_activity
      .map(parseThemeActivity)
      .filter((item): item is NewsV2ThemeActivity => Boolean(item))
    : [];

  return {
    filterOptions: {
      eventTypes: readStringArray(payload.event_types),
      sources: readStringArray(payload.sources),
      sectors: normalizeNewsV2SectorFilterOptions(readStringArray(payload.sectors)),
      themes: normalizeNewsV2ThemeFilterOptions(readStringArray(payload.themes)),
    } satisfies NewsV2FilterOptions,
    sourceActivity,
    themeActivity,
  };
}

const loadCachedNewsV2Facets = unstable_cache(
  async () => {
    const facets = await loadNewsV2Facets();
    if (!facets) throw new Error("News filter facets are unavailable.");
    return facets;
  },
  ["news-v2-filter-options-v3-market-score-75"],
  { revalidate: 300, tags: ["news-v2-facets"] },
);

const loadCachedNewsV2FirstPage = unstable_cache(
  async (serializedPayload: string) => {
    const result = await supabaseRpc(
      "search_news_v2",
      JSON.parse(serializedPayload) as Record<string, unknown>,
    );
    if (!result.ok) throw new Error(result.error || "News search is unavailable.");
    return result;
  },
  ["news-v2-filtered-first-page-v2-market-score-75"],
  { revalidate: newsV2StatisticsCacheSeconds },
);

async function loadNewsV2FirstPageWithCache(
  payload: Record<string, unknown>,
) {
  const serializedPayload = JSON.stringify(payload);
  try {
    return await loadCachedNewsV2FirstPage(serializedPayload);
  } catch {
    return supabaseRpc("search_news_v2", payload);
  }
}

async function loadNewsV2FacetsWithCache() {
  try {
    return await loadCachedNewsV2Facets();
  } catch {
    return loadNewsV2Facets();
  }
}

function mapNewsRow(row: UnknownRecord): NewsV2Item | null {
  const id = readString(row.id);
  const publishedAt = readString(row.published_at);
  if (!id || !publishedAt || !Number.isFinite(Date.parse(publishedAt))) return null;

  const ticker = normalizeTicker(readString(row.ticker));
  const eventTypeCode = readString(row.event_type) || "event";
  const sector = readString(row.sector);
  const themeGroup = readString(row.theme_group);
  const subTheme = readString(row.sub_theme);
  const themes = Array.from(
    new Set([themeGroup, subTheme].filter((value): value is string => Boolean(value))),
  );
  const marketCapBand = readString(row.market_cap_band);
  const deliveryLevel = readDeliveryLevel(row.delivery_level);

  return {
    id,
    publishedAt,
    headline: readString(row.headline) || "Untitled event",
    summary: readString(row.summary) || "No summary available yet.",
    source: readString(row.source) || "Unknown",
    category: newsMarketScopeToCategory(readString(row.market_scope) || "company"),
    relatedTickers: ticker ? [ticker] : [],
    sentiment: normalizeNewsV2Signal(readString(row.signal) || "neutral"),
    score: clampScore(finiteNumber(row.score) ?? 50),
    sector,
    theme: themeGroup || subTheme,
    themeGroupSlug: canonicalNewsThemeGroupSlug(themeGroup),
    subThemeSlug: canonicalNewsSubThemeSlug(subTheme),
    relatedSectors: sector ? [sector] : [],
    themes,
    eventType: getEventTypeBadge(eventTypeCode).label,
    eventTypeCode,
    marketCapBand: isMarketCapBand(marketCapBand) ? marketCapBand : undefined,
    trend: [],
    deliveryLevel,
  };
}

async function enrichNewsItems(items: NewsV2Item[]) {
  const symbols = Array.from(
    new Set(items.flatMap((item) => item.relatedTickers).filter(Boolean)),
  );
  const [quoteMap, chartMap] = await Promise.all([
    readHydratedMarketQuoteMap(symbols),
    readMarketBarCacheMap(symbols, "1D"),
  ]);

  return items.map((item) => {
    const symbol = item.relatedTickers[0];
    if (!symbol) return item;

    const quote = quoteMap.get(symbol);
    const chart = chartMap.get(symbol);
    return hydrateNewsV2ItemMarketData(item, quote, chart);
  });
}

function readCursor(value: UnknownRecord | null): NewsV2Cursor | null {
  const id = readString(value?.id);
  const publishedAt = readString(value?.published_at);
  if (!id || !publishedAt || !Number.isFinite(Date.parse(publishedAt))) return null;
  return { id, publishedAt };
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(value.map(readString).filter((item): item is string => Boolean(item))),
  );
}

function readDeliveryLevel(value: unknown): NewsV2Item["deliveryLevel"] {
  const normalized = readString(value)?.toLowerCase();
  if (normalized === "alert") return "alert";
  if (normalized === "archive") return "archive";
  return "feed";
}

function isMarketCapBand(value?: string): value is NonNullable<NewsV2Item["marketCapBand"]> {
  return ["Mega", "Large", "Mid", "Small", "Micro"].includes(value || "");
}

function normalizeTicker(value?: string) {
  const ticker = (value || "").trim().toUpperCase();
  return ticker && ticker !== "N/A" ? ticker : "";
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(asRecord(value));
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function finiteNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}
