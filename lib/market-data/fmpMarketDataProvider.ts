import {
  normalizeMarketDataSymbol,
  type CurrentPrice,
  type MarketQuoteSnapshot,
  type MarketDataProvider,
  unavailableCurrentPrice,
  unavailableMarketQuoteSnapshot,
} from "./marketDataProvider.ts";

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

export class FmpMarketDataProvider implements MarketDataProvider {
  private readonly dependencies: FmpMarketDataProviderDependencies;

  constructor(dependencies: FmpMarketDataProviderDependencies) {
    this.dependencies = dependencies;
  }

  async getCurrentPrice(symbolInput: string): Promise<CurrentPrice> {
    const symbol = normalizeMarketDataSymbol(symbolInput);
    if (!symbol) return unavailableCurrentPrice(symbol);

    const cached = await this.readCache(symbol);
    const cachedPrice = normalizeCachedFmpPrice(cached, symbol);
    if (cachedPrice) return cachedPrice;

    const snapshot = await this.loadQuoteSnapshot(symbol, true);
    return snapshot.availability === "available"
      ? {
          asOf: snapshot.asOf,
          availability: "available",
          price: snapshot.price,
          symbol: snapshot.symbol,
        }
      : unavailableCurrentPrice(symbol);
  }

  async getQuoteSnapshot(symbolInput: string): Promise<MarketQuoteSnapshot> {
    const symbol = normalizeMarketDataSymbol(symbolInput);
    if (!symbol) return unavailableMarketQuoteSnapshot(symbol);
    return this.loadQuoteSnapshot(symbol, false);
  }

  private async loadQuoteSnapshot(symbol: string, writeCache: boolean) {
    let result: FmpClientResult;
    try {
      result = await this.dependencies.fetchQuote(symbol);
    } catch {
      return unavailableMarketQuoteSnapshot(symbol);
    }

    if (!result.ok) return unavailableMarketQuoteSnapshot(symbol);

    const snapshot = normalizeFmpQuoteSnapshot(
      result.data,
      symbol,
      (this.dependencies.now ?? (() => new Date()))(),
    );
    if (snapshot.availability === "unavailable") return snapshot;

    if (writeCache) {
      try {
        await this.dependencies.writeCachedQuote({
          changeAmount: snapshot.changeAmount ?? undefined,
          changePercent: snapshot.changePercent ?? undefined,
          previousClose: snapshot.previousClose ?? undefined,
          price: snapshot.price,
          provider: "fmp",
          rawPayload: firstRecord(result.data),
          symbol,
          volume: snapshot.volume ?? undefined,
        });
      } catch {
        // A successful provider read remains usable when the optional cache write fails.
      }
    }

    return snapshot;
  }

  private async readCache(symbol: string) {
    try {
      return await this.dependencies.readCachedQuote(symbol);
    } catch {
      return null;
    }
  }
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
  const asOf = providerAsOf(row, receivedAt);

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

function normalizeCachedFmpPrice(
  entry: FmpCacheEntry | null,
  symbol: string,
): CurrentPrice | null {
  if (!entry || entry.provider !== "fmp") return null;

  const price = positiveFiniteNumber(entry.price);
  if (price === null) return null;

  const rawPayload = firstRecord(entry.rawPayload);
  const providerTimestamp = rawPayload
    ? providerTimestampAsOf(rawPayload.timestamp)
    : undefined;
  if (providerTimestamp === null) return null;

  const fallbackAsOf = isoDate(entry.fetchedAt);
  const asOf = providerTimestamp ?? fallbackAsOf;
  if (!asOf) return null;

  return {
    asOf,
    availability: "available",
    price,
    symbol,
  };
}

function providerAsOf(row: Record<string, unknown>, receivedAt: Date) {
  const providerTimestamp = providerTimestampAsOf(row.timestamp);
  if (providerTimestamp === null) return null;
  return providerTimestamp ?? isoDate(receivedAt);
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
