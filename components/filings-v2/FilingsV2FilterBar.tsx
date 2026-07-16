"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { ChevronDown, SlidersHorizontal, X } from "lucide-react";
import { FilingsV2MarketCapOption } from "@/components/filings-v2/FilingsV2MarketCapOption";
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
  type FilingsV2FilterGroup,
  type FilingsV2FilterState,
} from "@/lib/mock/filingsV2Data";
import styles from "./StockRadarFilingsV2.module.css";

type FilingsV2FilterBarProps = {
  filters: FilingsV2FilterState;
  isMobileSheetOpen: boolean;
  mobileFilterOpenerRef: RefObject<HTMLButtonElement | null>;
  onClearFilterGroup: (group: FilingsV2FilterGroup) => void;
  onOpenMobileFilters: () => void;
  onRemoveFilter: (group: FilingsV2FilterGroup, value: string) => void;
  onReset: () => void;
  onToggleFilter: (group: FilingsV2FilterGroup, value: string) => void;
};

const menuGroups = [
  { group: "formTypes" as const, label: "Form Type", options: filingsV2FormOptions },
  { group: "eventTypes" as const, label: "Event Type", options: filingsV2EventOptions },
  { group: "impacts" as const, label: "Impact", options: filingsV2ImpactOptions },
  { group: "dateRanges" as const, label: "Date Range", options: filingsV2DateOptions },
];

type FilingsV2MenuGroup = (typeof menuGroups)[number]["group"];

function filterLabel(group: FilingsV2FilterGroup, value: string) {
  if (group === "signals") {
    return filingsV2SignalLabels[value as keyof typeof filingsV2SignalLabels];
  }
  if (group === "eventTypes") {
    return filingsV2EventLabels[value as keyof typeof filingsV2EventLabels];
  }
  return value;
}

export function getActiveFilingsV2Filters(filters: FilingsV2FilterState) {
  return (Object.entries(filters) as Array<[FilingsV2FilterGroup, string[]]>).flatMap(
    ([group, values]) => values.map((value) => ({ group, label: filterLabel(group, value), value })),
  );
}

export function FilingsV2FilterBar({
  filters,
  isMobileSheetOpen,
  mobileFilterOpenerRef,
  onClearFilterGroup,
  onOpenMobileFilters,
  onRemoveFilter,
  onReset,
  onToggleFilter,
}: FilingsV2FilterBarProps) {
  const [openMenu, setOpenMenu] = useState<FilingsV2MenuGroup | null>(null);
  const filterMenusRef = useRef<HTMLDivElement>(null);
  const activeFilters = getActiveFilingsV2Filters(filters);
  const activeCount = activeFilters.length;

  useEffect(() => {
    if (!openMenu) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!filterMenusRef.current?.contains(event.target as Node)) setOpenMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenMenu(null);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [openMenu]);

  return (
    <section aria-label="Filing filters" className={styles.filterBar}>
      <div className={styles.desktopFilterMatrix}>
        <div className={styles.filterGroupRow}>
          <span className={styles.filterGroupLabel}>Signal</span>
          <div className={styles.filterOptionRow}>
            {filingsV2SignalOptions.map((signal) => (
              <FilterOption
                key={signal}
                label={filingsV2SignalLabels[signal]}
                onClick={() => onToggleFilter("signals", signal)}
                selected={filters.signals.includes(signal)}
              />
            ))}
          </div>
        </div>

        <div className={styles.filterGroupRow}>
          <span className={styles.filterGroupLabel}>Cap</span>
          <div className={styles.filterOptionRow}>
            {filingsV2MarketCapOptions.map((marketCap) => (
              <FilingsV2MarketCapOption
                key={marketCap}
                marketCap={marketCap}
                onClick={() => onToggleFilter("marketCaps", marketCap)}
                selected={filters.marketCaps.includes(marketCap)}
              />
            ))}
          </div>
        </div>

        <div className={styles.filterMenuRow}>
          <span className={styles.filterGroupLabel}>More</span>
          <div className={styles.filterMenus} ref={filterMenusRef}>
            {menuGroups.map(({ group, label, options }) => (
              <div className={styles.filterMenu} key={group}>
                <button
                  aria-controls={openMenu === group ? `filings-v2-${group}-options` : undefined}
                  aria-expanded={openMenu === group}
                  className={styles.filterMenuTrigger}
                  onClick={() => setOpenMenu((current) => current === group ? null : group)}
                  type="button"
                >
                  <span>{label}</span>
                  {filters[group].length ? <b>{filters[group].length}</b> : null}
                  <ChevronDown aria-hidden="true" size={14} />
                </button>
                {openMenu === group ? (
                  <div
                    aria-label={`${label} options`}
                    className={styles.filterMenuOptions}
                    id={`filings-v2-${group}-options`}
                    role="group"
                  >
                    <FilterOption
                      className={styles.filterMenuOption}
                      label="All"
                      onClick={() => onClearFilterGroup(group)}
                      selected={!filters[group].length}
                    />
                    {options.map((option) => (
                      <FilterOption
                        className={styles.filterMenuOption}
                        key={option}
                        label={filterLabel(group, option)}
                        onClick={() => onToggleFilter(group, option)}
                        selected={filters[group].includes(option as never)}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        <div className={styles.activeFilterRow}>
          <span className={styles.filterGroupLabel}>Active</span>
          <div className={styles.activeFilterChips}>
            {activeFilters.length ? activeFilters.map((filter) => (
              <button
                aria-label={`Remove ${filter.label} filter`}
                className={styles.activeFilterChip}
                key={`${filter.group}-${filter.value}`}
                onClick={() => onRemoveFilter(filter.group, filter.value)}
                type="button"
              >
                {filter.label}
                <X aria-hidden="true" size={12} />
              </button>
            )) : <span className={styles.noActiveFilters}>No active filters</span>}
          </div>
          <div className={styles.filterRowActions}>
            <button className={styles.resetButton} disabled={!activeCount} onClick={onReset} type="button">
              Reset
            </button>
          </div>
        </div>
      </div>

      <div className={styles.mobileFilterActions}>
        <FilterTrigger
          active={activeCount > 0}
          aria-controls={isMobileSheetOpen ? "filings-v2-filter-sheet" : undefined}
          aria-haspopup="dialog"
          aria-label={`Open filing filters${activeCount ? `, ${activeCount} active` : ""}`}
          expanded={isMobileSheetOpen}
          label="Filters"
          onClick={onOpenMobileFilters}
          ref={mobileFilterOpenerRef}
          trailingIcon={<SlidersHorizontal aria-hidden="true" size={15} />}
          value={activeCount ? String(activeCount) : undefined}
          variant="compact"
        />
        {activeCount ? (
          <button className={styles.mobileResetButton} onClick={onReset} type="button">Reset</button>
        ) : null}
      </div>
    </section>
  );
}
