import { NextRequest, NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env";
import {
  chartIntervalForRange,
  readMarketBarCache,
  readMarketQuoteCache,
  writeMarketBarCache,
} from "@/lib/marketDataCache";
import { deriveMarketRangeMovement } from "@/lib/marketChartMovement";
import {
  coalesceMarketChartRequest,
  marketChartRequestKey,
} from "@/lib/marketRequestCoalescing";
import type { PriceChartRange as PriceRange, PricePoint } from "@/lib/marketTypes";

export const dynamic = "force-dynamic";

const priceRanges = ["1D", "5D", "1M", "3M", "1Y", "5Y"] as const;

type TimedChartPoint = PricePoint & {
  dateKey: string;
  timestamp: number;
};

type ChartFetchResult = {
  ok: boolean;
  provider: "polygon" | "fmp";
  providerLabel: string;
  points: PricePoint[];
  previousClose?: number;
  error?: string;
};

type QuoteSnapshot = {
  cacheStatus?: "hit" | "miss" | "bypass" | "unavailable";
  price?: number;
  previousClose?: number;
  changeAmount?: number;
  changePercent?: number;
  provider?: string;
  rawPayload?: unknown;
  volume?: number;
};

type PolygonRangeConfig = {
  calendarDays: number;
  label: string;
  multiplier: number;
  pointLimit: number;
  timespan: "minute" | "hour" | "day";
};

type MarketChartPayload = {
  ok: boolean;
  cache?: "miss" | "bypass";
  cacheWrite?: "ok" | "skipped";
  changeAmount?: number;
  changePercent?: number;
  error?: string;
  interval?: string;
  latestPrice?: number;
  points?: PricePoint[];
  previousClose?: number;
  provider?: "polygon" | "fmp";
  providerLabel?: string;
  quoteCache?: QuoteSnapshot["cacheStatus"];
  quoteChangeAmount?: number;
  quoteChangePercent?: number;
  range?: PriceRange;
  rangeChangeAmount?: number;
  rangeChangePercent?: number;
  symbol: string;
  warning?: string;
};

export async function GET(request: NextRequest) {
  const env = getServerEnv();
  const symbol = normalizeSymbol(request.nextUrl.searchParams.get("symbol") || "AAPL");
  const range = normalizeRange(request.nextUrl.searchParams.get("range"));
  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";
  const softUnavailable = request.nextUrl.searchParams.get("soft") === "1";
  const interval = range === "5Y" ? "1day" : chartIntervalForRange(range) || "1day";

  if (!forceRefresh && range !== "5Y") {
    const cachedChart = await readMarketBarCache(symbol, range, interval);
    if (cachedChart.hit && cachedChart.data) {
      const rangeMovement = deriveMarketRangeMovement(cachedChart.data.points);
      return NextResponse.json({
        ok: true,
        cache: "hit",
        symbol,
        range,
        interval,
        provider: cachedChart.data.provider,
        providerLabel: cachedChart.data.providerLabel,
        previousClose: cachedChart.data.previousClose,
        latestPrice: cachedChart.data.latestPrice,
        changeAmount: cachedChart.data.changeAmount,
        changePercent: cachedChart.data.changePercent,
        quoteChangeAmount: cachedChart.data.changeAmount,
        quoteChangePercent: cachedChart.data.changePercent,
        rangeChangeAmount: rangeMovement?.changeAmount,
        rangeChangePercent: rangeMovement?.changePercent,
        points: cachedChart.data.points,
      });
    }
  }

  const payload = await coalesceMarketChartRequest(
    marketChartRequestKey({ forceRefresh, interval, range, symbol }),
    () =>
      loadMarketChart({
        forceRefresh,
        interval,
        polygonApiKey: env.polygonApiKey,
        range,
        symbol,
      }),
  );

  return NextResponse.json(payload, {
    status: payload.ok || softUnavailable ? 200 : 502,
  });
}

async function loadMarketChart({
  forceRefresh,
  interval,
  polygonApiKey,
  range,
  symbol,
}: {
  forceRefresh: boolean;
  interval: string;
  polygonApiKey: string;
  range: PriceRange;
  symbol: string;
}): Promise<MarketChartPayload> {
  const [polygonResult, quote] = await Promise.all([
    fetchPolygonChart(symbol, range, polygonApiKey),
    fetchQuoteSnapshot(symbol, forceRefresh),
  ]);

  const chartResult = polygonResult;

  if (!chartResult.ok || !chartResult.points.length) {
    return {
      ok: false,
      symbol,
      range,
      error: chartResult.error || polygonResult.error || "No chart data returned",
    };
  }

  const latestPoint = chartResult.points[chartResult.points.length - 1];
  const latestPrice = quote.price ?? latestPoint.close;
  const previousClose =
    quote.previousClose ??
    chartResult.previousClose ??
    chartResult.points[Math.max(chartResult.points.length - 2, 0)]?.close ??
    latestPoint.open;
  const changeAmount = quote.changeAmount ?? latestPrice - previousClose;
  const changePercent =
    quote.changePercent ??
    (previousClose ? (changeAmount / previousClose) * 100 : 0);
  const rangeMovement = deriveMarketRangeMovement(chartResult.points);
  const responsePayload = {
    ok: true,
    cache: forceRefresh ? "bypass" : "miss",
    quoteCache: quote.cacheStatus,
    symbol,
    range,
    interval,
    provider: chartResult.provider,
    providerLabel: chartResult.providerLabel,
    previousClose: roundPrice(previousClose),
    latestPrice: roundPrice(latestPrice),
    changeAmount: roundPrice(changeAmount),
    changePercent: roundPrice(changePercent),
    quoteChangeAmount: roundPrice(changeAmount),
    quoteChangePercent: roundPrice(changePercent),
    rangeChangeAmount: rangeMovement
      ? roundPrice(rangeMovement.changeAmount)
      : undefined,
    rangeChangePercent: rangeMovement
      ? roundPrice(rangeMovement.changePercent)
      : undefined,
    points: chartResult.points,
    warning: polygonResult.ok ? undefined : polygonResult.error,
  } satisfies Omit<MarketChartPayload, "cacheWrite">;

  const cacheWrite =
    range === "5Y"
      ? { ok: false }
      : await writeMarketBarCache({
          changeAmount: responsePayload.changeAmount,
          changePercent: responsePayload.changePercent,
          interval,
          latestPrice: responsePayload.latestPrice,
          points: chartResult.points,
          previousClose: responsePayload.previousClose,
          provider: chartResult.provider,
          providerLabel: chartResult.providerLabel,
          range,
          rawPayload: {
            pointCount: chartResult.points.length,
            quoteCache: quote.cacheStatus,
            warning: responsePayload.warning,
          },
          symbol,
        });

  return {
    ...responsePayload,
    cacheWrite: cacheWrite.ok ? "ok" : "skipped",
  };
}

async function fetchPolygonChart(
  symbol: string,
  range: PriceRange,
  apiKey: string,
): Promise<ChartFetchResult> {
  if (!apiKey) {
    return {
      ok: false,
      provider: "polygon",
      providerLabel: "Polygon",
      points: [],
      error: "POLYGON_API_KEY is missing",
    };
  }

  const config = polygonRangeConfig(range);
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - config.calendarDays);

  const url = new URL(
    `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/${config.multiplier}/${config.timespan}/${toDateString(from)}/${toDateString(to)}`,
  );
  url.searchParams.set("adjusted", "true");
  url.searchParams.set("sort", "asc");
  url.searchParams.set("limit", "50000");
  url.searchParams.set("apiKey", apiKey);

  const result = await fetchJson(url);
  if (!result.ok) {
    return {
      ok: false,
      provider: "polygon",
      providerLabel: "Polygon",
      points: [],
      error: result.error || `Polygon failed with ${result.status}`,
    };
  }

  const rows =
    result.data && typeof result.data === "object" && "results" in result.data
      ? (result.data as { results?: unknown }).results
      : [];
  const normalized = asArray(rows)
    .map((row) => normalizePolygonPoint(row, range, config))
    .filter((point): point is TimedChartPoint => Boolean(point))
    .sort((a, b) => a.timestamp - b.timestamp);

  if (!normalized.length) {
    return {
      ok: false,
      provider: "polygon",
      providerLabel: "Polygon",
      points: [],
      error: "Polygon returned no bars",
    };
  }

  if (range === "1D") {
    const latestDateKey = normalized[normalized.length - 1].dateKey;
    const firstLatestIndex = normalized.findIndex((point) => point.dateKey === latestDateKey);
    const previousClose = firstLatestIndex > 0 ? normalized[firstLatestIndex - 1].close : undefined;
    return {
      ok: true,
      provider: "polygon",
      providerLabel: config.label,
      previousClose,
      points: normalized
        .filter((point) => point.dateKey === latestDateKey)
        .map(stripInternalPoint),
    };
  }

  const points = normalized.slice(-config.pointLimit);
  return {
    ok: true,
    provider: "polygon",
    providerLabel: config.label,
    previousClose: points.length > 1 ? points[points.length - 2].close : undefined,
    points: points.map(stripInternalPoint),
  };
}

