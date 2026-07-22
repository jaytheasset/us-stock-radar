import Link from "next/link";
import { NewsV2EventBadge } from "@/components/news-v2/NewsV2EventBadge";
import { NewsV2EventTypeBadge } from "@/components/news-v2/NewsV2EventTypeBadge";
import { NewsV2Sparkline } from "@/components/news-v2/NewsV2Sparkline";
import { formatNewsV2PublishedAt, type NewsV2Item } from "@/lib/newsV2";
import styles from "./StockRadarNewsV2.module.css";

export type NewsV2RowProps = {
  item: NewsV2Item;
  showMarketReaction: boolean;
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "America/New_York",
});
const dateKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "America/New_York",
});

function formatRowDate(publishedAt: string) {
  const date = new Date(publishedAt);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return dateKeyFormatter.format(date) === dateKeyFormatter.format(new Date())
    ? "Today"
    : dateFormatter.format(date);
}

export function NewsV2Row({ item, showMarketReaction }: NewsV2RowProps) {
  const visibleTickers = item.relatedTickers.slice(0, 2);
  const remainingTickerCount = Math.max(0, item.relatedTickers.length - visibleTickers.length);
  const sentimentClass = styles[`sentiment${item.sentiment}`];
  const primaryTicker = item.relatedTickers[0] ?? "MARKET";
  const identityMeta = item.relatedTickers.length > 1
    ? `${item.relatedTickers.length} related tickers`
    : item.marketCapBand
      ? `${item.marketCapBand} cap`
      : item.sector ?? "Market-wide";
  const changeClass = item.changePercent?.startsWith("-")
    ? styles.negativeValue
    : item.changePercent
      ? styles.positiveValue
      : styles.neutralValue;
  const hasSparkline = item.trend.length >= 2;

  return (
    <li className={styles.newsListItem}>
      <Link className={styles.newsRowLink} href={`/events/${item.id}`}>
        <article className={`${styles.newsRow}${showMarketReaction ? "" : ` ${styles.newsRowWithoutMarket}`}`}>
          <span className={styles.rowTime}>
            <span className={styles.rowDate}>{formatRowDate(item.publishedAt)}</span>
            <time dateTime={item.publishedAt}>{formatNewsV2PublishedAt(item.publishedAt, "time")}</time>
          </span>

          <span className={styles.rowIdentity}>
            <strong>{primaryTicker}</strong>
            <span>{identityMeta}</span>
          </span>

          <span className={styles.rowStory}>
            <span className={styles.rowBadges}>
              <span className={styles.rowCategoryBadgeDesktop}>
                <NewsV2EventBadge category={item.category} size="micro" />
              </span>
              <span className={styles.rowCategoryBadgeMobile}>
                <NewsV2EventBadge category={item.category} size="micro" />
              </span>
              <span className={styles.rowEventTypeBadgeDesktop}>
                <NewsV2EventTypeBadge
                  className={styles.newsEventTypeBadge}
                  eventType={item.eventType}
                  eventTypeCode={item.eventTypeCode}
                  size="micro"
                />
              </span>
              <span className={styles.rowEventTypeBadgeMobile}>
                <NewsV2EventTypeBadge
                  className={styles.newsEventTypeBadge}
                  eventType={item.eventType}
                  eventTypeCode={item.eventTypeCode}
                  size="micro"
                />
              </span>
              {item.relatedTickers.length > 1 ? (
                <span className={styles.mobileTickerOverflow}>+{item.relatedTickers.length - 1}</span>
              ) : null}
              <time className={styles.rowMobilePublishedAt} dateTime={item.publishedAt}>
                {formatRowDate(item.publishedAt)} {formatNewsV2PublishedAt(item.publishedAt, "time")}
              </time>
              <span className={styles.rowSource}>{item.source}</span>
            </span>
            <strong className={styles.rowHeadline}>{item.headline}</strong>
            <span className={styles.rowStoryFooter}>
              <span className={styles.rowSummary}>{item.summary}</span>
              <span className={styles.rowTickers}>
                {visibleTickers.length ? (
                  <>
                    {visibleTickers.map((ticker) => (
                      <span className={styles.tickerChip} key={ticker}>{ticker}</span>
                    ))}
                    {remainingTickerCount ? <span className={styles.tickerOverflow}>+{remainingTickerCount}</span> : null}
                  </>
                ) : (
                  <span className={styles.marketWide}>Market-wide</span>
                )}
              </span>
            </span>
          </span>

          {showMarketReaction ? (
            <span className={styles.rowMarketReaction}>
              <span className={styles.rowQuote}>
                <strong>{item.priceLabel ?? "—"}</strong>
                <span className={changeClass}>{item.changePercent ?? "—"}</span>
              </span>
              {hasSparkline ? (
                <NewsV2Sparkline changePercent={item.changePercent} values={item.trend} />
              ) : (
                <span aria-hidden="true" className={styles.rowSparklinePlaceholder} />
              )}
            </span>
          ) : null}

          <span
            aria-label={`${item.sentiment} signal, impact score ${item.score} out of 100`}
            className={styles.rowSignals}
          >
            <span className={`${styles.rowSentiment} ${sentimentClass}`}>{item.sentiment}</span>
            <span className={styles.rowScore} data-score-band={item.score >= 80 ? "high" : item.score >= 60 ? "medium" : "low"}>
              <strong>{item.score}</strong>
            </span>
          </span>
        </article>
      </Link>
    </li>
  );
}
