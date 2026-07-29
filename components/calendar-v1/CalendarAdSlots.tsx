"use client";

import { AdSenseSlot } from "@/components/ads/AdSenseSlot";
import styles from "./CalendarAdSlots.module.css";

export function CalendarAdSlots({
  enabledForViewer,
}: {
  enabledForViewer: boolean;
}) {
  if (!enabledForViewer) return null;

  return (
    <section aria-label="Calendar advertising">
      <div className={styles.desktop}>
        <AdSenseSlot
          enabledForViewer={enabledForViewer}
          format="horizontal"
          height={90}
          inventory="calendar-desktop-inline"
          mediaQuery="(min-width: 1181px)"
          placeholderSize="970 × 90"
          width={970}
        />
      </div>
      <div className={styles.mobile}>
        <AdSenseSlot
          enabledForViewer={enabledForViewer}
          format="fixed"
          height={50}
          inventory="calendar-mobile-inline"
          mediaQuery="(max-width: 1180px)"
          placeholderSize="320 × 50"
          width={320}
        />
      </div>
    </section>
  );
}
