import "server-only";

import type { PriceChartSeries } from "@/app/events/[id]/detailTypes";
import {
  readMarketBarCacheMap,
  readMarketQuoteCache,
  type MarketQuoteCachePayload,
} from "@/lib/marketDataCache";
import type { PriceRange } from "@/lib/marketTypes";
import { normalizeAnalysisTicker } from "@/lib/analysisPeerSelection";

const cachedChartRanges: PriceRange[] = ["1D", "5D", "1M", "3M", "1Y"];

export type AnalysisMarketData = {
  quote: Omit<MarketQuoteCachePayload, "rawPayload" | "symbol"> | null;
  series: PriceChartSeries | null;
};

export async function loadAnalysisMarketData(
  symbolInput: string,
): Promise<AnalysisMarketData> {
  const symbol = normalizeAnalysisTicker(symbolInput);
  if (!symbol) return { quote: null, series: null };

  const [quoteResult, rangeMaps] = await Promise.all([
    readMarketQuoteCache(symbol),
    Promise.all(
      cachedChartRanges.map((range) =>
        readMarketBarCacheMap([symbol], range),
      ),
    ),
  ]);

  const periods: PriceChartSeries["periods"] = {};
  let previousClose = 0;
  let providerLabel = "";

  rangeMaps.forEach((rangeMap, index) => {
    const range = cachedChartRanges[index];
    const cached = rangeMap.get(symbol);
    if (!cached?.points.length) return;
    periods[range] = cached.points;
    previousClose ||= cached.previousClose;
    providerLabel ||= cached.providerLabel;
  });

  return {
    quote: quoteResult.hit && quoteResult.quote ? quoteResult.quote : null,
    series: Object.values(periods).some((points) => points?.length)
      ? {
          periods,
          previousClose,
          ...(providerLabel ? { providerLabel } : {}),
        }
      : null,
  };
}

export function formatAnalysisPrice(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return "";
  return `$${value.toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}`;
}

export function formatAnalysisChangeAmount(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return "";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

export function formatAnalysisChangePercent(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return "";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(2)}%`;
}
