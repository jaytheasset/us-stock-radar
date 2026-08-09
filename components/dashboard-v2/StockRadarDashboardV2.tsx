"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  filterDashboardV2Rows,
  getDashboardV2FilterSections,
  sanitizeDashboardV2FilterState,
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
import { areAdsEnabledForPlan } from "@/lib/advertisingPolicy";
import type { Plan } from "@/lib/subscriptionPolicy";
import styles from "@/components/dashboard-v2/StockRadarDashboardV2.module.css";

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
  freshness?: "fresh" | "stale" | "finalizing" | "final" | "closed";
  marketSessionOpen?: boolean;
  message?: string;
  ok: boolean;
  reason: "ready" | "empty" | "session_unavailable" | "missing_key" | "upstream_error";
  receivedAt: string;
  refreshAfterSeconds?: number | null;
  rows: DashboardV2MarketMover[];
  stale?: boolean;
};

type MarketState = {
  asOf: string | null;
  freshness: FmpMarketMoversResponse["freshness"] | null;
  message?: string;
  receivedAt: string | null;
  rows: DashboardV2MarketMover[];
  status: MarketStatus;
  tab: DashboardV2Tab;
};

export function StockRadarDashboardV2({
  initialAuthenticated,
  initialSession,
  viewerPlan,
}: {
  initialAuthenticated: boolean;
  initialSession: DashboardV2Session;
  viewerPlan: Plan;
}) {
  const [activeMoverTab, setActiveMoverTab] = useState<DashboardV2Tab>("Top Gainers");
  const [activeSession, setActiveSession] = useState<DashboardV2Session>(initialSession);
  const [selectedTicker, setSelectedTicker] = useState<DashboardV2TickerDetail | null>(null);
  const [isMobileSheetOpen, setIsMobileSheetOpen] = useState(false);
  const [isMobileFilterSheetOpen, setIsMobileFilterSheetOpen] = useState(false);
  const [mobileSheetSection, setMobileSheetSection] = useState<MobileSheetSection>("summary");
  const [filterState, setFilterState] = useState(dashboardV2DefaultFilterState);
  const [marketState, setMarketState] = useState<MarketState>({
    asOf: null,
    freshness: null,
    receivedAt: null,
    rows: [],
    status: "loading",
    tab: "Top Gainers",
  });
  const mobileTickerOpenerRef = useRef<HTMLElement>(null);
  const mobileFilterTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    let refreshTimer: number | null = null;
    setMarketState({
      asOf: null,
      freshness: null,
      receivedAt: null,
      rows: [],
      status: "loading",
      tab: activeMoverTab,
    });

    function scheduleRefresh(seconds?: number | null) {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = null;
      if (!seconds || seconds <= 0 || controller.signal.aborted) return;

      refreshTimer = window.setTimeout(() => {
        if (document.visibilityState === "visible") {
          void loadMarketMovers(true);
        } else {
          scheduleRefresh(seconds);
        }
      }, seconds * 1000);
    }

    async function loadMarketMovers(isBackgroundRefresh = false) {
      try {
        const response = await fetch(
          `/api/dashboard-v2/movers?session=${encodeURIComponent(activeSession)}&mode=${fmpModeByMoverTab[activeMoverTab]}`,
          { cache: "no-store", signal: controller.signal },
        );
        const payload = (await response.json()) as FmpMarketMoversResponse;
        if (controller.signal.aborted) return;
        scheduleRefresh(payload.refreshAfterSeconds);

        if (!response.ok || !payload.ok || !payload.available) {
          if (isBackgroundRefresh) {
            setMarketState((current) =>
              current.status === "ready"
                ? {
                    ...current,
                    message:
                      payload.message ||
                      payload.error ||
                      "The latest refresh was unavailable. Showing the previous snapshot.",
                  }
                : current,
            );
            return;
          }
          setSelectedTicker(null);
          setMarketState({
            asOf: null,
            freshness: null,
            message: payload.message || payload.error || "Market data is unavailable.",
            receivedAt: payload.receivedAt || null,
            rows: [],
            status:
              payload.reason === "missing_key" || payload.reason === "session_unavailable"
                ? "unavailable"
                : "error",
            tab: activeMoverTab,
          });
          return;
        }

        if (!payload.rows.length) {
          setSelectedTicker(null);
          setMarketState({
            asOf: payload.asOf,
            freshness: payload.freshness || null,
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
          freshness: payload.freshness || null,
          message: payload.message,
          receivedAt: payload.receivedAt,
          rows: payload.rows,
          status: "ready",
          tab: activeMoverTab,
        });
        setFilterState((current) =>
          sanitizeDashboardV2FilterState(
            current,
            getDashboardV2FilterSections(payload.rows),
          ),
        );
      } catch {
        if (controller.signal.aborted) return;
        scheduleRefresh(60);
        if (isBackgroundRefresh) {
          setMarketState((current) =>
            current.status === "ready"
              ? {
                  ...current,
                  message: "The latest refresh was unavailable. Showing the previous snapshot.",
                }
              : current,
          );
          return;
        }
        setSelectedTicker(null);
        setMarketState({
          asOf: null,
          freshness: null,
          message: "Unable to load market data.",
          receivedAt: null,
          rows: [],
          status: "error",
          tab: activeMoverTab,
        });
      }
    }

    void loadMarketMovers();

    return () => {
      controller.abort();
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
    };
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
  const sourceRows = isCurrentState ? marketState.rows : [];
  const status = isCurrentState ? marketState.status : "loading";
  const statusMessage = isCurrentState ? marketState.message : undefined;
  const filterSections = useMemo(
    () => getDashboardV2FilterSections(sourceRows),
    [sourceRows],
  );
  const rows = useMemo(
    () => filterDashboardV2Rows(sourceRows, filterState),
    [filterState, sourceRows],
  );
  const adsEnabledForViewer = areAdsEnabledForPlan(viewerPlan);

  useEffect(() => {
    if (status !== "ready") return;
    setSelectedTicker((current) => {
      if (!rows.length) return null;
      const row = current
        ? rows.find((candidate) => candidate.ticker === current.ticker) || rows[0]
        : rows[0];
      return getDashboardV2TickerDetail(row);
    });
  }, [rows, status]);

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
              variant="marketsPrimary"
            />
            <SegmentedControl
              ariaLabel="Market session"
              items={marketSessionItems}
              onValueChange={setActiveSession}
              value={activeSession}
              variant="marketsCompact"
            />
          </div>
          <FilterBar
            filterState={filterState}
            isMobileFilterOpen={isMobileFilterSheetOpen}
            onChangeFilter={updateFilter}
            onClearFilters={clearFilters}
            onOpenMoreFilters={openMobileFilters}
            onResetFilter={resetFilter}
            sections={filterSections}
          />
          {status === "ready" ? (
            <>
              <p aria-live="polite" className={styles.filterResultCount}>
                Showing {rows.length} of {sourceRows.length} market movers
              </p>
              {rows.length ? (
                <MarketMoversTable
                  adsEnabledForViewer={adsEnabledForViewer}
                  mobileValueMode={activeMoverTab === "Top Volume" ? "volume" : "change"}
                  onOpenChart={(row) => openTickerDetail(row, "chart")}
                  onSelectRow={(row) => openTickerDetail(row, "summary")}
                  rows={rows}
                  selectedTicker={selectedTicker?.ticker}
                />
              ) : (
                <MarketDataState
                  message="No market movers match the selected filters."
                  status="empty"
                />
              )}
              <MarketTimestamp
                asOf={marketState.asOf}
                freshness={marketState.freshness}
                receivedAt={marketState.receivedAt}
                session={activeSession}
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
              <span>
                {status === "ready" && sourceRows.length
                  ? "Adjust the filters to select a market mover."
                  : "Market data is required before a ticker can be selected."}
              </span>
            </aside>
          )}
          {adsEnabledForViewer ? <DesktopRailAdSlot /> : null}
        </div>
      </div>
      {selectedTicker ? (
        <MobileTickerBottomSheet
          initialAuthenticated={initialAuthenticated}
          initialSection={mobileSheetSection}
          isOpen={isMobileSheetOpen}
          onClose={() => setIsMobileSheetOpen(false)}
          openerRef={mobileTickerOpenerRef}
          ticker={selectedTicker}
          viewerPlan={viewerPlan}
        />
      ) : null}
      <MobileFilterBottomSheet
        filterState={filterState}
        isOpen={isMobileFilterSheetOpen}
        onChangeFilter={updateFilter}
        onClearFilters={clearFilters}
        onClose={() => setIsMobileFilterSheetOpen(false)}
        openerRef={mobileFilterTriggerRef}
        sections={filterSections}
      />
    </>
  );
}

