import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  FmpMarketDataProvider,
  normalizeFmpCurrentPrice,
  normalizeFmpQuoteSnapshot,
  type FmpMarketDataProviderDependencies,
} from "./fmpMarketDataProvider.ts";
import {
  normalizeMarketDataSymbol,
  type MarketDataProvider,
} from "./marketDataProvider.ts";
import {
  resolveMarketDataProviderName,
  selectMarketDataProvider,
} from "./marketDataProviderSelector.ts";
import { mapStockOverviewQuote } from "../watchlist/stockOverview.ts";

const receivedAt = new Date("2026-08-14T01:02:03.000Z");

test("valid FMP price becomes the canonical Stock Radar current price", () => {
  assert.deepEqual(
    normalizeFmpCurrentPrice(
      [{
        change: 1.25,
        marketCap: 3_000_000_000_000,
        price: "198.75",
        previousClose: 197.5,
        symbol: "AAPL",
        timestamp: 1_700_000_000,
        volume: 123_456,
      }],
      "aapl",
      receivedAt,
    ),
    {
      asOf: "2023-11-14T22:13:20.000Z",
      availability: "available",
      dataMode: "realtime",
      price: 198.75,
      symbol: "AAPL",
    },
  );
});

test("missing provider timestamp fails closed instead of inferring current-enough data", () => {
  assert.deepEqual(
    normalizeFmpCurrentPrice(
      [{ price: 42.5, symbol: "AMD" }],
      "AMD",
      receivedAt,
    ),
    {
      asOf: null,
      availability: "unavailable",
      dataMode: null,
      price: null,
      symbol: "AMD",
    },
  );
});

test("valid FMP quote becomes the smallest provider-neutral UI snapshot", () => {
  assert.deepEqual(
    normalizeFmpQuoteSnapshot(
      [{
        change: 2.4,
        changePercentage: 1.25,
        dayHigh: 199,
        dayLow: 190,
        marketCap: 301_000_000_000,
        open: 192,
        previousClose: 191.8,
        price: 194.2,
        symbol: "AMD",
        timestamp: 1_700_000_000,
        volume: 55_000_000,
        yearHigh: 227.3,
        yearLow: 93.1,
      }],
      "AMD",
      receivedAt,
    ),
    {
      asOf: "2023-11-14T22:13:20.000Z",
      availability: "available",
      changeAmount: 2.4,
      changePercent: 1.25,
      dayHigh: 199,
      dayLow: 190,
      open: 192,
      previousClose: 191.8,
      price: 194.2,
      symbol: "AMD",
      volume: 55_000_000,
      yearHigh: 227.3,
      yearLow: 93.1,
    },
  );
});

test("malformed, missing, non-finite, zero, and negative provider values fail closed", () => {
  const malformedPayloads: unknown[] = [
    null,
    [],
    [{}],
    [{ price: 1 }],
    [{ price: "not-a-number", symbol: "AMD" }],
    [{ price: Number.NaN, symbol: "AMD" }],
    [{ price: Number.POSITIVE_INFINITY, symbol: "AMD" }],
    [{ price: 0, symbol: "AMD" }],
    [{ price: -1, symbol: "AMD" }],
    [{ price: 1, symbol: "MSFT" }],
    [{ price: 1, symbol: "AMD", timestamp: "not-a-date" }],
  ];

  for (const payload of malformedPayloads) {
    assert.deepEqual(
      normalizeFmpCurrentPrice(payload, "AMD", receivedAt),
      {
        asOf: null,
        availability: "unavailable",
        dataMode: null,
        price: null,
        symbol: "AMD",
      },
    );
  }
});

test("provider errors and thrown requests fail closed", async () => {
  const failed = provider({
    fetchQuote: async () => ({ data: null, ok: false }),
  });
  const thrown = provider({
    fetchQuote: async () => {
      throw new Error("provider unavailable");
    },
  });

  await assertUnavailable(failed.getCurrentPrice("AMD"), "AMD");
  await assertUnavailable(thrown.getCurrentPrice("AMD"), "AMD");
});

