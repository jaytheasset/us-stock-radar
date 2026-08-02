import { Fragment } from "react";
import { FeedInlineAdSlots } from "@/components/feed-v2/FeedInlineAdSlots";
import { FeedPremiumCard } from "@/components/feed-v2/FeedPremiumCard";
import { FeedSparkline } from "@/components/feed-v2/FeedSparkline";
import type {
  LiveFeedV2Item,
  LiveFeedV2Sentiment,
} from "@/lib/liveFeedV2Contract";
import { getLiveFeedV2EventPresentation } from "@/lib/liveFeedV2EventType";
import { getDirectionalScoreTone } from "@/lib/directionalScore";
import type { Plan } from "@/lib/subscriptionPolicy";
import styles from "./StockRadarFeedV2.module.css";

const sentimentClassNames: Record<LiveFeedV2Sentiment, string> = {
  Bearish: styles.sentimentNegative,
  Bullish: styles.sentimentPositive,
  Neutral: styles.sentimentNeutral,
  Volatile: styles.sentimentWarning,
};

type FeedEventListProps = {
  emptyMessage?: string;
  hasError: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  items: readonly LiveFeedV2Item[];
  onLoadMore?: () => void;
  onPreviewSelect: (item: LiveFeedV2Item, opener: HTMLButtonElement) => void;
  onRetry: () => void;
  remainingCount: number | null;
  selectedEventId: string | null;
  viewerPlan: Plan;
};

export function FeedEventList({
  emptyMessage,
  hasError,
  isLoading,
  isLoadingMore,
  items,
  onLoadMore,
  onPreviewSelect,
  onRetry,
  remainingCount,
  selectedEventId,
  viewerPlan,
}: FeedEventListProps) {
  if (isLoading && items.length === 0) {
    return (
      <div aria-live="polite" className={styles.emptyState} role="status">
        <strong>Updating events</strong>
        <span>Retrieving the latest events for this feed.</span>
      </div>
    );
  }

  if (hasError && items.length === 0) {
    return (
      <div className={styles.emptyState} role="alert">
        <strong>Events are temporarily unavailable</strong>
        <span>The current data source did not respond. Try again shortly.</span>
        <button onClick={onRetry} type="button">
          Try again
        </button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className={styles.emptyState}>
        <strong>No matching events</strong>
        <span>{emptyMessage || "Choose another feed filter."}</span>
      </div>
    );
  }

  const premiumInsertIndex = Math.min(2, items.length - 1);

  return (
    <section aria-label="Live feed events" className={styles.feedList}>
      {items.map((item, index) => {
        const selected = item.id === selectedEventId;
        const negative =
          item.changePercent !== null && item.changePercent < 0;
        const quoteUnavailable =
          item.price === null &&
          (item.changePercent === null || item.feedType !== "market");
        const position = index + 1;
        const insertAd = viewerPlan === "free" && position % 20 === 10;
        const eventPresentation = getLiveFeedV2EventPresentation(
          item.category,
          item.feedType,
        );

        return (
          <Fragment key={item.id}>
            <button
              aria-label={`Select ${item.ticker} ${item.feedType}: ${item.headline}`}
              aria-pressed={selected}
              className={`${styles.feedItem} ${
                selected ? styles.feedItemSelected : ""
              }`}
              onClick={(event) =>
                onPreviewSelect(item, event.currentTarget)
              }
              type="button"
            >
              <time className={styles.time} dateTime={item.timestamp}>
                <span>{item.timeDateLabel}</span>
                <strong>{item.timeLabel} ET</strong>
              </time>

              <div className={styles.identity}>
                <strong className={styles.identityDesktop}>{item.ticker}</strong>
                <strong
                  className={styles.identityMobile}
                  data-mobile-identity-kind={item.identityKind}
                >
                  {item.ticker}
                </strong>
                <span title={item.company}>{item.company}</span>
              </div>

              <div className={styles.eventCopy}>
                <div className={styles.eventMeta}>
                  <span
                    className={styles.eventBadge}
                    data-event-emphasis={eventPresentation.emphasis}
                    data-event-tone={eventPresentation.tone}
                  >
                    {eventPresentation.label}
                  </span>
                  <span className={styles.eventMobileFooter}>
                    <time
                      className={styles.eventTimeMobile}
                      dateTime={item.timestamp}
                    >
                      {item.timeDateLabel} {item.timeLabel} ET
                    </time>
                    <span className={styles.source}>{item.source}</span>
                  </span>
                </div>
                <h2>{item.headline}</h2>
                <p>{item.summary}</p>
              </div>

              <div className={styles.marketReaction}>
                {quoteUnavailable ? (
                  <span
                    aria-label="Quote unavailable"
                    className={styles.quoteUnavailable}
                  >
                    —
                  </span>
                ) : (
                  <div className={styles.quote}>
                    <span
                      className={
                        item.changePercent === null
                          ? styles.sentimentNeutral
                          : negative
                            ? styles.sentimentNegative
                            : styles.sentimentPositive
                      }
                    >
                      {formatChangePercent(item.changePercent)}
                    </span>
                    <strong
                      aria-label={
                        item.price === null ? "Quote unavailable" : undefined
                      }
                      className={
                        item.price === null
                          ? styles.quotePriceUnavailable
                          : undefined
                      }
                    >
                      {item.price ?? "—"}
                    </strong>
                  </div>
                )}
                <FeedSparkline closes={item.sparkline} />
              </div>

              <div
                aria-label={`${item.sentiment} direction, impact score ${item.impactScore} out of 99`}
                className={styles.impactScore}
                role="group"
              >
                <span className={sentimentClassNames[item.sentiment]}>
                  {item.sentiment}
                </span>
                <strong data-score-tone={getDirectionalScoreTone(item.impactScore, item.sentiment)}>
                  {item.impactScore}
                </strong>
              </div>
            </button>

            {index === premiumInsertIndex ? (
              <FeedPremiumCard
                className={styles.premiumCardMobile}
                viewerPlan={viewerPlan}
              />
            ) : null}
            {insertAd && items.length - position >= 2 ? (
              <FeedInlineAdSlots />
            ) : null}
          </Fragment>
        );
      })}

      {onLoadMore ? (
        <div className={styles.loadMoreRow}>
          <button
            disabled={isLoadingMore}
            onClick={onLoadMore}
            type="button"
          >
            <span>
              {isLoadingMore ? "Updating events" : "View more events"}
            </span>
            <small>
              {remainingCount === null
                ? "25 more"
                : `${Math.min(25, remainingCount)} more`}
            </small>
          </button>
        </div>
      ) : null}
    </section>
  );
}

function formatChangePercent(value: number | null) {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}
