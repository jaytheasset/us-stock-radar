"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DesktopRailAdSlot } from "@/components/dashboard-v2/DesktopRailAdSlot";
import { FilterBar } from "@/components/dashboard-v2/FilterBar";
import { MarketMoversTable } from "@/components/dashboard-v2/MarketMoversTable";
import { MobileFilterBottomSheet } from "@/components/dashboard-v2/MobileFilterBottomSheet";
import {
  MobileTickerBottomSheet,
  type MobileSheetSection,
} from "@/components/dashboard-v2/MobileTickerBottomSheet";
import { TickerDetailPanel } from "@/components/dashboard-v2/TickerDetailPanel";
import {
  dashboardV2AllFilterValue,
  dashboardV2DefaultFilterState,
  type DashboardV2FilterKey,
} from "@/components/dashboard-v2/dashboardV2FilterConfig";
import {
  SegmentedControl,
  type SegmentedControlItem,
} from "@/components/ui/SegmentedControl";
import {
  dashboardV2Sessions,
  dashboardV2Tabs,
  getDashboardV2TickerDetail,
  type DashboardV2MarketMover,
  type DashboardV2Session,
  type DashboardV2Tab,
  type DashboardV2TickerDetail,
} from "@/lib/dashboardV2Types";
import styles from "@/components/dashboard-v2/StockRadarDashboardV2.module.css";

const dashboardFilters = [
  { label: "Market Cap", value: "All" },
  { label: "Price", value: "All" },
  { label: "Volume", value: "All" },
  { label: "Event Type", value: "All" },
  { label: "Signal", value: "All" },
];

const marketMoverItems: readonly SegmentedControlItem<DashboardV2Tab>[] = dashboardV2Tabs.map(
  (item) => ({ label: item.toUpperCase(), value: item }),
);
const marketSessionItems: readonly SegmentedControlItem<DashboardV2Session>[] =
  dashboardV2Sessions.map((item) => ({ label: item.toUpperCase(), value: item }));

const fmpModeByMoverTab: Record<DashboardV2Tab, "gainers" | "losers" | "volume"> = {
  "Top Gainers": "gainers",
  "Top Losers": "losers",
  "Top Volume": "volume",
};

type MarketStatus = "loading" | "ready" | "empty" | "unavailable" | "error";

type FmpMarketMoversResponse = {
  asOf: string | null;
  available: boolean;
  error?: string;
  ok: boolean;
  reason: "ready" | "empty" | "session_unavailable" | "missing_key" | "upstream_error";
  receivedAt: string;
  rows: DashboardV2MarketMover[];
};

type MarketState = {
  asOf: string | null;
  message?: string;
  receivedAt: string | null;
  rows: DashboardV2MarketMover[];
  status: MarketStatus;
  tab: DashboardV2Tab;
};

