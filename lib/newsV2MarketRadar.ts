import {
  canonicalNewsSubThemeSlug,
  canonicalNewsThemeGroupSlug,
  type NewsV2Item,
  type NewsV2Signal,
  type NewsV2ThemeActivity,
} from "@/lib/newsV2";
import { sectorMappings, themeGroups, themeSubThemes } from "@/lib/taxonomyRegistry";

export type NewsSectorMoverTone = "bullish" | "warm" | "flat" | "bearish";

export type NewsSectorRadarItem = {
  sector: string;
  change: string;
  tone: NewsSectorMoverTone;
  industries: Array<{
    name: string;
    change: string;
    tickers: string[];
    tickerMovers: Array<{ symbol: string; change: string }>;
    marketCap?: string;
    trend?: number[];
  }>;
};

export type NewsThemeMarketData = {
  groups: Array<{ slug: string; change: string; tone: NewsSectorMoverTone }>;
  subThemes: Array<{
    slug: string;
    change: string;
    tone: NewsSectorMoverTone;
    tickers: Array<{ symbol: string; change: string }>;
  }>;
};

export type NewsTrendingSignal = {
  theme: string;
  themeGroupSlug: string;
  score: number;
  signal: NewsV2Signal;
  newsCount: number;
  avgScore: number;
  momentum: string;
  tone: "bullish" | "bearish" | "volatile" | "flat";
  subThemes: Array<{
    name: string;
    slug: string;
    newsCount: number;
    score: number | null;
    tickers: Array<{ symbol: string; change: string }>;
  }>;
};

// Names only. Production values are hydrated from the market-data API.
export const newsSectorRadarFallbacks: NewsSectorRadarItem[] = Array.from(
  new Set(sectorMappings.map((item) => item.sector)),
).map((sector) => ({
  sector,
  change: "—",
  tone: "flat",
  industries: [],
}));

export function buildNewsTrendingSignals(items: NewsV2Item[]): NewsTrendingSignal[] {
  const recentItems = itemsInLatestWindow(items, 30).filter((item) => item.themeGroupSlug);
  const byGroup = groupBy(recentItems, (item) => item.themeGroupSlug || "");

  return themeGroups
    .flatMap((group) => {
      const groupItems = byGroup.get(group.slug) || [];
      if (!groupItems.length) return [];
      const bySubTheme = groupBy(groupItems.filter((item) => item.subThemeSlug), (item) => item.subThemeSlug || "");
      const subThemes = themeSubThemes
        .filter((subTheme) => subTheme.themeGroupSlug === group.slug)
        .map((subTheme) => {
          const rows = bySubTheme.get(subTheme.slug) || [];
          return {
            name: subTheme.name,
            slug: subTheme.slug,
            newsCount: rows.length,
            score: rows.length ? signalStrength(rows) : null,
            tickers: subTheme.seedSymbols.slice(0, 3).map((symbol) => ({ symbol, change: "—" })),
          };
        })
        .sort((left, right) => (right.score || 0) - (left.score || 0) || right.newsCount - left.newsCount || left.name.localeCompare(right.name))
        .slice(0, 6);
      const signal = dominantSignal(groupItems);

      return [{
        theme: group.name,
        themeGroupSlug: group.slug,
        score: signalStrength(groupItems),
        signal,
        newsCount: groupItems.length,
        avgScore: average(groupItems.map((item) => item.score)),
        momentum: "—",
        tone: toneFromSignal(signal),
        subThemes,
      } satisfies NewsTrendingSignal];
    })
    .sort((left, right) => right.score - left.score || right.newsCount - left.newsCount)
    .slice(0, 5);
}

export function buildNewsTrendingSignalsFromActivity(
  activity: NewsV2ThemeActivity[],
): NewsTrendingSignal[] {
  const byGroup = new Map(
    activity.flatMap((item) => {
      const slug = canonicalNewsThemeGroupSlug(item.themeGroup);
      return slug ? [[slug, item] as const] : [];
    }),
  );

  return themeGroups
    .flatMap((group) => {
      const groupActivity = byGroup.get(group.slug);
      if (!groupActivity?.count) return [];

      const bySubTheme = new Map(
        groupActivity.subThemes.flatMap((item) => {
          const slug = canonicalNewsSubThemeSlug(item.subTheme);
          return slug ? [[slug, item] as const] : [];
        }),
      );
      const subThemes = themeSubThemes
        .filter((subTheme) => subTheme.themeGroupSlug === group.slug)
        .map((subTheme) => {
          const item = bySubTheme.get(subTheme.slug);
          return {
            name: subTheme.name,
            slug: subTheme.slug,
            newsCount: item?.count ?? 0,
            score: item?.count ? signalStrengthFromActivity(item) : null,
            tickers: subTheme.seedSymbols
              .slice(0, 3)
              .map((symbol) => ({ symbol, change: "\u2014" })),
          };
        })
        .sort(
          (left, right) =>
            (right.score || 0) - (left.score || 0) ||
            right.newsCount - left.newsCount ||
            left.name.localeCompare(right.name),
        )
        .slice(0, 6);
      const signal = dominantSignalFromCounts(groupActivity.signalCounts);

      return [{
        theme: group.name,
        themeGroupSlug: group.slug,
        score: signalStrengthFromActivity(groupActivity),
        signal,
        newsCount: groupActivity.count,
        avgScore: Math.round(groupActivity.averageScore),
        momentum: "\u2014",
        tone: toneFromSignal(signal),
        subThemes,
      } satisfies NewsTrendingSignal];
    })
    .sort((left, right) => right.score - left.score || right.newsCount - left.newsCount)
    .slice(0, 5);
}