function MarketDataState({ message, status }: { message?: string; status: MarketStatus }) {
  const copy =
    status === "loading"
      ? "Loading market movers…"
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

function MarketTimestamp({
  asOf,
  freshness,
  receivedAt,
  session,
}: {
  asOf: string | null;
  freshness: FmpMarketMoversResponse["freshness"] | null;
  receivedAt: string | null;
  session: DashboardV2Session;
}) {
  const value = asOf || receivedAt;
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;

  return (
    <p className={styles.marketTimestamp}>
      {marketTimestampLabel(freshness, session, Boolean(asOf))}{" "}
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

function marketTimestampLabel(
  freshness: FmpMarketMoversResponse["freshness"] | null,
  session: DashboardV2Session,
  hasProviderTimestamp: boolean,
) {
  const sessionLabel =
    session === "Pre"
      ? "pre-market"
      : session === "After"
        ? "after-hours"
        : "regular-session";
  if (freshness === "final") return `Final ${sessionLabel} snapshot`;
  if (freshness === "finalizing") return `Finalizing ${sessionLabel} snapshot`;
  if (freshness === "stale") return `Last successful ${sessionLabel} snapshot`;
  if (freshness === "closed") return `Latest ${sessionLabel} snapshot`;
  return hasProviderTimestamp ? "Market data as of" : "Market data received";
}
