import { getEventTypeBadge } from "@/lib/eventTypeRegistry";
import { getLiveFeedViewModel, type FeedTone, type LiveFeedItem } from "@/lib/liveFeed";
import { supabaseSelect } from "@/lib/supabase";

export const newsV2Signals = ["Bullish", "Bearish", "Neutral", "Volatile"] as const;
export const newsV2MarketCapBands = ["Mega", "Large", "Mid", "Small", "Micro"] as const;

export type NewsV2Signal = (typeof newsV2Signals)[number];
export type NewsV2MarketCapBand = (typeof newsV2MarketCapBands)[number];
export type NewsV2Category = "Macro" | "Sector" | "Theme" | "Company";

export type NewsV2Item = {
  id: string;
  publishedAt: string;
  headline: string;
  summary: string;
  source: string;
  category: NewsV2Category;
  relatedTickers: string[];
  sentiment: NewsV2Signal;
  score: number;
  sector?: string;
  theme?: string;
  eventType: string;
  eventTypeCode: string;
  marketCapBand?: NewsV2MarketCapBand;
  priceLabel?: string;
  changePercent?: string;
  deliveryLevel: "archive" | "feed" | "alert";
};

export type NewsV2SourceActivity = {
  source: string;
  count: number;
  averageScore: number;
};

export type NewsV2SectorActivity = {
  sector: string;
  count: number;
  averageScore: number;
};

export type NewsV2SignalActivity = {
  label: string;
  count: number;
  averageScore: number;
  sentiment: NewsV2Signal;
};

export type NewsV2PageData = {
  items: NewsV2Item[];
  total: number;
  sourceActivity: NewsV2SourceActivity[];
  sectorActivity: NewsV2SectorActivity[];
  signalActivity: NewsV2SignalActivity[];
  error?: string;
};

export async function getNewsV2PageData(): Promise<NewsV2PageData> {
  const viewModel = await getLiveFeedViewModel({
    page: 1,
    limit: 100,
    tab: "news",
    includeCharts: false,
    includeSharedData: false,
  });

  if (!viewModel.ok) {
    return {
      items: [],
      total: 0,
      sourceActivity: [],
      sectorActivity: [],
      signalActivity: [],
      error: viewModel.error || "News data is currently unavailable.",
    };
  }

  const marketCapByTicker = await fetchMarketCapByTicker(viewModel.feedItems);
  const items = viewModel.feedItems.map((item) => toNewsV2Item(item, marketCapByTicker));

  return {
    items,
    total: viewModel.total ?? items.length,
    sourceActivity: aggregateSources(items),
    sectorActivity: aggregateSectors(items),
    signalActivity: aggregateSignals(items),
  };
}

function toNewsV2Item(item: LiveFeedItem, marketCapByTicker: Map<string, number>): NewsV2Item {
  const ticker = normalizeTicker(item.ticker);
  const eventType = getEventTypeBadge(item.eventType).label;
  const marketCap = ticker ? marketCapByTicker.get(ticker) : undefined;
  const priceLabel = usableMarketValue(item.displayPrice);

  return {
    id: item.id,
    publishedAt: item.detectedAtRaw || new Date().toISOString(),
    headline: item.title,
    summary: item.quickTake || item.summary,
    source: item.source,
    category: marketScopeToCategory(item.marketScope),
    relatedTickers: ticker ? [ticker] : [],
    sentiment: formatSignal(item.signal),
    score: item.score,
    sector: item.sector || undefined,
    theme: item.themeGroup || item.subTheme || undefined,
    eventType,
    eventTypeCode: item.eventType,
    marketCapBand: marketCap ? marketCapBand(marketCap) : undefined,
    priceLabel,
    changePercent: priceLabel ? usableMarketValue(item.displayChange) : undefined,
    deliveryLevel: item.deliveryLevel,
  };
}

async function fetchMarketCapByTicker(items: LiveFeedItem[]) {
  const tickers = Array.from(
    new Set(items.map((item) => normalizeTicker(item.ticker)).filter((ticker): ticker is string => Boolean(ticker))),
  );
  const output = new Map<string, number>();
  if (!tickers.length) return output;

  const result = await supabaseSelect("tickers_cache", {
    select: "symbol,market_cap",
    symbol: `in.(${tickers.join(",")})`,
    limit: String(tickers.length),
  });

  if (!result.ok || !Array.isArray(result.data)) return output;

  for (const row of result.data) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const symbol = typeof record.symbol === "string" ? record.symbol.trim().toUpperCase() : "";
    const value = typeof record.market_cap === "number" ? record.market_cap : Number(record.market_cap);
    if (symbol && Number.isFinite(value) && value > 0) output.set(symbol, value);
  }

  return output;
}

function aggregateSources(items: NewsV2Item[]) {
  return aggregate(items, (item) => item.source)
    .slice(0, 6)
    .map(({ label, ...rest }) => ({ source: label, ...rest }));
}

function aggregateSectors(items: NewsV2Item[]) {
  return aggregate(items, (item) => item.sector || "")
    .slice(0, 6)
    .map(({ label, ...rest }) => ({ sector: label, ...rest }));
}

function aggregateSignals(items: NewsV2Item[]) {
  const groups = new Map<string, NewsV2Item[]>();
  for (const item of items) {
    const label = item.theme || item.eventType;
    const current = groups.get(label) || [];
    current.push(item);
    groups.set(label, current);
  }

  return Array.from(groups.entries())
    .map(([label, rows]) => ({
      label,
      count: rows.length,
      averageScore: average(rows.map((row) => row.score)),
      sentiment: dominantSignal(rows),
    }))
    .sort((a, b) => b.count - a.count || b.averageScore - a.averageScore)
    .slice(0, 6);
}

function aggregate(items: NewsV2Item[], readLabel: (item: NewsV2Item) => string) {
  const groups = new Map<string, number[]>();
  for (const item of items) {
    const label = readLabel(item).trim();
    if (!label) continue;
    const scores = groups.get(label) || [];
    scores.push(item.score);
    groups.set(label, scores);
  }

  return Array.from(groups.entries())
    .map(([label, scores]) => ({ label, count: scores.length, averageScore: average(scores) }))
    .sort((a, b) => b.count - a.count || b.averageScore - a.averageScore);
}

function average(values: number[]) {
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function dominantSignal(items: NewsV2Item[]): NewsV2Signal {
  const counts = new Map<NewsV2Signal, number>();
  for (const item of items) counts.set(item.sentiment, (counts.get(item.sentiment) || 0) + 1);
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "Neutral";
}

function marketScopeToCategory(scope: LiveFeedItem["marketScope"]): NewsV2Category {
  if (scope === "macro") return "Macro";
  if (scope === "sector") return "Sector";
  if (scope === "theme") return "Theme";
  return "Company";
}

function formatSignal(signal: FeedTone): NewsV2Signal {
  return `${signal[0].toUpperCase()}${signal.slice(1)}` as NewsV2Signal;
}

function marketCapBand(value: number): NewsV2MarketCapBand {
  if (value >= 200_000_000_000) return "Mega";
  if (value >= 10_000_000_000) return "Large";
  if (value >= 2_000_000_000) return "Mid";
  if (value >= 300_000_000) return "Small";
  return "Micro";
}

function normalizeTicker(value: string) {
  const ticker = value.trim().toUpperCase();
  return ticker && ticker !== "N/A" ? ticker : "";
}

function usableMarketValue(value: string) {
  const normalized = value.trim();
  return normalized && normalized !== "N/A" && normalized !== "-" ? normalized : undefined;
}
