import "server-only";

import { fetchFmpQuote } from "@/lib/integrations";
import {
  readMarketQuoteProviderCache,
  writeMarketQuoteCache,
} from "@/lib/marketDataCache";
import { FmpMarketDataProvider } from "@/lib/market-data/fmpMarketDataProvider";
import type { MarketDataProvider } from "@/lib/market-data/marketDataProvider";
import { selectMarketDataProvider } from "@/lib/market-data/marketDataProviderSelector";
import { MarketstackPriceProvider } from "@/lib/market-data/marketstackPriceProvider";

const fmpMarketDataProvider: MarketDataProvider = new FmpMarketDataProvider({
  fetchQuote: fetchFmpQuote,
  readCachedQuote: async (symbol) => {
    const result = await readMarketQuoteProviderCache(symbol);
    return result.hit && result.quote ? result.quote : null;
  },
  writeCachedQuote: writeMarketQuoteCache,
});

const marketstackPriceProvider: MarketDataProvider =
  new MarketstackPriceProvider();

const defaultMarketDataProvider: MarketDataProvider =
  selectMarketDataProvider(process.env.MARKET_DATA_PROVIDER, {
    fmp: fmpMarketDataProvider,
    marketstack: marketstackPriceProvider,
  });

export function getMarketDataProvider() {
  return defaultMarketDataProvider;
}

export async function getCurrentPrice(symbol: string) {
  return getMarketDataProvider().getCurrentPrice(symbol);
}

export async function getMarketQuoteSnapshot(symbol: string) {
  return getMarketDataProvider().getQuoteSnapshot(symbol);
}
