import type {
  MarketBarCachePayload,
  MarketQuoteCachePayload,
} from "@/lib/marketDataCache";
import type { NewsV2Item } from "@/lib/newsV2";

type Quote = Omit<MarketQuoteCachePayload, "symbol" | "rawPayload">;

export function hydrateNewsV2ItemMarketData(
  item: NewsV2Item,
  quote?: Quote,
  chart?: MarketBarCachePayload,
): NewsV2Item {
  const price = finiteNumber(quote?.price ?? chart?.latestPrice);
  const changePercent = finiteNumber(
    quote?.changePercent ?? chart?.changePercent,
  );

  return {
    ...item,
    priceLabel: price === null ? undefined : formatPrice(price),
    changePercent:
      changePercent === null
        ? undefined
        : formatChangePercent(changePercent),
    trend: chart?.points.map((point) => point.close).filter(Number.isFinite) ?? [],
  };
}

function formatPrice(value: number) {
  return `$${value.toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}`;
}

function formatChangePercent(value: number) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(2)}%`;
}

function finiteNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}
