import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  FmpMarketDataProvider,
  normalizeFmpCurrentPrice,
  type FmpMarketDataProviderDependencies,
} from "./fmpMarketDataProvider.ts";
import { normalizeMarketDataSymbol } from "./marketDataProvider.ts";

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
      price: 198.75,
      symbol: "AAPL",
    },
  );
});

test("missing provider timestamp uses receipt time without estimating price", () => {
  assert.deepEqual(
    normalizeFmpCurrentPrice(
      [{ price: 42.5, symbol: "AMD" }],
      "AMD",
      receivedAt,
    ),
    {
      asOf: receivedAt.toISOString(),
      availability: "available",
      price: 42.5,
      symbol: "AMD",
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
  const result = await provider({
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
  }).getCurrentPrice("AMD");

  assert.deepEqual(Object.keys(result).sort(), [
    "asOf",
    "availability",
    "price",
    "symbol",
  ]);
  assert.equal(JSON.stringify(result).includes("previousClose"), false);
  assert.equal(JSON.stringify(result).includes("rawPayload"), false);

  const contract = read("lib/market-data/marketDataProvider.ts");
  assert.doesNotMatch(
    contract,
    /Fmp|FMP|previousClose|changePercentage|marketCap|rawPayload|volume/,
  );
});

test("default wiring is FMP behind the provider-neutral boundary", () => {
  const boundary = read("lib/market-data/currentPrice.ts");
  const adapter = read("lib/market-data/fmpMarketDataProvider.ts");

  assert.match(boundary, /const defaultMarketDataProvider: MarketDataProvider/);
  assert.match(boundary, /new FmpMarketDataProvider\(/);
  assert.match(boundary, /getMarketDataProvider\(\)\.getCurrentPrice\(symbol\)/);
  assert.doesNotMatch(boundary, /financialmodelingprep\.com|stable\/quote|\.price\b|\.timestamp\b/);
  assert.doesNotMatch(adapter, /financialmodelingprep\.com|stable\/quote|FMP_API_KEY/);
});

test("legacy FMP quote route and current-price UI consumers remain compatible", () => {
  const route = read("app/api/market/fmp/quote/route.ts");
  const watchlist = read("components/watchlist-v2/StockRadarWatchlistV2.tsx");
  const liveRoom = read("components/live-room/LiveRoomClient.tsx");
  const mapper = read("lib/watchlist/stockOverview.ts");

  assert.match(route, /fetchFmpQuote, fetchFmpQuotes/);
  assert.match(route, /NextResponse\.json\(result/);
  assert.match(watchlist, /\/api\/market\/fmp\/quote\?symbol=/);
  assert.match(liveRoom, /\/api\/market\/fmp\/quote\?symbol=/);
  assert.match(mapper, /price: readNumber\(row, \["price"\]\)/);
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

async function assertUnavailable(
  resultPromise: ReturnType<FmpMarketDataProvider["getCurrentPrice"]>,
  symbol: string,
) {
  assert.deepEqual(await resultPromise, {
    asOf: null,
    availability: "unavailable",
    price: null,
    symbol,
  });
}

function read(relativePath: string) {
  return readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}
