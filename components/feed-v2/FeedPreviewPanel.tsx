import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { FeedSparkline } from "@/components/feed-v2/FeedSparkline";
import type { LiveFeedV2Item } from "@/lib/liveFeedV2Contract";
import styles from "./StockRadarFeedV2.module.css";

type FeedPreviewPanelProps = {
  item: LiveFeedV2Item | null;
  variant: "desktop" | "mobile";
};

export function FeedPreviewPanel({
  item,
  variant,
}: FeedPreviewPanelProps) {
  if (!item) {
    return (
      <section className={styles.previewEmpty}>
        <strong>Select an event</strong>
        <p>Choose a feed row to inspect its available context.</p>
      </section>
    );
  }

  const previewLabel =
    item.feedType === "filings"
      ? "Filing Preview"
      : item.feedType === "market"
        ? "Market News Preview"
        : "Company News Preview";

  return (
    <article
      className={styles.previewPanel}
      data-variant={variant}
      key={item.id}
    >
      <header>
        <div>
          <span>{previewLabel}</span>
          <strong>{item.ticker}</strong>
        </div>
        <span className={styles.previewImpact}>
          Impact {item.impactScore}
        </span>
      </header>

      <div className={styles.previewMeta}>
        <span>{item.category}</span>
        <time dateTime={item.timestamp}>
          {item.timeDateLabel} · {item.timeLabel} ET
        </time>
        <span>{item.source}</span>
      </div>

      <h2>{item.headline}</h2>
      <p>{item.summary}</p>

      <section className={styles.previewMarket}>
        {item.price === null ? (
          <div className={styles.previewQuoteUnavailable}>
            <span>Market reaction</span>
            <strong aria-label="Quote unavailable">—</strong>
          </div>
        ) : (
          <div>
            <span>Market reaction</span>
            <strong>{item.price}</strong>
            <small>{formatChangePercent(item.changePercent)}</small>
          </div>
        )}
        <FeedSparkline closes={item.sparkline} />
      </section>

      <Link className={styles.previewLink} href={item.detailHref}>
        Open full analysis
        <ExternalLink aria-hidden="true" size={15} />
      </Link>
    </article>
  );
}

function formatChangePercent(value: number | null) {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}
