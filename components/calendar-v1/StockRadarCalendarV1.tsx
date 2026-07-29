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
import { CalendarFilters } from "@/components/calendar-v1/CalendarFilters";
import { CalendarEventDetail } from "@/components/calendar-v1/CalendarEventDetail";
import { CalendarView, ListView } from "@/components/calendar-v1/CalendarViews";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
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
import styles from "./CalendarV1.module.css";

export type CalendarPreviewState = "default" | "loading" | "error" | "empty";

export function StockRadarCalendarV1({
  previewState = "default",
  today,
}: {
  previewState?: CalendarPreviewState;
  today: string;
}) {
  const [preset, setPreset] = useState<CalendarRangePreset>("this-week");
  const [range, setRange] = useState<CalendarDateRange>(() => getPresetDateRange("this-week", today));
  const [selectedDate, setSelectedDate] = useState(today);
  const [viewMode, setViewMode] = useState<CalendarViewMode>("calendar");
  const [filters, setFilters] = useState(DEFAULT_CALENDAR_FILTERS);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
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

  useEffect(() => {
    if (!selectedEvent) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && window.matchMedia("(min-width: 761px)").matches) {
        event.preventDefault();
        dismissDetail();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedEvent]);

  function updateRange(nextRange: CalendarDateRange, nextPreset: CalendarRangePreset) {
    const normalized = normalizeDateRange(nextRange);
    setRange(normalized);
    setPreset(nextPreset);
    setSelectedDate(rangeContainsDate(normalized, today) ? today : normalized.from);
    setSelectedEvent(null);
  }

  function selectPreset(nextPreset: CalendarRangePreset) {
    if (nextPreset === "custom") {
      setPreset("custom");
      return;
    }
    updateRange(getPresetDateRange(nextPreset, today), nextPreset);
  }

  function openEvent(event: CalendarEvent, opener: HTMLElement) {
    detailOpenerRef.current = opener;
    setSelectedEvent(event);
  }

  function dismissDetail() {
    setSelectedEvent(null);
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
      return <ListView events={filteredEvents} onOpenEvent={openEvent} />;
    }
    return (
      <CalendarView
        events={filteredEvents}
        onOpenEvent={openEvent}
        onSelectedDateChange={setSelectedDate}
        range={range}
        selectedDate={selectedDate}
        selectedDateListRef={selectedDateListRef}
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

      <div className={styles.workspace} data-detail-open={Boolean(selectedEvent)}>
        <section className={styles.results} aria-label="Calendar results">
          <div className={styles.resultsSummary} aria-live="polite">
            <span>{filteredEvents.length} events</span>
            {activeFilterCount ? <b>{activeFilterCount} filters active</b> : <b>All events</b>}
          </div>
          {content}
        </section>
        <CalendarEventDetail
          event={selectedEvent}
          followed={selectedEvent ? Boolean(followedEvents[selectedEvent.id]) : false}
          onDismiss={dismissDetail}
          onFollowToggle={() => {
            if (!selectedEvent) return;
            setFollowedEvents((current) => ({
              ...current,
              [selectedEvent.id]: !current[selectedEvent.id],
            }));
          }}
          onWatchlistToggle={() => {
            if (!selectedEvent) return;
            setWatchlistOverrides((current) => ({
              ...current,
              [selectedEvent.id]: !(current[selectedEvent.id] ?? selectedEvent.isWatchlisted),
            }));
          }}
          openerRef={detailOpenerRef}
          watchlisted={
            selectedEvent
              ? watchlistOverrides[selectedEvent.id] ?? selectedEvent.isWatchlisted
              : false
          }
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
