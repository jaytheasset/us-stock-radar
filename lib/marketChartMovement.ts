import type { PricePoint } from "@/lib/marketTypes";

export type MarketRangeMovement = {
  changeAmount: number;
  changePercent: number;
  firstPrice: number;
  latestPrice: number;
};

export function deriveMarketRangeMovement(
  points: readonly PricePoint[] | null | undefined,
): MarketRangeMovement | null {
  const firstPrice = points?.[0]?.close;
  const latestPrice = points?.[points.length - 1]?.close;
  if (
    firstPrice === undefined ||
    latestPrice === undefined ||
    !Number.isFinite(firstPrice) ||
    !Number.isFinite(latestPrice) ||
    firstPrice <= 0
  ) {
    return null;
  }

  const changeAmount = latestPrice - firstPrice;
  const changePercent = (changeAmount / firstPrice) * 100;
  if (!Number.isFinite(changeAmount) || !Number.isFinite(changePercent)) {
    return null;
  }

  return {
    changeAmount,
    changePercent,
    firstPrice,
    latestPrice,
  };
}

export function resolveMarketRangeChangePercent({
  points,
  rangeChangePercent,
}: {
  points: readonly PricePoint[] | null | undefined;
  rangeChangePercent?: number;
}) {
  return Number.isFinite(rangeChangePercent)
    ? Number(rangeChangePercent)
    : deriveMarketRangeMovement(points)?.changePercent;
}
