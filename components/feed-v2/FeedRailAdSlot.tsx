import { AdSenseSlot } from "@/components/ads/AdSenseSlot";
import styles from "./StockRadarFeedV2.module.css";

export function FeedRailAdSlot() {
  return (
    <div className={styles.railAdPlacement}>
      <AdSenseSlot
        className={styles.railAd}
        format="responsive"
        height={250}
        inventory="feed-rail-300x250"
        mediaQuery="(min-width: 1181px)"
        placeholderSize="Responsive display"
        width={336}
      />
    </div>
  );
}
