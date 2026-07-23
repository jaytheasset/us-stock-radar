import { filingsV2HighImpactMinimum } from "@/lib/filingsV2Model";
import styles from "./StockRadarFilingsV2.module.css";

type FilingsV2ImpactScoreProps = {
  compact?: boolean;
  score: number;
};

export function FilingsV2ImpactScore({
  compact = false,
  score,
}: FilingsV2ImpactScoreProps) {
  const toneClass = score >= filingsV2HighImpactMinimum
    ? styles.impactScoreHigh
    : score >= 40
      ? styles.impactScoreMedium
      : styles.impactScoreLow;

  return (
    <span
      aria-label={`Impact score ${score} out of 99`}
      className={`${styles.impactScore} ${toneClass}${compact ? ` ${styles.impactScoreCompact}` : ""}`}
    >
      {score}
    </span>
  );
}
