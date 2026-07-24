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
      format="responsive"
      height={250}
      inventory={isRectangle ? "news-rail-300x250" : "news-rail-300x600"}
      mediaQuery="(min-width: 1181px)"
      placeholderSize="Responsive display"
      width={336}
    />
  );
}