async function fetchQuoteSnapshot(symbol: string, forceRefresh: boolean): Promise<QuoteSnapshot> {
  if (!forceRefresh) {
    const cached = await readMarketQuoteCache(symbol);
    if (cached.hit && cached.quote && cached.quote.provider !== "fmp") return { ...cached.quote, cacheStatus: "hit" };
  }
  return { cacheStatus: "unavailable" };
}

function polygonRangeConfig(range: PriceRange): PolygonRangeConfig {
  switch (range) {
    case "1D":
      return { multiplier: 5, timespan: "minute", calendarDays: 8, pointLimit: 192, label: "Polygon 5-min extended" };
    case "5D":
      return { multiplier: 30, timespan: "minute", calendarDays: 14, pointLimit: 240, label: "Polygon 30-min extended" };
    case "1M":
      return { multiplier: 2, timespan: "hour", calendarDays: 45, pointLimit: 240, label: "Polygon 2-hour extended" };
    case "3M":
      return { multiplier: 1, timespan: "day", calendarDays: 120, pointLimit: 66, label: "Polygon daily" };
    case "1Y":
      return { multiplier: 1, timespan: "day", calendarDays: 420, pointLimit: 252, label: "Polygon daily" };
    case "5Y":
      return { multiplier: 1, timespan: "day", calendarDays: 1900, pointLimit: 1260, label: "Polygon daily" };
  }
}

