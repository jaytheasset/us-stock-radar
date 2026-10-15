import "server-only";
import { selectMarketDataProvider } from "./marketDataProviderSelector";
import { MarketstackPriceProvider } from "./marketstackPriceProvider";
const provider = selectMarketDataProvider(process.env.MARKET_DATA_PROVIDER, {
  marketstack: new MarketstackPriceProvider(),
});
export function getMarketDataProvider() {
  return provider;
}
export async function getCurrentPrice(symbol: string) {
  return provider.getCurrentPrice(symbol);
}
export async function getMarketQuoteSnapshot(symbol: string) {
  return provider.getQuoteSnapshot(symbol);
}
