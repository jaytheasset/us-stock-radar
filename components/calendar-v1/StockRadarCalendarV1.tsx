"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  List,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { CalendarAdSlots } from "@/components/calendar-v1/CalendarAdSlots";
import { CalendarFilters } from "@/components/calendar-v1/CalendarFilters";
import { CalendarEventDetail } from "@/components/calendar-v1/CalendarEventDetail";
import { CalendarView, ListView } from "@/components/calendar-v1/CalendarViews";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { areAdsEnabledForPlan } from "@/lib/advertisingPolicy";
import {
  countActiveCalendarFilters,
  filterCalendarEvents,
  formatRangeLabel,
  getPresetDateRange,
  normalizeDateRange,
  rangeContainsDate,
  shiftDateRange,
} from "@/lib/calendar-v1/dateUtils";
import { createCalendarMockEvents } from "@/lib/calendar-v1/mockData";
import {
  DEFAULT_CALENDAR_FILTERS,
  type CalendarDateRange,
  type CalendarEvent,
  type CalendarRangePreset,
  type CalendarViewMode,
} from "@/lib/calendar-v1/model";
import {
  formatEventCount,
  selectCalendarPreviewEvent,
} from "@/lib/calendar-v1/presentation";
import type { Plan } from "@/lib/subscriptionPolicy";
import styles from "./CalendarV1.module.css";

export type CalendarPreviewState = "default" | "loading" | "error" | "empty";

