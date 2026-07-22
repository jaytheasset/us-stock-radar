import Link from "next/link";
import styles from "./StockRadarNewsV2.module.css";

type PremiumUpgradeCardProps = {
  className?: string;
};

export function PremiumUpgradeCard({ className }: PremiumUpgradeCardProps) {
  return (
    <aside
      aria-label="Premium membership"
      className={`${styles.premiumCta}${className ? ` ${className}` : ""}`}
    >
      <div className={styles.premiumCtaCopy}>
        <span>Premium</span>
        <strong>Unlock the full news intelligence</strong>
        <p>Real-time market news, advanced filters, and watchlist signals.</p>
      </div>

      <div className={styles.premiumCtaAction}>
        <span aria-hidden="true" className={styles.premiumCtaProBadge}>
          PRO
        </span>
        <Link className={styles.premiumCtaLink} href="/premium">
          Upgrade
        </Link>
      </div>
    </aside>
  );
}
