import { AdSenseSlot } from "@/components/ads/AdSenseSlot";
import styles from "./StockRadarFeedV2.module.css";

export function FeedInlineAdSlots() {
  return (
    <>
      <div className={styles.inlineAdDesktopPlacement}>
        <AdSenseSlot
          className={styles.inlineAdSlot}
          format="horizontal"
          height={90}
          inventory="feed-desktop-inline"
          mediaQuery="(min-width: 761px)"
          placeholderSize="Responsive display"
          width={970}
        />
      </div>
      <div className={styles.inlineAdMobilePlacement}>
        <AdSenseSlot
          className={styles.inlineAdSlot}
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
    </>
  );
}
