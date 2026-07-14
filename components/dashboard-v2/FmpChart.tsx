"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import type { ChartRange } from "@/components/chart/ChartRangeSelector";
import styles from "./FmpChart.module.css";

type FmpChartPoint = {
  close: number;
  high: number;
  low: number;
  open: number;
  time: string;
  volume: number;
};

type FmpChartResponse = {
  changeAmount: number;
  changePercent: number;
  error?: string;
  latestPrice: number;
  ok: boolean;
  points: FmpChartPoint[];
  previousClose: number;
  provider: "fmp";
  providerLabel: string;
  range: ChartRange;
  symbol: string;
};

export type FmpMarketSnapshot = {
  changeAmount: number;
  changePercent: number;
  latestPrice: number;
  previousClose: number;
  ticker: string;
};

type FmpChartProps = {
  mobileOnly: boolean;
  onMarketData: (snapshot: FmpMarketSnapshot) => void;
  range: ChartRange;
  ticker: string;
};

type ChartBox = {
  axisLabelX: number;
  height: number;
  plotBottom: number;
  plotLeft: number;
  plotRight: number;
  plotTop: number;
  volumeBottom: number;
  volumeTop: number;
  width: number;
};

const desktopChartBox: ChartBox = {
  axisLabelX: 612,
  height: 282,
  plotBottom: 196,
  plotLeft: 12,
  plotRight: 564,
  plotTop: 22,
  volumeBottom: 256,
  volumeTop: 216,
  width: 620,
};

const mobileChartBox: ChartBox = {
  axisLabelX: 608,
  height: 552,
  plotBottom: 370,
  plotLeft: 12,
  plotRight: 550,
  plotTop: 18,
  volumeBottom: 492,
  volumeTop: 394,
  width: 620,
};

export function FmpChart({ mobileOnly, onMarketData, range, ticker }: FmpChartProps) {
  const [data, setData] = useState<FmpChartResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState<boolean | null>(null);
  const onMarketDataRef = useRef(onMarketData);

  useEffect(() => {
    onMarketDataRef.current = onMarketData;
  }, [onMarketData]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 760px)");
    const syncViewport = () => setIsMobileViewport(mediaQuery.matches);

    syncViewport();
    mediaQuery.addEventListener("change", syncViewport);

    return () => mediaQuery.removeEventListener("change", syncViewport);
  }, []);

  useEffect(() => {
    if (isMobileViewport === null || isMobileViewport !== mobileOnly) return;

    const controller = new AbortController();

    async function loadChart() {
      setData(null);
      setIsLoading(true);

      try {
        const response = await fetch(
          `/api/dashboard-v2/chart?symbol=${encodeURIComponent(ticker)}&range=${range}`,
          { cache: "no-store", signal: controller.signal },
        );
        const payload = (await response.json()) as FmpChartResponse;

        if (!response.ok || !payload.ok || !payload.points?.length) {
          throw new Error(payload.error || "Chart request failed");
        }

        setData(payload);
        onMarketDataRef.current({
          changeAmount: payload.changeAmount,
          changePercent: payload.changePercent,
          latestPrice: payload.latestPrice,
          previousClose: payload.previousClose,
          ticker: payload.symbol,
        });
      } catch (requestError) {
        if (!controller.signal.aborted) {
          setData(null);
        }
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }

    loadChart();
    return () => controller.abort();
  }, [isMobileViewport, mobileOnly, range, ticker]);

  if (isMobileViewport === null || isMobileViewport !== mobileOnly) return null;

  if (isLoading && !data) {
    return <div className={styles.status}>Loading chart…</div>;
  }

  if (!data) {
    return <div className={styles.status}>Chart data unavailable</div>;
  }

  return <FmpCandlestickChart data={data} mobile={mobileOnly} />;
}

