import { AdSenseSlot } from "@/components/ads/AdSenseSlot";
import styles from "./AnalysisSignalCompanionAd.module.css";

export function AnalysisSignalCompanionAd() {
  return (
    <div className={styles.companion}>
      <AdSenseSlot
        className={styles.slot}
        format="responsive"
        height={250}
        inventory="analysis-signal-companion"
        mediaQuery="(min-width: 0px)"
        placeholderSize="Responsive display"
        width={970}
      />
    </div>
  );
}
