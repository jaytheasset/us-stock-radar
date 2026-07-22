import styles from "./StockRadarNewsV2.module.css";

export type NewsV2SparklineProps = {
  changePercent?: string;
  values: readonly number[];
};

const sparklineWidth = 112;
const sparklineHeight = 38;
const sparklineInset = 3;

export function NewsV2Sparkline({ changePercent, values }: NewsV2SparklineProps) {
  const closes = values.filter(Number.isFinite);
  if (closes.length < 2) return null;

  const minimum = Math.min(...closes);
  const maximum = Math.max(...closes);
  const spread = maximum - minimum || 1;
  const usableWidth = sparklineWidth - sparklineInset * 2;
  const usableHeight = sparklineHeight - sparklineInset * 2;
  const points = closes.map((close, index) => ({
    x: sparklineInset + (index / (closes.length - 1)) * usableWidth,
    y: sparklineInset + ((maximum - close) / spread) * usableHeight,
  }));
  const lastPoint = points[points.length - 1];
  const path = points
    .map(({ x, y }, index) => `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(" ");
  const parsedChange = Number.parseFloat(changePercent?.replace("%", "") ?? "0");
  const tone = parsedChange > 0 ? "positive" : parsedChange < 0 ? "negative" : "neutral";
  const toneClassName = tone === "positive"
    ? styles.rowSparklinePositive
    : tone === "negative"
      ? styles.rowSparklineNegative
      : styles.rowSparklineNeutral;

  return (
    <span className={styles.rowSparklineCell}>
      <svg
        aria-hidden="true"
        className={`${styles.rowSparkline} ${toneClassName}`}
        focusable="false"
        viewBox={`0 0 ${sparklineWidth} ${sparklineHeight}`}
      >
        <path d={path} />
        <circle cx={lastPoint.x} cy={lastPoint.y} r="2.25" />
      </svg>
      <span className={styles.visuallyHidden}>{tone} one-day price trend</span>
    </span>
  );
}
