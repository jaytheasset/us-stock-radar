import styles from "./StockRadarNewsV2.module.css";

type NewsV2InlineAdProps = {
  format: "desktop" | "mobile";
};

export function NewsV2InlineAd({ format }: NewsV2InlineAdProps) {
  const isDesktop = format === "desktop";

  return (
    <li className={isDesktop ? styles.desktopInlineAdItem : styles.mobileInlineAdItem}>
      <section
        aria-label="Advertisement"
        className={`${styles.inlineAdSlot} ${
          isDesktop ? styles.desktopInlineAdSlot : styles.mobileInlineAdSlot
        }`}
      >
        <span className={styles.inlineAdLabel}>Advertisement</span>
        <span className={styles.inlineAdSize}>{isDesktop ? "728 x 90" : "320 x 100"}</span>
      </section>
    </li>
  );
}
