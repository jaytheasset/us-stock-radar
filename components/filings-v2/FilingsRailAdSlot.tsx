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
      format="responsive"
      height={isMobile ? 100 : 250}
      inventory={
        isMobile
          ? "filings-mobile-inline"
          : isRectangle
            ? "filings-rail-300x250"
            : "filings-rail-300x600"
      }
      mediaQuery={isMobile ? "(max-width: 760px)" : "(min-width: 1181px)"}
      placeholderSize="Responsive display"
      width={isMobile ? 480 : 336}
    />
  );
}
