import type { PriceChartRange, PricePoint } from "@/lib/marketTypes";

export type DetailTone = "bullish" | "bearish" | "volatile" | "neutral";

export type ContextRange = "1D" | "5D" | "30D";
export type { PricePoint };
export type PriceRange = PriceChartRange;

export type PriceChartSeries = {
  providerLabel?: string;
  previousClose: number;
  periods: Partial<Record<PriceRange, PricePoint[]>>;
};

export type TopMover = {
  symbol: string;
  change?: string;
  trend?: number[];
};

export type SectorThemePeriod = {
  sectorChange?: string;
  industryChange?: string;
  themeChange?: string;
  subThemeChange?: string;
  themeScore: number;
  themeSignal: DetailTone;
  topMovers: TopMover[];
};

export type SectorThemeContext = {
  companyName?: string;
  exchange?: string;
  sector?: string;
  industry?: string;
  marketCap?: string;
  sharesOutstanding?: string;
  publicFloat?: string;
  publicFloatPercent?: string;
  /** Legacy event/archive payload name retained while filing UI uses publicFloatPercent. */
  floatPercent?: string;
  themeGroup?: string;
  subTheme?: string;
  contextTitle?: string;
  moverGroupName?: string;
  moverMode?: "related" | "top_movers" | "market_top_movers";
  periods: Record<ContextRange, SectorThemePeriod>;
};

export function isRealTicker(value: string | null | undefined) {
  const normalized = String(value || "").trim().toUpperCase();
  return Boolean(
    normalized &&
      normalized !== "N/A" &&
      normalized !== "NA" &&
      /^[A-Z][A-Z0-9.-]{0,9}$/.test(normalized)
  );
}
