import type { PricePoint, PriceRange } from "@/lib/marketTypes";

export type DetailTone = "bullish" | "bearish" | "volatile" | "neutral";

export type ContextRange = "1D" | "5D" | "30D";
export type { PricePoint, PriceRange };

export type PriceChartSeries = {
  previousClose: number;
  periods: Record<PriceRange, PricePoint[]>;
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
  themeGroup?: string;
  subTheme?: string;
  periods: Record<ContextRange, SectorThemePeriod>;
};