test("valid cached FMP price preserves the stored provider timestamp", async () => {
  let physicalCalls = 0;
  const marketDataProvider = provider({
    fetchQuote: async () => {
      physicalCalls += 1;
      return { data: null, ok: false };
    },
    readCachedQuote: async () => ({
      fetchedAt: "2026-08-14T03:00:00.000Z",
      price: 17.25,
      provider: "fmp",
      rawPayload: { timestamp: 1_700_000_000 },
    }),
  });

  assert.deepEqual(await marketDataProvider.getCurrentPrice("amd"), {
    asOf: "2023-11-14T22:13:20.000Z",
    availability: "available",
    dataMode: "realtime",
    price: 17.25,
    symbol: "AMD",
  });
  assert.equal(physicalCalls, 0);
});

test("successful provider result survives cache-write failure", async () => {
  const marketDataProvider = provider({
    fetchQuote: async () => ({
      data: [{ price: 17.25, symbol: "AMD", timestamp: 1_700_000_000 }],
      ok: true,
    }),
    writeCachedQuote: async () => {
      throw new Error("cache unavailable");
    },
  });

  assert.equal(
    (await marketDataProvider.getCurrentPrice("AMD")).availability,
    "available",
  );
});

test("browser quote snapshots remain read-only and never write the market cache", async () => {
  let cacheWrites = 0;
  const marketDataProvider = provider({
    fetchQuote: async () => ({
      data: [{ price: 17.25, symbol: "AMD", timestamp: 1_700_000_000 }],
      ok: true,
    }),
    writeCachedQuote: async () => {
      cacheWrites += 1;
      return { ok: true };
    },
  });

  assert.equal(
    (await marketDataProvider.getQuoteSnapshot("AMD")).availability,
    "available",
  );
  assert.equal(cacheWrites, 0);
});

test("symbol normalization exactly preserves the existing project behavior", () => {
  assert.deepEqual(
    ["", " amd ", "brk.b", "RDS-A", "$ms/ft", "$$"].map(
      normalizeMarketDataSymbol,
    ),
    ["AAPL", "AMD", "BRK.B", "RDS-A", "MSFT", ""],
  );

  const integrations = read("lib/integrations.ts");
  assert.match(
    integrations,
    /import \{ normalizeMarketDataSymbol \} from "@\/lib\/market-data\/marketDataProvider"/,
  );
  assert.match(integrations, /const cleanSymbol = normalizeMarketDataSymbol\(symbol\)/);
  assert.doesNotMatch(
    integrations,
    /function normalizeSymbol\(symbol: string\)/,
  );
});

test("the adapter contract exposes no FMP response fields or raw payload", async () => {
  const marketDataProvider = provider({
    fetchQuote: async () => ({
      data: [{
        change: 2,
        marketCap: 10,
        price: 17.25,
        previousClose: 15.25,
        symbol: "AMD",
        volume: 99,
      }],
      ok: true,
    }),
  });
  const result = await marketDataProvider.getCurrentPrice("AMD");
  const snapshot = await marketDataProvider.getQuoteSnapshot("AMD");

  assert.deepEqual(Object.keys(result).sort(), [
    "asOf",
    "availability",
    "dataMode",
    "price",
    "symbol",
  ]);
  assert.equal(JSON.stringify(result).includes("previousClose"), false);
  assert.equal(JSON.stringify(result).includes("rawPayload"), false);
  assert.equal(JSON.stringify(snapshot).includes("marketCap"), false);
  assert.equal(JSON.stringify(snapshot).includes("rawPayload"), false);
  assert.equal(JSON.stringify(snapshot).includes("changePercentage"), false);

  const contract = read("lib/market-data/marketDataProvider.ts");
  assert.doesNotMatch(
    contract,
    /Fmp|FMP|changePercentage|changesPercentage|marketCap|rawPayload/,
  );
});

