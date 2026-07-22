import { unstable_cache } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

const chartRanges = ["1D", "5D", "1M", "3M", "6M", "YTD", "1Y", "5Y"] as const;

type DashboardChartRange = (typeof chartRanges)[number];

type FmpBar = {
  close: number;
  high: number;
  low: number;
  open: number;
  time: string;
  timestamp: number;
  volume: number;
};

type FmpQuote = {
  changeAmount?: number;
  changePercent?: number;
  previousClose?: number;
  price?: number;
};

type RangeConfig =
  | {
      kind: "intraday";
      interval: "5min" | "30min" | "1hour";
      maxPoints: number;
      providerLabel: string;
      tradingDays: number;
    }
  | {
      kind: "eod";
      maxPoints: number;
      providerLabel: string;
      startDate: string;
    };

const intradayChartCacheSeconds = 60;
const dailyChartCacheSeconds = 3_600;

const loadCachedIntradayChart = unstable_cache(
  async (symbol: string, range: DashboardChartRange) => loadChartPayload(symbol, range),
  ["dashboard-v2-intraday-chart-v2"],
  { revalidate: intradayChartCacheSeconds },
);

const loadCachedDailyChart = unstable_cache(
  async (symbol: string, range: DashboardChartRange) => loadChartPayload(symbol, range),
  ["dashboard-v2-daily-chart-v2"],
  { revalidate: dailyChartCacheSeconds },
);

export async function GET(request: NextRequest) {
  const env = getServerEnv();
  const symbol = normalizeSymbol(request.nextUrl.searchParams.get("symbol") || "AMD");
  const range = normalizeRange(request.nextUrl.searchParams.get("range"));

  if (!env.fmpApiKey) {
    return NextResponse.json(
      { ok: false, error: "FMP_API_KEY is missing", symbol, range },
      { status: 503 },
    );
  }

  const config = rangeConfig(range, new Date());
  try {
    const payload = await (config.kind === "intraday"
      ? loadCachedIntradayChart(symbol, range)
      : loadCachedDailyChart(symbol, range));
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "FMP chart data is unavailable",
        symbol,
        range,
      },
      { status: 502 },
    );
  }
}

async function loadChartPayload(symbol: string, range: DashboardChartRange) {
  const env = getServerEnv();
  if (!env.fmpApiKey) throw new Error("FMP_API_KEY is missing");
  const fetchedAt = new Date().toISOString();
  const config = rangeConfig(range, new Date(fetchedAt));
  const [quoteResult, barsResult] = await Promise.all([
    fetchFmpQuote(symbol, env.fmpApiKey),
    config.kind === "intraday"
      ? fetchFmpIntradayBars(symbol, config, env.fmpApiKey)
      : fetchFmpEodBars(symbol, config, env.fmpApiKey),
  ]);

  if (!barsResult.ok || !barsResult.bars.length) {
    throw new Error(barsResult.error || "FMP returned no chart bars");
  }

  const points = appendLatestQuote(barsResult.bars, quoteResult.quote?.price);
  const latest = points.at(-1);
  if (!latest) {
    throw new Error("FMP returned no usable chart bars");
  }
  const previousClose =
    quoteResult.quote?.previousClose ?? points[Math.max(points.length - 2, 0)]?.close ?? latest.open;
  const latestPrice = quoteResult.quote?.price ?? latest.close;
  const changeAmount = quoteResult.quote?.changeAmount ?? latestPrice - previousClose;
  const changePercent =
    quoteResult.quote?.changePercent ??
    (previousClose ? (changeAmount / previousClose) * 100 : 0);

  return {
    ok: true,
    asOf: chartAsOf(latest, fetchedAt),
    changeAmount: round(changeAmount),
    changePercent: round(changePercent),
    latestPrice: round(latestPrice),
    points: points.map(stripTimestamp),
    previousClose: round(previousClose),
    provider: "fmp",
    providerLabel: config.providerLabel,
    range,
    receivedAt: fetchedAt,
    symbol,
  };
}

