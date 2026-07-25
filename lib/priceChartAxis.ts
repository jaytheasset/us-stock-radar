const narrowPriceChartPlotWidth = 300;
const narrowPriceChartTickCount = 4;
const defaultPriceChartTickCount = 6;

export function selectPriceChartXAxisIndexes(
  pointCount: number,
  plotWidth: number,
) {
  if (pointCount <= 0) return [];

  const maximumTickCount =
    plotWidth < narrowPriceChartPlotWidth
      ? narrowPriceChartTickCount
      : defaultPriceChartTickCount;
  const targetCount = Math.min(pointCount, maximumTickCount);
  if (targetCount === 1) return [0];

  return Array.from(
    new Set(
      Array.from({ length: targetCount }, (_, index) =>
        Math.round((index / (targetCount - 1)) * (pointCount - 1)),
      ),
    ),
  );
}
