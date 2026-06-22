import type { PricePoint, PriceRange } from "@/lib/marketTypes";

export type DetailTone = "bullish" | "bearish" | "volatile" | "neutral";

export type ContextRange = "1D" | "5D" | "30D";
export type { PricePoint, PriceRange };

export type PriceChartSeries = {
  providerLabel?: string;
  previousClose: number;
  periods: Record<PriceRange, PricePoint[]>;
};

export type PriceChartMarker = {
  label: string;
  value: number;
  currency?: string | null;
  appliesToTicker?: string | null;
  tone?: DetailTone;
  note?: string | null;
};

export type TopMover = {
  symbol: string;
  change: string;
  trend: number[];
};

export type SectorThemePeriod = {
  sectorChange: string;
  industryChange: string;
  themeChange?: string;
  subThemeChange?: string;
  themeScore: number;
  themeSignal: DetailTone;
  topMovers: TopMover[];
};

export type SectorThemeContext = {
  sector: string;
  industry: string;
  marketCap?: string;
  sharesOutstanding?: string;
  publicFloat?: string;
  floatPercent?: string;
  themeGroup?: string;
  subTheme?: string;
  contextTitle?: string;
  moverGroupName?: string;
  moverMode?: "related" | "top_movers" | "market_top_movers";
  periods: Record<ContextRange, SectorThemePeriod>;
};
