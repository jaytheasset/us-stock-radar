"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { TickerDetailContent } from "@/components/dashboard-v2/TickerDetailContent";
import type { DashboardV2TickerDetail } from "@/lib/mock/dashboardV2Data";

export type MobileSheetSection = "summary" | "chart";

type MobileTickerBottomSheetProps = {
  initialSection: MobileSheetSection;
  isOpen: boolean;
  onClose: () => void;
  ticker: DashboardV2TickerDetail;
};

export function MobileTickerBottomSheet({
  initialSection,
  isOpen,
  onClose,
  ticker,
}: MobileTickerBottomSheetProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const titleId = `dashboard-v2-mobile-sheet-title-${ticker.ticker}`;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const mobileQuery = window.matchMedia("(max-width: 760px)");
    if (!mobileQuery.matches) {
      return;
    }

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus({ preventScroll: true });

    requestAnimationFrame(() => {
      const target = initialSection === "chart" ? chartRef.current : summaryRef.current;
      target?.scrollIntoView({ block: "start" });
    });

    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [initialSection, isOpen, ticker.ticker]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="dashboard-v2-mobile-sheet-root"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          onClose();
        }
      }}
    >
      <button
        className="dashboard-v2-mobile-sheet-overlay"
        type="button"
        aria-label="Close ticker detail overlay"
        onClick={onClose}
      />
      <aside
        className="dashboard-v2-mobile-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="dashboard-v2-mobile-sheet-handle" aria-hidden="true" />
        <button
          className="dashboard-v2-mobile-sheet-close"
          type="button"
          aria-label="Close ticker detail"
          onClick={onClose}
          ref={closeButtonRef}
        >
          <X aria-hidden="true" size={20} />
        </button>
        <TickerDetailContent
          ticker={ticker}
          titleId={titleId}
          sectionRefs={{ summary: summaryRef, chart: chartRef }}
        />
      </aside>
    </div>
  );
}
