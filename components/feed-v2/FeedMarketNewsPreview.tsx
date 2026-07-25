import Link from "next/link";
import { ChevronRight, TrendingUp } from "lucide-react";
import { MarketTickerLogo } from "@/components/market/MarketTickerLogo";
import { DetailPanelShell } from "@/components/ui/DetailPanelShell";
import {
  FeedPreviewEventBadge,
  FeedPreviewImpactScore,
  FeedPreviewSignal,
  formatPreviewTimestamp,
  previewValue,
} from "@/components/feed-v2/FeedPreviewShared";
import type { LiveFeedV2MarketNewsPreview } from "@/lib/liveFeedV2Contract";
import styles from "./FeedFilingPreview.module.css";

type FeedMarketNewsPreviewProps = {
  news: LiveFeedV2MarketNewsPreview;
  variant: "desktop" | "mobile";
};

export function FeedMarketNewsPreview({
  news,
  variant,
}: FeedMarketNewsPreviewProps) {
  const content = <FeedMarketNewsPreviewContent news={news} />;

  if (variant === "mobile") return content;

  return (
    <DetailPanelShell
      aria-label={`${news.theme} market news context`}
      className={styles.detailPanel}
    >
      {content}
    </DetailPanelShell>
  );
}

function FeedMarketNewsPreviewContent({
  news,
}: {
  news: LiveFeedV2MarketNewsPreview;
}) {
  return (
    <div className={styles.detailContent} data-preview-kind="market-news">
      <header className={styles.detailHeader}>
        <div className={styles.detailIdentity}>
          {news.ticker ? (
            <MarketTickerLogo size="detail" ticker={news.ticker} />
          ) : (
            <span
              aria-label="Ticker unavailable"
              className={styles.logoUnavailable}
            >
              —
            </span>
          )}
          <div>
            <h2>{news.theme}</h2>
            <p>
              {previewValue(news.ticker)} · {previewValue(news.company)}
            </p>
          </div>
        </div>

        <div className={styles.detailClassification}>
          <FeedPreviewEventBadge category="MARKET" />
        </div>

        <div className={styles.detailFacts}>
          <span>
            <b>Published</b>
            {formatPreviewTimestamp(news.publishedAt)}
          </span>
          <span>
            <b>Signal</b>
            <FeedPreviewSignal signal={news.signal} />
          </span>
          <span>
            <b>Impact</b>
            <FeedPreviewImpactScore score={news.impact} signal={news.signal} />
          </span>
        </div>
      </header>

      <section className={styles.detailSection}>
        <span className={styles.sectionLabel}>Market Brief</span>
        <h3>{news.title}</h3>
        <p>{previewValue(news.marketBrief)}</p>
      </section>

      <section className={styles.detailSection}>
        <span className={styles.sectionLabel}>Key drivers</span>
        {news.drivers.length ? (
          <ul>
            {news.drivers.map((driver) => (
              <li key={driver}>{driver}</li>
            ))}
          </ul>
        ) : (
          <p className={styles.unavailable}>—</p>
        )}
      </section>

      <section className={styles.sourceMetadata}>
        <div>
          <span>Source</span>
          <strong>{news.source}</strong>
        </div>
        <div>
          <span>Coverage</span>
          <strong>{news.coverage}</strong>
        </div>
      </section>

      {news.relatedCompanies.length ? (
        <section className={styles.relatedSection}>
          <span className={styles.sectionLabel}>Related companies</span>
          {news.relatedCompanies.map((company) => (
            <div className={styles.relatedRow} key={company.ticker}>
              <span className={styles.formLabel}>{company.ticker}</span>
              <div>
                <strong>{previewValue(company.company)}</strong>
                <span>{previewValue(company.context)}</span>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      <div className={styles.detailActionArea}>
        <Link className={styles.detailCta} href={news.detailHref}>
          <TrendingUp aria-hidden="true" size={17} />
          View Market Context
          <ChevronRight aria-hidden="true" size={18} />
        </Link>
      </div>
    </div>
  );
}
