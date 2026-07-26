import Link from "next/link";
import { NewsV2EventBadge } from "@/components/news-v2/NewsV2EventBadge";
import { NewsV2EventTypeBadge } from "@/components/news-v2/NewsV2EventTypeBadge";
import { NewsV2Sparkline } from "@/components/news-v2/NewsV2Sparkline";
import { getDirectionalScoreTone } from "@/lib/directionalScore";
import { formatMarketDateLabel } from "@/lib/marketDate";
import {
  formatNewsV2PublishedAt,
  type NewsV2Item,
} from "@/lib/newsV2";
import { getNewsV2ScopeBadgeLabel } from "@/lib/newsV2ScopeBadge";
import styles from "./StockRadarNewsV2.module.css";

export type NewsV2RowProps = {
  item: NewsV2Item;
  referenceDate: string;
  showMarketReaction: boolean;
};

export function NewsV2Row({
  item,
  referenceDate,
  showMarketReaction,
}: NewsV2RowProps) {
  const isCompanyNews = item.category === "Company";
  const scopeBadgeLabel = getNewsV2ScopeBadgeLabel(item);
  const visibleTickers = item.relatedTickers.slice(0, 2);
  const remainingTickerCount = Math.max(0, item.relatedTickers.length - visibleTickers.length);
  const sentimentClass = styles[`sentiment${item.sentiment}`];
  const tickerUnavailable = isCompanyNews && !item.relatedTickers[0];
  const primaryTicker = isCompanyNews ? item.relatedTickers[0] ?? "N/A" : "MARKET";
  const identityMeta = item.relatedTickers.length > 1
    ? `${item.relatedTickers.length} related tickers`
    : item.marketCapBand
      ? `${item.marketCapBand} cap`
      : item.sector ?? "Market-wide";
  const marketReaction = {
    changePercent: item.changePercent,
    priceLabel: item.priceLabel,
    trend: item.trend,
  };
  const changeClass = marketReaction.changePercent?.startsWith("-")
    ? styles.negativeValue
    : marketReaction.changePercent
      ? styles.positiveValue
      : styles.neutralValue;
  const hasPrice = Boolean(marketReaction.priceLabel);
  const hasChange = Boolean(marketReaction.changePercent);
  const hasQuote = hasPrice || hasChange;
  const hasSparkline = marketReaction.trend.length >= 2;

  return (
    <li className={styles.newsListItem}>
      <Link className={styles.newsRowLink} href={`/events/${item.id}`}>
        <article className={`${styles.newsRow}${showMarketReaction ? "" : ` ${styles.newsRowWithoutMarket}`}`}>
          <span className={styles.rowTime}>
            <span className={styles.rowDate}>
              {formatMarketDateLabel(item.publishedAt, referenceDate)}
            </span>
            <time dateTime={item.publishedAt}>{formatNewsV2PublishedAt(item.publishedAt, "time")}</time>
          </span>

          <span className={styles.rowIdentity}>
            <strong title={tickerUnavailable ? "Ticker unavailable" : undefined}>
              {primaryTicker}
            </strong>
            <span>{identityMeta}</span>
          </span>

          <span className={styles.rowStory}>
            <span className={styles.rowBadges}>
              {scopeBadgeLabel ? (
                <span className={styles.rowCategoryBadgeDesktop}>
                  <NewsV2EventBadge
                    category={item.category}
                    className={styles.newsScopeBadge}
                    label={scopeBadgeLabel}
                    size="micro"
                  />
                </span>
              ) : null}
              <span className={styles.rowEventTypeBadgeDesktop}>
                <NewsV2EventTypeBadge
                  className={styles.newsEventTypeBadge}
                  eventType={item.eventType}
                  eventTypeCode={item.eventTypeCode}
                  size="micro"
                />
              </span>
              <span className={styles.rowMobileBadges}>
                {scopeBadgeLabel ? (
                  <span className={styles.rowCategoryBadgeMobile}>
                    <NewsV2EventBadge
                      category={item.category}
                      className={styles.newsScopeBadge}
                      label={scopeBadgeLabel}
                      size="micro"
                    />
                  </span>
                ) : null}
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
              </span>
              <time className={styles.rowMobilePublishedAt} dateTime={item.publishedAt}>
                <span className={styles.rowMobileDate}>
                  {formatMarketDateLabel(item.publishedAt, referenceDate)}
                </span>
                <span className={styles.rowMobileTime}>
                  {formatNewsV2PublishedAt(item.publishedAt, "time")}
                </span>
              </time>
              <span className={styles.rowSource}>{item.source}</span>
            </span>
            <strong className={styles.rowHeadline}>{item.headline}</strong>
            <span className={styles.rowStoryFooter}>
              <span className={styles.rowSummary}>{item.summary}</span>
              {!isCompanyNews ? (
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
              ) : null}
            </span>
          </span>

          {showMarketReaction ? (
            <span className={styles.rowMarketReaction}>
              <span
                className={`${styles.rowQuote}${hasQuote ? "" : ` ${styles.rowQuoteUnavailable}`}`}
              >
                {hasQuote ? (
                  <>
                    {hasPrice ? <strong>{marketReaction.priceLabel}</strong> : null}
                    {hasChange ? (
                      <span className={changeClass}>{marketReaction.changePercent}</span>
                    ) : null}
                  </>
                ) : (
                  <span className={styles.rowDataUnavailable} title="Quote unavailable">
                    <span aria-hidden="true">—</span>
                    <span className={styles.visuallyHidden}>Quote unavailable</span>
                  </span>
                )}
              </span>
              {hasSparkline ? (
                <NewsV2Sparkline changePercent={marketReaction.changePercent} values={marketReaction.trend} />
              ) : (
                <span
                  className={`${styles.rowSparklineCell} ${styles.rowDataUnavailable} ${styles.rowSparklineUnavailable}`}
                  title="Chart unavailable"
                >
                  <span aria-hidden="true">—</span>
                  <span className={styles.visuallyHidden}>Chart unavailable</span>
                </span>
              )}
            </span>
          ) : null}

          <span
            aria-label={`${item.sentiment} signal, impact score ${item.score} out of 100`}
            className={styles.rowSignals}
          >
            <span className={`${styles.rowSentiment} ${sentimentClass}`}>{item.sentiment}</span>
            <span className={styles.rowScore}>
              <strong data-score-tone={getDirectionalScoreTone(item.score, item.sentiment)}>
                {item.score}
              </strong>
            </span>
          </span>
        </article>
      </Link>
    </li>
  );
}
