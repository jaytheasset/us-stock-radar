import "server-only";

import { fetchFmpQuotes } from "@/lib/integrations";
import {
  readMarketQuoteCacheMap,
  writeMarketQuoteCache,
  type MarketQuoteCachePayload,
} from "@/lib/marketDataCache";

export const marketQuoteHydrationLimit = 25;

type HydratedMarketQuote = Omit<
  MarketQuoteCachePayload,
  "rawPayload" | "symbol"
>;

type FmpQuote = HydratedMarketQuote & {
  rawPayload: Record<string, unknown>;
  symbol: string;
};

const quoteRefreshes = new Map<
  string,
  Promise<HydratedMarketQuote | undefined>
>();

export async function readHydratedMarketQuoteMap(symbols: string[]) {
  const normalizedSymbols = normalizeSymbols(symbols);
  const quotes = await readMarketQuoteCacheMap(normalizedSymbols);
  const missingSymbols = normalizedSymbols.filter((symbol) => !quotes.has(symbol));
  const refreshSymbols = missingSymbols
    .filter((symbol) => !quoteRefreshes.has(symbol))
    .slice(0, marketQuoteHydrationLimit);

  if (refreshSymbols.length) {
    const batchRefresh = refreshMarketQuotes(refreshSymbols);

    for (const symbol of refreshSymbols) {
      let symbolRefresh: Promise<HydratedMarketQuote | undefined>;
      symbolRefresh = batchRefresh
        .then((refreshed) => refreshed.get(symbol))
        .finally(() => {
          if (quoteRefreshes.get(symbol) === symbolRefresh) {
            quoteRefreshes.delete(symbol);
          }
        });
      quoteRefreshes.set(symbol, symbolRefresh);
    }
  }

  await Promise.all(
    missingSymbols.map(async (symbol) => {
      const refresh = quoteRefreshes.get(symbol);
      if (!refresh) return;
      const quote = await refresh;
      if (quote) quotes.set(symbol, quote);
    }),
  );

  return quotes;
}

async function refreshMarketQuotes(symbols: string[]) {
  try {
    const result = await fetchFmpQuotes(symbols);
    const refreshed = normalizeFmpQuotes(result.data, symbols);

    await Promise.all(
      Array.from(refreshed.values()).map((quote) =>
        writeMarketQuoteCache({
          changeAmount: quote.changeAmount,
          changePercent: quote.changePercent,
          previousClose: quote.previousClose,
          price: quote.price,
          provider: quote.provider,
          rawPayload: quote.rawPayload,
          symbol: quote.symbol,
          volume: quote.volume,
        }).catch(() => undefined),
      ),
    );

    return new Map<string, HydratedMarketQuote>(
      Array.from(refreshed, ([symbol, quote]) => [
        symbol,
        {
          changeAmount: quote.changeAmount,
          changePercent: quote.changePercent,
          previousClose: quote.previousClose,
          price: quote.price,
          provider: quote.provider,
          volume: quote.volume,
        },
      ]),
    );
  } catch {
    return new Map<string, HydratedMarketQuote>();
  }
}

function normalizeFmpQuotes(value: unknown, requestedSymbols: string[]) {
  const requested = new Set(requestedSymbols);
  const rows = Array.isArray(value) ? value : value ? [value] : [];
  const quotes = new Map<string, FmpQuote>();

  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const rawPayload = row as Record<string, unknown>;
    const symbol = stringValue(rawPayload.symbol).toUpperCase();
    if (!requested.has(symbol)) continue;

    const price = finiteNumber(rawPayload.price);
    const previousClose = finiteNumber(
      rawPayload.previousClose ?? rawPayload.previousClosePrice,
    );
    const changeAmount = finiteNumber(
      rawPayload.change ?? rawPayload.changeAmount,
    ) ?? deriveChangeAmount(price, previousClose);
    const changePercent = finiteNumber(
      rawPayload.changePercentage ??
        rawPayload.changesPercentage ??
        rawPayload.changePercent,
    ) ?? deriveChangePercent(price, previousClose);
    const volume = finiteNumber(rawPayload.volume);

    if (
      price === undefined &&
      previousClose === undefined &&
      changeAmount === undefined &&
      changePercent === undefined
    ) {
      continue;
    }

    quotes.set(symbol, {
      changeAmount,
      changePercent,
      previousClose,
      price,
      provider: "fmp",
      rawPayload,
      symbol,
      volume,
    });
  }

  return quotes;
}

function normalizeSymbols(symbols: string[]) {
  return Array.from(
    new Set(
      symbols
        .map((symbol) => symbol.trim().toUpperCase())
        .filter((symbol) => /^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(symbol)),
    ),
  ).slice(0, 40);
}

function deriveChangeAmount(price?: number, previousClose?: number) {
  if (price === undefined || previousClose === undefined) return undefined;
  return price - previousClose;
}

function deriveChangePercent(price?: number, previousClose?: number) {
  if (
    price === undefined ||
    previousClose === undefined ||
    previousClose === 0
  ) {
    return undefined;
  }
  return ((price - previousClose) / previousClose) * 100;
}

function finiteNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
