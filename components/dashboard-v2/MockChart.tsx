import { useId } from "react";
import type { DashboardV2Candle, DashboardV2TickerDetail } from "@/lib/mock/dashboardV2Data";

type MockChartProps = {
  candles: DashboardV2Candle[];
  ohlc: DashboardV2TickerDetail["ohlc"];
  changeAmount: string;
  changePercent: string;
};

export function MockChart({ candles, changeAmount, changePercent, ohlc }: MockChartProps) {
  const volumeFadeId = useId();
  const width = 620;
  const height = 282;
  const chartLeft = 12;
  const chartRight = 562;
  const priceTop = 36;
  const priceBottom = 228;
  const volumeTop = 210;
  const volumeBottom = 264;
  const highs = candles.map((candle) => candle.high);
  const lows = candles.map((candle) => candle.low);
  const volumes = candles.map((candle) => candle.volume);
  const maxPrice = Math.max(...highs);
  const minPrice = Math.min(...lows);
  const maxVolume = Math.max(...volumes);
  const priceRange = Math.max(maxPrice - minPrice, 0.01);
  const candleGap = (chartRight - chartLeft) / candles.length;
  const candleWidth = Math.max(5, Math.min(9, candleGap * 0.46));
  const latest = candles[candles.length - 1];
  const latestY = yPrice(latest.close);
  const gridPrices = [346, 344, 342, 340, 338, 336, 334, 332];
  const timeMarkers = ["09:30", "11:00", "12:30", "14:00", "15:30", "16:00"];

  function yPrice(value: number) {
    return priceTop + ((maxPrice - value) / priceRange) * (priceBottom - priceTop);
  }

  function xFor(index: number) {
    return chartLeft + candleGap * index + candleGap / 2;
  }

  return (
    <svg
      aria-hidden="true"
      className="dashboard-v2-mock-chart"
      focusable="false"
      viewBox={`0 0 ${width} ${height}`}
    >
        <title>Mock intraday candlestick chart for CRWD</title>
        <defs>
          <linearGradient id={volumeFadeId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--sr-color-chart-volume-bullish)" stopOpacity="0.42" />
            <stop offset="1" stopColor="var(--sr-color-chart-volume-bullish)" stopOpacity="0.12" />
          </linearGradient>
        </defs>

        {gridPrices.map((price) => {
          const y = yPrice(price);
          return (
            <g key={price}>
              <line className="dashboard-v2-chart-grid" x1={chartLeft} x2={chartRight} y1={y} y2={y} />
              <text className="dashboard-v2-price-axis" x={chartRight + 9} y={y + 4}>
                {price.toFixed(2)}
              </text>
            </g>
          );
        })}

        {timeMarkers.map((label, index) => {
          const x = chartLeft + (index / (timeMarkers.length - 1)) * (chartRight - chartLeft);
          return (
            <g key={label}>
              <line className="dashboard-v2-chart-grid vertical" x1={x} x2={x} y1={priceTop} y2={volumeBottom} />
              <text className="dashboard-v2-time-axis" x={x} y={height - 8}>
                {label}
              </text>
            </g>
          );
        })}

        <text className="dashboard-v2-ohlc" x={chartLeft} y={22}>
          O {ohlc.open}  H {ohlc.high}  L {ohlc.low}  C {ohlc.close}  {changeAmount} ({changePercent})
        </text>

        {candles.map((candle, index) => {
          const x = xFor(index);
          const openY = yPrice(candle.open);
          const closeY = yPrice(candle.close);
          const highY = yPrice(candle.high);
          const lowY = yPrice(candle.low);
          const bullish = candle.close >= candle.open;
          const bodyY = Math.min(openY, closeY);
          const bodyHeight = Math.max(3, Math.abs(closeY - openY));
          const volumeHeight = Math.max(
            4,
            (candle.volume / maxVolume) * (volumeBottom - volumeTop),
          );

          return (
            <g className={bullish ? "bullish" : "bearish"} key={`${candle.time}-${index}`}>
              <rect
                className="dashboard-v2-chart-volume"
                x={x - candleWidth / 2}
                y={volumeBottom - volumeHeight}
                width={candleWidth}
                height={volumeHeight}
              />
              <line className="dashboard-v2-candle-wick" x1={x} x2={x} y1={highY} y2={lowY} />
              <rect
                className="dashboard-v2-candle-body"
                x={x - candleWidth / 2}
                y={bodyY}
                width={candleWidth}
                height={bodyHeight}
                rx="1"
              />
            </g>
          );
        })}

        <line className="dashboard-v2-last-price-line" x1={chartLeft} x2={chartRight} y1={latestY} y2={latestY} />
        <rect className="dashboard-v2-last-price-pill" x={chartRight + 2} y={latestY - 11} width="50" height="21" rx="2" />
        <text className="dashboard-v2-last-price-text" x={chartRight + 27} y={latestY + 4}>
          {latest.close.toFixed(2)}
        </text>
    </svg>
  );
}