function rangeConfig(range: DashboardChartRange, now: Date): RangeConfig {
  switch (range) {
    case "1D":
      return { interval: "5min", kind: "intraday", maxPoints: 96, providerLabel: "FMP 5-minute", tradingDays: 1 };
    case "5D":
      return { interval: "30min", kind: "intraday", maxPoints: 80, providerLabel: "FMP 30-minute", tradingDays: 5 };
    case "1M":
      return { interval: "1hour", kind: "intraday", maxPoints: 180, providerLabel: "FMP 1-hour", tradingDays: 22 };
    case "3M":
      return { kind: "eod", maxPoints: 90, providerLabel: "FMP daily", startDate: dateOffset(now, -92) };
    case "6M":
      return { kind: "eod", maxPoints: 130, providerLabel: "FMP daily", startDate: dateOffset(now, -184) };
    case "YTD":
      return { kind: "eod", maxPoints: 180, providerLabel: "FMP daily", startDate: `${now.getUTCFullYear()}-01-01` };
    case "1Y":
      return { kind: "eod", maxPoints: 252, providerLabel: "FMP daily", startDate: dateOffset(now, -365) };
    case "5Y":
      return { kind: "eod", maxPoints: 260, providerLabel: "FMP daily", startDate: dateOffset(now, -1_826) };
  }
}

async function fetchFmpQuote(symbol: string, apiKey: string) {
  const url = new URL("https://financialmodelingprep.com/stable/quote");
  url.searchParams.set("symbol", symbol);
  const result = await fetchFmp(url, apiKey);

  if (!result.ok) return { ok: false, quote: null };

  const item = asArray(result.data)[0];
  if (!item || typeof item !== "object") return { ok: false, quote: null };

  const row = item as Record<string, unknown>;
  const price = numberValue(row.price);
  const previousClose = numberValue(row.previousClose ?? row.previousClosePrice);
  const changeAmount = numberValue(row.change);
  const reportedChangePercent = numberValue(row.changesPercentage ?? row.changePercentage);
  const changePercent = Number.isFinite(reportedChangePercent)
    ? reportedChangePercent
    : Number.isFinite(price) && Number.isFinite(previousClose) && previousClose
      ? ((price - previousClose) / previousClose) * 100
      : Number.NaN;

  return {
    ok: Number.isFinite(price),
    quote: {
      changeAmount: Number.isFinite(changeAmount) ? changeAmount : undefined,
      changePercent: Number.isFinite(changePercent) ? changePercent : undefined,
      previousClose: Number.isFinite(previousClose) ? previousClose : undefined,
      price: Number.isFinite(price) ? price : undefined,
    },
  };
}

async function fetchFmpIntradayBars(symbol: string, config: Extract<RangeConfig, { kind: "intraday" }>, apiKey: string) {
  const url = new URL(`https://financialmodelingprep.com/stable/historical-chart/${config.interval}`);
  url.searchParams.set("symbol", symbol);
  const result = await fetchFmp(url, apiKey);

  if (!result.ok) return { ok: false, bars: [], error: result.error };

  const bars = asArray(result.data)
    .map(normalizeBar)
    .filter((bar): bar is FmpBar => Boolean(bar))
    .sort((a, b) => a.timestamp - b.timestamp);
  const dates = [...new Set(bars.map((bar) => bar.time.slice(0, 10)))].slice(-config.tradingDays);
  const visible = bars
    .filter((bar) => dates.includes(bar.time.slice(0, 10)))
    .slice(-config.maxPoints);

  return {
    ok: visible.length > 0,
    bars: visible,
    error: visible.length ? undefined : "FMP returned no intraday bars",
  };
}

async function fetchFmpEodBars(symbol: string, config: Extract<RangeConfig, { kind: "eod" }>, apiKey: string) {
  const url = new URL("https://financialmodelingprep.com/stable/historical-price-eod/full");
  url.searchParams.set("symbol", symbol);
  const result = await fetchFmp(url, apiKey);

  if (!result.ok) return { ok: false, bars: [], error: result.error };

  const source = extractHistoricalRows(result.data);
  const visible = source
    .map(normalizeBar)
    .filter((bar): bar is FmpBar => Boolean(bar))
    .filter((bar) => bar.time.slice(0, 10) >= config.startDate)
    .sort((a, b) => a.timestamp - b.timestamp);
  const bars = downsampleBars(visible, config.maxPoints);

  return {
    ok: bars.length > 0,
    bars,
    error: bars.length ? undefined : "FMP returned no daily bars",
  };
}

