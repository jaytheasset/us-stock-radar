import Link from "next/link";
import { BellRing } from "lucide-react";
import {
  getPlanDisplayName,
  getPlanUpgradeTarget,
  type Plan,
} from "@/lib/subscriptionPolicy";
import styles from "./StockRadarFeedV2.module.css";

type FeedPremiumCardProps = {
  className?: string;
  viewerPlan: Plan;
};

export function FeedPremiumCard({
  className,
  viewerPlan,
}: FeedPremiumCardProps) {
  const upgradeTarget = getPlanUpgradeTarget(viewerPlan);
  if (!upgradeTarget) return null;

  const targetName = getPlanDisplayName(upgradeTarget);
  const copy =
    viewerPlan === "advanced"
      ? "Build custom alert streams and connect your workflow through API access."
      : "Unlock real-time alerts and broader ticker monitoring for market-moving events.";

  return (
    <aside
      aria-label="Live Feed plan upgrade"
      className={[styles.premiumCard, className].filter(Boolean).join(" ")}
    >
      <span>{targetName}</span>
      <strong>Move faster on the signals that matter</strong>
      <p>{copy}</p>
      <Link href="/premium">
        <BellRing aria-hidden="true" size={16} />
        Explore {targetName}
      </Link>
    </aside>
  );
}
