import styles from "./DesktopRailAdSlot.module.css";

export function DesktopRailAdSlot({ note }: { note?: string }) {
  return (
    <section aria-label="Advertisement" className={styles.slot}>
      <span className={styles.label}>Advertisement</span>
      <span className={styles.size}>300 x 250</span>
      {note ? <span className={styles.note}>{note}</span> : null}
    </section>
  );
}