function normalizePolygonPoint(value: unknown, range: PriceRange, config: PolygonRangeConfig): TimedChartPoint | null {
  if (!value || typeof value !== "object") return null;

  const item = value as Record<string, unknown>;
  const timestamp = numberValue(item.t);
  const open = numberValue(item.o);
  const high = numberValue(item.h);
  const low = numberValue(item.l);
  const close = numberValue(item.c);
  const volume = numberValue(item.v);
  const vwap = numberValue(item.vw);

  if (
    !Number.isFinite(timestamp) ||
    !Number.isFinite(open) ||
    !Number.isFinite(high) ||
    !Number.isFinite(low) ||
    !Number.isFinite(close)
  ) {
    return null;
  }

  return {
    close,
    dateKey: formatEtDateKey(timestamp),
    high,
    low,
    open,
    time: formatPolygonPointTime(timestamp, range, config.timespan),
    timestamp,
    volume: Number.isFinite(volume) ? volume : 0,
    vwap: Number.isFinite(vwap) ? vwap : typicalPrice(high, low, close),
  };
}

function stripInternalPoint(point: TimedChartPoint): PricePoint {
  return {
    close: roundPrice(point.close),
    high: roundPrice(point.high),
    low: roundPrice(point.low),
    open: roundPrice(point.open),
    time: point.time,
    volume: Math.round(point.volume),
    vwap: roundPrice(point.vwap),
  };
}

async function fetchJson(url: URL) {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const data = await response.json().catch(() => null);
    return {
      ok: response.ok,
      status: response.status,
      data,
      error: response.ok ? undefined : readError(data, response.statusText),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: error instanceof Error ? error.message : "Request failed",
    };
  }
}

function readError(data: unknown, fallback: string) {
  if (data && typeof data === "object") {
    const item = data as Record<string, unknown>;
    return stringValue(item.error ?? item.message ?? item["Error Message"]) || fallback;
  }

  return fallback;
}

function normalizeRange(value: string | null): PriceRange {
  return priceRanges.includes(value as PriceRange) ? (value as PriceRange) : "1D";
}

function normalizeSymbol(symbol: string) {
  return (symbol || "AAPL").trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "") || "AAPL";
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return Number.NaN;
}

function stringValue(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function asArray(value: unknown): unknown[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function typicalPrice(high: number, low: number, close: number) {
  return (high + low + close) / 3;
}

function roundPrice(value: number) {
  return Number(value.toFixed(2));
}

function toDateString(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatEtDateKey(timestamp: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/New_York",
    year: "numeric",
  }).formatToParts(new Date(timestamp));

  return `${findPart(parts, "year")}-${findPart(parts, "month")}-${findPart(parts, "day")}`;
}

function formatEtTime(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  }).format(new Date(timestamp));
}

function formatEtDate(timestamp: number, range: PriceRange) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: range === "1Y" || range === "5Y" ? "numeric" : undefined,
    timeZone: "America/New_York",
  }).format(new Date(timestamp));
}

function formatEtDateTime(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: "America/New_York",
  }).format(new Date(timestamp));
}

function formatPolygonPointTime(
  timestamp: number,
  range: PriceRange,
  timespan: PolygonRangeConfig["timespan"],
) {
  if (range === "1D") return formatEtTime(timestamp);
  if (timespan !== "day") return formatEtDateTime(timestamp);
  return formatEtDate(timestamp, range);
}

function formatDateLabel(date: string, range: PriceRange) {
  const timestamp = Date.parse(`${date}T12:00:00Z`);
  if (!Number.isFinite(timestamp)) return date;

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: range === "1Y" || range === "5Y" ? "numeric" : undefined,
    timeZone: "UTC",
  }).format(new Date(timestamp));
}

function findPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  return parts.find((part) => part.type === type)?.value || "";
}
