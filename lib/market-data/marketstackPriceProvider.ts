import {
  normalizeMarketDataSymbol,
  type CurrentPrice,
  type MarketDataProvider,
  type MarketQuoteSnapshot,
  unavailableCurrentPrice,
  unavailableMarketQuoteSnapshot,
} from "./marketDataProvider.ts";

export const MARKETSTACK_DATA_TIMELINESS = "end-of-day" as const;

const latestEndOfDayEndpoint =
  "https://api.marketstack.com/v2/eod/latest";
const defaultTimeoutMs = 15_000;

type FetchImplementation = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export type MarketstackPriceProviderDependencies = {
  apiKey?: string;
  fetchImpl?: FetchImplementation;
  timeoutMs?: number;
};

export class MarketstackPriceProvider implements MarketDataProvider {
  private readonly apiKey: string;
  private readonly fetchImpl: FetchImplementation;
  private readonly timeoutMs: number;

  constructor(dependencies: MarketstackPriceProviderDependencies = {}) {
    this.apiKey = dependencies.apiKey ?? process.env.MARKETSTACK_API_KEY ?? "";
    this.fetchImpl = dependencies.fetchImpl ?? fetch;
    this.timeoutMs = dependencies.timeoutMs ?? defaultTimeoutMs;
  }

  async getCurrentPrice(symbolInput: string): Promise<CurrentPrice> {
    const symbol = normalizeMarketDataSymbol(symbolInput);
    if (!symbol) return unavailableCurrentPrice(symbol);

    const snapshot = await this.loadQuoteSnapshot(symbol);
    return snapshot.availability === "available"
      ? {
          asOf: snapshot.asOf,
          availability: "available",
          price: snapshot.price,
          symbol: snapshot.symbol,
        }
      : unavailableCurrentPrice(symbol);
  }

  async getQuoteSnapshot(
    symbolInput: string,
  ): Promise<MarketQuoteSnapshot> {
    const symbol = normalizeMarketDataSymbol(symbolInput);
    if (!symbol) return unavailableMarketQuoteSnapshot(symbol);
    return this.loadQuoteSnapshot(symbol);
  }

  private async loadQuoteSnapshot(
    symbol: string,
  ): Promise<MarketQuoteSnapshot> {
    if (!this.apiKey.trim()) return unavailableMarketQuoteSnapshot(symbol);

    const url = new URL(latestEndOfDayEndpoint);
    url.searchParams.set("access_key", this.apiKey);
    url.searchParams.set("symbols", symbol);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        cache: "no-store",
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok || marketstackError(payload)) {
        return unavailableMarketQuoteSnapshot(symbol);
      }

      return normalizeMarketstackQuoteSnapshot(payload, symbol);
    } catch {
      return unavailableMarketQuoteSnapshot(symbol);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function normalizeMarketstackCurrentPrice(
  value: unknown,
  requestedSymbol: string,
): CurrentPrice {
  const snapshot = normalizeMarketstackQuoteSnapshot(value, requestedSymbol);
  return snapshot.availability === "available"
    ? {
        asOf: snapshot.asOf,
        availability: "available",
        price: snapshot.price,
        symbol: snapshot.symbol,
      }
    : unavailableCurrentPrice(snapshot.symbol);
}

export function normalizeMarketstackQuoteSnapshot(
  value: unknown,
  requestedSymbol: string,
): MarketQuoteSnapshot {
  const symbol = normalizeMarketDataSymbol(requestedSymbol);
  if (!symbol) return unavailableMarketQuoteSnapshot(symbol);

  const row = marketstackRows(value).find((candidate) => {
    const providerSymbol = readProviderSymbol(candidate);
    return providerSymbol === symbol;
  });
  if (!row) return unavailableMarketQuoteSnapshot(symbol);

  const price = positiveFiniteNumber(row.close);
  const asOf = isoDate(row.date);
  if (price === null || asOf === null) {
    return unavailableMarketQuoteSnapshot(symbol);
  }

  return {
    asOf,
    availability: "available",
    changeAmount: null,
    changePercent: null,
    dayHigh: optionalPositiveFiniteNumber(row.high),
    dayLow: optionalPositiveFiniteNumber(row.low),
    open: optionalPositiveFiniteNumber(row.open),
    previousClose: null,
    price,
    symbol,
    volume: optionalNonNegativeFiniteNumber(row.volume),
    yearHigh: null,
    yearLow: null,
  };
}

function marketstackRows(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const data = (value as Record<string, unknown>).data;
  if (!Array.isArray(data)) return [];
  return data.filter(
    (row): row is Record<string, unknown> =>
      Boolean(row) && typeof row === "object" && !Array.isArray(row),
  );
}

function readProviderSymbol(row: Record<string, unknown>) {
  return typeof row.symbol === "string"
    ? normalizeMarketDataSymbol(row.symbol)
    : "";
}

function marketstackError(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const error = (value as Record<string, unknown>).error;
  if (!error || typeof error !== "object" || Array.isArray(error)) return null;

  const record = error as Record<string, unknown>;
  const code = typeof record.code === "string" ? record.code : "provider_error";
  const message =
    typeof record.message === "string" ? record.message : "Marketstack error";
  return { code, message };
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

function optionalPositiveFiniteNumber(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  return positiveFiniteNumber(value);
}

function optionalNonNegativeFiniteNumber(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function isoDate(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const milliseconds =
    typeof value === "number" ? value : Date.parse(value.trim());
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return null;
  return new Date(milliseconds).toISOString();
}
