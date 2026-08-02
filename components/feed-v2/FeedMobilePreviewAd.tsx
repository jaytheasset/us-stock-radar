import { AdSenseSlot } from "@/components/ads/AdSenseSlot";
import styles from "./StockRadarFeedV2.module.css";

export function FeedMobilePreviewAd() {
  return (
    <section aria-label="Advertisement" className={styles.mobilePreviewAd}>
      <AdSenseSlot
        className={styles.mobilePreviewAdSlot}
        format="responsive"
        height={100}
        inventory="feed-mobile-inline"
        mediaQuery="(max-width: 760px)"
        mobileHeight={100}
        mobileWidth={320}
        placeholderSize="Responsive display"
        width={480}
      />
    </section>
  );
}
