import { ChevronDown, SlidersHorizontal, X } from "lucide-react";
import { FilterTrigger } from "@/components/ui/FilterTrigger";
import {
  dashboardV2AllFilterValue,
  dashboardV2FilterLabels,
  dashboardV2MobileFilterLabels,
  dashboardV2QuickFilterKeys,
  getDashboardV2FilterChipLabel,
  type DashboardV2FilterKey,
  type DashboardV2FilterState,
} from "@/components/dashboard-v2/dashboardV2FilterConfig";

type DashboardV2Filter = {
  label: string;
  value: string;
};

type FilterBarProps = {
  filterState: DashboardV2FilterState;
  filters: DashboardV2Filter[];
  isMobileFilterOpen: boolean;
  onOpenMoreFilters: (trigger: HTMLButtonElement) => void;
  onResetFilter: (key: DashboardV2FilterKey) => void;
};

const desktopFilterKeyByLabel: Record<string, DashboardV2FilterKey> = {
  "Market Cap": "marketCap",
  Price: "price",
  Volume: "volume",
  "Event Type": "eventType",
  Signal: "signal",
};

const dashboardV2QuickFilterKeySet = new Set<DashboardV2FilterKey>(dashboardV2QuickFilterKeys);

export function FilterBar({
  filterState,
  filters,
  isMobileFilterOpen,
  onOpenMoreFilters,
  onResetFilter,
}: FilterBarProps) {
  const activeFilters = (Object.keys(filterState) as DashboardV2FilterKey[]).filter(
    (key) => filterState[key] !== dashboardV2AllFilterValue,
  );
  const secondaryActiveCount = activeFilters.filter((key) => !dashboardV2QuickFilterKeySet.has(key)).length;

  return (
    <>
      <div className="dashboard-v2-filter-bar" aria-label="Market mover filters">
        {filters.map((filter) => {
          const filterKey = desktopFilterKeyByLabel[filter.label];

          return (
            <FilterTrigger
              key={filter.label}
              label={filter.label.toUpperCase()}
              trailingIcon={<ChevronDown aria-hidden="true" size={15} />}
              value={filterKey ? filterState[filterKey] : filter.value}
            />
          );
        })}
        <FilterTrigger
          label="MORE FILTERS"
          trailingIcon={<SlidersHorizontal aria-hidden="true" size={15} />}
        />
      </div>

      <div className="dashboard-v2-mobile-filter-controls" aria-label="Market mover quick filters">
        {dashboardV2QuickFilterKeys.map((key) => (
          <FilterTrigger
            active={filterState[key] !== dashboardV2AllFilterValue}
            aria-controls={isMobileFilterOpen ? "dashboard-v2-filter-sheet" : undefined}
            aria-haspopup="dialog"
            aria-label={`${dashboardV2FilterLabels[key]} filter`}
            expanded={isMobileFilterOpen}
            key={key}
            label={dashboardV2MobileFilterLabels[key]}
            onClick={(event) => onOpenMoreFilters(event.currentTarget)}
            trailingIcon={<ChevronDown aria-hidden="true" size={12} />}
            variant="compact"
          />
        ))}
        <FilterTrigger
          active={secondaryActiveCount > 0}
          aria-controls={isMobileFilterOpen ? "dashboard-v2-filter-sheet" : undefined}
          aria-haspopup="dialog"
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
            <button className="dashboard-v2-mobile-filter-chip" key={key} onClick={() => onResetFilter(key)} type="button">
              <span>{getDashboardV2FilterChipLabel(key, filterState[key])}</span>
              <X aria-hidden="true" size={12} />
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