async function fetchFmp(url: URL, apiKey: string) {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json", apikey: apiKey },
    });
    const data = await response.json().catch(() => null);
    return {
      data,
      error: response.ok ? undefined : readError(data, response.statusText),
      ok: response.ok,
    };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "FMP request failed",
      ok: false,
    };
  }
}

function normalizeBar(value: unknown): FmpBar | null {
  if (!value || typeof value !== "object") return null;

  const row = value as Record<string, unknown>;
  const time = String(row.date ?? "");
  const open = numberValue(row.open);
  const high = numberValue(row.high);
  const low = numberValue(row.low);
  const close = numberValue(row.close);
  const volume = numberValue(row.volume);
  const timestamp = parseTimestamp(time);

  if (!time || !Number.isFinite(timestamp) || !Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) {
    return null;
  }

  return {
    close,
    high,
    low,
    open,
    time,
    timestamp,
    volume: Number.isFinite(volume) ? volume : 0,
  };
}

function appendLatestQuote(bars: FmpBar[], quotePrice: number | undefined) {
  if (quotePrice === undefined || !Number.isFinite(quotePrice) || !bars.length) return bars;

  const latestQuote = quotePrice;

  const last = bars[bars.length - 1];
  if (!last || Math.abs(last.close - latestQuote) < 0.0001) return bars;

  return [
    ...bars,
    {
      close: latestQuote,
      high: Math.max(last.close, latestQuote),
      low: Math.min(last.close, latestQuote),
      open: last.close,
      time: "Latest quote",
      timestamp: Date.now(),
      volume: 0,
    },
  ];
}

function downsampleBars(bars: FmpBar[], maxPoints: number) {
  if (bars.length <= maxPoints) return bars;

  const bucketSize = Math.ceil(bars.length / maxPoints);
  const result: FmpBar[] = [];

  for (let index = 0; index < bars.length; index += bucketSize) {
    const bucket = bars.slice(index, index + bucketSize);
    const first = bucket[0];
    const last = bucket[bucket.length - 1];
    result.push({
      close: last.close,
      high: Math.max(...bucket.map((bar) => bar.high)),
      low: Math.min(...bucket.map((bar) => bar.low)),
      open: first.open,
      time: last.time,
      timestamp: last.timestamp,
      volume: bucket.reduce((total, bar) => total + bar.volume, 0),
    });
  }

  return result;
}

function extractHistoricalRows(value: unknown) {
  if (Array.isArray(value)) {
    if (value.length === 1 && value[0] && typeof value[0] === "object" && "historical" in value[0]) {
      return asArray((value[0] as { historical?: unknown }).historical);
    }

    return value;
  }

  if (value && typeof value === "object" && "historical" in value) {
    return asArray((value as { historical?: unknown }).historical);
  }

  return [];
}

function stripTimestamp(bar: FmpBar) {
  return {
    close: round(bar.close),
    high: round(bar.high),
    low: round(bar.low),
    open: round(bar.open),
    time: bar.time,
    volume: Math.round(bar.volume),
  };
}

function normalizeRange(value: string | null): DashboardChartRange {
  return chartRanges.includes(value as DashboardChartRange) ? (value as DashboardChartRange) : "1D";
}

function normalizeSymbol(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "") || "AMD";
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalized = value.replace(/%/g, "").trim();
    if (normalized && Number.isFinite(Number(normalized))) return Number(normalized);
  }

  return Number.NaN;
}

function parseTimestamp(value: string) {
  const normalized = value.includes(" ") ? value.replace(" ", "T") : `${value}T12:00:00`;
  return Date.parse(`${normalized}Z`);
}

function chartAsOf(latest: FmpBar, fetchedAt: string) {
  if (latest.time === "Latest quote") return fetchedAt;
  const timestamp = parseTimestamp(latest.time);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : fetchedAt;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function dateOffset(now: Date, days: number) {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function readError(value: unknown, fallback: string) {
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    return String(row.error ?? row.message ?? row["Error Message"] ?? fallback);
  }

  return fallback;
}

function round(value: number) {
  return Number(value.toFixed(2));
}
