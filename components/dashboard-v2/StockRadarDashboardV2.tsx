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
import {
  getDashboardV2MoversRequest,
  resolveDashboardV2MoverObservation,
  type DashboardV2MoverObservation,
  type DashboardV2MoverRequestState,
  type DashboardV2MoversApiResponse,
} from "@/lib/dashboardV2MoverObservation";
import { areAdsEnabledForPlan } from "@/lib/advertisingPolicy";
import type { Plan } from "@/lib/subscriptionPolicy";
import styles from "@/components/dashboard-v2/StockRadarDashboardV2.module.css";

const marketMoverItems: readonly SegmentedControlItem<DashboardV2Tab>[] = dashboardV2Tabs.map(
  (item) => ({ label: item.toUpperCase(), value: item }),
);
const marketSessionItems: readonly SegmentedControlItem<DashboardV2Session>[] =
  dashboardV2Sessions.map((item) => ({ label: item.toUpperCase(), value: item }));

type MarketState = {
  httpStatus: number | null;
  requestState: DashboardV2MoverRequestState;
  response?: DashboardV2MoversApiResponse;
  rows: DashboardV2MarketMover[];
  session: DashboardV2Session;
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
    httpStatus: null,
    requestState: "loading",
    rows: [],
    session: initialSession,
    tab: "Top Gainers",
  });
  const mobileTickerOpenerRef = useRef<HTMLElement>(null);
  const mobileFilterTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    let refreshTimer: number | null = null;
    setMarketState({
      httpStatus: null,
      requestState: "loading",
      rows: [],
      session: activeSession,
      tab: activeMoverTab,
    });
    const request = getDashboardV2MoversRequest(activeMoverTab, activeSession);

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
        const response = await fetch(request.href, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json()) as DashboardV2MoversApiResponse;
        if (controller.signal.aborted) return;
        scheduleRefresh(payload.refreshAfterSeconds);

        if (!response.ok || !payload.ok || !payload.available) {
          if (isBackgroundRefresh) return;
          setSelectedTicker(null);
          setMarketState({
            httpStatus: response.status,
            requestState: "received",
            response: payload,
            rows: [],
            session: activeSession,
            tab: activeMoverTab,
          });
          return;
        }

        setMarketState({
          httpStatus: response.status,
          requestState: "received",
          response: payload,
          rows: Array.isArray(payload.rows) ? payload.rows : [],
          session: activeSession,
          tab: activeMoverTab,
        });
        if (payload.reason === "ready" && payload.rows.length) {
          setFilterState((current) =>
            sanitizeDashboardV2FilterState(
              current,
              getDashboardV2FilterSections(payload.rows),
            ),
          );
        } else {
          setSelectedTicker(null);
        }
      } catch {
        if (controller.signal.aborted) return;
        scheduleRefresh(60);
        if (isBackgroundRefresh) return;
        setSelectedTicker(null);
        setMarketState({
          httpStatus: null,
          requestState: "failed",
          rows: [],
          session: activeSession,
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

  const isCurrentState =
    marketState.tab === activeMoverTab && marketState.session === activeSession;
  const sourceRows = isCurrentState ? marketState.rows : [];
  const filterSections = useMemo(
    () => getDashboardV2FilterSections(sourceRows),
    [sourceRows],
  );
  const rows = useMemo(
    () => filterDashboardV2Rows(sourceRows, filterState),
    [filterState, sourceRows],
  );
  const observation = resolveDashboardV2MoverObservation({
    httpStatus: isCurrentState ? marketState.httpStatus : null,
    moverTab: activeMoverTab,
    renderedResultCount: rows.length,
    requestState: isCurrentState ? marketState.requestState : "loading",
    response: isCurrentState ? marketState.response : undefined,
    session: activeSession,
  });
  const adsEnabledForViewer = areAdsEnabledForPlan(viewerPlan);

  useEffect(() => {
    if (observation.status !== "ready") return;
    setSelectedTicker((current) => {
      if (!rows.length) return null;
      const row = current
        ? rows.find((candidate) => candidate.ticker === current.ticker) || rows[0]
        : rows[0];
      return getDashboardV2TickerDetail(row);
    });
  }, [observation.status, rows]);

  return (
    <>
      <div className={styles.workspace}>
        <section
          aria-busy={observation.status === "loading"}
          aria-label="Market movers dashboard"
          className="dashboard-v2-left"
          data-market-movers-api-available={stringifyBoolean(observation.apiAvailable)}
          data-market-movers-api-ok={stringifyBoolean(observation.apiOk)}
          data-market-movers-events-availability={observation.dataAvailability.events}
          data-market-movers-freshness={observation.freshness}
          data-market-movers-http-status={observation.httpStatus ?? "unknown"}
          data-market-movers-market-cap-availability={observation.dataAvailability.marketCap}
          data-market-movers-mode={observation.mode}
          data-market-movers-reason={observation.reason}
          data-market-movers-render-state={observation.renderState}
          data-market-movers-rendered-result-count={observation.renderedResultCount}
          data-market-movers-session={observation.session}
          data-market-movers-source-result-count={observation.sourceResultCount}
          data-market-movers-state={observation.status}
          data-market-movers-tab={observation.moverTab}
          data-market-movers-volume-availability={observation.dataAvailability.volume}
        >
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
          {observation.status === "ready" ? (
            <>
              <p aria-live="polite" className={styles.filterResultCount}>
                {observation.resultLabel}
              </p>
              {observation.renderState === "ready" ? (
                <MarketMoversTable
                  adsEnabledForViewer={adsEnabledForViewer}
                  mobileValueMode={activeMoverTab === "Top Volume" ? "volume" : "change"}
                  onOpenChart={(row) => openTickerDetail(row, "chart")}
                  onSelectRow={(row) => openTickerDetail(row, "summary")}
                  rows={rows}
                  selectedTicker={selectedTicker?.ticker}
                />
              ) : (
                <MarketDataState observation={observation} />
              )}
              <MarketTimestamp observation={observation} />
            </>
          ) : (
            <MarketDataState observation={observation} />
          )}
        </section>
        <div className={styles.rightRail}>
          {selectedTicker ? (
            <TickerDetailPanel ticker={selectedTicker} />
          ) : (
            <aside className={styles.detailState} aria-label="Ticker detail availability">
              <strong>Ticker detail unavailable</strong>
              <span>
                {observation.status === "ready" && observation.sourceResultCount
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

function MarketDataState({
  observation,
}: {
  observation: DashboardV2MoverObservation;
}) {
  return (
    <section
      aria-live="polite"
      aria-label="Market data status"
      className={styles.marketState}
      data-status={observation.renderState}
    >
      <strong>{observation.renderTitle}</strong>
      <span>{observation.renderMessage}</span>
    </section>
  );
}

function MarketTimestamp({ observation }: { observation: DashboardV2MoverObservation }) {
  const value = observation.asOf || observation.receivedAt;
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;

  return (
    <p className={styles.marketTimestamp}>
      {marketTimestampLabel(
        observation.freshness,
        observation.session,
        Boolean(observation.asOf),
      )}{" "}
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
  freshness: DashboardV2MoverObservation["freshness"],
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

function stringifyBoolean(value: boolean | null) {
  return value === null ? "unknown" : String(value);
}
