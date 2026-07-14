import styles from "./MarketResultRows.module.css";

export type MarketImpact = "high" | "low" | "major" | "medium";

export type MarketImpactLabelProps = {
  impact: MarketImpact;
  size?: "compact" | "default";
};

const impactClasses: Record<MarketImpact, string> = {
  high: styles["impact-high"],
  low: styles["impact-low"],
  major: styles["impact-major"],
  medium: styles["impact-medium"],
};

export function MarketImpactLabel({
  impact,
  size = "default",
}: MarketImpactLabelProps) {
  const label =
    size === "compact"
      ? `${impact.charAt(0).toUpperCase()}${impact.slice(1)}`
      : impact.toUpperCase();

  return (
    <span
      className={`${styles.impact} ${impactClasses[impact]}${
        size === "compact" ? ` ${styles.impactCompact}` : ""
      }`}
    >
      {label}
    </span>
  );
}
