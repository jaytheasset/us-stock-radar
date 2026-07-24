import { AdSenseSlot } from "@/components/ads/AdSenseSlot";
import styles from "./StockRadarFilingsV2.module.css";

type FilingsV2InlineAdProps = {
  format: "desktop" | "mobile";
};

export function FilingsV2InlineAd({ format }: FilingsV2InlineAdProps) {
  const isDesktop = format === "desktop";
  const slot = (
    <AdSenseSlot
      className={isDesktop ? styles.desktopInlineAdSlot : styles.mobileInlineAdSlot}
      format={isDesktop ? "horizontal" : "fixed"}
      height={isDesktop ? 90 : 100}
      inventory={isDesktop ? "filings-desktop-inline" : "filings-mobile-inline"}
      mediaQuery={isDesktop ? "(min-width: 761px)" : "(max-width: 760px)"}
      placeholderSize={isDesktop ? "728 x 90" : "320 x 100"}
      width={isDesktop ? 728 : 320}
    />
  );

  if (isDesktop) {
    return <div className={styles.desktopInlineAdItem}>{slot}</div>;
  }

  return <div className={styles.mobileInlineAdItem}>{slot}</div>;
}
