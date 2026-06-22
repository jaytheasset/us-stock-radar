"use client";

import { useEffect, useMemo, useState } from "react";
import type { ContextRange, DetailTone, SectorThemeContext, TopMover } from "./detailTypes";
import type { PricePoint, PriceRange } from "@/lib/marketTypes";

const contextRanges: ContextRange[] = ["1D", "5D", "30D"];
const MARKET_CONTEXT_DATA_DISCLAIMER = "Market data is latest available, not necessarily as of the filing date.";

type ChartApiResponse = {
  ok: boolean;
  cache?: "hit" | "miss" | "bypass";
  latestPrice?: number;
  points?: PricePoint[];
  providerLabel?: string;
  range?: PriceRange;
  symbol?: string;
};

type LiveMover = {
  cache?: string;
  change: string;
  providerLabel?: string;
  values: number[];
};

type ContextMetricItem = {
  label: string;
  name: string;
  value?: string;
};

export function SectorThemeContextPanel({
  context,
  ticker,
}: {
  context: SectorThemeContext;
  ticker: string;
}) {
  const [range, setRange] = useState<ContextRange>("1D");
  const period = context.periods[range];
  const [liveMovers, setLiveMovers] = useState<Record<string, LiveMover>>({});
  const [marketDataStatus, setMarketDataStatus] = useState<"loading" | "ready" | "fallback">("loading");
  const symbols = useMemo(() => period.topMovers.map((mover) => mover.symbol), [period.topMovers]);
  const contextTitle = context.contextTitle || (isRealTicker(ticker) ? ticker : "") || context.subTheme || context.themeGroup || context.industry || context.sector || "Market";
  const moverGroupName = context.moverGroupName || context.subTheme || context.industry || context.sector || "Market";
  const moverHeading = getMoverHeading(context.moverMode, moverGroupName, range);
  const hasThemeContext = Boolean(context.themeGroup || context.subTheme);
  const metrics = [
    { label: "Sector", name: context.sector, value: period.sectorChange },
    { label: "Industry", name: context.industry, value: period.industryChange },
    context.marketCap ? { label: "Market Cap", name: context.marketCap } : null,
    context.sharesOutstanding ? { label: "Shares Outstanding", name: context.sharesOutstanding } : null,
    context.publicFloat ? { label: "Public Float", name: context.publicFloat } : null,
    context.floatPercent ? { label: "Public Float %", name: context.floatPercent } : null,
    hasThemeContext && context.themeGroup
      ? { label: "Theme", name: context.themeGroup, value: period.themeChange }
      : null,
    hasThemeContext && context.subTheme
      ? { label: "Sub Theme", name: context.subTheme, value: period.subThemeChange }
      : null,
  ].filter((metric): metric is ContextMetricItem => Boolean(metric && metric.name));

  useEffect(() => {
    const controller = new AbortController();
    const apiRange = chartRangeForContext(range);

    async function loadMovers() {
      setMarketDataStatus("loading");

      try {
        const responses = await Promise.all(
          symbols.map(async (symbol) => {
            const data = await fetchMoverChartData(symbol, apiRange, controller.signal);
            if (!data) {
              return null;
            }

            return [symbol, toLiveMover(data)] as const;
          }),
        );
        if (controller.signal.aborted) return;

        const liveEntries = responses.filter((item): item is readonly [string, LiveMover] => Boolean(item));
        setLiveMovers(Object.fromEntries(liveEntries));
        setMarketDataStatus(liveEntries.length ? "ready" : "fallback");
      } catch {
        if (controller.signal.aborted) return;
        setLiveMovers({});
        setMarketDataStatus("fallback");
      }
    }

    loadMovers();
    return () => controller.abort();
  }, [range, symbols]);

  return (
    <section className="stock-detail-card sector-theme-main-card">
      <div className="card-heading-row context-heading-row">
        <div>
          <h2>{contextTitle} Market Context</h2>
          <p className="market-context-data-disclaimer">{MARKET_CONTEXT_DATA_DISCLAIMER}</p>
        </div>
        <div className="context-range-control" aria-label="Context range">
          {contextRanges.map((item) => (
            <button
              aria-pressed={range === item}
              className={range === item ? "active" : ""}
              key={item}
              onClick={() => setRange(item)}
              type="button"
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      <div className="context-main-grid">
        {metrics.map((metric) => (
          <ContextMetric key={metric.label} {...metric} />
        ))}
      </div>
      <div className="context-movers main">
        <div className="context-movers-heading">
          <span>{moverHeading}</span>
          <em>{marketDataStatus === "ready" ? "Live market data" : marketDataStatus === "loading" ? "Updating" : "Fallback"}</em>
        </div>
        <div className="context-mover-list">
          {period.topMovers.length ? (
            period.topMovers.map((mover) => (
              <TopMoverTile key={mover.symbol} live={liveMovers[mover.symbol]} mover={mover} />
            ))
          ) : (
            <p className="context-empty-state">Market mover data is not available yet.</p>
          )}
        </div>
      </div>
    </section>
  );
}

function ContextMetric({
  label,
  name,
  value,
}: {
  label: string;
  name: string;
  value?: string;
}) {
  const tone = value ? getChangeTone(value) : undefined;

  return (
    <div className="context-metric">
      <span>{label}</span>
      <strong>{name}</strong>
      {value ? <b className={tone}>{value}</b> : null}
    </div>
  );
}

function TopMoverTile({ live, mover }: { live?: LiveMover; mover: TopMover }) {
  const change = mover.change;
  const values = live?.values && live.values.length >= 3 ? live.values : mover.trend;
  const tone = getChangeTone(change);

  return (
    <div className={`context-mover-tile ${tone}`}>
      <div className="context-mover-copy">
        <strong>{mover.symbol}</strong>
        <span>{change}</span>
      </div>
      <TopMoverSparkline values={values} tone={tone} />
    </div>
  );
}

async function fetchMoverChartData(
  symbol: string,
  range: PriceRange,
  signal: AbortSignal,
): Promise<ChartApiResponse | null> {
  const primary = await fetchMoverChartRange(symbol, range, signal);
  if (primary?.points && primary.points.length >= 3) {
    return primary;
  }

  if (range === "1D") {
    const fallback = await fetchMoverChartRange(symbol, "5D", signal);
    if (fallback?.points && fallback.points.length >= 3) {
      return fallback;
    }
  }

  return null;
}

async function fetchMoverChartRange(
  symbol: string,
  range: PriceRange,
  signal: AbortSignal,
): Promise<ChartApiResponse | null> {
  const response = await fetch(`/api/market/chart?symbol=${encodeURIComponent(symbol)}&range=${range}`, {
    cache: "no-store",
    signal,
  });
  const data = (await response.json()) as ChartApiResponse;
  if (!response.ok || !data.ok || !data.points?.length) {
    return null;
  }
  return data;
}

function TopMoverSparkline({ values, tone }: { values: number[]; tone: DetailTone }) {
  const points = values.length ? values : [24, 26, 25, 28, 31, 30, 34, 36];
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const coordinates = points
    .map((value, index) => {
      const x = 4 + (index / Math.max(points.length - 1, 1)) * 76;
      const y = 35 - ((value - min) / range) * 31;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg className={`top-mover-sparkline ${tone}`} viewBox="0 0 84 46" role="img" aria-label={`${tone} trend`}>
      <line x1="4" x2="80" y1="44" y2="44" />
      <polyline points={coordinates} />
    </svg>
  );
}

function getChangeTone(change: string): DetailTone {
  if (change.trim().startsWith("-")) {
    return "bearish";
  }

  return change.includes("0.00") ? "neutral" : "bullish";
}

function chartRangeForContext(range: ContextRange): PriceRange {
  return range === "30D" ? "1M" : range;
}

function getMoverHeading(
  mode: SectorThemeContext["moverMode"],
  groupName: string,
  range: ContextRange,
) {
  if (mode === "related") {
    return `Related Tickers in ${groupName} / ${range}`;
  }

  if (mode === "market_top_movers") {
    return `Top Movers / Losers Today / ${range}`;
  }

  return `Top Movers / Losers in ${groupName} / ${range}`;
}

function isRealTicker(value: string) {
  return Boolean(value && value !== "N/A" && value !== "NA" && /^[A-Z][A-Z0-9.-]{0,9}$/.test(value));
}

function toLiveMover(data: ChartApiResponse): LiveMover {
  const points = data.points || [];
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  const firstPrice = firstPoint?.close || firstPoint?.open || 0;
  const lastPrice = data.latestPrice || lastPoint?.close || firstPrice;
  const changePercent = firstPrice ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0;

  return {
    cache: data.cache,
    change: formatSignedPercent(changePercent),
    providerLabel: data.providerLabel,
    values: points.map((point) => point.close),
  };
}

function formatSignedPercent(value: number) {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(2)}%`;
}
