import { AdSenseSlot } from "@/components/ads/AdSenseSlot";
import styles from "./AnalysisCollapsedRailInlineAd.module.css";

type AnalysisCollapsedRailInlineAdProps = {
  tabletOnly?: boolean;
};

export function AnalysisCollapsedRailInlineAd({
  tabletOnly = false,
}: AnalysisCollapsedRailInlineAdProps) {
  return (
    <AdSenseSlot
      className={styles.slot}
      format="horizontal"
      height={90}
      inventory="analysis-collapsed-rail-inline"
      mediaQuery={
        tabletOnly
          ? "(min-width: 761px) and (max-width: 1180px)"
          : "(max-width: 1180px)"
      }
      mobileHeight={100}
      mobileWidth={480}
      placeholderSize="Responsive display"
      width={970}
    />
  );
}
