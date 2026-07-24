import { AdSenseSlot } from "@/components/ads/AdSenseSlot";
import styles from "./FilingRailAdSlot.module.css";

type FilingRailAdSlotProps = {
  format?: "rectangle" | "skyscraper";
};

export function FilingRailAdSlot({
  format = "skyscraper",
}: FilingRailAdSlotProps) {
  return (
    <AdSenseSlot
      className={`${styles.slot} ${styles[format]}`}
      format="responsive"
      height={250}
      inventory={
        format === "rectangle" ? "filings-rail-300x250" : "filings-rail-300x600"
      }
      mediaQuery="(min-width: 1181px)"
      placeholderSize="Responsive display"
      width={336}
    />
  );
}
