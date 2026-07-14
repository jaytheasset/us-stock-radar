"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { TickerDetailContent } from "@/components/dashboard-v2/TickerDetailContent";
import { BottomSheetShell } from "@/components/ui/BottomSheetShell";
import type { DashboardV2TickerDetail } from "@/lib/mock/dashboardV2Data";

export type MobileSheetSection = "summary" | "chart";

type MobileTickerBottomSheetProps = {
  initialSection: MobileSheetSection;
  isOpen: boolean;
  onClose: () => void;
  openerRef: RefObject<HTMLElement | null>;
  ticker: DashboardV2TickerDetail;
};

export function MobileTickerBottomSheet({
  initialSection,
  isOpen,
  onClose,
  openerRef,
  ticker,
}: MobileTickerBottomSheetProps) {
  const summaryRef = useRef<HTMLElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const titleId = `dashboard-v2-mobile-sheet-title-${ticker.ticker}`;
  const [favorites, setFavorites] = useState<ReadonlySet<string>>(() => new Set());
  const isFavorite = favorites.has(ticker.ticker);

  const toggleFavorite = () => {
    setFavorites((currentFavorites) => {
      const nextFavorites = new Set(currentFavorites);

      if (nextFavorites.has(ticker.ticker)) {
        nextFavorites.delete(ticker.ticker);
      } else {
        nextFavorites.add(ticker.ticker);
      }

      return nextFavorites;
    });
  };

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
    >
      <TickerDetailContent
        mobileSheetHeader={{ isFavorite, onToggleFavorite: toggleFavorite }}
        ticker={ticker}
        titleId={titleId}
        sectionRefs={{ summary: summaryRef, chart: chartRef }}
      />
    </BottomSheetShell>
  );
}
