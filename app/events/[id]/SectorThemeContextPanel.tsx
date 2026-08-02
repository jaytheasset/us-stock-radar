"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  isRealTicker,
  type ContextRange,
  type DetailTone,
  type SectorThemeContext,
  type TopMover,
} from "./detailTypes";
import type { PricePoint, PriceRange } from "@/lib/marketTypes";
import { paginateAnalysisPeers } from "@/lib/analysisPeerSelection";

const contextRanges: ContextRange[] = ["1D", "5D", "30D"];

type ChartApiResponse = {
  ok: boolean;
  cache?: "hit" | "miss" | "bypass";
  changePercent?: number;
  latestPrice?: number;
  points?: PricePoint[];
  providerLabel?: string;
  range?: PriceRange;
  symbol?: string;
};

type LiveMover = {
  cache?: string;
  change: string;
  price: string;
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
  const [marketDataStatus, setMarketDataStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const visibleMovers = useMemo(
    () => period.topMovers.filter((mover) => isRealTicker(mover.symbol)).slice(0, 6),
    [period.topMovers],
  );
  const symbols = useMemo(() => visibleMovers.map((mover) => mover.symbol), [visibleMovers]);
  const contextTitle =
    context.contextTitle ||
    (isRealTicker(ticker) ? ticker : "") ||
    context.subTheme ||
    context.themeGroup ||
    context.industry ||
    context.sector ||
    "";
  const moverGroupName = context.moverGroupName || context.subTheme || context.industry || context.sector || "";
  const moverHeading = getMoverHeading(
    context.moverMode,
    moverGroupName,
    range,
    visibleMovers,
  );
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
  }, [range, symbols]);

  return (
    <section className="stock-detail-card sector-theme-main-card">
      <div className="card-heading-row context-heading-row">
        <h2>{contextTitle ? `${contextTitle} Market Context` : "Market Context"}</h2>
        {hasRangeData ? (
          <div className="context-range-control" aria-label="Context range" role="group">
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
      {visibleMovers.length ? (
        <div className="context-movers main">
          <div className="context-movers-heading">
            <span>{moverHeading}</span>
            <em>
              {marketDataStatus === "ready"
                ? "Live market data"
                : marketDataStatus === "loading"
                  ? "Updating"
                  : "Market data unavailable"}
            </em>
          </div>
          <div className="context-mover-list context-mover-desktop-grid">
            {visibleMovers.map((mover) => (
              <TopMoverTile
                isLoading={marketDataStatus === "loading"}
                key={mover.symbol}
                live={liveMovers[mover.symbol]}
                mover={mover}
              />
            ))}
          </div>
          <MarketContextMobileSlider
            isLoading={marketDataStatus === "loading"}
            liveMovers={liveMovers}
            movers={visibleMovers}
          />
        </div>
      ) : (
        <p className="context-empty-state">
          Related ticker and taxonomy peer market data is unavailable for this event.
        </p>
      )}
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

function TopMoverTile({
  isLoading,
  live,
  mover,
}: {
  isLoading: boolean;
  live?: LiveMover;
  mover: TopMover;
}) {
  const change = live?.change || "";
  const price = live?.price || "";
  const values = live?.values || [];
  const hasMarketData = Boolean(change && price && values.length);
  const tone = hasMarketData ? getChangeTone(change) : "neutral";
  const companyName = mover.companyName || "Company name unavailable";
  const status = isLoading ? "Updating market data" : "Market data unavailable";

  return (
    <article
      aria-label={`${mover.symbol}, ${companyName}, ${hasMarketData ? `${price}, ${change}` : status}`}
      className={`context-mover-tile ${tone}`}
      data-peer-source={mover.source || "stored"}
      tabIndex={0}
    >
      <div className="context-mover-copy">
        <div>
          <strong>{mover.symbol}</strong>
          <small title={companyName}>{companyName}</small>
        </div>
        {hasMarketData ? (
          <div className="context-mover-quote">
            <b>{price}</b>
            <span>{change}</span>
          </div>
        ) : (
          <span className="context-mover-unavailable">{status}</span>
        )}
      </div>
      {hasMarketData ? (
        <TopMoverSparkline values={values} tone={tone} />
      ) : (
        <div aria-hidden="true" className="top-mover-sparkline-placeholder" />
      )}
    </article>
  );
}

function MarketContextMobileSlider({
  isLoading,
  liveMovers,
  movers,
}: {
  isLoading: boolean;
  liveMovers: Record<string, LiveMover>;
  movers: TopMover[];
}) {
  const pages = useMemo(() => paginateAnalysisPeers(movers), [movers]);
  const [currentPage, setCurrentPage] = useState(0);
  const sliderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCurrentPage((current) => Math.min(current, Math.max(pages.length - 1, 0)));
  }, [pages.length]);

  const scrollToPage = (page: number, behavior: ScrollBehavior = "smooth") => {
    const slider = sliderRef.current;
    if (!slider) return;
    const nextPage = Math.max(0, Math.min(page, pages.length - 1));
    slider.scrollTo({
      behavior,
      left: nextPage * slider.clientWidth,
    });
    setCurrentPage(nextPage);
  };

  return (
    <div className="context-mover-mobile-carousel">
      <div
        aria-label="Market context ticker pages"
        className="context-mover-slider"
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") {
            event.preventDefault();
            scrollToPage(currentPage + 1);
          } else if (event.key === "ArrowLeft") {
            event.preventDefault();
            scrollToPage(currentPage - 1);
          } else if (event.key === "Home") {
            event.preventDefault();
            scrollToPage(0);
          } else if (event.key === "End") {
            event.preventDefault();
            scrollToPage(pages.length - 1);
          }
        }}
        onScroll={(event) => {
          const slider = event.currentTarget;
          if (!slider.clientWidth) return;
          setCurrentPage(
            Math.max(
              0,
              Math.min(
                pages.length - 1,
                Math.round(slider.scrollLeft / slider.clientWidth),
              ),
            ),
          );
        }}
        ref={sliderRef}
        role="region"
        tabIndex={0}
      >
        {pages.map((page, pageIndex) => (
          <div
            aria-label={`Ticker page ${pageIndex + 1} of ${pages.length}`}
            className="context-mover-slide"
            key={page.map((mover) => mover.symbol).join("-")}
            role="group"
          >
            {page.map((mover) => (
              <TopMoverTile
                isLoading={isLoading}
                key={mover.symbol}
                live={liveMovers[mover.symbol]}
                mover={mover}
              />
            ))}
          </div>
        ))}
      </div>
      <div
        aria-label={`Market context page ${currentPage + 1} of ${pages.length}`}
        className="context-mover-pagination"
        role="group"
      >
        {pages.map((page, pageIndex) => (
          <button
            aria-current={currentPage === pageIndex ? "page" : undefined}
            aria-label={`Show ticker page ${pageIndex + 1} of ${pages.length}`}
            key={page.map((mover) => mover.symbol).join("-")}
            onClick={() => scrollToPage(pageIndex)}
            type="button"
          />
        ))}
      </div>
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
  movers: TopMover[],
) {
  const relatedCount = movers.filter((mover) => mover.source === "related").length;
  const fillerCount = movers.filter((mover) => mover.source === "filler").length;
  if (relatedCount && fillerCount) {
    return `Directly Related + Taxonomy Peers / ${range}`;
  }

  if (mode === "related" || relatedCount) {
    return `Directly Related Tickers / ${range}`;
  }

  if (fillerCount) {
    return groupName ? `Peers in ${groupName} / ${range}` : `Taxonomy Peers / ${range}`;
  }

  return groupName ? `Top Movers in ${groupName} / ${range}` : `Top Movers / ${range}`;
}

function formatPublicFloatPercent(value: string) {
  const normalized = value.trim().replace(/,/g, "").replace(/%$/, "").trim();
  if (!/^[-+]?\d+(?:\.\d+)?$/.test(normalized)) return value.trim();

  const percentage = Number(normalized);
  return Number.isFinite(percentage) ? `${percentage.toFixed(1)}%` : value.trim();
}

function toLiveMover(data: ChartApiResponse): LiveMover {
  const points = data.points || [];
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  const firstPrice = firstPoint?.close || firstPoint?.open || 0;
  const lastPrice = data.latestPrice || lastPoint?.close || firstPrice;
  const changePercent = Number.isFinite(data.changePercent)
    ? Number(data.changePercent)
    : firstPrice
      ? ((lastPrice - firstPrice) / firstPrice) * 100
      : Number.NaN;

  return {
    cache: data.cache,
    change: Number.isFinite(changePercent) ? formatSignedPercent(changePercent) : "",
    price: Number.isFinite(lastPrice) ? formatCurrency(lastPrice) : "",
    providerLabel: data.providerLabel,
    values: points.map((point) => point.close),
  };
}

function formatSignedPercent(value: number) {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(2)}%`;
}

function formatCurrency(value: number) {
  return `$${value.toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}`;
}
