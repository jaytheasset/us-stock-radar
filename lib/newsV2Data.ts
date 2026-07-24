import "server-only";

import { getEventTypeBadge } from "@/lib/eventTypeRegistry";
import {
  readMarketBarCacheMap,
  readMarketQuoteCacheMap,
} from "@/lib/marketDataCache";
import {
  canonicalNewsSubThemeSlug,
  canonicalNewsThemeGroupSlug,
  newsMarketScopeToCategory,
  normalizeNewsV2Signal,
  type NewsV2Cursor,
  type NewsV2FilterOptions,
  type NewsV2FilterState,
  type NewsV2Item,
  type NewsV2PageData,
  type NewsV2PageResponse,
  type NewsV2SourceActivity,
  type NewsV2ThemeActivity,
} from "@/lib/newsV2";
import { supabaseRpc } from "@/lib/supabase";

type UnknownRecord = Record<string, unknown>;

type LoadNewsV2PageParams = {
  cursor?: NewsV2Cursor | null;
  filters?: NewsV2FilterState;
  includeTotal?: boolean;
  query?: string;
};

export const newsV2PageSize = 25;

const emptyFilterOptions: NewsV2FilterOptions = {
  eventTypes: [],
  sources: [],
  sectors: [],
  themes: [],
};

export async function getNewsV2PageData(): Promise<NewsV2PageData> {
  const [page, facets] = await Promise.all([
    loadNewsV2Page({ includeTotal: true }),
    loadNewsV2Facets(),
  ]);

  return {
    items: page.items,
    total: page.totalCount ?? page.items.length,
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
    filterOptions: facets?.filterOptions ?? emptyFilterOptions,
    sourceActivity: facets?.sourceActivity ?? [],
    sectorActivity: [],
    signalActivity: [],
    themeActivity: facets?.themeActivity ?? [],
    error: page.error,
  };
}

export async function loadNewsV2Page({
  cursor,
  filters,
  includeTotal = true,
  query = "",
}: LoadNewsV2PageParams = {}): Promise<NewsV2PageResponse> {
  const result = await supabaseRpc("search_news_v2", {
    p_cursor_id: cursor?.id ?? null,
    p_cursor_published_at: cursor?.publishedAt ?? null,
    p_event_types: filters?.eventTypes ?? [],
    p_include_total: includeTotal,
    p_limit: newsV2PageSize,
    p_market_caps: filters?.marketCaps ?? [],
    p_query: query.trim() || null,
    p_sectors: filters?.sectors ?? [],
    p_signals: filters?.sentiments.map((value) => value.toLowerCase()) ?? [],
    p_sources: filters?.sources ?? [],
    p_themes: filters?.themes ?? [],
  });
  const payload = asRecord(result.data);

  if (!result.ok || !payload) {
    return {
      error: result.error || "News data is currently unavailable.",
      hasMore: false,
      items: [],
      nextCursor: null,
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
    totalCount: finiteNumber(payload.total),
  };
}

async function loadNewsV2Facets() {
  const result = await supabaseRpc("get_news_v2_facets", {});
  const payload = asRecord(result.data);
  if (!result.ok || !payload) return null;

  const sourceActivity = Array.isArray(payload.source_activity)
    ? payload.source_activity
      .map(mapSourceActivity)
      .filter((item): item is NewsV2SourceActivity => Boolean(item))
    : [];
  const themeActivity = Array.isArray(payload.theme_activity)
    ? payload.theme_activity
      .map(mapThemeActivity)
      .filter((item): item is NewsV2ThemeActivity => Boolean(item))
    : [];

  return {
    filterOptions: {
      eventTypes: readStringArray(payload.event_types),
      sources: readStringArray(payload.sources),
      sectors: readStringArray(payload.sectors),
      themes: readStringArray(payload.themes),
    } satisfies NewsV2FilterOptions,
    sourceActivity,
    themeActivity,
  };
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
    readMarketQuoteCacheMap(symbols),
    readMarketBarCacheMap(symbols.slice(0, 20), "1D"),
  ]);

  return items.map((item) => {
    const symbol = item.relatedTickers[0];
    if (!symbol) return item;

    const quote = quoteMap.get(symbol);
    const chart = chartMap.get(symbol);
    const price = quote?.price ?? chart?.latestPrice;
    const changePercent = quote?.changePercent ?? chart?.changePercent;

    return {
      ...item,
      priceLabel: finiteNumber(price) === null ? undefined : formatPrice(price!),
      changePercent:
        finiteNumber(changePercent) === null
          ? undefined
          : formatChangePercent(changePercent!),
      trend: chart?.points.map((point) => point.close).filter(Number.isFinite) ?? [],
    };
  });
}

function mapSourceActivity(value: unknown): NewsV2SourceActivity | null {
  const row = asRecord(value);
  const source = readString(row?.source);
  if (!row || !source) return null;
  const rangeCounts = asRecord(row.range_counts);

  return {
    source,
    count: finiteNumber(row.count) ?? 0,
    averageScore: finiteNumber(row.average_score) ?? 0,
    rangeCounts: {
      Today: finiteNumber(rangeCounts?.Today) ?? 0,
      "5D": finiteNumber(rangeCounts?.["5D"]) ?? 0,
      "1M": finiteNumber(rangeCounts?.["1M"]) ?? 0,
      "3M": finiteNumber(rangeCounts?.["3M"]) ?? 0,
    },
  };
}

function mapThemeActivity(value: unknown): NewsV2ThemeActivity | null {
  const row = asRecord(value);
  const themeGroup = readString(row?.theme_group);
  if (!row || !themeGroup) return null;

  const subThemes = Array.isArray(row.sub_themes)
    ? row.sub_themes
      .map((subTheme): NewsV2ThemeActivity["subThemes"][number] | null => {
        const subThemeRow = asRecord(subTheme);
        const subThemeName = readString(subThemeRow?.sub_theme);
        if (!subThemeRow || !subThemeName) return null;
        return {
          subTheme: subThemeName,
          count: finiteNumber(subThemeRow.count) ?? 0,
          averageScore: finiteNumber(subThemeRow.average_score) ?? 0,
          highImpactCount: finiteNumber(subThemeRow.high_impact_count) ?? 0,
          signalCounts: readSignalCounts(subThemeRow.signal_counts),
        };
      })
      .filter((item): item is NewsV2ThemeActivity["subThemes"][number] => Boolean(item))
    : [];

  return {
    themeGroup,
    count: finiteNumber(row.count) ?? 0,
    averageScore: finiteNumber(row.average_score) ?? 0,
    highImpactCount: finiteNumber(row.high_impact_count) ?? 0,
    signalCounts: readSignalCounts(row.signal_counts),
    subThemes,
  };
}

function readSignalCounts(value: unknown): Record<NewsV2Item["sentiment"], number> {
  const row = asRecord(value);
  return {
    Bullish: finiteNumber(row?.bullish) ?? 0,
    Bearish: finiteNumber(row?.bearish) ?? 0,
    Neutral: finiteNumber(row?.neutral) ?? 0,
    Volatile: finiteNumber(row?.volatile) ?? 0,
  };
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

function formatPrice(value: number) {
  return `$${value.toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}`;
}

function formatChangePercent(value: number) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(2)}%`;
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
