import styles from "./DesktopInlineAdSlot.module.css";

export function DesktopInlineAdSlot() {
  return (
    <tr className={styles.row}>
      <td colSpan={9}>
        <section aria-label="Advertisement" className={styles.slot}>
          <span className={styles.label}>Advertisement</span>
          <span className={styles.size}>728 x 90</span>
        </section>
      </td>
    </tr>
  );
}
