import { AdSenseSlot } from "@/components/ads/AdSenseSlot";
import styles from "./MobileInlineAdSlot.module.css";

export function MobileInlineAdSlot() {
  return (
    <tr className={styles.row}>
      <td colSpan={6}>
        <AdSenseSlot
          className={styles.slot}
          format="responsive"
          height={100}
          inventory="dashboard-mobile-inline"
          mediaQuery="(max-width: 760px)"
          placeholderSize="Responsive display"
          width={480}
        />
      </td>
    </tr>
  );
}
