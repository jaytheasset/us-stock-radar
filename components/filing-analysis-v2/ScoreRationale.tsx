import { getDirectionalScoreTone } from "@/lib/directionalScore";
import styles from "./ScoreRationale.module.css";

export type ScoreRationaleDeliveryLevel = "alert" | "archive" | "feed";
export type ScoreRationaleImpact = "high" | "low" | "medium";
export type ScoreRationaleSignal = "bearish" | "bullish" | "neutral" | "volatile";

export type ScoreRationaleProps = {
  deliveryLevel: ScoreRationaleDeliveryLevel;
  impact: ScoreRationaleImpact;
  rationale?: string | null;
  score: number;
  signal: ScoreRationaleSignal;
};

export function isScoreRationaleVisible({
  deliveryLevel,
  rationale,
}: Pick<ScoreRationaleProps, "deliveryLevel" | "rationale">) {
  return (
    deliveryLevel !== "archive" &&
    typeof rationale === "string" &&
    Boolean(rationale.trim())
  );
}

export function ScoreRationale({
  deliveryLevel,
  impact,
  rationale,
  score,
  signal,
}: ScoreRationaleProps) {
  if (!isScoreRationaleVisible({ deliveryLevel, rationale })) {
    return null;
  }

  return (
    <section aria-label="Score Rationale" className={styles.band}>
      <div className={styles.scoreBlock}>
        <span>Score</span>
        <strong data-score-tone={getDirectionalScoreTone(score, signal)}>{score}</strong>
      </div>
      <div className={styles.copy}>
        <div className={styles.headingRow}>
          <h2>Score Rationale</h2>
          <span className={`${styles.signal} ${styles[signal]}`}>{signal}</span>
        </div>
        <p>{rationale}</p>
      </div>
    </section>
  );
}
