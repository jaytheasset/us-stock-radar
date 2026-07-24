import { AdSenseSlot } from "@/components/ads/AdSenseSlot";
import styles from "./FilingInlineAdSlot.module.css";

export function FilingInlineAdSlot() {
  return (
    <>
      <AdSenseSlot
        className={`${styles.slot} ${styles.desktopSlot}`}
        format="horizontal"
        height={90}
        inventory="filings-desktop-inline"
        mediaQuery="(min-width: 761px)"
        placeholderSize="Responsive display"
        width={970}
      />
      <AdSenseSlot
        className={`${styles.slot} ${styles.mobileSlot}`}
        format="responsive"
        height={100}
        inventory="filings-mobile-inline"
        mediaQuery="(max-width: 760px)"
        placeholderSize="Responsive display"
        width={480}
      />
    </>
  );
}
