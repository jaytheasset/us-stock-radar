"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { FilterOption } from "@/components/ui/FilterOption";
import {
  dashboardV2FilterSections,
  type DashboardV2FilterKey,
  type DashboardV2FilterState,
} from "@/components/dashboard-v2/dashboardV2FilterConfig";

type MobileFilterBottomSheetProps = {
  filterState: DashboardV2FilterState;
  isOpen: boolean;
  onChangeFilter: (key: DashboardV2FilterKey, value: string) => void;
  onClearFilters: () => void;
  onClose: () => void;
};

export function MobileFilterBottomSheet({
  filterState,
  isOpen,
  onChangeFilter,
  onClearFilters,
  onClose,
}: MobileFilterBottomSheetProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus({ preventScroll: true });

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      aria-labelledby="dashboard-v2-filter-sheet-title"
      aria-modal="true"
      className="dashboard-v2-mobile-filter-sheet-root"
      id="dashboard-v2-filter-sheet"
      role="dialog"
    >
      <button
        aria-label="Close filters"
        className="dashboard-v2-mobile-filter-sheet-overlay"
        onClick={onClose}
        type="button"
      />
      <section className="dashboard-v2-mobile-filter-sheet">
        <div className="dashboard-v2-mobile-filter-sheet-handle" aria-hidden="true" />
        <button
          aria-label="Close filters"
          className="dashboard-v2-mobile-filter-sheet-close"
          onClick={onClose}
          ref={closeButtonRef}
          type="button"
        >
          <X aria-hidden="true" size={18} />
        </button>

        <header className="dashboard-v2-mobile-filter-sheet-header">
          <h2 id="dashboard-v2-filter-sheet-title">Filters</h2>
        </header>

        <div className="dashboard-v2-mobile-filter-sheet-content">
          {dashboardV2FilterSections.map((section) => (
            <section className="dashboard-v2-mobile-filter-section" key={section.key}>
              <h3>{section.title}</h3>
              <div aria-label={`${section.title} options`} className="dashboard-v2-mobile-filter-options" role="group">
                {section.options.map((option) => {
                  const isActive = filterState[section.key] === option;

                  return (
                    <FilterOption
                      key={option}
                      label={option}
                      onClick={() => onChangeFilter(section.key, option)}
                      selected={isActive}
                    />
                  );
                })}
              </div>
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
      </section>
    </div>
  );
}
