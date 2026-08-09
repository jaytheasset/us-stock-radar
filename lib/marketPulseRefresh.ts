import "server-only";

import { getServerEnv } from "@/lib/env";
import {
  chartIntervalForRange,
  writeMarketBarCache,
  writeMarketQuoteCache,
} from "@/lib/marketDataCache";
import type { PricePoint } from "@/lib/marketTypes";

const fmpQuoteTargets = [
  { cacheSymbol: "^GSPC", providerSymbol: "^GSPC" },
  { cacheSymbol: "^DJI", providerSymbol: "^DJI" },
  { cacheSymbol: "^RUT", providerSymbol: "^RUT" },
  { cacheSymbol: "^VIX", providerSymbol: "^VIX" },
  { cacheSymbol: "ESUSD", providerSymbol: "ESUSD" },
] as const;

const polygonIndexTargets = [
  { cacheSymbol: "^NDX", providerSymbol: "I:NDX" },
  { cacheSymbol: "^SOX", providerSymbol: "I:SOX" },
] as const;

export const marketPulseCacheTtlSeconds = 4 * 24 * 60 * 60;

export const marketPulseProviderCoverage = {
  fmpQuotes: fmpQuoteTargets.map((target) => target.cacheSymbol),
  polygonIndices: polygonIndexTargets.map((target) => target.cacheSymbol),
  treasuryRates: ["US10Y"],
  unavailableWithCurrentProviderPlan: ["NQUSD", "RTYUSD"],
} as const;

export async function refreshMarketPulseCache() {
  const env = getServerEnv();
  const results = await Promise.all([
    ...fmpQuoteTargets.map((target) =>
      refreshFmpQuote(target.cacheSymbol, target.providerSymbol, env.fmpApiKey),
    ),
    ...polygonIndexTargets.map((target) =>
      refreshPolygonIndex(
        target.cacheSymbol,
        target.providerSymbol,
        env.polygonApiKey,
      ),
    ),
    refreshTreasuryRate(env.fmpApiKey),
  ]);

  const refreshed = results.filter((result) => result.ok);
  return {
    ok: refreshed.length > 0,
    refreshed: refreshed.map((result) => result.symbol),
    unavailable: [
      ...results
        .filter((result) => !result.ok)
        .map((result) => ({ symbol: result.symbol, error: result.error })),
      ...marketPulseProviderCoverage.unavailableWithCurrentProviderPlan.map(
        (symbol) => ({
          symbol,
          error: "Not available under the current FMP provider plan",
        }),
      ),
    ],
  };
}

async function refreshFmpQuote(
  cacheSymbol: string,
  providerSymbol: string,
  apiKey: string,
) {
  if (!apiKey) return failed(cacheSymbol, "FMP_API_KEY is missing");

  const url = new URL("https://financialmodelingprep.com/stable/quote");
  url.searchParams.set("symbol", providerSymbol);
  url.searchParams.set("apikey", apiKey);
  const result = await fetchJson(url);
  const row = asRecords(result.data)[0];
  if (!result.ok || !row) {
    return failed(cacheSymbol, result.error || "FMP quote unavailable");
  }

  const price = numberValue(row.price);
  if (price === null) return failed(cacheSymbol, "FMP quote price unavailable");

  const write = await writeMarketQuoteCache(
    {
      changeAmount: numberValue(row.change) ?? undefined,
      changePercent:
        numberValue(row.changePercentage ?? row.changesPercentage) ?? undefined,
      previousClose: numberValue(row.previousClose) ?? undefined,
      price,
      provider: "fmp",
      rawPayload: row,
      symbol: cacheSymbol,
      volume: numberValue(row.volume) ?? undefined,
    },
    marketPulseCacheTtlSeconds,
  );
  return write.ok
    ? succeeded(cacheSymbol)
    : failed(cacheSymbol, write.error || "FMP quote cache write failed");
}

