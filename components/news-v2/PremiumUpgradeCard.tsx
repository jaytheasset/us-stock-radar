import Link from "next/link";
import type { Plan } from "@/lib/subscriptionPolicy";
import styles from "./StockRadarNewsV2.module.css";

type PremiumUpgradeCardProps = {
  className?: string;
  viewerPlan: Plan;
};

export function PremiumUpgradeCard({
  className,
  viewerPlan,
}: PremiumUpgradeCardProps) {
  if (viewerPlan === "ultimate") {
    return null;
  }

  const managesAlerts = viewerPlan === "advanced";

  return (
    <aside
      aria-label="Advanced news alerts"
      className={`${styles.premiumCta}${className ? ` ${className}` : ""}`}
    >
      <div className={styles.premiumCtaCopy}>
        <span>Premium</span>
        <strong>Unlock the full news intelligence</strong>
        <p>Real-time market news, advanced filters, and watchlist signals.</p>
      </div>
      <div className={styles.premiumCtaAction}>
        <span aria-hidden="true" className={styles.premiumCtaProBadge}>
          ADV
        </span>
        <Link
          className={styles.premiumCtaLink}
          href={managesAlerts ? "/alerts" : "/premium"}
        >
          {managesAlerts ? "Manage Alerts" : "Upgrade"}
        </Link>
      </div>
    </aside>
  );
}
