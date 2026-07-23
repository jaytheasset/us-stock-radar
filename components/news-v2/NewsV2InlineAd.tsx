import { AdSenseSlot } from "@/components/ads/AdSenseSlot";
import styles from "./StockRadarNewsV2.module.css";

type NewsV2InlineAdProps = {
  format: "desktop" | "mobile";
};

export function NewsV2InlineAd({ format }: NewsV2InlineAdProps) {
  const isDesktop = format === "desktop";

  return (
    <li className={isDesktop ? styles.desktopInlineAdItem : styles.mobileInlineAdItem}>
      <AdSenseSlot
        className={isDesktop ? styles.desktopInlineAdSlot : styles.mobileInlineAdSlot}
        format={isDesktop ? "horizontal" : "fixed"}
        height={isDesktop ? 90 : 100}
        inventory={isDesktop ? "news-desktop-inline" : "news-mobile-inline"}
        mediaQuery={isDesktop ? "(min-width: 981px)" : "(max-width: 980px)"}
        placeholderSize={isDesktop ? "728 x 90" : "320 x 100"}
        width={isDesktop ? 728 : 320}
      />
    </li>
  );
}
