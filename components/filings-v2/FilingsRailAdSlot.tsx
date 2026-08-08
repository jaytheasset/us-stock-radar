import { AdSenseSlot } from "@/components/ads/AdSenseSlot";
import styles from "./FilingsRailAdSlot.module.css";

type FilingsRailAdSlotProps = {
  size: "300x250" | "300x600" | "320x100";
};

export function FilingsRailAdSlot({ size }: FilingsRailAdSlotProps) {
  const isMobile = size === "320x100";
  const isRectangle = size === "300x250";
  const height = isMobile ? 100 : isRectangle ? 250 : 600;
  const width = isMobile ? 320 : 300;

  return (
    <AdSenseSlot
      className={`${styles.slot} ${isMobile ? styles.mobileSlot : styles.desktopSlot}`}
      format="responsive"
      height={height}
      inventory={
        isMobile
          ? "filings-mobile-inline"
          : isRectangle
            ? "filings-rail-300x250"
            : "filings-rail-300x600"
      }
      mediaQuery={isMobile ? "(max-width: 760.98px)" : "(min-width: 761px)"}
      mobileHeight={isMobile ? 100 : undefined}
      mobileWidth={isMobile ? 320 : undefined}
      placeholderSize={size}
      width={width}
    />
  );
}
