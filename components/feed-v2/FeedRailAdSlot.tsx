import { FeedPreviewAd } from "@/components/feed-v2/FeedMobilePreviewAd";
import styles from "./StockRadarFeedV2.module.css";

export function FeedRailAdSlot() {
  return (
    <div className={styles.railAdPlacement}>
      <FeedPreviewAd size="300x250" />
    </div>
  );
}
