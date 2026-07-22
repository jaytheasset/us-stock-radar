import styles from "./MobileInlineAdSlot.module.css";

export function MobileInlineAdSlot() {
  return (
    <tr className={styles.row}>
      <td colSpan={6}>
        <section aria-label="Advertisement" className={styles.slot}>
          <span className={styles.label}>Advertisement</span>
          <span className={styles.size}>320 x 100</span>
        </section>
      </td>
    </tr>
  );
}
