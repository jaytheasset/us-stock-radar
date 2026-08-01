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
  onContentHeightChange,
}: {
  activeEventId: string | null;
  children: ReactNode;
  enabledForViewer: boolean;
  onContentHeightChange: (height: number) => void;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const railScrollProgressRef = useRef(0);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;

    const desktopRailQuery = window.matchMedia("(min-width: 1181px)");
    let animationFrameId: number | null = null;

    const reportContentHeight = () => {
      animationFrameId = null;
      onContentHeightChange(
        desktopRailQuery.matches ? Math.ceil(rail.scrollHeight) : 0,
      );
    };
    const scheduleContentHeightReport = () => {
      if (animationFrameId !== null) return;
      animationFrameId = window.requestAnimationFrame(reportContentHeight);
    };

    const resizeObserver = new ResizeObserver(scheduleContentHeightReport);
    resizeObserver.observe(rail);
    for (const child of rail.children) {
      resizeObserver.observe(child);
    }

    const mutationObserver = new MutationObserver(scheduleContentHeightReport);
    mutationObserver.observe(rail, { childList: true, subtree: true });
    window.addEventListener("resize", scheduleContentHeightReport, {
      passive: true,
    });
    scheduleContentHeightReport();

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", scheduleContentHeightReport);
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }
    };
  }, [onContentHeightChange]);

  useEffect(() => {
    railScrollProgressRef.current = 0;
    if (!activeEventId || window.matchMedia("(max-width: 1180px)").matches) return;

    const rail = railRef.current;
    if (!rail) return;

    rail.scrollTo({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      top: 0,
    });
  }, [activeEventId]);

  useEffect(() => {
    const desktopRailQuery = window.matchMedia("(min-width: 1181px)");
    let previousPageScrollY = window.scrollY;
    let pendingScrollDelta = 0;
    let animationFrameId: number | null = null;

    const syncRailToPageScroll = () => {
      animationFrameId = null;

      const rail = railRef.current;
      const scrollDelta = pendingScrollDelta;
      pendingScrollDelta = 0;

      if (!desktopRailQuery.matches) {
        railScrollProgressRef.current = 0;
        return;
      }
      if (!rail) return;

      if (window.scrollY <= 0) {
        railScrollProgressRef.current = 0;
        rail.scrollTo({ behavior: "auto", top: 0 });
        return;
      }
      if (scrollDelta === 0) return;

      const stickyTop = Number.parseFloat(window.getComputedStyle(rail).top) || 0;
      if (rail.getBoundingClientRect().top > stickyTop + 1) return;

      const maxScrollTop = Math.max(rail.scrollHeight - rail.clientHeight, 0);
      railScrollProgressRef.current = Math.min(
        maxScrollTop,
        Math.max(0, railScrollProgressRef.current + scrollDelta),
      );
      rail.scrollTo({
        behavior: "auto",
        top: railScrollProgressRef.current,
      });
    };

    const handlePageScroll = () => {
      const currentScrollY = window.scrollY;
      pendingScrollDelta += currentScrollY - previousPageScrollY;
      previousPageScrollY = currentScrollY;

      if (animationFrameId === null) {
        animationFrameId = window.requestAnimationFrame(syncRailToPageScroll);
      }
    };

    window.addEventListener("scroll", handlePageScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handlePageScroll);
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }
    };
  }, []);

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
      <div className={styles.detailAnchor}>{children}</div>
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
