import type { RefObject } from "react";
import { FilingsV2MarketCapOption } from "@/components/filings-v2/FilingsV2MarketCapOption";
import { BottomSheetShell } from "@/components/ui/BottomSheetShell";
import { FilterOption } from "@/components/ui/FilterOption";
import {
  filingsV2DateOptions,
  filingsV2EventLabels,
  filingsV2EventOptions,
  filingsV2FormOptions,
  filingsV2ImpactOptions,
  filingsV2MarketCapOptions,
  filingsV2SignalLabels,
  filingsV2SignalOptions,
  type FilingsV2FilterGroup,
  type FilingsV2FilterState,
} from "@/lib/mock/filingsV2Data";
import styles from "./StockRadarFilingsV2.module.css";

type MobileFilingsV2FilterSheetProps = {
  filters: FilingsV2FilterState;
  isOpen: boolean;
  onClearFilterGroup: (group: FilingsV2FilterGroup) => void;
  onDismiss: () => void;
  onReset: () => void;
  onToggleFilter: (group: FilingsV2FilterGroup, value: string) => void;
  openerRef: RefObject<HTMLElement | null>;
};

const mobileGroups = [
  { group: "signals" as const, includeAll: false, label: "Signal", options: filingsV2SignalOptions },
  { group: "marketCaps" as const, includeAll: false, label: "Market cap", options: filingsV2MarketCapOptions },
  { group: "formTypes" as const, includeAll: true, label: "Form type", options: filingsV2FormOptions },
  { group: "eventTypes" as const, includeAll: true, label: "Event type", options: filingsV2EventOptions },
  { group: "impacts" as const, includeAll: true, label: "Impact", options: filingsV2ImpactOptions },
  { group: "dateRanges" as const, includeAll: true, label: "Date range", options: filingsV2DateOptions },
];

function optionLabel(group: FilingsV2FilterGroup, value: string) {
  if (group === "signals") {
    return filingsV2SignalLabels[value as keyof typeof filingsV2SignalLabels];
  }
  if (group === "eventTypes") {
    return filingsV2EventLabels[value as keyof typeof filingsV2EventLabels];
  }
  return value;
}

const mobileFilterHeadingId = "filings-v2-mobile-filter-title";

export function MobileFilingsV2FilterSheet({
  filters,
  isOpen,
  onClearFilterGroup,
  onDismiss,
  onReset,
  onToggleFilter,
  openerRef,
}: MobileFilingsV2FilterSheetProps) {
  return (
    <BottomSheetShell
      aria-labelledby={mobileFilterHeadingId}
      closeLabel="Close filing filters"
      id="filings-v2-filter-sheet"
      isOpen={isOpen}
      layout="full-scroll"
      onDismiss={onDismiss}
      openerRef={openerRef}
      overlayLabel="Dismiss filing filter overlay"
    >
      <div className={styles.mobileFilterSheetContent}>
        <header>
          <span>REFINE FILINGS</span>
          <h2 id={mobileFilterHeadingId}>Filters</h2>
          <p>Select multiple values to narrow the mock filing list.</p>
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
                ? filingsV2MarketCapOptions.map((marketCap) => (
                    <FilingsV2MarketCapOption
                      key={marketCap}
                      marketCap={marketCap}
                      onClick={() => onToggleFilter("marketCaps", marketCap)}
                      selected={filters.marketCaps.includes(marketCap)}
                    />
                  ))
                : options.map((option) => (
                    <FilterOption
                      key={option}
                      label={optionLabel(group, option)}
                      onClick={() => onToggleFilter(group, option)}
                      selected={filters[group].includes(option as never)}
                    />
                  ))}
            </div>
          </section>
        ))}

        <footer className={styles.mobileFilterSheetActions}>
          <button className={styles.secondaryAction} onClick={onReset} type="button">Reset all</button>
          <button className={styles.primaryAction} onClick={onDismiss} type="button">Show results</button>
        </footer>
      </div>
    </BottomSheetShell>
  );
}
