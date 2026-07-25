import styles from "./StockRadarFeedV2.module.css";

type FeedSparklineProps = {
  closes: readonly number[];
};

const width = 112;
const height = 38;
const inset = 3;

export function FeedSparkline({ closes }: FeedSparklineProps) {
  if (closes.length < 2) {
    return <span className={styles.sparklineUnavailable}>No chart</span>;
  }

  const minimum = Math.min(...closes);
  const maximum = Math.max(...closes);
  const spread = maximum - minimum || 1;
  const usableWidth = width - inset * 2;
  const usableHeight = height - inset * 2;
  const divisor = closes.length - 1;
  const points = closes.map((close, index) => ({
    x: inset + (index / divisor) * usableWidth,
    y: inset + ((maximum - close) / spread) * usableHeight,
  }));
  const lastPoint = points[points.length - 1];
  const rising = closes[closes.length - 1] >= closes[0];
  const path = points
    .map(
      ({ x, y }, index) =>
        `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`,
    )
    .join(" ");

  return (
    <svg
      aria-label={`Price trend ${rising ? "higher" : "lower"}`}
      className={`${styles.sparkline} ${
        rising ? styles.sparklinePositive : styles.sparklineNegative
      }`}
      role="img"
      viewBox={`0 0 ${width} ${height}`}
    >
      <path d={path} />
      <circle cx={lastPoint.x} cy={lastPoint.y} r="2.25" />
    </svg>
  );
}
