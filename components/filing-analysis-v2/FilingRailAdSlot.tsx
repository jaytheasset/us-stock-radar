import styles from "./FilingRailAdSlot.module.css";

type FilingRailAdSlotProps = {
  format?: "rectangle" | "skyscraper";
};

export function FilingRailAdSlot({
  format = "skyscraper",
}: FilingRailAdSlotProps) {
  return (
    <section
      aria-label="Advertisement"
      className={`${styles.slot} ${styles[format]}`}
    >
      <span className={styles.label}>Advertisement</span>
      <span className={styles.size}>
        {format === "rectangle" ? "300 x 250" : "300 x 600"}
      </span>
    </section>
  );
}
