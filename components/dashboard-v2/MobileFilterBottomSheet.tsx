"use client";

import type { RefObject } from "react";
import { FilterOption } from "@/components/ui/FilterOption";
import { BottomSheetShell } from "@/components/ui/BottomSheetShell";
import {
  getDashboardV2FilterOptionLabel,
  type DashboardV2FilterKey,
  type DashboardV2FilterSection,
  type DashboardV2FilterState,
} from "@/components/dashboard-v2/dashboardV2FilterConfig";

type MobileFilterBottomSheetProps = {
  filterState: DashboardV2FilterState;
  isOpen: boolean;
  onChangeFilter: (key: DashboardV2FilterKey, value: string) => void;
  onClearFilters: () => void;
  onClose: () => void;
  openerRef: RefObject<HTMLElement | null>;
  sections: DashboardV2FilterSection[];
};

export function MobileFilterBottomSheet({
  filterState,
  isOpen,
  onChangeFilter,
  onClearFilters,
  onClose,
  openerRef,
  sections,
}: MobileFilterBottomSheetProps) {
  return (
    <BottomSheetShell
      aria-labelledby="dashboard-v2-filter-sheet-title"
      closeLabel="Close filters"
      id="dashboard-v2-filter-sheet"
      isOpen={isOpen}
      layout="content-footer"
      onDismiss={onClose}
      openerRef={openerRef}
      overlayLabel="Close filters"
    >
      <header className="dashboard-v2-mobile-filter-sheet-header">
        <h2 id="dashboard-v2-filter-sheet-title">Filters</h2>
      </header>

      <div className="dashboard-v2-mobile-filter-sheet-content">
        {sections.map((section) => (
          <section className="dashboard-v2-mobile-filter-section" key={section.key}>
            <h3>{section.title}</h3>
            {section.available ? (
              <div aria-label={`${section.title} options`} className="dashboard-v2-mobile-filter-options" role="group">
                {section.options.map((option) => {
                  const isActive = filterState[section.key] === option;

                  return (
                    <FilterOption
                      key={option}
                      label={getDashboardV2FilterOptionLabel(section.key, option)}
                      onClick={() => onChangeFilter(section.key, option)}
                      selected={isActive}
                    />
                  );
                })}
              </div>
            ) : (
              <p className="dashboard-v2-mobile-filter-unavailable">
                Unavailable for this market view
              </p>
            )}
          </section>
        ))}
      </div>

      <footer className="dashboard-v2-mobile-filter-sheet-actions">
        <button className="dashboard-v2-mobile-filter-clear" onClick={onClearFilters} type="button">
          Clear all
        </button>
        <button className="dashboard-v2-mobile-filter-apply" onClick={onClose} type="button">
          Apply filters
        </button>
      </footer>
    </BottomSheetShell>
  );
}