export function mergeThemeMarketData(
  themes: NewsTrendingSignal[],
  marketData?: NewsThemeMarketData | null,
): NewsTrendingSignal[] {
  if (!marketData) return themes;
  const groups = new Map(marketData.groups.map((group) => [group.slug, group]));
  const subThemes = new Map(marketData.subThemes.map((subTheme) => [subTheme.slug, subTheme]));

  return themes.map((theme) => {
    const groupMarket = groups.get(theme.themeGroupSlug);
    return {
      ...theme,
      momentum: groupMarket?.change || "—",
      tone: groupMarket ? toneFromMarket(groupMarket.tone) : theme.tone,
      subThemes: theme.subThemes.map((subTheme) => {
        const market = subThemes.get(subTheme.slug);
        return {
          ...subTheme,
          tickers: market?.tickers.length ? market.tickers : subTheme.tickers,
        };
      }),
    };
  });
}

function itemsInLatestWindow(items: NewsV2Item[], days: number) {
  const timestamps = items.map((item) => Date.parse(item.publishedAt)).filter(Number.isFinite);
  if (!timestamps.length) return [];
  const cutoff = Math.max(...timestamps) - days * 86_400_000;
  return items.filter((item) => {
    const timestamp = Date.parse(item.publishedAt);
    return Number.isFinite(timestamp) && timestamp >= cutoff;
  });
}

function signalStrength(items: NewsV2Item[]) {
  if (!items.length) return 0;
  const avgImpact = average(items.map((item) => item.score));
  const highImpactShare = items.filter((item) => item.score >= 75).length / items.length;
  const counts = signalCounts(items);
  const consensus = Math.max(...counts.values()) / items.length;
  return Math.max(0, Math.min(100, Math.round(avgImpact * 0.75 + highImpactShare * 15 + consensus * 10)));
}

function signalStrengthFromActivity(
  activity: Pick<
    NewsV2ThemeActivity,
    "averageScore" | "count" | "highImpactCount" | "signalCounts"
  >,
) {
  if (!activity.count) return 0;
  const highImpactShare = activity.highImpactCount / activity.count;
  const consensus = Math.max(...Object.values(activity.signalCounts)) / activity.count;
  return Math.max(
    0,
    Math.min(
      100,
      Math.round(activity.averageScore * 0.75 + highImpactShare * 15 + consensus * 10),
    ),
  );
}

function dominantSignal(items: NewsV2Item[]): NewsV2Signal {
  return Array.from(signalCounts(items).entries()).sort((left, right) => right[1] - left[1])[0]?.[0] || "Neutral";
}

function dominantSignalFromCounts(counts: Record<NewsV2Signal, number>): NewsV2Signal {
  return (Object.entries(counts) as Array<[NewsV2Signal, number]>)
    .sort((left, right) => right[1] - left[1])[0]?.[0] || "Neutral";
}

function signalCounts(items: NewsV2Item[]) {
  const counts = new Map<NewsV2Signal, number>();
  for (const item of items) counts.set(item.sentiment, (counts.get(item.sentiment) || 0) + 1);
  return counts;
}

function average(values: number[]) {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
}

function groupBy<T>(items: T[], readKey: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = readKey(item);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) || []), item]);
  }
  return groups;
}

function toneFromSignal(signal: NewsV2Signal): NewsTrendingSignal["tone"] {
  if (signal === "Bullish") return "bullish";
  if (signal === "Bearish") return "bearish";
  if (signal === "Volatile") return "volatile";
  return "flat";
}

function toneFromMarket(tone: NewsSectorMoverTone): NewsTrendingSignal["tone"] {
  if (tone === "bullish") return "bullish";
  if (tone === "bearish") return "bearish";
  return "flat";
}
