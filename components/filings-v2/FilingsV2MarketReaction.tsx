import {
  filingsV2SignalLabels,
  type FilingsV2Signal,
} from "@/lib/mock/filingsV2Data";
import styles from "./StockRadarFilingsV2.module.css";

type FilingsV2MarketReactionProps = {
  recordId: string;
  signal: FilingsV2Signal;
  ticker?: string;
};

const chartWidth = 100;
const chartHeight = 40;
const pointCount = 9;

function createSeed(recordId: string) {
  return [...recordId].reduce((hash, character) => {
    const nextHash = hash ^ character.charCodeAt(0);
    return Math.imul(nextHash, 16777619);
  }, 2166136261) >>> 0;
}

function createMarketSnapshot(seed: number, signal: FilingsV2Signal) {
  const price = 18 + ((seed * 37) % 48000) / 100;
  const magnitude = 0.8 + ((seed * 13) % 720) / 100;
  const change = signal === "bullish"
    ? magnitude
    : signal === "bearish"
      ? -magnitude
      : signal === "volatile"
        ? (seed % 2 === 0 ? magnitude : -magnitude)
        : ((seed % 201) - 100) / 100;

  return { change, price };
}

function createSparklinePoints(seed: number, signal: FilingsV2Signal) {
  const slope = signal === "bullish" ? -2.4 : signal === "bearish" ? 2.4 : signal === "volatile" ? -0.8 : -0.2;
  const values = Array.from({ length: pointCount }, (_, index) => {
    const jitter = ((seed + index * 17) % 9) - 4;
    const swing = signal === "volatile" ? (index % 2 === 0 ? -4 : 4) : jitter * 0.55;
    return chartHeight / 2 + index * slope + swing;
  });
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = Math.max(maximum - minimum, 1);

  return values
    .map((value, index) => {
      const x = (index / (pointCount - 1)) * chartWidth;
      const y = 4 + ((value - minimum) / range) * (chartHeight - 8);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function FilingsV2MarketReaction({ recordId, signal, ticker }: FilingsV2MarketReactionProps) {
  const seed = createSeed(recordId);
  const snapshot = createMarketSnapshot(seed, signal);
  const changeLabel = `${snapshot.change >= 0 ? "+" : ""}${snapshot.change.toFixed(2)}%`;
  const priceLabel = ticker ? `$${snapshot.price.toFixed(2)}` : "—";
  const accessibleTrend = ticker
    ? `${filingsV2SignalLabels[signal]} mock price trend, ${priceLabel}, ${snapshot.change >= 0 ? "up" : "down"} ${Math.abs(snapshot.change).toFixed(2)} percent`
    : "Mock price trend unavailable";

  return (
    <div className={styles.filingMarketReaction}>
      <div className={styles.filingPrice}>
        <strong>{priceLabel}</strong>
        <span className={styles[signal]}>{ticker ? changeLabel : "No quote"}</span>
      </div>
      <svg
        aria-label={accessibleTrend}
        className={`${styles.filingSparkline} ${styles[signal]}`}
        preserveAspectRatio="none"
        role="img"
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
      >
        <polyline points={createSparklinePoints(seed, ticker ? signal : "neutral")} />
      </svg>
    </div>
  );
}
