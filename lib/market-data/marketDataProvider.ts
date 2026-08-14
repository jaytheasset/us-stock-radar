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

export interface MarketDataProvider {
  getCurrentPrice(symbol: string): Promise<CurrentPrice>;
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
