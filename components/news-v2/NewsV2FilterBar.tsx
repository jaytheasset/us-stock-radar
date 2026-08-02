import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { ChevronDown, Search, SlidersHorizontal, X } from "lucide-react";
import { FilterOption } from "@/components/ui/FilterOption";
import { FilterTrigger } from "@/components/ui/FilterTrigger";
import { GooglePreferredSourceLink } from "@/components/ui/GooglePreferredSourceLink";
import { TickerCompanyAutocomplete } from "@/components/ui/TickerCompanyAutocomplete";
import { NewsV2MarketCapOption } from "@/components/news-v2/NewsV2MarketCapOption";
import { getEventTypeBadge } from "@/lib/eventTypeRegistry";
import {
  newsV2MarketCapBands,
  newsV2Signals,
  getNewsV2SectorFilterLabel,
  getNewsV2ThemeFilterLabel,
  type NewsV2FilterOptions,
  type NewsV2FilterState,
} from "@/lib/newsV2";
import styles from "./StockRadarNewsV2.module.css";

export type NewsV2FilterGroup =
  | "sentiments"
  | "marketCaps"
  | "eventTypes"
  | "sources"
  | "sectors"
  | "themes";

export type NewsV2Filters = NewsV2FilterState;
export type { NewsV2FilterOptions };

export type NewsV2FilterBarProps = {
  canReset: boolean;
  filterOptions: NewsV2FilterOptions;
  filters: NewsV2Filters;
  mobileFilterOpenerRef: RefObject<HTMLButtonElement | null>;
  onClearFilterGroup: (group: NewsV2FilterGroup) => void;
  onOpenMobileFilters: () => void;
  onQueryDraftChange: (value: string) => void;
  onRemoveFilter: (group: NewsV2FilterGroup, value: string) => void;
  onReset: () => void;
  onSearch: () => void;
  onTickerSelect: (ticker: string) => void;
  onToggleFilter: (group: NewsV2FilterGroup, value: string) => void;
  preferredSourceUrl?: string | null;
  queryDraft: string;
};

type NewsV2MenuGroup = "eventTypes" | "sources" | "sectors" | "themes";

export function NewsV2FilterBar({
  canReset,
  filterOptions,
  filters,
  mobileFilterOpenerRef,
  onClearFilterGroup,
  onOpenMobileFilters,
  onQueryDraftChange,
  onRemoveFilter,
  onReset,
  onSearch,
  onTickerSelect,
  onToggleFilter,
  preferredSourceUrl,
  queryDraft,
}: NewsV2FilterBarProps) {
  const [openMenu, setOpenMenu] = useState<NewsV2MenuGroup | null>(null);
  const filterMenusRef = useRef<HTMLDivElement>(null);
  const activeFilters = getActiveFilters(filters);
  const activeCount = activeFilters.length;
  const menuGroups = [
    { group: "eventTypes" as const, label: "Event Type", options: filterOptions.eventTypes },
    { group: "sources" as const, label: "Source", options: filterOptions.sources },
    { group: "sectors" as const, label: "Sector", options: filterOptions.sectors },
    { group: "themes" as const, label: "Theme", options: filterOptions.themes },
  ];

  useEffect(() => {
    if (!openMenu) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!filterMenusRef.current?.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenMenu(null);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [openMenu]);

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSearch();
  };

  return (
    <section aria-label="News filters" className={styles.filterBar}>
      <div className={styles.filterUtilityRow}>
        <form className={styles.searchForm} id="news-v2-search-form" onSubmit={submitSearch}>
          <TickerCompanyAutocomplete
            className={styles.searchField}
            id="news-v2-ticker-company-search"
            label="Search news by ticker or company"
            onSelect={(result) => onTickerSelect(result.ticker)}
            onValueChange={onQueryDraftChange}
            placeholder="Search ticker, company, source or headline"
            value={queryDraft}
          />
          <button className={styles.searchButton} type="submit">
            <Search aria-hidden="true" className={styles.searchButtonIcon} size={18} />
            <span className={styles.searchButtonLabel}>Search</span>
          </button>
        </form>

        <div className={styles.mobileFilterActions}>
          <FilterTrigger
            active={activeCount > 0}
            aria-label={`Open news filters${activeCount ? `, ${activeCount} active` : ""}`}
            className={styles.mobileFilterTrigger}
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
            {newsV2Signals.map((sentiment) => (
              <FilterOption
                key={sentiment}
                label={sentiment}
                onClick={() => onToggleFilter("sentiments", sentiment)}
                selected={filters.sentiments.includes(sentiment)}
              />
            ))}
          </div>
        </div>

        <div className={styles.filterGroupRow}>
          <span className={styles.filterGroupLabel}>Cap</span>
          <div className={styles.filterOptionRow}>
            {newsV2MarketCapBands.map((marketCap) => (
              <NewsV2MarketCapOption
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
                  aria-controls={`news-v2-${group}-options`}
                  aria-expanded={openMenu === group}
                  className={styles.filterMenuTrigger}
                  onClick={() => setOpenMenu((current) => (current === group ? null : group))}
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
                    id={`news-v2-${group}-options`}
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
                        label={getNewsV2FilterLabel(group, option)}
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
            {activeFilters.length ? (
              activeFilters.map((filter) => (
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
              ))
            ) : (
              <span className={styles.noActiveFilters}>No active filters</span>
            )}
          </div>
          <div className={styles.filterRowActions}>
            <button className={styles.resetButton} disabled={!canReset} onClick={onReset} type="button">
              Reset
            </button>
          </div>
        </div>
      </div>

    </section>
  );
}

export function getActiveFilters(filters: NewsV2Filters) {
  return (Object.entries(filters) as Array<[NewsV2FilterGroup, string[]]>).flatMap(
    ([group, values]) =>
      values.map((value) => ({
        group,
        label: getNewsV2FilterLabel(group, value),
        value,
      })),
  );
}

export function getNewsV2FilterLabel(group: NewsV2FilterGroup, value: string) {
  if (group === "eventTypes") return getEventTypeBadge(value).label;
  if (group === "sectors") return getNewsV2SectorFilterLabel(value);
  if (group === "themes") return getNewsV2ThemeFilterLabel(value);
  return value;
}
