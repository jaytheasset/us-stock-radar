import { AdSenseSlot } from "@/components/ads/AdSenseSlot";
import styles from "./AnalysisCollapsedRailInlineAd.module.css";

export function AnalysisCollapsedRailInlineAd() {
  return (
    <AdSenseSlot
      className={styles.slot}
      format="horizontal"
      height={90}
      inventory="analysis-collapsed-rail-inline"
      mediaQuery="(max-width: 1180px)"
      mobileHeight={100}
      mobileWidth={480}
      placeholderSize="Responsive display"
      width={970}
    />
  );
}
