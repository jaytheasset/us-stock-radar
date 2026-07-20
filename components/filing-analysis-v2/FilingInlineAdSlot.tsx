import styles from "./FilingInlineAdSlot.module.css";

export function FilingInlineAdSlot() {
  return (
    <section aria-label="Advertisement" className={styles.slot}>
      <span className={styles.label}>Advertisement</span>
      <span className={styles.desktopSize}>728 x 90</span>
      <span className={styles.mobileSize}>320 x 100</span>
    </section>
  );
}
