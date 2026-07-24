import { BellRing } from "lucide-react";
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
        <span>Advanced alerts</span>
        <strong>Never miss a market-moving update</strong>
        <p>
          Get instant alerts for earnings, FDA decisions, strategic events,
          and major company news.
        </p>
      </div>

      <Link
        className={styles.premiumCtaLink}
        href={managesAlerts ? "/alerts" : "/premium"}
      >
        <BellRing aria-hidden="true" size={16} strokeWidth={1.8} />
        <span>{managesAlerts ? "Manage Alerts" : "Upgrade to Advanced"}</span>
      </Link>
    </aside>
  );
}
