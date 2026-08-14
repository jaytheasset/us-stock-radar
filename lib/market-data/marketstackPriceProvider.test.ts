import assert from "node:assert/strict";
import test from "node:test";
import {
  MARKETSTACK_DATA_TIMELINESS,
  MarketstackPriceProvider,
  normalizeMarketstackCurrentPrice,
  normalizeMarketstackQuoteSnapshot,
  type MarketstackPriceProviderDependencies,
} from "./marketstackPriceProvider.ts";

const validPayload = {
  data: [{
    close: "230.15",
    date: "2026-08-13T00:00:00+0000",
    high: 232.25,
    low: 227.4,
    open: 228.1,
    symbol: "AAPL",
    volume: 41_250_000,
  }],
  pagination: { count: 1, limit: 100, offset: 0, total: 1 },
};

test("Marketstack latest EOD data becomes the canonical current-price contract", () => {
  assert.deepEqual(normalizeMarketstackCurrentPrice(validPayload, " aapl "), {
    asOf: "2026-08-13T00:00:00.000Z",
    availability: "available",
    price: 230.15,
    symbol: "AAPL",
  });
  assert.equal(MARKETSTACK_DATA_TIMELINESS, "end-of-day");
});

test("Marketstack EOD fields become the existing provider-neutral quote snapshot", () => {
  assert.deepEqual(normalizeMarketstackQuoteSnapshot(validPayload, "AAPL"), {
    asOf: "2026-08-13T00:00:00.000Z",
    availability: "available",
    changeAmount: null,
    changePercent: null,
    dayHigh: 232.25,
    dayLow: 227.4,
    open: 228.1,
    previousClose: null,
    price: 230.15,
    symbol: "AAPL",
    volume: 41_250_000,
    yearHigh: null,
    yearLow: null,
  });
});

test("Marketstack request construction and response parsing stay inside the provider", async () => {
  let physicalCalls = 0;
  let requestedEndpoint = "";
  let requestedSymbol = "";
  let includedAccessKey = false;
  const marketDataProvider = provider({
    fetchImpl: async (input) => {
      physicalCalls += 1;
      const requestedUrl = new URL(String(input));
      requestedEndpoint = `${requestedUrl.origin}${requestedUrl.pathname}`;
      requestedSymbol = requestedUrl.searchParams.get("symbols") ?? "";
      includedAccessKey = requestedUrl.searchParams.has("access_key");
      return jsonResponse(validPayload);
    },
  });

  const result = await marketDataProvider.getCurrentPrice("aapl");

  assert.equal(physicalCalls, 1);
  assert.equal(
    requestedEndpoint,
    "https://api.marketstack.com/v2/eod/latest",
  );
  assert.equal(requestedSymbol, "AAPL");
  assert.equal(includedAccessKey, true);
  assert.deepEqual(result, {
    asOf: "2026-08-13T00:00:00.000Z",
    availability: "available",
    price: 230.15,
    symbol: "AAPL",
  });
});

test("missing key performs no request and fails closed", async () => {
  let physicalCalls = 0;
  const marketDataProvider = provider({
    apiKey: "",
    fetchImpl: async () => {
      physicalCalls += 1;
      return jsonResponse(validPayload);
    },
  });

  await assertUnavailable(marketDataProvider.getCurrentPrice("AAPL"), "AAPL");
  assert.equal(physicalCalls, 0);
});

test("malformed, mismatched, missing, non-finite, zero, and negative values fail closed", () => {
  const malformedPayloads: unknown[] = [
    null,
    {},
    { data: null },
    { data: [] },
    { data: [{}] },
    { data: [{ close: 1, date: "2026-08-13", symbol: "MSFT" }] },
    { data: [{ close: "not-a-number", date: "2026-08-13", symbol: "AAPL" }] },
    { data: [{ close: Number.NaN, date: "2026-08-13", symbol: "AAPL" }] },
    { data: [{ close: Number.POSITIVE_INFINITY, date: "2026-08-13", symbol: "AAPL" }] },
    { data: [{ close: 0, date: "2026-08-13", symbol: "AAPL" }] },
    { data: [{ close: -1, date: "2026-08-13", symbol: "AAPL" }] },
    { data: [{ close: 1, date: "not-a-date", symbol: "AAPL" }] },
    { data: [{ close: 1, symbol: "AAPL" }] },
  ];

  for (const payload of malformedPayloads) {
    assert.deepEqual(normalizeMarketstackCurrentPrice(payload, "AAPL"), {
      asOf: null,
      availability: "unavailable",
      price: null,
      symbol: "AAPL",
    });
  }
});

test("HTTP, provider, JSON, and transport errors fail closed without leaking details", async () => {
  const providers = [
    provider({
      fetchImpl: async () => jsonResponse(
        { error: { code: "plan_access_restricted", message: "restricted" } },
        403,
      ),
    }),
    provider({
      fetchImpl: async () => jsonResponse(
        { error: { code: "provider_error", message: "failed" } },
      ),
    }),
    provider({
      fetchImpl: async () => new Response("not json", { status: 200 }),
    }),
    provider({
      fetchImpl: async () => {
        throw new Error("transport failed");
      },
    }),
  ];

  for (const marketDataProvider of providers) {
    const result = await marketDataProvider.getCurrentPrice("AAPL");
    assert.deepEqual(result, {
      asOf: null,
      availability: "unavailable",
      price: null,
      symbol: "AAPL",
    });
    assert.deepEqual(Object.keys(result).sort(), [
      "asOf",
      "availability",
      "price",
      "symbol",
    ]);
  }
});

function provider(
  overrides: Partial<MarketstackPriceProviderDependencies> = {},
) {
  return new MarketstackPriceProvider({
    apiKey: "local-test-value",
    fetchImpl: async () => jsonResponse(null, 500),
    timeoutMs: 1_000,
    ...overrides,
  });
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

async function assertUnavailable(
  resultPromise: ReturnType<MarketstackPriceProvider["getCurrentPrice"]>,
  symbol: string,
) {
  assert.deepEqual(await resultPromise, {
    asOf: null,
    availability: "unavailable",
    price: null,
    symbol,
  });
}
