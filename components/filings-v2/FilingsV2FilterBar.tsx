"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { ChevronDown, Search, SlidersHorizontal, X } from "lucide-react";
import { FilingsV2MarketCapOption } from "@/components/filings-v2/FilingsV2MarketCapOption";
import { FilterOption } from "@/components/ui/FilterOption";
import { FilterTrigger } from "@/components/ui/FilterTrigger";
import { GooglePreferredSourceLink } from "@/components/ui/GooglePreferredSourceLink";
import { TickerCompanyAutocomplete } from "@/components/ui/TickerCompanyAutocomplete";
import {
  filingsV2DateOptions,
  filingsV2EventLabels,
  filingsV2EventOptions,
  filingsV2ImpactOptions,
  filingsV2MarketCapOptions,
  filingsV2SignalLabels,
  filingsV2SignalOptions,
  type FilingsV2FilterGroup,
  type FilingsV2FilterState,
} from "@/lib/filingsV2Model";
import {
  filingsV2FilingGroupLabel,
  filingsV2FilingGroupOptions,
} from "@/lib/filingsV2FilingGroups";
import styles from "./StockRadarFilingsV2.module.css";

type FilingsV2FilterBarProps = {
  appliedQuery: string;
  filters: FilingsV2FilterState;
  isMobileSheetOpen: boolean;
  mobileFilterOpenerRef: RefObject<HTMLButtonElement | null>;
  onClearQuery: () => void;
  onClearFilterGroup: (group: FilingsV2FilterGroup) => void;
  onOpenMobileFilters: () => void;
  onQueryChange: (value: string) => void;
  onRemoveFilter: (group: FilingsV2FilterGroup, value: string) => void;
  onReset: () => void;
  onSearch: () => void;
  onTickerSelect: (ticker: string) => void;
  onToggleFilter: (group: FilingsV2FilterGroup, value: string) => void;
  preferredSourceUrl?: string | null;
  query: string;
};

type FilingsV2MenuGroup = "filingGroups" | "eventTypes" | "impacts" | "dateRanges";

function filterLabel(group: FilingsV2FilterGroup, value: string) {
  if (group === "signals") {
    return filingsV2SignalLabels[value as keyof typeof filingsV2SignalLabels];
  }
  if (group === "eventTypes") {
    return filingsV2EventLabels[value as keyof typeof filingsV2EventLabels];
  }
  if (group === "filingGroups") {
    return filingsV2FilingGroupLabel[
      value as keyof typeof filingsV2FilingGroupLabel
    ];
  }
  return value;
}

export function getActiveFilingsV2Filters(filters: FilingsV2FilterState) {
  return (Object.entries(filters) as Array<[FilingsV2FilterGroup, string[]]>).flatMap(
    ([group, values]) => values.map((value) => ({ group, label: filterLabel(group, value), value })),
  );
}

export function FilingsV2FilterBar({
  appliedQuery,
  filters,
  isMobileSheetOpen,
  mobileFilterOpenerRef,
  onClearQuery,
  onClearFilterGroup,
  onOpenMobileFilters,
  onQueryChange,
  onRemoveFilter,
  onReset,
  onSearch,
  onTickerSelect,
  onToggleFilter,
  preferredSourceUrl,
  query,
}: FilingsV2FilterBarProps) {
  const menuGroups = [
    {
      group: "filingGroups" as const,
      label: "Filing Group",
      options: filingsV2FilingGroupOptions,
    },
    {
      group: "eventTypes" as const,
      label: "Event Type",
      options: filingsV2EventOptions.map((value) => ({
        label: filingsV2EventLabels[value],
        value,
      })),
    },
    {
      group: "impacts" as const,
      label: "Impact",
      options: filingsV2ImpactOptions.map((value) => ({ label: value, value })),
    },
    {
      group: "dateRanges" as const,
      label: "Date Range",
      options: filingsV2DateOptions.map((value) => ({ label: value, value })),
    },
  ];
  const [openMenu, setOpenMenu] = useState<FilingsV2MenuGroup | null>(null);
  const filterMenusRef = useRef<HTMLDivElement>(null);
  const activeFilters = getActiveFilingsV2Filters(filters);
  const normalizedAppliedQuery = appliedQuery.trim();
  const activeCount = activeFilters.length + (normalizedAppliedQuery ? 1 : 0);
  const hasResettableState = activeCount > 0 || query.trim().length > 0;

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
      <div className={styles.filterUtilityRow}>
        <form
          className={styles.searchForm}
          onSubmit={(event) => {
            event.preventDefault();
            onSearch();
          }}
          role="search"
        >
          <TickerCompanyAutocomplete
            className={styles.searchControl}
            id="filings-v2-ticker-company-search"
            label="Search filings by ticker or company"
            onSelect={(result) => onTickerSelect(result.ticker)}
            onValueChange={onQueryChange}
            placeholder="Search ticker, company or filing"
            value={query}
          />
          <button aria-label="Search" className={styles.searchButton} type="submit">
            <Search aria-hidden="true" className={styles.searchButtonIcon} size={18} />
            <span className={styles.searchButtonLabel}>Search</span>
          </button>
        </form>

        <div className={styles.mobileFilterActions}>
          <FilterTrigger
            active={activeCount > 0}
            aria-controls={isMobileSheetOpen ? "filings-v2-filter-sheet" : undefined}
            aria-haspopup="dialog"
            aria-label={`Open filing filters${activeCount ? `, ${activeCount} active` : ""}`}
            className={styles.mobileFilterTrigger}
            expanded={isMobileSheetOpen}
            label="Filters"
            onClick={onOpenMobileFilters}
            ref={mobileFilterOpenerRef}
            trailingIcon={<SlidersHorizontal aria-hidden="true" size={15} />}
            value={activeCount ? String(activeCount) : undefined}
            variant="compact"
          />
        </div>

        {preferredSourceUrl ? (
          <div className={styles.mobilePreferredSourceLink}>
            <GooglePreferredSourceLink
              ariaLabel="Add Stock Radar on Google"
              header
              href={preferredSourceUrl}
            />
          </div>
        ) : null}
      </div>

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
                        key={option.value}
                        label={option.label}
                        onClick={() => onToggleFilter(group, option.value)}
                        selected={filters[group].includes(option.value as never)}
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
            {normalizedAppliedQuery ? (
              <button
                aria-label={`Remove ${normalizedAppliedQuery} search`}
                className={styles.activeFilterChip}
                onClick={onClearQuery}
                type="button"
              >
                Search: {normalizedAppliedQuery}
                <X aria-hidden="true" size={12} />
              </button>
            ) : null}
            {activeFilters.map((filter) => (
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
            ))}
            {!activeCount ? <span className={styles.noActiveFilters}>No active filters</span> : null}
          </div>
          <div className={styles.filterRowActions}>
            <button className={styles.resetButton} disabled={!hasResettableState} onClick={onReset} type="button">
              Reset
            </button>
          </div>
        </div>
      </div>

    </section>
  );
}
