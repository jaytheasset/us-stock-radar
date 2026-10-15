import {
  normalizeMarketDataSymbol,
  type CurrentPrice,
  type MarketQuoteSnapshot,
  type MarketDataProvider,
  unavailableCurrentPrice,
  unavailableMarketQuoteSnapshot,
} from "./marketDataProvider.ts";

export const FMP_CURRENT_PRICE_DATA_MODE = "realtime" as const;

type FmpClientResult = {
  ok: boolean;
  data: unknown;
};

type FmpCacheEntry = {
  fetchedAt?: unknown;
  price?: unknown;
  provider?: unknown;
  rawPayload?: unknown;
};

type FmpCacheWrite = {
  changeAmount?: number;
  changePercent?: number;
  price: number;
  previousClose?: number;
  provider: string;
  rawPayload: unknown;
  symbol: string;
  volume?: number;
};

export type FmpMarketDataProviderDependencies = {
  fetchQuote(symbol: string): Promise<FmpClientResult>;
  now?: () => Date;
  readCachedQuote(symbol: string): Promise<FmpCacheEntry | null>;
  writeCachedQuote(payload: FmpCacheWrite): Promise<unknown>;
};

// Retained for callers importing the old provider; injected fetch/cache dependencies are never used.
export class FmpMarketDataProvider implements MarketDataProvider {
  constructor(_dependencies: FmpMarketDataProviderDependencies) {}
  async getCurrentPrice(symbol: string): Promise<CurrentPrice> { return unavailableCurrentPrice(normalizeMarketDataSymbol(symbol)); }
  async getQuoteSnapshot(symbol: string): Promise<MarketQuoteSnapshot> { return unavailableMarketQuoteSnapshot(normalizeMarketDataSymbol(symbol)); }
}

export function normalizeFmpCurrentPrice(
  value: unknown,
  requestedSymbol: string,
  receivedAt = new Date(),
): CurrentPrice {
  const snapshot = normalizeFmpQuoteSnapshot(value, requestedSymbol, receivedAt);
  return snapshot.availability === "available"
    ? {
        asOf: snapshot.asOf,
        availability: "available",
        dataMode: FMP_CURRENT_PRICE_DATA_MODE,
        price: snapshot.price,
        symbol: snapshot.symbol,
      }
    : unavailableCurrentPrice(snapshot.symbol);
}

export function normalizeFmpQuoteSnapshot(
  value: unknown,
  requestedSymbol: string,
  receivedAt = new Date(),
): MarketQuoteSnapshot {
  const symbol = normalizeMarketDataSymbol(requestedSymbol);
  const row = firstRecord(value);
  if (!symbol || !row) return unavailableMarketQuoteSnapshot(symbol);

  const providerSymbol =
    typeof row.symbol === "string"
      ? normalizeMarketDataSymbol(row.symbol)
      : "";
  const price = positiveFiniteNumber(row.price);
  const asOf = providerAsOf(row);

  if (providerSymbol !== symbol || price === null || asOf === null) {
    return unavailableMarketQuoteSnapshot(symbol);
  }

  return {
    asOf,
    availability: "available",
    changeAmount: optionalFiniteNumber(row.change ?? row.changeAmount),
    changePercent: optionalFiniteNumber(
      row.changePercentage ?? row.changesPercentage ?? row.changePercent,
    ),
    dayHigh: optionalPositiveFiniteNumber(row.dayHigh ?? row.high),
    dayLow: optionalPositiveFiniteNumber(row.dayLow ?? row.low),
    open: optionalPositiveFiniteNumber(row.open),
    previousClose: optionalPositiveFiniteNumber(
      row.previousClose ?? row.previousClosePrice,
    ),
    price,
    symbol,
    volume: optionalNonNegativeFiniteNumber(row.volume),
    yearHigh: optionalPositiveFiniteNumber(row.yearHigh),
    yearLow: optionalPositiveFiniteNumber(row.yearLow),
  };
}

function providerAsOf(row: Record<string, unknown>) {
  const providerTimestamp = providerTimestampAsOf(row.timestamp);
  return providerTimestamp ?? null;
}

function providerTimestampAsOf(value: unknown): string | undefined | null {
  if (value === undefined || value === null || value === "") return undefined;

  let milliseconds: number;
  if (typeof value === "number") {
    milliseconds = value > 10_000_000_000 ? value : value * 1_000;
  } else if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    milliseconds = Number.isFinite(numeric)
      ? numeric > 10_000_000_000
        ? numeric
        : numeric * 1_000
      : Date.parse(value);
  } else {
    return null;
  }

  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return null;
  return isoDate(new Date(milliseconds));
}

function positiveFiniteNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function optionalFiniteNumber(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function optionalPositiveFiniteNumber(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  return positiveFiniteNumber(value);
}

function optionalNonNegativeFiniteNumber(value: unknown) {
  const number = optionalFiniteNumber(value);
  return number !== null && number >= 0 ? number : null;
}

function isoDate(value: unknown) {
  const date = value instanceof Date
    ? value
    : typeof value === "string" || typeof value === "number"
      ? new Date(value)
      : null;
  if (!date || !Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

function firstRecord(value: unknown): Record<string, unknown> | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && typeof candidate === "object" && !Array.isArray(candidate)
    ? candidate as Record<string, unknown>
    : null;
}
