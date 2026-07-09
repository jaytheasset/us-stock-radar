import { ChevronDown, SlidersHorizontal } from "lucide-react";

type DashboardV2Filter = {
  label: string;
  value: string;
};

export function FilterBar({ filters }: { filters: DashboardV2Filter[] }) {
  return (
    <div className="dashboard-v2-filter-bar" aria-label="Market mover filters">
      {filters.map((filter) => (
        <button className="dashboard-v2-filter" key={filter.label} type="button">
          <span>{filter.label.toUpperCase()}</span>
          <b>{filter.value}</b>
          <ChevronDown aria-hidden="true" size={15} />
        </button>
      ))}
      <button className="dashboard-v2-filter dashboard-v2-filter-more" type="button">
        <span>MORE FILTERS</span>
        <SlidersHorizontal aria-hidden="true" size={15} />
      </button>
    </div>
  );
}
