export type PriceChartDirectionTone = "bearish" | "bullish" | "neutral";

export type PriceChartMovement = {
  changeAmount: number;
  changePercent: number;
  latestPrice: number;
  tone: PriceChartDirectionTone;
};

type ClosingPricePoint = {
  close: number;
};

const priceDirectionThresholdPercent = 0.05;

export function derivePriceChartMovement(
  points: readonly ClosingPricePoint[],
  previousClose: number,
): PriceChartMovement | null {
  const latestPrice = points.at(-1)?.close;
  if (
    typeof latestPrice !== "number" ||
    !Number.isFinite(latestPrice) ||
    !Number.isFinite(previousClose) ||
    previousClose === 0
  ) {
    return null;
  }

  const changeAmount = latestPrice - previousClose;
  const changePercent = (changeAmount / previousClose) * 100;
  if (!Number.isFinite(changeAmount) || !Number.isFinite(changePercent)) {
    return null;
  }

  return {
    changeAmount,
    changePercent,
    latestPrice,
    tone: toneFromPricePercent(changePercent),
  };
}

export function resolvePriceChartTone(
  changePercent: number | null | undefined,
  fallbackChange: string,
): PriceChartDirectionTone {
  if (typeof changePercent === "number" && Number.isFinite(changePercent)) {
    return toneFromPricePercent(changePercent);
  }

  const parsedFallback = parsePercent(fallbackChange);
  return parsedFallback === null
    ? "neutral"
    : toneFromPricePercent(parsedFallback);
}

function toneFromPricePercent(value: number): PriceChartDirectionTone {
  if (value > priceDirectionThresholdPercent) return "bullish";
  if (value < -priceDirectionThresholdPercent) return "bearish";
  return "neutral";
}

function parsePercent(value: string) {
  const match = value.trim().match(/[+-]?(?:\d+(?:\.\d+)?|\.\d+)/);
  if (!match) return null;

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}
