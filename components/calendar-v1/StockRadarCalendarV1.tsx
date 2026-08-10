"use client";

import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  List,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import {
  CalendarDesktopRail,
  CalendarInlineAdSlots,
} from "@/components/calendar-v1/CalendarAdSlots";
import { CalendarFilters } from "@/components/calendar-v1/CalendarFilters";
import { CalendarEventDetail } from "@/components/calendar-v1/CalendarEventDetail";
import { MobileCalendarDateNavigation } from "@/components/calendar-v1/MobileCalendarDateNavigation";
import { CalendarView, ListView } from "@/components/calendar-v1/CalendarViews";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { areAdsEnabledForPlan } from "@/lib/advertisingPolicy";
import { buildCalendarEventFollowUsage } from "@/lib/alerts/calendarFollowPolicy";
import {
  countActiveCalendarFilters,
  filterCalendarEvents,
  formatEnglishDatePickerValue,
  formatRangeLabel,
  getPresetDateRange,
  normalizeDateRange,
  rangeContainsDate,
  shiftDateRange,
} from "@/lib/calendar-v1/dateUtils";
import {
  DEFAULT_CALENDAR_FILTERS,
  type CalendarDateRange,
  type CalendarEvent,
  type CalendarRangePreset,
  type CalendarViewMode,
} from "@/lib/calendar-v1/model";
import { parseCalendarEventsApiPayload } from "@/lib/calendar-v1/normalized";
import {
  getCalendarEventIdentity,
  selectCalendarPreviewEvent,
} from "@/lib/calendar-v1/presentation";
import {
  resolveCalendarFlowState,
  type CalendarFlowState,
} from "@/lib/calendar-v1/flowState";
import { getPlanLimits, type Plan } from "@/lib/subscriptionPolicy";
import type { CalendarEventFollowsViewModel } from "@/lib/alerts/types";
import {
  publishUserContentChange,
  subscribeToUserContentChanges,
} from "@/lib/userContentSync";
import styles from "./CalendarV1.module.css";

export type CalendarPreviewState = "default" | "loading" | "error" | "empty";

