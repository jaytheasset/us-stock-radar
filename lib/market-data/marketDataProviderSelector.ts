import {
  normalizeMarketDataSymbol,
  unavailableCurrentPrice,
  unavailableMarketQuoteSnapshot,
  type MarketDataProvider,
} from "./marketDataProvider.ts";
export type MarketDataProviderName = "unavailable" | "marketstack";
const unavailableProvider: MarketDataProvider = {
  async getCurrentPrice(symbol) {
    return unavailableCurrentPrice(normalizeMarketDataSymbol(symbol));
  },
  async getQuoteSnapshot(symbol) {
    return unavailableMarketQuoteSnapshot(normalizeMarketDataSymbol(symbol));
  },
};
export function resolveMarketDataProviderName(
  value: string | undefined,
): MarketDataProviderName {
  return value?.trim().toLowerCase() === "marketstack"
    ? "marketstack"
    : "unavailable";
}
export function selectMarketDataProvider(
  value: string | undefined,
  providers: { marketstack: MarketDataProvider; fmp?: MarketDataProvider },
) {
  return resolveMarketDataProviderName(value) === "marketstack"
    ? providers.marketstack
    : unavailableProvider;
}
