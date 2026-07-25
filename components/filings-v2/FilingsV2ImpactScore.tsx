import { getDirectionalScoreTone } from "@/lib/directionalScore";
import type { FilingsV2Signal } from "@/lib/filingsV2Model";
import styles from "./StockRadarFilingsV2.module.css";

type FilingsV2ImpactScoreProps = {
  compact?: boolean;
  score: number;
  signal: FilingsV2Signal;
};

export function FilingsV2ImpactScore({
  compact = false,
  score,
  signal,
}: FilingsV2ImpactScoreProps) {
  return (
    <span
      aria-label={`Impact score ${score} out of 99`}
      className={`${styles.impactScore}${compact ? ` ${styles.impactScoreCompact}` : ""}`}
      data-score-tone={getDirectionalScoreTone(score, signal)}
    >
      {score}
    </span>
  );
}
