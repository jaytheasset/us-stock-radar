"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { ChevronDown } from "lucide-react";
import { selectPriceChartXAxisIndexes } from "@/lib/priceChartAxis";
import type { DetailTone, PriceChartSeries, PricePoint, PriceRange } from "./detailTypes";

const priceRanges: PriceRange[] = ["1D", "5D", "1M", "3M", "1Y", "5Y"];

const defaultChartWidth = 408;

type PriceChartCardProps = {
  change: string;
  changeAmount: string;
  mobileCollapsible?: boolean;
  price: string;
  rangeAppearance?: "default" | "neutral";
  series: PriceChartSeries | null;
  storedOnly?: boolean;
  ticker: string;
  tone: DetailTone;
};

type ChartApiResponse = {
  ok: boolean;
  cache?: "hit" | "miss" | "bypass";
  cacheWrite?: "ok" | "skipped";
  range: PriceRange;
  providerLabel?: string;
  quoteCache?: "hit" | "miss" | "bypass" | "unavailable";
  previousClose?: number;
  latestPrice?: number;
  changeAmount?: number;
  changePercent?: number;
  points?: PricePoint[];
  error?: string;
};

type ActiveChartData = {
  changeAmount?: number;
  changePercent?: number;
  latestPrice?: number;
  points: PricePoint[];
  previousClose: number;
  providerLabel: string;
  remote: boolean;
};

