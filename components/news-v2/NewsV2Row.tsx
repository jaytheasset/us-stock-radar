"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { NewsV2EventBadge } from "@/components/news-v2/NewsV2EventBadge";
import { NewsV2EventTypeBadge } from "@/components/news-v2/NewsV2EventTypeBadge";
import { NewsV2Sparkline } from "@/components/news-v2/NewsV2Sparkline";
import { formatMarketDateLabel } from "@/lib/marketDate";
import { formatNewsV2PublishedAt, type NewsV2Item } from "@/lib/newsV2";
import styles from "./StockRadarNewsV2.module.css";

export type NewsV2RowProps = {
  item: NewsV2Item;
  referenceDate: string;
  showMarketReaction: boolean;
};

type RowMarketReaction = {
  changePercent?: string;
  priceLabel?: string;
  trend: number[];
};

type MarketChartPayload = {
  changePercent?: unknown;
  latestPrice?: unknown;
  ok?: unknown;
  points?: unknown;
};

const rowMarketReactionCache = new Map<string, Promise<RowMarketReaction | null>>();
const rowMarketReactionQueue: Array<() => void> = [];
const maxConcurrentMarketRequests = 4;
let activeMarketRequests = 0;

export function NewsV2Row({
  item,
  referenceDate,
  showMarketReaction,
}: NewsV2RowProps) {
  const rowRef = useRef<HTMLElement | null>(null);
  const isCompanyNews = item.category === "Company";
  const visibleTickers = item.relatedTickers.slice(0, 2);
  const remainingTickerCount = Math.max(0, item.relatedTickers.length - visibleTickers.length);
  const sentimentClass = styles[`sentiment${item.sentiment}`];
  const primaryTicker = isCompanyNews ? item.relatedTickers[0] ?? "MARKET" : "MARKET";
  const identityMeta = item.relatedTickers.length > 1
    ? `${item.relatedTickers.length} related tickers`
    : item.marketCapBand
      ? `${item.marketCapBand} cap`
      : item.sector ?? "Market-wide";
  const [marketReaction, setMarketReaction] = useState<RowMarketReaction>({
    changePercent: item.changePercent,
    priceLabel: item.priceLabel,
    trend: item.trend,
  });
  const changeClass = marketReaction.changePercent?.startsWith("-")
    ? styles.negativeValue
    : marketReaction.changePercent
      ? styles.positiveValue
      : styles.neutralValue;
  const hasSparkline = marketReaction.trend.length >= 2;

  useEffect(() => {
    setMarketReaction({
      changePercent: item.changePercent,
      priceLabel: item.priceLabel,
      trend: item.trend,
    });

    const ticker = isCompanyNews ? item.relatedTickers[0]?.trim().toUpperCase() : "";
    const hasCompleteMarketData = Boolean(item.priceLabel && item.changePercent && item.trend.length >= 2);
    if (!showMarketReaction || !ticker || hasCompleteMarketData) return;

    let cancelled = false;
    let observer: IntersectionObserver | undefined;
    const loadMarketReaction = () => {
      getRowMarketReaction(ticker).then((reaction) => {
        if (!cancelled && reaction) setMarketReaction(reaction);
      });
    };

    if (typeof IntersectionObserver === "undefined" || !rowRef.current) {
      loadMarketReaction();
    } else {
      observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          observer?.disconnect();
          loadMarketReaction();
        },
        { rootMargin: "240px 0px" },
      );
      observer.observe(rowRef.current);
    }

    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [isCompanyNews, item.changePercent, item.id, item.priceLabel, item.relatedTickers, item.trend, showMarketReaction]);

  return (
    <li className={styles.newsListItem}>
      <Link className={styles.newsRowLink} href={`/events/${item.id}`}>
        <article className={`${styles.newsRow}${showMarketReaction ? "" : ` ${styles.newsRowWithoutMarket}`}`} ref={rowRef}>
          <span className={styles.rowTime}>
            <span className={styles.rowDate}>
              {formatMarketDateLabel(item.publishedAt, referenceDate)}
            </span>
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
              <span className={styles.rowQuote}>
                <strong>{marketReaction.priceLabel ?? "—"}</strong>
                <span className={changeClass}>{marketReaction.changePercent ?? "—"}</span>
              </span>
              {hasSparkline ? (
                <NewsV2Sparkline changePercent={marketReaction.changePercent} values={marketReaction.trend} />
              ) : (
                <span aria-hidden="true" className={styles.rowSparklinePlaceholder} />
              )}
            </span>
          ) : null}

          <span
            aria-label={`${item.sentiment} signal, impact score ${item.score} out of 100`}
            className={styles.rowSignals}
            data-score-band={
              item.score >= 90
                ? "critical"
                : item.score >= 75
                  ? "high"
                  : item.score >= 50
                    ? "medium"
                    : "low"
            }
            data-signal={item.sentiment}
          >
            <span className={`${styles.rowSentiment} ${sentimentClass}`}>{item.sentiment}</span>
            <span className={styles.rowScore}>
              <strong>{item.score}</strong>
            </span>
          </span>
        </article>
      </Link>
    </li>
  );
}

function getRowMarketReaction(ticker: string) {
  const cached = rowMarketReactionCache.get(ticker);
  if (cached) return cached;

  const request = scheduleMarketRequest(() => fetchRowMarketReaction(ticker));

  rowMarketReactionCache.set(ticker, request);
  return request;
}

function scheduleMarketRequest<T>(task: () => Promise<T>) {
  return new Promise<T>((resolve) => {
    const run = () => {
      activeMarketRequests += 1;
      task()
        .then(resolve)
        .finally(() => {
          activeMarketRequests -= 1;
          rowMarketReactionQueue.shift()?.();
        });
    };

    if (activeMarketRequests < maxConcurrentMarketRequests) run();
    else rowMarketReactionQueue.push(run);
  });
}

async function fetchRowMarketReaction(ticker: string) {
  try {
    const response = await fetch(
      `/api/market/chart?symbol=${encodeURIComponent(ticker)}&range=1D&soft=1`,
      { cache: "force-cache" },
    );
    if (!response.ok) return null;
    return normalizeRowMarketReaction(await response.json() as MarketChartPayload);
  } catch {
    return null;
  }
}

function normalizeRowMarketReaction(payload: MarketChartPayload): RowMarketReaction | null {
  if (payload.ok !== true) return null;

  const latestPrice = Number(payload.latestPrice);
  const changePercent = Number(payload.changePercent);
  const trend = Array.isArray(payload.points)
    ? payload.points
      .map((point) => Number((point as { close?: unknown }).close))
      .filter(Number.isFinite)
    : [];

  if (!Number.isFinite(latestPrice) && !Number.isFinite(changePercent) && trend.length < 2) return null;

  return {
    priceLabel: Number.isFinite(latestPrice)
      ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(latestPrice)
      : undefined,
    changePercent: Number.isFinite(changePercent)
      ? `${changePercent >= 0 ? "+" : ""}${changePercent.toFixed(2)}%`
      : undefined,
    trend,
  };
}
