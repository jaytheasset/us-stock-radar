import { themeGroups, themeSubThemes } from "@/lib/taxonomyRegistry";

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
  themeGroupSlug?: string;
  subThemeSlug?: string;
  relatedSectors: string[];
  themes: string[];
  eventType: string;
  eventTypeCode: string;
  marketCapBand?: NewsV2MarketCapBand;
  priceLabel?: string;
  changePercent?: string;
  trend: number[];
  deliveryLevel: "archive" | "feed" | "alert";
};

export type NewsV2Cursor = {
  id: string;
  publishedAt: string;
};

export type NewsV2FilterOptions = {
  eventTypes: string[];
  sources: string[];
  sectors: string[];
  themes: string[];
};

export type NewsV2FilterState = {
  sentiments: NewsV2Signal[];
  marketCaps: NewsV2MarketCapBand[];
  eventTypes: string[];
  sources: string[];
  sectors: string[];
  themes: string[];
};

export type NewsV2SourceActivity = {
  source: string;
  count: number;
  averageScore: number;
  rangeCounts?: Partial<Record<"Today" | "5D" | "1M" | "3M", number>>;
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

export type NewsV2ThemeActivity = {
  themeGroup: string;
  count: number;
  averageScore: number;
  highImpactCount: number;
  signalCounts: Record<NewsV2Signal, number>;
  subThemes: Array<{
    subTheme: string;
    count: number;
    averageScore: number;
    highImpactCount: number;
    signalCounts: Record<NewsV2Signal, number>;
  }>;
};

export type NewsV2PageResponse = {
  error?: string;
  hasMore: boolean;
  items: NewsV2Item[];
  nextCursor: NewsV2Cursor | null;
  totalCount: number | null;
};

export type NewsV2PageData = {
  items: NewsV2Item[];
  total: number;
  hasMore: boolean;
  nextCursor: NewsV2Cursor | null;
  filterOptions: NewsV2FilterOptions;
  sourceActivity: NewsV2SourceActivity[];
  sectorActivity: NewsV2SectorActivity[];
  signalActivity: NewsV2SignalActivity[];
  themeActivity: NewsV2ThemeActivity[];
  error?: string;
};

export function formatNewsV2PublishedAt(
  publishedAt: string,
  format: "full" | "time" = "full",
) {
  const value = new Date(publishedAt);
  if (Number.isNaN(value.getTime())) return "";

  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: format === "full" ? "short" : undefined,
    day: format === "full" ? "numeric" : undefined,
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
  return `${formatted} ET`;
}

export function canonicalNewsThemeGroupSlug(value?: string | null) {
  const normalized = normalizeTaxonomyValue(value);
  if (!normalized) return undefined;
  return themeGroups.find(
    (group) =>
      normalizeTaxonomyValue(group.slug) === normalized ||
      normalizeTaxonomyValue(group.name) === normalized,
  )?.slug;
}

export function canonicalNewsSubThemeSlug(value?: string | null) {
  const normalized = normalizeTaxonomyValue(value);
  if (!normalized) return undefined;
  return themeSubThemes.find(
    (subTheme) =>
      normalizeTaxonomyValue(subTheme.slug) === normalized ||
      normalizeTaxonomyValue(subTheme.name) === normalized,
  )?.slug;
}

export function newsMarketScopeToCategory(value: string): NewsV2Category {
  const scope = value.trim().toLowerCase();
  if (scope === "macro") return "Macro";
  if (scope === "sector") return "Sector";
  if (scope === "theme") return "Theme";
  return "Company";
}

export function normalizeNewsV2Signal(value: string): NewsV2Signal {
  const normalized = value.trim().toLowerCase();
  if (normalized === "bullish") return "Bullish";
  if (normalized === "bearish") return "Bearish";
  if (normalized === "volatile") return "Volatile";
  return "Neutral";
}

function normalizeTaxonomyValue(value?: string | null) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
