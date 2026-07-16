import type { RefObject } from "react";
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
  type FilingsV2FilterState,
} from "@/lib/mock/filingsV2Data";
import styles from "./StockRadarFilingsV2.module.css";

type FilterKey = keyof FilingsV2FilterState;

type MobileFilingsV2FilterSheetProps = {
  filters: FilingsV2FilterState;
  isOpen: boolean;
  onApply: () => void;
  onChange: (key: FilterKey, value: string) => void;
  onClear: () => void;
  onDismiss: () => void;
  openerRef: RefObject<HTMLElement | null>;
};

const sections = [
  { key: "formType", label: "Form Type", options: filingsV2FormOptions },
  { key: "eventType", label: "Event Type", options: filingsV2EventOptions },
  { key: "impact", label: "Impact", options: filingsV2ImpactOptions },
  { key: "signal", label: "Signal", options: filingsV2SignalOptions },
  { key: "dateRange", label: "Date Range", options: filingsV2DateOptions },
  { key: "marketCap", label: "Market Cap", options: filingsV2MarketCapOptions },
] as const;

function labelFor(key: FilterKey, value: string) {
  if (key === "eventType" && value !== "All") {
    return filingsV2EventLabels[value as keyof typeof filingsV2EventLabels];
  }
  if (key === "signal" && value !== "All") {
    return filingsV2SignalLabels[value as keyof typeof filingsV2SignalLabels];
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function MobileFilingsV2FilterSheet({
  filters,
  isOpen,
  onApply,
  onChange,
  onClear,
  onDismiss,
  openerRef,
}: MobileFilingsV2FilterSheetProps) {
  return (
    <BottomSheetShell
      aria-labelledby="filings-v2-filter-title"
      closeLabel="Close filing filters"
      id="filings-v2-filter-sheet"
      isOpen={isOpen}
      layout="content-footer"
      onDismiss={onDismiss}
      openerRef={openerRef}
      overlayLabel="Close filing filters"
    >
      <header className={styles.filterSheetHeader}>
        <h2 id="filings-v2-filter-title">Filter filings</h2>
      </header>
      <div className={styles.filterSheetContent}>
        {sections.map((section) => (
          <section className={styles.filterSheetSection} key={section.key}>
            <h3>{section.label}</h3>
            <div aria-label={`${section.label} options`} className={styles.filterOptions} role="group">
              {section.options.map((option) => {
                const value = String(option);
                return (
                  <FilterOption
                    key={value}
                    label={labelFor(section.key, value)}
                    onClick={() => onChange(section.key, value)}
                    selected={filters[section.key] === value}
                  />
                );
              })}
            </div>
          </section>
        ))}
      </div>
      <footer className={styles.filterSheetActions}>
        <button className={styles.secondaryAction} onClick={onClear} type="button">Clear all</button>
        <button className={styles.primaryAction} onClick={onApply} type="button">Apply filters</button>
      </footer>
    </BottomSheetShell>
  );
}
