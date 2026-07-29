"use client";

import type { ReactNode } from "react";
import { AdSenseSlot } from "@/components/ads/AdSenseSlot";
import styles from "./CalendarAdSlots.module.css";

export function CalendarMobileAdSlot({
  enabledForViewer,
}: {
  enabledForViewer: boolean;
}) {
  if (!enabledForViewer) return null;

  return (
    <section
      aria-label="Calendar mobile advertising"
      className={styles.mobile}
      data-calendar-mobile-ad=""
    >
      <AdSenseSlot
        enabledForViewer={enabledForViewer}
        format="fixed"
        height={50}
        inventory="calendar-mobile-inline"
        mediaQuery="(max-width: 1180px)"
        placeholderSize="320 × 50"
        width={320}
      />
    </section>
  );
}

export function CalendarDesktopRail({
  children,
  enabledForViewer,
}: {
  children: ReactNode;
  enabledForViewer: boolean;
}) {
  return (
    <div
      className={styles.rail}
      data-ads-enabled={enabledForViewer}
      data-calendar-desktop-rail=""
    >
      {enabledForViewer ? (
        <CalendarRailAd inventory="calendar-rail-top" position="top" />
      ) : null}
      {children}
      {enabledForViewer ? (
        <CalendarRailAd inventory="calendar-rail-bottom" position="bottom" />
      ) : null}
    </div>
  );
}

function CalendarRailAd({
  inventory,
  position,
}: {
  inventory: "calendar-rail-top" | "calendar-rail-bottom";
  position: "top" | "bottom";
}) {
  return (
    <section
      aria-label={`Calendar ${position} rail advertising`}
      className={styles.desktopRailAd}
      data-calendar-rail-ad={position}
    >
      <AdSenseSlot
        format="responsive"
        height={250}
        inventory={inventory}
        mediaQuery="(min-width: 1181px)"
        placeholderSize="Responsive display · 336 × 250 minimum"
        width={336}
      />
    </section>
  );
}
