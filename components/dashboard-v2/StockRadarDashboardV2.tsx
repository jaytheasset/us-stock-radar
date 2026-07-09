"use client";

import { useState } from "react";
import { DashboardHeader } from "@/components/dashboard-v2/DashboardHeader";
import { FilterBar } from "@/components/dashboard-v2/FilterBar";
import { MarketMoversTable } from "@/components/dashboard-v2/MarketMoversTable";
import { SegmentedTabs } from "@/components/dashboard-v2/SegmentedTabs";
import { TickerDetailPanel } from "@/components/dashboard-v2/TickerDetailPanel";
import styles from "@/components/dashboard-v2/StockRadarDashboardV2.module.css";
import {
  dashboardV2Filters,
  dashboardV2MarketMoversByTab,
  dashboardV2SelectedTicker,
  dashboardV2Sessions,
  dashboardV2Tabs,
  type DashboardV2Session,
  type DashboardV2Tab,
} from "@/lib/mock/dashboardV2Data";

export function StockRadarDashboardV2() {
  const [activeMoverTab, setActiveMoverTab] = useState<DashboardV2Tab>("Top Gainers");
  const [activeSession, setActiveSession] = useState<DashboardV2Session>("Regular");
  const marketMoverRows = dashboardV2MarketMoversByTab[activeMoverTab];

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
          <FilterBar filters={dashboardV2Filters} />
          <MarketMoversTable rows={marketMoverRows} />
        </section>
        <TickerDetailPanel ticker={dashboardV2SelectedTicker} />
      </div>
    </main>
  );
}
