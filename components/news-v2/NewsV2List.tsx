import { Fragment } from "react";
import { NewsV2InlineAd } from "@/components/news-v2/NewsV2InlineAd";
import { NewsV2Row } from "@/components/news-v2/NewsV2Row";
import { PremiumUpgradeCard } from "@/components/news-v2/PremiumUpgradeCard";
import type { NewsV2Item } from "@/lib/newsV2";
import styles from "./StockRadarNewsV2.module.css";

export type NewsV2ListProps = {
  error?: string;
  items: readonly NewsV2Item[];
  loadedTotal: number;
  onLoadMore?: () => void;
  remainingCount: number;
  showMarketReaction: boolean;
  totalItems: number;
  totalNews: number;
};

const minimumInlineAdItems = 10;
const inlineAdGroupSize = 25;

function shouldInsertInlineAd(index: number, itemCount: number) {
  const groupStart = Math.floor(index / inlineAdGroupSize) * inlineAdGroupSize;
  const groupLength = Math.min(inlineAdGroupSize, itemCount - groupStart);
  return groupLength >= minimumInlineAdItems && index === groupStart + Math.ceil(groupLength / 2) - 1;
}

export function NewsV2List({
  error,
  items,
  loadedTotal,
  onLoadMore,
  remainingCount,
  showMarketReaction,
  totalItems,
  totalNews,
}: NewsV2ListProps) {
  const premiumInsertIndex = items.length >= 3 ? Math.min(3, items.length - 1) : -1;
  const countLabel = totalNews > loadedTotal
    ? `${items.length} of latest ${loadedTotal} / ${totalNews} stories`
    : `${items.length} of ${totalItems} stories`;

  return (
    <section aria-labelledby="news-v2-list-title" className={styles.listPanel}>
      <header className={styles.listHeader}>
        <div>
          <span className={styles.liveListIndicator}>
            <i aria-hidden="true" />
            Live
          </span>
          <h2 id="news-v2-list-title">Market News</h2>
        </div>
        <span className={styles.resultCount}>{countLabel}</span>
      </header>

      {items.length ? (
        <ol className={styles.newsList}>
          {items.map((item, index) => (
            <Fragment key={item.id}>
              <NewsV2Row item={item} showMarketReaction={showMarketReaction} />
              {index === premiumInsertIndex ? (
                <li className={styles.premiumCtaMobileItem}>
                  <PremiumUpgradeCard className={styles.premiumCtaMobile} />
                </li>
              ) : null}
              {shouldInsertInlineAd(index, items.length) ? (
                <>
                  <NewsV2InlineAd format="desktop" />
                  <NewsV2InlineAd format="mobile" />
                </>
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
            <span>View more events</span>
            <small>{Math.min(25, remainingCount)} more</small>
          </button>
        </div>
      ) : null}
    </section>
  );
}
