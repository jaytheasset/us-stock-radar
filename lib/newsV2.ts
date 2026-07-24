import { sectorMappings, themeGroups, themeSubThemes } from "@/lib/taxonomyRegistry";

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

const newsV2SectorOrder = Array.from(
  new Set(sectorMappings.map((mapping) => mapping.sector)),
);

const newsV2SectorAliases: Record<string, string[]> = {
  "Basic Materials": ["Basic Materials", "Materials", "materials"],
  "Communication Services": ["Communication Services", "communication services"],
  "Consumer Cyclical": [
    "Consumer Cyclical",
    "consumer cyclical",
    "Consumer Discretionary",
    "consumer_discretionary",
  ],
  "Consumer Defensive": ["Consumer Defensive", "consumer defensive"],
  Energy: ["Energy", "energy", "power_energy_resources"],
  "Financial Services": [
    "Financial Services",
    "financial services",
    "Financials",
    "financials",
  ],
  Healthcare: ["Healthcare", "healthcare"],
  Industrials: ["Industrials", "industrials", "Transportation", "transportation"],
  "Real Estate": ["Real Estate", "real estate"],
  Technology: ["Technology", "technology", "Information Technology", "information technology"],
  Utilities: ["Utilities", "utilities"],
};

const newsV2SectorByAlias = new Map(
  Object.entries(newsV2SectorAliases).flatMap(([canonical, aliases]) =>
    aliases.map((alias) => [normalizeTaxonomyValue(alias), canonical] as const),
  ),
);

export function normalizeNewsV2SectorFilterOptions(values: string[]) {
  const unique = new Set(
    values
      .map((value) => canonicalNewsSectorFilterValue(value))
      .filter(Boolean),
  );
  return Array.from(unique).sort((left, right) => {
    const leftIndex = newsV2SectorOrder.indexOf(left);
    const rightIndex = newsV2SectorOrder.indexOf(right);
    if (leftIndex >= 0 || rightIndex >= 0) {
      if (leftIndex < 0) return 1;
      if (rightIndex < 0) return -1;
      return leftIndex - rightIndex;
    }
    return getNewsV2TaxonomyLabel(left).localeCompare(getNewsV2TaxonomyLabel(right));
  });
}

export function expandNewsV2SectorFilterValues(values: string[]) {
  return Array.from(
    new Set(values.flatMap((value) => newsV2SectorAliases[value] ?? [value])),
  );
}

export function normalizeNewsV2ThemeFilterOptions(values: string[]) {
  const unique = new Map<string, string>();
  for (const value of values) {
    const canonical =
      canonicalNewsThemeGroupSlug(value) ||
      canonicalNewsSubThemeSlug(value) ||
      value.trim();
    const key = normalizeTaxonomyValue(canonical);
    if (key && !unique.has(key)) unique.set(key, canonical);
  }

  return Array.from(unique.values()).sort((left, right) => {
    const leftGroup = themeGroups.find((group) => group.slug === left);
    const rightGroup = themeGroups.find((group) => group.slug === right);
    if (leftGroup || rightGroup) {
      if (!leftGroup) return 1;
      if (!rightGroup) return -1;
      return leftGroup.sortOrder - rightGroup.sortOrder;
    }
    return getNewsV2TaxonomyLabel(left).localeCompare(getNewsV2TaxonomyLabel(right));
  });
}

export function expandNewsV2ThemeFilterValues(values: string[]) {
  return Array.from(
    new Set(
      values.flatMap((value) => {
        const group = themeGroups.find((item) => item.slug === value);
        if (group) return [group.slug, group.name];
        const subTheme = themeSubThemes.find((item) => item.slug === value);
        if (subTheme) return [subTheme.slug, subTheme.name];
        return [value];
      }),
    ),
  );
}

export function getNewsV2SectorFilterLabel(value: string) {
  return canonicalNewsSectorFilterValue(value);
}

export function getNewsV2ThemeFilterLabel(value: string) {
  const group = themeGroups.find((item) => item.slug === value);
  if (group) return group.name;
  const subTheme = themeSubThemes.find((item) => item.slug === value);
  return subTheme?.name || getNewsV2TaxonomyLabel(value);
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

function canonicalNewsSectorFilterValue(value: string) {
  const normalized = normalizeTaxonomyValue(value);
  return newsV2SectorByAlias.get(normalized) || value.trim();
}

function getNewsV2TaxonomyLabel(value: string) {
  const acronyms: Record<string, string> = {
    ai: "AI",
    asic: "ASIC",
    ddos: "DDoS",
    ev: "EV",
    fda: "FDA",
    gpu: "GPU",
    lng: "LNG",
  };
  return value
    .trim()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => acronyms[part.toLowerCase()] || `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(" ");
}
