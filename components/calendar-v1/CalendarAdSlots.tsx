"use client";

import { type ReactNode, useEffect, useRef } from "react";
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
  activeEventId,
  children,
  enabledForViewer,
}: {
  activeEventId: string | null;
  children: ReactNode;
  enabledForViewer: boolean;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const detailAnchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (
      !enabledForViewer ||
      !activeEventId ||
      window.matchMedia("(max-width: 1180px)").matches
    ) {
      return;
    }
    const rail = railRef.current;
    const detailAnchor = detailAnchorRef.current;
    if (!rail || !detailAnchor) return;
    rail.scrollTop = detailAnchor.offsetTop;
  }, [activeEventId, enabledForViewer]);

  return (
    <div
      className={styles.rail}
      data-ads-enabled={enabledForViewer}
      data-calendar-desktop-rail=""
      ref={railRef}
    >
      {enabledForViewer ? (
        <CalendarRailAd inventory="calendar-rail-top" position="top" />
      ) : null}
      <div className={styles.detailAnchor} ref={detailAnchorRef}>
        {children}
      </div>
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
