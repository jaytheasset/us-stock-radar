import { AdSenseSlot } from "@/components/ads/AdSenseSlot";
import styles from "./StockRadarNewsV2.module.css";

export function NewsV2InsightInlineAd() {
  return (
    <div className={styles.mobileInsightAdItem}>
      <AdSenseSlot
        className={styles.mobileInlineAdSlot}
        height={100}
        inventory="news-mobile-inline"
        mediaQuery="(max-width: 980px)"
        placeholderSize="320 x 100"
        width={320}
      />
    </div>
  );
}
