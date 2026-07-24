import { AdSenseSlot } from "@/components/ads/AdSenseSlot";
import styles from "./DesktopRailAdSlot.module.css";

export function DesktopRailAdSlot() {
  return (
    <AdSenseSlot
      className={styles.slot}
      format="responsive"
      height={250}
      inventory="dashboard-rail"
      mediaQuery="(min-width: 1181px)"
      placeholderSize="Responsive display"
      width={336}
    />
  );
}
