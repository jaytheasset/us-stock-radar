import type { RefObject } from "react";
import { BottomSheetShell } from "@/components/ui/BottomSheetShell";
import { FilterOption } from "@/components/ui/FilterOption";
import { NewsV2MarketCapOption } from "@/components/news-v2/NewsV2MarketCapOption";
import type {
  NewsV2FilterGroup,
  NewsV2FilterOptions,
  NewsV2Filters,
} from "@/components/news-v2/NewsV2FilterBar";
import { getNewsV2FilterLabel } from "@/components/news-v2/NewsV2FilterBar";
import {
  newsV2MarketCapBands,
  newsV2Signals,
} from "@/lib/newsV2";
import styles from "./StockRadarNewsV2.module.css";

export type MobileNewsV2FilterSheetProps = {
  canReset: boolean;
  filterOptions: NewsV2FilterOptions;
  filters: NewsV2Filters;
  isOpen: boolean;
  onClearFilterGroup: (group: NewsV2FilterGroup) => void;
  onDismiss: () => void;
  onReset: () => void;
  onToggleFilter: (group: NewsV2FilterGroup, value: string) => void;
  openerRef: RefObject<HTMLElement | null>;
};

const mobileFilterHeadingId = "news-v2-mobile-filter-title";

export function MobileNewsV2FilterSheet({
  canReset,
  filterOptions,
  filters,
  isOpen,
  onClearFilterGroup,
  onDismiss,
  onReset,
  onToggleFilter,
  openerRef,
}: MobileNewsV2FilterSheetProps) {
  const mobileGroups = [
    { group: "sentiments" as const, includeAll: false, label: "Signal", options: newsV2Signals },
    { group: "marketCaps" as const, includeAll: false, label: "Market cap", options: newsV2MarketCapBands },
    { group: "eventTypes" as const, includeAll: true, label: "Event type", options: filterOptions.eventTypes },
    { group: "sources" as const, includeAll: true, label: "Source", options: filterOptions.sources },
    { group: "sectors" as const, includeAll: true, label: "Sector", options: filterOptions.sectors },
    { group: "themes" as const, includeAll: true, label: "Theme", options: filterOptions.themes },
  ];

  return (
    <BottomSheetShell
      aria-labelledby={mobileFilterHeadingId}
      closeLabel="Close news filters"
      id="news-v2-filter-sheet"
      isOpen={isOpen}
      layout="full-scroll"
      onDismiss={onDismiss}
      openerRef={openerRef}
      overlayLabel="Dismiss news filter overlay"
    >
      <div className={styles.mobileFilterSheetContent}>
        <header>
          <span>REFINE NEWS FEED</span>
          <h2 id={mobileFilterHeadingId}>Filters</h2>
          <p>Select multiple values to narrow the latest news.</p>
        </header>

        {mobileGroups.map(({ group, includeAll, label, options }) => (
          <section className={styles.mobileFilterGroup} key={group}>
            <h3>{label}</h3>
            <div>
              {includeAll ? (
                <FilterOption
                  label="All"
                  onClick={() => onClearFilterGroup(group)}
                  selected={!filters[group].length}
                />
              ) : null}
              {group === "marketCaps"
                ? newsV2MarketCapBands.map((marketCap) => (
                    <NewsV2MarketCapOption
                      key={marketCap}
                      marketCap={marketCap}
                      onClick={() => onToggleFilter("marketCaps", marketCap)}
                      selected={filters.marketCaps.includes(marketCap)}
                    />
                  ))
                : options.map((option) => (
                    <FilterOption
                      key={option}
                      label={getNewsV2FilterLabel(group, option)}
                      onClick={() => onToggleFilter(group, option)}
                      selected={filters[group].includes(option as never)}
                    />
                  ))}
            </div>
          </section>
        ))}

        <footer className={styles.mobileFilterSheetActions}>
          <button
            className={styles.secondaryAction}
            disabled={!canReset}
            onClick={onReset}
            type="button"
          >
            Reset all
          </button>
          <button className={styles.primaryAction} onClick={onDismiss} type="button">Done</button>
        </footer>
      </div>
    </BottomSheetShell>
  );
}
