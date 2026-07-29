"use client";

import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { ChevronDown, Search, SlidersHorizontal } from "lucide-react";
import { BottomSheetShell } from "@/components/ui/BottomSheetShell";
import { FilterOption } from "@/components/ui/FilterOption";
import { FilterTrigger } from "@/components/ui/FilterTrigger";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import {
  CALENDAR_EVENT_STATUSES,
  CALENDAR_EVENT_TYPES,
  CALENDAR_MARKET_SESSIONS,
  eventStatusLabels,
  eventTypeLabels,
  marketSessionLabels,
  type CalendarEventStatus,
  type CalendarEventType,
  type CalendarFilters as CalendarFilterState,
  type CalendarMarketSession,
} from "@/lib/calendar-v1/model";
import styles from "./CalendarV1.module.css";

type CalendarFiltersProps = {
  activeCount: number;
  filters: CalendarFilterState;
  mobileOpenerRef: RefObject<HTMLButtonElement | null>;
  mobileSheetOpen: boolean;
  onMobileSheetOpenChange: (open: boolean) => void;
  onReset: () => void;
  setFilters: Dispatch<SetStateAction<CalendarFilterState>>;
};

const eventTypeItems = [
  { label: "All", value: "all" },
  ...CALENDAR_EVENT_TYPES.map((value) => ({ label: eventTypeLabels[value], value })),
] as const;

export function CalendarFilters({
  activeCount,
  filters,
  mobileOpenerRef,
  mobileSheetOpen,
  onMobileSheetOpenChange,
  onReset,
  setFilters,
}: CalendarFiltersProps) {
  return (
    <section aria-label="Calendar filters" className={styles.filters}>
      <div className={styles.searchAndMobileFilters}>
        <label className={styles.searchField}>
          <Search aria-hidden="true" size={17} />
          <span className={styles.visuallyHidden}>Search ticker or company</span>
          <input
            onChange={(event) =>
              setFilters((current) => ({ ...current, query: event.target.value }))
            }
            placeholder="Search ticker or company"
            type="search"
            value={filters.query}
          />
        </label>
        <FilterTrigger
          active={activeCount > 0}
          aria-controls="calendar-mobile-filters"
          aria-label={`Open calendar filters${activeCount ? `, ${activeCount} active` : ""}`}
          className={styles.mobileFilterTrigger}
          label="Filters"
          onClick={() => onMobileSheetOpenChange(true)}
          ref={mobileOpenerRef}
          trailingIcon={<SlidersHorizontal aria-hidden="true" size={15} />}
          value={activeCount ? String(activeCount) : undefined}
          variant="compact"
        />
      </div>

      <div className={styles.desktopFilters}>
        <SegmentedControl
          ariaLabel="Event type"
          className={styles.eventTypeControl}
          items={eventTypeItems}
          onValueChange={(eventType) => setFilters((current) => ({ ...current, eventType }))}
          value={filters.eventType}
          variant="compact"
        />
        <button
          aria-pressed={filters.watchlistOnly}
          className={styles.watchlistFilter}
          data-active={filters.watchlistOnly}
          onClick={() =>
            setFilters((current) => ({
              ...current,
              watchlistOnly: !current.watchlistOnly,
            }))
          }
          type="button"
        >
          Watchlist only
        </button>
        <FilterMenu
          label="Session"
          onChange={(marketSession) =>
            setFilters((current) => ({ ...current, marketSession }))
          }
          options={[
            { label: "All sessions", value: "all" },
            ...CALENDAR_MARKET_SESSIONS.map((value) => ({
              label: marketSessionLabels[value],
              value,
            })),
          ]}
          value={filters.marketSession}
        />
        <FilterMenu
          label="Status"
          onChange={(status) => setFilters((current) => ({ ...current, status }))}
          options={[
            { label: "All statuses", value: "all" },
            ...CALENDAR_EVENT_STATUSES.map((value) => ({
              label: eventStatusLabels[value],
              value,
            })),
          ]}
          value={filters.status}
        />
        <button className={styles.resetFilters} disabled={!activeCount} onClick={onReset} type="button">
          Reset
        </button>
      </div>

      <MobileCalendarFilterSheet
        filters={filters}
        isOpen={mobileSheetOpen}
        onDismiss={() => onMobileSheetOpenChange(false)}
        onReset={onReset}
        openerRef={mobileOpenerRef}
        setFilters={setFilters}
      />
    </section>
  );
}
type FilterMenuOption<Value extends string> = { label: string; value: Value };