export function StockRadarCalendarV1({
  previewState = "default",
  today,
  viewerPlan,
}: {
  previewState?: CalendarPreviewState;
  today: string;
  viewerPlan: Plan;
}) {
  const [preset, setPreset] = useState<CalendarRangePreset>("this-week");
  const [range, setRange] = useState<CalendarDateRange>(() => getPresetDateRange("this-week", today));
  const [selectedDate, setSelectedDate] = useState(today);
  const [viewMode, setViewMode] = useState<CalendarViewMode>("calendar");
  const [filters, setFilters] = useState(DEFAULT_CALENDAR_FILTERS);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [sheetEventId, setSheetEventId] = useState<string | null>(null);
  const [watchlistOverrides, setWatchlistOverrides] = useState<Record<string, boolean>>({});
  const [followedEvents, setFollowedEvents] = useState<Record<string, boolean>>({});
  const mobileFilterOpenerRef = useRef<HTMLButtonElement>(null);
  const detailOpenerRef = useRef<HTMLElement | null>(null);
  const selectedDateListRef = useRef<HTMLDivElement>(null);
  const sourceEvents = useMemo(
    () => (previewState === "empty" ? [] : createCalendarMockEvents(today)),
    [previewState, today],
  );
  const events = useMemo(
    () =>
      sourceEvents.map((event) => ({
        ...event,
        isWatchlisted: watchlistOverrides[event.id] ?? event.isWatchlisted,
      })) as CalendarEvent[],
    [sourceEvents, watchlistOverrides],
  );
  const filteredEvents = useMemo(
    () => filterCalendarEvents(events, range, filters),
    [events, filters, range],
  );
  const activeFilterCount = countActiveCalendarFilters(filters);
  const canShowPreview =
    previewState === "default" &&
    events.length > 0 &&
    filteredEvents.length > 0;
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
    const nextSelectedEventId = desktopPreviewEvent?.id ?? null;
    setSelectedEventId((current) =>
      current === nextSelectedEventId ? current : nextSelectedEventId,
    );
  }, [desktopPreviewEvent?.id]);

  function updateRange(nextRange: CalendarDateRange, nextPreset: CalendarRangePreset) {
    const normalized = normalizeDateRange(nextRange);
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

  function dismissSheet() {
    setSheetEventId(null);
    requestAnimationFrame(() => detailOpenerRef.current?.focus({ preventScroll: true }));
  }

  const content = (() => {
    if (previewState === "loading") return <CalendarLoading />;
    if (previewState === "error") return <CalendarError />;
    if (!events.length) return <CalendarEmpty variant="all" onReset={() => window.location.assign("/calendar")} />;
    if (!filteredEvents.length) {
      return (
        <CalendarEmpty
          variant="filters"
          onReset={() => setFilters(DEFAULT_CALENDAR_FILTERS)}
        />
      );
    }
    if (viewMode === "list") {
      return (
        <ListView
          events={filteredEvents}
          onOpenEvent={openEvent}
          selectedEventId={desktopPreviewEvent?.id ?? null}
        />
      );
    }
    return (
      <CalendarView
        events={filteredEvents}
        onOpenEvent={openEvent}
        onSelectedDateChange={setSelectedDate}
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
      <header className={styles.pageHeader}>
        <div>
          <span>EVENT DISCOVERY</span>
          <h1>Calendar</h1>
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

      <section aria-label="Date range controls" className={styles.dateControls}>
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
          <label className={styles.jumpDate}>
            <span>Choose date</span>
            <input
              aria-label="Choose date"
              onInput={(event) => {
                if (!event.currentTarget.value) return;
                updateRange(
                  { from: event.currentTarget.value, to: event.currentTarget.value },
                  "custom",
                );
              }}
              type="date"
              value={range.from === range.to ? range.from : ""}
            />
          </label>
        </div>
        {preset === "custom" ? (
          <div className={styles.customRange}>
            <label>
              <span>From</span>
              <input
                onInput={(event) => {
                  if (event.currentTarget.value) {
                    updateRange({ ...range, from: event.currentTarget.value }, "custom");
                  }
                }}
                type="date"
                value={range.from}
              />
            </label>
            <label>
              <span>To</span>
              <input
                onInput={(event) => {
                  if (event.currentTarget.value) {
                    updateRange({ ...range, to: event.currentTarget.value }, "custom");
                  }
                }}
                type="date"
                value={range.to}
              />
            </label>
          </div>
        ) : null}
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

      <CalendarAdSlots enabledForViewer={adsEnabledForViewer} />

      <div className={styles.workspace} data-detail-open={Boolean(desktopPreviewEvent)}>
        <section className={styles.results} aria-label="Calendar results">
          <div className={styles.resultsSummary} aria-live="polite">
            <span>{formatEventCount(filteredEvents.length)}</span>
            {activeFilterCount ? <b>{activeFilterCount} filters active</b> : <b>All events</b>}
          </div>
          {content}
        </section>
        <CalendarEventDetail
          desktopEvent={desktopPreviewEvent}
          followedEvents={followedEvents}
          onFollowToggle={(event) => {
            setFollowedEvents((current) => ({
              ...current,
              [event.id]: !current[event.id],
            }));
          }}
          onSheetDismiss={dismissSheet}
          onWatchlistToggle={(event) => {
            setWatchlistOverrides((current) => ({
              ...current,
              [event.id]: !(current[event.id] ?? event.isWatchlisted),
            }));
          }}
          openerRef={detailOpenerRef}
          sheetEvent={sheetEvent}
          watchlistOverrides={watchlistOverrides}
        />
      </div>
    </div>
  );
}

function CalendarLoading() {
  return (
    <section aria-busy="true" aria-label="Loading calendar events" className={styles.statePanel}>
      <LoaderCircle aria-hidden="true" className={styles.spin} size={27} />
      <h2>Loading calendar events</h2>
      <p>Preparing the selected event range.</p>
      <div className={styles.loadingRows} aria-hidden="true">
        <span /><span /><span />
      </div>
    </section>
  );
}

function CalendarError() {
  return (
    <section className={styles.statePanel} role="alert">
      <AlertTriangle aria-hidden="true" size={28} />
      <h2>Calendar events could not be loaded</h2>
      <p>Try the preview again. No saved data was changed.</p>
      <button onClick={() => window.location.assign("/calendar")} type="button">
        <RefreshCw aria-hidden="true" size={15} />
        Retry
      </button>
    </section>
  );
}

function CalendarEmpty({
  onReset,
  variant,
}: {
  onReset: () => void;
  variant: "all" | "filters";
}) {
  return (
    <section className={styles.statePanel}>
      {variant === "all" ? <CalendarDays aria-hidden="true" size={28} /> : <List aria-hidden="true" size={28} />}
      <h2>{variant === "all" ? "No events in this range" : "No events match these filters"}</h2>
      <p>
        {variant === "all"
          ? "Move to another period to continue exploring events."
          : "Clear the filters or search to see the full mock calendar."}
      </p>
      <button onClick={onReset} type="button">
        {variant === "all" ? "Return to calendar" : "Reset filters"}
      </button>
    </section>
  );
}
