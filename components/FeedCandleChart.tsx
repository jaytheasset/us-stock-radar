"use client";

import { useEffect, useMemo, useState } from "react";
import type { MarketBar } from "@/lib/integrations";

type FeedCandleChartProps = {
  allowFetch?: boolean;
  bars?: MarketBar[];
  fallbackValues: number[];
  loadDelayMs?: number;
  symbol: string;
  tone: "bullish" | "bearish";
};

type ChartCacheEntry = {
  bars?: MarketBar[];
  promise?: Promise<MarketBar[]>;
};

const chartCache = new Map<string, ChartCacheEntry>();

export function FeedCandleChart({
  allowFetch = true,
  bars,
  fallbackValues,
  loadDelayMs = 0,
  symbol,
  tone,
}: FeedCandleChartProps) {
  const initialBars = useMemo(() => (bars && bars.length ? bars : []), [bars]);
  const [asyncBars, setAsyncBars] = useState<MarketBar[]>(initialBars);
  const normalizedSymbol = symbol.trim().toUpperCase();

  useEffect(() => {
    if (initialBars.length) {
      setAsyncBars(initialBars);
      return;
    }

    if (!allowFetch || !isFetchableSymbol(normalizedSymbol)) return;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      getClientChart(normalizedSymbol)
        .then((loadedBars) => {
          if (!cancelled && loadedBars.length) {
            setAsyncBars(loadedBars);
          }
        })
        .catch(() => undefined);
    }, loadDelayMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [allowFetch, initialBars, loadDelayMs, normalizedSymbol]);

  return (
    <CandleVolumeChart
      bars={asyncBars}
      fallbackValues={fallbackValues}
      tone={tone}
    />
  );
}

function getClientChart(symbol: string) {
  const cached = chartCache.get(symbol);
  if (cached?.bars) return Promise.resolve(cached.bars);
  if (cached?.promise) return cached.promise;

  const promise = fetch(`/api/market/chart?symbol=${encodeURIComponent(symbol)}&range=1D`, {
    cache: "force-cache",
  })
    .then(async (response) => {
      if (!response.ok) return [];
      const payload = (await response.json()) as { points?: unknown };
      return normalizeApiBars(payload.points);
    })
    .then((loadedBars) => {
      chartCache.set(symbol, { bars: loadedBars });
      return loadedBars;
    })
    .catch(() => {
      chartCache.delete(symbol);
      return [];
    });

  chartCache.set(symbol, { promise });
  return promise;
}

function CandleVolumeChart({
  bars,
  fallbackValues,
  tone,
}: {
  bars?: MarketBar[];
  fallbackValues: number[];
  tone: "bullish" | "bearish";
}) {
  const width = 128;
  const height = 88;
  const priceTop = 0;
  const priceHeight = 66;
  const volumeTop = 68;
  const volumeBottomPadding = 2;
  const visibleBars = (bars && bars.length ? bars.slice(-22) : buildFallbackBars(fallbackValues, tone)).slice(-22);
  const lows = visibleBars.map((bar) => bar.low);
  const highs = visibleBars.map((bar) => bar.high);
  const volumes = visibleBars.map((bar) => bar.volume);
  const minPrice = Math.min(...lows);
  const maxPrice = Math.max(...highs);
  const maxVolume = Math.max(...volumes, 1);
  const priceSpread = Math.max(maxPrice - minPrice, 0.01);
  const candleGap = width / Math.max(visibleBars.length, 1);
  const candleWidth = Math.max(4, Math.min(7, candleGap * 0.48));

  function yPrice(value: number) {
    return priceTop + ((maxPrice - value) / priceSpread) * priceHeight;
  }

  return (
    <svg className="candle-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Daily candlestick chart with volume">
      {visibleBars.map((bar, index) => {
        const x = index * candleGap + candleGap / 2;
        const openY = yPrice(bar.open);
        const closeY = yPrice(bar.close);
        const highY = yPrice(bar.high);
        const lowY = yPrice(bar.low);
        const bullish = bar.close >= bar.open;
        const bodyY = Math.min(openY, closeY);
        const bodyHeight = Math.max(2, Math.abs(closeY - openY));
        const volumeHeight = Math.max(2, (bar.volume / maxVolume) * 16);

        return (
          <g className={bullish ? "bullish" : "bearish"} key={`${bar.date}-${index}`}>
            <line className="candle-wick" x1={x} x2={x} y1={highY} y2={lowY} />
            <rect
              className="candle-body"
              x={x - candleWidth / 2}
              y={bodyY}
              width={candleWidth}
              height={bodyHeight}
              rx="1"
            />
            <rect
              className="volume-bar"
              x={x - candleWidth / 2}
              y={height - volumeHeight - volumeBottomPadding}
              width={candleWidth}
              height={volumeHeight}
              rx="1"
            />
          </g>
        );
      })}
      <line className="volume-divider" x1="0" x2={width} y1={volumeTop} y2={volumeTop} />
    </svg>
  );
}

function buildFallbackBars(values: number[], tone: "bullish" | "bearish"): MarketBar[] {
  return values.map((value, index) => {
    const drift = tone === "bearish" ? -1 : 1;
    const open = value - drift * 0.8;
    const close = value + drift * 0.8;
    return {
      close,
      date: String(index),
      high: Math.max(open, close) + 1.4,
      low: Math.min(open, close) - 1.4,
      open,
      volume: 1000 + index * 160 + (index % 3) * 240,
    };
  });
}

function normalizeApiBars(value: unknown): MarketBar[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const open = numberOrUndefined(record.open);
      const high = numberOrUndefined(record.high);
      const low = numberOrUndefined(record.low);
      const close = numberOrUndefined(record.close);
      const volume = numberOrUndefined(record.volume);
      const date = typeof record.time === "string"
        ? record.time
        : typeof record.date === "string"
          ? record.date
          : "";

      if (!date || open === undefined || high === undefined || low === undefined || close === undefined || volume === undefined) {
        return null;
      }

      return { close, date, high, low, open, volume };
    })
    .filter((item): item is MarketBar => Boolean(item));
}

function numberOrUndefined(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isFetchableSymbol(value: string) {
  return Boolean(value && value !== "N/A" && value !== "NA" && value !== "UNKNOWN" && /^[A-Z][A-Z0-9.-]{0,9}$/.test(value));
}
