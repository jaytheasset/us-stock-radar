"use client";

import { useCallback, useRef, useState } from "react";
import { FilterBar } from "@/components/dashboard-v2/FilterBar";
import { MarketMoversTable } from "@/components/dashboard-v2/MarketMoversTable";
import { MobileFilterBottomSheet } from "@/components/dashboard-v2/MobileFilterBottomSheet";
import {
  MobileTickerBottomSheet,
  type MobileSheetSection,
} from "@/components/dashboard-v2/MobileTickerBottomSheet";
import { TickerDetailPanel } from "@/components/dashboard-v2/TickerDetailPanel";
import {
  SegmentedControl,
  type SegmentedControlItem,
} from "@/components/ui/SegmentedControl";
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

const marketMoverItems: readonly SegmentedControlItem<DashboardV2Tab>[] = dashboardV2Tabs.map(
  (item) => ({ label: item.toUpperCase(), value: item }),
);

const marketSessionItems: readonly SegmentedControlItem<DashboardV2Session>[] =
  dashboardV2Sessions.map((item) => ({ label: item.toUpperCase(), value: item }));

export function StockRadarDashboardV2() {
  const [activeMoverTab, setActiveMoverTab] = useState<DashboardV2Tab>("Top Gainers");
  const [activeSession, setActiveSession] = useState<DashboardV2Session>("Regular");
  const [selectedTicker, setSelectedTicker] = useState(dashboardV2SelectedTicker);
  const [isMobileSheetOpen, setIsMobileSheetOpen] = useState(false);
  const [isMobileFilterSheetOpen, setIsMobileFilterSheetOpen] = useState(false);
  const [mobileSheetSection, setMobileSheetSection] = useState<MobileSheetSection>("summary");
  const [filterState, setFilterState] = useState(dashboardV2DefaultFilterState);
  const mobileFilterTriggerRef = useRef<HTMLButtonElement>(null);
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
  const openMobileFilters = useCallback((trigger: HTMLButtonElement) => {
    mobileFilterTriggerRef.current = trigger;
    setIsMobileFilterSheetOpen(true);
  }, []);
  const closeMobileFilters = useCallback(() => {
    setIsMobileFilterSheetOpen(false);
    requestAnimationFrame(() => mobileFilterTriggerRef.current?.focus({ preventScroll: true }));
  }, []);

  return (
    <>
      <div className={styles.workspace}>
        <section className="dashboard-v2-left" aria-label="Market movers dashboard">
          <div className="dashboard-v2-control-row">
            <SegmentedControl
              ariaLabel="Market mover category"
              items={marketMoverItems}
              onValueChange={setActiveMoverTab}
              value={activeMoverTab}
            />
            <SegmentedControl
              ariaLabel="Market session"
              items={marketSessionItems}
              onValueChange={setActiveSession}
              value={activeSession}
              variant="compact"
            />
          </div>
          <FilterBar
            filterState={filterState}
            filters={dashboardV2Filters}
            isMobileFilterOpen={isMobileFilterSheetOpen}
            onOpenMoreFilters={openMobileFilters}
            onResetFilter={resetFilter}
          />
          <MarketMoversTable
            mobileValueMode={activeMoverTab === "Top Volume" ? "volume" : "change"}
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
        onClose={closeMobileFilters}
      />
    </>
  );
}
