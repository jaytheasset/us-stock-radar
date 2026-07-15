"use client";

import { useId, useState, type ReactNode } from "react";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import styles from "./FeedChartLab.module.css";

type ScenarioKey = "liquid" | "reaction" | "sparse";

type PriceBar = {
  close: number;
  high: number;
  low: number;
  open: number;
  volume: number;
};

type ChartGeometry = {
  baselineY: number;
  bars: Array<PriceBar & { x: number; closeY: number; highY: number; lowY: number; openY: number }>;
  closePoints: string;
  firstClose: number;
  lastClose: number;
  maxVolume: number;
};

const scenarioItems = [
  { label: "Liquid trend", value: "liquid" },
  { label: "Event reaction", value: "reaction" },
  { label: "Sparse trade", value: "sparse" },
] as const;

const scenarioCloses: Record<ScenarioKey, readonly number[]> = {
  liquid: [
    12.18, 12.22, 12.2, 12.27, 12.31, 12.3, 12.36, 12.42, 12.4, 12.47, 12.5, 12.48,
    12.54, 12.51, 12.57, 12.55, 12.62, 12.6, 12.66, 12.64, 12.7, 12.68, 12.74, 12.79,
  ],
  reaction: [
    8.42, 8.4, 8.43, 8.41, 8.46, 8.48, 8.44, 8.47, 8.5, 8.49, 8.52, 8.51, 8.74,
    8.88, 8.79, 8.95, 8.9, 9.04, 8.98, 9.08, 9.02, 9.12, 9.18, 9.15,
  ],
  sparse: [
    3.82, 3.82, 3.84, 3.84, 3.84, 3.81, 3.81, 3.81, 3.86, 3.86, 3.86, 3.85,
    3.85, 3.85, 3.89, 3.89, 3.87, 3.87, 3.87, 3.91, 3.91, 3.91, 3.9, 3.94,
  ],
};

const chartOptions = [
  {
    description: "Close-only line with one quiet reference baseline.",
    id: "A",
    recommendation: "Recommended",
    title: "Clean line",
  },
  {
    description: "Close line with a restrained directional area fill.",
    id: "B",
    recommendation: "Soft emphasis",
    title: "Area line",
  },
  {
    description: "High-low range and close marks without candle bodies.",
    id: "C",
    recommendation: "More price detail",
    title: "Range ticks",
  },
  {
    description: "Minimal OHLC candles with axes, grid, and volume removed.",
    id: "D",
    recommendation: "Familiar",
    title: "Micro candles",
  },
  {
    description: "Each interval is colored by its own direction of travel.",
    id: "E",
    recommendation: "Momentum focus",
    title: "Direction line",
  },
] as const;

function makeBars(closes: readonly number[]): PriceBar[] {
  return closes.map((close, index) => {
    const previous = index === 0 ? close * 0.996 : closes[index - 1];
    const spread = Math.max(close * (0.0025 + (index % 4) * 0.00055), 0.012);

    return {
      close,
      high: Math.max(previous, close) + spread,
      low: Math.min(previous, close) - spread * 0.82,
      open: previous,
      volume: 28 + ((index * 19) % 72) + (index === 12 ? 86 : 0),
    };
  });
}

function getGeometry(data: PriceBar[]): ChartGeometry {
  const width = 184;
  const horizontalInset = 4;
  const top = 7;
  const bottom = 61;
  const values = data.flatMap((bar) => [bar.high, bar.low]);
  const high = Math.max(...values);
  const low = Math.min(...values);
  const range = Math.max(high - low, 0.01);
  const xStep = (width - horizontalInset * 2) / Math.max(data.length - 1, 1);
  const y = (value: number) => top + ((high - value) / range) * (bottom - top);
  const bars = data.map((bar, index) => ({
    ...bar,
    closeY: y(bar.close),
    highY: y(bar.high),
    lowY: y(bar.low),
    openY: y(bar.open),
    x: horizontalInset + xStep * index,
  }));

  return {
    baselineY: y(data[0].close),
    bars,
    closePoints: bars.map((bar) => `${bar.x},${bar.closeY}`).join(" "),
    firstClose: data[0].close,
    lastClose: data[data.length - 1].close,
    maxVolume: Math.max(...data.map((bar) => bar.volume)),
  };
}

function ChartFrame({ children, label }: { children: ReactNode; label: string }) {
  return (
    <svg aria-label={label} className={styles.chart} role="img" viewBox="0 0 184 68">
      {children}
    </svg>
  );
}

function CleanLineChart({ geometry }: { geometry: ChartGeometry }) {
  const positive = geometry.lastClose >= geometry.firstClose;

  return (
    <ChartFrame label="Close price line chart">
      <line className={styles.baseline} x1="4" x2="180" y1={geometry.baselineY} y2={geometry.baselineY} />
      <polyline
        className={positive ? styles.positiveLine : styles.negativeLine}
        points={geometry.closePoints}
      />
      <circle
        className={positive ? styles.positiveMarker : styles.negativeMarker}
        cx={geometry.bars.at(-1)?.x}
        cy={geometry.bars.at(-1)?.closeY}
        r="2.5"
      />
    </ChartFrame>
  );
}