export function PriceChartCard({
  change,
  changeAmount,
  mobileCollapsible = false,
  price,
  rangeAppearance = "default",
  series,
  storedOnly = false,
  ticker,
  tone,
}: PriceChartCardProps) {
  const mobileChartRegionId = useId();
  const [isMobileChartExpanded, setIsMobileChartExpanded] = useState(false);
  const [range, setRange] = useState<PriceRange>("1D");
  const [remoteDataByRange, setRemoteDataByRange] = useState<Partial<Record<PriceRange, ChartApiResponse>>>({});
  const [loadingRange, setLoadingRange] = useState<PriceRange | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const requestedRange = range;

    if (storedOnly) {
      return () => controller.abort();
    }

    async function loadChart() {
      setLoadingRange(requestedRange);
      try {
        const response = await fetch(`/api/market/chart?symbol=${encodeURIComponent(ticker)}&range=${requestedRange}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = (await response.json()) as ChartApiResponse;
        if (!response.ok || !data.ok || !data.points?.length || !data.previousClose) {
          throw new Error(data.error || "Chart request failed");
        }
        setRemoteDataByRange((current) => ({
          ...current,
          [requestedRange]: data,
        }));
      } catch (error) {
        if (controller.signal.aborted) return;
      } finally {
        if (!controller.signal.aborted) {
          setLoadingRange((current) => (current === requestedRange ? null : current));
        }
      }
    }

    loadChart();
    return () => controller.abort();
  }, [range, storedOnly, ticker]);

  const activeRemoteData = remoteDataByRange[range];
  const isLoadingActiveRange = loadingRange === range;

  const chartData = useMemo<ActiveChartData | null>(() => {
    if (activeRemoteData?.range === range && activeRemoteData.points?.length && activeRemoteData.previousClose) {
      return {
        changeAmount: activeRemoteData.changeAmount,
        changePercent: activeRemoteData.changePercent,
        latestPrice: activeRemoteData.latestPrice,
        points: activeRemoteData.points,
        previousClose: activeRemoteData.previousClose,
        providerLabel: activeRemoteData.providerLabel || "Market data",
        remote: true,
      };
    }

    if (isLoadingActiveRange) return null;

    const storedPoints = series?.periods[range] || [];
    if (!series || !storedPoints.length) return null;

    return {
      points: storedPoints,
      previousClose: series.previousClose,
      providerLabel: "Stored market data",
      remote: false,
    };
  }, [activeRemoteData, isLoadingActiveRange, range, series]);

  const displayTone = chartData?.changePercent === undefined ? tone : toneFromPercent(chartData.changePercent);
  const displayPrice = chartData?.latestPrice === undefined ? price : formatCurrency(chartData.latestPrice);
  const displayChange =
    chartData?.changeAmount === undefined || chartData.changePercent === undefined
      ? `${changeAmount} (${change})`
      : `${formatSignedCurrency(chartData.changeAmount)} (${formatSignedPercent(chartData.changePercent)})`;
  const lastPoint = chartData?.points[chartData.points.length - 1];
  const statusLabel =
    isLoadingActiveRange && !chartData
      ? "Updating market data"
      : chartData?.remote
        ? `${chartData.providerLabel}${activeRemoteData?.cache ? ` - ${cacheLabel(activeRemoteData.cache)}` : ""}`
        : chartData
          ? chartData.providerLabel
          : "Chart unavailable";

  const chartDetails = (
    <>
      {chartData ? (
        <PriceVolumeChart
          points={chartData.points}
          previousClose={chartData.previousClose}
          range={range}
          tone={displayTone}
        />
      ) : (
        <div className="price-chart-empty">
          {isLoadingActiveRange ? "Updating market data" : "Chart unavailable"}
        </div>
      )}
      {chartData ? (
        <div className="price-chart-meta">
          <span>Previous close {formatCurrency(chartData.previousClose)}</span>
          <span>Latest volume {formatVolume(lastPoint?.volume || 0)}</span>
        </div>
      ) : null}
    </>
  );

  return (
    <div
      className={`stock-detail-card price-card${
        mobileCollapsible ? " price-card-mobile-collapsible" : ""
      }`}
      data-mobile-chart-expanded={mobileCollapsible ? isMobileChartExpanded : undefined}
    >
      <div className="card-heading-row price-card-heading">
        <div>
          <h2>{ticker} Price</h2>
          <span>{statusLabel}</span>
        </div>
        <div className="price-range-control" aria-label="Price chart range">
          {priceRanges.map((item) => (
            <button
              aria-pressed={range === item}
              className={range === item && rangeAppearance === "default" ? "active" : undefined}
              key={item}
              onClick={() => setRange(item)}
              type="button"
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      <div className="price-card-topline">
        <strong className="detail-price">{displayPrice}</strong>
        <span className={`detail-change ${displayTone}`}>{displayChange}</span>
        {mobileCollapsible ? (
          <button
            aria-controls={mobileChartRegionId}
            aria-expanded={isMobileChartExpanded}
            className="price-chart-mobile-toggle"
            onClick={() => setIsMobileChartExpanded((current) => !current)}
            type="button"
          >
            <span>{isMobileChartExpanded ? "Hide chart" : "Show chart"}</span>
            <ChevronDown aria-hidden="true" size={16} />
          </button>
        ) : null}
      </div>
      {mobileCollapsible ? (
        <div className="price-chart-details" id={mobileChartRegionId}>
          {chartDetails}
        </div>
      ) : (
        chartDetails
      )}
    </div>
  );
}

function cacheLabel(cache: "hit" | "miss" | "bypass") {
  if (cache === "hit") return "cache hit";
  if (cache === "bypass") return "fresh refresh";
  return "fresh";
}

function PriceVolumeChart({
  points,
  previousClose,
  range,
  tone,
}: {
  points: PricePoint[];
  previousClose: number;
  range: PriceRange;
  tone: DetailTone;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const chartWrapRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(defaultChartWidth);
  const chartPoints = points.length ? points : [];

  useEffect(() => {
    const chartWrap = chartWrapRef.current;
    if (!chartWrap) return;

    function updateWidth(width: number) {
      const nextWidth = Math.max(Math.round(width), 1);
      setChartWidth((current) => (current === nextWidth ? current : nextWidth));
    }

    updateWidth(chartWrap.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) updateWidth(entry.contentRect.width);
    });
    observer.observe(chartWrap);
    return () => observer.disconnect();
  }, []);

  if (!chartPoints.length) {
    return <div className="price-chart-empty">No chart data</div>;
  }

  const chartBox = createChartBox(chartWidth);

  const values = chartPoints.flatMap((point) => [point.high, point.low, point.close, point.open]);
  const rawMin = Math.min(previousClose, ...values);
  const rawMax = Math.max(previousClose, ...values);
  const paddingFloor = rawMax < 1 ? Math.max(rawMax * 0.08, 0.001) : 0.05;
  const padding = Math.max((rawMax - rawMin) * 0.14, rawMax * 0.002, paddingFloor);
  const priceMin = rawMin <= 0 ? rawMin - padding : Math.max(0, rawMin - padding);
  const priceMax = rawMax + padding;
  const volumeMax = Math.max(...chartPoints.map((point) => point.volume), 1);
  const ticks = [priceMax, priceMin + (priceMax - priceMin) / 2, priceMin];
  const xTickIndexes = selectPriceChartXAxisIndexes(
    chartPoints.length,
    chartBox.plotRight - chartBox.plotLeft,
  );
  const linePoints = chartPoints
    .map(
      (point, index) =>
        `${priceX(index, chartPoints.length, chartBox).toFixed(1)},${priceY(point.close, priceMin, priceMax, chartBox).toFixed(1)}`,
    )
    .join(" ");
  const previousCloseY = priceY(previousClose, priceMin, priceMax, chartBox);
  const lastPoint = chartPoints[chartPoints.length - 1];
  const lastX = priceX(chartPoints.length - 1, chartPoints.length, chartBox);
  const lastY = priceY(lastPoint.close, priceMin, priceMax, chartBox);
  const hoveredPoint = hoveredIndex === null ? null : chartPoints[hoveredIndex];
  const hoveredX = hoveredIndex === null ? 0 : priceX(hoveredIndex, chartPoints.length, chartBox);
  const hoveredY = hoveredPoint ? priceY(hoveredPoint.close, priceMin, priceMax, chartBox) : 0;

  function handlePointerMove(event: PointerEvent<SVGRectElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = clamp((event.clientX - bounds.left) / bounds.width, 0, 1);
    setHoveredIndex(Math.round(ratio * (chartPoints.length - 1)));
  }

  return (
    <div className="price-chart-wrap" ref={chartWrapRef}>
      <svg
        className={`price-volume-chart ${tone}`}
        viewBox={`0 0 ${chartBox.width} ${chartBox.height}`}
        role="img"
        aria-label={`${range} price and volume chart`}
      >
        {ticks.map((tick) => {
          const y = priceY(tick, priceMin, priceMax, chartBox);
          return (
            <g key={tick.toFixed(4)}>
              <line className="price-grid-line" x1={chartBox.plotLeft} x2={chartBox.plotRight} y1={y} y2={y} />
              <text className="price-axis-label" x={chartBox.axisLabelX} y={y + 3}>
                {formatAxisPrice(tick)}
              </text>
            </g>
          );
        })}
        <line
          className="previous-close-line"
          x1={chartBox.plotLeft}
          x2={chartBox.plotRight}
          y1={previousCloseY}
          y2={previousCloseY}
        />
        <text className="prev-close-label" x={chartBox.plotLeft} y={Math.max(previousCloseY - 6, 12)}>
          Previous close
        </text>
        <polyline className="price-line" points={linePoints} />
        <circle className="last-price-dot" cx={lastX.toFixed(1)} cy={lastY.toFixed(1)} r="3.2" />
        {chartPoints.map((point, index) => {
          const barHeight = Math.max((point.volume / volumeMax) * (chartBox.volumeBottom - chartBox.volumeTop), 2);
          const x = priceX(index, chartPoints.length, chartBox) - volumeBarWidth(chartPoints.length) / 2;
          const y = chartBox.volumeBottom - barHeight;
          const barTone = point.close >= point.open ? "bullish" : "bearish";

          return (
            <rect
              className={`volume-bar ${barTone}`}
              height={barHeight.toFixed(1)}
              key={`${point.time}-${index}`}
              rx="1.2"
              width={volumeBarWidth(chartPoints.length).toFixed(1)}
              x={x.toFixed(1)}
              y={y.toFixed(1)}
            />
          );
        })}
        {xTickIndexes.map((index) => (
          <text className="time-axis-label" key={`${chartPoints[index].time}-${index}`} textAnchor={textAnchorForIndex(index, chartPoints.length)} x={priceX(index, chartPoints.length, chartBox)} y={chartBox.xAxisY}>
            {formatTimeAxisLabel(chartPoints[index].time, range)}
          </text>
        ))}
        <text className="volume-axis-label" x={chartBox.plotLeft} y={chartBox.volumeTop - 7}>
          Volume
        </text>
        {hoveredPoint ? (
          <g>
            <line className="price-hover-line" x1={hoveredX} x2={hoveredX} y1={chartBox.plotTop} y2={chartBox.volumeBottom} />
            <circle className="hover-price-dot" cx={hoveredX} cy={hoveredY} r="3.8" />
          </g>
        ) : null}
        <rect
          className="chart-hover-zone"
          height={chartBox.volumeBottom - chartBox.plotTop}
          onPointerLeave={() => setHoveredIndex(null)}
          onPointerMove={handlePointerMove}
          width={chartBox.plotRight - chartBox.plotLeft}
          x={chartBox.plotLeft}
          y={chartBox.plotTop}
        />
      </svg>
      {hoveredPoint ? (
        <div
          className={`price-chart-tooltip${hoveredX > chartBox.width * 0.58 ? " left" : ""}`}
          style={{ left: `${(hoveredX / chartBox.width) * 100}%` }}
        >
          <strong>{hoveredPoint.time}</strong>
          <span>Price {formatCurrency(hoveredPoint.close)}</span>
          <span>
            Change {formatSignedCurrency(hoveredPoint.close - previousClose)} (
            {formatSignedPercent(((hoveredPoint.close - previousClose) / previousClose) * 100)})
          </span>
          <span>Volume {formatVolume(hoveredPoint.volume)}</span>
          <span>
            O/H/L/C {formatCurrency(hoveredPoint.open)} / {formatCurrency(hoveredPoint.high)} /{" "}
            {formatCurrency(hoveredPoint.low)} / {formatCurrency(hoveredPoint.close)}
          </span>
          <span>VWAP {formatCurrency(hoveredPoint.vwap)}</span>
        </div>
      ) : null}
    </div>
  );
}

function createChartBox(width: number) {
  const plotLeft = 14;
  const plotRight = Math.max(plotLeft + 1, width - 82);

  return {
    axisLabelX: plotRight + 14,
    height: 208,
    plotBottom: 116,
    plotLeft,
    plotRight,
    plotTop: 20,
    volumeBottom: 176,
    volumeTop: 140,
    width,
    xAxisY: 198,
  };
}

type ChartBox = ReturnType<typeof createChartBox>;

function priceX(index: number, count: number, chartBox: ChartBox) {
  return chartBox.plotLeft + (index / Math.max(count - 1, 1)) * (chartBox.plotRight - chartBox.plotLeft);
}

function priceY(value: number, min: number, max: number, chartBox: ChartBox) {
  const minimumRange = max < 1 ? Math.max(max * 0.025, 0.0005) : 0.01;
  return chartBox.plotBottom - ((value - min) / Math.max(max - min, minimumRange)) * (chartBox.plotBottom - chartBox.plotTop);
}

function volumeBarWidth(count: number) {
  if (count > 160) return 1.4;
  if (count > 70) return 2.4;
  if (count > 30) return 4.2;
  return 8.4;
}

function textAnchorForIndex(index: number, count: number) {
  if (index === 0) return "start";
  if (index === count - 1) return "end";
  return "middle";
}

function toneFromPercent(value: number): DetailTone {
  if (value > 0.05) return "bullish";
  if (value < -0.05) return "bearish";
  return "neutral";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function formatCurrency(value: number) {
  return `$${value.toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}`;
}

function formatSignedCurrency(value: number) {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}`;
}

function formatSignedPercent(value: number) {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(2)}%`;
}

function formatAxisPrice(value: number) {
  if (value >= 1000) {
    return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }

  if (Math.abs(value) < 1) {
    const formatted = value.toFixed(4).replace(/0+$/g, "").replace(/\.$/g, "");
    return `$${formatted}`;
  }

  return `$${value.toFixed(value < 10 ? 2 : 2)}`;
}

function formatTimeAxisLabel(value: string, range: PriceRange) {
  if (range === "5D" || range === "1M") {
    return value.split(",")[0] || value;
  }

  if (range !== "1Y" && range !== "5Y") return value;

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;

  const date = new Date(parsed);
  if (range === "5Y") {
    return new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone: "UTC" }).format(date);
  }

  const month = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(date);
  const year = new Intl.DateTimeFormat("en-US", { year: "2-digit", timeZone: "UTC" }).format(date);
  return `${month} '${year}`;
}

function formatVolume(value: number) {
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(2)}B`;
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }

  return String(Math.round(value));
}
