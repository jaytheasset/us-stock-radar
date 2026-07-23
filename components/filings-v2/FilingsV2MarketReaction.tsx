import type { FilingsV2Record } from "@/lib/filingsV2Model";
import styles from "./StockRadarFilingsV2.module.css";

type FilingsV2MarketReactionProps = {
  record: FilingsV2Record;
};

const chartWidth = 100;
const chartHeight = 40;

function createSparklinePoints(values: readonly number[]) {
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = Math.max(maximum - minimum, 1);

  return values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * chartWidth;
      const y = chartHeight - 4 - ((value - minimum) / range) * (chartHeight - 8);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function FilingsV2MarketReaction({ record }: FilingsV2MarketReactionProps) {
  const hasPrice = Number.isFinite(record.price);
  const hasChange = Number.isFinite(record.changePercent);
  const chartPoints = record.chartPoints?.filter(Number.isFinite) ?? [];
  const hasChart = chartPoints.length >= 2;
  const change = record.changePercent ?? 0;
  const marketToneClass = hasChange
    ? change >= 0
      ? styles.bullish
      : styles.bearish
    : styles.neutral;
  const priceLabel = hasPrice ? `$${record.price!.toFixed(2)}` : "—";
  const changeLabel = hasChange ? `${change >= 0 ? "+" : ""}${change.toFixed(2)}%` : "—";

  return (
    <span className={styles.filingMarketReaction}>
      <span className={styles.filingPrice}>
        <strong>{priceLabel}</strong>
        <span className={marketToneClass}>{changeLabel}</span>
      </span>
      {hasChart ? (
        <svg
          aria-label={`${record.ticker ?? record.company} stored market trend`}
          className={`${styles.filingSparkline} ${marketToneClass}`}
          preserveAspectRatio="none"
          role="img"
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        >
          <polyline points={createSparklinePoints(chartPoints)} />
        </svg>
      ) : (
        <span aria-hidden="true" className={styles.filingSparkline} />
      )}
    </span>
  );
}
