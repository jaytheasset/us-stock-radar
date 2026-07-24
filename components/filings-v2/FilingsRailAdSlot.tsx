import { AdSenseSlot } from "@/components/ads/AdSenseSlot";
import styles from "./FilingsRailAdSlot.module.css";

type FilingsRailAdSlotProps = {
  size: "300x250" | "300x600" | "320x100";
};

export function FilingsRailAdSlot({ size }: FilingsRailAdSlotProps) {
  const isMobile = size === "320x100";
  const isRectangle = size === "300x250";

  return (
    <AdSenseSlot
      className={`${styles.slot} ${isMobile ? styles.mobileSlot : styles.desktopSlot}`}
      height={isMobile ? 100 : isRectangle ? 250 : 600}
      inventory={
        isMobile
          ? "filings-mobile-inline"
          : isRectangle
            ? "filings-rail-300x250"
            : "filings-rail-300x600"
      }
      mediaQuery={isMobile ? "(max-width: 760px)" : "(min-width: 1181px)"}
      placeholderSize={isMobile ? "320 x 100" : isRectangle ? "300 x 250" : "300 x 600"}
      width={isMobile ? 320 : 300}
    />
  );
}
