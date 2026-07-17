import { ChevronDown, SlidersHorizontal, X } from "lucide-react";
import { FilterOption } from "@/components/ui/FilterOption";
import { FilterTrigger } from "@/components/ui/FilterTrigger";
import {
  alertsV2EventOptions,
  alertsV2ImpactOptions,
  alertsV2ScopeOptions,
  alertsV2StatusOptions,
  type AlertsV2FilterState,
} from "@/lib/mock/alertsV2Data";
import styles from "./StockRadarAlertsV2.module.css";

export type AlertsV2FilterKey = keyof AlertsV2FilterState;

const filterLabels: Record<AlertsV2FilterKey, string> = {
  eventType: "Event Type",
  impact: "Impact",
  scope: "Watchlist",
  status: "Status",
};

const filterOptions = {
  eventType: alertsV2EventOptions,
  impact: alertsV2ImpactOptions,
  scope: alertsV2ScopeOptions,
  status: alertsV2StatusOptions,
};

function selectedLabel<Key extends AlertsV2FilterKey>(key: Key, value: AlertsV2FilterState[Key]) {
  const option = filterOptions[key].find((item) => item.value === value);
  return option?.label ?? "All";
}

export function AlertsV2FilterBar({
  activePopover,
  filters,
  isMobileFilterOpen,
  onChange,
  onClear,
  onMobileFiltersOpen,
  onTogglePopover,
}: {
  activePopover: AlertsV2FilterKey | null;
  filters: AlertsV2FilterState;
  isMobileFilterOpen: boolean;
  onChange: <Key extends AlertsV2FilterKey>(key: Key, value: AlertsV2FilterState[Key]) => void;
  onClear: () => void;
  onMobileFiltersOpen: (opener: HTMLButtonElement) => void;
  onTogglePopover: (key: AlertsV2FilterKey) => void;
}) {
  const hasActiveFilters = Object.values(filters).some((value) => value !== "all");
  const desktopFilters = ["status", "impact", "eventType", "scope"] as const;

  return (
    <div className={styles.filterArea}>
      <div className={styles.desktopFilters}>
        {desktopFilters.map((key) => {
          const popoverId = `alerts-v2-${key}-options`;
          const isOpen = activePopover === key;
          const options = filterOptions[key];

          return (
            <div className={styles.filterControl} key={key}>
              <FilterTrigger
                aria-controls={isOpen ? popoverId : undefined}
                expanded={isOpen}
                label={filterLabels[key]}
                onClick={() => onTogglePopover(key)}
                trailingIcon={<ChevronDown aria-hidden="true" size={15} />}
                value={selectedLabel(key, filters[key])}
              />
              {isOpen ? (
                <div
                  aria-label={`${filterLabels[key]} options`}
                  className={styles.filterPopover}
                  id={popoverId}
                  role="group"
                >
                  {options.map((option) => (
                    <FilterOption
                      key={option.value}
                      label={option.label}
                      onClick={() => onChange(key, option.value as AlertsV2FilterState[typeof key])}
                      selected={filters[key] === option.value}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
        <FilterTrigger
          label="More Filters"
          trailingIcon={<SlidersHorizontal aria-hidden="true" size={15} />}
        />
        {hasActiveFilters ? (
          <button className={styles.clearFilters} onClick={onClear} type="button">
            <X aria-hidden="true" size={14} />
            Clear
          </button>
        ) : null}
      </div>

      <div className={styles.mobileFilters}>
        <FilterTrigger
          active={filters.status !== "all"}
          aria-controls={isMobileFilterOpen ? "alerts-v2-filter-sheet" : undefined}
          aria-haspopup="dialog"
          aria-label="Status filter"
          expanded={isMobileFilterOpen}
          label="Status"
          onClick={(event) => onMobileFiltersOpen(event.currentTarget)}
          trailingIcon={<ChevronDown aria-hidden="true" size={12} />}
          variant="compact"
        />
        <FilterTrigger
          active={filters.impact !== "all"}
          aria-controls={isMobileFilterOpen ? "alerts-v2-filter-sheet" : undefined}
          aria-haspopup="dialog"
          aria-label="Impact filter"
          expanded={isMobileFilterOpen}
          label="Impact"
          onClick={(event) => onMobileFiltersOpen(event.currentTarget)}
          trailingIcon={<ChevronDown aria-hidden="true" size={12} />}
          variant="compact"
        />
        <FilterTrigger
          active={hasActiveFilters}
          aria-controls={isMobileFilterOpen ? "alerts-v2-filter-sheet" : undefined}
          aria-haspopup="dialog"
          aria-label="More alert filters"
          expanded={isMobileFilterOpen}
          label="More"
          onClick={(event) => onMobileFiltersOpen(event.currentTarget)}
          trailingIcon={<SlidersHorizontal aria-hidden="true" size={12} />}
          variant="compact"
        />
      </div>
    </div>
  );
}
