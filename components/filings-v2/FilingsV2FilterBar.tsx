"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { FilterOption } from "@/components/ui/FilterOption";
import { FilterTrigger } from "@/components/ui/FilterTrigger";
import {
  filingsV2DateOptions,
  filingsV2EventLabels,
  filingsV2EventOptions,
  filingsV2FormOptions,
  filingsV2ImpactOptions,
  filingsV2MarketCapOptions,
  filingsV2SignalLabels,
  filingsV2SignalOptions,
  type FilingsV2FilterState,
} from "@/lib/mock/filingsV2Data";
import styles from "./StockRadarFilingsV2.module.css";

type FilterKey = keyof FilingsV2FilterState;

type FilingsV2FilterBarProps = {
  filters: FilingsV2FilterState;
  isMobileSheetOpen: boolean;
  onChange: (key: FilterKey, value: string) => void;
  onOpenMobileFilters: (trigger: HTMLButtonElement) => void;
};

const desktopSections = [
  { key: "formType", label: "Form Type", options: filingsV2FormOptions },
  { key: "eventType", label: "Event Type", options: filingsV2EventOptions },
  { key: "impact", label: "Impact", options: filingsV2ImpactOptions },
  { key: "signal", label: "Signal", options: filingsV2SignalOptions },
  { key: "dateRange", label: "Date Range", options: filingsV2DateOptions },
  { key: "marketCap", label: "Market Cap", options: filingsV2MarketCapOptions },
] as const;

function optionLabel(key: FilterKey, value: string) {
  if (key === "eventType" && value !== "All") {
    return filingsV2EventLabels[value as keyof typeof filingsV2EventLabels];
  }

  if (key === "signal" && value !== "All") {
    return filingsV2SignalLabels[value as keyof typeof filingsV2SignalLabels];
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function FilingsV2FilterBar({
  filters,
  isMobileSheetOpen,
  onChange,
  onOpenMobileFilters,
}: FilingsV2FilterBarProps) {
  const [openFilter, setOpenFilter] = useState<FilterKey | "more" | null>(null);
  const [mobileOpener, setMobileOpener] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverId = "filings-v2-desktop-filter-popover";

  useEffect(() => {
    if (!openFilter) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpenFilter(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenFilter(null);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [openFilter]);

  const activeMoreCount = [filters.signal, filters.dateRange, filters.marketCap].filter(
    (value) => value !== "All",
  ).length;
  const visibleSections = openFilter === "more"
    ? desktopSections
    : desktopSections.filter((section) => section.key === openFilter);

  return (
    <div className={styles.filterRegion} ref={rootRef}>
      <div aria-label="Filing filters" className={styles.desktopFilters}>
        {desktopSections.map((section) => {
          const isOpen = openFilter === section.key;
          return (
            <FilterTrigger
              aria-controls={isOpen ? popoverId : undefined}
              expanded={isOpen}
              key={section.key}
              label={section.label}
              onClick={() => setOpenFilter((current) => current === section.key ? null : section.key)}
              trailingIcon={<ChevronDown aria-hidden="true" size={15} />}
              value={optionLabel(section.key, filters[section.key])}
            />
          );
        })}
        <FilterTrigger
          active={activeMoreCount > 0}
          aria-controls={openFilter === "more" ? popoverId : undefined}
          expanded={openFilter === "more"}
          label={activeMoreCount ? `More Filters (${activeMoreCount})` : "More Filters"}
          onClick={() => setOpenFilter((current) => current === "more" ? null : "more")}
          trailingIcon={<SlidersHorizontal aria-hidden="true" size={15} />}
        />
      </div>

      <div aria-label="Mobile filing filters" className={styles.mobileFilters}>
        {[
          { active: filters.formType !== "All", label: "Form" },
          { active: filters.eventType !== "All", label: "Event" },
          { active: filters.impact !== "All", label: "Impact" },
          { active: activeMoreCount > 0, label: "More" },
        ].map((item) => (
          <FilterTrigger
            active={item.active}
            aria-controls={isMobileSheetOpen && mobileOpener === item.label ? "filings-v2-filter-sheet" : undefined}
            aria-haspopup="dialog"
            aria-label={`${item.label} filing filters`}
            expanded={isMobileSheetOpen && mobileOpener === item.label}
            key={item.label}
            label={item.label}
            onClick={(event) => {
              setMobileOpener(item.label);
              onOpenMobileFilters(event.currentTarget);
            }}
            trailingIcon={item.label === "More"
              ? <SlidersHorizontal aria-hidden="true" size={12} />
              : <ChevronDown aria-hidden="true" size={12} />}
            variant="compact"
          />
        ))}
      </div>

      {openFilter ? (
        <div aria-label="Filter options" className={styles.desktopFilterPopover} id={popoverId} role="group">
          {visibleSections.map((section) => (
            <section className={styles.desktopFilterSection} key={section.key}>
              <h2>{section.label}</h2>
              <div className={styles.filterOptions}>
                {section.options.map((option) => {
                  const value = String(option);
                  return (
                    <FilterOption
                      key={value}
                      label={optionLabel(section.key, value)}
                      onClick={() => {
                        onChange(section.key, value);
                        if (openFilter !== "more") {
                          setOpenFilter(null);
                        }
                      }}
                      selected={filters[section.key] === value}
                    />
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}
