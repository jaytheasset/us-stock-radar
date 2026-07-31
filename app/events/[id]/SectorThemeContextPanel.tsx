"use client";

import { useEffect, useMemo, useState } from "react";
import {
  isRealTicker,
  type ContextRange,
  type DetailTone,
  type SectorThemeContext,
  type TopMover,
} from "./detailTypes";
import type { PricePoint, PriceRange } from "@/lib/marketTypes";

const contextRanges: ContextRange[] = ["1D", "5D", "30D"];

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
  storedOnly = false,
  ticker,
}: {
  context: SectorThemeContext;
  storedOnly?: boolean;
  ticker: string;
}) {
  const [range, setRange] = useState<ContextRange>("1D");
  const period = context.periods[range];
  const [liveMovers, setLiveMovers] = useState<Record<string, LiveMover>>({});
  const [marketDataStatus, setMarketDataStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const visibleMovers = useMemo(
    () => period.topMovers.filter((mover) => isRealTicker(mover.symbol)).slice(0, 6),
    [period.topMovers],
  );
  const symbols = useMemo(() => visibleMovers.map((mover) => mover.symbol), [visibleMovers]);
  const displayedMovers = visibleMovers.filter(
    (mover) => Boolean(liveMovers[mover.symbol]) || hasStoredMoverData(mover),
  );
  const contextTitle =
    context.contextTitle ||
    (isRealTicker(ticker) ? ticker : "") ||
    context.subTheme ||
    context.themeGroup ||
    context.industry ||
    context.sector ||
    "";
  const moverGroupName = context.moverGroupName || context.subTheme || context.industry || context.sector || "";
  const moverHeading = getMoverHeading(context.moverMode, moverGroupName, range);
  const metrics = [
    context.companyName ? { label: "Company", name: context.companyName } : null,
    context.exchange ? { label: "Exchange", name: context.exchange } : null,
    { label: "Sector", name: context.sector, value: period.sectorChange },
    { label: "Industry", name: context.industry, value: period.industryChange },
    context.themeGroup
      ? { label: "Theme", name: context.themeGroup, value: period.themeChange }
      : null,
    context.subTheme
      ? { label: "Sub-theme", name: context.subTheme, value: period.subThemeChange }
      : null,
    context.marketCap ? { label: "Market Cap", name: context.marketCap } : null,
    context.sharesOutstanding
      ? { label: "Shares Outstanding", name: context.sharesOutstanding }
      : null,
    context.publicFloat ? { label: "Public Float", name: context.publicFloat } : null,
    context.publicFloatPercent || context.floatPercent
      ? {
          label: "Public Float %",
          name: formatPublicFloatPercent(context.publicFloatPercent || context.floatPercent || ""),
        }
      : null,
  ].filter((metric): metric is ContextMetricItem => Boolean(metric && metric.name));
  const hasRangeData = Object.values(context.periods).some(
    (item) =>
      Boolean(item.sectorChange || item.industryChange || item.themeChange || item.subThemeChange) ||
      item.topMovers.some((mover) => isRealTicker(mover.symbol)),
  );

  useEffect(() => {
    const controller = new AbortController();
    const apiRange = chartRangeForContext(range);

    if (storedOnly) {
      return () => controller.abort();
    }

    if (!symbols.length) {
      setLiveMovers({});
      setMarketDataStatus("unavailable");
      return () => controller.abort();
    }

    async function loadMovers() {
      setLiveMovers({});
      setMarketDataStatus("loading");

      const results = await Promise.allSettled(
        symbols.map(async (symbol) => {
            const response = await fetch(`/api/market/chart?symbol=${encodeURIComponent(symbol)}&range=${apiRange}`, {
              cache: "no-store",
              signal: controller.signal,
            });
            const data = (await response.json()) as ChartApiResponse;
            if (!response.ok || !data.ok || !data.points?.length) {
              throw new Error(`Market data failed for ${symbol}`);
            }

            return [symbol, toLiveMover(data)] as const;
          }),
      );

      if (controller.signal.aborted) return;
      const responses = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      setLiveMovers(Object.fromEntries(responses));
      setMarketDataStatus(responses.length ? "ready" : "unavailable");
    }

    loadMovers();
    return () => controller.abort();
  }, [range, storedOnly, symbols]);

  return (
    <section className="stock-detail-card sector-theme-main-card">
      <div className="card-heading-row context-heading-row">
        <h2>{contextTitle ? `${contextTitle} Market Context` : "Market Context"}</h2>
        {hasRangeData ? (
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
        ) : null}
      </div>
      {metrics.length ? (
        <div className="context-main-grid">
          {metrics.map((metric) => (
            <ContextMetric key={metric.label} {...metric} />
          ))}
        </div>
      ) : null}
      {displayedMovers.length ? (
        <div className="context-movers main">
          <div className="context-movers-heading">
            <span>{moverHeading}</span>
            <em>
              {storedOnly
                ? "Stored market data"
                : marketDataStatus === "ready"
                ? "Live market data"
                : marketDataStatus === "loading"
                  ? "Updating"
                  : "Stored market data"}
            </em>
          </div>
          <div className="context-mover-list">
            {displayedMovers.map((mover) => (
              <TopMoverTile key={mover.symbol} live={liveMovers[mover.symbol]} mover={mover} />
            ))}
          </div>
        </div>
      ) : null}
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
  const change = live?.change || mover.change || "";
  const values = live?.values || mover.trend || [];
  if (!change || !values.length) return null;
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

function TopMoverSparkline({ values, tone }: { values: number[]; tone: DetailTone }) {
  if (!values.length) return null;
  const points = values;
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
    return groupName ? `Related Tickers in ${groupName} / ${range}` : `Related Tickers / ${range}`;
  }

  if (mode === "market_top_movers") {
    return `Top Movers Today / ${range}`;
  }

  return groupName ? `Top Movers in ${groupName} / ${range}` : `Top Movers / ${range}`;
}

function formatPublicFloatPercent(value: string) {
  const normalized = value.trim().replace(/,/g, "").replace(/%$/, "").trim();
  if (!/^[-+]?\d+(?:\.\d+)?$/.test(normalized)) return value.trim();

  const percentage = Number(normalized);
  return Number.isFinite(percentage) ? `${percentage.toFixed(1)}%` : value.trim();
}

function hasStoredMoverData(mover: TopMover) {
  return Boolean(mover.change && mover.trend?.length);
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
