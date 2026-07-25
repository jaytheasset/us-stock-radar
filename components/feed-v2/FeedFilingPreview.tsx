import Link from "next/link";
import { Bookmark, ChevronRight, FileText } from "lucide-react";
import { MarketTickerLogo } from "@/components/market/MarketTickerLogo";
import { DetailPanelShell } from "@/components/ui/DetailPanelShell";
import {
  FeedPreviewEventBadge,
  FeedPreviewImpactScore,
  FeedPreviewSignal,
  formatPreviewTimestamp,
  previewValue,
} from "@/components/feed-v2/FeedPreviewShared";
import type { LiveFeedV2FilingPreview } from "@/lib/liveFeedV2Contract";
import styles from "./FeedFilingPreview.module.css";

type FeedFilingPreviewProps = {
  filing: LiveFeedV2FilingPreview;
  variant: "desktop" | "mobile";
};

export function FeedFilingPreview({
  filing,
  variant,
}: FeedFilingPreviewProps) {
  const content = <FeedFilingPreviewContent filing={filing} />;

  if (variant === "mobile") return content;

  return (
    <DetailPanelShell
      aria-label={`${previewValue(filing.formType)} filing context`}
      className={styles.detailPanel}
    >
      {content}
    </DetailPanelShell>
  );
}

function FeedFilingPreviewContent({
  filing,
}: {
  filing: LiveFeedV2FilingPreview;
}) {
  return (
    <div className={styles.detailContent} data-preview-kind="filing">
      <header className={styles.detailHeader}>
        <div className={styles.detailIdentity}>
          <MarketTickerLogo size="detail" ticker={filing.ticker} />
          <div>
            <h2>{filing.ticker}</h2>
            <p>{previewValue(filing.company)}</p>
          </div>
          <span className={styles.watchlistStatus}>
            <Bookmark aria-hidden="true" size={14} />
            <span className={styles.watchlistStatusText}>
              {filing.watchlist === null
                ? "—"
                : filing.watchlist
                  ? "Watchlist"
                  : "Not watched"}
            </span>
          </span>
        </div>

        <div className={styles.detailClassification}>
          <span className={styles.formLabel}>
            {previewValue(filing.formType)}
          </span>
          {filing.events.map((event) => (
            <FeedPreviewEventBadge category={event} key={event} />
          ))}
        </div>

        <div className={styles.detailFacts}>
          <span>
            <b>Filed</b>
            {formatPreviewTimestamp(filing.publishedAt)}
          </span>
          <span>
            <b>Signal</b>
            <FeedPreviewSignal signal={filing.signal} />
          </span>
          <span>
            <b>Impact</b>
            <FeedPreviewImpactScore score={filing.impact} />
          </span>
        </div>
      </header>

      <section className={styles.detailSection}>
        <span className={styles.sectionLabel}>Filing Brief</span>
        <h3>{filing.title}</h3>
        <p>{previewValue(filing.filingBrief)}</p>
      </section>

      <section className={styles.detailSection}>
        <span className={styles.sectionLabel}>Key points</span>
        {filing.keyPoints.length ? (
          <ul>
            {filing.keyPoints.map((point) => (
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
          <strong>{filing.source}</strong>
        </div>
        <div>
          <span>Accession</span>
          <strong>{previewValue(filing.accession)}</strong>
        </div>
      </section>

      {filing.relatedFilings.length ? (
        <section className={styles.relatedSection}>
          <span className={styles.sectionLabel}>Related filings</span>
          {filing.relatedFilings.map((related) => (
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
        <Link className={styles.detailCta} href={filing.detailHref}>
          <FileText aria-hidden="true" size={17} />
          View Filing Details
          <ChevronRight aria-hidden="true" size={18} />
        </Link>
      </div>
    </div>
  );
}
