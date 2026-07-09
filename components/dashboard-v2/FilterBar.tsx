import { ChevronDown, SlidersHorizontal, X } from "lucide-react";
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
  onOpenMoreFilters: () => void;
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

export function FilterBar({ filterState, filters, onOpenMoreFilters, onResetFilter }: FilterBarProps) {
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
            <button className="dashboard-v2-filter" key={filter.label} type="button">
              <span>{filter.label.toUpperCase()}</span>
              <b>{filterKey ? filterState[filterKey] : filter.value}</b>
              <ChevronDown aria-hidden="true" size={15} />
            </button>
          );
        })}
        <button className="dashboard-v2-filter dashboard-v2-filter-more" type="button">
          <span>MORE FILTERS</span>
          <SlidersHorizontal aria-hidden="true" size={15} />
        </button>
      </div>

      <div className="dashboard-v2-mobile-filter-controls" aria-label="Market mover quick filters">
        {dashboardV2QuickFilterKeys.map((key) => (
          <button
            aria-label={`${dashboardV2FilterLabels[key]} filter`}
            className={`dashboard-v2-mobile-quick-filter${
              filterState[key] !== dashboardV2AllFilterValue ? " is-active" : ""
            }`}
            key={key}
            onClick={onOpenMoreFilters}
            type="button"
          >
            <span>{dashboardV2MobileFilterLabels[key]}</span>
            <ChevronDown aria-hidden="true" size={12} />
          </button>
        ))}
        <button
          className={`dashboard-v2-mobile-quick-filter dashboard-v2-mobile-quick-filter-more${
            secondaryActiveCount > 0 ? " is-active" : ""
          }`}
          onClick={onOpenMoreFilters}
          type="button"
        >
          <span>More</span>
          <SlidersHorizontal aria-hidden="true" size={12} />
        </button>
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
