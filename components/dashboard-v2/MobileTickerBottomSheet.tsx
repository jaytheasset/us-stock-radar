"use client";

import { useEffect, useRef, type RefObject } from "react";
import { MarketsPreviewActions } from "@/components/dashboard-v2/MarketsPreviewActions";
import { TickerDetailContent } from "@/components/dashboard-v2/TickerDetailContent";
import { FeedPreviewAd } from "@/components/feed-v2/FeedMobilePreviewAd";
import { BottomSheetShell } from "@/components/ui/BottomSheetShell";
import type { DashboardV2TickerDetail } from "@/lib/dashboardV2Types";
import type { Plan } from "@/lib/subscriptionPolicy";

export type MobileSheetSection = "summary" | "chart";

type MobileTickerBottomSheetProps = {
  initialAuthenticated: boolean;
  initialSection: MobileSheetSection;
  isOpen: boolean;
  onClose: () => void;
  openerRef: RefObject<HTMLElement | null>;
  ticker: DashboardV2TickerDetail;
  viewerPlan: Plan;
};

export function MobileTickerBottomSheet({
  initialAuthenticated,
  initialSection,
  isOpen,
  onClose,
  openerRef,
  ticker,
  viewerPlan,
}: MobileTickerBottomSheetProps) {
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

    requestAnimationFrame(() => {
      const target = initialSection === "chart" ? chartRef.current : summaryRef.current;
      target?.scrollIntoView({ block: "start" });
    });
  }, [initialSection, isOpen, ticker.ticker]);

  return (
    <BottomSheetShell
      aria-labelledby={titleId}
      closeLabel="Close ticker detail"
      isOpen={isOpen}
      layout="full-scroll"
      onDismiss={onClose}
      openerRef={openerRef}
      overlayLabel="Close ticker detail overlay"
      showCloseButton
      showHandle
      topControls={
        <MarketsPreviewActions
          initialAuthenticated={initialAuthenticated}
          isOpen={isOpen}
          ticker={ticker}
        />
      }
      viewport="mobile"
    >
      <TickerDetailContent
        mobileSheetHeader
        ticker={ticker}
        titleId={titleId}
        sectionRefs={{ summary: summaryRef, chart: chartRef }}
      />
      {viewerPlan === "free" ? <FeedPreviewAd size="320x100" /> : null}
    </BottomSheetShell>
  );
}
