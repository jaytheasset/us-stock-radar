import { AdSenseSlot } from "@/components/ads/AdSenseSlot";
import styles from "./NewsV2RailAdSlot.module.css";

type NewsV2RailAdSlotProps = {
  size: "300x250" | "300x600";
};

export function NewsV2RailAdSlot({ size }: NewsV2RailAdSlotProps) {
  const isRectangle = size === "300x250";

  return (
    <AdSenseSlot
      className={styles.slot}
      height={isRectangle ? 250 : 600}
      inventory={isRectangle ? "news-rail-300x250" : "news-rail-300x600"}
      mediaQuery="(min-width: 1181px)"
      placeholderSize={isRectangle ? "300 x 250" : "300 x 600"}
      width={300}
    />
  );
}
