import "server-only";

import { fetchFmpQuote } from "@/lib/integrations";
import {
  readMarketQuoteProviderCache,
  writeMarketQuoteCache,
} from "@/lib/marketDataCache";
import { FmpMarketDataProvider } from "@/lib/market-data/fmpMarketDataProvider";
import type { MarketDataProvider } from "@/lib/market-data/marketDataProvider";

const defaultMarketDataProvider: MarketDataProvider = new FmpMarketDataProvider({
  fetchQuote: fetchFmpQuote,
  readCachedQuote: async (symbol) => {
    const result = await readMarketQuoteProviderCache(symbol);
    return result.hit && result.quote ? result.quote : null;
  },
  writeCachedQuote: writeMarketQuoteCache,
});

export function getMarketDataProvider() {
  return defaultMarketDataProvider;
}

export async function getCurrentPrice(symbol: string) {
  return getMarketDataProvider().getCurrentPrice(symbol);
}
