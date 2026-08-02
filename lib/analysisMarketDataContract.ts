import type { PriceChartSeries, PriceRange } from "@/app/events/[id]/detailTypes";

export function hasStoredAnalysisChartRange(
  series: PriceChartSeries | null | undefined,
  range: PriceRange,
) {
  return Boolean(series?.periods[range]?.length && series.previousClose > 0);
}
