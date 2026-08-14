export type CurrentPriceAvailability = "available" | "unavailable";

export type AvailableCurrentPrice = {
  symbol: string;
  price: number;
  asOf: string;
  availability: "available";
};

export type UnavailableCurrentPrice = {
  symbol: string;
  price: null;
  asOf: null;
  availability: "unavailable";
};

export type CurrentPrice = AvailableCurrentPrice | UnavailableCurrentPrice;

export type AvailableMarketQuoteSnapshot = {
  asOf: string;
  availability: "available";
  changeAmount: number | null;
  changePercent: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  open: number | null;
  previousClose: number | null;
  price: number;
  symbol: string;
  volume: number | null;
  yearHigh: number | null;
  yearLow: number | null;
};

export type UnavailableMarketQuoteSnapshot = {
  asOf: null;
  availability: "unavailable";
  changeAmount: null;
  changePercent: null;
  dayHigh: null;
  dayLow: null;
  open: null;
  previousClose: null;
  price: null;
  symbol: string;
  volume: null;
  yearHigh: null;
  yearLow: null;
};

export type MarketQuoteSnapshot =
  | AvailableMarketQuoteSnapshot
  | UnavailableMarketQuoteSnapshot;

export interface MarketDataProvider {
  getCurrentPrice(symbol: string): Promise<CurrentPrice>;
  getQuoteSnapshot(symbol: string): Promise<MarketQuoteSnapshot>;
}

export function normalizeMarketDataSymbol(symbol: string) {
  return (symbol || "AAPL")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.-]/g, "");
}

export function unavailableCurrentPrice(symbol: string): UnavailableCurrentPrice {
  return {
    asOf: null,
    availability: "unavailable",
    price: null,
    symbol,
  };
}

export function unavailableMarketQuoteSnapshot(
  symbol: string,
): UnavailableMarketQuoteSnapshot {
  return {
    asOf: null,
    availability: "unavailable",
    changeAmount: null,
    changePercent: null,
    dayHigh: null,
    dayLow: null,
    open: null,
    previousClose: null,
    price: null,
    symbol,
    volume: null,
    yearHigh: null,
    yearLow: null,
  };
}
