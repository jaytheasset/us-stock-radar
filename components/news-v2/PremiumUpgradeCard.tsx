import Link from "next/link";
import { BellRing } from "lucide-react";
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

  const isAdvanced = viewerPlan === "advanced";
  const copy = isAdvanced
    ? {
        eyebrow: "Ultimate",
        title: "Tailor Stock Radar to your workflow",
        description:
          "Create precisely filtered news alert streams and connect real-time news through our API.",
        action: "Unlock Ultimate",
      }
    : {
        eyebrow: "Real-time alerts",
        title: "Never miss market-moving news",
        description:
          "Unlock real-time alerts for Earnings, FDA decisions and other major company news.",
        action: "Upgrade your plan",
      };

  return (
    <aside
      aria-label="News alerts upgrade"
      className={`${styles.premiumCta}${className ? ` ${className}` : ""}`}
    >
      <div className={styles.premiumCtaCopy}>
        <span>{copy.eyebrow}</span>
        <strong>{copy.title}</strong>
        <p>{copy.description}</p>
        <Link className={styles.premiumCtaLink} href="/premium">
          <BellRing
            aria-hidden="true"
            className={styles.premiumCtaLinkIcon}
            size={16}
            strokeWidth={2}
          />
          <span className={styles.premiumCtaLinkDesktopLabel}>{copy.action}</span>
          <span className={styles.premiumCtaLinkMobileLabel}>Upgrade</span>
        </Link>
      </div>
    </aside>
  );
}
