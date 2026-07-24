import { Fragment } from "react";
import { NewsV2InlineAd } from "@/components/news-v2/NewsV2InlineAd";
import { NewsV2Row } from "@/components/news-v2/NewsV2Row";
import { PremiumUpgradeCard } from "@/components/news-v2/PremiumUpgradeCard";
import { GooglePreferredSourceLink } from "@/components/ui/GooglePreferredSourceLink";
import type { NewsV2Item } from "@/lib/newsV2";
import type { Plan } from "@/lib/subscriptionPolicy";
import styles from "./StockRadarNewsV2.module.css";

export type NewsV2ListProps = {
  error?: string;
  items: readonly NewsV2Item[];
  onLoadMore?: () => void;
  preferredSourceUrl?: string | null;
  referenceDate: string;
  remainingCount: number;
  showMarketReaction: boolean;
  totalItems: number;
  viewerPlan: Plan;
};

const minimumDesktopInlineAdItems = 10;
const desktopInlineAdGroupSize = 25;
const mobileInlineAdInterval = 11;

function shouldInsertDesktopInlineAd(index: number, itemCount: number) {
  const groupStart =
    Math.floor(index / desktopInlineAdGroupSize) * desktopInlineAdGroupSize;
  const groupLength = Math.min(desktopInlineAdGroupSize, itemCount - groupStart);
  return (
    groupLength >= minimumDesktopInlineAdItems &&
    index === groupStart + Math.ceil(groupLength / 2) - 1
  );
}

function shouldInsertMobileInlineAd(index: number) {
  return (index + 1) % mobileInlineAdInterval === 0;
}

export function NewsV2List({
  error,
  items,
  onLoadMore,
  preferredSourceUrl,
  referenceDate,
  remainingCount,
  showMarketReaction,
  totalItems,
  viewerPlan,
}: NewsV2ListProps) {
  const premiumInsertIndex = items.length >= 3 ? Math.min(3, items.length - 1) : -1;
  const countLabel = `${items.length} of ${totalItems} stories`;

  return (
    <section aria-labelledby="news-v2-list-title" className={styles.listPanel}>
      <header className={styles.listHeader}>
        <div className={styles.listHeaderTitle}>
          <span className={styles.liveListIndicator}>
            <i aria-hidden="true" />
            Live
          </span>
          <h2 id="news-v2-list-title">Market News</h2>
          {preferredSourceUrl ? (
            <GooglePreferredSourceLink header href={preferredSourceUrl} />
          ) : null}
        </div>
        <span className={styles.resultCount}>{countLabel}</span>
      </header>

      {items.length ? (
        <ol className={styles.newsList}>
          {items.map((item, index) => (
            <Fragment key={item.id}>
              <NewsV2Row
                item={item}
                referenceDate={referenceDate}
                showMarketReaction={showMarketReaction}
              />
              {viewerPlan !== "ultimate" && index === premiumInsertIndex ? (
                <li className={styles.premiumCtaMobileItem}>
                  <PremiumUpgradeCard
                    className={styles.premiumCtaMobile}
                    viewerPlan={viewerPlan}
                  />
                </li>
              ) : null}
              {shouldInsertDesktopInlineAd(index, items.length) ? (
                <NewsV2InlineAd format="desktop" />
              ) : null}
              {shouldInsertMobileInlineAd(index) ? (
                <NewsV2InlineAd format="mobile" />
              ) : null}
            </Fragment>
          ))}
        </ol>
      ) : (
        <div className={styles.emptyState}>
          <strong>{error ? "News unavailable" : "No matching news"}</strong>
          <span>{error || "Try another search or remove one of the active filters."}</span>
        </div>
      )}

      {onLoadMore ? (
        <div className={styles.loadMoreRow}>
          <button className={styles.loadMoreButton} onClick={onLoadMore} type="button">
            <span>View more news</span>
            <small>{Math.min(25, remainingCount)} more</small>
          </button>
        </div>
      ) : null}
    </section>
  );
}