function FmpCandlestickChart({ data, mobile }: { data: FmpChartResponse; mobile: boolean }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const chartBox = mobile ? mobileChartBox : desktopChartBox;
  const points = data.points;
  const values = points.flatMap((point) => [point.open, point.high, point.low, point.close]);
  const rawMin = Math.min(data.previousClose, ...values);
  const rawMax = Math.max(data.latestPrice, ...values);
  const padding = Math.max((rawMax - rawMin) * 0.12, Math.abs(rawMax) * 0.002, 0.01);
  const priceMin = Math.max(0, rawMin - padding);
  const priceMax = rawMax + padding;
  const maxVolume = Math.max(...points.map((point) => point.volume), 1);
  // Keep the highest FMP volume bar clear of the price/volume divider.
  const volumeScaleMax = maxVolume * 1.12;
  const ticks = useMemo(
    () => Array.from({ length: 4 }, (_, index) => priceMax - ((priceMax - priceMin) * index) / 3),
    [priceMax, priceMin],
  );
  const xTickIndexes = useMemo(() => axisIndexes(points.length), [points.length]);
  const latest = points[points.length - 1];
  const latestY = priceY(latest.close, priceMin, priceMax, chartBox);
  const hoveredPoint = hoveredIndex === null ? null : points[hoveredIndex];
  const hoveredX = hoveredIndex === null ? 0 : priceX(hoveredIndex, points.length, chartBox);

  function handlePointerMove(event: PointerEvent<SVGRectElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = clamp((event.clientX - bounds.left) / bounds.width, 0, 1);
    setHoveredIndex(Math.round(ratio * (points.length - 1)));
  }

  return (
    <div className={styles.root}>
      <div className={styles.chartWrap}>
        <svg aria-hidden="true" className={`${styles.chart}${mobile ? ` ${styles.mobileChart}` : ""}`} focusable="false" viewBox={`0 0 ${chartBox.width} ${chartBox.height}`}>
          {ticks.map((tick) => {
            const y = priceY(tick, priceMin, priceMax, chartBox);
            return (
              <g key={tick.toFixed(4)}>
                <line className={styles.grid} x1={chartBox.plotLeft} x2={chartBox.plotRight} y1={y} y2={y} />
                <text className={styles.axis} textAnchor="end" x={chartBox.axisLabelX} y={y + 4}>{formatPrice(tick)}</text>
              </g>
            );
          })}

          {xTickIndexes.map((index) => {
            const x = priceX(index, points.length, chartBox);
            return (
              <g key={`${points[index].time}-${index}`}>
                <line className={styles.verticalGrid} x1={x} x2={x} y1={chartBox.plotTop} y2={chartBox.volumeBottom} />
                <text className={styles.timeAxis} textAnchor={textAnchor(index, points.length)} x={x} y={chartBox.height - 8}>
                  {formatTime(points[index].time, data.range)}
                </text>
              </g>
            );
          })}

          {points.map((point, index) => {
            const x = priceX(index, points.length, chartBox);
            const openY = priceY(point.open, priceMin, priceMax, chartBox);
            const closeY = priceY(point.close, priceMin, priceMax, chartBox);
            const highY = priceY(point.high, priceMin, priceMax, chartBox);
            const lowY = priceY(point.low, priceMin, priceMax, chartBox);
            const bullish = point.close >= point.open;
            const bodyY = Math.min(openY, closeY);
            const bodyHeight = Math.max(1.5, Math.abs(closeY - openY));
            const volumeHeight = Math.max(1, (point.volume / volumeScaleMax) * (chartBox.volumeBottom - chartBox.volumeTop));
            const width = candleWidth(points.length, chartBox);
            const tone = bullish ? styles.bullish : styles.bearish;

            return (
              <g className={tone} key={`${point.time}-${index}`}>
                <rect className={styles.volume} height={volumeHeight} width={width} x={x - width / 2} y={chartBox.volumeBottom - volumeHeight} />
                <line className={styles.wick} x1={x} x2={x} y1={highY} y2={lowY} />
                <rect className={styles.body} height={bodyHeight} rx="1" width={width} x={x - width / 2} y={bodyY} />
              </g>
            );
          })}

          <line
            className={styles.volumeDivider}
            x1={chartBox.plotLeft}
            x2={chartBox.plotRight}
            y1={chartBox.volumeTop}
            y2={chartBox.volumeTop}
          />
          <text className={styles.volumeAxis} textAnchor="end" x={chartBox.axisLabelX} y={chartBox.volumeTop + 8}>
            {formatVolume(volumeScaleMax)}
          </text>
          <text className={styles.volumeAxis} textAnchor="end" x={chartBox.axisLabelX} y={chartBox.volumeBottom}>
            0
          </text>
          <line className={styles.lastPriceLine} x1={chartBox.plotLeft} x2={chartBox.plotRight} y1={latestY} y2={latestY} />
          {!mobile ? (
            <>
              <rect className={styles.lastPricePill} height="20" rx="2" width="48" x={chartBox.plotRight + 2} y={latestY - 10} />
              <text className={styles.lastPriceText} textAnchor="middle" x={chartBox.plotRight + 26} y={latestY + 4}>{formatPrice(latest.close, false)}</text>
            </>
          ) : null}

          {hoveredPoint ? (
            <g>
              <line className={styles.hoverLine} x1={hoveredX} x2={hoveredX} y1={chartBox.plotTop} y2={chartBox.volumeBottom} />
              <circle className={styles.hoverDot} cx={hoveredX} cy={priceY(hoveredPoint.close, priceMin, priceMax, chartBox)} r="3" />
            </g>
          ) : null}
          <rect className={styles.hoverZone} height={chartBox.volumeBottom - chartBox.plotTop} onPointerLeave={() => setHoveredIndex(null)} onPointerMove={handlePointerMove} width={chartBox.plotRight - chartBox.plotLeft} x={chartBox.plotLeft} y={chartBox.plotTop} />
        </svg>

        {hoveredPoint ? (
          <div className={`${styles.tooltip}${hoveredX > chartBox.width / 2 ? ` ${styles.tooltipLeft}` : ""}`} style={{ left: `${(hoveredX / chartBox.width) * 100}%` }}>
            <strong>{formatTooltipTime(hoveredPoint.time)}</strong>
            <span>O {formatPrice(hoveredPoint.open)}</span>
            <span>H {formatPrice(hoveredPoint.high)}</span>
            <span>L {formatPrice(hoveredPoint.low)}</span>
            <span>C {formatPrice(hoveredPoint.close)}</span>
            <span>Vol {formatVolume(hoveredPoint.volume)}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function priceX(index: number, count: number, chartBox: ChartBox) {
  return chartBox.plotLeft + (index / Math.max(count - 1, 1)) * (chartBox.plotRight - chartBox.plotLeft);
}

function priceY(value: number, min: number, max: number, chartBox: ChartBox) {
  return chartBox.plotBottom - ((value - min) / Math.max(max - min, 0.01)) * (chartBox.plotBottom - chartBox.plotTop);
}

function candleWidth(count: number, chartBox: ChartBox) {
  return Math.max(1, Math.min(8, ((chartBox.plotRight - chartBox.plotLeft) / Math.max(count, 1)) * 0.56));
}

function axisIndexes(count: number) {
  const labelCount = Math.min(count, 5);
  if (labelCount <= 1) return [0];
  return Array.from(new Set(Array.from({ length: labelCount }, (_, index) => Math.round((index / (labelCount - 1)) * (count - 1)))));
}

function textAnchor(index: number, count: number) {
  if (index === 0) return "start";
  if (index === count - 1) return "end";
  return "middle";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function formatPrice(value: number, currency = true) {
  const formatted = value.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  return currency ? `$${formatted}` : formatted;
}

function formatVolume(value: number) {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

function formatTime(value: string, range: ChartRange) {
  if (value === "Latest quote") return "Now";
  const date = new Date(value.includes(" ") ? `${value.replace(" ", "T")}Z` : `${value}T12:00:00Z`);
  if (!Number.isFinite(date.getTime())) return value;
  if (range === "1D") return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(date);
  if (range === "5D" || range === "1M") return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone: "America/New_York" }).format(date);
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: range === "5Y" ? "2-digit" : undefined, timeZone: "UTC" }).format(date);
}

function formatTooltipTime(value: string) {
  return value === "Latest quote" ? value : value.replace(" ", " ");
}