function FilterMenu<Value extends string>({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: Value) => void;
  options: readonly FilterMenuOption<Value>[];
  value: Value;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedLabel = options.find((option) => option.value === value)?.label ?? value;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.filterMenu} ref={rootRef}>
      <FilterTrigger
        active={value !== "all"}
        aria-controls={`calendar-${label.toLowerCase()}-options`}
        expanded={open}
        label={label}
        onClick={() => setOpen((current) => !current)}
        trailingIcon={<ChevronDown aria-hidden="true" size={14} />}
        value={selectedLabel}
      />
      {open ? (
        <div
          aria-label={`${label} options`}
          className={styles.filterMenuOptions}
          id={`calendar-${label.toLowerCase()}-options`}
          role="group"
        >
          {options.map((option) => (
            <FilterOption
              key={option.value}
              label={option.label}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              selected={option.value === value}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MobileCalendarFilterSheet({
  filters,
  isOpen,
  onDismiss,
  onReset,
  openerRef,
  setFilters,
}: {
  filters: CalendarFilterState;
  isOpen: boolean;
  onDismiss: () => void;
  onReset: () => void;
  openerRef: RefObject<HTMLElement | null>;
  setFilters: Dispatch<SetStateAction<CalendarFilterState>>;
}) {
  const titleId = "calendar-mobile-filter-title";

  return (
    <BottomSheetShell
      aria-labelledby={titleId}
      closeLabel="Close calendar filters"
      id="calendar-mobile-filters"
      isOpen={isOpen}
      layout="full-scroll"
      onDismiss={onDismiss}
      openerRef={openerRef}
      overlayLabel="Dismiss calendar filters"
    >
      <div className={styles.mobileFilterSheet}>
        <header>
          <span>REFINE EVENTS</span>
          <h2 id={titleId}>Calendar filters</h2>
          <p>All filters apply to both calendar and list views.</p>
        </header>
        <MobileFilterGroup
          label="Event type"
          onChange={(eventType) =>
            setFilters((current) => ({
              ...current,
              eventType: eventType as CalendarEventType | "all",
            }))
          }
          options={eventTypeItems}
          value={filters.eventType}
        />
        <section className={styles.mobileFilterGroup}>
          <h3>Watchlist</h3>
          <div>
            <FilterOption
              label="All tickers"
              onClick={() => setFilters((current) => ({ ...current, watchlistOnly: false }))}
              selected={!filters.watchlistOnly}
            />
            <FilterOption
              label="Watchlist only"
              onClick={() => setFilters((current) => ({ ...current, watchlistOnly: true }))}
              selected={filters.watchlistOnly}
            />
          </div>
        </section>
        <MobileFilterGroup
          label="Market session"
          onChange={(marketSession) =>
            setFilters((current) => ({
              ...current,
              marketSession: marketSession as CalendarMarketSession | "all",
            }))
          }
          options={[
            { label: "All", value: "all" },
            ...CALENDAR_MARKET_SESSIONS.map((value) => ({
              label: marketSessionLabels[value],
              value,
            })),
          ]}
          value={filters.marketSession}
        />
        <MobileFilterGroup
          label="Status"
          onChange={(status) =>
            setFilters((current) => ({
              ...current,
              status: status as CalendarEventStatus | "all",
            }))
          }
          options={[
            { label: "All", value: "all" },
            ...CALENDAR_EVENT_STATUSES.map((value) => ({
              label: eventStatusLabels[value],
              value,
            })),
          ]}
          value={filters.status}
        />
        <footer className={styles.mobileFilterActions}>
          <button onClick={onReset} type="button">Reset all</button>
          <button onClick={onDismiss} type="button">Show results</button>
        </footer>
      </div>
    </BottomSheetShell>
  );
}

function MobileFilterGroup({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: readonly FilterMenuOption<string>[];
  value: string;
}) {
  return (
    <section className={styles.mobileFilterGroup}>
      <h3>{label}</h3>
      <div>
        {options.map((option) => (
          <FilterOption
            key={option.value}
            label={option.label}
            onClick={() => onChange(option.value)}
            selected={option.value === value}
          />
        ))}
      </div>
    </section>
  );
}