async function refreshPolygonIndex(
  cacheSymbol: string,
  providerSymbol: string,
  apiKey: string,
) {
  if (!apiKey) return failed(cacheSymbol, "POLYGON_API_KEY is missing");

  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 7);
  const url = new URL(
    `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(providerSymbol)}/range/5/minute/${dateKey(from)}/${dateKey(to)}`,
  );
  url.searchParams.set("sort", "asc");
  url.searchParams.set("limit", "5000");
  url.searchParams.set("apiKey", apiKey);
  const result = await fetchJson(url);
  const points = asRecords(
    result.data && typeof result.data === "object"
      ? (result.data as Record<string, unknown>).results
      : null,
  )
    .map(normalizePolygonPoint)
    .filter((point): point is PricePoint & { timestamp: number } => Boolean(point))
    .sort((left, right) => left.timestamp - right.timestamp);
  if (!result.ok || !points.length) {
    return failed(cacheSymbol, result.error || "Polygon index bars unavailable");
  }

  const latestDay = etDateKey(points[points.length - 1].timestamp);
  const latestDayPoints = points.filter(
    (point) => etDateKey(point.timestamp) === latestDay,
  );
  const priorPoints = points.filter(
    (point) => etDateKey(point.timestamp) !== latestDay,
  );
  const latestPrice = latestDayPoints[latestDayPoints.length - 1].close;
  const previousClose =
    priorPoints[priorPoints.length - 1]?.close ??
    latestDayPoints[0].open;
  const changeAmount = latestPrice - previousClose;
  const changePercent = previousClose
    ? (changeAmount / previousClose) * 100
    : 0;
  const cleanPoints = latestDayPoints.map(({ timestamp: _timestamp, ...point }) => point);

  const [quoteWrite, barWrite] = await Promise.all([
    writeMarketQuoteCache(
      {
        changeAmount,
        changePercent,
        previousClose,
        price: latestPrice,
        provider: "polygon",
        rawPayload: { providerSymbol, pointCount: points.length },
        symbol: cacheSymbol,
      },
      marketPulseCacheTtlSeconds,
    ),
    writeMarketBarCache(
      {
        changeAmount,
        changePercent,
        interval: chartIntervalForRange("1D"),
        latestPrice,
        points: cleanPoints,
        previousClose,
        provider: "polygon",
        providerLabel: "Polygon 5-min index",
        range: "1D",
        rawPayload: { providerSymbol, pointCount: points.length },
        symbol: cacheSymbol,
      },
      marketPulseCacheTtlSeconds,
    ),
  ]);
  return quoteWrite.ok && barWrite.ok
    ? succeeded(cacheSymbol)
    : failed(
        cacheSymbol,
        quoteWrite.error || barWrite.error || "Polygon cache write failed",
      );
}

async function refreshTreasuryRate(apiKey: string) {
  const cacheSymbol = "US10Y";
  if (!apiKey) return failed(cacheSymbol, "FMP_API_KEY is missing");

  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 14);
  const url = new URL("https://financialmodelingprep.com/stable/treasury-rates");
  url.searchParams.set("from", dateKey(from));
  url.searchParams.set("to", dateKey(to));
  url.searchParams.set("apikey", apiKey);
  const result = await fetchJson(url);
  const rows = asRecords(result.data)
    .map((row) => ({ date: String(row.date || ""), value: numberValue(row.year10) }))
    .filter(
      (row): row is { date: string; value: number } =>
        Boolean(row.date) && row.value !== null,
    )
    .sort((left, right) => left.date.localeCompare(right.date));
  if (!result.ok || !rows.length) {
    return failed(cacheSymbol, result.error || "US 10Y rate unavailable");
  }

  const latest = rows[rows.length - 1];
  const previous = rows[rows.length - 2] || latest;
  const changeAmount = latest.value - previous.value;
  const changePercent = previous.value
    ? (changeAmount / previous.value) * 100
    : 0;
  const points: PricePoint[] = rows.map((row) => ({
    close: row.value,
    high: row.value,
    low: row.value,
    open: row.value,
    time: row.date,
    volume: 0,
    vwap: row.value,
  }));

  const [quoteWrite, barWrite] = await Promise.all([
    writeMarketQuoteCache(
      {
        changeAmount,
        changePercent,
        previousClose: previous.value,
        price: latest.value,
        provider: "fmp",
        rawPayload: rows,
        symbol: cacheSymbol,
      },
      marketPulseCacheTtlSeconds,
    ),
    writeMarketBarCache(
      {
        changeAmount,
        changePercent,
        interval: chartIntervalForRange("1D"),
        latestPrice: latest.value,
        points,
        previousClose: previous.value,
        provider: "fmp",
        providerLabel: "FMP Treasury Rates",
        range: "1D",
        rawPayload: rows,
        symbol: cacheSymbol,
      },
      marketPulseCacheTtlSeconds,
    ),
  ]);
  return quoteWrite.ok && barWrite.ok
    ? succeeded(cacheSymbol)
    : failed(
        cacheSymbol,
        quoteWrite.error || barWrite.error || "Treasury cache write failed",
      );
}

function normalizePolygonPoint(row: Record<string, unknown>) {
  const timestamp = numberValue(row.t);
  const open = numberValue(row.o);
  const high = numberValue(row.h);
  const low = numberValue(row.l);
  const close = numberValue(row.c);
  if (
    timestamp === null ||
    open === null ||
    high === null ||
    low === null ||
    close === null
  ) {
    return null;
  }

  return {
    close,
    high,
    low,
    open,
    time: new Date(timestamp).toISOString(),
    timestamp,
    volume: 0,
    vwap: close,
  };
}

async function fetchJson(url: URL) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const text = await response.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    return {
      data,
      error: response.ok ? undefined : text.slice(0, 160) || response.statusText,
      ok: response.ok,
    };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "Provider request failed",
      ok: false,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function asRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object",
      )
    : [];
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (
    typeof value === "string" &&
    value.trim() &&
    Number.isFinite(Number(value))
  ) {
    return Number(value);
  }
  return null;
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function etDateKey(timestamp: number) {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/New_York",
    year: "numeric",
  }).format(new Date(timestamp));
}

function succeeded(symbol: string) {
  return { ok: true as const, symbol };
}

function failed(symbol: string, error: string) {
  return { error, ok: false as const, symbol };
}
