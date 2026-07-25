import { AdSenseSlot } from "@/components/ads/AdSenseSlot";
import styles from "./StockRadarFeedV2.module.css";

export function FeedInlineAdSlots() {
  return (
    <div className={styles.inlineAd}>
      <AdSenseSlot
        className={styles.inlineAdDesktop}
        format="horizontal"
        height={100}
        inventory="feed-desktop-inline"
        mediaQuery="(min-width: 761px) and (max-width: 1180px)"
        placeholderSize="Responsive display"
        width={970}
      />
      <AdSenseSlot
        className={styles.inlineAdMobile}
        format="responsive"
        height={100}
        inventory="feed-mobile-inline"
        mediaQuery="(max-width: 760px)"
        mobileHeight={100}
        mobileWidth={320}
        placeholderSize="Responsive display"
        width={480}
      />
    </div>
  );
}
