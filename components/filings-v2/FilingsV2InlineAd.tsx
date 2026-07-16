import styles from "./StockRadarFilingsV2.module.css";

type FilingsV2InlineAdProps = {
  format: "desktop" | "mobile";
};

export function FilingsV2InlineAd({ format }: FilingsV2InlineAdProps) {
  const slot = (
    <section
      aria-label="Advertisement"
      className={`${styles.inlineAdSlot} ${
        format === "desktop" ? styles.desktopInlineAdSlot : styles.mobileInlineAdSlot
      }`}
    >
      <span className={styles.inlineAdLabel}>Advertisement</span>
      <span className={styles.inlineAdSize}>{format === "desktop" ? "728 x 90" : "320 x 100"}</span>
    </section>
  );

  if (format === "desktop") {
    return (
      <tr className={styles.inlineAdTableRow}>
        <td colSpan={9}>{slot}</td>
      </tr>
    );
  }

  return <li className={styles.mobileInlineAdItem}>{slot}</li>;
}
