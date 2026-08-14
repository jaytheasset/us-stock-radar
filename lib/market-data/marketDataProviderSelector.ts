import type { MarketDataProvider } from "./marketDataProvider.ts";

export type MarketDataProviderName = "fmp" | "marketstack";

type MarketDataProviders = Record<MarketDataProviderName, MarketDataProvider>;

export function resolveMarketDataProviderName(
  value: string | undefined,
): MarketDataProviderName {
  return value?.trim().toLowerCase() === "marketstack"
    ? "marketstack"
    : "fmp";
}

export function selectMarketDataProvider(
  value: string | undefined,
  providers: MarketDataProviders,
) {
  return providers[resolveMarketDataProviderName(value)];
}
