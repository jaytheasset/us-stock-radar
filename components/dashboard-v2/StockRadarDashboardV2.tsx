"use client";

import { useCallback, useState } from "react";
import { DashboardHeader } from "@/components/dashboard-v2/DashboardHeader";
import { FilterBar } from "@/components/dashboard-v2/FilterBar";
import { MarketMoversTable } from "@/components/dashboard-v2/MarketMoversTable";
import { MobileFilterBottomSheet } from "@/components/dashboard-v2/MobileFilterBottomSheet";
import {
  MobileTickerBottomSheet,
  type MobileSheetSection,
} from "@/components/dashboard-v2/MobileTickerBottomSheet";
import { SegmentedTabs } from "@/components/dashboard-v2/SegmentedTabs";
import { TickerDetailPanel } from "@/components/dashboard-v2/TickerDetailPanel";
import {
  dashboardV2AllFilterValue,
  dashboardV2DefaultFilterState,
  type DashboardV2FilterKey,
} from "@/components/dashboard-v2/dashboardV2FilterConfig";
import styles from "@/components/dashboard-v2/StockRadarDashboardV2.module.css";
import {
  dashboardV2Filters,
  dashboardV2MarketMoversByTab,
  dashboardV2SelectedTicker,
  dashboardV2Sessions,
  dashboardV2Tabs,
  getDashboardV2TickerDetail,
  type DashboardV2MarketMover,
  type DashboardV2Session,
  type DashboardV2Tab,
} from "@/lib/mock/dashboardV2Data";

export function StockRadarDashboardV2() {
  const [activeMoverTab, setActiveMoverTab] = useState<DashboardV2Tab>("Top Gainers");
  const [activeSession, setActiveSession] = useState<DashboardV2Session>("Regular");
  const [selectedTicker, setSelectedTicker] = useState(dashboardV2SelectedTicker);
  const [isMobileSheetOpen, setIsMobileSheetOpen] = useState(false);
  const [isMobileFilterSheetOpen, setIsMobileFilterSheetOpen] = useState(false);
  const [mobileSheetSection, setMobileSheetSection] = useState<MobileSheetSection>("summary");
  const [filterState, setFilterState] = useState(dashboardV2DefaultFilterState);
  const marketMoverRows = dashboardV2MarketMoversByTab[activeMoverTab];
  const openTickerDetail = useCallback((row: DashboardV2MarketMover, section: MobileSheetSection) => {
    setSelectedTicker(getDashboardV2TickerDetail(row));
    setMobileSheetSection(section);

    if (window.matchMedia("(max-width: 760px)").matches) {
      setIsMobileSheetOpen(true);
    }
  }, []);
  const updateFilter = useCallback((key: DashboardV2FilterKey, value: string) => {
    setFilterState((current) => ({ ...current, [key]: value }));
  }, []);
  const resetFilter = useCallback((key: DashboardV2FilterKey) => {
    setFilterState((current) => ({ ...current, [key]: dashboardV2AllFilterValue }));
  }, []);
  const clearFilters = useCallback(() => {
    setFilterState({ ...dashboardV2DefaultFilterState });
  }, []);

  return (
    <main className={`dashboard-v2-page ${styles.root}`}>
      <DashboardHeader />
      <div className="dashboard-v2-workspace">
        <section className="dashboard-v2-left" aria-label="Market movers dashboard">
          <div className="dashboard-v2-control-row">
            <SegmentedTabs
              active={activeMoverTab}
              ariaLabel="Market mover category"
              items={dashboardV2Tabs}
              onSelect={(item) => setActiveMoverTab(item as DashboardV2Tab)}
            />
            <SegmentedTabs
              active={activeSession}
              ariaLabel="Market session"
              items={dashboardV2Sessions}
              onSelect={(item) => setActiveSession(item as DashboardV2Session)}
              variant="session"
            />
          </div>
          <FilterBar
            filterState={filterState}
            filters={dashboardV2Filters}
            onOpenMoreFilters={() => setIsMobileFilterSheetOpen(true)}
            onResetFilter={resetFilter}
          />
          <MarketMoversTable
            onOpenChart={(row) => openTickerDetail(row, "chart")}
            onSelectRow={(row) => openTickerDetail(row, "summary")}
            rows={marketMoverRows}
            selectedTicker={selectedTicker.ticker}
          />
        </section>
        <TickerDetailPanel ticker={selectedTicker} />
      </div>
      <MobileTickerBottomSheet
        initialSection={mobileSheetSection}
        isOpen={isMobileSheetOpen}
        onClose={() => setIsMobileSheetOpen(false)}
        ticker={selectedTicker}
      />
      <MobileFilterBottomSheet
        filterState={filterState}
        isOpen={isMobileFilterSheetOpen}
        onChangeFilter={updateFilter}
        onClearFilters={clearFilters}
        onClose={() => setIsMobileFilterSheetOpen(false)}
      />
    </main>
  );
}
