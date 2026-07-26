"use client";

import { useMemo, useState, type PointerEvent } from "react";
import type { StockOverviewChartPoint } from "@/lib/watchlist/stockOverview";
import styles from "./StockRadarWatchlistV2.module.css";

type WatchlistStockChartProps = {
  points: readonly StockOverviewChartPoint[];
  ticker: string;
};

const chartWidth = 900;
const chartHeight = 286;
const chartLeft = 12;
const chartRight = 842;
const chartTop = 22;
const chartBottom = 238;

export function WatchlistStockChart({
  points,
  ticker,
}: WatchlistStockChartProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const values = points.map((point) => point.close);
  const low = values.length ? Math.min(...values) : 0;
  const high = values.length ? Math.max(...values) : 1;
  const padding = Math.max((high - low) * 0.12, high * 0.002, 0.01);
  const minimum = low - padding;
  const maximum = high + padding;
  const span = maximum - minimum || 1;
  const xForIndex = (index: number) =>
    chartLeft +
    ((chartRight - chartLeft) * index) / Math.max(points.length - 1, 1);
  const yForValue = (value: number) =>
    chartBottom -
    ((value - minimum) / span) * (chartBottom - chartTop);
  const linePath = useMemo(
    () =>
      points
        .map(
          (point, index) =>
            `${index === 0 ? "M" : "L"}${xForIndex(index).toFixed(2)},${yForValue(point.close).toFixed(2)}`,
        )
        .join(" "),
    [points, minimum, span],
  );
  const areaPath = linePath
    ? `${linePath} L${chartRight},${chartBottom} L${chartLeft},${chartBottom} Z`
    : "";
  const selectedIndex = activeIndex ?? Math.max(points.length - 1, 0);
  const selected = points[selectedIndex];
  const axisIndexes = Array.from(
    new Set(
      (points.length < 4 ? points.map((_, index) => index) : [0, 0.25, 0.5, 0.75, 1].map(
        (ratio) => Math.round((points.length - 1) * ratio),
      )),
    ),
  );

  function handlePointerMove(event: PointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - bounds.left) / Math.max(bounds.width, 1);
    setActiveIndex(
      Math.max(
        0,
        Math.min(points.length - 1, Math.round(ratio * (points.length - 1))),
      ),
    );
  }

  if (points.length < 2) {
    return (
      <div className={styles.chartUnavailable} role="status">
        <strong>—</strong>
        <span>Price chart unavailable</span>
      </div>
    );
  }

  return (
    <div className={styles.chartViewport}>
      <div className={styles.chartReadout}>
        <span>{ticker}</span>
        <strong>{selected ? `$${selected.close.toFixed(2)}` : "—"}</strong>
        <small>{selected?.time || "Time unavailable"}</small>
      </div>
      <svg
        aria-label={`${ticker} price chart`}
        className={styles.chartSvg}
        onPointerLeave={() => setActiveIndex(null)}
        onPointerMove={handlePointerMove}
        preserveAspectRatio="none"
        role="img"
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
      >
        {[0, 1, 2, 3, 4].map((index) => {
          const y = chartTop + ((chartBottom - chartTop) / 4) * index;
          const value = maximum - (span / 4) * index;
          return (
            <g key={index}>
              <line
                className={styles.chartGridLine}
                x1={chartLeft}
                x2={chartRight}
                y1={y}
                y2={y}
              />
              <text className={styles.chartAxisLabel} x={chartRight + 12} y={y + 4}>
                {value.toFixed(2)}
              </text>
            </g>
          );
        })}
        <path className={styles.chartArea} d={areaPath} />
        <path className={styles.chartLine} d={linePath} />
        {axisIndexes.map((index) => (
          <text
            className={styles.chartAxisLabel}
            key={index}
            textAnchor={
              index === 0
                ? "start"
                : index === points.length - 1
                  ? "end"
                  : "middle"
            }
            x={xForIndex(index)}
            y={274}
          >
            {points[index]?.time || ""}
          </text>
        ))}
        {selected ? (
          <g className={styles.chartCrosshair}>
            <line
              x1={xForIndex(selectedIndex)}
              x2={xForIndex(selectedIndex)}
              y1={chartTop}
              y2={chartBottom}
            />
            <circle
              cx={xForIndex(selectedIndex)}
              cy={yForValue(selected.close)}
              r={4}
            />
          </g>
        ) : null}
      </svg>
    </div>
  );
}
