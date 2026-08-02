"use client";

import { useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { BottomSheetShell } from "@/components/ui/BottomSheetShell";
import { FilterOption } from "@/components/ui/FilterOption";
import {
  formatCompactRangeLabel,
  getPresetDateRange,
  normalizeDateRange,
  shiftDateRange,
} from "@/lib/calendar-v1/dateUtils";
import type {
  CalendarDateRange,
  CalendarRangePreset,
} from "@/lib/calendar-v1/model";
import styles from "./CalendarV1.module.css";

const presetOptions = [
  { label: "Today", value: "today" },
  { label: "This week", value: "this-week" },
  { label: "Next week", value: "next-week" },
  { label: "Custom", value: "custom" },
] as const satisfies readonly {
  label: string;
  value: CalendarRangePreset;
}[];

export function MobileCalendarDateNavigation({
  onRangeChange,
  preset,
  range,
  today,
}: {
  onRangeChange: (
    range: CalendarDateRange,
    preset: CalendarRangePreset,
  ) => void;
  preset: CalendarRangePreset;
  range: CalendarDateRange;
  today: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [draftPreset, setDraftPreset] =
    useState<CalendarRangePreset>(preset);
  const [draftRange, setDraftRange] = useState<CalendarDateRange>(range);
  const openerRef = useRef<HTMLElement | null>(null);
  const fromInputRef = useRef<HTMLInputElement>(null);
  const toInputRef = useRef<HTMLInputElement>(null);
  const sheetTitleId = "calendar-mobile-range-title";

  function openSheet(opener: HTMLElement) {
    openerRef.current = opener;
    setDraftPreset(preset);
    setDraftRange(range);
    setIsOpen(true);
  }

  function applyPreset(nextPreset: CalendarRangePreset) {
    setDraftPreset(nextPreset);
    if (nextPreset === "custom") return;

    onRangeChange(getPresetDateRange(nextPreset, today), nextPreset);
    setIsOpen(false);
  }

  function applyCustomRange() {
    onRangeChange(
      normalizeDateRange({
        from: fromInputRef.current?.value || draftRange.from,
        to: toInputRef.current?.value || draftRange.to,
      }),
      "custom",
    );
    setIsOpen(false);
  }

  return (
    <>
      <div
        aria-label="Mobile date navigation"
        className={styles.mobileDateNavigation}
        role="group"
      >
        <button
          aria-label="Previous period"
          onClick={() =>
            onRangeChange(shiftDateRange(range, -1), "custom")
          }
          type="button"
        >
          <ChevronLeft aria-hidden="true" size={18} />
        </button>
        <button
          aria-controls="calendar-mobile-range-sheet"
          aria-expanded={isOpen}
          aria-haspopup="dialog"
          className={styles.mobileRangeLabel}
          onClick={(event) => openSheet(event.currentTarget)}
          type="button"
        >
          {formatCompactRangeLabel(range)}
        </button>
        <button
          aria-label="Next period"
          onClick={() =>
            onRangeChange(shiftDateRange(range, 1), "custom")
          }
          type="button"
        >
          <ChevronRight aria-hidden="true" size={18} />
        </button>
        <button
          aria-controls="calendar-mobile-range-sheet"
          aria-expanded={isOpen}
          aria-haspopup="dialog"
          aria-label={`Choose date range, ${formatCompactRangeLabel(range)}`}
          onClick={(event) => openSheet(event.currentTarget)}
          type="button"
        >
          <CalendarDays aria-hidden="true" size={17} />
        </button>
      </div>

      <BottomSheetShell
        aria-labelledby={sheetTitleId}
        closeLabel="Close date range"
        id="calendar-mobile-range-sheet"
        isOpen={isOpen}
        layout="full-scroll"
        onDismiss={() => setIsOpen(false)}
        openerRef={openerRef}
        overlayLabel="Dismiss date range"
        surfaceClassName={styles.calendarMobileSheetSurface}
      >
        <div
          className={styles.mobileRangeSheet}
          data-mobile-calendar-range-sheet
        >
          <header>
            <span>DATE RANGE</span>
            <h2 id={sheetTitleId}>Choose calendar range</h2>
            <p>Move quickly or choose a custom date range.</p>
          </header>

          <div className={styles.mobileRangeOptions}>
            {presetOptions.map((option) => (
              <FilterOption
                key={option.value}
                label={option.label}
                onClick={() => applyPreset(option.value)}
                selected={draftPreset === option.value}
              />
            ))}
          </div>

          {draftPreset === "custom" ? (
            <section
              aria-label="Custom date range"
              className={styles.mobileCustomRange}
            >
              <label>
                <span>From</span>
                <input
                  aria-label="From date"
                  onChange={(event) => {
                    const from = event.currentTarget.value;
                    setDraftRange((current) => ({
                      ...current,
                      from,
                    }));
                  }}
                  ref={fromInputRef}
                  type="date"
                  value={draftRange.from}
                />
              </label>
              <label>
                <span>To</span>
                <input
                  aria-label="To date"
                  onChange={(event) => {
                    const to = event.currentTarget.value;
                    setDraftRange((current) => ({
                      ...current,
                      to,
                    }));
                  }}
                  ref={toInputRef}
                  type="date"
                  value={draftRange.to}
                />
              </label>
              <button onClick={applyCustomRange} type="button">
                Apply range
              </button>
            </section>
          ) : null}
        </div>
      </BottomSheetShell>
    </>
  );
}
