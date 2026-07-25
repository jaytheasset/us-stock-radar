import Link from "next/link";
import { Bookmark, ChevronRight, Newspaper } from "lucide-react";
import { MarketTickerLogo } from "@/components/market/MarketTickerLogo";
import { DetailPanelShell } from "@/components/ui/DetailPanelShell";
import {
  FeedPreviewEventBadge,
  FeedPreviewImpactScore,
  FeedPreviewSignal,
  formatPreviewTimestamp,
  previewValue,
} from "@/components/feed-v2/FeedPreviewShared";
import type { LiveFeedV2CompanyNewsPreview } from "@/lib/liveFeedV2Contract";
import styles from "./FeedFilingPreview.module.css";

type FeedCompanyNewsPreviewProps = {
  news: LiveFeedV2CompanyNewsPreview;
  variant: "desktop" | "mobile";
};

export function FeedCompanyNewsPreview({
  news,
  variant,
}: FeedCompanyNewsPreviewProps) {
  const content = <FeedCompanyNewsPreviewContent news={news} />;

  if (variant === "mobile") return content;

  return (
    <DetailPanelShell
      aria-label={`${news.ticker} company news context`}
      className={styles.detailPanel}
    >
      {content}
    </DetailPanelShell>
  );
}

function FeedCompanyNewsPreviewContent({
  news,
}: {
  news: LiveFeedV2CompanyNewsPreview;
}) {
  return (
    <div className={styles.detailContent} data-preview-kind="company-news">
      <header className={styles.detailHeader}>
        <div className={styles.detailIdentity}>
          <MarketTickerLogo size="detail" ticker={news.ticker} />
          <div>
            <h2>{news.ticker}</h2>
            <p>{previewValue(news.company)}</p>
          </div>
          <span className={styles.watchlistStatus}>
            <Bookmark aria-hidden="true" size={14} />
            <span className={styles.watchlistStatusText}>
              {news.watchlist === null
                ? "—"
                : news.watchlist
                  ? "Watchlist"
                  : "Not watched"}
            </span>
          </span>
        </div>

        <div className={styles.detailClassification}>
          <FeedPreviewEventBadge category={news.category} />
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
            <FeedPreviewImpactScore score={news.impact} />
          </span>
        </div>
      </header>

      <section className={styles.detailSection}>
        <span className={styles.sectionLabel}>News Brief</span>
        <h3>{news.title}</h3>
        <p>{previewValue(news.brief)}</p>
      </section>

      <section className={styles.detailSection}>
        <span className={styles.sectionLabel}>Key points</span>
        {news.keyPoints.length ? (
          <ul>
            {news.keyPoints.map((point) => (
              <li key={point}>{point}</li>
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

      {news.relatedNews.length ? (
        <section className={styles.relatedSection}>
          <span className={styles.sectionLabel}>Related news</span>
          {news.relatedNews.map((related) => (
            <Link className={styles.relatedRow} href={related.href} key={related.href}>
              <span className={styles.formLabel}>{related.label}</span>
              <div>
                <strong>{related.title}</strong>
                <span>{related.metadata}</span>
              </div>
            </Link>
          ))}
        </section>
      ) : null}

      <div className={styles.detailActionArea}>
        <Link className={styles.detailCta} href={news.detailHref}>
          <Newspaper aria-hidden="true" size={17} />
          View Full Analysis
          <ChevronRight aria-hidden="true" size={18} />
        </Link>
      </div>
    </div>
  );
}