export function StockRadarDashboardV2() {
  const [activeMoverTab, setActiveMoverTab] = useState<DashboardV2Tab>("Top Gainers");
  const [activeSession, setActiveSession] = useState<DashboardV2Session>("Regular");
  const [selectedTicker, setSelectedTicker] = useState<DashboardV2TickerDetail | null>(null);
  const [isMobileSheetOpen, setIsMobileSheetOpen] = useState(false);
  const [isMobileFilterSheetOpen, setIsMobileFilterSheetOpen] = useState(false);
  const [mobileSheetSection, setMobileSheetSection] = useState<MobileSheetSection>("summary");
  const [filterState, setFilterState] = useState(dashboardV2DefaultFilterState);
  const [marketState, setMarketState] = useState<MarketState>({
    asOf: null,
    receivedAt: null,
    rows: [],
    status: "loading",
    tab: "Top Gainers",
  });
  const mobileTickerOpenerRef = useRef<HTMLElement>(null);
  const mobileFilterTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (activeSession !== "Regular") {
      setSelectedTicker(null);
      setMarketState({
        asOf: null,
        message: `${activeSession}-market rankings are unavailable from the configured FMP feed.`,
        receivedAt: null,
        rows: [],
        status: "unavailable",
        tab: activeMoverTab,
      });
      return;
    }

    const controller = new AbortController();
    setMarketState({
      asOf: null,
      receivedAt: null,
      rows: [],
      status: "loading",
      tab: activeMoverTab,
    });

    async function loadMarketMovers() {
      try {
        const response = await fetch(
          `/api/dashboard-v2/movers?session=Regular&mode=${fmpModeByMoverTab[activeMoverTab]}`,
          { cache: "no-store", signal: controller.signal },
        );
        const payload = (await response.json()) as FmpMarketMoversResponse;
        if (controller.signal.aborted) return;

        if (!response.ok || !payload.ok || !payload.available) {
          setSelectedTicker(null);
          setMarketState({
            asOf: null,
            message: payload.error || "FMP market data is unavailable.",
            receivedAt: payload.receivedAt || null,
            rows: [],
            status: payload.reason === "missing_key" ? "unavailable" : "error",
            tab: activeMoverTab,
          });
          return;
        }

        if (!payload.rows.length) {
          setSelectedTicker(null);
          setMarketState({
            asOf: payload.asOf,
            message: "FMP returned no market movers for this view.",
            receivedAt: payload.receivedAt,
            rows: [],
            status: "empty",
            tab: activeMoverTab,
          });
          return;
        }

        setMarketState({
          asOf: payload.asOf,
          receivedAt: payload.receivedAt,
          rows: payload.rows,
          status: "ready",
          tab: activeMoverTab,
        });
        setSelectedTicker((current) => {
          const currentRow = current
            ? payload.rows.find((row) => row.ticker === current.ticker)
            : undefined;
          return getDashboardV2TickerDetail(currentRow || payload.rows[0]);
        });
      } catch {
        if (controller.signal.aborted) return;
        setSelectedTicker(null);
        setMarketState({
          asOf: null,
          message: "Unable to load FMP market data.",
          receivedAt: null,
          rows: [],
          status: "error",
          tab: activeMoverTab,
        });
      }
    }

    void loadMarketMovers();
    return () => controller.abort();
  }, [activeMoverTab, activeSession]);

  const openTickerDetail = useCallback(
    (row: DashboardV2MarketMover, section: MobileSheetSection) => {
      setSelectedTicker(getDashboardV2TickerDetail(row));
      setMobileSheetSection(section);

      if (window.matchMedia("(max-width: 760px)").matches) {
        mobileTickerOpenerRef.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setIsMobileFilterSheetOpen(false);
        setIsMobileSheetOpen(true);
      }
    },
    [],
  );
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
    setIsMobileSheetOpen(false);
    setIsMobileFilterSheetOpen(true);
  }, []);

  const isCurrentState = marketState.tab === activeMoverTab;
  const rows = isCurrentState ? marketState.rows : [];
  const status = isCurrentState ? marketState.status : "loading";
  const statusMessage = isCurrentState ? marketState.message : undefined;

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
            filters={dashboardFilters}
            isMobileFilterOpen={isMobileFilterSheetOpen}
            onOpenMoreFilters={openMobileFilters}
            onResetFilter={resetFilter}
          />
          {status === "ready" ? (
            <>
              <MarketMoversTable
                mobileValueMode={activeMoverTab === "Top Volume" ? "volume" : "change"}
                onOpenChart={(row) => openTickerDetail(row, "chart")}
                onSelectRow={(row) => openTickerDetail(row, "summary")}
                rows={rows}
                selectedTicker={selectedTicker?.ticker}
              />
              <MarketTimestamp
                asOf={marketState.asOf}
                receivedAt={marketState.receivedAt}
              />
            </>
          ) : (
            <MarketDataState message={statusMessage} status={status} />
          )}
        </section>
        <div className={styles.rightRail}>
          {selectedTicker ? (
            <TickerDetailPanel ticker={selectedTicker} />
          ) : (
            <aside className={styles.detailState} aria-label="Ticker detail availability">
              <strong>Ticker detail unavailable</strong>
              <span>Live FMP data is required before a ticker can be selected.</span>
            </aside>
          )}
          <DesktopRailAdSlot />
        </div>
      </div>
      {selectedTicker ? (
        <MobileTickerBottomSheet
          initialSection={mobileSheetSection}
          isOpen={isMobileSheetOpen}
          onClose={() => setIsMobileSheetOpen(false)}
          openerRef={mobileTickerOpenerRef}
          ticker={selectedTicker}
        />
      ) : null}
      <MobileFilterBottomSheet
        filterState={filterState}
        isOpen={isMobileFilterSheetOpen}
        onChangeFilter={updateFilter}
        onClearFilters={clearFilters}
        onClose={() => setIsMobileFilterSheetOpen(false)}
        openerRef={mobileFilterTriggerRef}
      />
    </>
  );
}

function MarketDataState({ message, status }: { message?: string; status: MarketStatus }) {
  const copy =
    status === "loading"
      ? "Loading FMP market movers…"
      : message || (status === "empty" ? "No market movers returned." : "Market data unavailable.");

  return (
    <section
      aria-live="polite"
      aria-label="Market data status"
      className={styles.marketState}
      data-status={status}
    >
      <strong>{status === "loading" ? "Loading market data" : status === "empty" ? "No results" : "Market data unavailable"}</strong>
      <span>{copy}</span>
    </section>
  );
}

function MarketTimestamp({ asOf, receivedAt }: { asOf: string | null; receivedAt: string | null }) {
  const value = asOf || receivedAt;
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;

  return (
    <p className={styles.marketTimestamp}>
      {asOf ? "Market data as of" : "Market data received"}{" "}
      <time dateTime={date.toISOString()}>
        {new Intl.DateTimeFormat("en-US", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "America/New_York",
        }).format(date)}{" "}
        ET
      </time>
    </p>
  );
}
