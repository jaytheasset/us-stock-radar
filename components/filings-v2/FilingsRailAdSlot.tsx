import styles from "./FilingsRailAdSlot.module.css";

export function FilingsRailAdSlot() {
  return (
    <section aria-label="Advertisement" className={styles.slot}>
      <span>Advertisement</span>
      <small>300 × 600</small>
    </section>
  );
}
