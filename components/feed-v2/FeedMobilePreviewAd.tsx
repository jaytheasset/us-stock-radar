import { AdSenseSlot } from "@/components/ads/AdSenseSlot";
import styles from "./StockRadarFeedV2.module.css";

type FeedPreviewAdProps = {
  size: "300x250" | "320x100";
};

export function FeedPreviewAd({ size }: FeedPreviewAdProps) {
  const isMobile = size === "320x100";

  return (
    <div className={isMobile ? styles.mobilePreviewAd : styles.desktopPreviewAd}>
      <AdSenseSlot
        className={styles.previewAdSlot}
        format="responsive"
        height={isMobile ? 100 : 250}
        inventory={isMobile ? "feed-mobile-inline" : "feed-rail-300x250"}
        mediaQuery={isMobile ? "(max-width: 760.98px)" : "(min-width: 761px)"}
        mobileHeight={isMobile ? 100 : undefined}
        mobileWidth={isMobile ? 320 : undefined}
        placeholderSize={size}
        width={isMobile ? 320 : 300}
      />
    </div>
  );
}
