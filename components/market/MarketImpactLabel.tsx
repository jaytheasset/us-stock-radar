import styles from "./MarketResultRows.module.css";

export type MarketImpact = "high" | "low" | "major" | "medium";

export type MarketImpactLabelProps = {
  impact: MarketImpact;
};

const impactClasses: Record<MarketImpact, string> = {
  high: styles["impact-high"],
  low: styles["impact-low"],
  major: styles["impact-major"],
  medium: styles["impact-medium"],
};

export function MarketImpactLabel({ impact }: MarketImpactLabelProps) {
  return (
    <span className={`${styles.impact} ${impactClasses[impact]}`}>
      {impact.toUpperCase()}
    </span>
  );
}