function AreaLineChart({ geometry }: { geometry: ChartGeometry }) {
  const gradientId = useId();
  const positive = geometry.lastClose >= geometry.firstClose;
  const areaPoints = `4,64 ${geometry.closePoints} 180,64`;

  return (
    <ChartFrame label="Close price area chart">
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop
            offset="0"
            stopColor={positive ? "var(--sr-color-chart-bullish)" : "var(--sr-color-chart-bearish)"}
            stopOpacity="0.24"
          />
          <stop
            offset="1"
            stopColor={positive ? "var(--sr-color-chart-bullish)" : "var(--sr-color-chart-bearish)"}
            stopOpacity="0"
          />
        </linearGradient>
      </defs>
      <polygon fill={`url(#${gradientId})`} points={areaPoints} />
      <polyline
        className={positive ? styles.positiveLine : styles.negativeLine}
        points={geometry.closePoints}
      />
    </ChartFrame>
  );
}

function RangeTicksChart({ geometry }: { geometry: ChartGeometry }) {
  return (
    <ChartFrame label="High low range chart with close ticks">
      {geometry.bars.map((bar, index) => {
        const bullish = bar.close >= bar.open;
        return (
          <g className={bullish ? styles.positiveRange : styles.negativeRange} key={index}>
            <line x1={bar.x} x2={bar.x} y1={bar.highY} y2={bar.lowY} />
            <line x1={bar.x} x2={bar.x + 2.8} y1={bar.closeY} y2={bar.closeY} />
          </g>
        );
      })}
    </ChartFrame>
  );
}

function MicroCandlesChart({ geometry }: { geometry: ChartGeometry }) {
  return (
    <ChartFrame label="Minimal candlestick chart">
      {geometry.bars.map((bar, index) => {
        const bullish = bar.close >= bar.open;
        const bodyY = Math.min(bar.openY, bar.closeY);
        const bodyHeight = Math.max(1.6, Math.abs(bar.openY - bar.closeY));
        return (
          <g className={bullish ? styles.positiveCandle : styles.negativeCandle} key={index}>
            <line x1={bar.x} x2={bar.x} y1={bar.highY} y2={bar.lowY} />
            <rect height={bodyHeight} rx="0.8" width="4.2" x={bar.x - 2.1} y={bodyY} />
          </g>
        );
      })}
    </ChartFrame>
  );
}

function DirectionLineChart({ geometry }: { geometry: ChartGeometry }) {
  return (
    <ChartFrame label="Interval direction line chart">
      <line className={styles.baseline} x1="4" x2="180" y1={geometry.baselineY} y2={geometry.baselineY} />
      {geometry.bars.slice(1).map((bar, index) => {
        const previous = geometry.bars[index];
        const positive = bar.close >= previous.close;
        return (
          <line
            className={positive ? styles.positiveSegment : styles.negativeSegment}
            key={index}
            x1={previous.x}
            x2={bar.x}
            y1={previous.closeY}
            y2={bar.closeY}
          />
        );
      })}
    </ChartFrame>
  );
}

function renderChart(optionId: (typeof chartOptions)[number]["id"], geometry: ChartGeometry) {
  if (optionId === "A") return <CleanLineChart geometry={geometry} />;
  if (optionId === "B") return <AreaLineChart geometry={geometry} />;
  if (optionId === "C") return <RangeTicksChart geometry={geometry} />;
  if (optionId === "D") return <MicroCandlesChart geometry={geometry} />;
  return <DirectionLineChart geometry={geometry} />;
}

export function FeedChartLab() {
  const [scenario, setScenario] = useState<ScenarioKey>("liquid");
  const bars = makeBars(scenarioCloses[scenario]);
  const geometry = getGeometry(bars);
  const change = ((geometry.lastClose / geometry.firstClose - 1) * 100).toFixed(2);
  const isPositive = Number(change) >= 0;

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>LIVE FEED / MICRO CHART LAB</p>
          <h1>Feed chart comparison</h1>
          <p className={styles.intro}>
            One provider-neutral 5-minute series rendered at the actual feed-row chart size.
          </p>
        </div>
        <SegmentedControl
          ariaLabel="Choose price series scenario"
          className={styles.scenarioControl}
          items={scenarioItems}
          onValueChange={setScenario}
          value={scenario}
          variant="compact"
        />
      </header>

      <section aria-label="Micro chart options" className={styles.optionGrid}>
        {chartOptions.map((option) => (
          <article className={styles.optionCard} key={option.id}>
            <div className={styles.optionHeading}>
              <span className={styles.optionId}>{option.id}</span>
              <div>
                <h2>{option.title}</h2>
                <p>{option.description}</p>
              </div>
              <span className={styles.recommendation}>{option.recommendation}</span>
            </div>

            <div className={styles.feedRowPreview}>
              <time className={styles.time}>3:32 AM</time>
              <div className={styles.chartCell}>{renderChart(option.id, geometry)}</div>
              <div className={styles.identity}>
                <div className={styles.tickerLine}>
                  <strong>USAR</strong>
                  <span className={styles.price}>${geometry.lastClose.toFixed(2)}</span>
                  <span className={isPositive ? styles.positiveText : styles.negativeText}>
                    {isPositive ? "+" : ""}{change}%
                  </span>
                </div>
                <p>USA Rare Earth, Inc.</p>
                <h3>Independent registered public accountant changed</h3>
                <span className={styles.eventLabel}>Leadership / Governance</span>
              </div>
              <div className={styles.signal}>
                <span>Neutral</span>
                <strong>Impact 55</strong>
              </div>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
