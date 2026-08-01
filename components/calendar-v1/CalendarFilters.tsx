"use client";

import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { Check, ChevronDown, Search, SlidersHorizontal } from "lucide-react";
import { BottomSheetShell } from "@/components/ui/BottomSheetShell";
import { FilterOption } from "@/components/ui/FilterOption";
import { FilterTrigger } from "@/components/ui/FilterTrigger";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import {
  CALENDAR_CATEGORIES,
  CALENDAR_EVENT_STATUSES,
  CALENDAR_MARKET_SESSIONS,
  calendarCategoryLabels,
  calendarEventTypeGroups,
  eventStatusLabels,
  eventTypeLabels,
  marketSessionLabels,
  type CalendarCategory,
  type CalendarEventStatus,
  type CalendarEventType,
  type CalendarFilters as CalendarFilterState,
  type CalendarMarketSession,
} from "@/lib/calendar-v1/model";
import { updateCalendarCategoryFilter } from "@/lib/calendar-v1/dateUtils";
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

const categoryItems = [
  { label: "All", value: "all" },
  ...CALENDAR_CATEGORIES.map((value) => ({
    label: calendarCategoryLabels[value],
    value,
  })),
] as const;

function getVisibleTypeGroups(category: CalendarCategory | "all") {
  return category === "all" ? CALENDAR_CATEGORIES : [category];
}

function CalendarFlatFilterOption({
  className,
  ...props
}: ComponentProps<typeof FilterOption>) {
  return (
    <FilterOption
      {...props}
      className={[styles.flatFilterOption, className].filter(Boolean).join(" ")}
      selectedIndicator={<Check aria-hidden="true" size={14} strokeWidth={2.25} />}
    />
  );
}

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
    <section
      aria-label="Calendar filters"
      className={styles.filters}
      data-calendar-filters
    >
      <div className={styles.searchAndMobileFilters}>
        <label className={styles.searchField}>
          <Search aria-hidden="true" size={17} />
          <span className={styles.visuallyHidden}>
            Search events, agencies, industries, or tickers
          </span>
          <input
            onChange={(event) =>
              setFilters((current) => ({ ...current, query: event.target.value }))
            }
            aria-label="Search events, agencies, industries, or tickers"
            placeholder="Search events, agencies, industries, tickers"
            type="search"
            value={filters.query}
          />
          <span
            aria-hidden="true"
            className={styles.mobileSearchPlaceholder}
          >
            Search events or tickers
          </span>
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
          ariaLabel="Event category"
          className={styles.categoryControl}
          items={categoryItems}
          onValueChange={(category) =>
            setFilters((current) =>
              updateCalendarCategoryFilter(current, category),
            )
          }
          value={filters.category}
          variant="compact"
        />
        <EventTypeFilterMenu
          category={filters.category}
          onChange={(eventType) =>
            setFilters((current) => ({ ...current, eventType }))
          }
          value={filters.eventType}
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

function EventTypeFilterMenu({
  category,
  onChange,
  value,
}: {
  category: CalendarCategory | "all";
  onChange: (value: CalendarEventType | "all") => void;
  value: CalendarEventType | "all";
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedLabel = value === "all" ? "All types" : eventTypeLabels[value];

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
        aria-controls="calendar-type-options"
        expanded={open}
        label="Type"
        onClick={() => setOpen((current) => !current)}
        trailingIcon={<ChevronDown aria-hidden="true" size={14} />}
        value={selectedLabel}
      />
      {open ? (
        <div
          aria-label="Event type options"
          className={`${styles.filterMenuOptions} ${styles.typeMenuOptions}`}
          id="calendar-type-options"
          role="group"
        >
          <CalendarFlatFilterOption
            label="All types"
            onClick={() => {
              onChange("all");
              setOpen(false);
            }}
            selected={value === "all"}
          />
          {getVisibleTypeGroups(category).map((group) => (
            <section className={styles.typeOptionGroup} key={group}>
              <h3>{calendarCategoryLabels[group]}</h3>
              {calendarEventTypeGroups[group].map((eventType) => (
                <CalendarFlatFilterOption
                  key={eventType}
                  label={eventTypeLabels[eventType]}
                  onClick={() => {
                    onChange(eventType);
                    setOpen(false);
                  }}
                  selected={value === eventType}
                />
              ))}
            </section>
          ))}
        </div>
      ) : null}
    </div>
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
            <CalendarFlatFilterOption
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
          label="Category"
          onChange={(category) =>
            setFilters((current) =>
              updateCalendarCategoryFilter(
                current,
                category as CalendarCategory | "all",
              ),
            )
          }
          options={categoryItems}
          value={filters.category}
        />
        <section className={styles.mobileFilterGroup}>
          <h3>Event type</h3>
          <div className={styles.mobileFlatOptionList}>
            <CalendarFlatFilterOption
              label="All types"
              onClick={() =>
                setFilters((current) => ({ ...current, eventType: "all" }))
              }
              selected={filters.eventType === "all"}
            />
            {getVisibleTypeGroups(filters.category).map((group) => (
              <div className={styles.mobileTypeOptionGroup} key={group}>
                <h4>{calendarCategoryLabels[group]}</h4>
                {calendarEventTypeGroups[group].map((eventType) => (
                  <CalendarFlatFilterOption
                    key={eventType}
                    label={eventTypeLabels[eventType]}
                    onClick={() =>
                      setFilters((current) => ({
                        ...current,
                        eventType,
                      }))
                    }
                    selected={filters.eventType === eventType}
                  />
                ))}
              </div>
            ))}
          </div>
        </section>
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
          flat
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
          flat
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
  flat = false,
  label,
  onChange,
  options,
  value,
}: {
  flat?: boolean;
  label: string;
  onChange: (value: string) => void;
  options: readonly FilterMenuOption<string>[];
  value: string;
}) {
  const Option = flat ? CalendarFlatFilterOption : FilterOption;

  return (
    <section className={styles.mobileFilterGroup}>
      <h3>{label}</h3>
      <div className={flat ? styles.mobileFlatOptionList : undefined}>
        {options.map((option) => (
          <Option
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
