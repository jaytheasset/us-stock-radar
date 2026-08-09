"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, SlidersHorizontal, X } from "lucide-react";
import { FilterOption } from "@/components/ui/FilterOption";
import { FilterTrigger } from "@/components/ui/FilterTrigger";
import {
  getDashboardV2FilterOptionLabel,
  dashboardV2AllFilterValue,
  dashboardV2DesktopFilterKeys,
  dashboardV2FilterLabels,
  dashboardV2MobileFilterLabels,
  dashboardV2QuickFilterKeys,
  getDashboardV2FilterChipLabel,
  hasDashboardV2ActiveFilters,
  type DashboardV2FilterKey,
  type DashboardV2FilterSection,
  type DashboardV2FilterState,
} from "@/components/dashboard-v2/dashboardV2FilterConfig";

type FilterBarProps = {
  filterState: DashboardV2FilterState;
  isMobileFilterOpen: boolean;
  onChangeFilter: (key: DashboardV2FilterKey, value: string) => void;
  onClearFilters: () => void;
  onOpenMoreFilters: (trigger: HTMLButtonElement) => void;
  onResetFilter: (key: DashboardV2FilterKey) => void;
  sections: DashboardV2FilterSection[];
};

const dashboardV2QuickFilterKeySet = new Set<DashboardV2FilterKey>(dashboardV2QuickFilterKeys);

export function FilterBar({
  filterState,
  isMobileFilterOpen,
  onChangeFilter,
  onClearFilters,
  onOpenMoreFilters,
  onResetFilter,
  sections,
}: FilterBarProps) {
  const [openFilterKey, setOpenFilterKey] = useState<DashboardV2FilterKey | null>(null);
  const desktopBarRef = useRef<HTMLDivElement>(null);
  const sectionByKey = new Map(sections.map((section) => [section.key, section]));
  const activeFilters = (Object.keys(filterState) as DashboardV2FilterKey[]).filter(
    (key) => filterState[key] !== dashboardV2AllFilterValue,
  );
  const secondaryActiveCount = activeFilters.filter(
    (key) => !dashboardV2QuickFilterKeySet.has(key),
  ).length;
  const hasActiveFilters = hasDashboardV2ActiveFilters(filterState);

  useEffect(() => {
    if (!openFilterKey) return;

    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !desktopBarRef.current?.contains(event.target)) {
        setOpenFilterKey(null);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenFilterKey(null);
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [openFilterKey]);

  function selectFilter(key: DashboardV2FilterKey, value: string) {
    onChangeFilter(key, value);
    setOpenFilterKey(null);
  }

  return (
    <>
      <div
        className="dashboard-v2-filter-bar"
        aria-label="Market mover filters"
        ref={desktopBarRef}
      >
        {dashboardV2DesktopFilterKeys.map((key) => {
          const section = sectionByKey.get(key);
          if (!section) return null;
          return (
            <DesktopFilter
              filterState={filterState}
              isOpen={openFilterKey === key}
              key={key}
              onSelect={selectFilter}
              onToggle={setOpenFilterKey}
              section={section}
            />
          );
        })}
        {sectionByKey.has("impact") ? (
          <DesktopFilter
            filterState={filterState}
            isOpen={openFilterKey === "impact"}
            label="MORE FILTERS"
            onSelect={selectFilter}
            onToggle={setOpenFilterKey}
            section={sectionByKey.get("impact")!}
            trailingIcon={<SlidersHorizontal aria-hidden="true" size={15} />}
          />
        ) : null}
        {hasActiveFilters ? (
          <FilterTrigger
            aria-label="Clear all market mover filters"
            label="CLEAR ALL"
            onClick={onClearFilters}
            trailingIcon={<X aria-hidden="true" size={15} />}
          />
        ) : null}
      </div>

      <div className="dashboard-v2-mobile-filter-controls" aria-label="Market mover quick filters">
        {dashboardV2QuickFilterKeys.map((key) => {
          const section = sectionByKey.get(key);
          const available = section?.available ?? false;
          return (
            <FilterTrigger
              active={available && filterState[key] !== dashboardV2AllFilterValue}
              aria-controls={isMobileFilterOpen ? "dashboard-v2-filter-sheet" : undefined}
              aria-haspopup="dialog"
              aria-label={`${dashboardV2FilterLabels[key]} filter${available ? "" : " unavailable"}`}
              className="dashboard-v2-mobile-quick-filter"
              disabled={!available}
              expanded={isMobileFilterOpen}
              key={key}
              label={dashboardV2MobileFilterLabels[key]}
              onClick={(event) => onOpenMoreFilters(event.currentTarget)}
              trailingIcon={<ChevronDown aria-hidden="true" size={12} />}
              variant="compact"
            />
          );
        })}
        <FilterTrigger
          active={secondaryActiveCount > 0}
          aria-controls={isMobileFilterOpen ? "dashboard-v2-filter-sheet" : undefined}
          aria-haspopup="dialog"
          className="dashboard-v2-mobile-quick-filter"
          expanded={isMobileFilterOpen}
          label="More"
          onClick={(event) => onOpenMoreFilters(event.currentTarget)}
          trailingIcon={<SlidersHorizontal aria-hidden="true" size={12} />}
          variant="compact"
        />
      </div>

      {activeFilters.length > 0 ? (
        <div className="dashboard-v2-mobile-filter-chips" aria-label="Active filters">
          {activeFilters.map((key) => (
            <button
              className="dashboard-v2-mobile-filter-chip"
              key={key}
              onClick={() => onResetFilter(key)}
              type="button"
            >
              <span>{getDashboardV2FilterChipLabel(key, filterState[key])}</span>
              <X aria-hidden="true" size={12} />
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}

function DesktopFilter({
  filterState,
  isOpen,
  label,
  onSelect,
  onToggle,
  section,
  trailingIcon = <ChevronDown aria-hidden="true" size={15} />,
}: {
  filterState: DashboardV2FilterState;
  isOpen: boolean;
  label?: string;
  onSelect: (key: DashboardV2FilterKey, value: string) => void;
  onToggle: (key: DashboardV2FilterKey | null) => void;
  section: DashboardV2FilterSection;
  trailingIcon?: ReactNode;
}) {
  const menuId = `dashboard-v2-desktop-filter-${section.key}`;
  const value = section.available ? filterState[section.key] : "Unavailable";

  return (
    <div className="dashboard-v2-desktop-filter">
      <FilterTrigger
        active={section.available && value !== dashboardV2AllFilterValue}
        aria-controls={isOpen ? menuId : undefined}
        aria-haspopup="true"
        disabled={!section.available}
        expanded={isOpen}
        label={(label || section.title).toUpperCase()}
        onClick={() => onToggle(isOpen ? null : section.key)}
        trailingIcon={trailingIcon}
        value={value}
      />
      {isOpen ? (
        <div
          aria-label={`${section.title} options`}
          className="dashboard-v2-desktop-filter-menu"
          id={menuId}
          role="group"
        >
          {section.options.map((option) => (
            <FilterOption
              key={option}
              label={getDashboardV2FilterOptionLabel(section.key, option)}
              onClick={() => onSelect(section.key, option)}
              selected={filterState[section.key] === option}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
