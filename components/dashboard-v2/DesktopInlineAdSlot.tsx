import { AdSenseSlot } from "@/components/ads/AdSenseSlot";
import styles from "./DesktopInlineAdSlot.module.css";

export function DesktopInlineAdSlot() {
  return (
    <tr className={styles.row}>
      <td colSpan={9}>
        <AdSenseSlot
          className={styles.slot}
          format="horizontal"
          height={90}
          inventory="dashboard-desktop-inline"
          mediaQuery="(min-width: 1181px)"
          placeholderSize="Responsive display"
          width={970}
        />
      </td>
    </tr>
  );
}
