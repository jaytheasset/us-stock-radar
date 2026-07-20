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

export function ScoreRationale({
  deliveryLevel,
  impact,
  rationale,
  score,
  signal,
}: ScoreRationaleProps) {
  const hasStoredRationale = typeof rationale === "string" && Boolean(rationale.trim());

  if (deliveryLevel === "archive" || !hasStoredRationale) {
    return null;
  }

  return (
    <section aria-label="Score Rationale" className={styles.band}>
      <div className={styles.scoreBlock}>
        <span>Score</span>
        <strong className={styles[impact]}>{score}</strong>
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
