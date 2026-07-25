import { FeedCompanyNewsPreview } from "@/components/feed-v2/FeedCompanyNewsPreview";
import { FeedFilingPreview } from "@/components/feed-v2/FeedFilingPreview";
import { FeedMarketNewsPreview } from "@/components/feed-v2/FeedMarketNewsPreview";
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

  if (item.preview.kind === "filing") {
    return (
      <FeedFilingPreview
        filing={item.preview}
        key={item.preview.id}
        variant={variant}
      />
    );
  }

  if (item.preview.kind === "market-news") {
    return (
      <FeedMarketNewsPreview
        key={item.preview.id}
        news={item.preview}
        variant={variant}
      />
    );
  }

  return (
    <FeedCompanyNewsPreview
      key={item.preview.id}
      news={item.preview}
      variant={variant}
    />
  );
}