test("environment-only selection preserves FMP and selects Marketstack", () => {
  const fmp = fakeProvider("FMP");
  const marketstack = fakeProvider("MARKETSTACK");
  const providers = { fmp, marketstack };

  assert.equal(resolveMarketDataProviderName(undefined), "fmp");
  assert.equal(resolveMarketDataProviderName("fmp"), "fmp");
  assert.equal(resolveMarketDataProviderName(" marketstack "), "marketstack");
  assert.equal(resolveMarketDataProviderName("unknown"), "fmp");
  assert.equal(selectMarketDataProvider("fmp", providers), fmp);
  assert.equal(selectMarketDataProvider("marketstack", providers), marketstack);
});

test("selected provider wiring remains behind the provider-neutral boundary", () => {
  const boundary = read("lib/market-data/currentPrice.ts");
  const fmpAdapter = read("lib/market-data/fmpMarketDataProvider.ts");
  const marketstackAdapter = read("lib/market-data/marketstackPriceProvider.ts");

  assert.match(boundary, /const defaultMarketDataProvider: MarketDataProvider/);
  assert.match(boundary, /new FmpMarketDataProvider\(/);
  assert.match(boundary, /new MarketstackPriceProvider\(\)/);
  assert.match(
    boundary,
    /selectMarketDataProvider\(process\.env\.MARKET_DATA_PROVIDER/,
  );
  assert.match(boundary, /getMarketDataProvider\(\)\.getCurrentPrice\(symbol\)/);
  assert.match(boundary, /getMarketDataProvider\(\)\.getQuoteSnapshot\(symbol\)/);
  assert.doesNotMatch(boundary, /financialmodelingprep\.com|stable\/quote|\.price\b|\.timestamp\b/);
  assert.doesNotMatch(fmpAdapter, /financialmodelingprep\.com|stable\/quote|FMP_API_KEY/);
  assert.match(marketstackAdapter, /api\.marketstack\.com\/v2\/eod\/latest/);
  assert.match(marketstackAdapter, /process\.env\.MARKETSTACK_API_KEY/);
  assert.doesNotMatch(
    boundary,
    /api\.marketstack\.com|access_key|MARKETSTACK_API_KEY|\.close\b|\.date\b/,
  );
});

test("production UI consumers use the provider-neutral quote route", () => {
  const genericRoute = read("app/api/market/quote/route.ts");
  const legacyRoute = read("app/api/market/fmp/quote/route.ts");
  const watchlist = read("components/watchlist-v2/StockRadarWatchlistV2.tsx");
  const liveRoom = read("components/live-room/LiveRoomClient.tsx");
  const mapper = read("lib/watchlist/stockOverview.ts");

  assert.match(genericRoute, /getMarketQuoteSnapshot\(symbol\)/);
  assert.doesNotMatch(genericRoute, /Fmp|FMP|financialmodelingprep|fetchFmpQuote/);
  assert.match(legacyRoute, /fetchFmpQuote, fetchFmpQuotes/);
  assert.match(legacyRoute, /NextResponse\.json\(result/);
  assert.match(watchlist, /\/api\/market\/quote\?symbol=/);
  assert.match(liveRoom, /\/api\/market\/quote\?symbol=/);
  assert.doesNotMatch(watchlist, /\/api\/market\/fmp\/quote/);
  assert.doesNotMatch(liveRoom, /\/api\/market\/fmp\/quote/);
  assert.match(mapper, /price: readNumber\(row, \["price"\]\)/);
  assert.doesNotMatch(
    mapper,
    /changesPercentage|changePercentage|previousClosePrice/,
  );
});

test("a fake MarketDataProvider drives the upper UI consumer without FMP", async () => {
  const fakeProvider: MarketDataProvider = {
    getCurrentPrice: async (symbol) => ({
      asOf: receivedAt.toISOString(),
      availability: "available",
      dataMode: "realtime",
      price: 101.5,
      symbol,
    }),
    getQuoteSnapshot: async (symbol) => ({
      asOf: receivedAt.toISOString(),
      availability: "available",
      changeAmount: 1.5,
      changePercent: 1.5,
      dayHigh: 103,
      dayLow: 99,
      open: 100,
      previousClose: 100,
      price: 101.5,
      symbol,
      volume: 1_000,
      yearHigh: 120,
      yearLow: 80,
    }),
  };

  const payload = await fakeProvider.getQuoteSnapshot("MOCK");
  assert.deepEqual(mapStockOverviewQuote(payload), {
    change: 1.5,
    changePercent: 1.5,
    dayHigh: 103,
    dayLow: 99,
    open: 100,
    previousClose: 100,
    price: 101.5,
    volume: 1_000,
    yearHigh: 120,
    yearLow: 80,
  });
});

test("remaining direct FMP quote consumers are broader multi-field or compatibility flows", () => {
  const news = read("lib/newsMarketContext.ts");
  const offering = read("lib/secOfferingMarketContext.ts");
  const hydration = read("lib/marketQuoteHydration.ts");
  const sector = read("app/api/market/sector-performance/route.ts");
  const theme = read("app/api/market/theme-performance/route.ts");

  assert.match(news, /fetchFmpQuote\(symbol\)/);
  assert.match(
    news,
    /quote\?\.previousClose[\s\S]*quote\?\.marketCap[\s\S]*quote\?\.sharesOutstanding[\s\S]*quote\?\.volume[\s\S]*quote\?\.avgVolume/,
  );
  assert.match(offering, /fetchFmpQuote\(symbol\)/);
  assert.match(
    offering,
    /fmpQuote\?\.currency[\s\S]*fmpQuote\?\.previousClose[\s\S]*fmpQuote\?\.marketCap[\s\S]*fmpQuote\?\.sharesOutstanding[\s\S]*fmpQuote\?\.volume[\s\S]*fmpQuote\?\.avgVolume/,
  );
  assert.match(
    hydration,
    /fetchFmpQuotes\(symbols\)[\s\S]*previousClose[\s\S]*changeAmount[\s\S]*changePercent[\s\S]*volume/,
  );
  assert.match(sector, /fetchFmpQuotes\(batch\)[\s\S]*changePercent[\s\S]*latestPrice/);
  assert.match(theme, /fetchFmpQuotes\(normalizedSymbols\)[\s\S]*changePercent/);
});

function provider(
  overrides: Partial<FmpMarketDataProviderDependencies> = {},
) {
  return new FmpMarketDataProvider({
    fetchQuote: async () => ({ data: null, ok: false }),
    now: () => receivedAt,
    readCachedQuote: async () => null,
    writeCachedQuote: async () => ({ ok: true }),
    ...overrides,
  });
}

function fakeProvider(label: string): MarketDataProvider {
  return {
    getCurrentPrice: async (symbol) => ({
      asOf: receivedAt.toISOString(),
      availability: "available",
      dataMode: "realtime",
      price: label.length,
      symbol,
    }),
    getQuoteSnapshot: async (symbol) => ({
      asOf: receivedAt.toISOString(),
      availability: "available",
      changeAmount: null,
      changePercent: null,
      dayHigh: null,
      dayLow: null,
      open: null,
      previousClose: null,
      price: label.length,
      symbol,
      volume: null,
      yearHigh: null,
      yearLow: null,
    }),
  };
}

async function assertUnavailable(
  resultPromise: ReturnType<FmpMarketDataProvider["getCurrentPrice"]>,
  symbol: string,
) {
  assert.deepEqual(await resultPromise, {
    asOf: null,
    availability: "unavailable",
    dataMode: null,
    price: null,
    symbol,
  });
}

function read(relativePath: string) {
  return readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}