export function StockRadarCalendarV1({
  initialEvents,
  initialLoadError = false,
  initialRange,
  initialWatchlistTickers,
  initialSelectedDate,
  initialSelectedEventId = null,
  previewState = "default",
  today,
  viewerPlan,
  viewerAuthenticated,
}: {
  initialEvents: readonly CalendarEvent[];
  initialLoadError?: boolean;
  initialRange: CalendarDateRange;
  initialWatchlistTickers: readonly string[];
  initialSelectedDate?: string;
  initialSelectedEventId?: string | null;
  previewState?: CalendarPreviewState;
  today: string;
  viewerPlan: Plan;
  viewerAuthenticated: boolean;
}) {
  const router = useRouter();
  const [preset, setPreset] = useState<CalendarRangePreset>("this-week");
  const [range, setRange] = useState<CalendarDateRange>(initialRange);
  const [selectedDate, setSelectedDate] = useState(initialSelectedDate ?? today);
  const [viewMode, setViewMode] = useState<CalendarViewMode>("calendar");
  const [filters, setFilters] = useState(DEFAULT_CALENDAR_FILTERS);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(
    initialSelectedEventId,
  );
  const [sheetEventId, setSheetEventId] = useState<string | null>(null);
  const [watchlistOverrides, setWatchlistOverrides] = useState<Record<string, boolean>>({});
  const initialWatchlistSet = useMemo(
    () => new Set(initialWatchlistTickers),
    [initialWatchlistTickers],
  );
  const [followedEvents, setFollowedEvents] = useState<Record<string, boolean>>({});
  const [followUsage, setFollowUsage] = useState(() =>
    buildCalendarEventFollowUsage(
      0,
      getPlanLimits(viewerPlan).calendarEventFollowLimit,
    ),
  );
  const [followAction, setFollowAction] = useState("");
  const [followMessage, setFollowMessage] = useState("");
  const [sourceEvents, setSourceEvents] = useState<readonly CalendarEvent[]>(initialEvents);
  const [desktopRailContentHeight, setDesktopRailContentHeight] = useState(0);
  const [loadState, setLoadState] = useState<"ready" | "loading" | "error">(
    initialLoadError ? "error" : "ready",
  );
  const [reloadToken, setReloadToken] = useState(0);
  const mobileFilterOpenerRef = useRef<HTMLButtonElement>(null);
  const detailOpenerRef = useRef<HTMLElement | null>(null);
  const selectedDateListRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(0);
  const loadedRangeKeyRef = useRef<string | null>(
    initialLoadError ? null : rangeKey(initialRange),
  );

  useEffect(() => {
    if (
      !initialSelectedEventId ||
      !sourceEvents.some((event) => event.id === initialSelectedEventId) ||
      !window.matchMedia("(max-width: 1180px)").matches
    ) {
      return;
    }
    setSheetEventId(initialSelectedEventId);
  }, [initialSelectedEventId, sourceEvents]);
  const events = useMemo(
    () =>
      sourceEvents.map((event) =>
        event.category === "company"
          ? {
              ...event,
              isWatchlisted: event.ticker
                ? watchlistOverrides[event.ticker] ?? initialWatchlistSet.has(event.ticker)
                : event.isWatchlisted,
            }
          : event,
      ),
    [initialWatchlistSet, sourceEvents, watchlistOverrides],
  );

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/calendar/follows", {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as {
          data?: CalendarEventFollowsViewModel;
          message?: string;
        } | null;
        if (!response.ok || !Array.isArray(payload?.data?.follows) || !payload.data.usage) {
          throw new Error(payload?.message || "Failed to load followed events.");
        }
        setFollowedEvents(
          Object.fromEntries(payload.data.follows.map((follow) => [follow.eventId, follow.enabled])),
        );
        setFollowUsage(payload.data.usage);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setFollowMessage(
          error instanceof Error ? error.message : "Failed to load followed events.",
        );
      });
    return () => controller.abort();
  }, []);
  useEffect(
    () =>
      subscribeToUserContentChanges((change) => {
        if (change.kind !== "watchlist") return;
        setWatchlistOverrides((current) => ({
          ...current,
          [change.ticker]: change.value,
        }));
      }),
    [],
  );
  const watchlistTickers = useMemo(() => {
    const tickers = new Set(initialWatchlistSet);
    for (const [ticker, enabled] of Object.entries(watchlistOverrides)) {
      if (enabled) tickers.add(ticker);
      else tickers.delete(ticker);
    }
    for (const event of events) {
      if (
        event.category === "company" &&
        event.ticker &&
        event.isWatchlisted
      ) {
        tickers.add(event.ticker);
      }
    }
    return tickers;
  }, [events, initialWatchlistSet, watchlistOverrides]);
  const filteredEvents = useMemo(
    () => filterCalendarEvents(events, range, filters, watchlistTickers),
    [events, filters, range, watchlistTickers],
  );
  const activeFilterCount = countActiveCalendarFilters(filters);
  const visibleLoadState =
    previewState === "loading" || previewState === "error"
      ? previewState
      : loadState;
  const flowState = resolveCalendarFlowState({
    activeFilterCount,
    loadState: visibleLoadState,
    range,
    sourceCount: events.length,
    visibleCount: filteredEvents.length,
  });
  const canShowPreview =
    flowState.status === "ready";
  const desktopPreviewEvent = canShowPreview
    ? selectCalendarPreviewEvent(
        filteredEvents,
        selectedDate,
        viewMode,
        selectedEventId,
      )
    : null;
  const sheetEvent =
    events.find((event) => event.id === sheetEventId) ?? null;
  const adsEnabledForViewer = areAdsEnabledForPlan(viewerPlan);

  useEffect(() => {
    if (previewState !== "default") return;
    const key = rangeKey(range);
    if (loadedRangeKeyRef.current === key && reloadToken === 0) return;

    const requestId = ++requestIdRef.current;
    const controller = new AbortController();
    setLoadState("loading");
    setSourceEvents([]);

    const params = new URLSearchParams({ from: range.from, to: range.to });
    fetch(`/api/calendar/normalized?${params.toString()}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload: unknown = await response.json();
        if (!response.ok) throw new Error("Calendar request failed");
        return parseCalendarEventsApiPayload(payload);
      })
      .then((nextEvents) => {
        if (requestIdRef.current !== requestId) return;
        loadedRangeKeyRef.current = key;
        setSourceEvents(nextEvents);
        setLoadState("ready");
      })
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          (error instanceof DOMException && error.name === "AbortError") ||
          requestIdRef.current !== requestId
        ) {
          return;
        }
        loadedRangeKeyRef.current = null;
        setSourceEvents([]);
        setLoadState("error");
      });

    return () => controller.abort();
  }, [previewState, range.from, range.to, reloadToken]);

  function updateRange(nextRange: CalendarDateRange, nextPreset: CalendarRangePreset) {
    const normalized = normalizeDateRange(nextRange);
    if (previewState === "default") {
      loadedRangeKeyRef.current = null;
      setLoadState("loading");
      setSourceEvents([]);
    }
    setSheetEventId(null);
    setSelectedEventId(null);
    setRange(normalized);
    setPreset(nextPreset);
    setSelectedDate(rangeContainsDate(normalized, today) ? today : normalized.from);
  }

  function selectPreset(nextPreset: CalendarRangePreset) {
    if (nextPreset === "custom") {
      setPreset("custom");
      return;
    }
    updateRange(getPresetDateRange(nextPreset, today), nextPreset);
  }

  function openEvent(event: CalendarEvent, opener: HTMLElement) {
    setSelectedEventId(event.id);
    if (window.matchMedia("(max-width: 1180px)").matches) {
      detailOpenerRef.current = opener;
      setSheetEventId(event.id);
    }
  }

  function selectDate(date: string) {
    setSelectedEventId(null);
    setSelectedDate(date);
  }

  function dismissSheet() {
    setSheetEventId(null);
    requestAnimationFrame(() => detailOpenerRef.current?.focus({ preventScroll: true }));
  }

  function retryLoad() {
    if (previewState !== "default") {
      window.location.assign("/calendar");
      return;
    }
    loadedRangeKeyRef.current = null;
    setReloadToken((current) => current + 1);
  }

  async function toggleFollowEvent(event: CalendarEvent) {
    if (followAction) return;
    const enabled = !followedEvents[event.id];
    setFollowAction(event.id);
    setFollowMessage("");

    try {
      const response = await fetch("/api/calendar/follows", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId: event.id, enabled }),
      });
      const payload = (await response.json().catch(() => null)) as {
        data?: CalendarEventFollowsViewModel & { followed?: boolean };
        message?: string;
      } | null;
      if (response.status === 401) {
        const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        window.location.assign(`/login?next=${encodeURIComponent(returnTo)}`);
        return;
      }
      if (!response.ok || !Array.isArray(payload?.data?.follows) || !payload.data.usage) {
        throw new Error(payload?.message || "Failed to update the event follow.");
      }
      setFollowedEvents(
        Object.fromEntries(
          payload.data.follows.map((follow) => [follow.eventId, follow.enabled]),
        ),
      );
      setFollowUsage(payload.data.usage);
      setFollowMessage(
        enabled
          ? "Event followed. Schedule updates and the 30-minute reminder will appear in Alerts."
          : "Event follow removed.",
      );
    } catch (error) {
      setFollowMessage(
        error instanceof Error ? error.message : "Failed to update the event follow.",
      );
    } finally {
      setFollowAction("");
    }
  }

  async function toggleWatchlist(event: CalendarEvent) {
    const ticker = getCalendarEventIdentity(event).primaryTicker;
    if (!ticker || event.category !== "company") return;
    if (!viewerAuthenticated) {
      router.push(
        `/login?next=${encodeURIComponent(
          `${window.location.pathname}${window.location.search}${window.location.hash}`,
        )}`,
      );
      return;
    }

    const previous = watchlistTickers.has(ticker);
    const next = !previous;
    setWatchlistOverrides((current) => ({ ...current, [ticker]: next }));
    publishUserContentChange({ kind: "watchlist", ticker, value: next });

    try {
      const response = await fetch(
        next ? "/api/watchlist" : `/api/watchlist/${encodeURIComponent(ticker)}`,
        next
          ? {
              body: JSON.stringify({ ticker }),
              headers: { "Content-Type": "application/json" },
              method: "POST",
            }
          : { method: "DELETE" },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.ok === false || payload?.persisted === false) {
        throw new Error(payload?.message || "Failed to update Watchlist.");
      }
      setFollowMessage(
        next
          ? `${ticker} added to Stock Watchlist. Event alerts remain separate.`
          : `${ticker} removed from Stock Watchlist. Event alerts remain unchanged.`,
      );
    } catch (error) {
      setWatchlistOverrides((current) => ({ ...current, [ticker]: previous }));
      publishUserContentChange({ kind: "watchlist", ticker, value: previous });
      setFollowMessage(
        error instanceof Error ? error.message : "Failed to update Watchlist.",
      );
    }
  }

  const content = (() => {
    if (flowState.status === "loading") {
      return <CalendarLoading state={flowState} />;
    }
    if (flowState.status === "unavailable" || flowState.status === "unknown") {
      return <CalendarError onRetry={retryLoad} state={flowState} />;
    }
    if (flowState.status === "source-empty") {
      return <CalendarEmpty onReset={retryLoad} state={flowState} />;
    }
    if (flowState.status === "filter-empty") {
      return (
        <CalendarEmpty
          onReset={() => setFilters(DEFAULT_CALENDAR_FILTERS)}
          state={flowState}
        />
      );
    }
    if (viewMode === "list") {
      return (
        <ListView
          events={filteredEvents}
          onOpenEvent={openEvent}
          selectedEventId={desktopPreviewEvent?.id ?? null}
          today={today}
        />
      );
    }
    return (
        <CalendarView
          events={filteredEvents}
          onOpenEvent={openEvent}
          onSelectedDateChange={selectDate}
        range={range}
        selectedDate={selectedDate}
        selectedDateListRef={selectedDateListRef}
        selectedEventId={desktopPreviewEvent?.id ?? null}
        today={today}
      />
    );
  })();

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader} data-calendar-header>
        <div>
          <span>EVENT DISCOVERY</span>
          <h1>Market Events</h1>
          <p>{formatRangeLabel(range)}</p>
        </div>
        <SegmentedControl
          ariaLabel="Calendar view"
          className={styles.viewControl}
          items={[
            { label: "Calendar", value: "calendar" },
            { label: "List", value: "list" },
          ]}
          onValueChange={setViewMode}
          value={viewMode}
          variant="compact"
        />
      </header>

      <section
        aria-label="Date range controls"
        className={styles.dateControls}
        data-calendar-date-controls
      >
        <SegmentedControl
          ariaLabel="Date range"
          className={styles.rangeControl}
          items={[
            { label: "Today", value: "today" },
            { label: "This Week", value: "this-week" },
            { label: "Next Week", value: "next-week" },
            { label: "Custom", value: "custom" },
          ]}
          onValueChange={selectPreset}
          value={preset}
          variant="compact"
        />
        <div className={styles.periodNavigation}>
          <button
            aria-label="Previous period"
            onClick={() => updateRange(shiftDateRange(range, -1), "custom")}
            type="button"
          >
            <ChevronLeft aria-hidden="true" size={18} />
          </button>
          <button
            onClick={() => updateRange(getPresetDateRange("today", today), "today")}
            type="button"
          >
            Today
          </button>
          <button
            aria-label="Next period"
            onClick={() => updateRange(shiftDateRange(range, 1), "custom")}
            type="button"
          >
            <ChevronRight aria-hidden="true" size={18} />
          </button>
          <div className={styles.jumpDate}>
            <span className={styles.dateFieldLabel}>Choose date</span>
            <EnglishDatePicker
              ariaLabel="Choose date"
              onValueChange={(value) => {
                updateRange(
                  { from: value, to: value },
                  "custom",
                );
              }}
              value={range.from === range.to ? range.from : ""}
            />
          </div>
        </div>
        {preset === "custom" ? (
          <div className={styles.customRange}>
            <div className={styles.customDateField}>
              <span className={styles.dateFieldLabel}>From</span>
              <EnglishDatePicker
                ariaLabel="From date"
                onValueChange={(value) => {
                  updateRange({ ...range, from: value }, "custom");
                }}
                value={range.from}
              />
            </div>
            <div className={styles.customDateField}>
              <span className={styles.dateFieldLabel}>To</span>
              <EnglishDatePicker
                ariaLabel="To date"
                onValueChange={(value) => {
                  updateRange({ ...range, to: value }, "custom");
                }}
                value={range.to}
              />
            </div>
          </div>
        ) : null}
        <MobileCalendarDateNavigation
          onRangeChange={updateRange}
          preset={preset}
          range={range}
          today={today}
        />
      </section>

      <CalendarFilters
        activeCount={activeFilterCount}
        filters={filters}
        mobileOpenerRef={mobileFilterOpenerRef}
        mobileSheetOpen={mobileFiltersOpen}
        onMobileSheetOpenChange={setMobileFiltersOpen}
        onReset={() => setFilters(DEFAULT_CALENDAR_FILTERS)}
        setFilters={setFilters}
      />

      <CalendarInlineAdSlots enabledForViewer={adsEnabledForViewer} />

      <div
        className={styles.workspace}
        data-detail-open={Boolean(desktopPreviewEvent)}
        data-rail-ads={adsEnabledForViewer && Boolean(desktopPreviewEvent)}
        data-view-mode={viewMode}
        style={
          desktopRailContentHeight > 0
            ? ({
                "--calendar-desktop-rail-content-height": `${desktopRailContentHeight}px`,
              } as CSSProperties)
            : undefined
        }
      >
        <section
          aria-busy={flowState.status === "loading"}
          aria-label="Calendar results"
          className={styles.results}
          data-calendar-active-filter-count={flowState.activeFilterCount}
          data-calendar-range-from={flowState.rangeFrom}
          data-calendar-range-to={flowState.rangeTo}
          data-calendar-results
          data-calendar-source-count={flowState.sourceCount}
          data-calendar-state={flowState.status}
          data-calendar-visible-count={flowState.visibleCount}
        >
          <div className={styles.resultsSummary} aria-live="polite">
            <span>{flowState.resultLabel}</span>
            {flowState.activeFilterCount ? <b>{flowState.activeFilterCount} filters active</b> : <b>All events</b>}
          </div>
          {content}
        </section>
        <CalendarDesktopRail
          activeEventId={selectedEventId}
          enabledForViewer={adsEnabledForViewer && Boolean(desktopPreviewEvent)}
          onContentHeightChange={setDesktopRailContentHeight}
        >
          <CalendarEventDetail
            desktopEvent={desktopPreviewEvent}
            followAction={followAction}
            followMessage={followMessage}
            followUsage={followUsage}
            followedEvents={followedEvents}
            onFollowToggle={(event) => void toggleFollowEvent(event)}
            onSheetDismiss={dismissSheet}
            onWatchlistToggle={(event) => void toggleWatchlist(event)}
            openerRef={detailOpenerRef}
            sheetEvent={sheetEvent}
            watchlistTickers={watchlistTickers}
          />
        </CalendarDesktopRail>
      </div>
    </div>
  );
}

function EnglishDatePicker({
  ariaLabel,
  onValueChange,
  value,
}: {
  ariaLabel: string;
  onValueChange: (value: string) => void;
  value: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const displayValue = value
    ? formatEnglishDatePickerValue(value)
    : "MM/DD/YYYY";

  function openNativePicker() {
    const input = inputRef.current;
    if (!input) return;

    try {
      if (typeof input.showPicker === "function") {
        input.showPicker();
        return;
      }
    } catch {
      // Fall through to the click fallback for browsers that expose but block showPicker.
    }

    input.click();
  }

  return (
    <span className={styles.englishDatePicker}>
      <button
        aria-haspopup="dialog"
        aria-label={`${ariaLabel}: ${displayValue}`}
        className={styles.englishDateButton}
        onClick={openNativePicker}
        type="button"
      >
        <span>{displayValue}</span>
        <CalendarDays aria-hidden="true" size={15} />
      </button>
      <input
        aria-hidden="true"
        className={styles.nativeDateInput}
        lang="en-US"
        onChange={(event) => {
          if (event.currentTarget.value) {
            onValueChange(event.currentTarget.value);
          }
        }}
        ref={inputRef}
        tabIndex={-1}
        type="date"
        value={value}
      />
    </span>
  );
}

function CalendarLoading({ state }: { state: CalendarFlowState }) {
  return (
    <section aria-busy="true" aria-label="Loading calendar events" className={styles.statePanel} role={state.role ?? undefined}>
      <LoaderCircle aria-hidden="true" className={styles.spin} size={27} />
      <h2>{state.title}</h2>
      <p>{state.message}</p>
      <div className={styles.loadingRows} aria-hidden="true">
        <span /><span /><span />
      </div>
    </section>
  );
}

function CalendarError({ onRetry, state }: { onRetry: () => void; state: CalendarFlowState }) {
  return (
    <section className={styles.statePanel} role={state.role ?? undefined}>
      <AlertTriangle aria-hidden="true" size={28} />
      <h2>{state.title}</h2>
      <p>{state.message}</p>
      <button onClick={onRetry} type="button">
        <RefreshCw aria-hidden="true" size={15} />
        {state.actionLabel}
      </button>
    </section>
  );
}

function CalendarEmpty({
  onReset,
  state,
}: {
  onReset: () => void;
  state: CalendarFlowState;
}) {
  return (
    <section className={styles.statePanel} role={state.role ?? undefined}>
      {state.status === "source-empty" ? <CalendarDays aria-hidden="true" size={28} /> : <List aria-hidden="true" size={28} />}
      <h2>{state.title}</h2>
      <p>{state.message}</p>
      <button onClick={onReset} type="button">
        {state.actionLabel}
      </button>
    </section>
  );
}

function rangeKey(range: CalendarDateRange) {
  return `${range.from}:${range.to}`;
}
