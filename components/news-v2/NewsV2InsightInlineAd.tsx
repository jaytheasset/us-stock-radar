import styles from "./StockRadarNewsV2.module.css";

export function NewsV2InsightInlineAd() {
  return (
    <div className={styles.mobileInsightAdItem}>
      <section
        aria-label="Advertisement"
        className={`${styles.inlineAdSlot} ${styles.mobileInlineAdSlot}`}
      >
        <span className={styles.inlineAdLabel}>Advertisement</span>
        <span className={styles.inlineAdSize}>320 x 100</span>
      </section>
    </div>
  );
}
